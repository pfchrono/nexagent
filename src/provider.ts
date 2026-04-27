import { CODEX_CHATGPT_HTTP_ADAPTER, invokeCodexChatGptHttpTransport } from "./provider/codex-chatgpt-http.js";
import { CODEX_HTTP_ADAPTER, invokeCodexHttpTransport } from "./provider/codex-http.js";
import { CODEX_EXEC_ADAPTER, invokeCodexExecTransport } from "./provider/codex-exec.js";
import { getCodexModelDefinition, isCodexApiSupportedModel, normalizeCodexModel } from "./models.js";
import { applyArchivistRetrieval } from "./runtime/archivist.js";
import { assemblePrompt } from "./runtime/instructions.js";
import { consumeOperatorSteer, recordRuntimeEvent, setRuntimeAction } from "./runtime/session.js";
import type { RuntimeApprovalRequest, RuntimeSession } from "./runtime/session.js";
import { classifyInternalToolRisk, executeInternalToolAsync, type InternalToolCall, type InternalToolResult } from "./runtime/tools.js";

export interface ProviderRequest {
  session: RuntimeSession;
  prompt: string;
  instructions?: string;
  nativeInput?: unknown;
  attachments?: ImageAttachment[];
  previousResponseId?: string;
  nativeTools?: boolean;
  abortSignal?: AbortSignal;
}

export interface ImageAttachment {
  path: string;
  name: string;
  mimeType: string;
  bytes: number;
  dataUrl: string;
}

export interface ProviderSuccess {
  ok: true;
  provider: string;
  model: string | null;
  transport: "codex" | "openai";
  adapter: "codex-cli-exec" | "openai-http-responses" | "codex-chatgpt-http";
  fallbackApplied: false;
  output: string;
}

export interface ProviderFailure {
  ok: false;
  provider: string;
  model: string | null;
  transport: "codex" | "openai";
  adapter: "codex-cli-exec" | "openai-http-responses" | "codex-chatgpt-http";
  fallbackApplied: false;
  code: "unsupported_provider" | "auth_unavailable" | "unsupported_model" | "transport_error";
  message: string;
  detail: string;
}

export type ProviderResult = ProviderSuccess | ProviderFailure;

export interface CodexInvocation {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
  raw?: unknown;
}

export type CodexInvoker = (request: ProviderRequest, model: string | null) => Promise<CodexInvocation>;
export interface CodexInvokers {
  exec: CodexInvoker;
  http: CodexInvoker;
  codexHttp: CodexInvoker;
}

const TOOL_CALL_PATTERN = /<nexagent_tool_call>([\s\S]+?)<\/nexagent_tool_call>/;
const MAX_INTERNAL_TOOL_STEPS = 6;

export async function executeProviderRequest(
  request: ProviderRequest,
  invokers: CodexInvokers = { exec: invokeCodexExecTransport, http: invokeCodexHttpTransport, codexHttp: invokeCodexChatGptHttpTransport },
): Promise<ProviderResult> {
  const provider = request.session.provider;
  const model = resolveModel(request.session);
  const transport = resolveTransport(request.session);

  if (provider !== "codex" && provider !== "openai") {
    return {
      ok: false,
      provider,
      model,
      transport: transport.transport,
      adapter: transport.id,
      fallbackApplied: false,
      code: "unsupported_provider",
      message: `provider ${provider} is not implemented`,
      detail: "nexagent currently supports only codex-compatible providers.",
    };
  }

  if (request.session.providerTransport.mode !== "cli-exec" && !isCodexApiSupportedModel(model)) {
    const resolvedModel = normalizeCodexModel(model) ?? model;
    const definition = getCodexModelDefinition(model);
    return {
      ok: false,
      provider,
      model: resolvedModel,
      transport: transport.transport,
      adapter: transport.id,
      fallbackApplied: false,
      code: "unsupported_model",
      message: resolvedModel ? `codex model ${resolvedModel} is unsupported on API transports` : "codex model is unsupported on API transports",
      detail: definition?.upgrade
        ? `Model ${resolvedModel} is not exposed on API transports. Suggested upgrade: ${definition.upgrade}.`
        : `Model ${resolvedModel} is not exposed on API transports.`,
    };
  }

  const attachmentFailure = validateAttachmentSupport(request, transport);
  if (attachmentFailure) {
    return attachmentFailure;
  }

  try {
    recordRuntimeEvent(request.session, {
      kind: "provider",
      status: "started",
      summary: `${provider} turn started`,
      detail: `transport=${request.session.providerTransport.mode}`,
    });
    await applyArchivistRetrieval(request.session, request.prompt);
    const assembled = await assemblePrompt(request);
    if (request.session.providerTransport.mode === "http-responses") {
      return executeOpenAiNativeToolLoop(request, assembled.prompt, model, transport, invokers.http);
    }
    const invokeCodex = request.session.providerTransport.mode === "codex-http"
      ? invokers.codexHttp
      : invokers.exec;
    const codexHttpInput = request.session.providerTransport.mode === "codex-http"
      ? buildNativeInputFromPrompt(request.prompt, request.attachments)
      : undefined;
    let prompt = assembled.prompt;
    const toolTranscript: string[] = [];

    for (let step = 0; step < MAX_INTERNAL_TOOL_STEPS; step += 1) {
      const steer = consumeOperatorSteer(request.session, `before provider step ${String(step + 1)}`);
      if (steer) {
        prompt = `${prompt}\n\nOperator steer:\n- ${steer}`;
      }
      if (request.session.operationControls.cancelRequested) {
        request.session.operationControls.cancelRequested = false;
        recordRuntimeEvent(request.session, {
          kind: "control",
          status: "canceled",
          summary: "operator cancel applied",
          detail: "before provider invocation",
        });
        return createOperationFailure(request, model, transport.id, "operation canceled by operator");
      }
      const invocation = await withAbortController(
        request.session,
        (signal) => invokeCodex(
          request.session.providerTransport.mode === "codex-http"
            ? { ...request, prompt: request.prompt, instructions: prompt, nativeInput: codexHttpInput, abortSignal: signal }
            : { ...request, prompt, abortSignal: signal },
          model,
        ),
      );

      if (invocation.exitCode !== 0) {
        return createCodexFailure(provider, model, invocation.stderr, invocation.stdout, transport.id);
      }

      const output = invocation.output.trimEnd();
      if (output.length === 0) {
        return createEmptyOutputFailure(provider, model, transport.id);
      }
      const toolCall = parseInternalToolCall(output);
      if (!toolCall) {
        recordRuntimeEvent(request.session, {
          kind: "assistant",
          status: "completed",
          summary: "assistant response completed",
          detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
        });
        recordRuntimeEvent(request.session, {
          kind: "provider",
          status: "completed",
          summary: `${provider} turn completed`,
          detail: `transport=${request.session.providerTransport.mode}; output_chars=${String(output.length)}`,
        });
        return {
          ok: true,
          provider,
          model,
          transport: transport.transport,
          adapter: transport.id,
          fallbackApplied: false,
          output,
        };
      }

      const toolResult = await executeToolWithRuntimeActivity(request.session, toolCall);
      toolTranscript.push(formatInternalToolExchange(step + 1, toolCall, toolResult));
      prompt = `${assembled.prompt}\n\nInternal tool transcript:\n${toolTranscript.join("\n\n")}\n\nContinue. Either answer user directly or request one more tool with one <nexagent_tool_call> block only.`;
    }

    return {
      ok: false,
      provider,
      model,
      transport: transport.transport,
      adapter: transport.id,
      fallbackApplied: false,
      code: "transport_error",
      message: "turn stopped: tool loop ran too long",
      detail: `Model requested more than ${String(MAX_INTERNAL_TOOL_STEPS)} internal tool calls in one turn. Try tighter prompt, /cancel, or smaller task slice.`,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (request.session.operationControls.cancelRequested || /abort|canceled by operator|cancelled by operator/i.test(detail)) {
      request.session.operationControls.cancelRequested = false;
      return createOperationFailure(request, model, transport.id, "operation canceled by operator");
    }
    recordRuntimeEvent(request.session, {
      kind: "provider",
      status: "failed",
      summary: `${provider} turn failed`,
      detail,
    });
    return {
      ok: false,
      provider,
      model,
      transport: transport.transport,
      adapter: transport.id,
      fallbackApplied: false,
      code: "transport_error",
      message: "codex execution failed",
      detail,
    };
  }
}

function resolveModel(session: RuntimeSession): string | null {
  const selected = session.providerRouting.modelSelection.configuredModels;
  return normalizeCodexModel(selected[session.provider as keyof typeof selected] ?? null);
}

function createCodexFailure(
  provider: string,
  model: string | null,
  stderr: string,
  stdout: string,
  adapter: ProviderFailure["adapter"],
): ProviderFailure {
  const detail = [stderr.trim(), stdout.trim()].filter((value) => value.length > 0).join("\n");
  const normalized = detail.toLowerCase();

  if (
    normalized.includes("api key") ||
    normalized.includes("login") ||
    normalized.includes("auth") ||
    normalized.includes("unauthorized")
  ) {
    return {
      ok: false,
      provider,
      model,
      transport: "codex",
      adapter,
      fallbackApplied: false,
      code: "auth_unavailable",
      message: "codex credentials unavailable",
      detail: detail || "codex returned an authentication error.",
    };
  }

  if (normalized.includes("model") && (normalized.includes("unsupported") || normalized.includes("unknown"))) {
    return {
      ok: false,
      provider,
      model,
      transport: "codex",
      adapter,
      fallbackApplied: false,
      code: "unsupported_model",
      message: model ? `codex model ${model} is unsupported` : "codex model is unsupported",
      detail: detail || "codex rejected the configured model.",
    };
  }

  return {
    ok: false,
    provider,
    model,
    transport: "codex",
    adapter,
    fallbackApplied: false,
    code: "transport_error",
    message: "codex transport failed",
    detail: detail || "codex exited without a result.",
  };
}

function createEmptyOutputFailure(
  provider: string,
  model: string | null,
  adapter: ProviderFailure["adapter"],
): ProviderFailure {
  return {
    ok: false,
    provider,
    model,
    transport: provider === "openai" ? "openai" : "codex",
    adapter,
    fallbackApplied: false,
    code: "transport_error",
    message: "provider returned empty output",
    detail: "provider finished with exit code 0 but produced no assistant text.",
  };
}

function resolveTransport(session: RuntimeSession) {
  return session.providerTransport.mode === "http-responses"
    ? CODEX_HTTP_ADAPTER
    : session.providerTransport.mode === "codex-http"
      ? CODEX_CHATGPT_HTTP_ADAPTER
      : CODEX_EXEC_ADAPTER;
}

async function executeOpenAiNativeToolLoop(
  request: ProviderRequest,
  assembledPrompt: string,
  model: string | null,
  transport: ReturnType<typeof resolveTransport>,
  invokeHttp: CodexInvoker,
): Promise<ProviderResult> {
  let previousResponseId: string | undefined;
  let nativeInput: unknown = buildNativeInputFromPrompt(request.prompt, request.attachments);

  for (let step = 0; step < MAX_INTERNAL_TOOL_STEPS; step += 1) {
    if (request.session.operationControls.cancelRequested) {
      request.session.operationControls.cancelRequested = false;
      recordRuntimeEvent(request.session, {
        kind: "control",
        status: "canceled",
        summary: "operator cancel applied",
        detail: "before native provider step",
      });
      return createOperationFailure(request, model, transport.id, "operation canceled by operator");
    }
    const invocation = await withAbortController(
      request.session,
      (signal) => invokeHttp(
        {
          ...request,
          prompt: assembledPrompt,
          instructions: assembledPrompt,
          nativeInput,
          previousResponseId,
          nativeTools: true,
          abortSignal: signal,
        },
        model,
      ),
    );

    if (invocation.exitCode !== 0) {
      return createCodexFailure(request.session.provider, model, invocation.stderr, invocation.stdout, transport.id);
    }

    const toolCall = parseNativeToolCall(invocation.raw);
    if (!toolCall) {
      const output = invocation.output.trimEnd();
      if (output.length === 0) {
        return createEmptyOutputFailure(request.session.provider, model, transport.id);
      }
      recordRuntimeEvent(request.session, {
        kind: "assistant",
        status: "completed",
        summary: "assistant response completed",
        detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
      });
      return {
        ok: true,
        provider: request.session.provider,
        model,
        transport: transport.transport,
        adapter: transport.id,
        fallbackApplied: false,
        output,
      };
    }

    const toolResult = await executeToolWithRuntimeActivity(request.session, {
      name: toolCall.name,
      arguments: toolCall.arguments,
    });
    previousResponseId = toolCall.responseId;
    const steer = consumeOperatorSteer(request.session, `after tool ${toolCall.name}`);
    nativeInput = [
      {
        type: "function_call_output",
        call_id: toolCall.callId,
        output: toolResult.output,
      },
      ...(steer ? [{ role: "user", content: `Operator steer: ${steer}` }] : []),
    ];
  }

  return {
    ok: false,
    provider: request.session.provider,
    model,
    transport: transport.transport,
    adapter: transport.id,
    fallbackApplied: false,
    code: "transport_error",
    message: "native tool loop exceeded limit",
    detail: `Model requested more than ${String(MAX_INTERNAL_TOOL_STEPS)} native tool calls in one turn.`,
  };
}

function validateAttachmentSupport(
  request: ProviderRequest,
  transport: ReturnType<typeof resolveTransport>,
): ProviderFailure | null {
  const attachments = request.attachments ?? [];
  if (attachments.length === 0) {
    return null;
  }

  if (attachments.length > 1) {
    return {
      ok: false,
      provider: request.session.provider,
      model: resolveModel(request.session),
      transport: transport.transport,
      adapter: transport.id,
      fallbackApplied: false,
      code: "transport_error",
      message: "only one image attachment is supported right now",
      detail: `received ${String(attachments.length)} attachments; baseline supports 1`,
    };
  }

  if (request.session.providerTransport.mode === "cli-exec") {
    return {
      ok: false,
      provider: request.session.provider,
      model: resolveModel(request.session),
      transport: transport.transport,
      adapter: transport.id,
      fallbackApplied: false,
      code: "transport_error",
      message: "image attachment unsupported on cli-exec transport",
      detail: "switch transport with /provider transport codex-http or /provider transport http-responses",
    };
  }

  return null;
}

function buildNativeInputFromPrompt(prompt: string, attachments?: ImageAttachment[]): unknown {
  if (!attachments || attachments.length === 0) {
    return [{ role: "user", content: prompt }];
  }

  const content: Array<Record<string, unknown>> = [
    { type: "input_text", text: prompt },
  ];

  for (const attachment of attachments) {
    content.push({
      type: "input_image",
      image_url: attachment.dataUrl,
    });
    content.push({
      type: "input_text",
      text: `[attachment] name=${attachment.name}; path=${attachment.path}; mime=${attachment.mimeType}; bytes=${String(attachment.bytes)}`,
    });
  }

  return [{ role: "user", content }];
}

async function withAbortController<T>(
  session: RuntimeSession,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  session.operationControls.activeAbortController = controller;
  try {
    return await fn(controller.signal);
  } finally {
    if (session.operationControls.activeAbortController === controller) {
      session.operationControls.activeAbortController = null;
    }
  }
}

async function executeToolWithRuntimeActivity(session: RuntimeSession, call: InternalToolCall): Promise<InternalToolResult> {
  const risk = classifyInternalToolRisk(call);
  const argsPreview = formatToolArgumentsPreview(call.arguments);
  recordRuntimeEvent(session, {
    kind: "tool",
    status: "started",
    summary: `tool ${call.name} started`,
    detail: `${risk}; args=${argsPreview}`,
  });
  const approved = await maybeAwaitApproval(session, call, risk);
  if (!approved) {
    recordRuntimeEvent(session, {
      kind: "tool",
      status: session.operationControls.lastDecision === "canceled" ? "canceled" : "blocked",
      summary: `tool ${call.name} not executed`,
      detail: risk,
    });
    return {
      ok: false,
      tool: call.name,
      output: session.operationControls.lastDecision === "canceled" ? "tool execution canceled by operator" : "tool execution rejected by operator",
    };
  }
  setRuntimeAction(session, "running", `tool ${call.name} · ${risk}`);
  const result = await executeInternalToolAsync(session, call);
  setRuntimeAction(session, result.ok ? "ready" : "error", `tool ${call.name} ${result.ok ? "complete" : "failed"} · ${risk}`);
  const outputPreview = truncateToolOutput(result.output);
  recordRuntimeEvent(session, {
    kind: "tool",
    status: result.ok ? "completed" : "failed",
    summary: `tool ${call.name} ${result.ok ? "completed" : "failed"}`,
    detail: `${risk}; output=${outputPreview}`,
  });
  return result;
}

function formatToolArgumentsPreview(value: unknown): string {
  if (value === null || value === undefined) {
    return "none";
  }
  try {
    const raw = JSON.stringify(value);
    if (!raw) {
      return "none";
    }
    return raw.length > 220 ? `${raw.slice(0, 217)}...` : raw;
  } catch {
    return String(value);
  }
}

function truncateToolOutput(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "none";
  }
  return trimmed.length > 260 ? `${trimmed.slice(0, 257)}...` : trimmed;
}

async function maybeAwaitApproval(session: RuntimeSession, call: InternalToolCall, risk: ReturnType<typeof classifyInternalToolRisk>): Promise<boolean> {
  if (risk !== "guarded" || !session.operationControls.requireApprovalForGuarded) {
    return true;
  }

  const request: RuntimeApprovalRequest = {
    tool: call.name,
    risk,
    summary: JSON.stringify(call.arguments ?? {}),
  };
  session.operationControls.pendingApproval = request;
  session.operationControls.lastDecision = null;
  recordRuntimeEvent(session, {
    kind: "control",
    status: "queued",
    summary: `approval requested for ${call.name}`,
    detail: risk,
  });
  setRuntimeAction(session, "running", `awaiting approval · ${call.name}`);

  while (session.operationControls.pendingApproval) {
    await sleep(50);
  }

  if (session.operationControls.cancelRequested) {
    session.operationControls.cancelRequested = false;
    session.operationControls.lastDecision = "canceled";
    recordRuntimeEvent(session, {
      kind: "control",
      status: "canceled",
      summary: `approval canceled for ${call.name}`,
      detail: risk,
    });
    return false;
  }

  recordRuntimeEvent(session, {
    kind: "control",
    status: session.operationControls.lastDecision === "approved" ? "applied" : "blocked",
    summary: session.operationControls.lastDecision === "approved" ? `approval granted for ${call.name}` : `approval denied for ${call.name}`,
    detail: risk,
  });
  return session.operationControls.lastDecision === "approved";
}

function createOperationFailure(
  request: ProviderRequest,
  model: string | null,
  adapter: ProviderFailure["adapter"],
  detail: string,
): ProviderFailure {
  return {
    ok: false,
    provider: request.session.provider,
    model,
    transport: request.session.provider === "openai" ? "openai" : "codex",
    adapter,
    fallbackApplied: false,
    code: "transport_error",
    message: "operation halted",
    detail,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseInternalToolCall(output: string): InternalToolCall | null {
  const match = output.match(TOOL_CALL_PATTERN);
  if (!match) {
    return null;
  }

  try {
    const parsed = JSON.parse(match[1] ?? "") as InternalToolCall;
    if (!parsed || typeof parsed !== "object" || typeof parsed.name !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function formatInternalToolExchange(step: number, call: InternalToolCall, result: InternalToolResult): string {
  return [
    `Step ${String(step)}`,
    `Tool call: ${JSON.stringify(call)}`,
    `Tool result (${result.ok ? "ok" : "error"}):`,
    result.output,
  ].join("\n");
}

function parseNativeToolCall(payload: unknown): { responseId: string | undefined; callId: string; name: InternalToolCall["name"]; arguments: Record<string, unknown> } | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const responseId = typeof record.id === "string" ? record.id : undefined;
  const output = Array.isArray(record.output) ? record.output : [];

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    if (candidate.type !== "function_call" || typeof candidate.name !== "string" || typeof candidate.call_id !== "string") {
      continue;
    }

    const parsedArguments = parseToolArguments(candidate.arguments);
    if (!parsedArguments) {
      return null;
    }

    return {
      responseId,
      callId: candidate.call_id,
      name: candidate.name as InternalToolCall["name"],
      arguments: parsedArguments,
    };
  }

  return null;
}

function parseToolArguments(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return null;
  }
}
