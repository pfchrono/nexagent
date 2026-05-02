import { mkdir, readFile, writeFile } from "node:fs/promises";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { RuntimeSession } from "./session.js";

interface ArchivistEntry {
  type: string;
  content: string;
  summary?: string;
  tags?: string[];
  projectPath?: string;
  createdAt?: string;
}

interface ArchivistStore {
  version: string;
  entries: ArchivistEntry[];
}

interface ArchivistRecallResult {
  used: boolean;
  sourceCategory: string | null;
  matchCount: number;
  preview: string | null;
}

export interface ArchivistMaintenanceResult {
  storagePath: string;
  totalBefore: number;
  totalAfter: number;
  removedDuplicates: number;
  duplicateSuspects: number;
  stale: number;
  noisy: number;
  persisted: boolean;
}

const ARCHIVIST_STORE_VERSION = "1.0.0";
const ARCHIVIST_MAX_ENTRIES = 200;
const ARCHIVIST_MAX_SUMMARY = 240;
const ARCHIVIST_MAX_CONTENT = 2_000;
const ARCHIVIST_MAX_TAGS = 8;
const ARCHIVIST_RETRIEVAL_MAX_MATCHES = 3;
const ARCHIVIST_RECENT_BONUS_DAYS = 30;

export async function applyArchivistRetrieval(session: RuntimeSession, prompt: string): Promise<void> {
  if (!session.archivist.enabled || !session.archivist.storagePath || !session.archivist.storageExists) {
    resetArchivistRetrieval(session);
    return;
  }

  const entries = await loadArchivistEntries(session.archivist.storagePath);
  session.archivist.retrieval = selectRelevantArchivistEntries(entries, session, prompt);
  updateArchivistDiagnostics(session, entries);
}

export async function saveArchivistMemory(
  session: RuntimeSession,
  input: { summary: string; content?: string; tags?: string[]; type?: string },
): Promise<{ entryCount: number; preview: string }> {
  const storagePath = getWritableArchivistPath(session);
  const summary = truncate(normalizeText(input.summary), ARCHIVIST_MAX_SUMMARY);
  if (!summary) {
    throw new Error("summary required");
  }

  const content = truncate(normalizeText(input.content ?? summary), ARCHIVIST_MAX_CONTENT);
  const tags = normalizeTags(input.tags);
  const type = input.type?.trim() || "memory";
  const createdAt = new Date().toISOString();
  const store = await loadArchivistStore(storagePath);
  const entry: ArchivistEntry = {
    type,
    summary,
    content,
    tags,
    projectPath: session.repo.root ?? session.cwd,
    createdAt,
  };

  store.entries.push(entry);
  store.entries = store.entries.slice(-ARCHIVIST_MAX_ENTRIES);
  await persistArchivistStore(storagePath, store);

  session.archivist.storageExists = true;
  session.archivist.writes = {
    used: true,
    action: "save",
    sourceCategory: "memory-save",
    savedAt: createdAt,
    entryCount: store.entries.length,
    preview: `- [${type}] ${summary}`,
  };
  updateArchivistDiagnostics(session, store.entries);

  return {
    entryCount: store.entries.length,
    preview: session.archivist.writes.preview ?? `- [${type}] ${summary}`,
  };
}

export async function checkpointArchivistSession(
  session: RuntimeSession,
  reason?: string,
): Promise<{ entryCount: number; preview: string }> {
  const storagePath = getWritableArchivistPath(session);
  const createdAt = new Date().toISOString();
  const snapshot = summarizeCheckpointState(session, reason);
  const store = await loadArchivistStore(storagePath);
  const entry: ArchivistEntry = {
    type: "checkpoint",
    summary: snapshot.summary,
    content: snapshot.content,
    tags: ["checkpoint", session.provider],
    projectPath: session.repo.root ?? session.cwd,
    createdAt,
  };

  store.entries.push(entry);
  store.entries = store.entries.slice(-ARCHIVIST_MAX_ENTRIES);
  await persistArchivistStore(storagePath, store);

  session.archivist.storageExists = true;
  session.archivist.writes = {
    used: true,
    action: "checkpoint",
    sourceCategory: "session-checkpoint",
    savedAt: createdAt,
    entryCount: store.entries.length,
    preview: `- [checkpoint] ${snapshot.summary}`,
  };
  updateArchivistDiagnostics(session, store.entries);

  return {
    entryCount: store.entries.length,
    preview: session.archivist.writes.preview ?? `- [checkpoint] ${snapshot.summary}`,
  };
}

export function maintainArchivistMemorySync(session: RuntimeSession): ArchivistMaintenanceResult {
  const storagePath = getWritableArchivistPath(session);
  const store = loadArchivistStoreSync(storagePath);
  const totalBefore = store.entries.length;
  const deduped = dedupeArchivistEntries(store.entries);
  store.entries = deduped.entries;

  if (deduped.removedDuplicates > 0) {
    persistArchivistStoreSync(storagePath, store);
    session.archivist.storageExists = true;
  }

  updateArchivistDiagnostics(session, store.entries);

  return {
    storagePath,
    totalBefore,
    totalAfter: store.entries.length,
    removedDuplicates: deduped.removedDuplicates,
    duplicateSuspects: countDuplicateSuspectSummaries(store.entries),
    stale: store.entries.filter((entry) => isStaleArchivistEntry(entry.createdAt)).length,
    noisy: store.entries.filter((entry) => tokenize(entry.summary ?? entry.content).length < 3).length,
    persisted: deduped.removedDuplicates > 0,
  };
}

function getWritableArchivistPath(session: RuntimeSession): string {
  if (!session.archivist.enabled || !session.archivist.storagePath) {
    throw new Error("archivist unavailable");
  }
  return session.archivist.storagePath;
}

function resetArchivistRetrieval(session: RuntimeSession): void {
  session.archivist.retrieval.used = false;
  session.archivist.retrieval.sourceCategory = null;
  session.archivist.retrieval.matchCount = 0;
  session.archivist.retrieval.preview = null;
  updateArchivistDiagnostics(session, []);
}

function updateArchivistDiagnostics(session: RuntimeSession, entries: ArchivistEntry[]): void {
  session.archivist.diagnostics = {
    retrievalMatchCount: session.archivist.retrieval.matchCount,
    retrievalSourceCategory: session.archivist.retrieval.sourceCategory,
    saveCount: entries.filter((entry) => (entry.type ?? "memory") !== "checkpoint").length,
    checkpointCount: entries.filter((entry) => (entry.type ?? "memory") === "checkpoint").length,
    duplicateSuspectCount: countDuplicateSuspectSummaries(entries),
    staleSignalCount: entries.filter((entry) => isStaleArchivistEntry(entry.createdAt)).length,
    noisySignalCount: entries.filter((entry) => tokenize(entry.summary ?? entry.content).length < 3).length,
  };
}

function countDuplicateSuspectSummaries(entries: ArchivistEntry[]): number {
  const seen = new Map<string, number>();
  for (const entry of entries) {
    const normalized = normalizeText(entry.summary ?? entry.content).toLowerCase();
    if (!normalized) {
      continue;
    }
    seen.set(normalized, (seen.get(normalized) ?? 0) + 1);
  }
  return [...seen.values()].reduce((count, duplicates) => count + Math.max(0, duplicates - 1), 0);
}

function isStaleArchivistEntry(createdAt?: string): boolean {
  if (!createdAt) {
    return false;
  }
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs)) {
    return false;
  }
  return (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24) > 90;
}

async function loadArchivistEntries(storagePath: string): Promise<ArchivistEntry[]> {
  const store = await loadArchivistStore(storagePath);
  return store.entries;
}

async function loadArchivistStore(storagePath: string): Promise<ArchivistStore> {
  try {
    const raw = await readFile(storagePath, "utf8");
    return normalizeArchivistStore(JSON.parse(raw) as unknown);
  } catch {
    return {
      version: ARCHIVIST_STORE_VERSION,
      entries: [],
    };
  }
}

function loadArchivistStoreSync(storagePath: string): ArchivistStore {
  try {
    const raw = readFileSync(storagePath, "utf8");
    return normalizeArchivistStore(JSON.parse(raw) as unknown);
  } catch {
    return {
      version: ARCHIVIST_STORE_VERSION,
      entries: [],
    };
  }
}

async function persistArchivistStore(storagePath: string, store: ArchivistStore): Promise<void> {
  await mkdir(path.dirname(storagePath), { recursive: true });
  await writeFile(storagePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function persistArchivistStoreSync(storagePath: string, store: ArchivistStore): void {
  mkdirSync(path.dirname(storagePath), { recursive: true });
  writeFileSync(storagePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function dedupeArchivistEntries(entries: ArchivistEntry[]): { entries: ArchivistEntry[]; removedDuplicates: number } {
  const selected = new Map<string, { entry: ArchivistEntry; index: number }>();
  let removedDuplicates = 0;

  entries.forEach((entry, index) => {
    const key = createArchivistDedupKey(entry);
    const existing = selected.get(key);
    if (!existing) {
      selected.set(key, { entry, index });
      return;
    }

    removedDuplicates += 1;
    if (compareArchivistRecency(entry.createdAt, existing.entry.createdAt) > 0) {
      selected.set(key, { entry, index });
    }
  });

  return {
    entries: [...selected.values()]
      .sort((left, right) => left.index - right.index)
      .map(({ entry }) => entry),
    removedDuplicates,
  };
}

function createArchivistDedupKey(entry: ArchivistEntry): string {
  const tags = (entry.tags ?? [])
    .map((tag) => normalizeText(tag).toLowerCase())
    .sort()
    .join(",");
  return [
    normalizeText(entry.type ?? "memory").toLowerCase(),
    normalizeText(entry.summary ?? entry.content).toLowerCase(),
    normalizeText(entry.content).toLowerCase(),
    normalizeText(entry.projectPath ?? "").toLowerCase(),
    tags,
  ].join("\u0000");
}

function normalizeArchivistStore(value: unknown): ArchivistStore {
  return {
    version: ARCHIVIST_STORE_VERSION,
    entries: normalizeArchivistEntries(value),
  };
}

function normalizeArchivistEntries(value: unknown): ArchivistEntry[] {
  if (Array.isArray(value)) {
    return value.flatMap(normalizeArchivistEntry);
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.entries)) {
      return record.entries.flatMap(normalizeArchivistEntry);
    }
    if (Array.isArray(record.memories)) {
      return record.memories.flatMap(normalizeArchivistEntry);
    }
  }

  return [];
}

function normalizeArchivistEntry(value: unknown): ArchivistEntry[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const content = typeof record.content === "string"
    ? record.content
    : typeof record.summary === "string"
      ? record.summary
      : null;

  if (!content) {
    return [];
  }

  return [{
    content,
    summary: typeof record.summary === "string" ? record.summary : undefined,
    type: typeof record.type === "string" ? record.type : "memory",
    tags: Array.isArray(record.tags) ? record.tags.filter((tag): tag is string => typeof tag === "string").slice(0, ARCHIVIST_MAX_TAGS) : undefined,
    projectPath: typeof record.projectPath === "string" ? record.projectPath : undefined,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
  }];
}

function selectRelevantArchivistEntries(entries: ArchivistEntry[], session: RuntimeSession, prompt: string): ArchivistRecallResult {
  const keywords = tokenize(prompt);
  if (entries.length === 0 || keywords.length === 0) {
    return idleRecall();
  }

  const repoRoot = session.repo.root ?? session.cwd;
  const scored = entries
    .map((entry) => ({ entry, score: scoreArchivistEntry(entry, keywords, repoRoot) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return compareArchivistRecency(right.entry.createdAt, left.entry.createdAt);
    })
    .slice(0, ARCHIVIST_RETRIEVAL_MAX_MATCHES);

  if (scored.length === 0) {
    return idleRecall();
  }

  return {
    used: true,
    sourceCategory: scored.some(({ entry }) => entry.projectPath && repoRoot.startsWith(entry.projectPath)) ? "project-memory" : "user-memory",
    matchCount: scored.length,
    preview: scored.map(({ entry }) => `- [${entry.type ?? "memory"}] ${truncate(entry.summary ?? entry.content, 180)}`).join("\n"),
  };
}

function idleRecall(): ArchivistRecallResult {
  return {
    used: false,
    sourceCategory: null,
    matchCount: 0,
    preview: null,
  };
}

function summarizeCheckpointState(session: RuntimeSession, reason?: string): { summary: string; content: string } {
  const summaryParts = [
    reason ? `reason=${normalizeText(reason)}` : null,
    `provider=${session.provider}`,
    `transport=${session.providerTransport.mode}`,
    `turns=${String(session.telemetry.turnCount)}`,
    `styles=${[
      ...(session.commandModes.deadpoolMode ? ["deadpool"] : []),
      ...(session.commandModes.cavemanMode ? ["caveman"] : []),
    ].join("+") || "normal"}`,
    session.compaction.summary ? truncate(session.compaction.summary, 120) : null,
  ].filter((value): value is string => Boolean(value));

  const recentTurns = session.conversation
    .slice(-4)
    .map((turn) => `${turn.role}: ${truncate(normalizeText(turn.content), 220)}`)
    .join("\n");

  const content = truncate([
    `Checkpoint summary`,
    summaryParts.join(" | "),
    recentTurns.length > 0 ? `Recent turns:\n${recentTurns}` : "Recent turns:\n(none)",
  ].join("\n\n"), ARCHIVIST_MAX_CONTENT);

  return {
    summary: truncate(summaryParts.join(" | "), ARCHIVIST_MAX_SUMMARY),
    content,
  };
}

function scoreArchivistEntry(entry: ArchivistEntry, keywords: string[], repoRoot: string): number {
  let score = 0;
  let matchedKeyword = false;
  const summary = (entry.summary ?? "").toLowerCase();
  const content = entry.content.toLowerCase();
  const type = (entry.type ?? "").toLowerCase();
  const tags = (entry.tags ?? []).map((tag) => tag.toLowerCase());

  for (const keyword of keywords) {
    let keywordScore = 0;
    if (summary.includes(keyword)) {
      keywordScore += 4;
    }
    if (tags.some((tag) => tag === keyword || tag.includes(keyword) || keyword.includes(tag))) {
      keywordScore += 3;
    }
    if (type.includes(keyword)) {
      keywordScore += 2;
    }
    if (content.includes(keyword)) {
      keywordScore += 1;
    }
    if (keywordScore > 0) {
      matchedKeyword = true;
      score += keywordScore;
    }
  }

  if (!matchedKeyword) {
    return 0;
  }

  if (entry.projectPath && repoRoot.startsWith(entry.projectPath)) {
    score += 2;
  }

  if ((entry.type ?? "").toLowerCase() === "checkpoint") {
    score -= 2;
  }

  score += getArchivistRecencyBonus(entry.createdAt);

  return score;
}

function getArchivistRecencyBonus(createdAt?: string): number {
  if (!createdAt) {
    return 0;
  }

  const createdAtMs = Date.parse(createdAt);
  if (Number.isNaN(createdAtMs)) {
    return 0;
  }

  const ageDays = (Date.now() - createdAtMs) / (1000 * 60 * 60 * 24);
  if (ageDays <= 1) {
    return 1.5;
  }
  if (ageDays <= 7) {
    return 1;
  }
  if (ageDays <= ARCHIVIST_RECENT_BONUS_DAYS) {
    return 0.5;
  }
  return 0;
}

function compareArchivistRecency(left?: string, right?: string): number {
  const leftMs = left ? Date.parse(left) : Number.NaN;
  const rightMs = right ? Date.parse(right) : Number.NaN;
  const safeLeft = Number.isNaN(leftMs) ? 0 : leftMs;
  const safeRight = Number.isNaN(rightMs) ? 0 : rightMs;
  return safeLeft - safeRight;
}

function tokenize(value: string): string[] {
  return Array.from(new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9_/-]+/)
      .map((part) => part.trim())
      .filter((part) => part.length >= 3),
  ));
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeTags(value?: string[]): string[] | undefined {
  const tags = (value ?? [])
    .map((tag) => normalizeText(tag).toLowerCase())
    .filter((tag) => tag.length > 0)
    .slice(0, ARCHIVIST_MAX_TAGS);
  return tags.length > 0 ? tags : undefined;
}

function truncate(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, limit - 1))}…`;
}
