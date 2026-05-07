import { execFileSync } from "node:child_process";

import { loadPiUsageMessages } from "./usage.js";
import type { RuntimeSession } from "./session.js";

export interface SessionTimelineEntry {
  id: string;
  at: string;
  kind: string;
  status: string;
  summary: string;
  refs: string[];
}

export function formatSessionPicker(session: RuntimeSession): string {
  const summaries = collectRecentSessionSummaries(session);
  const rows = [
    "sessions",
    `current ${session.id} status=${session.action.status} turns=${String(session.telemetry.turnCount)} goal=${formatGoalSummary(session)}`,
    ...summaries.map((summary) =>
      `${summary.id}${summary.current ? " current" : ""} messages=${String(summary.messages)} tokens=${String(summary.tokens)} last=${formatTimestamp(summary.lastAt)}`
    ),
    "",
    "commands",
    "  /sessions timeline - show current session timeline",
    "  /sessions timeline <entry-id> - inspect one timeline entry",
    "  /sessions select <session-id> - inspect session summary",
  ];
  return rows.join("\n");
}

export function formatSessionTimeline(session: RuntimeSession, entryId?: string): string {
  const entries = buildSessionTimeline(session);
  if (entryId) {
    const entry = entries.find((candidate) => candidate.id === entryId);
    if (!entry) {
      return [`timeline entry not found: ${entryId}`, "available", ...entries.slice(0, 12).map((candidate) => `  ${candidate.id} ${candidate.kind} ${candidate.summary}`)].join("\n");
    }
    return [
      "timeline entry",
      `id: ${entry.id}`,
      `at: ${entry.at}`,
      `kind: ${entry.kind}`,
      `status: ${entry.status}`,
      `summary: ${entry.summary}`,
      `refs: ${entry.refs.length > 0 ? entry.refs.join(" ") : "none"}`,
    ].join("\n");
  }
  return [
    "timeline",
    `session ${session.id}`,
    `goal ${formatGoalSummary(session)}`,
    `lastStatus ${session.action.status} · ${session.action.detail}`,
    ...entries.slice(-30).map((entry) => `${entry.id} ${formatTimestamp(entry.at)} ${entry.kind}/${entry.status} ${entry.summary}${entry.refs.length > 0 ? ` refs=${entry.refs.join(",")}` : ""}`),
    ...(entries.length === 0 ? ["empty timeline"] : []),
  ].join("\n");
}

export function formatSelectedSession(session: RuntimeSession, sessionId: string): string {
  const summary = collectRecentSessionSummaries(session).find((candidate) => candidate.id === sessionId);
  if (!summary) {
    return `session not found: ${sessionId}`;
  }
  return [
    "session selected",
    `id: ${summary.id}`,
    `current: ${String(summary.current)}`,
    `messages: ${String(summary.messages)}`,
    `tokens: ${String(summary.tokens)}`,
    `last: ${formatTimestamp(summary.lastAt)}`,
    summary.current ? `goal: ${formatGoalSummary(session)}` : "goal: unknown",
    summary.current ? `status: ${session.action.status} · ${session.action.detail}` : "status: historical usage only",
  ].join("\n");
}

export function buildSessionTimeline(session: RuntimeSession): SessionTimelineEntry[] {
  const entries: SessionTimelineEntry[] = [];
  if (session.goal?.goal) {
    entries.push({
      id: "goal",
      at: new Date(session.goal.goal.updatedAt).toISOString(),
      kind: "goal",
      status: session.goal.goal.status,
      summary: session.goal.goal.objective,
      refs: extractRefs(session.goal.goal.objective),
    });
  }
  (session.events ?? []).forEach((event, index) => {
    const text = `${event.summary}\n${event.detail ?? ""}`;
    entries.push({
      id: `e${String(index + 1)}`,
      at: event.at,
      kind: event.kind,
      status: event.status,
      summary: event.summary,
      refs: extractRefs(text),
    });
  });
  for (const [index, commit] of readRecentCommits(session.cwd).entries()) {
    entries.push({
      id: `c${String(index + 1)}`,
      at: commit.at,
      kind: "commit",
      status: "completed",
      summary: `${commit.hash} ${commit.subject}`,
      refs: extractRefs(commit.subject),
    });
  }
  return entries.sort((left, right) => left.at.localeCompare(right.at));
}

function collectRecentSessionSummaries(session: RuntimeSession): Array<{ id: string; messages: number; tokens: number; lastAt: string; current: boolean }> {
  const byId = new Map<string, { id: string; messages: number; tokens: number; lastAt: string; current: boolean }>();
  byId.set(session.id, {
    id: session.id,
    messages: Math.max(0, Math.ceil(session.conversation.length / 2)),
    tokens: session.telemetry.lastInputTokens + session.telemetry.lastOutputTokens,
    lastAt: session.action.lastActivity ?? session.startedAt,
    current: true,
  });
  for (const message of loadPiUsageMessages(session.cwd)) {
    const current = byId.get(message.sessionId) ?? { id: message.sessionId, messages: 0, tokens: 0, lastAt: new Date(0).toISOString(), current: message.sessionId === session.id };
    current.messages += 1;
    current.tokens += message.input + message.output + message.cacheRead + message.cacheWrite;
    current.lastAt = new Date(Math.max(Date.parse(current.lastAt) || 0, message.timestamp || 0)).toISOString();
    current.current = current.current || message.sessionId === session.id;
    byId.set(message.sessionId, current);
  }
  return [...byId.values()]
    .sort((left, right) => right.lastAt.localeCompare(left.lastAt))
    .slice(0, 12);
}

function readRecentCommits(cwd: string): Array<{ hash: string; at: string; subject: string }> {
  try {
    const output = execFileSync("git", ["log", "-5", "--date=iso-strict", "--pretty=format:%h%x09%cI%x09%s"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 1000,
    });
    return output.split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [hash = "", at = "", subject = ""] = line.split("\t");
        return { hash, at, subject };
      });
  } catch {
    return [];
  }
}

function formatGoalSummary(session: RuntimeSession): string {
  const goal = session.goal.goal;
  if (!goal) {
    return "none";
  }
  return `${goal.status}:${truncate(goal.objective, 80)}`;
}

function formatTimestamp(value: string): string {
  if (!value) {
    return "unknown";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toISOString();
}

function extractRefs(text: string): string[] {
  const refs = new Set<string>();
  for (const match of text.matchAll(/(?:#\d+|\b[0-9a-f]{7,40}\b|https:\/\/github\.com\/\S+)/gi)) {
    refs.add(match[0]);
  }
  return [...refs].slice(0, 8);
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 3)}...` : value;
}
