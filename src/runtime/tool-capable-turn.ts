import { TurnRun } from "./turn-run.js";
import type { RuntimeSession } from "./session.js";

export {
  TurnRun as ToolCapableTurn,
  recordProviderTurnCompleted,
  recordProviderTurnFailed,
  recordProviderTurnStarted,
} from "./turn-run.js";
export type {
  MissingTurnEvidence,
  ProviderTurnDetailFlags,
  ProviderTurnLifecycle,
  TurnRunContext as ToolCapableTurnContext,
  TurnRunLoopStep as ToolCapableTurnLoopStep,
  TurnRunState as ToolCapableTurnState,
  TurnRunTransition as ToolCapableTurnTransition,
} from "./turn-run.js";

export interface CreateToolCapableTurnInput {
  session: RuntimeSession;
  prompt: string;
}

export function createToolCapableTurn(input: CreateToolCapableTurnInput): TurnRun {
  return new TurnRun({
    session: input.session,
    prompt: input.prompt,
  });
}
