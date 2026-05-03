import { readFileSync, statSync } from "node:fs";
import path from "node:path";

import { addArchivistMemory, addArchivistMemorySync } from "./archivist.js";
import type { RuntimeSession } from "./session.js";

export interface LspStatusResult {
  enabled: boolean;
  configured: boolean;
  running: boolean;
  indexArchivist: boolean;
  message: string;
}

export interface LspSummaryResult {
  status: LspStatusResult;
  output: string;
}

const LSP_MAX_SYMBOLS = 24;
const LSP_MAX_DIAGNOSTICS = 24;

export function getLspStatus(session: RuntimeSession): LspStatusResult {
  const enabled = session.lsp?.enabled === true;
  const configured = Boolean(session.lsp?.command);
  return {
    enabled,
    configured,
    running: false,
    indexArchivist: session.lsp?.indexArchivist === true,
    message: enabled
      ? configured
        ? "configured; service starts only on explicit operation"
        : "enabled but no language server command configured"
      : "disabled by default",
  };
}

export function formatLspStatus(session: RuntimeSession): string {
  const status = getLspStatus(session);
  return [
    "lsp",
    `enabled: ${String(status.enabled)}`,
    `configured: ${String(status.configured)}`,
    `running: ${String(status.running)}`,
    `indexArchivist: ${String(status.indexArchivist)}`,
    `message: ${status.message}`,
  ].join("\n");
}

export async function summarizeLspSymbols(session: RuntimeSession, inputPath: string): Promise<LspSummaryResult> {
  const status = getLspStatus(session);
  if (!status.enabled) {
    return { status, output: formatLspStatus(session) };
  }
  const summary = buildLspSymbolsSummary(session, inputPath);

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

function buildLspSymbolsSummary(session: RuntimeSession, inputPath: string): {
  relativePath: string;
  symbols: Array<{ kind: string; name: string; line: number }>;
  output: string;
} {
  const targetPath = resolveSafeProjectPath(session, inputPath);
  const content = readBoundedTextFile(targetPath);
  const symbols = extractSymbols(content).slice(0, LSP_MAX_SYMBOLS);
  const relativePath = path.relative(session.repo.root ?? session.cwd, targetPath) || path.basename(targetPath);
  return {
    relativePath,
    symbols,
    output: [
      "lsp symbols",
      `path: ${relativePath}`,
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
  const diagnostics = extractDiagnostics(content).slice(0, LSP_MAX_DIAGNOSTICS);
  const relativePath = path.relative(session.repo.root ?? session.cwd, targetPath) || path.basename(targetPath);
  return {
    relativePath,
    diagnostics,
    output: [
      "lsp diagnostics",
      `path: ${relativePath}`,
      `count: ${String(diagnostics.length)}`,
      ...diagnostics.map((diagnostic) => `- ${diagnostic.level} line=${String(diagnostic.line)} ${diagnostic.message}`),
    ].join("\n"),
  };
}

function resolveSafeProjectPath(session: RuntimeSession, inputPath: string): string {
  const targetPath = path.resolve(session.cwd, inputPath || ".");
  const root = session.repo.root ?? session.cwd;
  if (!targetPath.startsWith(root)) {
    throw new Error("LSP path must stay inside project root");
  }
  const stats = statSync(targetPath);
  if (!stats.isFile()) {
    throw new Error("LSP path must be a file");
  }
  return targetPath;
}

function readBoundedTextFile(targetPath: string): string {
  const content = readFileSync(targetPath, "utf8");
  return content.length > 80_000 ? content.slice(0, 80_000) : content;
}

function extractSymbols(content: string): Array<{ kind: string; name: string; line: number }> {
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

function extractDiagnostics(content: string): Array<{ level: string; message: string; line: number }> {
  const diagnostics: Array<{ level: string; message: string; line: number }> = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/\bTODO\b|\bFIXME\b|eslint-disable|@ts-ignore/.test(line)) {
      diagnostics.push({ level: "info", message: line.trim().slice(0, 140), line: index + 1 });
    }
  });
  return diagnostics;
}
