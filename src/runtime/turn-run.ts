import type { CodexInvocationMetrics, ProviderResult } from "../provider.js";
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

export interface TurnRunLoopStep {
  cycle: number;
  step: number;
  finalStep: boolean;
  finalCycle: boolean;
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

  async runProviderLoop(executor: () => Promise<ProviderResult>): Promise<ProviderResult> {
    this.transition("provider_loop", "TurnRun owned provider/tool loop started");
    return executor();
  }

  async runToolLoop<T>(
    maxCycles: number,
    maxSteps: number,
    onStep: (step: TurnRunLoopStep) => Promise<T | null>,
  ): Promise<T | null> {
    for (let cycle = 0; cycle < maxCycles; cycle += 1) {
      for (let step = 0; step < maxSteps; step += 1) {
        const result = await onStep({
          cycle,
          step,
          finalStep: step === maxSteps - 1,
          finalCycle: cycle === maxCycles - 1,
        });
        if (result !== null) {
          return result;
        }
      }
    }
    return null;
  }

  onProviderStep(step: number, metrics?: CodexInvocationMetrics): void {
    const detail = metrics
      ? `step=${String(step)}; duration=${formatRuntimeDuration(metrics.durationMs)}; in~${String(metrics.inputTokens)}; out~${String(metrics.outputTokens)}`
      : `step=${String(step)}`;
    recordRuntimeEvent(this.context.session, {
      kind: "control",
      status: "started",
      summary: "turn run provider step",
      detail,
    });
  }

  onToolStep(toolName: string): void {
    recordRuntimeEvent(this.context.session, {
      kind: "control",
      status: "started",
      summary: "turn run tool step",
      detail: toolName,
    });
  }

  async run(executor: () => Promise<ProviderResult>): Promise<ProviderResult> {
    setRuntimeAction(this.context.session, "running", "turn run active");
    recordRuntimeEvent(this.context.session, {
      kind: "control",
      status: "started",
      summary: "turn run started",
      detail: this.context.prompt.slice(0, 160),
    });
    const result = await this.runProviderLoop(executor);

    this.transition("finalizing", "provider returned");
    if (result.ok) {
      this.transition("completed", "turn finished");
      const turnMetrics = collectTurnRunTokenMetrics(this.context.session);
      recordRuntimeEvent(this.context.session, {
        kind: "control",
        status: "completed",
        summary: "turn run completed",
        detail: `turn_in~${String(turnMetrics.inputTokens)}; turn_out~${String(turnMetrics.outputTokens)}`,
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
  if (/\b(can use|available|built-in|tool(?:s)?|mcp|arsenal)\b/i.test(output)
    && /\bnexsight_(?:execute|index|batch|search)\b/i.test(output)) {
    return false;
  }

  return output
    .split(/[\n.!?;]+/)
    .some((segment) => {
      const claimsDirectUse = /\b(ran|used|executed|searched|indexed|scanned|queried|inspected|analy[sz]ed)\s+(?:the\s+)?(?:nexsight|nexsight_(?:execute|index|batch|search))\b/i.test(segment);
      const claimsNexsightResult = /\bnexsight\s+(?:evidence|result|output|scan|search|index|inspection|analysis)\b/i.test(segment)
        && /\b(completed|returned|found|shows?|reported|produced|confirmed)\b/i.test(segment);
      return claimsDirectUse || claimsNexsightResult;
    });
}

function collectTurnRunTokenMetrics(session: RuntimeSession): { inputTokens: number; outputTokens: number } {
  const promptIndex = [...session.events].map((event) => event.kind).lastIndexOf("prompt");
  const events = promptIndex >= 0 ? session.events.slice(promptIndex) : session.events;
  return events.reduce((metrics, event) => {
    const detail = event.detail ?? "";
    metrics.inputTokens += readTurnRunTokenMetric(detail, "in");
    metrics.outputTokens += readTurnRunTokenMetric(detail, "out");
    return metrics;
  }, { inputTokens: 0, outputTokens: 0 });
}

function readTurnRunTokenMetric(detail: string, key: "in" | "out"): number {
  const match = new RegExp(`(?:^|[;\\s])${key}~(\\d+)`).exec(detail);
  return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
}

function formatRuntimeDuration(durationMs: number): string {
  return `${(Math.max(0, durationMs) / 1000).toFixed(2)}s`;
}

function claimsTestExecution(output: string): boolean {
  return /\b(?:ran|executed)\s+(?:the\s+)?(?:tests?|validation|build|tsc)\b/i.test(output)
    || /\b(?:tests?|validation|build|tsc)\s+(?:pass(?:ed|es)?|succeed(?:ed)?|green)\b/i.test(output)
    || /\b0 fail\b|\bno failures?\b/i.test(output);
}
