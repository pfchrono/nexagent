import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RuntimeSession } from "./session.js";

export interface NexsightExecuteInput {
  language: string;
  code: string;
  timeoutMs?: number;
}

export interface NexsightIndexInput {
  source: string;
  content: string;
}

export interface NexsightBatchInput {
  root?: string;
  pattern?: string;
  limit?: number;
}

export interface NexsightSearchInput {
  query: string;
  limit?: number;
}

export interface NexsightResult {
  ok: boolean;
  output: string;
}

interface NexsightChunk {
  id: string;
  source: string;
  title: string;
  content: string;
  createdAt: string;
}

type NexsightRuntime = { ok: true; command: string; args: string[]; scriptName: string } | { ok: false; error: string };

type SqliteStatement = {
  run: (...values: unknown[]) => unknown;
  all: (...values: unknown[]) => unknown[];
  get: (...values: unknown[]) => unknown;
};

type SqliteDatabase = {
  exec: (sql: string) => unknown;
  prepare: (sql: string) => SqliteStatement;
  transaction: <T extends (...args: never[]) => unknown>(fn: T) => T;
  close: () => void;
};

type SqliteConstructor = new (filename: string) => SqliteDatabase;

const NEXSIGHT_TIMEOUT_MS = 30_000;
const NEXSIGHT_MAX_OUTPUT_CHARS = 8_000;
const NEXSIGHT_PROCESS_MAX_BUFFER_CHARS = 1_000_000;
const NEXSIGHT_MAX_INDEX_CHARS = 240_000;
const NEXSIGHT_CHUNK_CHARS = 2_400;
const NEXSIGHT_MAX_CHUNKS = 500;
const NEXSIGHT_MAX_FILE_CHARS = 120_000;
const NEXSIGHT_SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".nexagent"]);
const NEXSIGHT_TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".json", ".md", ".txt", ".yaml", ".yml", ".toml", ".css", ".html", ".sh",
]);
const NEXSIGHT_LANGUAGES = new Set(["shell", "javascript", "python"]);
const require = createRequire(import.meta.url);
let sqliteConstructor: SqliteConstructor | null | undefined;
const NEXSIGHT_BLOCKED_SHELL = [
  /\brm\s+-rf\b/i,
  /\brm\s+-r\b/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\b/i,
  /\bfind\b[\s\S]*\b-delete\b/i,
  /\|\s*sh\b/i,
  /\|\s*bash\b/i,
] as const;

export function executeNexsight(session: RuntimeSession, input: NexsightExecuteInput): NexsightResult {
  const language = input.language.trim().toLowerCase();
  if (!NEXSIGHT_LANGUAGES.has(language)) {
    return fail(`unsupported language ${language || "(empty)"}; use shell, javascript, or python`);
  }
  if (!input.code.trim()) {
    return fail("code or command required; nexsight_execute needs executable code, not a natural-language task");
  }
  if (language === "shell") {
    const blockedPattern = NEXSIGHT_BLOCKED_SHELL.find((pattern) => pattern.test(input.code));
    if (blockedPattern) {
      return fail(`nexsight blocked shell; destructive pattern matched: ${blockedPattern.source}`);
    }
  }

  const timeout = Math.max(500, Math.min(input.timeoutMs ?? NEXSIGHT_TIMEOUT_MS, NEXSIGHT_TIMEOUT_MS));
  const tempDir = mkdtempSync(path.join(tmpdir(), "nexsight-"));
  const runtime = resolveNexsightRuntime(language);
  if (!runtime.ok) {
    rmSync(tempDir, { recursive: true, force: true });
    return fail(runtime.error);
  }
  const scriptPath = path.join(tempDir, runtime.scriptName);
  try {
    writeFileSync(scriptPath, input.code, { encoding: "utf8", mode: 0o700 });
    const result = spawnSync(runtime.command, [...runtime.args, scriptPath], {
      cwd: session.cwd,
      encoding: "utf8",
      timeout,
      env: {
        ...process.env,
        HOME: process.env.HOME ?? session.cwd,
        NEXAGENT_CWD: session.cwd,
        TMPDIR: tempDir,
      },
      maxBuffer: NEXSIGHT_PROCESS_MAX_BUFFER_CHARS,
    });

    const transcript = [result.stdout?.trimEnd() ?? "", result.stderr?.trimEnd() ?? ""]
      .filter((value) => value.length > 0)
      .join("\n");
    const capped = capOutput(transcript || "(no output)");
    const header = [
      `language: ${language}`,
      `exit: ${String(result.status ?? (result.error ? 1 : 0))}`,
      `timedOut: ${String(Boolean(result.signal === "SIGTERM" || result.error?.message.includes("ETIMEDOUT")))}`,
    ].join("\n");

    if (result.error) {
      return fail(`${header}\n${capped}`);
    }
    if ((result.status ?? 0) !== 0) {
      return fail(`${header}\n${capped}`);
    }
    return ok(capped);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function resolveNexsightRuntime(
  language: string,
  options: { execPath?: string; env?: NodeJS.ProcessEnv } = {},
): NexsightRuntime {
  if (language === "shell") {
    return { ok: true, command: "bash", args: [], scriptName: "script.sh" };
  }
  if (language === "javascript") {
    return resolveJavaScriptRuntime(options.execPath ?? process.execPath, options.env ?? process.env);
  }

  const python = resolvePythonCommand();
  return python
    ? { ok: true, command: python, args: [], scriptName: "script.py" }
    : { ok: false, error: "python unavailable; install python3 or use javascript/shell" };
}

function resolveJavaScriptRuntime(execPath: string, env: NodeJS.ProcessEnv): NexsightRuntime {
  const execName = path.basename(execPath).toLowerCase();
  if (execName === "bun" || execName === "bun.exe" || execName === "node" || execName === "node.exe") {
    return { ok: true, command: execPath, args: [], scriptName: "script.js" };
  }

  const candidates = [
    env.NEXSIGHT_JS_RUNTIME,
    env.BUN_INSTALL ? path.join(env.BUN_INSTALL, "bin", "bun") : null,
    "bun",
    "node",
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of [...new Set(candidates)]) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
    if (!result.error && (result.status ?? 0) === 0) {
      return { ok: true, command: candidate, args: [], scriptName: "script.js" };
    }
  }

  return { ok: false, error: "javascript runtime unavailable; install bun or node" };
}

function resolvePythonCommand(): string | null {
  for (const command of ["python3", "python"]) {
    const result = spawnSync(command, ["--version"], { encoding: "utf8", stdio: ["ignore", "ignore", "ignore"] });
    if (!result.error && (result.status ?? 0) === 0) {
      return command;
    }
  }
  return null;
}

export function indexNexsight(session: RuntimeSession, input: NexsightIndexInput): NexsightResult {
  const source = input.source.trim();
  const content = input.content.trim();
  if (!source) {
    return fail("source required");
  }
  if (!content) {
    return fail("content required");
  }

  const nextChunks = chunkContent(source, content.slice(0, NEXSIGHT_MAX_INDEX_CHARS));
  const db = openNexsightDatabase(session);
  if (db) {
    replaceSourceInSqlite(db, source, nextChunks);
    db.close();
  } else {
    const chunks = loadJsonChunks(session).filter((chunk) => chunk.source !== source);
    const retained = [...chunks, ...nextChunks].slice(-NEXSIGHT_MAX_CHUNKS);
    saveJsonChunks(session, retained);
  }
  return ok(`indexed ${source} (${String(nextChunks.length)} chunks, ${String(content.length)} chars)`);
}

export function indexNexsightFile(session: RuntimeSession, source: string, filePath: string): NexsightResult {
  try {
    const stats = statSync(filePath);
    if (!stats.isFile()) {
      return fail(`${filePath} is not a file`);
    }
    return indexNexsight(session, {
      source,
      content: readFileSync(filePath, "utf8"),
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}

export function batchIndexNexsight(session: RuntimeSession, input: NexsightBatchInput = {}): NexsightResult {
  const root = path.resolve(session.cwd, input.root ?? ".");
  const pattern = input.pattern?.trim() ?? "";
  const limit = Math.max(1, Math.min(input.limit ?? 100, 400));
  const files = collectIndexableFiles(root, pattern, limit);
  let indexed = 0;
  let skipped = 0;
  const db = openNexsightDatabase(session);
  let chunks = db ? [] : loadJsonChunks(session).filter((chunk) => !chunk.source.startsWith("repo:"));
  if (db) {
    db.prepare("DELETE FROM chunks WHERE source LIKE ?").run("repo:%");
    db.prepare("DELETE FROM chunks_fts WHERE source LIKE ?").run("repo:%");
  }

  for (const file of files) {
    try {
      const content = readFileSync(file, "utf8");
      const rel = path.relative(session.cwd, file).split(path.sep).join("/");
      const fileChunks = chunkContent(`repo:${rel}`, content.slice(0, NEXSIGHT_MAX_FILE_CHARS));
      if (db) {
        replaceSourceInSqlite(db, `repo:${rel}`, fileChunks);
      } else {
        chunks = chunks.filter((chunk) => chunk.source !== `repo:${rel}`);
        chunks.push(...fileChunks);
      }
      indexed += 1;
    } catch {
      skipped += 1;
    }
  }

  const retainedChunks = db ? countSqliteChunks(db) : chunks.length;
  if (db) {
    db.close();
  } else {
    saveJsonChunks(session, chunks.slice(-NEXSIGHT_MAX_CHUNKS));
  }
  return ok(`indexed repo (${String(indexed)} files, ${String(skipped)} skipped, ${String(retainedChunks)} chunks retained)`);
}

export function getNexsightStats(session: RuntimeSession): NexsightResult {
  const db = openNexsightDatabase(session);
  if (db) {
    const stats = getSqliteStats(db);
    db.close();
    return ok([
      "nexsight",
      "backend: sqlite-fts5",
      `store: ${sqliteIndexPath(session)}`,
      `sources: ${String(stats.sources)}`,
      `chunks: ${String(stats.chunks)}`,
      `chars: ${String(stats.chars)}`,
    ].join("\n"));
  }
  const chunks = loadJsonChunks(session);
  const sources = new Set(chunks.map((chunk) => chunk.source));
  const chars = chunks.reduce((sum, chunk) => sum + chunk.content.length, 0);
  return ok([
    "nexsight",
    "backend: json-fallback",
    `store: ${jsonIndexPath(session)}`,
    `sources: ${String(sources.size)}`,
    `chunks: ${String(chunks.length)}`,
    `chars: ${String(chars)}`,
  ].join("\n"));
}

export function purgeNexsight(session: RuntimeSession): NexsightResult {
  for (const targetPath of [sqliteIndexPath(session), `${sqliteIndexPath(session)}-wal`, `${sqliteIndexPath(session)}-shm`, jsonIndexPath(session)]) {
    try {
      unlinkSync(targetPath);
    } catch {
      // Missing store is already purged.
    }
  }
  return ok("nexsight purged");
}

export function checkpointNexsightSession(session: RuntimeSession, label = "session"): NexsightResult {
  const events = session.events.slice(-40).map((event) => [
    `${event.at} ${event.kind} ${event.status} ${event.summary}`,
    event.detail ?? "",
  ].filter(Boolean).join("\n")).join("\n\n");
  if (!events.trim()) {
    return ok("no session events to index");
  }
  return indexNexsight(session, {
    source: `session:${label}:${new Date().toISOString()}`,
    content: events,
  });
}

export function searchNexsight(session: RuntimeSession, input: NexsightSearchInput): NexsightResult {
  const query = input.query.trim();
  if (!query) {
    return fail("query required");
  }

  const terms = tokenize(query);
  const limit = Math.max(1, Math.min(input.limit ?? 5, 12));
  const db = openNexsightDatabase(session);
  if (db) {
    const results = searchSqlite(db, query, terms, limit);
    db.close();
    if (results.length === 0) {
      return ok("(no matches)");
    }
    return ok(formatSearchResults(results, terms));
  }

  const results = loadJsonChunks(session)
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, terms) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  if (results.length === 0) {
    return ok("(no matches)");
  }

  return ok(formatSearchResults(results, terms));
}

function formatSearchResults(results: Array<{ chunk: NexsightChunk; score: number }>, terms: string[]): string {
  return results.map(({ chunk, score }, index) => [
    `${String(index + 1)}. ${chunk.source} :: ${chunk.title} · score ${score.toFixed(2)}`,
    excerpt(chunk.content, terms),
  ].join("\n")).join("\n\n");
}

function chunkContent(source: string, content: string): NexsightChunk[] {
  const chunks: NexsightChunk[] = [];
  let index = 0;
  for (let start = 0; start < content.length; start += NEXSIGHT_CHUNK_CHARS) {
    const part = content.slice(start, start + NEXSIGHT_CHUNK_CHARS).trim();
    if (!part) {
      continue;
    }
    index += 1;
    chunks.push({
      id: `${source}:${String(index)}`,
      source,
      title: inferTitle(part, index),
      content: part,
      createdAt: new Date().toISOString(),
    });
  }
  return chunks;
}

function inferTitle(content: string, index: number): string {
  const heading = content.split("\n").find((line) => /^#{1,6}\s+\S/.test(line.trim()));
  if (heading) {
    return heading.replace(/^#{1,6}\s+/, "").trim().slice(0, 80);
  }
  return `chunk ${String(index)}`;
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9_/-]+/)
    .filter((term) => term.length >= 2);
}

function scoreChunk(chunk: NexsightChunk, terms: string[]): number {
  const haystack = `${chunk.source}\n${chunk.title}\n${chunk.content}`.toLowerCase();
  return terms.reduce((score, term) => {
    const matches = haystack.split(term).length - 1;
    return score + matches * (chunk.title.toLowerCase().includes(term) ? 2 : 1);
  }, 0);
}

function excerpt(content: string, terms: string[]): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  const lower = normalized.toLowerCase();
  const firstHit = terms
    .map((term) => lower.indexOf(term))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0] ?? 0;
  const start = Math.max(0, firstHit - 120);
  return capOutput(normalized.slice(start, start + 420));
}

function loadJsonChunks(session: RuntimeSession): NexsightChunk[] {
  try {
    return JSON.parse(readFileSync(jsonIndexPath(session), "utf8")) as NexsightChunk[];
  } catch {
    return [];
  }
}

function saveJsonChunks(session: RuntimeSession, chunks: NexsightChunk[]): void {
  const targetPath = jsonIndexPath(session);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, JSON.stringify(chunks, null, 2), "utf8");
}

function openNexsightDatabase(session: RuntimeSession): SqliteDatabase | null {
  const Database = loadSqliteConstructor();
  if (!Database) {
    return null;
  }

  const targetPath = sqliteIndexPath(session);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  const db = new Database(targetPath);
  db.exec([
    "PRAGMA journal_mode = WAL",
    "PRAGMA synchronous = NORMAL",
    "CREATE TABLE IF NOT EXISTS chunks (id TEXT PRIMARY KEY, source TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source)",
    "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(id UNINDEXED, source, title, content, tokenize='unicode61')",
  ].join(";"));
  migrateJsonToSqlite(session, db);
  return db;
}

function loadSqliteConstructor(): SqliteConstructor | null {
  if (sqliteConstructor !== undefined) {
    return sqliteConstructor;
  }
  try {
    const runtime = process.versions as Record<string, string | undefined>;
    const loaded = runtime.bun
      ? (require("bun:sqlite") as { Database: SqliteConstructor }).Database
      : (require("better-sqlite3") as SqliteConstructor);
    sqliteConstructor = loaded;
  } catch {
    sqliteConstructor = null;
  }
  return sqliteConstructor;
}

function migrateJsonToSqlite(session: RuntimeSession, db: SqliteDatabase): void {
  const count = countSqliteChunks(db);
  if (count > 0) {
    return;
  }
  const chunks = loadJsonChunks(session);
  if (chunks.length === 0) {
    return;
  }
  insertChunksSqlite(db, chunks);
}

function replaceSourceInSqlite(db: SqliteDatabase, source: string, chunks: NexsightChunk[]): void {
  const run = db.transaction(() => {
    db.prepare("DELETE FROM chunks WHERE source = ?").run(source);
    db.prepare("DELETE FROM chunks_fts WHERE source = ?").run(source);
    insertChunksSqlite(db, chunks);
  });
  run();
}

function insertChunksSqlite(db: SqliteDatabase, chunks: NexsightChunk[]): void {
  const insertChunk = db.prepare("INSERT OR REPLACE INTO chunks (id, source, title, content, created_at) VALUES (?, ?, ?, ?, ?)");
  const insertFts = db.prepare("INSERT INTO chunks_fts (id, source, title, content) VALUES (?, ?, ?, ?)");
  for (const chunk of chunks) {
    insertChunk.run(chunk.id, chunk.source, chunk.title, chunk.content, chunk.createdAt);
    insertFts.run(chunk.id, chunk.source, chunk.title, chunk.content);
  }
}

function searchSqlite(db: SqliteDatabase, query: string, terms: string[], limit: number): Array<{ chunk: NexsightChunk; score: number }> {
  const ftsQuery = toFtsQuery(query);
  if (!ftsQuery) {
    return [];
  }
  const rows = db.prepare("SELECT id, source, title, content, bm25(chunks_fts) AS rank FROM chunks_fts WHERE chunks_fts MATCH ? ORDER BY rank LIMIT ?")
    .all(ftsQuery, limit) as Array<{ id: string; source: string; title: string; content: string; rank: number }>;
  return rows.map((row) => ({
    chunk: {
      id: row.id,
      source: row.source,
      title: row.title,
      content: row.content,
      createdAt: "",
    },
    score: Math.max(0.01, Math.abs(row.rank)),
  })).sort((left, right) => {
    const leftFallback = scoreChunk(left.chunk, terms);
    const rightFallback = scoreChunk(right.chunk, terms);
    return rightFallback - leftFallback || left.score - right.score;
  });
}

function toFtsQuery(query: string): string {
  const terms = tokenize(query).slice(0, 12);
  return terms.map((term) => `"${term.replace(/"/g, "\"\"")}"`).join(" ");
}

function countSqliteChunks(db: SqliteDatabase): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM chunks").get() as { count: number } | undefined;
  return row?.count ?? 0;
}

function getSqliteStats(db: SqliteDatabase): { sources: number; chunks: number; chars: number } {
  const row = db.prepare("SELECT COUNT(DISTINCT source) AS sources, COUNT(*) AS chunks, COALESCE(SUM(length(content)), 0) AS chars FROM chunks")
    .get() as { sources: number; chunks: number; chars: number } | undefined;
  return {
    sources: row?.sources ?? 0,
    chunks: row?.chunks ?? 0,
    chars: row?.chars ?? 0,
  };
}

function collectIndexableFiles(root: string, pattern: string, limit: number): string[] {
  const files: string[] = [];
  const queue = [root];
  const matcher = pattern ? globToRegExp(pattern) : null;

  while (queue.length > 0 && files.length < limit) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isDirectory() && NEXSIGHT_SKIP_DIRS.has(entry.name)) {
          continue;
        }
        queue.push(path.join(current, entry.name));
      }
      continue;
    }
    if (!stats.isFile() || stats.size > NEXSIGHT_MAX_FILE_CHARS) {
      continue;
    }
    const ext = path.extname(current).toLowerCase();
    if (!NEXSIGHT_TEXT_EXTENSIONS.has(ext)) {
      continue;
    }
    const normalized = current.split(path.sep).join("/");
    if (matcher && !matcher.test(normalized)) {
      continue;
    }
    files.push(current);
  }
  return files;
}

function globToRegExp(globPattern: string): RegExp {
  const normalized = globPattern.split(path.sep).join("/");
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");
  return new RegExp(`${escaped}$`);
}

function sqliteIndexPath(session: RuntimeSession): string {
  return path.join(session.cwd, ".nexagent", "nexsight", "index.db");
}

function jsonIndexPath(session: RuntimeSession): string {
  return path.join(session.cwd, ".nexagent", "nexsight", "index.json");
}

function capOutput(value: string): string {
  return value.length > NEXSIGHT_MAX_OUTPUT_CHARS
    ? `${value.slice(0, NEXSIGHT_MAX_OUTPUT_CHARS - 64)}\n... truncated ${String(value.length - NEXSIGHT_MAX_OUTPUT_CHARS + 64)} chars`
    : value;
}

function ok(output: string): NexsightResult {
  return { ok: true, output };
}

function fail(output: string): NexsightResult {
  return { ok: false, output };
}
