import type { InternalToolCall, InternalToolResult } from "./tools.js";

export interface RuntimeToolMemoryEntry {
  id: string;
  tool: string;
  ok: boolean;
  args: string;
  summary: string;
  detail?: string;
  createdAt: string;
}

export interface RuntimeToolMemoryState {
  entries: RuntimeToolMemoryEntry[];
  nextId: number;
  updatedAt: string | null;
}

const TOOL_MEMORY_LIMIT = 32;
const TOOL_MEMORY_PROMPT_LIMIT = 28;
const TOOL_MEMORY_PROMPT_CHAR_BUDGET = 12_000;
const SUMMARY_MAX_CHARS = 1_000;
const DETAIL_MAX_CHARS = 3_000;
const ARGS_MAX_CHARS = 260;

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
    detail: summarizeToolDetail(call.name, result.output),
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
  const lines: string[] = [];
  let usedChars = 0;
  for (const entry of state.entries.slice(-TOOL_MEMORY_PROMPT_LIMIT).reverse()) {
    const status = entry.ok ? "ok" : "failed";
    const args = entry.args && entry.args !== "{}" ? ` args=${entry.args}` : "";
    const detail = entry.detail ? `\n  evidence=${entry.detail}` : "";
    const line = `- ${entry.tool} ${status}${args}: ${entry.summary}${detail}`;
    if (usedChars + line.length > TOOL_MEMORY_PROMPT_CHAR_BUDGET && lines.length > 0) {
      break;
    }
    lines.push(line);
    usedChars += line.length;
  }
  return lines.reverse().join("\n");
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
    detail: cleanString(entry.detail) ?? undefined,
    createdAt: cleanString(entry.createdAt) ?? new Date(0).toISOString(),
  };
}

function summarizeToolOutput(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const useful = lines.filter((line) => !isLowSignalDiffLine(line));
  const header = useful.find((line) => /^\[(read_file|write_file|apply_patch|batch_edit|preview_patch|list_dir|search_content|search_files|git_status|git_diff|shell_command|nexsight_)/.test(line));
  const body = useful.filter((line) => line !== header).slice(0, 14);
  const selected = [header, ...body].filter((line): line is string => Boolean(line)).join(" ; ") || "no output";
  return truncate(selected.replace(/\s+/g, " "), SUMMARY_MAX_CHARS);
}

function summarizeToolDetail(toolName: string, output: string): string | undefined {
  const clean = output
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .filter((line) => !isLowSignalDiffLine(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!clean) {
    return undefined;
  }
  if (toolName === "read_file" || toolName === "write_file" || toolName === "apply_patch" || toolName === "batch_edit" || toolName === "preview_patch") {
    return truncate(clean, DETAIL_MAX_CHARS);
  }
  if (!/^\[(list_dir|search_content|search_files|git_status|git_diff|shell_command|nexsight_)/m.test(clean)) {
    return undefined;
  }
  return truncate(clean, DETAIL_MAX_CHARS);
}

function isLowSignalDiffLine(line: string): boolean {
  return /^[-+]{3}\s/.test(line) || /^@@/.test(line) || /^index\s+[0-9a-f]+\.\.[0-9a-f]+/.test(line);
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
