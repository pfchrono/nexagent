import type { RuntimeConversationTurn, RuntimeEvent, RuntimeSession } from "./session.js";
import { addArchivistMemorySync } from "./archivist.js";
import { formatTodoPromptSummary } from "./todos.js";

const BOOMERANG_INSTRUCTIONS = [
  "BOOMERANG MODE ACTIVE",
  "Complete the task fully and autonomously. Do not ask clarifying questions unless blocked by missing access or unsafe action.",
  "Make reasonable assumptions, inspect as needed, edit as needed, and verify when possible.",
  "When finished, briefly state what changed, validation run, and any remaining blocker.",
].join("\n");

const BOOMERANG_TOOL_WRITE_NAMES = new Set(["write_file", "apply_patch", "batch_edit"]);
const BOOMERANG_TOOL_READ_NAMES = new Set(["read_file", "list_dir", "search_content", "search_files", "lsp_symbols", "lsp_diagnostics"]);

export function beginBoomerang(session: RuntimeSession, task: string): void {
  session.operationControls.boomerang = {
    active: true,
    task,
    startConversationIndex: session.conversation.length,
    startEventIndex: session.events.length,
    lastSummary: session.operationControls.boomerang.lastSummary,
  };
}

export function cancelBoomerang(session: RuntimeSession): boolean {
  const wasActive = session.operationControls.boomerang.active;
  session.operationControls.boomerang = {
    active: false,
    task: null,
    startConversationIndex: session.conversation.length,
    startEventIndex: session.events.length,
    lastSummary: session.operationControls.boomerang.lastSummary,
  };
  return wasActive;
}

export function buildBoomerangPrompt(task: string): string {
  return `${BOOMERANG_INSTRUCTIONS}\n\nTask:\n${task}`;
}

export function completeBoomerang(session: RuntimeSession, finalOutput: string): string | null {
  const state = session.operationControls.boomerang;
  if (!state.active || !state.task) {
    return null;
  }

  const events = session.events.slice(state.startEventIndex);
  const turns = session.conversation.slice(state.startConversationIndex);
  const todoSummary = formatTodoPromptSummary(session.todos);
  const summary = [
    summarizeBoomerangWork(state.task, events, turns, finalOutput),
    todoSummary ? `\nTodos:\n${todoSummary}` : null,
  ].filter((value): value is string => Boolean(value)).join("\n");
  session.conversation = [
    ...session.conversation.slice(0, state.startConversationIndex),
    { role: "user", content: `/boomerang ${state.task}`, tokens: estimateBoomerangTokens(state.task) },
    { role: "assistant", content: summary, tokens: estimateBoomerangTokens(summary) },
  ];
  session.compaction.summary = [session.compaction.summary, summary]
    .filter((value): value is string => Boolean(value && value.trim()))
    .join("\n\n");
  const archivistPreview = saveBoomerangArchivistMemory(session, state.task, summary);
  session.operationControls.boomerang = {
    active: false,
    task: null,
    startConversationIndex: session.conversation.length,
    startEventIndex: session.events.length,
    lastSummary: archivistPreview ? `${summary}\n\nArchivist: ${archivistPreview}` : summary,
  };
  return session.operationControls.boomerang.lastSummary;
}

function summarizeBoomerangWork(
  task: string,
  events: RuntimeEvent[],
  turns: RuntimeConversationTurn[],
  finalOutput: string,
): string {
  const completedTools = events.filter((event) => event.kind === "tool" && event.status === "completed");
  const failedTools = events.filter((event) => event.kind === "tool" && event.status === "failed");
  const reads = collectToolPaths(completedTools, BOOMERANG_TOOL_READ_NAMES);
  const writes = collectToolPaths(completedTools, BOOMERANG_TOOL_WRITE_NAMES);
  const commands = completedTools.filter((event) => /\btool shell_command\b/i.test(event.summary));
  const failures = summarizeToolFailures(failedTools);
  const assistantFinal = firstUsefulLine(finalOutput) ?? firstUsefulLine([...turns].reverse().find((turn) => turn.role === "assistant")?.content ?? "");

  return [
    "[BOOMERANG COMPLETE]",
    `Task: "${task}"`,
    "",
    "Outcome:",
    assistantFinal ?? "Completed autonomous turn; no final assistant summary captured.",
    "",
    "Changed Files:",
    writes.length > 0 ? writes.map((file) => `- ${file}`).join("\n") : "- none detected",
    "",
    "Relevant Reads:",
    reads.length > 0 ? reads.slice(0, 12).map((file) => `- ${file}`).join("\n") : "- none detected",
    "",
    "Commands:",
    `- Ran ${String(commands.length)} shell command(s)`,
    failures.length > 0 ? `- Failures:\n${failures.map((failure) => `  - ${failure}`).join("\n")}` : "- Failures: none detected",
  ].join("\n");
}

function collectToolPaths(events: RuntimeEvent[], names: Set<string>): string[] {
  const paths = new Set<string>();
  for (const event of events) {
    const toolName = parseToolName(event.summary);
    if (!toolName || !names.has(toolName)) {
      continue;
    }
    const args = parseToolArgs(event.detail ?? "");
    const path = typeof args.path === "string"
      ? args.path
      : Array.isArray(args.edits)
        ? args.edits.map((edit) => isRecord(edit) && typeof edit.path === "string" ? edit.path : null).filter(Boolean).join(", ")
        : null;
    if (path) {
      for (const part of path.split(/,\s*/)) {
        if (part.trim()) paths.add(part.trim());
      }
    }
  }
  return [...paths].sort();
}

function parseToolName(summary: string): string | null {
  return summary.match(/^tool\s+([a-z0-9_]+)\s+/i)?.[1] ?? null;
}

function parseToolArgs(detail: string): Record<string, unknown> {
  const match = detail.match(/\bargs=(\{.*\})(?:$|;)/);
  if (!match?.[1]) {
    return {};
  }
  try {
    const parsed = JSON.parse(match[1]) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function summarizeToolFailures(events: RuntimeEvent[]): string[] {
  const counts = new Map<string, number>();
  for (const event of events) {
    const failure = formatToolFailure(event);
    counts.set(failure, (counts.get(failure) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([failure, count]) => count > 1 ? `${failure} (${String(count)}x)` : failure)
    .slice(0, 5);
}

function formatToolFailure(event: RuntimeEvent): string {
  const tool = parseToolName(event.summary) ?? "tool";
  const detail = (event.detail ?? event.summary).replace(/\s+/g, " ").trim();
  if (/policy blocked|protected path|shell policy blocked/i.test(detail)) {
    return `${tool}: blocked by shell policy`;
  }
  const output = detail.match(/\boutput=(.+)$/i)?.[1]?.trim();
  if (output) {
    return `${tool}: ${truncateBoomerangFailure(cleanFailureOutput(output), 160)}`;
  }
  return `${tool}: ${truncateBoomerangFailure(stripToolFailureMetadata(detail), 160)}`;
}

function stripToolFailureMetadata(value: string): string {
  const stripped = value
    .replace(/\b(?:read-only|guarded|dangerous);?\s*/gi, "")
    .replace(/\bduration=[^;]+;?\s*/gi, "")
    .replace(/\bin~\d+;?\s*/gi, "")
    .replace(/\bout~\d+;?\s*/gi, "")
    .replace(/\bargs=\{.*?\};?\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > 0 ? stripped : "failed";
}

function cleanFailureOutput(value: string): string {
  const cleaned = value
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^shell exit\s+\d+\s+---\s*/i, "shell exit: ")
    .replace(/\s+---\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "failed";
}

function truncateBoomerangFailure(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 3))}...`;
}

function firstUsefulLine(value: string): string | null {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("[BOOMERANG COMPLETE]")) ?? null;
}

function estimateBoomerangTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function saveBoomerangArchivistMemory(session: RuntimeSession, task: string, summary: string): string | null {
  if (!session.archivist.enabled || !session.archivist.storagePath) {
    return null;
  }
  try {
    const result = addArchivistMemorySync(session, {
      type: "boomerang-handoff",
      summary: `Boomerang: ${task}`,
      content: summary,
      tags: ["boomerang", "handoff", "reseed", session.provider],
      sourceCategory: "boomerang-handoff",
      action: "checkpoint",
    });
    return `saved boomerang handoff; entries=${String(result.entryCount)}; ${result.preview}`;
  } catch (error) {
    return `save failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
