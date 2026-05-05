import type { RuntimeEvent, RuntimeSession } from "./session.js";
import type { InternalToolName } from "./tools.js";
import { getToolContract } from "./tool-contracts.js";

export interface ToolEvidenceSnapshot {
  toolName: InternalToolName;
  summary: string;
  status: RuntimeEvent["status"];
}

export interface TurnEvidenceSummary {
  totalToolEvents: number;
  hasAnyToolEvidence: boolean;
  hasWriteEvidence: boolean;
  hasReadEvidence: boolean;
  hasNexsightEvidence: boolean;
  hasTodoEvidence: boolean;
  hasAskEvidence: boolean;
  hasTestEvidence: boolean;
  snapshots: ToolEvidenceSnapshot[];
}

function extractToolName(summary: string): InternalToolName | null {
  const match = summary.match(/\btool\s+([a-z_]+)\b/i);
  if (!match?.[1]) {
    return null;
  }
  return match[1] as InternalToolName;
}

function isEvidenceStatus(status: RuntimeEvent["status"]): boolean {
  return status === "completed" || status === "failed" || status === "blocked";
}

export function collectTurnEvidence(session: RuntimeSession, sinceIndex: number, toolTranscript: string[] = []): TurnEvidenceSummary {
  const scoped = session.events.slice(sinceIndex);
  const snapshots: ToolEvidenceSnapshot[] = [];
  let hasReadEvidence = false;
  let hasWriteEvidence = false;
  let hasNexsightEvidence = toolTranscript.some((entry) => /"name"\s*:\s*"nexsight_(execute|index|batch|search)"/i.test(entry));
  let hasTodoEvidence = toolTranscript.some((entry) => /"name"\s*:\s*"todo"/i.test(entry));
  let hasAskEvidence = toolTranscript.some((entry) => /"name"\s*:\s*"ask_user_question"/i.test(entry));
  let hasTestEvidence = toolTranscript.some((entry) => {
    const hasShell = /"name"\s*:\s*"shell_command"/i.test(entry);
    return hasShell && /\b(bun|npm|pnpm|yarn|pytest|go|cargo)\s+(run\s+)?test\b|\btsc\b|\btest\b/i.test(entry);
  });

  for (const event of scoped) {
    if (event.kind !== "tool" || !isEvidenceStatus(event.status)) {
      continue;
    }
    const toolName = extractToolName(event.summary);
    if (!toolName) {
      snapshots.push({ toolName: "shell_command", summary: event.summary, status: event.status });
      continue;
    }
    const contract = getToolContract(toolName);
    if (toolName === "read_file" && event.status === "completed") {
      hasReadEvidence = true;
    }
    if (contract.writes && event.status === "completed") {
      hasWriteEvidence = true;
    }
    if (contract.nexsight) {
      hasNexsightEvidence = true;
    }
    if (toolName === "todo") {
      hasTodoEvidence = true;
    }
    if (toolName === "ask_user_question") {
      hasAskEvidence = true;
    }
    if (toolName === "shell_command" && /\b(test|tsc|build)\b/i.test(event.detail ?? "")) {
      hasTestEvidence = true;
    }
    snapshots.push({ toolName, summary: event.summary, status: event.status });
  }

  const hasAnyToolEvidence = toolTranscript.some((entry) => /Tool call:/i.test(entry)) || snapshots.length > 0;

  return {
    totalToolEvents: snapshots.length,
    hasAnyToolEvidence,
    hasReadEvidence,
    hasWriteEvidence,
    hasNexsightEvidence,
    hasTodoEvidence,
    hasAskEvidence,
    hasTestEvidence,
    snapshots,
  };
}

export function hasWriteEvidence(session: RuntimeSession, sinceIndex: number): boolean {
  return collectTurnEvidence(session, sinceIndex).hasWriteEvidence;
}

export function hasNexsightEvidence(session: RuntimeSession, sinceIndex: number, toolTranscript: string[] = []): boolean {
  return collectTurnEvidence(session, sinceIndex, toolTranscript).hasNexsightEvidence;
}

export function hasToolEvidence(session: RuntimeSession, sinceIndex: number, toolTranscript: string[] = []): boolean {
  return collectTurnEvidence(session, sinceIndex, toolTranscript).hasAnyToolEvidence;
}

export function hasTodoEvidence(session: RuntimeSession, sinceIndex: number, toolTranscript: string[] = []): boolean {
  return collectTurnEvidence(session, sinceIndex, toolTranscript).hasTodoEvidence;
}

export function hasAskEvidence(session: RuntimeSession, sinceIndex: number, toolTranscript: string[] = []): boolean {
  return collectTurnEvidence(session, sinceIndex, toolTranscript).hasAskEvidence;
}

export function hasTestEvidence(session: RuntimeSession, sinceIndex: number, toolTranscript: string[] = []): boolean {
  return collectTurnEvidence(session, sinceIndex, toolTranscript).hasTestEvidence;
}
