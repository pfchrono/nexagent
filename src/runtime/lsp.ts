import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

import { addArchivistMemory, addArchivistMemorySync } from "./archivist.js";
import type { RuntimeSession } from "./session.js";

export interface LspStatusResult {
  enabled: boolean;
  configured: boolean;
  available: boolean;
  running: boolean;
  indexArchivist: boolean;
  command: string | null;
  source: "language-server" | "typescript-service" | "static-fallback" | "disabled";
  touchedFiles: number;
  problemCount: number;
  lastTouchedPath: string | null;
  lastCheckedAt: string | null;
  message: string;
}

export interface LspSummaryResult {
  status: LspStatusResult;
  output: string;
}

const LSP_MAX_SYMBOLS = 24;
const LSP_MAX_DIAGNOSTICS = 24;
const LSP_WORKSPACE_FILE_LIMIT = 80;
const LSP_REQUEST_TIMEOUT_MS = 2_000;
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);
const SKIP_WORKSPACE_DIRS = new Set([".git", "node_modules", "dist", "build", ".nexagent", ".planning"]);

interface LspSessionCache {
  files: Map<string, { problemCount: number; checkedAt: string }>;
  lastTouchedPath: string | null;
  lastCheckedAt: string | null;
}

const lspSessionCache = new WeakMap<RuntimeSession, LspSessionCache>();
const lspClients = new WeakMap<RuntimeSession, LspJsonRpcClient>();

export function getLspStatus(session: RuntimeSession): LspStatusResult {
  const enabled = session.lsp?.enabled === true;
  const configured = Boolean(session.lsp?.command);
  const command = session.lsp?.command ?? null;
  const available = Boolean(command && isCommandAvailable(command, session.cwd));
  const cache = lspSessionCache.get(session);
  const client = lspClients.get(session);
  const running = Boolean(client && !client.closed);
  const source = !enabled
    ? "disabled"
    : available
      ? "language-server"
      : "typescript-service";
  return {
    enabled,
    configured,
    available,
    running,
    indexArchivist: session.lsp?.indexArchivist === true,
    command,
    source,
    touchedFiles: cache?.files.size ?? 0,
    problemCount: cache ? Array.from(cache.files.values()).reduce((sum, entry) => sum + entry.problemCount, 0) : 0,
    lastTouchedPath: cache?.lastTouchedPath ?? null,
    lastCheckedAt: cache?.lastCheckedAt ?? null,
    message: enabled
      ? configured
        ? available
          ? running
            ? "language server running; async LSP tools use JSON-RPC"
            : "language server available; starts lazily on async LSP operation"
          : "language server command missing; using bounded TypeScript/static fallback"
        : "enabled without language server command; using bounded TypeScript/static fallback"
      : "disabled",
  };
}

export function formatLspStatus(session: RuntimeSession): string {
  const status = getLspStatus(session);
  return [
    "lsp",
    `enabled: ${String(status.enabled)}`,
    `configured: ${String(status.configured)}`,
    `available: ${String(status.available)}`,
    `running: ${String(status.running)}`,
    `command: ${status.command ?? "none"}`,
    `source: ${status.source}`,
    `touchedFiles: ${String(status.touchedFiles)}`,
    `problems: ${String(status.problemCount)}`,
    `lastTouched: ${status.lastTouchedPath ?? "none"}`,
    `indexArchivist: ${String(status.indexArchivist)}`,
    `message: ${status.message}`,
  ].join("\n");
}

export function formatLspSetup(session: RuntimeSession): string {
  const status = getLspStatus(session);
  const resolved = status.command ? resolveCommandPath(status.command, session.cwd) : null;
  return [
    "lsp setup",
    `enabled: ${String(status.enabled)}`,
    `command: ${status.command ?? "none"}`,
    `resolved: ${resolved ?? "none"}`,
    `available: ${String(status.available)}`,
    `running: ${String(status.running)}`,
    status.available
      ? "ready: run /lsp symbols <path>, /lsp diagnostics <path>, or /lsp check [path]"
      : "install: bun add -d typescript-language-server",
    "safety: no auto-download; workspace scan bounded to 80 TS/JS files",
  ].join("\n");
}

export function touchLspFileSync(session: RuntimeSession, inputPath: string): void {
  const status = getLspStatus(session);
  if (!status.enabled) {
    return;
  }
  try {
    const summary = buildLspDiagnosticsSummary(session, inputPath);
    const cache = getLspCache(session);
    cache.files.set(summary.relativePath, {
      problemCount: summary.diagnostics.length,
      checkedAt: new Date().toISOString(),
    });
    cache.lastTouchedPath = summary.relativePath;
    cache.lastCheckedAt = cache.files.get(summary.relativePath)?.checkedAt ?? cache.lastCheckedAt;
  } catch {
    // LSP touch is advisory. File tools must not fail because diagnostics could not run.
  }
}

export async function summarizeLspSymbols(session: RuntimeSession, inputPath: string): Promise<LspSummaryResult> {
  const status = getLspStatus(session);
  if (!status.enabled) {
    return { status, output: formatLspStatus(session) };
  }
  const summary = status.available
    ? await buildLspSymbolsSummaryFromServer(session, inputPath).catch(() => buildLspSymbolsSummary(session, inputPath))
    : buildLspSymbolsSummary(session, inputPath);

  if (session.lsp?.indexArchivist && session.archivist.enabled) {
    await addArchivistMemory(session, {
      type: "code-symbols",
      summary: `LSP symbols for ${summary.relativePath}: ${summary.symbols.map((symbol) => symbol.name).slice(0, 8).join(", ") || "none"}`,
      content: summary.output,
      tags: ["lsp", "symbols", "code-intel"],
      sourceCategory: "lsp-symbols",
    });
  }

  return { status, output: summary.output };
}

export async function summarizeLspDiagnostics(session: RuntimeSession, inputPath: string): Promise<LspSummaryResult> {
  const status = getLspStatus(session);
  if (!status.enabled) {
    return { status, output: formatLspStatus(session) };
  }
  const summary = buildLspDiagnosticsSummary(session, inputPath);
  updateLspCache(session, summary.relativePath, summary.diagnostics.length);

  if (session.lsp?.indexArchivist && session.archivist.enabled) {
    await addArchivistMemory(session, {
      type: "code-diagnostics",
      summary: `LSP diagnostics for ${summary.relativePath}: ${String(summary.diagnostics.length)} bounded findings`,
      content: summary.output,
      tags: ["lsp", "diagnostics", "code-intel"],
      sourceCategory: "lsp-diagnostics",
    });
  }

  return { status, output: summary.output };
}

export function summarizeLspSymbolsSync(session: RuntimeSession, inputPath: string): LspSummaryResult {
  const status = getLspStatus(session);
  if (!status.enabled) {
    return { status, output: formatLspStatus(session) };
  }
  const summary = buildLspSymbolsSummary(session, inputPath);

  if (session.lsp?.indexArchivist && session.archivist.enabled) {
    addArchivistMemorySync(session, {
      type: "code-symbols",
      summary: `LSP symbols for ${summary.relativePath}: ${summary.symbols.map((symbol) => symbol.name).slice(0, 8).join(", ") || "none"}`,
      content: summary.output,
      tags: ["lsp", "symbols", "code-intel"],
      sourceCategory: "lsp-symbols",
    });
  }

  return { status, output: summary.output };
}

export function summarizeLspDiagnosticsSync(session: RuntimeSession, inputPath: string): LspSummaryResult {
  const status = getLspStatus(session);
  if (!status.enabled) {
    return { status, output: formatLspStatus(session) };
  }
  const summary = buildLspDiagnosticsSummary(session, inputPath);
  updateLspCache(session, summary.relativePath, summary.diagnostics.length);

  if (session.lsp?.indexArchivist && session.archivist.enabled) {
    addArchivistMemorySync(session, {
      type: "code-diagnostics",
      summary: `LSP diagnostics for ${summary.relativePath}: ${String(summary.diagnostics.length)} bounded findings`,
      content: summary.output,
      tags: ["lsp", "diagnostics", "code-intel"],
      sourceCategory: "lsp-diagnostics",
    });
  }

  return { status, output: summary.output };
}

export function scanLspWorkspaceSync(session: RuntimeSession, inputPath = "."): LspSummaryResult {
  const status = getLspStatus(session);
  if (!status.enabled) {
    return { status, output: formatLspStatus(session) };
  }
  const rootPath = resolveWorkspacePath(session, inputPath);
  const files = listWorkspaceFiles(rootPath).slice(0, LSP_WORKSPACE_FILE_LIMIT);
  let problemCount = 0;
  const rows: string[] = [];
  for (const targetPath of files) {
    try {
      const summary = buildLspDiagnosticsSummary(session, targetPath);
      updateLspCache(session, summary.relativePath, summary.diagnostics.length);
      problemCount += summary.diagnostics.length;
      for (const diagnostic of summary.diagnostics) {
        if (rows.length >= LSP_MAX_DIAGNOSTICS) break;
        rows.push(`${summary.relativePath}:${String(diagnostic.line)} ${diagnostic.level} ${diagnostic.message}`);
      }
    } catch {
      // Ignore unreadable files during bounded workspace scan.
    }
  }
  return {
    status: getLspStatus(session),
    output: [
      "lsp workspace",
      `path: ${path.relative(session.repo.root ?? session.cwd, rootPath) || "."}`,
      `files: ${String(files.length)}`,
      `problems: ${String(problemCount)}`,
      ...rows.map((row) => `- ${row}`),
      files.length >= LSP_WORKSPACE_FILE_LIMIT ? `limit: ${String(LSP_WORKSPACE_FILE_LIMIT)} files` : "",
    ].filter(Boolean).join("\n"),
  };
}

function buildLspSymbolsSummary(session: RuntimeSession, inputPath: string): {
  relativePath: string;
  symbols: Array<{ kind: string; name: string; line: number }>;
  output: string;
} {
  const targetPath = resolveSafeProjectPath(session, inputPath);
  const content = readBoundedTextFile(targetPath);
  const source = getSummarySource(targetPath);
  const symbols = extractSymbols(content, targetPath).slice(0, LSP_MAX_SYMBOLS);
  const relativePath = path.relative(session.repo.root ?? session.cwd, targetPath) || path.basename(targetPath);
  return {
    relativePath,
    symbols,
    output: [
      "lsp symbols",
      `path: ${relativePath}`,
      `source: ${source}`,
      `count: ${String(symbols.length)}`,
      ...symbols.map((symbol) => `- ${symbol.kind} ${symbol.name} line=${String(symbol.line)}`),
    ].join("\n"),
  };
}

async function buildLspSymbolsSummaryFromServer(session: RuntimeSession, inputPath: string): Promise<{
  relativePath: string;
  symbols: Array<{ kind: string; name: string; line: number }>;
  output: string;
}> {
  const targetPath = resolveSafeProjectPath(session, inputPath);
  const client = await getOrStartLspClient(session);
  const content = readBoundedTextFile(targetPath);
  const uri = pathToFileUri(targetPath);
  client.notify("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: languageIdForPath(targetPath),
      version: 1,
      text: content,
    },
  });
  const raw = await client.request("textDocument/documentSymbol", {
    textDocument: { uri },
  });
  const symbols = normalizeServerSymbols(raw, targetPath).slice(0, LSP_MAX_SYMBOLS);
  const relativePath = path.relative(session.repo.root ?? session.cwd, targetPath) || path.basename(targetPath);
  return {
    relativePath,
    symbols,
    output: [
      "lsp symbols",
      `path: ${relativePath}`,
      "source: language-server",
      `count: ${String(symbols.length)}`,
      ...symbols.map((symbol) => `- ${symbol.kind} ${symbol.name} line=${String(symbol.line)}`),
    ].join("\n"),
  };
}

function buildLspDiagnosticsSummary(session: RuntimeSession, inputPath: string): {
  relativePath: string;
  diagnostics: Array<{ level: string; message: string; line: number }>;
  output: string;
} {
  const targetPath = resolveSafeProjectPath(session, inputPath);
  const content = readBoundedTextFile(targetPath);
  const source = getSummarySource(targetPath);
  const diagnostics = extractDiagnostics(content, targetPath).slice(0, LSP_MAX_DIAGNOSTICS);
  const relativePath = path.relative(session.repo.root ?? session.cwd, targetPath) || path.basename(targetPath);
  return {
    relativePath,
    diagnostics,
    output: [
      "lsp diagnostics",
      `path: ${relativePath}`,
      `source: ${source}`,
      `count: ${String(diagnostics.length)}`,
      ...diagnostics.map((diagnostic) => `- ${diagnostic.level} line=${String(diagnostic.line)} ${diagnostic.message}`),
    ].join("\n"),
  };
}

function resolveSafeProjectPath(session: RuntimeSession, inputPath: string): string {
  const targetPath = path.resolve(session.cwd, inputPath || ".");
  const root = session.repo.root ?? session.cwd;
  const relative = path.relative(root, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("LSP path must stay inside project root");
  }
  const stats = statSync(targetPath);
  if (!stats.isFile()) {
    throw new Error("LSP path must be a file");
  }
  return targetPath;
}

function resolveWorkspacePath(session: RuntimeSession, inputPath: string): string {
  const targetPath = path.resolve(session.cwd, inputPath || ".");
  const root = session.repo.root ?? session.cwd;
  const relative = path.relative(root, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("LSP path must stay inside project root");
  }
  return targetPath;
}

function readBoundedTextFile(targetPath: string): string {
  const content = readFileSync(targetPath, "utf8");
  return content.length > 80_000 ? content.slice(0, 80_000) : content;
}

function extractSymbols(content: string, targetPath: string): Array<{ kind: string; name: string; line: number }> {
  if (TYPESCRIPT_EXTENSIONS.has(path.extname(targetPath))) {
    const scriptKind = targetPath.endsWith(".tsx") || targetPath.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(targetPath, content, ts.ScriptTarget.Latest, true, scriptKind);
    const symbols: Array<{ kind: string; name: string; line: number }> = [];
    const visit = (node: ts.Node): void => {
      const name = getNodeName(node);
      if (name) {
        const pos = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        symbols.push({ kind: getNodeKind(node), name, line: pos.line + 1 });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    if (symbols.length > 0) {
      return symbols;
    }
  }
  const symbols: Array<{ kind: string; name: string; line: number }> = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = /\b(?:export\s+)?(?:async\s+)?(function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (match) {
      symbols.push({ kind: match[1] ?? "symbol", name: match[2] ?? "unknown", line: index + 1 });
    }
  });
  return symbols;
}

function extractDiagnostics(content: string, targetPath: string): Array<{ level: string; message: string; line: number }> {
  const diagnostics: Array<{ level: string; message: string; line: number }> = [];
  if (TYPESCRIPT_EXTENSIONS.has(path.extname(targetPath)) && !isBoundedFileTruncated(targetPath)) {
    const result = ts.transpileModule(content, {
      fileName: targetPath,
      reportDiagnostics: true,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    });
    for (const diagnostic of result.diagnostics ?? []) {
      const position = typeof diagnostic.start === "number"
        ? ts.getLineAndCharacterOfPosition(ts.createSourceFile(targetPath, content, ts.ScriptTarget.Latest, true), diagnostic.start)
        : { line: 0 };
      diagnostics.push({
        level: diagnostic.category === ts.DiagnosticCategory.Error ? "error" : "warning",
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, " ").slice(0, 180),
        line: position.line + 1,
      });
    }
  }
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!/^(\/\/|\/\*|\*)/.test(trimmed)) {
      return;
    }
    if (/\bTODO\b|\bFIXME\b|eslint-disable|@ts-ignore/.test(trimmed)) {
      diagnostics.push({ level: "info", message: trimmed.slice(0, 140), line: index + 1 });
    }
  });
  return diagnostics;
}

function isBoundedFileTruncated(targetPath: string): boolean {
  try {
    return statSync(targetPath).size > 80_000;
  } catch {
    return false;
  }
}

function isCommandAvailable(command: string, cwd: string): boolean {
  const result = spawnSync(resolveCommandPath(command, cwd), ["--version"], {
    stdio: "ignore",
    timeout: 1000,
  });
  return !result.error || result.error.name !== "Error";
}

function resolveCommandPath(command: string, cwd: string): string {
  if (command.includes(path.sep) || path.isAbsolute(command)) {
    return command;
  }
  const localPath = path.join(cwd, "node_modules", ".bin", command);
  try {
    if (statSync(localPath).isFile()) {
      return localPath;
    }
  } catch {
    // Fall through to PATH lookup.
  }
  return command;
}

function updateLspCache(session: RuntimeSession, relativePath: string, problemCount: number): void {
  const cache = getLspCache(session);
  const checkedAt = new Date().toISOString();
  cache.files.set(relativePath, { problemCount, checkedAt });
  cache.lastTouchedPath = relativePath;
  cache.lastCheckedAt = checkedAt;
}

function getSummarySource(targetPath: string): "typescript-service" | "static-fallback" {
  return TYPESCRIPT_EXTENSIONS.has(path.extname(targetPath)) ? "typescript-service" : "static-fallback";
}

function getLspCache(session: RuntimeSession): LspSessionCache {
  const existing = lspSessionCache.get(session);
  if (existing) {
    return existing;
  }
  const cache: LspSessionCache = {
    files: new Map(),
    lastTouchedPath: null,
    lastCheckedAt: null,
  };
  lspSessionCache.set(session, cache);
  return cache;
}

function listWorkspaceFiles(rootPath: string): string[] {
  const stats = statSync(rootPath);
  if (stats.isFile()) {
    return TYPESCRIPT_EXTENSIONS.has(path.extname(rootPath)) ? [rootPath] : [];
  }
  const files: string[] = [];
  const queue = [rootPath];
  while (queue.length > 0 && files.length < LSP_WORKSPACE_FILE_LIMIT) {
    const current = queue.shift();
    if (!current) break;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const targetPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_WORKSPACE_DIRS.has(entry.name)) queue.push(targetPath);
        continue;
      }
      if (entry.isFile() && TYPESCRIPT_EXTENSIONS.has(path.extname(entry.name))) {
        files.push(targetPath);
        if (files.length >= LSP_WORKSPACE_FILE_LIMIT) break;
      }
    }
  }
  return files;
}

async function getOrStartLspClient(session: RuntimeSession): Promise<LspJsonRpcClient> {
  const existing = lspClients.get(session);
  if (existing && !existing.closed) {
    return existing;
  }
  if (!session.lsp?.command) {
    throw new Error("LSP command is not configured");
  }
  const child = spawn(resolveCommandPath(session.lsp.command, session.cwd), session.lsp.args ?? [], {
    cwd: session.repo.root ?? session.cwd,
    stdio: "pipe",
    env: process.env,
  });
  const client = new LspJsonRpcClient(child);
  lspClients.set(session, client);
  try {
    await client.request("initialize", {
      processId: process.pid,
      rootUri: pathToFileUri(session.repo.root ?? session.cwd),
      capabilities: {
        textDocument: {
          documentSymbol: {
            hierarchicalDocumentSymbolSupport: true,
          },
        },
      },
    });
    client.notify("initialized", {});
    return client;
  } catch (error) {
    client.close();
    lspClients.delete(session);
    throw error;
  }
}

class LspJsonRpcClient {
  private nextId = 1;
  private buffer = Buffer.alloc(0);
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }>();
  private stderrTail = "";
  closed = false;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on("data", (chunk: Buffer) => this.handleData(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-1200);
    });
    child.on("exit", () => this.failAll("LSP server exited"));
    child.on("error", (error) => this.failAll(error.message));
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    this.send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP request timed out: ${method}${this.stderrTail ? `; stderr=${this.stderrTail}` : ""}`));
      }, LSP_REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
    });
  }

  notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.child.kill();
    this.failAll("LSP client closed");
  }

  private send(message: unknown): void {
    const body = JSON.stringify(message);
    this.child.stdin.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const match = /content-length:\s*(\d+)/i.exec(header);
      if (!match?.[1]) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }
      const length = Number.parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (this.buffer.length < bodyEnd) return;
      const body = this.buffer.slice(bodyStart, bodyEnd).toString("utf8");
      this.buffer = this.buffer.slice(bodyEnd);
      this.handleMessage(body);
    }
  }

  private handleMessage(body: string): void {
    let message: unknown;
    try {
      message = JSON.parse(body);
    } catch {
      return;
    }
    if (!message || typeof message !== "object" || !("id" in message)) {
      return;
    }
    const response = message as { id?: unknown; result?: unknown; error?: { message?: string } };
    if (typeof response.id !== "number") {
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timeout);
    if (response.error) {
      pending.reject(new Error(response.error.message ?? "LSP request failed"));
      return;
    }
    pending.resolve(response.result);
  }

  private failAll(message: string): void {
    this.closed = true;
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(message));
      this.pending.delete(id);
    }
  }
}

function pathToFileUri(targetPath: string): string {
  return `file://${targetPath.split(path.sep).map(encodeURIComponent).join("/")}`;
}

function languageIdForPath(targetPath: string): string {
  const ext = path.extname(targetPath);
  if (ext === ".tsx") return "typescriptreact";
  if (ext === ".jsx") return "javascriptreact";
  if (ext === ".js") return "javascript";
  return "typescript";
}

function normalizeServerSymbols(raw: unknown, targetPath: string): Array<{ kind: string; name: string; line: number }> {
  if (!Array.isArray(raw)) return [];
  const symbols: Array<{ kind: string; name: string; line: number }> = [];
  const visit = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : null;
    const kind = typeof record.kind === "number" ? serverKindName(record.kind) : "symbol";
    const range = (record.selectionRange ?? record.range ?? (record.location as Record<string, unknown> | undefined)?.range) as Record<string, unknown> | undefined;
    const start = range?.start as Record<string, unknown> | undefined;
    const line = typeof start?.line === "number" ? start.line + 1 : 1;
    if (name) symbols.push({ kind, name, line });
    if (Array.isArray(record.children)) {
      for (const child of record.children) visit(child);
    }
  };
  for (const item of raw) visit(item);
  return symbols.length > 0 ? symbols : extractSymbols(readBoundedTextFile(targetPath), targetPath);
}

function serverKindName(kind: number): string {
  if (kind === 5) return "class";
  if (kind === 6) return "method";
  if (kind === 11) return "interface";
  if (kind === 12) return "function";
  if (kind === 13) return "variable";
  if (kind === 14) return "const";
  return "symbol";
}

function getNodeName(node: ts.Node): string | null {
  if (
    ts.isFunctionDeclaration(node)
    || ts.isClassDeclaration(node)
    || ts.isInterfaceDeclaration(node)
    || ts.isTypeAliasDeclaration(node)
    || ts.isEnumDeclaration(node)
    || ts.isVariableDeclaration(node)
  ) {
    return node.name && ts.isIdentifier(node.name) ? node.name.text : null;
  }
  if (ts.isMethodDeclaration(node) || ts.isPropertyDeclaration(node)) {
    return node.name && ts.isIdentifier(node.name) ? node.name.text : null;
  }
  return null;
}

function getNodeKind(node: ts.Node): string {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isMethodDeclaration(node)) return "method";
  if (ts.isPropertyDeclaration(node)) return "property";
  if (ts.isVariableDeclaration(node)) return "const";
  return "symbol";
}
