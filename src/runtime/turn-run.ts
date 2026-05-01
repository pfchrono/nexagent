import type { ProviderResult } from "../provider.js";
import type { RuntimeSession } from "./session.js";
import { recordRuntimeEvent, setRuntimeAction } from "./session.js";

export type TurnRunState = "initializing" | "provider_loop" | "finalizing" | "completed" | "blocked";

export interface TurnRunContext {
  session: RuntimeSession;
  prompt: string;
}

export interface TurnRunTransition {
  from: TurnRunState;
  to: TurnRunState;
  at: string;
  reason: string;
}

export class TurnRun {
  private state: TurnRunState = "initializing";
  private readonly transitions: TurnRunTransition[] = [];

  constructor(private readonly context: TurnRunContext) {}

  private transition(next: TurnRunState, reason: string): void {
    const now = new Date().toISOString();
    this.transitions.push({
      from: this.state,
      to: next,
      at: now,
      reason,
    });
    this.state = next;
  }

  getState(): TurnRunState {
    return this.state;
  }

  getTransitions(): readonly TurnRunTransition[] {
    return this.transitions;
  }

  async run(executor: () => Promise<ProviderResult>): Promise<ProviderResult> {
    setRuntimeAction(this.context.session, "running", "turn run active");
    recordRuntimeEvent(this.context.session, {
      kind: "control",
      status: "started",
      summary: "turn run started",
      detail: this.context.prompt.slice(0, 160),
    });
    this.transition("provider_loop", "provider orchestration delegated");

    const result = await executor();

    this.transition("finalizing", "provider returned");
    if (result.ok) {
      this.transition("completed", "turn finished");
      recordRuntimeEvent(this.context.session, {
        kind: "control",
        status: "completed",
        summary: "turn run completed",
      });
      return result;
    }

    this.transition("blocked", result.code);
    setRuntimeAction(this.context.session, "error", result.message);
    recordRuntimeEvent(this.context.session, {
      kind: "control",
      status: "failed",
      summary: "turn run blocked",
      detail: `${result.code}: ${result.message}`,
    });
    return result;
  }
}
