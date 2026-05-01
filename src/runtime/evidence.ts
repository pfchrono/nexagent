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
  hasNexsightEvidence: boolean;
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
  let hasWriteEvidence = false;
  let hasNexsightEvidence = toolTranscript.some((entry) => /"name"\s*:\s*"nexsight_(execute|index|batch|search)"/i.test(entry));

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
    if (contract.writes && event.status === "completed") {
      hasWriteEvidence = true;
    }
    if (contract.nexsight) {
      hasNexsightEvidence = true;
    }
    snapshots.push({ toolName, summary: event.summary, status: event.status });
  }

  const hasAnyToolEvidence = toolTranscript.some((entry) => /Tool call:/i.test(entry)) || snapshots.length > 0;

  return {
    totalToolEvents: snapshots.length,
    hasAnyToolEvidence,
    hasWriteEvidence,
    hasNexsightEvidence,
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
