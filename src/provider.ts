import { CODEX_CHATGPT_HTTP_ADAPTER, invokeCodexChatGptHttpTransport } from "./provider/codex-chatgpt-http.js";
import { CODEX_HTTP_ADAPTER, invokeCodexHttpTransport } from "./provider/codex-http.js";
import { CODEX_EXEC_ADAPTER, invokeCodexExecTransport } from "./provider/codex-exec.js";
import { getCodexModelDefinition, isCodexApiSupportedModel, normalizeCodexModel } from "./models.js";
import { applyArchivistRetrieval } from "./runtime/archivist.js";
import { assemblePrompt } from "./runtime/instructions.js";
import { consumeOperatorSteer, estimateTokenCount, recordRuntimeEvent, setRuntimeAction } from "./runtime/session.js";
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
const TOOL_CALL_MARKUP_PATTERN = /<\s*\/?\s*nexagent_tool_call\b/i;
const MAX_INTERNAL_TOOL_STEPS = 6;
const MAX_INTERNAL_TOOL_CYCLES = 2;
const CONTINUATION_NUDGE = [
  "The previous response deferred action or asked for confirmation instead of executing.",
  "The user has already authorized this task.",
  "Continue now with concrete tool use or complete the task.",
  "Do not provide shell snippets or manual commands for the user to run when an internal tool can do it.",
  "Do not ask for another confirmation unless a real approval gate or blocker prevents progress.",
  "If no file/tool action is needed, provide the final verified result.",
].join(" ");
const WRITE_EVIDENCE_NUDGE = [
  "The previous response claimed files were written or updated, but this turn has no write tool evidence.",
  "Use write_file, apply_patch, or a shell command that performs the edit, then verify it.",
  "If no file change was actually needed, correct the final answer and do not claim changes.",
].join(" ");
const MALFORMED_TOOL_CALL_NUDGE = [
  "The previous response emitted malformed nexagent tool-call markup as visible text.",
  "Do not show raw <nexagent_tool_call> text to the user.",
  "Retry with exactly one valid tool block: <nexagent_tool_call>{\"name\":\"tool_name\",\"arguments\":{}}</nexagent_tool_call>.",
].join(" ");
const NEXSIGHT_TOOL_NUDGE = [
  "This task should use Nexsight because it asks for broad repo/context analysis or explicitly names Nexsight.",
  "Do not use read_file, list_dir, search_content, search_files, or shell_command for this broad inspection step.",
  "Direct tools are fine only for a known small file/path, exact file content, or a narrower follow-up after Nexsight has routed the work.",
  "Retry with exactly one Nexsight tool call: nexsight_execute, nexsight_index, nexsight_batch, or nexsight_search.",
].join(" ");
const FINAL_TOOL_STEP_NUDGE = [
  "Tool budget is almost exhausted.",
  "You have one provider step left after this transcript.",
  "Answer now from the available evidence unless one final tool call is absolutely required.",
  "If another tool is still required, the harness may start one bounded continuation cycle with the tool count reset.",
  "After that continuation cycle, it will return a partial result instead of failing the turn.",
].join(" ");

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
    const turnEventStart = request.session.events.length;
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

    toolCycles:
    for (let cycle = 0; cycle < MAX_INTERNAL_TOOL_CYCLES; cycle += 1) {
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
        if (containsToolCallMarkup(output) && step < MAX_INTERNAL_TOOL_STEPS - 1) {
          recordRuntimeEvent(request.session, {
            kind: "control",
            status: "queued",
            summary: "malformed tool call nudge applied",
            detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
          });
          prompt = `${assembled.prompt}\n\n${toolTranscript.length > 0 ? `Internal tool transcript:\n${toolTranscript.join("\n\n")}\n\n` : ""}${MALFORMED_TOOL_CALL_NUDGE}`;
          continue;
        }
        if (claimsFileMutation(output) && !hasWriteEvidence(request.session, turnEventStart) && step < MAX_INTERNAL_TOOL_STEPS - 1) {
          recordRuntimeEvent(request.session, {
            kind: "control",
            status: "queued",
            summary: "write evidence nudge applied",
            detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
          });
          prompt = `${assembled.prompt}\n\n${toolTranscript.length > 0 ? `Internal tool transcript:\n${toolTranscript.join("\n\n")}\n\n` : ""}${WRITE_EVIDENCE_NUDGE}`;
          continue;
        }
        if (isNonActionableDeferral(output) && step < MAX_INTERNAL_TOOL_STEPS - 1) {
          recordRuntimeEvent(request.session, {
            kind: "control",
            status: "queued",
            summary: "continuation nudge applied",
            detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
          });
          prompt = `${assembled.prompt}\n\n${toolTranscript.length > 0 ? `Internal tool transcript:\n${toolTranscript.join("\n\n")}\n\n` : ""}${CONTINUATION_NUDGE}`;
          continue;
        }
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

      if (step === MAX_INTERNAL_TOOL_STEPS - 1) {
        if (cycle < MAX_INTERNAL_TOOL_CYCLES - 1) {
          recordRuntimeEvent(request.session, {
            kind: "control",
            status: "queued",
            summary: "tool budget continuation cycle started",
            detail: toolCall.name,
          });
          prompt = createToolBudgetContinuationPrompt(assembled.prompt, toolTranscript, toolCall.name, cycle + 2);
          continue toolCycles;
        }
        recordRuntimeEvent(request.session, {
          kind: "control",
          status: "completed",
          summary: "tool budget fallback returned partial result",
          detail: toolCall.name,
        });
        return createToolBudgetPartialResult(
          provider,
          model,
          transport.transport,
          transport.id,
          toolTranscript,
          `Blocked another ${toolCall.name} call because this turn reached the internal tool budget.`,
        );
      }

      if (needsNexsightToolOnly(request.prompt, toolCall) && !isNexsightToolCall(toolCall) && step < MAX_INTERNAL_TOOL_STEPS - 1) {
        recordRuntimeEvent(request.session, {
          kind: "control",
          status: "queued",
          summary: "nexsight tool nudge applied",
          detail: toolCall.name,
        });
        prompt = `${assembled.prompt}\n\n${toolTranscript.length > 0 ? `Internal tool transcript:\n${toolTranscript.join("\n\n")}\n\n` : ""}${NEXSIGHT_TOOL_NUDGE}`;
        continue;
      }

      const toolResult = await executeToolWithRuntimeActivity(request.session, toolCall);
      toolTranscript.push(formatInternalToolExchange(step + 1, toolCall, toolResult));
      const finalStepNudge = step === MAX_INTERNAL_TOOL_STEPS - 2 ? `\n\n${FINAL_TOOL_STEP_NUDGE}` : "";
      prompt = `${assembled.prompt}\n\nInternal tool transcript:\n${toolTranscript.join("\n\n")}\n\nContinue. Either answer user directly or request one more tool with one <nexagent_tool_call> block only.${finalStepNudge}`;
      }
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
  const turnEventStart = request.session.events.length;

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
      if (containsToolCallMarkup(output) && step < MAX_INTERNAL_TOOL_STEPS - 1) {
        recordRuntimeEvent(request.session, {
          kind: "control",
          status: "queued",
          summary: "malformed tool call nudge applied",
          detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
        });
        nativeInput = [{ role: "user", content: MALFORMED_TOOL_CALL_NUDGE }];
        continue;
      }
      if (claimsFileMutation(output) && !hasWriteEvidence(request.session, turnEventStart) && step < MAX_INTERNAL_TOOL_STEPS - 1) {
        recordRuntimeEvent(request.session, {
          kind: "control",
          status: "queued",
          summary: "write evidence nudge applied",
          detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
        });
        nativeInput = [{ role: "user", content: WRITE_EVIDENCE_NUDGE }];
        continue;
      }
      if (isNonActionableDeferral(output) && step < MAX_INTERNAL_TOOL_STEPS - 1) {
        recordRuntimeEvent(request.session, {
          kind: "control",
          status: "queued",
          summary: "continuation nudge applied",
          detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
        });
        nativeInput = [{ role: "user", content: CONTINUATION_NUDGE }];
        continue;
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

    if (step === MAX_INTERNAL_TOOL_STEPS - 1) {
      recordRuntimeEvent(request.session, {
        kind: "control",
        status: "completed",
        summary: "native tool budget fallback returned partial result",
        detail: toolCall.name,
      });
      return createToolBudgetPartialResult(
        request.session.provider,
        model,
        transport.transport,
        transport.id,
        [],
        `Blocked another ${toolCall.name} native tool call because this turn reached the internal tool budget.`,
      );
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
      ...(step === MAX_INTERNAL_TOOL_STEPS - 2 ? [{ role: "user", content: FINAL_TOOL_STEP_NUDGE }] : []),
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
  const startedAt = Date.now();
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
  const durationMs = Date.now() - startedAt;
  setRuntimeAction(session, result.ok ? "ready" : "error", `tool ${call.name} ${result.ok ? "complete" : "failed"} · ${risk}`);
  const outputPreview = truncateToolOutput(result.output);
  const outputTokens = estimateTokenCount(result.output);
  recordRuntimeEvent(session, {
    kind: "tool",
    status: result.ok ? "completed" : "failed",
    summary: `tool ${call.name} ${result.ok ? "completed" : "failed"}`,
    detail: `${risk}; duration=${formatToolDuration(durationMs)}; out~${outputTokens}; output=${outputPreview}`,
  });
  return result;
}

function formatToolDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
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
  if (match) {
    const parsed = parseToolCallJson(match[1] ?? "");
    if (!parsed || typeof parsed.name !== "string") {
      return null;
    }
    return parsed;
  }

  return parseAttributeStyleToolCall(output);
}

function parseToolCallJson(value: string): InternalToolCall | null {
  const trimmed = value.trim();
  for (const candidate of [trimmed, escapeControlCharsInJsonStrings(trimmed)]) {
    try {
      const parsed = JSON.parse(candidate) as InternalToolCall;
      if (!parsed || typeof parsed !== "object") {
        continue;
      }
      return parsed;
    } catch {
      // Try repaired candidate next.
    }
  }
  return null;
}

function escapeControlCharsInJsonStrings(value: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      output += char;
      inString = !inString;
      continue;
    }
    if (inString && char === "\n") {
      output += "\\n";
      continue;
    }
    if (inString && char === "\r") {
      output += "\\r";
      continue;
    }
    if (inString && char === "\t") {
      output += "\\t";
      continue;
    }
    output += char;
  }

  return output;
}

function containsToolCallMarkup(output: string): boolean {
  return TOOL_CALL_MARKUP_PATTERN.test(output);
}

function needsNexsightToolOnly(prompt: string, call: InternalToolCall): boolean {
  if (!isGenericInspectionTool(call)) {
    return false;
  }
  if (/\bnexsight\b/i.test(prompt)) {
    return true;
  }

  const lower = prompt.toLowerCase();
  const asksForBroadInspection = /\b(inspect|explore|examine|analy[sz]e|summari[sz]e|scan|map|inventory|count|find|search)\b/.test(lower);
  const broadTarget = /\b(repo|codebase|project|workspace|directory|tree|files|structure|architecture|layout|dependencies|tests?)\b/.test(lower)
    || /~\/|\/home\/|\.\/|\.\b/.test(lower);
  const exactFileRequest = /\b(read|open|show|cat)\b/.test(lower) && /\b[\w.-]+\.[a-z0-9]+\b/i.test(prompt);
  return asksForBroadInspection && broadTarget && !exactFileRequest;
}

function isNexsightToolCall(call: InternalToolCall): boolean {
  return call.name === "nexsight_execute"
    || call.name === "nexsight_index"
    || call.name === "nexsight_batch"
    || call.name === "nexsight_search";
}

function isGenericInspectionTool(call: InternalToolCall): boolean {
  return call.name === "read_file"
    || call.name === "list_dir"
    || call.name === "search_content"
    || call.name === "search_files"
    || call.name === "apply_patch"
    || call.name === "write_file"
    || call.name === "shell_command";
}

function parseAttributeStyleToolCall(output: string): InternalToolCall | null {
  const opening = output.match(/<nexagent_tool_call\b([^>]*)>/i);
  if (!opening) {
    return null;
  }

  const attributes = opening[1] ?? "";
  const name = readXmlAttribute(attributes, "name");
  if (!name) {
    return null;
  }

  const rawArguments = readXmlAttribute(attributes, "arguments") ?? extractJsonAfterToken(output, "arguments");
  const parsedArguments = parseToolArguments(rawArguments ?? "{}");
  if (!parsedArguments) {
    return null;
  }

  return {
    name: name as InternalToolCall["name"],
    arguments: parsedArguments,
  };
}

function readXmlAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  const value = match?.[1] ?? match?.[2] ?? null;
  return value ? decodeXmlAttribute(value) : null;
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractJsonAfterToken(value: string, token: string): string | null {
  const tokenIndex = value.toLowerCase().indexOf(token.toLowerCase());
  if (tokenIndex < 0) {
    return null;
  }
  const objectStart = value.indexOf("{", tokenIndex);
  if (objectStart < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = objectStart; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(objectStart, index + 1);
      }
    }
  }
  return null;
}

function formatInternalToolExchange(step: number, call: InternalToolCall, result: InternalToolResult): string {
  return [
    `Step ${String(step)}`,
    `Tool call: ${JSON.stringify(call)}`,
    `Tool result (${result.ok ? "ok" : "error"}):`,
    result.output,
  ].join("\n");
}

function createToolBudgetContinuationPrompt(basePrompt: string, toolTranscript: string[], pendingToolName: string, cycleNumber: number): string {
  const compactTranscript = toolTranscript.slice(-4).join("\n\n");
  return [
    basePrompt,
    "",
    "Internal tool transcript:",
    compactTranscript,
    "",
    `Tool budget continuation cycle ${String(cycleNumber)} started.`,
    `The previous provider step attempted another ${pendingToolName} tool call at the tool budget boundary.`,
    "The harness legally reset the per-cycle tool counter for one bounded continuation cycle.",
    "Continue from the existing evidence. Prefer answering now; use tools only for the smallest missing fact.",
  ].join("\n");
}

function createToolBudgetPartialResult(
  provider: string,
  model: string | null,
  transport: "codex" | "openai",
  adapter: ProviderSuccess["adapter"],
  toolTranscript: string[],
  reason: string,
): ProviderSuccess {
  const transcript = toolTranscript.length > 0
    ? toolTranscript.slice(-3).join("\n\n")
    : "No completed tool transcript was available for this fallback.";
  return {
    ok: true,
    provider,
    model,
    transport,
    adapter,
    fallbackApplied: false,
    output: [
      "Tool budget exhausted before final assistant answer.",
      reason,
      "",
      "Partial evidence from completed tools:",
      transcript,
    ].join("\n"),
  };
}

function isNonActionableDeferral(output: string): boolean {
  const text = output.trim();
  if (!text) {
    return false;
  }

  if (TOOL_CALL_PATTERN.test(text) || /^(done|complete|completed|fixed|updated|implemented)\b/i.test(text)) {
    return false;
  }

  const lower = text.toLowerCase();
  const asksForUserToContinue = [
    "if you want, i can",
    "if you'd like, i can",
    "i can proceed",
    "i can do that now",
    "please run this",
    "run this and",
    "you can run",
    "you should run",
    "reply with",
    "say \"",
    "say '",
    "tell me to",
    "want me to",
    "should i",
  ].some((phrase) => lower.includes(phrase));
  const admitsNoAction = [
    "i need to actually",
    "i need to apply",
    "i need to edit",
    "i need to run",
    "i haven't",
    "i have not",
    "i didn't",
    "i did not",
    "i don't have tool execution",
    "no file-change evidence",
  ].some((phrase) => lower.includes(phrase));
  const concreteCompletionEvidence = [
    "tests pass",
    "verification passed",
    "wrote ",
    "updated ",
    "created ",
    "changed ",
    "ran ",
    "committed ",
  ].some((phrase) => lower.includes(phrase));

  return (asksForUserToContinue || admitsNoAction) && !concreteCompletionEvidence;
}

function claimsFileMutation(output: string): boolean {
  const lower = output.toLowerCase();
  const mutationClaim = [
    "done — applied",
    "done - applied",
    "applied directly",
    "i updated",
    "updated readme",
    "updated `readme",
    "readme now includes",
    "i added",
    "added sections",
    "wrote ",
    "created ",
    "modified ",
    "changed ",
  ].some((phrase) => lower.includes(phrase));
  const fileMention = /\b(readme|\.md|\.ts|\.tsx|\.json|file|files)\b/i.test(output);
  return mutationClaim && fileMention;
}

function hasWriteEvidence(session: RuntimeSession, sinceIndex: number): boolean {
  return session.events.slice(sinceIndex).some((event) =>
    event.kind === "tool"
    && event.status === "completed"
    && /tool\s+(write_file|apply_patch|shell_command)\s+completed/i.test(event.summary),
  );
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
