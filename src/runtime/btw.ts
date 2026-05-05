import type { RuntimeSession } from "./session.js";

export type RuntimeBtwMode = "contextual" | "tangent";

export interface RuntimeBtwExchange {
  id: string;
  mode: RuntimeBtwMode;
  question: string;
  answer: string;
  saved: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeBtwPending {
  mode: RuntimeBtwMode;
  question: string;
  save: boolean;
  startedAt: string;
}

export interface RuntimeBtwState {
  visible: boolean;
  mode: RuntimeBtwMode;
  thread: RuntimeBtwExchange[];
  pending: RuntimeBtwPending | null;
  nextId: number;
  modelOverride: string | null;
  thinkingOverride: string | null;
  updatedAt: string | null;
}

const BTW_SYSTEM_PROMPT = [
  "You are having an aside conversation with the user, separate from their main working session.",
  "If main session messages are provided, they are context only; another agent is handling that work.",
  "If no main session messages are provided, treat this as a contextless tangent.",
  "Answer the side question, explore options, or prepare handoff material.",
  "Do not continue unfinished main-session work unless user explicitly asks for injection back to it.",
].join("\n");

export function createRuntimeBtwState(value?: Partial<RuntimeBtwState> | null): RuntimeBtwState {
  const thread = Array.isArray(value?.thread)
    ? value.thread.map(normalizeBtwExchange).filter((entry): entry is RuntimeBtwExchange => Boolean(entry))
    : [];
  const maxId = thread.reduce((max, entry) => Math.max(max, Number(entry.id.replace(/^btw-/, "")) || 0), 0);
  const nextId = typeof value?.nextId === "number" && Number.isFinite(value.nextId) ? Math.floor(value.nextId) : maxId + 1;
  return {
    visible: value?.visible === true,
    mode: value?.mode === "tangent" ? "tangent" : "contextual",
    thread,
    pending: normalizeBtwPending(value?.pending),
    nextId: Math.max(1, nextId, maxId + 1),
    modelOverride: cleanOptional(value?.modelOverride),
    thinkingOverride: cleanOptional(value?.thinkingOverride),
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : null,
  };
}

export function beginBtwTurn(session: RuntimeSession, mode: RuntimeBtwMode, question: string, save: boolean): string {
  const now = new Date().toISOString();
  if (session.btw.mode !== mode) {
    session.btw.thread = [];
  }
  session.btw.mode = mode;
  session.btw.visible = true;
  session.btw.pending = { mode, question, save, startedAt: now };
  session.btw.updatedAt = now;
  return buildBtwProviderPrompt(session, mode, question);
}

export function completeBtwTurn(session: RuntimeSession, answer: string): RuntimeBtwExchange | null {
  const pending = session.btw.pending;
  if (!pending) {
    return null;
  }
  const now = new Date().toISOString();
  const exchange: RuntimeBtwExchange = {
    id: `btw-${String(session.btw.nextId++)}`,
    mode: pending.mode,
    question: pending.question,
    answer: answer.trim() || "(No text response)",
    saved: pending.save,
    createdAt: pending.startedAt,
    updatedAt: now,
  };
  session.btw.thread.push(exchange);
  session.btw.pending = null;
  session.btw.visible = true;
  session.btw.updatedAt = now;
  return exchange;
}

export function cancelBtwTurn(session: RuntimeSession): void {
  if (session.btw.pending) {
    session.btw.pending = null;
    session.btw.updatedAt = new Date().toISOString();
  }
}

export function clearBtwThread(session: RuntimeSession, mode: RuntimeBtwMode = session.btw.mode): void {
  session.btw.mode = mode;
  session.btw.thread = [];
  session.btw.pending = null;
  session.btw.visible = false;
  session.btw.updatedAt = new Date().toISOString();
}

export function formatBtwStatus(state: RuntimeBtwState): string {
  const lines = [
    "btw",
    `mode: ${state.mode}`,
    `visible: ${String(state.visible)}`,
    `pending: ${state.pending ? state.pending.question : "none"}`,
    `thread: ${String(state.thread.length)} exchange(s)`,
    `model: ${state.modelOverride ?? "inherits main"}`,
    `thinking: ${state.thinkingOverride ?? "inherits main"}`,
  ];
  const latest = state.thread.at(-1);
  if (latest) {
    lines.push(`latest: ${latest.question}`);
  }
  return lines.join("\n");
}

export function formatBtwOverlayRows(state: RuntimeBtwState, width: number): Array<{ key: string; text: string; fg: string }> {
  if (!state.visible && !state.pending) {
    return [];
  }
  const rows: Array<{ key: string; text: string; fg: string }> = [];
  const title = state.pending ? `btw ${state.mode} running` : `btw ${state.mode}`;
  rows.push({ key: "btw-title", text: fitBtwLine(title, width), fg: "#89b4fa" });
  if (state.pending) {
    rows.push({ key: "btw-pending", text: fitBtwLine(`[?] ${state.pending.question}`, width), fg: "#f9e2af" });
    return rows;
  }
  for (const entry of state.thread.slice(-2)) {
    rows.push({ key: `${entry.id}-q`, text: fitBtwLine(`[q] ${entry.question}`, width), fg: "#cdd6f4" });
    rows.push({ key: `${entry.id}-a`, text: fitBtwLine(`[a] ${firstLine(entry.answer)}`, width), fg: "#a6e3a1" });
  }
  return rows;
}

export function buildBtwInjectPrompt(state: RuntimeBtwState, instructions: string, summarize: boolean): string {
  const thread = formatBtwThread(state);
  const header = summarize
    ? "Use this summarized side conversation handoff to continue the main task."
    : "Use this side conversation thread to continue the main task.";
  return [
    header,
    instructions.trim() ? `Instructions: ${instructions.trim()}` : null,
    "",
    summarize ? summarizeBtwThread(state) : thread,
  ].filter((line): line is string => line !== null).join("\n");
}

export function summarizeBtwThread(state: RuntimeBtwState): string {
  if (state.thread.length === 0) {
    return "No BTW thread.";
  }
  return state.thread.map((entry) => `- ${entry.question}: ${firstLine(entry.answer)}`).join("\n");
}

export function formatBtwThread(state: RuntimeBtwState): string {
  if (state.thread.length === 0) {
    return "No BTW thread.";
  }
  return state.thread.map((entry) => `User: ${entry.question}\nAssistant: ${entry.answer}`).join("\n\n---\n\n");
}

function buildBtwProviderPrompt(session: RuntimeSession, mode: RuntimeBtwMode, question: string): string {
  const context = mode === "contextual"
    ? session.conversation.slice(-8).map((turn) => `${turn.role}: ${turn.content}`).join("\n")
    : "";
  const thread = formatBtwThread(session.btw);
  return [
    BTW_SYSTEM_PROMPT,
    mode === "contextual" && context ? `\nMain session context:\n${context}` : "\nMain session context: none",
    session.btw.thread.length > 0 ? `\nExisting BTW thread:\n${thread}` : "\nExisting BTW thread: none",
    `\nSide question:\n${question}`,
  ].join("\n");
}

function normalizeBtwExchange(value: unknown): RuntimeBtwExchange | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const id = cleanOptional(entry.id);
  const question = cleanOptional(entry.question);
  const answer = cleanOptional(entry.answer);
  if (!id || !question || !answer) return null;
  return {
    id,
    mode: entry.mode === "tangent" ? "tangent" : "contextual",
    question,
    answer,
    saved: entry.saved === true,
    createdAt: cleanOptional(entry.createdAt) ?? new Date(0).toISOString(),
    updatedAt: cleanOptional(entry.updatedAt) ?? new Date(0).toISOString(),
  };
}

function normalizeBtwPending(value: unknown): RuntimeBtwPending | null {
  if (!value || typeof value !== "object") return null;
  const pending = value as Record<string, unknown>;
  const question = cleanOptional(pending.question);
  if (!question) return null;
  return {
    mode: pending.mode === "tangent" ? "tangent" : "contextual",
    question,
    save: pending.save === true,
    startedAt: cleanOptional(pending.startedAt) ?? new Date().toISOString(),
  };
}

function cleanOptional(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function fitBtwLine(value: string, width: number): string {
  const clean = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
  return clean.length <= width ? clean : `${clean.slice(0, Math.max(0, width - 3))}...`;
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "(empty)";
}
