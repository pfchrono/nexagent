import { invokeCodexChatGptHttpTransport } from "./provider/codex-chatgpt-http.js";
import { existsSync } from "node:fs";
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
import {
  recordProviderExecutionCompleted,
  recordProviderExecutionFailed,
  runProviderExecutionLifecycle,
  runProviderTurn,
} from "./provider/turn-lifecycle.js";
import {
  createRequiredNexsightFallbackPrompt,
  createRequiredNexsightFallbackSuccess,
  createRequiredNexsightPreflightPrompt,
  runRequiredNexsightFallback,
  runRequiredNexsightPreflight,
} from "./provider/nexsight-required.js";
import {
  MAX_ACTIVE_SKILL_OUTPUT_NUDGES,
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
  classifyToolCallMarkup,
  containsToolCallMarkup,
  extractModelIntent,
  parseInternalToolCall,
  parseNativeToolCall,
  stripModelIntent,
} from "./provider/model-output.js";
import {
  classifyRecoveryPolicy,
  claimsFileMutation,
  isNonActionableDeferral,
} from "./provider/recovery-policy.js";
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
import { hasToolEvidence, hasWriteEvidence } from "./runtime/evidence.js";
import { assemblePrompt } from "./runtime/instructions.js";
import {
  isNexsightToolCall,
  shouldRouteToNexsightOnly,
} from "./runtime/nexsight-router.js";
import { toDiagnosticRuntimeEvent, type RuntimeDiagnosticInput } from "./runtime/diagnostics.js";
import { emitRuntimeExtensionEvent } from "./runtime/extensions.js";
import { savePersistedRuntimeState } from "./runtime/persistence.js";
import { createQuestionnaireRequest, type RuntimeQuestionnaireQuestion } from "./runtime/questionnaire.js";
import { consumeOperatorSteer, estimateTokenCount, hasRuntimeApprovalSessionGrant, recordRuntimeEvent, setRuntimeAction, subscribeRuntimeSession } from "./runtime/session.js";
import type { RuntimeApprovalRequest, RuntimeSession } from "./runtime/session.js";
import { styleAssistantOutput } from "./runtime/style.js";
import { recordToolMemory } from "./runtime/tool-memory.js";
import { type ToolCapableTurn, type MissingTurnEvidence } from "./runtime/tool-capable-turn.js";
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
  turnRun: ToolCapableTurn,
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
    async (agentSpan) => runProviderExecutionLifecycle(
      turnRun,
      { provider, transportMode: request.session.providerTransport.mode },
      async (providerLifecycle) => {
  try {
    const turnEventStart = providerLifecycle.eventStart;
    await applyArchivistRetrieval(request.session, request.prompt);
    const assembled = await assemblePrompt(request);
    assembled.prompt = `${assembled.prompt}\n\nTurn-start intent protocol:\n- Before your first tool call or final answer, emit exactly one short model-authored intent line as <nexagent_intent>...</nexagent_intent>.\n- Keep it under 120 characters, specific to this turn, and do not use canned \"Attempting\" phrasing.\n- After that intent tag, continue normally.`;
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
    if (obligations.requiresActiveSkillEvidence) {
      const preflightCalls = createActiveSkillPreflightCalls(request.session);
      let queuedStatsCommand = false;
      for (const call of preflightCalls) {
        const result = await executeToolWithRuntimeActivity(request.session, call);
        toolTranscript.push(formatInternalToolExchange(toolTranscript.length, call, result));
        if (!queuedStatsCommand && call.name === "read_file" && /\bgsd-sdk\s+query\s+stats\.json\b/.test(result.output)) {
          queuedStatsCommand = true;
          const statsCall: InternalToolCall = { name: "shell_command", arguments: { command: "gsd-sdk query stats.json", timeoutMs: 30_000 } };
          const statsResult = await executeToolWithRuntimeActivity(request.session, statsCall);
          toolTranscript.push(formatInternalToolExchange(toolTranscript.length, statsCall, statsResult));
        }
      }
    }
    let prompt = toolTranscript.length > 0
      ? obligations.requiresNexsightEvidence
        ? createRequiredNexsightPreflightPrompt(assembled.prompt, toolTranscript)
        : createActiveSkillPreflightPrompt(assembled.prompt, toolTranscript)
      : assembled.prompt;
    let guidanceNudgeCount = 0;
    let writeEvidenceNudgeCount = 0;
    let emptyOutputEvidenceNudgeCount = 0;
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

      const intent = extractModelIntent(invocation.output);
      if (intent) {
        recordModelIntent(request.session, intent);
      }
      const output = stripModelIntent(invocation.output).trimEnd();
      if (output.length === 0) {
        if (intent && step < MAX_INTERNAL_TOOL_STEPS - 1) {
          recordRuntimeEvent(request.session, {
            kind: "control",
            status: "queued",
            summary: "intent-only response nudge applied",
            detail: intent,
          });
          prompt = createIntentOnlyContinuationPrompt(prompt, intent);
          continue;
        }
        if ((toolTranscript.length > 0 || hasToolEvidence(request.session, turnEventStart, toolTranscript)) && emptyOutputEvidenceNudgeCount < 1 && step < MAX_INTERNAL_TOOL_STEPS - 1) {
          emptyOutputEvidenceNudgeCount += 1;
          recordRuntimeEvent(request.session, {
            kind: "control",
            status: "queued",
            summary: "empty output evidence synthesis requested",
            detail: `tool_entries=${String(toolTranscript.length)}`,
          });
          prompt = createEmptyOutputEvidencePrompt(assembled.prompt, toolTranscript);
          continue;
        }
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
        const hasCurrentWriteEvidence = hasWriteEvidence(request.session, turnEventStart);
        const missingClaimEvidence = turnRun.evaluateFinalEvidence(turnEventStart, toolTranscript, output);
        const recoveryDecision = classifyRecoveryPolicy({
          output,
          step,
          maxSteps: MAX_INTERNAL_TOOL_STEPS,
          hasWriteEvidence: hasCurrentWriteEvidence,
          priorWriteEvidenceNudges: writeEvidenceNudgeCount,
          maxWriteEvidenceNudges: MAX_GUIDANCE_NUDGES_BEFORE_SYNTHESIS,
          missingClaimEvidence,
          promptRequiresTestEvidence: promptRequiresTestEvidence(request.prompt),
        });
        if (recoveryDecision.kind === "retry" && recoveryDecision.reason === "unsupported_write_completion") {
          writeEvidenceNudgeCount += 1;
          recordRuntimeEvent(request.session, {
            kind: "control",
            status: "queued",
            summary: "write evidence nudge applied",
            detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
          });
          prompt = createPromptWithToolTranscript(assembled.prompt, toolTranscript, PROVIDER_NUDGES.writeEvidence);
          continue;
        }
        if (recoveryDecision.kind === "block" && recoveryDecision.reason === "unsupported_write_completion") {
          writeEvidenceNudgeCount += 1;
          return createMissingWriteEvidenceFailure(request, model, transport.transport, transport.id, output);
        }
        if (missingClaimEvidence) {
          if (recoveryDecision.kind === "correct" && recoveryDecision.reason === "unsupported_test_claim") {
            return createUnsupportedTestClaimCorrection(request, model, transport.transport, transport.id, output);
          }
          if (missingClaimEvidence === "active skill output") {
            const recovery = await createRequiredEvidenceRecovery({
              request,
              model,
              transport: transport.transport,
              adapter: transport.id,
              missing: missingClaimEvidence,
              output,
              basePrompt: assembled.prompt,
              toolTranscript,
              step,
              nudgeCounts: requiredEvidenceNudgeCounts,
              runNexsightFallback: false,
            });
            if (recovery.kind === "retry") {
              prompt = recovery.prompt;
              continue;
            }
            return recovery.result;
          }
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
        if (recoveryDecision.kind === "retry" && recoveryDecision.reason === "non_actionable_deferral") {
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
        const styledOutput = styleAssistantOutput(request.session, output);
        recordRuntimeEvent(request.session, {
          kind: "assistant",
          status: "completed",
          summary: "assistant response completed",
          detail: styledOutput,
        });
        providerLifecycle.completed(styledOutput.length);
        setSentrySpanAttributes(agentSpan, {
          "gen_ai.response.output_chars": styledOutput.length,
          "nexagent.turn.status": "completed",
        });
        logSentryInfo("provider turn completed", {
          provider,
          model: model ?? "default",
          transport: request.session.providerTransport.mode,
          output_chars: styledOutput.length,
        });
        return {
          ok: true,
          provider,
          model,
          transport: transport.transport,
          adapter: transport.id,
          fallbackApplied: false,
          output: styledOutput,
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
        const finalIntent = extractModelIntent(finalInvocation.output);
        if (finalIntent) {
          recordModelIntent(request.session, finalIntent);
        }
        const finalOutput = stripModelIntent(finalInvocation.output).trimEnd();
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
          const styledOutput = styleAssistantOutput(request.session, finalOutput);
          recordRuntimeEvent(request.session, {
            kind: "assistant",
            status: "completed",
            summary: "assistant response completed",
            detail: styledOutput,
          });
          providerLifecycle.completed(styledOutput.length);
          setSentrySpanAttributes(agentSpan, {
            "gen_ai.response.output_chars": styledOutput.length,
            "nexagent.turn.status": "completed",
          });
          logSentryInfo("provider turn completed", {
            provider,
            model: model ?? "default",
            transport: request.session.providerTransport.mode,
            output_chars: styledOutput.length,
          });
          return {
            ok: true,
            provider,
            model,
            transport: transport.transport,
            adapter: transport.id,
            fallbackApplied: false,
            output: styledOutput,
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
    providerLifecycle.failed(detail);
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
    ),
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
  turnRun: ToolCapableTurn,
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
      const hasCurrentWriteEvidence = hasWriteEvidence(request.session, turnEventStart);
      const missingClaimEvidence = turnRun.evaluateFinalEvidence(turnEventStart, toolTranscript, output);
      const recoveryDecision = classifyRecoveryPolicy({
        output,
        step,
        maxSteps: MAX_INTERNAL_TOOL_STEPS,
        hasWriteEvidence: hasCurrentWriteEvidence,
        priorWriteEvidenceNudges: writeEvidenceNudgeCount,
        maxWriteEvidenceNudges: MAX_GUIDANCE_NUDGES_BEFORE_SYNTHESIS,
        missingClaimEvidence,
        promptRequiresTestEvidence: promptRequiresTestEvidence(request.prompt),
      });
      if (recoveryDecision.kind === "retry" && recoveryDecision.reason === "unsupported_write_completion") {
        writeEvidenceNudgeCount += 1;
        recordRuntimeEvent(request.session, {
          kind: "control",
          status: "queued",
          summary: "write evidence nudge applied",
          detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
        });
        nativeInput = [{ role: "user", content: PROVIDER_NUDGES.writeEvidence }];
        return null;
      }
      if (recoveryDecision.kind === "block" && recoveryDecision.reason === "unsupported_write_completion") {
        writeEvidenceNudgeCount += 1;
        return createMissingWriteEvidenceFailure(request, model, transport.transport, transport.id, output);
      }
      if (missingClaimEvidence) {
        if (recoveryDecision.kind === "correct" && recoveryDecision.reason === "unsupported_test_claim") {
          return createUnsupportedTestClaimCorrection(request, model, transport.transport, transport.id, output);
        }
        if (missingClaimEvidence === "active skill output") {
          const nudge = getRequiredEvidenceNudge(missingClaimEvidence);
          const nudgeCount = incrementRequiredEvidenceNudge(requiredEvidenceNudgeCounts, missingClaimEvidence);
          if (step < MAX_INTERNAL_TOOL_STEPS - 1 && nudgeCount < MAX_ACTIVE_SKILL_OUTPUT_NUDGES) {
            recordRequiredEvidenceNudge(request.session, nudge.summary, output);
            nativeInput = [{ role: "user", content: nudge.content }];
            return null;
          }
          return createMissingRequiredToolEvidenceFailure(request, model, transport.transport, transport.id, nudge.label, output);
        }
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
      if (recoveryDecision.kind === "retry" && recoveryDecision.reason === "non_actionable_deferral") {
        recordRuntimeEvent(request.session, {
          kind: "control",
          status: "queued",
          summary: "continuation nudge applied",
          detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
        });
        nativeInput = [{ role: "user", content: PROVIDER_NUDGES.continuation }];
        return null;
      }
      const styledOutput = styleAssistantOutput(request.session, output);
      recordRuntimeEvent(request.session, {
        kind: "assistant",
        status: "completed",
        summary: "assistant response completed",
        detail: styledOutput,
      });
      return {
        ok: true,
        provider: request.session.provider,
        model,
        transport: transport.transport,
        adapter: transport.id,
        fallbackApplied: false,
        output: styledOutput,
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
  recordProviderExecutionFailed(request, "assistant claimed file mutation without write evidence");
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
        : requiredTool === "active skill output"
          ? "required active skill output gate blocked assistant response"
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
  recordProviderExecutionFailed(request, `assistant completed without required ${requiredTool} evidence`);
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
  turnRun: ToolCapableTurn,
  turnEventStart: number,
  toolTranscript: string[],
  output: string,
): ProviderFailure | null {
  const missing = turnRun.evaluateFinalEvidence(turnEventStart, toolTranscript, output);
  if (missing === "active skill output") {
    recordRuntimeEvent(request.session, {
      kind: "control",
      status: "completed",
      summary: "active skill output accepted as partial",
      detail: "final synthesis produced incomplete active-skill output; preserving assistant output instead of converting useful partial work into a provider failure",
    });
    return null;
  }
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
  const maxNudges = options.missing === "active skill output"
    ? MAX_ACTIVE_SKILL_OUTPUT_NUDGES
    : MAX_GUIDANCE_NUDGES_BEFORE_SYNTHESIS;
  if (options.step < MAX_INTERNAL_TOOL_STEPS - 1 && nudgeCount < maxNudges) {
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
  if (options.missing === "active skill output") {
    return {
      kind: "fallback-success",
      result: createPartialActiveSkillOutputSuccess(
        options.request,
        options.model,
        options.transport,
        options.adapter,
        options.output,
      ),
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

function createPartialActiveSkillOutputSuccess(
  request: ProviderRequest,
  model: string | null,
  transport: ProviderFailure["transport"],
  adapter: ProviderFailure["adapter"],
  output: string,
): ProviderSuccess {
  const styledOutput = styleAssistantOutput(request.session, output);
  recordRuntimeEvent(request.session, {
    kind: "control",
    status: "completed",
    summary: "active skill output accepted as partial",
    detail: "active skill output stayed incomplete after repair nudges; preserving useful candidate output instead of failing the turn",
  });
  recordRuntimeEvent(request.session, {
    kind: "assistant",
    status: "completed",
    summary: "assistant response completed",
    detail: styledOutput,
  });
  recordProviderExecutionCompleted(request, styledOutput.length, { active_skill_partial: true });
  return {
    ok: true,
    provider: request.session.provider,
    model,
    transport,
    adapter,
    fallbackApplied: false,
    output: styledOutput,
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
  const approvalPattern = formatApprovalPattern(call);
  session.operationControls.approvalSessionGrants = session.operationControls.approvalSessionGrants ?? [];
  if (hasRuntimeApprovalSessionGrant(session, approvalPattern)) {
    session.operationControls.lastDecision = "approved";
    recordRuntimeEvent(session, {
      kind: "control",
      status: "applied",
      summary: `approval reused for ${call.name}`,
      detail: "session pattern grant",
    });
    return true;
  }

  const request: RuntimeApprovalRequest = {
    tool: call.name,
    risk,
    summary: summarizeApprovalArguments(call.arguments ?? {}),
    pattern: approvalPattern,
    requestedAt: new Date().toISOString(),
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

  await waitForApprovalDecision(session);

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

function formatApprovalPattern(call: InternalToolCall): string {
  return `${call.name}:${stableStringify(call.arguments ?? {})}`;
}

function summarizeApprovalArguments(value: unknown): string {
  const summary = stableStringify(value);
  return summary.length > 240 ? `${summary.slice(0, 237)}...` : summary;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function waitForApprovalDecision(session: RuntimeSession): Promise<void> {
  if (!session.operationControls.pendingApproval) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    const fallbackTimer = setInterval(() => {
      if (!session.operationControls.pendingApproval) {
        finish();
      }
    }, 250);
    fallbackTimer.unref?.();

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearInterval(fallbackTimer);
      unsubscribe?.();
      resolve();
    };

    unsubscribe = subscribeRuntimeSession(session, () => {
      if (!session.operationControls.pendingApproval) {
        finish();
      }
    });
  });
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

function recordModelIntent(session: RuntimeSession, intent: string): void {
  const lastPromptIndex = [...session.events].map((event) => event.kind).lastIndexOf("prompt");
  const events = lastPromptIndex >= 0 ? session.events.slice(lastPromptIndex) : session.events;
  if (events.some((event) => event.kind === "control" && event.summary === "model turn intent")) {
    return;
  }
  recordRuntimeEvent(session, {
    kind: "control",
    status: "started",
    summary: "model turn intent",
    detail: intent,
  });
}

function createUnsupportedTestClaimCorrection(
  request: ProviderRequest,
  model: string | null,
  transport: ProviderFailure["transport"],
  adapter: ProviderFailure["adapter"],
  output: string,
): ProviderSuccess {
  const correctedOutput = styleAssistantOutput(request.session, `${output.trim()}\n\nTests not run in this turn.`);
  recordRuntimeEvent(request.session, {
    kind: "control",
    status: "completed",
    summary: "unsupported test claim corrected",
    detail: "assistant claimed test evidence without current-turn test tool evidence; harness converted claim to an explicit unverified note",
  });
  recordRuntimeEvent(request.session, {
    kind: "assistant",
    status: "completed",
    summary: "assistant response completed",
    detail: correctedOutput,
  });
  recordProviderExecutionCompleted(request, correctedOutput.length, { unsupported_test_claim_corrected: true });
  return {
    ok: true,
    provider: request.session.provider,
    model,
    transport,
    adapter,
    fallbackApplied: false,
    output: correctedOutput,
  };
}

function promptRequiresTestEvidence(prompt: string): boolean {
  return /\b(run|execute|perform|verify|validate|check)\b[\s\S]{0,80}\b(tests?|test suite|build|tsc|typecheck|lint)\b/i.test(prompt)
    || /\b(tests?|test suite|build|tsc|typecheck|lint)\b[\s\S]{0,80}\b(pass|green|verified|validate|check)\b/i.test(prompt);
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

function createIntentOnlyContinuationPrompt(basePrompt: string, intent: string): string {
  return [
    basePrompt,
    "",
    "The previous provider step emitted only a model intent and no assistant answer or tool call.",
    `Intent: ${intent}`,
    "Continue now with the required assistant response or a valid nexagent tool call.",
    "Do not emit only another intent.",
  ].join("\n");
}

function createEmptyOutputEvidencePrompt(basePrompt: string, toolTranscript: string[]): string {
  return [
    basePrompt,
    "",
    formatToolTranscriptSection(toolTranscript, 6),
    "",
    "The previous provider step returned empty assistant text after completed tool evidence.",
    "Do not call more tools unless a required artifact, write, or verification is still missing.",
    "Return a concise final answer using completed tool evidence.",
    "If the task is not complete, state what evidence was gathered and the next concrete step.",
    FINAL_EDIT_SUMMARY_GUIDANCE,
  ].join("\n");
}

function createActiveSkillPreflightPrompt(basePrompt: string, toolTranscript: string[]): string {
  return [
    basePrompt,
    "",
    "Active skill preflight evidence:",
    formatToolTranscriptSection(toolTranscript, 6),
    "",
    "Use this harness-provided evidence before claiming tool output is unavailable.",
    "Run more valid nexagent tool calls only when this preflight evidence is insufficient.",
  ].join("\n");
}

function createActiveSkillPreflightCalls(session: RuntimeSession): InternalToolCall[] {
  const skillContent = session.activeSkill?.content ?? "";
  const calls: InternalToolCall[] = [];
  for (const targetPath of extractAbsoluteAtReferences(skillContent).slice(0, 3)) {
    calls.push({ name: "read_file", arguments: { path: targetPath } });
  }
  if (/\bgsd-sdk\s+query\s+stats\.json\b/.test(skillContent)) {
    calls.push({ name: "shell_command", arguments: { command: "gsd-sdk query stats.json", timeoutMs: 30_000 } });
  }
  if (calls.length === 0 && session.repo.root && existsSync(session.repo.root)) {
    calls.push({ name: "nexsight_gather", arguments: { root: ".", pattern: "*.ts", mode: "signatures", limit: 24, maxCharsPerFile: 12_000 } });
  }
  return calls;
}

function extractAbsoluteAtReferences(content: string): string[] {
  const refs = new Set<string>();
  for (const match of content.matchAll(/@((?:\/|~\/)[^\s<>)\]},"']+)/g)) {
    const rawPath = match[1]?.replace(/[.,;:]+$/, "");
    if (!rawPath) {
      continue;
    }
    refs.add(rawPath.startsWith("~/")
      ? `${process.env.HOME ?? ""}/${rawPath.slice(2)}`
      : rawPath);
  }
  return [...refs];
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
  turnRun: ToolCapableTurn,
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

  const finalIntent = extractModelIntent(finalInvocation.output);
  if (finalIntent) {
    recordModelIntent(request.session, finalIntent);
  }
  const finalOutput = stripModelIntent(finalInvocation.output).trimEnd();
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

  const styledOutput = styleAssistantOutput(request.session, finalOutput);
  recordRuntimeEvent(request.session, {
    kind: "assistant",
    status: "completed",
    summary: "assistant response completed",
    detail: styledOutput,
  });
  recordProviderExecutionCompleted(request, styledOutput.length);
  return {
    ok: true,
    provider: request.session.provider,
    model,
    transport: request.session.provider === "openai" ? "openai" : "codex",
    adapter,
    fallbackApplied: false,
    output: styledOutput,
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
