import type { ProviderResult } from "../provider.js";
import { collectTurnEvidence, type TurnEvidenceSummary } from "./evidence.js";
import { deriveTurnObligations, type TurnObligations } from "./nexsight-router.js";
import type { RuntimeSession } from "./session.js";
import { recordRuntimeEvent, setRuntimeAction } from "./session.js";

export type TurnRunState = "initializing" | "provider_loop" | "finalizing" | "completed" | "blocked";
export type MissingTurnEvidence = "write" | "Nexsight" | "active skill" | "test";

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
  private readonly obligations: TurnObligations;

  constructor(private readonly context: TurnRunContext) {
    this.obligations = deriveTurnObligations(context.prompt, context.session);
  }

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

  getObligations(): TurnObligations {
    return this.obligations;
  }

  collectEvidence(sinceIndex: number, toolTranscript: string[] = []): TurnEvidenceSummary {
    return collectTurnEvidence(this.context.session, sinceIndex, toolTranscript);
  }

  evaluateFinalEvidence(
    sinceIndex: number,
    toolTranscript: string[],
    output: string,
  ): MissingTurnEvidence | null {
    const evidence = this.collectEvidence(sinceIndex, toolTranscript);
    if (this.obligations.requiresNexsightEvidence && !evidence.hasNexsightEvidence) {
      return "Nexsight";
    }
    if (this.obligations.requiresWriteEvidence && !evidence.hasWriteEvidence) {
      return "write";
    }
    if (this.obligations.requiresActiveSkillEvidence && !evidence.hasAnyToolEvidence) {
      return "active skill";
    }
    if (claimsNexsightWork(output) && !evidence.hasNexsightEvidence) {
      return "Nexsight";
    }
    if (claimsTestExecution(output) && !evidence.hasTestEvidence) {
      return "test";
    }
    return null;
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

function claimsNexsightWork(output: string): boolean {
  return /\bnexsight\b/i.test(output)
    && /\b(ran|run|used|use|executed|searched|indexed|scanned|queried|inspected|analy[sz]ed)\b/i.test(output);
}

function claimsTestExecution(output: string): boolean {
  return /\b(?:ran|executed)\s+(?:the\s+)?(?:tests?|validation|build|tsc)\b/i.test(output)
    || /\b(?:tests?|validation|build|tsc)\s+(?:pass(?:ed|es)?|succeed(?:ed)?|green)\b/i.test(output)
    || /\b0 fail\b|\bno failures?\b/i.test(output);
}
