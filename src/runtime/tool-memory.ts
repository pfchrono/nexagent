import type { InternalToolCall, InternalToolResult } from "./tools.js";

export interface RuntimeToolMemoryEntry {
  id: string;
  tool: string;
  ok: boolean;
  args: string;
  summary: string;
  createdAt: string;
}

export interface RuntimeToolMemoryState {
  entries: RuntimeToolMemoryEntry[];
  nextId: number;
  updatedAt: string | null;
}

const TOOL_MEMORY_LIMIT = 32;
const TOOL_MEMORY_PROMPT_LIMIT = 14;
const SUMMARY_MAX_CHARS = 420;
const ARGS_MAX_CHARS = 180;

export function createRuntimeToolMemoryState(value?: Partial<RuntimeToolMemoryState> | null): RuntimeToolMemoryState {
  const entries = Array.isArray(value?.entries)
    ? value.entries.map(normalizeToolMemoryEntry).filter((entry): entry is RuntimeToolMemoryEntry => Boolean(entry)).slice(-TOOL_MEMORY_LIMIT)
    : [];
  const maxId = entries.reduce((max, entry) => Math.max(max, Number(entry.id.replace(/^toolmem-/, "")) || 0), 0);
  const nextId = typeof value?.nextId === "number" && Number.isFinite(value.nextId) ? Math.floor(value.nextId) : maxId + 1;
  return {
    entries,
    nextId: Math.max(1, nextId, maxId + 1),
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : null,
  };
}

export function recordToolMemory(
  state: RuntimeToolMemoryState,
  call: InternalToolCall,
  result: InternalToolResult,
): RuntimeToolMemoryEntry | null {
  if (isLowSignalToolFailure(call, result)) {
    return null;
  }
  const now = new Date().toISOString();
  const entry: RuntimeToolMemoryEntry = {
    id: `toolmem-${String(state.nextId++)}`,
    tool: call.name,
    ok: result.ok,
    args: compactJson(call.arguments ?? {}, ARGS_MAX_CHARS),
    summary: summarizeToolOutput(result.output),
    createdAt: now,
  };
  state.entries.push(entry);
  if (state.entries.length > TOOL_MEMORY_LIMIT) {
    state.entries.splice(0, state.entries.length - TOOL_MEMORY_LIMIT);
  }
  state.updatedAt = now;
  return entry;
}

function isLowSignalToolFailure(call: InternalToolCall, result: InternalToolResult): boolean {
  if (result.ok || call.name !== "shell_command") {
    return false;
  }
  return /shell policy blocked command|tool policy blocked .*protected path/i.test(result.output);
}

export function formatToolMemoryPromptSummary(state?: RuntimeToolMemoryState | null): string | null {
  if (!state || state.entries.length === 0) {
    return null;
  }
  return state.entries.slice(-TOOL_MEMORY_PROMPT_LIMIT).map((entry) => {
    const status = entry.ok ? "ok" : "failed";
    const args = entry.args && entry.args !== "{}" ? ` args=${entry.args}` : "";
    return `${entry.tool} ${status}${args}: ${entry.summary}`;
  }).join(" | ");
}

export function formatToolMemoryStatus(state: RuntimeToolMemoryState): string {
  if (state.entries.length === 0) {
    return "tool memory\nnone";
  }
  return [
    "tool memory",
    ...state.entries.slice(-TOOL_MEMORY_PROMPT_LIMIT).map((entry) => {
      const status = entry.ok ? "ok" : "failed";
      return `${entry.id} ${entry.tool} ${status}: ${entry.summary}`;
    }),
  ].join("\n");
}

function normalizeToolMemoryEntry(value: unknown): RuntimeToolMemoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const id = cleanString(entry.id);
  const tool = cleanString(entry.tool);
  const summary = cleanString(entry.summary);
  if (!id || !tool || !summary) return null;
  return {
    id,
    tool,
    ok: entry.ok !== false,
    args: cleanString(entry.args) ?? "{}",
    summary,
    createdAt: cleanString(entry.createdAt) ?? new Date(0).toISOString(),
  };
}

function summarizeToolOutput(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const useful = lines.filter((line) => !/^[-+]{3}\s/.test(line) && !/^@@/.test(line));
  const selected = useful.slice(0, 6).join(" ; ") || "no output";
  return truncate(selected.replace(/\s+/g, " "), SUMMARY_MAX_CHARS);
}

function compactJson(value: unknown, maxChars: number): string {
  try {
    return truncate(JSON.stringify(value), maxChars);
  } catch {
    return truncate(String(value), maxChars);
  }
}

function truncate(value: string, maxChars: number): string {
  const clean = value.trim();
  return clean.length <= maxChars ? clean : `${clean.slice(0, Math.max(0, maxChars - 3))}...`;
}

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
