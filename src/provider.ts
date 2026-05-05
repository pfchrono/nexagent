import { invokeCodexChatGptHttpTransport } from "./provider/codex-chatgpt-http.js";
import { invokeCodexHttpTransport } from "./provider/codex-http.js";
import { invokeCodexExecTransport } from "./provider/codex-exec.js";
import {
  createEmptyOutputFailure,
  createUnavailableModelFailure,
  extractGenAiUsage,
  resolveModel,
  resolveTransport,
  validateAttachmentSupport,
  type ProviderTransportAdapter,
} from "./provider/control-normalization.js";
import {
  compactToolTranscriptEntries,
  createPromptWithToolTranscript,
  formatInternalToolExchange,
  formatToolTranscriptOutput,
  formatToolTranscriptSection,
  truncateToolOutput,
} from "./provider/transcript.js";
import { runProviderTurn } from "./provider/turn-lifecycle.js";
import {
  createRequiredNexsightFallbackPrompt,
  createRequiredNexsightFallbackSuccess,
  createRequiredNexsightPreflightPrompt,
  runRequiredNexsightFallback,
  runRequiredNexsightPreflight,
} from "./provider/nexsight-required.js";
import {
  MAX_GUIDANCE_NUDGES_BEFORE_SYNTHESIS,
  PROVIDER_NUDGES,
  getRequiredEvidenceNudge,
  incrementRequiredEvidenceNudge,
  recordRequiredEvidenceNudge,
  type RequiredEvidenceNudge,
  type RequiredEvidenceNudgeState,
} from "./provider/nudges.js";
import {
  classifyToolFailure,
  createToolFailureDiagnosticInput,
  formatToolArgumentsPreview,
  formatToolDuration,
} from "./provider/tool-results.js";
import {
  captureSentryDiagnostic,
  logSentryError,
  logSentryInfo,
  setSentrySpanAttributes,
  shouldRecordSentryAiContent,
  withSentryAiAgentSpan,
  withSentryAiRequestSpan,
  withSentryAiToolSpan,
} from "./instrument.js";
import { applyArchivistRetrieval, rememberArchivistFailure, rememberArchivistRecovery } from "./runtime/archivist.js";
import { writeDebugLog } from "./runtime/debug.js";
import { hasWriteEvidence } from "./runtime/evidence.js";
import { assemblePrompt } from "./runtime/instructions.js";
import {
  isNexsightToolCall,
  shouldRouteToNexsightOnly,
} from "./runtime/nexsight-router.js";
import { toDiagnosticRuntimeEvent, type RuntimeDiagnosticInput } from "./runtime/diagnostics.js";
import { emitRuntimeExtensionEvent } from "./runtime/extensions.js";
import { savePersistedRuntimeState } from "./runtime/persistence.js";
import { createQuestionnaireRequest, type RuntimeQuestionnaireQuestion } from "./runtime/questionnaire.js";
import { consumeOperatorSteer, estimateTokenCount, recordRuntimeEvent, setRuntimeAction } from "./runtime/session.js";
import type { RuntimeApprovalRequest, RuntimeSession } from "./runtime/session.js";
import { recordToolMemory } from "./runtime/tool-memory.js";
import { TurnRun, type MissingTurnEvidence } from "./runtime/turn-run.js";
import { classifyInternalToolRisk, executeInternalToolAsync, validateInternalToolArguments, type InternalToolCall, type InternalToolResult } from "./runtime/tools.js";

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

export interface CodexInvocationMetrics {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface CodexInvocation {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
  raw?: unknown;
  metrics?: CodexInvocationMetrics;
}

export type CodexInvoker = (request: ProviderRequest, model: string | null) => Promise<CodexInvocation>;
export interface CodexInvokers {
  exec: CodexInvoker;
  http: CodexInvoker;
  codexHttp: CodexInvoker;
}

const JSON_BODY_TOOL_CALL_PATTERN = /<(?:nexagent_)?tool_call>([\s\S]+?)<\/(?:nexagent_)?tool_call>/i;
const INTERNAL_TOOL_TAG_NAMES = [
  "read_file",
  "write_file",
  "apply_patch",
  "batch_edit",
  "preview_patch",
  "list_dir",
  "search_content",
  "search_files",
  "web_fetch",
  "web_search",
  "git_status",
  "git_diff",
  "shell_command",
  "nexsight_execute",
  "nexsight_read",
  "nexsight_gather",
  "nexsight_index",
  "nexsight_batch",
  "nexsight_search",
  "archivist_save",
  "archivist_checkpoint",
  "ask_user_question",
] as const satisfies readonly InternalToolCall["name"][];
const INTERNAL_TOOL_TAG_PATTERN = INTERNAL_TOOL_TAG_NAMES.join("|");
const TOOL_CALL_MARKUP_PATTERN = new RegExp(`<\\s*\\/?\\s*(?:(?:nexagent_)?tool_call|${INTERNAL_TOOL_TAG_PATTERN})\\b`, "i");
const MAX_INTERNAL_TOOL_STEPS = 100;
const MAX_INTERNAL_TOOL_CYCLES = 1;
const FINAL_EDIT_SUMMARY_GUIDANCE = "If completed edit tool output already rendered an Edited-file block or bounded diff preview, do not repeat the full diff in the final answer; summarize changed paths, line counts, verification, and any remaining blocker only.";
// REQUIRED_ASK_USER_EVIDENCE_NUDGE remains registered in ./provider/nudges.ts for ask gate guidance.
type RequiredEvidenceRecovery =
  | { kind: "retry"; prompt: string; usedFallback?: boolean }
  | { kind: "fallback-success"; result: ProviderResult }
  | { kind: "blocked"; result: ProviderFailure };

export async function executeProviderRequest(
  request: ProviderRequest,
  invokers: CodexInvokers = { exec: invokeCodexExecTransport, http: invokeCodexHttpTransport, codexHttp: invokeCodexChatGptHttpTransport },
): Promise<ProviderResult> {
  return runProviderTurn(
    request,
    (turnRun, onToolResult) => executeProviderRequestImpl(request, invokers, turnRun, onToolResult),
    () => emitRuntimeExtensionEvent(request.session, "agent_start", { prompt: request.prompt }),
  );
}

async function executeProviderRequestImpl(
  request: ProviderRequest,
  invokers: CodexInvokers = { exec: invokeCodexExecTransport, http: invokeCodexHttpTransport, codexHttp: invokeCodexChatGptHttpTransport },
  turnRun: TurnRun,
  onToolResult?: (call: InternalToolCall, result: InternalToolResult) => void,
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

  const modelFailure = createUnavailableModelFailure(request.session, provider, model, transport);
  if (modelFailure) {
    return modelFailure;
  }

  const attachmentFailure = validateAttachmentSupport(request, transport);
  if (attachmentFailure) {
    return attachmentFailure;
  }

  return withSentryAiAgentSpan(
    "nexagent provider turn",
    {
      "gen_ai.agent.name": "nexagent",
      "gen_ai.request.model": model,
      "nexagent.provider": provider,
      "nexagent.transport": request.session.providerTransport.mode,
      "nexagent.adapter": transport.id,
    },
    async (agentSpan) => {
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
    const extensionMessages = await collectExtensionSystemMessages(request.session, request.prompt);
    if (extensionMessages.length > 0) {
      assembled.prompt = `${assembled.prompt}\n\nExtension guidance:\n${extensionMessages.map((message) => `- ${message}`).join("\n")}`;
    }
    if (request.session.debug) {
      writeDebugLog(request.session.debug, "provider.assembled_prompt", {
        provider,
        model,
        transport: request.session.providerTransport.mode,
        prompt: assembled.prompt,
      }, { verboseOnly: true });
    }
    if (request.session.providerTransport.mode === "http-responses") {
      return executeOpenAiNativeToolLoop(request, assembled.prompt, model, transport, invokers.http, turnRun, onToolResult);
    }
    const invokeCodex = request.session.providerTransport.mode === "codex-http"
      ? invokers.codexHttp
      : invokers.exec;
    const codexHttpInput = request.session.providerTransport.mode === "codex-http"
      ? buildNativeInputFromPrompt(request.prompt, request.attachments)
      : undefined;
    const obligations = turnRun.getObligations();
    const toolTranscript: string[] = [];
    if (obligations.requiresNexsightEvidence) {
      const preflight = await runRequiredNexsightPreflight(request, request.prompt, executeToolWithRuntimeActivity);
      toolTranscript.push(formatInternalToolExchange(0, preflight.call, preflight.result));
    }
    let prompt = obligations.requiresNexsightEvidence && toolTranscript.length > 0
      ? createRequiredNexsightPreflightPrompt(assembled.prompt, toolTranscript)
      : assembled.prompt;
    let guidanceNudgeCount = 0;
    let writeEvidenceNudgeCount = 0;
    const requiredEvidenceNudgeCounts: RequiredEvidenceNudgeState = {};
    let requiredNexsightFallbackCount = 0;

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
      const invocation = await invokeProviderWithSentrySpan(
        request,
        invokeCodex,
        model,
        transport.id,
        "provider step",
        prompt,
        (signal) => request.session.providerTransport.mode === "codex-http"
          ? { ...request, prompt: request.prompt, instructions: prompt, nativeInput: codexHttpInput, abortSignal: signal }
          : { ...request, prompt, abortSignal: signal },
      );
      if (request.session.debug) {
        writeDebugLog(request.session.debug, "provider.invocation", {
          cycle,
          step,
          adapter: transport.id,
          input: prompt,
          output: invocation.output,
          exitCode: invocation.exitCode,
        }, { verboseOnly: true });
      }
      turnRun.onProviderStep(step + 1, invocation.metrics);

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
          guidanceNudgeCount += 1;
          const earlyFinal = await maybeSynthesizeAfterRepeatedGuidance(
            request,
            invokeCodex,
            model,
            transport.id,
            codexHttpInput,
            assembled.prompt,
            toolTranscript,
            guidanceNudgeCount,
            turnEventStart,
            turnRun,
            "malformed tool call",
          );
          if (earlyFinal) {
            return earlyFinal;
          }
          recordRuntimeEvent(request.session, {
            kind: "control",
            status: "queued",
            summary: "malformed tool call nudge applied",
            detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
          });
          recordRuntimeDiagnostic(request.session, {
            class: "provider.malformed_tool_call",
            attributes: {
              provider,
              transport: request.session.providerTransport.mode,
              model: model ?? "default",
              adapter: transport.id,
              loop: "cli",
              cycle: cycle + 1,
              step: step + 1,
              ...classifyToolCallMarkup(output),
            },
          });
          prompt = createPromptWithToolTranscript(assembled.prompt, toolTranscript, PROVIDER_NUDGES.malformedToolCall);
          continue;
        }
        const missingRequiredEvidence = turnRun.evaluateRequiredEvidence(turnEventStart, toolTranscript, output);
        if (missingRequiredEvidence) {
          if (missingRequiredEvidence === "ask user") {
            const fallbackAsk = maybeCreateFallbackAskQuestion(request, model, transport.transport, transport.id, output);
            if (fallbackAsk) {
              return fallbackAsk;
            }
          }
          const recovery = await createRequiredEvidenceRecovery({
            request,
            model,
            transport: transport.transport,
            adapter: transport.id,
            missing: missingRequiredEvidence,
            output,
            basePrompt: assembled.prompt,
            toolTranscript,
            step,
            nudgeCounts: requiredEvidenceNudgeCounts,
            runNexsightFallback: requiredNexsightFallbackCount < 1,
          });
          if (recovery.kind === "retry") {
            if (recovery.usedFallback) {
              requiredNexsightFallbackCount += 1;
            }
            prompt = recovery.prompt;
            continue;
          }
          if (recovery.kind === "fallback-success") {
            return recovery.result;
          }
          return recovery.result;
        }
        if (claimsUnsupportedWriteCompletion(output, writeEvidenceNudgeCount) && !hasWriteEvidence(request.session, turnEventStart)) {
          writeEvidenceNudgeCount += 1;
          if (step < MAX_INTERNAL_TOOL_STEPS - 1 && writeEvidenceNudgeCount < MAX_GUIDANCE_NUDGES_BEFORE_SYNTHESIS) {
            recordRuntimeEvent(request.session, {
              kind: "control",
              status: "queued",
              summary: "write evidence nudge applied",
              detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
            });
            prompt = createPromptWithToolTranscript(assembled.prompt, toolTranscript, PROVIDER_NUDGES.writeEvidence);
            continue;
          }
          return createMissingWriteEvidenceFailure(request, model, transport.transport, transport.id, output);
        }
        const missingClaimEvidence = turnRun.evaluateFinalEvidence(turnEventStart, toolTranscript, output);
        if (missingClaimEvidence) {
          guidanceNudgeCount += 1;
          if (step < MAX_INTERNAL_TOOL_STEPS - 1 && guidanceNudgeCount < MAX_GUIDANCE_NUDGES_BEFORE_SYNTHESIS) {
            recordRuntimeEvent(request.session, {
              kind: "control",
              status: "queued",
              summary: "claim evidence nudge applied",
              detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
            });
            prompt = createPromptWithToolTranscript(assembled.prompt, toolTranscript, PROVIDER_NUDGES.requiredClaimEvidence);
            continue;
          }
          return createMissingRequiredToolEvidenceFailure(request, model, transport.transport, transport.id, missingClaimEvidence, output);
        }
        if (isNonActionableDeferral(output) && step < MAX_INTERNAL_TOOL_STEPS - 1) {
          guidanceNudgeCount += 1;
          const earlyFinal = await maybeSynthesizeAfterRepeatedGuidance(
            request,
            invokeCodex,
            model,
            transport.id,
            codexHttpInput,
            assembled.prompt,
            toolTranscript,
            guidanceNudgeCount,
            turnEventStart,
            turnRun,
            "non-actionable deferral",
          );
          if (earlyFinal) {
            return earlyFinal;
          }
          recordRuntimeEvent(request.session, {
            kind: "control",
            status: "queued",
            summary: "continuation nudge applied",
            detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
          });
          prompt = createPromptWithToolTranscript(assembled.prompt, toolTranscript, PROVIDER_NUDGES.continuation);
          continue;
        }
        recordRuntimeEvent(request.session, {
          kind: "assistant",
          status: "completed",
          summary: "assistant response completed",
          detail: output,
        });
          recordRuntimeEvent(request.session, {
            kind: "provider",
            status: "completed",
            summary: `${provider} turn completed`,
            detail: `transport=${request.session.providerTransport.mode}; output_chars=${String(output.length)}`,
          });
          setSentrySpanAttributes(agentSpan, {
            "gen_ai.response.output_chars": output.length,
            "nexagent.turn.status": "completed",
          });
          logSentryInfo("provider turn completed", {
            provider,
            model: model ?? "default",
            transport: request.session.providerTransport.mode,
            output_chars: output.length,
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
          status: "queued",
          summary: "tool budget final synthesis requested",
          detail: toolCall.name,
        });
        const finalPrompt = createToolBudgetFinalPrompt(assembled.prompt, toolTranscript, toolCall.name);
        const finalInvocation = await invokeProviderWithSentrySpan(
          request,
          invokeCodex,
          model,
          transport.id,
          "final synthesis",
          finalPrompt,
          (signal) => request.session.providerTransport.mode === "codex-http"
            ? { ...request, prompt: request.prompt, instructions: finalPrompt, nativeInput: codexHttpInput, abortSignal: signal }
            : { ...request, prompt: finalPrompt, abortSignal: signal },
        );
        if (request.session.debug) {
          writeDebugLog(request.session.debug, "provider.final_invocation", {
            adapter: transport.id,
            input: finalPrompt,
            output: finalInvocation.output,
            exitCode: finalInvocation.exitCode,
          }, { verboseOnly: true });
        }
        if (finalInvocation.exitCode !== 0) {
          return createCodexFailure(provider, model, finalInvocation.stderr, finalInvocation.stdout, transport.id);
        }
        const finalOutput = finalInvocation.output.trimEnd();
        if (finalOutput.length > 0 && !parseInternalToolCall(finalOutput) && !containsToolCallMarkup(finalOutput)) {
          const missingObligation = createMissingRequiredEvidenceFailureIfAny(
            request,
            model,
            transport.transport,
            transport.id,
            turnRun,
            turnEventStart,
            toolTranscript,
            finalOutput,
          );
          if (missingObligation) {
            return missingObligation;
          }
          if (claimsFileMutation(finalOutput) && !hasWriteEvidence(request.session, turnEventStart)) {
            return createMissingWriteEvidenceFailure(request, model, transport.transport, transport.id, finalOutput);
          }
          recordRuntimeEvent(request.session, {
            kind: "assistant",
            status: "completed",
            summary: "assistant response completed",
            detail: finalOutput,
          });
          recordRuntimeEvent(request.session, {
            kind: "provider",
            status: "completed",
            summary: `${provider} turn completed`,
            detail: `transport=${request.session.providerTransport.mode}; output_chars=${String(finalOutput.length)}`,
          });
          setSentrySpanAttributes(agentSpan, {
            "gen_ai.response.output_chars": finalOutput.length,
            "nexagent.turn.status": "completed",
          });
          logSentryInfo("provider turn completed", {
            provider,
            model: model ?? "default",
            transport: request.session.providerTransport.mode,
            output_chars: finalOutput.length,
          });
          return {
            ok: true,
            provider,
            model,
            transport: transport.transport,
            adapter: transport.id,
            fallbackApplied: false,
            output: finalOutput,
          };
        }
        recordRuntimeEvent(request.session, {
          kind: "control",
          status: "completed",
          summary: "tool budget fallback returned partial result",
          detail: toolCall.name,
        });
        return createToolBudgetPartialResult(
          request.session,
          provider,
          model,
          transport.transport,
          transport.id,
          toolTranscript,
          `Blocked another ${toolCall.name} call because this turn reached the internal tool budget.`,
        );
      }

      if (shouldRouteToNexsightOnly(request.prompt, toolCall) && !isNexsightToolCall(toolCall) && step < MAX_INTERNAL_TOOL_STEPS - 1) {
        guidanceNudgeCount += 1;
        const earlyFinal = await maybeSynthesizeAfterRepeatedGuidance(
          request,
          invokeCodex,
          model,
          transport.id,
          codexHttpInput,
          assembled.prompt,
          toolTranscript,
          guidanceNudgeCount,
          turnEventStart,
          turnRun,
          "nexsight routing",
        );
        if (earlyFinal) {
          return earlyFinal;
        }
        recordRuntimeEvent(request.session, {
          kind: "control",
          status: "queued",
          summary: "nexsight tool nudge applied",
          detail: toolCall.name,
        });
        prompt = createPromptWithToolTranscript(assembled.prompt, toolTranscript, PROVIDER_NUDGES.nexsightTool);
        continue;
      }

      const toolResult = await withSentryAiToolSpan(toolCall.name, async (toolSpan) => {
        turnRun.onToolStep(toolCall.name);
        const result = await executeToolWithRuntimeActivity(request.session, toolCall);
        setSentrySpanAttributes(toolSpan, {
          "gen_ai.tool.name": toolCall.name,
          "nexagent.tool.status": result.ok ? "completed" : "failed",
        });
        return result;
      });
      toolTranscript.push(formatInternalToolExchange(step + 1, toolCall, toolResult));
      onToolResult?.(toolCall, toolResult);
      const finalStepNudge = step === MAX_INTERNAL_TOOL_STEPS - 2 ? `\n\n${PROVIDER_NUDGES.finalToolStep}` : "";
      prompt = createPromptWithToolTranscript(
        assembled.prompt,
        toolTranscript,
        `Continue. Either answer user directly or request one more tool with one <nexagent_tool_call> block only.${finalStepNudge}`,
      );
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
    setSentrySpanAttributes(agentSpan, {
      "nexagent.turn.status": "failed",
      "nexagent.error": detail,
    });
    logSentryError("provider turn failed", {
      provider,
      model: model ?? "default",
      transport: request.session.providerTransport.mode,
      error: detail,
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
    },
  );
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

async function invokeProviderWithSentrySpan(
  request: ProviderRequest,
  invoker: CodexInvoker,
  model: string | null,
  adapter: ProviderSuccess["adapter"],
  phase: string,
  promptForOptionalCapture: string,
  createRequest: (signal: AbortSignal) => ProviderRequest,
): Promise<CodexInvocation> {
  return withSentryAiRequestSpan(
    `LLM request ${model ?? "default"}`,
    {
      "gen_ai.request.model": model ?? "default",
      "nexagent.provider": request.session.provider,
      "nexagent.transport": request.session.providerTransport.mode,
      "nexagent.adapter": adapter,
      "nexagent.phase": phase,
    },
    async (span) => {
      if (shouldRecordSentryAiContent()) {
        setSentrySpanAttributes(span, {
          "gen_ai.request.messages": promptForOptionalCapture.slice(0, 8000),
        });
      }

      const startedAt = Date.now();
      const invocation = await withAbortController(
        request.session,
        (signal) => invoker(createRequest(signal), model),
      );
      const durationMs = Date.now() - startedAt;
      const usage = extractGenAiUsage(invocation.raw);
      const inputTokens = usage["gen_ai.usage.input_tokens"] || estimateTokenCount(promptForOptionalCapture);
      const outputTokens = usage["gen_ai.usage.output_tokens"] || estimateTokenCount(invocation.output);
      invocation.metrics = { inputTokens, outputTokens, durationMs };
      if (invocation.exitCode !== 0) {
        recordRuntimeDiagnostic(request.session, {
          class: "provider.transport",
          attributes: {
            provider: request.session.provider,
            transport: request.session.providerTransport.mode,
            model: model ?? "default",
            adapter,
            exit_code: invocation.exitCode,
            duration_ms: durationMs,
          },
        });
      }

      setSentrySpanAttributes(span, {
        ...usage,
        "gen_ai.response.output_chars": invocation.output.length,
        "nexagent.exit_code": invocation.exitCode,
      });
      if (shouldRecordSentryAiContent()) {
        setSentrySpanAttributes(span, {
          "gen_ai.response.text": invocation.output.slice(0, 8000),
        });
      }
      return invocation;
    },
  );
}

async function executeOpenAiNativeToolLoop(
  request: ProviderRequest,
  assembledPrompt: string,
  model: string | null,
  transport: ProviderTransportAdapter,
  invokeHttp: CodexInvoker,
  turnRun: TurnRun,
  onToolResult?: (call: InternalToolCall, result: InternalToolResult) => void,
): Promise<ProviderResult> {
  let previousResponseId: string | undefined;
  let nativeInput: unknown = buildNativeInputFromPrompt(request.prompt, request.attachments);
  const turnEventStart = request.session.events.length;
  const obligations = turnRun.getObligations();
  const toolTranscript: string[] = [];
  if (obligations.requiresNexsightEvidence) {
    const preflight = await runRequiredNexsightPreflight(request, request.prompt, executeToolWithRuntimeActivity);
    toolTranscript.push(formatInternalToolExchange(0, preflight.call, preflight.result));
    nativeInput = [{ role: "user", content: createRequiredNexsightPreflightPrompt(assembledPrompt, toolTranscript) }];
  }
  let writeEvidenceNudgeCount = 0;
  const requiredEvidenceNudgeCounts: RequiredEvidenceNudgeState = {};
  let requiredNexsightFallbackCount = 0;

  const loopResult = await turnRun.runToolLoop<ProviderResult>(1, MAX_INTERNAL_TOOL_STEPS, async ({ step, finalStep }) => {
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
    const invocation = await invokeProviderWithSentrySpan(
      request,
      invokeHttp,
      model,
      transport.id,
      "native provider step",
      assembledPrompt,
      (signal) => ({
        ...request,
        prompt: assembledPrompt,
        instructions: assembledPrompt,
        nativeInput,
        previousResponseId,
        nativeTools: true,
        abortSignal: signal,
      }),
    );
    if (request.session.debug) {
      writeDebugLog(request.session.debug, "provider.native_invocation", {
        step,
        adapter: transport.id,
        input: nativeInput,
        output: invocation.output,
        exitCode: invocation.exitCode,
      }, { verboseOnly: true });
    }
    turnRun.onProviderStep(step + 1, invocation.metrics);

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
        recordRuntimeDiagnostic(request.session, {
          class: "provider.malformed_tool_call",
          attributes: {
            provider: request.session.provider,
            transport: request.session.providerTransport.mode,
            model: model ?? "default",
            adapter: transport.id,
            loop: "native",
            step: step + 1,
            ...classifyToolCallMarkup(output),
          },
        });
        nativeInput = [{ role: "user", content: PROVIDER_NUDGES.malformedToolCall }];
        return null;
      }
      const missingRequiredEvidence = turnRun.evaluateRequiredEvidence(turnEventStart, [], output);
      if (missingRequiredEvidence) {
        if (missingRequiredEvidence === "ask user") {
          const fallbackAsk = maybeCreateFallbackAskQuestion(request, model, transport.transport, transport.id, output);
          if (fallbackAsk) {
            return fallbackAsk;
          }
        }
        const nudge = getRequiredEvidenceNudge(missingRequiredEvidence);
        const nudgeCount = incrementRequiredEvidenceNudge(requiredEvidenceNudgeCounts, missingRequiredEvidence);
        if (step < MAX_INTERNAL_TOOL_STEPS - 1 && nudgeCount < MAX_GUIDANCE_NUDGES_BEFORE_SYNTHESIS) {
          recordRequiredEvidenceNudge(request.session, nudge.summary, output);
          nativeInput = [{ role: "user", content: nudge.content }];
          return null;
        }
        if (missingRequiredEvidence === "Nexsight" && step < MAX_INTERNAL_TOOL_STEPS - 1 && requiredNexsightFallbackCount < 1) {
          requiredNexsightFallbackCount += 1;
          const fallback = await runRequiredNexsightFallback(request, request.prompt, executeToolWithRuntimeActivity);
          if (fallback.result.ok) {
            return createRequiredNexsightFallbackSuccess(
              request,
              model,
              transport.transport,
              transport.id,
              fallback.result,
            );
          }
          nativeInput = [{
            role: "user",
            content: createRequiredNexsightFallbackPrompt(
              "Continue from this harness-owned evidence.",
              [formatInternalToolExchange(step + 1, fallback.call, fallback.result)],
            ),
          }];
          return null;
        }
        return createMissingRequiredToolEvidenceFailure(request, model, transport.transport, transport.id, nudge.label, output);
      }
      if (claimsUnsupportedWriteCompletion(output, writeEvidenceNudgeCount) && !hasWriteEvidence(request.session, turnEventStart)) {
        writeEvidenceNudgeCount += 1;
        if (step < MAX_INTERNAL_TOOL_STEPS - 1 && writeEvidenceNudgeCount < MAX_GUIDANCE_NUDGES_BEFORE_SYNTHESIS) {
          recordRuntimeEvent(request.session, {
            kind: "control",
            status: "queued",
            summary: "write evidence nudge applied",
            detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
          });
          nativeInput = [{ role: "user", content: PROVIDER_NUDGES.writeEvidence }];
          return null;
        }
        return createMissingWriteEvidenceFailure(request, model, transport.transport, transport.id, output);
      }
      const missingClaimEvidence = turnRun.evaluateFinalEvidence(turnEventStart, toolTranscript, output);
      if (missingClaimEvidence) {
        if (step < MAX_INTERNAL_TOOL_STEPS - 1) {
          recordRuntimeEvent(request.session, {
            kind: "control",
            status: "queued",
            summary: "claim evidence nudge applied",
            detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
          });
          nativeInput = [{ role: "user", content: PROVIDER_NUDGES.requiredClaimEvidence }];
          return null;
        }
        return createMissingRequiredToolEvidenceFailure(request, model, transport.transport, transport.id, missingClaimEvidence, output);
      }
      if (isNonActionableDeferral(output) && step < MAX_INTERNAL_TOOL_STEPS - 1) {
        recordRuntimeEvent(request.session, {
          kind: "control",
          status: "queued",
          summary: "continuation nudge applied",
          detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
        });
        nativeInput = [{ role: "user", content: PROVIDER_NUDGES.continuation }];
          return null;
      }
      recordRuntimeEvent(request.session, {
        kind: "assistant",
        status: "completed",
        summary: "assistant response completed",
        detail: output,
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

    if (finalStep) {
      recordRuntimeEvent(request.session, {
        kind: "control",
        status: "completed",
        summary: "native tool budget fallback returned partial result",
        detail: toolCall.name,
      });
      return createToolBudgetPartialResult(
        request.session,
        request.session.provider,
        model,
        transport.transport,
        transport.id,
        [],
        `Blocked another ${toolCall.name} native tool call because this turn reached the internal tool budget.`,
      );
    }

    const toolResult = await withSentryAiToolSpan(toolCall.name, async (toolSpan) => {
      turnRun.onToolStep(toolCall.name);
      const result = await executeToolWithRuntimeActivity(request.session, {
        name: toolCall.name,
        arguments: toolCall.arguments,
      });
      setSentrySpanAttributes(toolSpan, {
        "gen_ai.tool.name": toolCall.name,
        "nexagent.tool.status": result.ok ? "completed" : "failed",
      });
      return result;
    });
    onToolResult?.(toolCall, toolResult);
    previousResponseId = toolCall.responseId;
    const steer = consumeOperatorSteer(request.session, `after tool ${toolCall.name}`);
    nativeInput = [
      {
        type: "function_call_output",
        call_id: toolCall.callId,
        output: toolResult.output,
      },
      ...(steer ? [{ role: "user", content: `Operator steer: ${steer}` }] : []),
      ...(step === MAX_INTERNAL_TOOL_STEPS - 2 ? [{ role: "user", content: PROVIDER_NUDGES.finalToolStep }] : []),
    ];
    return null;
  });

  if (loopResult) {
    return loopResult;
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

function createMissingWriteEvidenceFailure(
  request: ProviderRequest,
  model: string | null,
  transport: ProviderFailure["transport"],
  adapter: ProviderFailure["adapter"],
  output: string,
): ProviderFailure {
  const detail = output.length > 160 ? `${output.slice(0, 157)}...` : output;
  recordRuntimeEvent(request.session, {
    kind: "control",
    status: "blocked",
    summary: "write evidence gate blocked assistant response",
    detail,
  });
  recordRuntimeEvent(request.session, {
    kind: "provider",
    status: "failed",
    summary: `${request.session.provider} turn failed`,
    detail: "assistant claimed file mutation without write evidence",
  });
  recordRuntimeDiagnostic(request.session, {
    class: "provider.missing_evidence",
    attributes: {
      provider: request.session.provider,
      transport,
      model: model ?? "default",
      adapter,
      required_evidence: "write",
    },
  });
  return {
    ok: false,
    provider: request.session.provider,
    model,
    transport,
    adapter,
    fallbackApplied: false,
    code: "transport_error",
    message: "assistant claimed file mutation without write evidence",
    detail: [
      "The assistant claimed files were written or updated, but this turn recorded no completed write_file, apply_patch, or shell_command write evidence.",
      "Blocked unsupported completion so the chat cannot report fake file changes.",
      "",
      "Blocked assistant output:",
      output.slice(0, 1200),
    ].join("\n"),
  };
}

function createMissingRequiredToolEvidenceFailure(
  request: ProviderRequest,
  model: string | null,
  transport: ProviderFailure["transport"],
  adapter: ProviderFailure["adapter"],
  requiredTool: MissingTurnEvidence,
  output: string,
): ProviderFailure {
  const detail = output.length > 160 ? `${output.slice(0, 157)}...` : output;
    const summary = requiredTool === "write"
    ? "required write evidence gate blocked assistant response"
    : requiredTool === "Nexsight"
      ? "required nexsight evidence gate blocked assistant response"
      : requiredTool === "active skill"
        ? "required active skill evidence gate blocked assistant response"
        : requiredTool === "todo"
          ? "required todo evidence gate blocked assistant response"
          : requiredTool === "ask user"
            ? "required ask_user_question evidence gate blocked assistant response"
            : "required test evidence gate blocked assistant response";
  recordRuntimeEvent(request.session, {
    kind: "control",
    status: "blocked",
    summary,
    detail,
  });
  recordRuntimeEvent(request.session, {
    kind: "provider",
    status: "failed",
    summary: `${request.session.provider} turn failed`,
    detail: `assistant completed without required ${requiredTool} evidence`,
  });
  recordRuntimeDiagnostic(request.session, {
    class: "provider.missing_evidence",
    attributes: {
      provider: request.session.provider,
      transport,
      model: model ?? "default",
      adapter,
      required_evidence: requiredTool,
    },
  });
  return {
    ok: false,
    provider: request.session.provider,
    model,
    transport,
    adapter,
    fallbackApplied: false,
    code: "transport_error",
    message: `assistant completed without required ${requiredTool} evidence`,
    detail: [
      `The user request requires current-turn ${requiredTool} tool evidence, but the turn recorded none before the assistant tried to finish.`,
      "Blocked unsupported completion so the chat cannot report ungrounded task completion.",
      "",
      "Blocked assistant output:",
      output.slice(0, 1200),
    ].join("\n"),
  };
}

function maybeCreateFallbackAskQuestion(
  request: ProviderRequest,
  model: string | null,
  transport: ProviderFailure["transport"],
  adapter: ProviderFailure["adapter"],
  output: string,
): ProviderSuccess | null {
  if (request.session.operationControls.pendingQuestionnaire) {
    return null;
  }
  if (!claimsInteractiveDiscussionGate(output)) {
    return null;
  }
  const question = createFallbackDiscussionQuestion(output);
  request.session.operationControls.pendingQuestionnaire = createQuestionnaireRequest([question]);
  recordRuntimeEvent(request.session, {
    kind: "control",
    status: "blocked",
    summary: "fallback ask_user_question created",
    detail: question.question,
  });
  return {
    ok: true,
    provider: request.session.provider,
    model,
    transport,
    adapter,
    fallbackApplied: false,
    output: [
      "ask_user_question pending.",
      question.question,
      ...question.options.map((option, index) => `${String(index + 1)}. ${option.label} - ${option.description}`),
    ].join("\n"),
  };
}

function hasDiscussionDecisionEvidence(session: RuntimeSession, sinceIndex: number, output: string): boolean {
  if (!hasWriteEvidence(session, sinceIndex)) {
    return false;
  }
  return /\b(?:locked|captured|recorded|wrote|saved)\b[\s\S]{0,80}\b(?:decision|decisions|choice|choices|context)\b/i.test(output)
    || /\bno more user[- ]choice\b/i.test(output)
    || /\bdiscussion phase\b[\s\S]{0,80}\b(?:ready|complete|context-ready)\b/i.test(output);
}

function claimsInteractiveDiscussionGate(output: string): boolean {
  return /\b(required interactive discussion gate|interactive discussion gate|needs? you to choose|choose whether|choose what to discuss|question is required)\b/i.test(output);
}

function createFallbackDiscussionQuestion(output: string): RuntimeQuestionnaireQuestion {
  const questionLine = output
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => /\bchoose\b/i.test(line))
    ?? "Which direction should this discussion phase use?";
  const question = questionLine
    .replace(/^Next concrete step:\s*/i, "")
    .replace(/^Blocked(?:er)?:\s*/i, "")
    .slice(0, 240);
  return {
    header: "Discuss",
    question,
    options: [
      {
        label: "Use roadmap scope (Recommended)",
        description: "Follow the milestone roadmap/title as source of truth.",
      },
      {
        label: "Use phase slug",
        description: "Follow the generated phase directory name and slug.",
      },
      {
        label: "Reconcile both first",
        description: "Inspect mismatch and create a short decision before planning.",
      },
    ],
  };
}

function createMissingRequiredEvidenceFailureIfAny(
  request: ProviderRequest,
  model: string | null,
  transport: ProviderFailure["transport"],
  adapter: ProviderFailure["adapter"],
  turnRun: TurnRun,
  turnEventStart: number,
  toolTranscript: string[],
  output: string,
): ProviderFailure | null {
  const missing = turnRun.evaluateFinalEvidence(turnEventStart, toolTranscript, output);
  return missing ? createMissingRequiredToolEvidenceFailure(request, model, transport, adapter, missing, output) : null;
}

async function createRequiredEvidenceRecovery(options: {
  request: ProviderRequest;
  model: string | null;
  transport: ProviderFailure["transport"];
  adapter: ProviderFailure["adapter"];
  missing: MissingTurnEvidence;
  output: string;
  basePrompt: string;
  toolTranscript: string[];
  step: number;
  nudgeCounts: RequiredEvidenceNudgeState;
  runNexsightFallback: boolean;
}): Promise<RequiredEvidenceRecovery> {
  const nudge = getRequiredEvidenceNudge(options.missing);
  const nudgeCount = incrementRequiredEvidenceNudge(options.nudgeCounts, options.missing);
  if (options.step < MAX_INTERNAL_TOOL_STEPS - 1 && nudgeCount < MAX_GUIDANCE_NUDGES_BEFORE_SYNTHESIS) {
    recordRequiredEvidenceNudge(options.request.session, nudge.summary, options.output);
    return {
      kind: "retry",
      prompt: createPromptWithToolTranscript(options.basePrompt, options.toolTranscript, nudge.content),
    };
  }

  if (options.missing === "Nexsight" && options.step < MAX_INTERNAL_TOOL_STEPS - 1 && options.runNexsightFallback) {
    const fallback = await runRequiredNexsightFallback(options.request, options.request.prompt, executeToolWithRuntimeActivity);
    options.toolTranscript.push(formatInternalToolExchange(options.step + 1, fallback.call, fallback.result));
    if (fallback.result.ok) {
      return {
        kind: "fallback-success",
        result: createRequiredNexsightFallbackSuccess(
          options.request,
          options.model,
          options.transport,
          options.adapter,
          fallback.result,
        ),
      };
    }
    return {
      kind: "retry",
      prompt: createRequiredNexsightFallbackPrompt(options.basePrompt, options.toolTranscript),
      usedFallback: true,
    };
  }

  return {
    kind: "blocked",
    result: createMissingRequiredToolEvidenceFailure(
      options.request,
      options.model,
      options.transport,
      options.adapter,
      nudge.label,
      options.output,
    ),
  };
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

async function collectExtensionSystemMessages(session: RuntimeSession, prompt: string): Promise<string[]> {
  const results = await emitRuntimeExtensionEvent(session, "before_agent_start", { prompt });
  const messages: string[] = [];
  for (const result of results) {
    if (!result || typeof result !== "object") {
      continue;
    }
    const candidate = result as { message?: unknown };
    const message = candidate.message;
    if (typeof message === "string") {
      messages.push(message);
      continue;
    }
    if (message && typeof message === "object" && typeof (message as { content?: unknown }).content === "string") {
      messages.push((message as { content: string }).content);
      continue;
    }
    if (typeof (result as { systemPrompt?: unknown }).systemPrompt === "string") {
      messages.push((result as { systemPrompt: string }).systemPrompt);
    }
  }
  return messages;
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
  const argumentFailure = validateInternalToolArguments(call);
  if (argumentFailure) {
    recordRuntimeEvent(session, {
      kind: "tool",
      status: "failed",
      summary: `tool ${call.name} rejected invalid arguments`,
      detail: argumentFailure.output,
    });
    return argumentFailure;
  }

  const risk = classifyInternalToolRisk(call);
  const argsPreview = formatToolArgumentsPreview(call.arguments);
  const startedAt = Date.now();
  recordRuntimeEvent(session, {
    kind: "tool",
    status: "started",
    summary: `tool ${call.name} started`,
    detail: `${risk}; args=${argsPreview}`,
  });
  const extensionApprovals = await emitRuntimeExtensionEvent(session, "before_tool_execution", { tool: call.name, call });
  if (extensionApprovals.some((value) => value === false)) {
    recordRuntimeEvent(session, {
      kind: "tool",
      status: "blocked",
      summary: `tool ${call.name} blocked by extension`,
      detail: "extension before_tool_execution returned false",
    });
    return {
      ok: false,
      tool: call.name,
      output: "tool execution blocked by extension",
    };
  }
  const approved = await maybeAwaitApproval(session, call, risk);
  if (!approved) {
    recordRuntimeEvent(session, {
      kind: "tool",
      status: session.operationControls.lastDecision === "canceled" ? "canceled" : "blocked",
      summary: `tool ${call.name} not executed`,
      detail: risk,
    });
    recordRuntimeDiagnostic(session, {
      class: "tool.blocked",
      attributes: {
        tool_name: call.name,
        risk,
        approval_state: session.operationControls.lastDecision ?? "pending",
        blocked_reason: session.operationControls.lastDecision === "canceled" ? "canceled" : "approval_rejected",
      },
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
  const inputTokens = estimateTokenCount(JSON.stringify({ name: call.name, arguments: call.arguments }));
  const outputTokens = estimateTokenCount(result.output);
  const transcriptOutput = formatToolTranscriptOutput(call.name, result);
  const detailOutput = transcriptOutput ? transcriptOutput : `; output=${outputPreview}`;
  recordRuntimeEvent(session, {
    kind: "tool",
    status: result.ok ? "completed" : "failed",
    summary: `tool ${call.name} ${result.ok ? "completed" : "failed"}`,
    detail: `${risk}; duration=${formatToolDuration(durationMs)}; in~${inputTokens}; out~${outputTokens}${detailOutput}`,
  });
  recordToolMemory(session.toolMemory, call, result);
  savePersistedRuntimeState(session);
  await emitRuntimeExtensionEvent(session, "tool_result", { tool: call.name, call, result, durationMs });
  if (!result.ok) {
    const failureClass = classifyToolFailure(result.output);
    recordRuntimeDiagnostic(session, createToolFailureDiagnosticInput({
      session,
      call,
      risk,
      failureClass,
      output: result.output,
      durationMs,
      inputTokens,
      outputTokens,
    }));
    await rememberToolFailure(session, call.name, result.output, failureClass);
  } else {
    await rememberToolRecoveryIfPresent(session, call.name);
  }
  return result;
}

async function rememberToolFailure(session: RuntimeSession, toolName: string, output: string, failureClass: string): Promise<void> {
  try {
    await rememberArchivistFailure(session, {
      toolName,
      failureClass,
      message: output,
    });
  } catch {
    // Failure memory is best-effort and must not change tool behavior.
  }
}

async function rememberToolRecoveryIfPresent(session: RuntimeSession, toolName: string): Promise<void> {
  try {
    const priorFailure = [...session.events]
      .reverse()
      .find((event) => event.kind === "tool" && event.status === "failed" && event.summary === `tool ${toolName} failed`);
    if (!priorFailure) {
      return;
    }
    await rememberArchivistRecovery(session, {
      toolName,
      priorFailure: priorFailure.detail ?? priorFailure.summary,
      recovery: "Same tool completed after a previous failure. Prefer the successful argument shape and bounded output path next time.",
    });
  } catch {
    // Recovery memory is best-effort and must not change tool behavior.
  }
}

function recordRuntimeDiagnostic(session: RuntimeSession, input: RuntimeDiagnosticInput): void {
  const event = captureSentryDiagnostic(input, { sendEvent: false });
  if (event.severity === "error") {
    captureSentryDiagnostic(event, { sendEvent: true });
  }
  if (event.severity === "error") {
    logSentryError(event.summary, event.attributes);
  }
  recordRuntimeEvent(session, toDiagnosticRuntimeEvent(event));
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
  const match = output.match(JSON_BODY_TOOL_CALL_PATTERN);
  if (match) {
    const parsed = parseToolCallJson(match[1] ?? "");
    if (parsed && typeof parsed.name === "string") {
      return parsed;
    }
  }

  return parseAttributeStyleToolCall(output) ?? parseBareInternalToolTag(output);
}

function parseToolCallJson(value: string): InternalToolCall | null {
  const trimmed = value.trim();
  for (const candidate of [trimmed, escapeControlCharsInJsonStrings(trimmed)]) {
    try {
      const parsed = JSON.parse(candidate) as InternalToolCall;
      if (!parsed || typeof parsed !== "object") {
        return null;
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

function classifyToolCallMarkup(output: string): Record<string, string | number | boolean> {
  const toolCallMatches = output.match(/<\s*(?:nexagent_)?tool_call\b/gi) ?? [];
  const firstBlock = output.match(/<\s*(nexagent_)?tool_call\b([^>]*)>([\s\S]*?)<\/\s*(?:nexagent_)?tool_call\s*>/i);
  const attributes = firstBlock?.[2] ?? "";
  const body = firstBlock?.[3]?.trim() ?? "";
  const generic = firstBlock ? !firstBlock[1] : /<\s*tool_call\b/i.test(output);
  const hasNameAttribute = Boolean(readXmlAttribute(attributes, "name"));
  const hasArgumentsAttribute = Boolean(readXmlAttribute(attributes, "arguments"));
  const bodyLooksJson = body.startsWith("{") || body.startsWith("[");
  const bodyHasName = /"name"\s*:/.test(body);
  const hasArgumentChildren = /<\s*arg\b/i.test(body);
  const parsedJson = bodyLooksJson ? parseToolCallJson(body) : null;
  const parseFailure = parsedJson && typeof parsedJson.name === "string"
    ? "none"
    : bodyLooksJson
      ? bodyHasName ? "json_body_invalid" : "json_body_missing_name"
      : hasNameAttribute
        ? "attribute_body_invalid"
        : "missing_tool_name";

  return {
    markup_family: generic ? "generic_tool_call" : "nexagent_tool_call",
    block_count: toolCallMatches.length,
    adjacent_blocks: toolCallMatches.length > 1,
    has_name_attribute: hasNameAttribute,
    has_arguments_attribute: hasArgumentsAttribute,
    has_argument_children: hasArgumentChildren,
    body_kind: bodyLooksJson ? "json" : body.length > 0 ? "text" : "empty",
    body_has_name: bodyHasName,
    parse_failure: parseFailure,
  };
}

function parseAttributeStyleToolCall(output: string): InternalToolCall | null {
  const match = output.match(/<(?:nexagent_)?tool_call\b([^>]*)>([\s\S]*?)<\/(?:nexagent_)?tool_call>/i);
  if (!match) {
    return null;
  }

  const attributes = match[1] ?? "";
  const body = match[2] ?? "";
  const name = readXmlAttribute(attributes, "name");
  if (!name) {
    return null;
  }

  const childArguments = parseArgumentChildren(body);
  const rawArguments = readXmlAttribute(attributes, "arguments") ?? extractJsonAfterToken(output, "arguments");
  const parsedArguments = rawArguments ? parseToolArguments(rawArguments) : childArguments ?? {};
  if (!parsedArguments) {
    return null;
  }

  return {
    name: name as InternalToolCall["name"],
    arguments: parsedArguments,
  };
}

function parseBareInternalToolTag(output: string): InternalToolCall | null {
  const paired = output.match(new RegExp(`<(${INTERNAL_TOOL_TAG_PATTERN})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, "i"));
  const selfClosing = output.match(new RegExp(`<(${INTERNAL_TOOL_TAG_PATTERN})\\b([^>]*)\\/>`, "i"));
  const match = paired ?? selfClosing;
  if (!match) {
    return null;
  }
  const name = match[1] as InternalToolCall["name"] | undefined;
  if (!name) {
    return null;
  }
  const attributes = parseXmlAttributes(match[2] ?? "");
  const body = (match[3] ?? "").trim();
  if (body.length > 0 && attributes.content === undefined && attributes.code === undefined) {
    attributes.content = decodeXmlAttribute(body);
  }
  return {
    name,
    arguments: attributes,
  };
}

function parseArgumentChildren(body: string): Record<string, unknown> | null {
  const args: Record<string, unknown> = {};
  const pattern = /<(?:argument|arg)\b([^>]*)>([\s\S]*?)<\/(?:argument|arg)>/gi;
  let matched = false;
  for (const match of body.matchAll(pattern)) {
    const name = readXmlAttribute(match[1] ?? "", "name");
    if (!name) {
      continue;
    }
    matched = true;
    args[name] = decodeXmlAttribute((match[2] ?? "").trim());
  }
  return matched ? args : null;
}

function parseXmlAttributes(attributes: string): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  const pattern = /\b([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of attributes.matchAll(pattern)) {
    const key = match[1];
    if (!key || key === "name") {
      continue;
    }
    parsed[key] = decodeXmlAttribute(match[2] ?? match[3] ?? "");
  }
  return parsed;
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

function createToolBudgetContinuationPrompt(basePrompt: string, toolTranscript: string[], pendingToolName: string, cycleNumber: number): string {
  return [
    basePrompt,
    "",
    formatToolTranscriptSection(toolTranscript, 4),
    "",
    `Tool budget continuation cycle ${String(cycleNumber)} started.`,
    `The previous provider step attempted another ${pendingToolName} tool call at the tool budget boundary.`,
    "The harness legally reset the per-cycle tool counter for one bounded continuation cycle.",
    "Continue from the existing evidence. Prefer answering now; use tools only for the smallest missing fact.",
  ].join("\n");
}

async function maybeSynthesizeAfterRepeatedGuidance(
  request: ProviderRequest,
  invokeCodex: CodexInvoker,
  model: string | null,
  adapter: ProviderFailure["adapter"],
  codexHttpInput: ReturnType<typeof buildNativeInputFromPrompt> | undefined,
  basePrompt: string,
  toolTranscript: string[],
  guidanceNudgeCount: number,
  turnEventStart: number,
  turnRun: TurnRun,
  reason: string,
): Promise<ProviderResult | null> {
  if (toolTranscript.length === 0 || guidanceNudgeCount < MAX_GUIDANCE_NUDGES_BEFORE_SYNTHESIS) {
    return null;
  }

  recordRuntimeEvent(request.session, {
    kind: "control",
    status: "queued",
    summary: "guidance loop final synthesis requested",
    detail: reason,
  });
  const finalPrompt = createGuidanceLoopFinalPrompt(basePrompt, toolTranscript, reason);
  const finalInvocation = await withAbortController(
    request.session,
    (signal) => invokeCodex(
      request.session.providerTransport.mode === "codex-http"
        ? { ...request, prompt: request.prompt, instructions: finalPrompt, nativeInput: codexHttpInput, abortSignal: signal }
        : { ...request, prompt: finalPrompt, abortSignal: signal },
      model,
    ),
  );
  if (finalInvocation.exitCode !== 0) {
    return createCodexFailure(request.session.provider, model, finalInvocation.stderr, finalInvocation.stdout, adapter);
  }

  const finalOutput = finalInvocation.output.trimEnd();
  if (finalOutput.length === 0) {
    return createEmptyOutputFailure(request.session.provider, model, adapter);
  }
  if (parseInternalToolCall(finalOutput) || containsToolCallMarkup(finalOutput)) {
    recordRuntimeEvent(request.session, {
      kind: "control",
      status: "completed",
      summary: "guidance loop fallback returned partial result",
      detail: reason,
    });
    return createToolBudgetPartialResult(
      request.session,
      request.session.provider,
      model,
      request.session.provider === "openai" ? "openai" : "codex",
      adapter,
      toolTranscript,
      `Blocked another tool call after repeated harness guidance (${reason}).`,
    );
  }
  if (isNonActionableDeferral(finalOutput)) {
    recordRuntimeEvent(request.session, {
      kind: "control",
      status: "completed",
      summary: "guidance loop fallback returned partial result",
      detail: `${reason}; final output deferred action`,
    });
    return createToolBudgetPartialResult(
      request.session,
      request.session.provider,
      model,
      request.session.provider === "openai" ? "openai" : "codex",
      adapter,
      toolTranscript,
      `Blocked non-actionable final response after repeated harness guidance (${reason}).`,
    );
  }
  if (claimsFileMutation(finalOutput) && !hasWriteEvidence(request.session, turnEventStart)) {
    return createMissingWriteEvidenceFailure(
      request,
      model,
      request.session.provider === "openai" ? "openai" : "codex",
      adapter,
      finalOutput,
    );
  }
  const missingObligation = createMissingRequiredEvidenceFailureIfAny(
    request,
    model,
    request.session.provider === "openai" ? "openai" : "codex",
    adapter,
    turnRun,
    turnEventStart,
    toolTranscript,
    finalOutput,
  );
  if (missingObligation) {
    return missingObligation;
  }

  recordRuntimeEvent(request.session, {
    kind: "assistant",
    status: "completed",
    summary: "assistant response completed",
    detail: finalOutput,
  });
  recordRuntimeEvent(request.session, {
    kind: "provider",
    status: "completed",
    summary: `${request.session.provider} turn completed`,
    detail: `transport=${request.session.providerTransport.mode}; output_chars=${String(finalOutput.length)}`,
  });
  return {
    ok: true,
    provider: request.session.provider,
    model,
    transport: request.session.provider === "openai" ? "openai" : "codex",
    adapter,
    fallbackApplied: false,
    output: finalOutput,
  };
}

function createGuidanceLoopFinalPrompt(basePrompt: string, toolTranscript: string[], reason: string): string {
  return [
    basePrompt,
    "",
    formatToolTranscriptSection(toolTranscript, 6),
    "",
    `The harness already corrected provider behavior for ${reason}, but the provider attempted another misrouted/deferred step.`,
    "Do not call more tools.",
    "Return a concise final answer using only completed tool evidence.",
    FINAL_EDIT_SUMMARY_GUIDANCE,
    "If evidence is incomplete, say what completed, what remains blocked, and the next concrete step.",
  ].join("\n");
}

function createToolBudgetFinalPrompt(basePrompt: string, toolTranscript: string[], pendingToolName: string): string {
  return [
    basePrompt,
    "",
    formatToolTranscriptSection(toolTranscript, 6),
    "",
    `The previous provider step attempted another ${pendingToolName} tool call after the bounded continuation cycle.`,
    "Do not call more tools.",
    "Return a concise final answer for the user using only the completed tool evidence.",
    "Do not describe the runtime response/tool boundary as a blocker when the requested work completed; report completion and the next concrete workflow step instead.",
    FINAL_EDIT_SUMMARY_GUIDANCE,
    "If evidence is incomplete, say exactly what completed, what remains blocked, and the next concrete step.",
  ].join("\n");
}

function createToolBudgetPartialResult(
  session: RuntimeSession,
  provider: string,
  model: string | null,
  transport: "codex" | "openai",
  adapter: ProviderSuccess["adapter"],
  toolTranscript: string[],
  reason: string,
): ProviderSuccess {
  const transcript = toolTranscript.length > 0
    ? compactToolTranscriptEntries(toolTranscript, 3).join("\n\n")
    : "No completed tool transcript was available for this fallback.";
  const output = [
    "Tool budget exhausted before final assistant answer.",
    reason,
    "",
    "Partial evidence from completed tools:",
    transcript,
  ].join("\n");
  recordRuntimeEvent(session, {
    kind: "assistant",
    status: "completed",
    summary: "assistant partial result completed",
    detail: output,
  });
  return {
    ok: true,
    provider,
    model,
    transport,
    adapter,
    fallbackApplied: false,
    output,
  };
}

function isNonActionableDeferral(output: string): boolean {
  const text = output.trim();
  if (!text) {
    return false;
  }

  if (JSON_BODY_TOOL_CALL_PATTERN.test(text) || TOOL_CALL_MARKUP_PATTERN.test(text) || /^(done|complete|completed|fixed|updated|implemented)\b/i.test(text)) {
    return false;
  }

  const lower = text.toLowerCase();
  const activationOnly = /^(started|starting|activated|all set|ready|on it|running now)[.!]?\s*$/i.test(text)
    || /^(started|starting now|activated|all set|ready)\b/i.test(text);
  const asksForUserToContinue = [
    "if you want, i can",
    "if you'd like, i can",
    "i can proceed",
    "i can do that now",
    "please say",
    "please run this",
    "run this and",
    "you can run",
    "you should run",
    "reply with",
    "say \"",
    "say '",
    "say “",
    "say ‘",
    "send:",
    "tell me to",
    "want me to",
    "should i",
    "your move",
  ].some((phrase) => lower.includes(phrase));
  const admitsNoAction = [
    "i'll do",
    "i will do",
    "i'll execute",
    "i will execute",
    "i'm ready to execute",
    "i am ready to execute",
    "i need one concrete",
    "i need the exact target",
    "i need exact target",
    "need the exact target",
    "give me the exact task",
    "throw me the exact task",
    "paste the last concrete request",
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
  const selfCorrectionOnly = [
    "you're right",
    "you are right",
    "fair callout",
    "my bad",
    "that miss is on me",
    "i should have",
    "i should've",
    "i'll follow",
    "i will follow",
    "going forward",
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

  return (activationOnly || asksForUserToContinue || admitsNoAction || selfCorrectionOnly) && !concreteCompletionEvidence;
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

function claimsUnsupportedWriteCompletion(output: string, priorWriteEvidenceNudges: number): boolean {
  if (claimsFileMutation(output)) {
    return true;
  }
  if (priorWriteEvidenceNudges <= 0) {
    return false;
  }

  const lower = output.toLowerCase();
  const fileMention = /\b(readme|\.md|\.ts|\.tsx|\.json|file|files)\b/i.test(output);
  const verificationClaim = [
    "exists",
    "verified",
    "direct read",
    "direct reads",
    "showed contents",
    "content is",
    "current exact content",
  ].some((phrase) => lower.includes(phrase));
  const correctionOrBlocker = [
    "no file change",
    "no file was",
    "did not write",
    "didn't write",
    "not written",
    "not created",
    "was not created",
    "blocked",
    "cannot",
    "can't",
  ].some((phrase) => lower.includes(phrase));

  return fileMention && verificationClaim && !correctionOrBlocker;
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
