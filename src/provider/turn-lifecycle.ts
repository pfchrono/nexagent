import type { ProviderRequest, ProviderResult } from "../provider.js";
import { emitRuntimeExtensionEvent } from "../runtime/extensions.js";
import { emitTerminalNotification, notifyThresholdMs } from "../runtime/pi-compat.js";
import { beginSkillRun, completeSkillRun, recordSkillToolResult } from "../runtime/skill-runner.js";
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
      if (result.ok) {
        completeSkillRun(skillRun, result.output);
      }
      return result;
    } catch (error) {
      await emitRuntimeExtensionEvent(request.session, "agent_error", { error });
      throw error;
    } finally {
      await emitRuntimeExtensionEvent(request.session, "agent_end", { result });
      const elapsedMs = Date.now() - startedAt;
      if (request.session.ui?.notifyEnabled === true && elapsedMs >= notifyThresholdMs(request.session)) {
        emitTerminalNotification("nexagent turn complete", `${Math.round(elapsedMs / 1000)}s`);
      }
    }
  });
}
