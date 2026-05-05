import type { ProviderRequest, ProviderResult } from "../provider.js";
import { emitRuntimeExtensionEvent } from "../runtime/extensions.js";
import { emitTerminalNotification, notifyThresholdMs } from "../runtime/pi-compat.js";
import { savePersistedRuntimeState } from "../runtime/persistence.js";
import { beginSkillRun, completeSkillRun, recordSkillToolResult } from "../runtime/skill-runner.js";
import { pruneFinishedTurnTodos } from "../runtime/todos.js";
import { TurnRun } from "../runtime/turn-run.js";
import type { InternalToolCall, InternalToolResult } from "../runtime/tools.js";

export type ProviderTurnExecutor = (
  turnRun: TurnRun,
  onToolResult: (call: InternalToolCall, result: InternalToolResult) => void,
) => Promise<ProviderResult>;

export async function runProviderTurn(
  request: ProviderRequest,
  executor: ProviderTurnExecutor,
  emitAgentStart: () => Promise<unknown> = () => emitRuntimeExtensionEvent(request.session, "agent_start", { prompt: request.prompt }),
): Promise<ProviderResult> {
  const turnRun = new TurnRun({
    session: request.session,
    prompt: request.prompt,
  });
  let skillRun = beginSkillRun(request.session, request.prompt);
  const startedAt = Date.now();

  return turnRun.run(async () => {
    let result: ProviderResult | null = null;
    try {
      await emitAgentStart();
      result = await executor(turnRun, (call, toolResult) => {
        skillRun = recordSkillToolResult(skillRun, call, toolResult);
      });
      result = await applyMessageEndReplacement(request, result);
      if (result.ok) {
        completeSkillRun(skillRun, result.output);
      }
      return result;
    } catch (error) {
      await emitRuntimeExtensionEvent(request.session, "agent_error", { error });
      throw error;
    } finally {
      if (pruneFinishedTurnTodos(request.session.todos)) {
        savePersistedRuntimeState(request.session);
      }
      await emitRuntimeExtensionEvent(request.session, "agent_end", { result });
      const elapsedMs = Date.now() - startedAt;
      if (request.session.ui?.notifyEnabled === true && elapsedMs >= notifyThresholdMs(request.session)) {
        emitTerminalNotification("nexagent turn complete", `${Math.round(elapsedMs / 1000)}s`);
      }
    }
  });
}

async function applyMessageEndReplacement(request: ProviderRequest, result: ProviderResult): Promise<ProviderResult> {
  if (!result.ok) {
    return result;
  }
  const replacements = await emitRuntimeExtensionEvent(request.session, "message_end", {
    prompt: request.prompt,
    output: result.output,
    result,
  });
  let output = result.output;
  for (const replacement of replacements) {
    const next = extractMessageEndOutput(replacement);
    if (next !== null) {
      output = next;
    }
  }
  return output === result.output ? result : { ...result, output };
}

function extractMessageEndOutput(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as {
    content?: unknown;
    message?: { content?: unknown };
    output?: unknown;
    replacement?: unknown;
    result?: unknown;
  };
  for (const candidate of [record.output, record.content, record.replacement, record.message?.content]) {
    if (typeof candidate === "string") {
      return candidate;
    }
  }
  if (record.result && typeof record.result === "object") {
    const nested = record.result as { output?: unknown; content?: unknown };
    for (const candidate of [nested.output, nested.content]) {
      if (typeof candidate === "string") {
        return candidate;
      }
    }
  }
  return null;
}
