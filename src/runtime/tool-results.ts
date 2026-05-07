import path from "node:path";

import type { RuntimeSession } from "./session.js";
import type { InternalToolName, InternalToolResult } from "./tools.js";

export function ok(tool: InternalToolName, output: string): InternalToolResult {
  return { ok: true, tool, output };
}

export function fail(tool: InternalToolName, output: string): InternalToolResult {
  return { ok: false, tool, output };
}

export function toToolResult(tool: InternalToolName, result: { ok: boolean; output: string }): InternalToolResult {
  return { ok: result.ok, tool, output: result.output };
}

export function pending(tool: InternalToolName, detail: string): InternalToolResult {
  return { ok: false, tool, output: `${tool} requires ${detail} execution path` };
}

export function formatToolError(targetPath: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${targetPath}: ${message}`;
}

export function formatToolPath(session: RuntimeSession, targetPath: string): string {
  const relativePath = path.relative(session.cwd, targetPath);
  if (relativePath.length === 0) {
    return ".";
  }
  return relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : targetPath;
}
