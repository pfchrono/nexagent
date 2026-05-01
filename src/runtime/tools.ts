import { execFileSync, spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

import { checkpointArchivistSession, saveArchivistMemory } from "./archivist.js";
import { buildPatchPreview, searchFilesWithIgnore } from "./core-helpers.js";
import { batchIndexNexsight, executeNexsight, indexNexsight, indexNexsightFile, searchNexsight } from "./nexsight.js";
import {
  findBlockedShellPattern,
  validateReadToolPath as validateReadPathPolicy,
  validateRepoToolPath as validateRepoPathPolicy,
  validateWriteToolPath as validateWritePathPolicy,
} from "./policy.js";
import type { RuntimeSession } from "./session.js";

export type InternalToolName =
  | "read_file"
  | "write_file"
  | "apply_patch"
  | "batch_edit"
  | "preview_patch"
  | "list_dir"
  | "search_content"
  | "search_files"
  | "web_fetch"
  | "web_search"
  | "git_status"
  | "git_diff"
  | "shell_command"
  | "nexsight_execute"
  | "nexsight_index"
  | "nexsight_batch"
  | "nexsight_search"
  | "archivist_save"
  | "archivist_checkpoint";

export interface InternalToolCall {
  name: InternalToolName;
  arguments?: Record<string, unknown>;
}

export interface InternalToolDefinition {
  name: InternalToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface InternalToolResult {
  ok: boolean;
  tool: InternalToolName;
  output: string;
}

const SHELL_TIMEOUT_MS = 5_000;
const SHELL_MAX_LINES = 120;
const SHELL_MAX_CHARS = 12_000;
const DIFF_MAX_LINES = 400;
const DIFF_MAX_CHARS = 20_000;
const WEB_TIMEOUT_MS = 8_000;
const WEB_MAX_CHARS = 12_000;
export function getInternalToolDefinitions(): readonly InternalToolDefinition[] {
  return [
    {
      name: "read_file",
      description: "Read UTF-8 text file from workspace/reference paths unless protected by safety policy.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to current working directory." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "write_file",
      description: "Write UTF-8 text file inside repo-local write roots.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to current working directory." },
          content: { type: "string", description: "Full UTF-8 file contents to write." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
    {
      name: "apply_patch",
      description: "Apply exact text replacement inside existing UTF-8 file inside repo-local write roots.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to current working directory." },
          find: { type: "string", description: "Exact text to replace." },
          replace: { type: "string", description: "Replacement text." },
          replaceAll: { type: "boolean", description: "Replace every exact match when true." },
        },
        required: ["path", "find", "replace"],
        additionalProperties: false,
      },
    },
    {
      name: "batch_edit",
      description: "Apply multiple guarded file edits in one atomic batch. Supports write, replace, insert_before, insert_after, prepend, and append; validates every path and anchor before writing anything.",
      inputSchema: {
        type: "object",
        properties: {
          edits: {
            type: "array",
            description: "Edit operations. Each item needs type and path. replace uses find/replace. insert_before/insert_after uses anchor/content. write uses content.",
            items: { type: "object" },
          },
        },
        required: ["edits"],
        additionalProperties: false,
      },
    },
    {
      name: "preview_patch",
      description: "Preview exact text replacement as unified diff without writing file.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to current working directory." },
          find: { type: "string", description: "Exact text to replace." },
          replace: { type: "string", description: "Replacement text." },
          replaceAll: { type: "boolean", description: "Replace every exact match when true." },
        },
        required: ["path", "find", "replace"],
        additionalProperties: false,
      },
    },
    {
      name: "list_dir",
      description: "List directory contents from workspace/reference paths unless protected by safety policy.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional directory path relative to current working directory." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "search_content",
      description: "Search file contents with ripgrep when available.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Text or regex pattern to search for." },
          path: { type: "string", description: "Optional root path relative to current working directory." },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
    {
      name: "search_files",
      description: "Search file paths by glob-style pattern with ripgrep when available.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob-style file pattern like *.ts or src/*.md." },
          path: { type: "string", description: "Optional root path relative to current working directory." },
        },
        required: ["pattern"],
        additionalProperties: false,
      },
    },
    {
      name: "web_fetch",
      description: "Fetch a public HTTP(S) page and return capped text content for research.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Public http(s) URL to fetch." },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    {
      name: "web_search",
      description: "Search the public web and return capped result titles, URLs, and snippets.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          limit: { type: "number", description: "Maximum result count, capped at 8." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "git_status",
      description: "Show repo branch and freshness status for current working tree.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "git_diff",
      description: "Show bounded git diff for current repo or one repo-local path.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional repo-local path to diff." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "shell_command",
      description: "Run guarded shell command inside repo cwd with destructive patterns blocked and capped output.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run from current working directory." },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
    {
      name: "nexsight_execute",
      description: "Run sandboxed analysis code and return only bounded stdout/stderr. Use for counts, parsing, filtering, and data processing; print distilled findings, not raw dumps.",
      inputSchema: {
        type: "object",
        properties: {
          language: { type: "string", enum: ["shell", "javascript", "python"], description: "Execution language. Defaults to shell when command is provided; otherwise inferred from code or javascript." },
          code: { type: "string", description: "Script to run from current working directory." },
          command: { type: "string", description: "Shell command alias for code; implies language=shell when language is omitted." },
          cmd: { type: "string", description: "Short shell command alias for command." },
          script: { type: "string", description: "Script alias for code." },
          task: { type: "string", description: "Natural-language task context. Not executable by itself; provide code or command too." },
          reason: { type: "string", description: "Short reason for using Nexsight." },
          timeoutMs: { type: "number", description: "Optional timeout, capped at 30000ms." },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "nexsight_index",
      description: "Index bounded file or text content into the local nexsight search store.",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", description: "Stable source label for later search." },
          path: { type: "string", description: "Optional readable file path to index." },
          content: { type: "string", description: "Optional text content to index when path is omitted." },
        },
        required: ["source"],
        additionalProperties: false,
      },
    },
    {
      name: "nexsight_batch",
      description: "Index text files under a readable repo root into nexsight with ignore rules, source labels, and bounded file count for later focused search.",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string", description: "Optional root path relative to current working directory." },
          pattern: { type: "string", description: "Optional glob suffix, such as *.ts or *.md." },
          limit: { type: "number", description: "Maximum files to index, capped at 400." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "nexsight_search",
      description: "Search the local nexsight index and return small ranked excerpts. Use after indexing to retrieve focused evidence instead of rescanning raw files.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          limit: { type: "number", description: "Maximum result count, capped at 12." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "archivist_save",
      description: "Persist bounded memory note into Archivist store.",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Short memory summary." },
          content: { type: "string", description: "Optional fuller memory content." },
          tags: { type: "array", items: { type: "string" }, description: "Optional memory tags." },
          type: { type: "string", description: "Optional memory type label." },
        },
        required: ["summary"],
        additionalProperties: false,
      },
    },
    {
      name: "archivist_checkpoint",
      description: "Persist bounded checkpoint summary from current session state into Archivist store.",
      inputSchema: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Optional checkpoint reason." },
        },
        additionalProperties: false,
      },
    },
  ] as const;
}

export function formatInternalToolPromptGuidance(): string[] {
  const tools = getInternalToolDefinitions();
  return [
    "Internal tool protocol: when tool use is required, respond with only one XML block:",
    '<nexagent_tool_call>{"name":"read_file","arguments":{"path":"src/cli.ts"}}</nexagent_tool_call>',
    `Available internal tools: ${tools.map((tool) => tool.name).join(", ")}`,
    "Use tools for repo inspection instead of narrating intended actions.",
  ];
}

export function getInternalToolFunctionDefinitions(): ReadonlyArray<Record<string, unknown>> {
  return getInternalToolDefinitions().map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: true,
  }));
}

export function executeInternalTool(session: RuntimeSession, call: InternalToolCall): InternalToolResult {
  switch (call.name) {
    case "read_file":
      return executeReadFileTool(session, asString(call.arguments?.path, "."));
    case "write_file":
      return executeWriteFileTool(session, asString(call.arguments?.path, "."), asString(call.arguments?.content, ""));
    case "apply_patch":
      return executeApplyPatchTool(
        session,
        asString(call.arguments?.path, "."),
        asString(call.arguments?.find, ""),
        asString(call.arguments?.replace, ""),
        asBoolean(call.arguments?.replaceAll),
      );
    case "batch_edit":
      return executeBatchEditTool(session, call.arguments ?? {});
    case "preview_patch":
      return executePreviewPatchTool(
        session,
        asString(call.arguments?.path, "."),
        asString(call.arguments?.find, ""),
        asString(call.arguments?.replace, ""),
        asBoolean(call.arguments?.replaceAll),
      );
    case "list_dir":
      return executeListDirTool(session, asOptionalString(call.arguments?.path));
    case "search_content":
      return executeSearchContentTool(session, asString(call.arguments?.pattern ?? call.arguments?.query, ""), asOptionalString(call.arguments?.path));
    case "search_files":
      return executeSearchFilesTool(session, asString(call.arguments?.pattern ?? call.arguments?.query, ""), asOptionalString(call.arguments?.path));
    case "web_fetch":
    case "web_search":
      return pending(call.name, "async");
    case "git_status":
      return executeGitStatusTool(session);
    case "git_diff":
      return executeGitDiffTool(session, asOptionalString(call.arguments?.path));
    case "shell_command":
      return executeShellCommandTool(session, asString(call.arguments?.command, ""));
    case "nexsight_execute":
      return executeNexsightExecuteTool(session, call.arguments ?? {});
    case "nexsight_index":
      return executeNexsightIndexTool(session, call.arguments ?? {});
    case "nexsight_batch":
      return executeNexsightBatchTool(session, call.arguments ?? {});
    case "nexsight_search":
      return toToolResult("nexsight_search", searchNexsight(session, {
        query: asString(call.arguments?.query, ""),
        limit: asNumber(call.arguments?.limit, 5),
      }));
    case "archivist_save":
      return pending("archivist_save", "async");
    case "archivist_checkpoint":
      return pending("archivist_checkpoint", "async");
  }
}

export async function executeInternalToolAsync(session: RuntimeSession, call: InternalToolCall): Promise<InternalToolResult> {
  switch (call.name) {
    case "web_fetch":
      return await executeWebFetchTool(asString(call.arguments?.url, ""));
    case "web_search":
      return await executeWebSearchTool(asString(call.arguments?.query, ""), asNumber(call.arguments?.limit, 5));
    case "archivist_save":
      return await executeArchivistSaveTool(
        session,
        asString(call.arguments?.summary, ""),
        asOptionalString(call.arguments?.content),
        asStringArray(call.arguments?.tags),
        asOptionalString(call.arguments?.type),
      );
    case "archivist_checkpoint":
      return await executeArchivistCheckpointTool(session, asOptionalString(call.arguments?.reason));
    default:
      return executeInternalTool(session, call);
  }
}

export function classifyInternalToolRisk(call: InternalToolCall): "low" | "guarded" {
  if (call.name === "nexsight_execute") {
    return isNexsightShellCall(call.arguments ?? {}) ? "guarded" : "low";
  }

  return call.name === "shell_command"
    || call.name === "write_file"
    || call.name === "apply_patch"
    || call.name === "batch_edit"
    || call.name === "preview_patch"
    || call.name === "web_fetch"
    || call.name === "web_search"
    || call.name === "nexsight_index"
    || call.name === "nexsight_batch"
    || call.name === "archivist_save"
    || call.name === "archivist_checkpoint"
    ? "guarded"
    : "low";
}

export function resolveRepoPath(session: RuntimeSession, inputPath?: string): string {
  if (!inputPath || inputPath === ".") {
    return session.cwd;
  }
  return path.resolve(session.cwd, expandHomePath(inputPath));
}

function expandHomePath(inputPath: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!home) {
    return inputPath;
  }
  if (inputPath === "~") {
    return home;
  }
  if (inputPath.startsWith("~/")) {
    return path.join(home, inputPath.slice(2));
  }
  return inputPath;
}

export function validateRepoToolPath(session: RuntimeSession, targetPath: string): string | null {
  return validateRepoPathPolicy(session, targetPath);
}

export function validateReadToolPath(session: RuntimeSession, targetPath: string): string | null {
  return validateReadPathPolicy(session, targetPath);
}

export function validateWriteToolPath(session: RuntimeSession, targetPath: string): string | null {
  return validateWritePathPolicy(session, targetPath);
}

function executeReadFileTool(session: RuntimeSession, inputPath: string): InternalToolResult {
  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateReadToolPath(session, targetPath);
  if (policyFailure) {
    return fail("read_file", policyFailure);
  }

  try {
    const stats = statSync(targetPath);
    if (!stats.isFile()) {
      return fail("read_file", `${formatToolPath(session, targetPath)} is not a file`);
    }

    return ok("read_file", readFileSync(targetPath, "utf8"));
  } catch (error) {
    return fail("read_file", formatToolError(targetPath, error));
  }
}

function executeListDirTool(session: RuntimeSession, inputPath?: string): InternalToolResult {
  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateReadToolPath(session, targetPath);
  if (policyFailure) {
    return fail("list_dir", policyFailure);
  }

  try {
    const entries = readdirSync(targetPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => `${entry.isDirectory() ? "dir" : "file"} ${entry.name}`);
    return ok("list_dir", entries.length > 0 ? entries.join("\n") : "(empty directory)");
  } catch (error) {
    return fail("list_dir", formatToolError(targetPath, error));
  }
}

function executeWriteFileTool(session: RuntimeSession, inputPath: string, content: string): InternalToolResult {
  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateWriteToolPath(session, targetPath);
  if (policyFailure) {
    return fail("write_file", policyFailure);
  }

  try {
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, "utf8");
    return ok("write_file", `wrote ${formatToolPath(session, targetPath)} (${String(content.length)} chars)`);
  } catch (error) {
    return fail("write_file", formatToolError(targetPath, error));
  }
}

function executeApplyPatchTool(
  session: RuntimeSession,
  inputPath: string,
  find: string,
  replace: string,
  replaceAll: boolean,
): InternalToolResult {
  if (!find.length) {
    return fail("apply_patch", "find required");
  }

  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateWriteToolPath(session, targetPath);
  if (policyFailure) {
    return fail("apply_patch", policyFailure);
  }

  try {
    const stats = statSync(targetPath);
    if (!stats.isFile()) {
      return fail("apply_patch", `${formatToolPath(session, targetPath)} is not a file`);
    }

    const current = readFileSync(targetPath, "utf8");
    const occurrences = current.split(find).length - 1;
    if (occurrences === 0) {
      return fail("apply_patch", `patch target not found in ${formatToolPath(session, targetPath)}`);
    }
    if (!replaceAll && occurrences > 1) {
      return fail("apply_patch", `patch target ambiguous in ${formatToolPath(session, targetPath)}; ${String(occurrences)} matches`);
    }

    const next = replaceAll ? current.split(find).join(replace) : current.replace(find, replace);
    writeFileSync(targetPath, next, "utf8");
    return ok("apply_patch", `patched ${formatToolPath(session, targetPath)} (${String(occurrences)} match${occurrences === 1 ? "" : "es"})`);
  } catch (error) {
    return fail("apply_patch", formatToolError(targetPath, error));
  }
}

type BatchEditOperation = {
  type: "write" | "replace" | "insert_before" | "insert_after" | "prepend" | "append";
  path: string;
  content?: string;
  find?: string;
  replace?: string;
  anchor?: string;
  replaceAll?: boolean;
};

function executeBatchEditTool(session: RuntimeSession, args: Record<string, unknown>): InternalToolResult {
  const edits = parseBatchEditOperations(args.edits ?? args.operations ?? args.changes);
  if (!edits.ok) {
    return fail("batch_edit", edits.error);
  }
  if (edits.value.length === 0) {
    return fail("batch_edit", "edits required");
  }
  if (edits.value.length > 40) {
    return fail("batch_edit", "too many edits; maximum is 40");
  }

  const currentByPath = new Map<string, string>();
  const nextByPath = new Map<string, string>();
  const summaries: string[] = [];

  for (let index = 0; index < edits.value.length; index += 1) {
    const edit = edits.value[index];
    const targetPath = resolveRepoPath(session, edit.path);
    const policyFailure = validateWriteToolPath(session, targetPath);
    if (policyFailure) {
      return fail("batch_edit", `edit ${String(index + 1)} blocked: ${policyFailure}`);
    }

    try {
      const current = nextByPath.get(targetPath) ?? readBatchEditCurrent(targetPath, currentByPath);
      const next = applyBatchEditOperation(session, targetPath, current, edit, index + 1);
      if (!next.ok) {
        return fail("batch_edit", next.error);
      }
      nextByPath.set(targetPath, next.value);
      summaries.push(next.summary);
    } catch (error) {
      return fail("batch_edit", `edit ${String(index + 1)} failed: ${formatToolError(targetPath, error)}`);
    }
  }

  for (const [targetPath, next] of nextByPath) {
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, next, "utf8");
  }

  return ok("batch_edit", [
    `batch edited ${String(nextByPath.size)} file${nextByPath.size === 1 ? "" : "s"} with ${String(edits.value.length)} operation${edits.value.length === 1 ? "" : "s"}`,
    ...summaries.slice(0, 20),
    summaries.length > 20 ? `... ${String(summaries.length - 20)} more operations` : "",
  ].filter(Boolean).join("\n"));
}

function parseBatchEditOperations(value: unknown): { ok: true; value: BatchEditOperation[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "edits array required" };
  }

  const edits: BatchEditOperation[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `edit ${String(index + 1)} must be an object` };
    }
    const record = raw as Record<string, unknown>;
    const type = asString(record.type ?? record.op, "") as BatchEditOperation["type"];
    const inputPath = asString(record.path, "");
    if (!["write", "replace", "insert_before", "insert_after", "prepend", "append"].includes(type)) {
      return { ok: false, error: `edit ${String(index + 1)} has unsupported type` };
    }
    if (!inputPath) {
      return { ok: false, error: `edit ${String(index + 1)} path required` };
    }
    edits.push({
      type,
      path: inputPath,
      content: asOptionalString(record.content),
      find: asOptionalString(record.find),
      replace: asOptionalString(record.replace),
      anchor: asOptionalString(record.anchor ?? record.after ?? record.before),
      replaceAll: asBoolean(record.replaceAll),
    });
  }

  return { ok: true, value: edits };
}

function readBatchEditCurrent(targetPath: string, currentByPath: Map<string, string>): string {
  if (currentByPath.has(targetPath)) {
    return currentByPath.get(targetPath) ?? "";
  }
  let current = "";
  try {
    current = readFileSync(targetPath, "utf8");
  } catch {
    current = "";
  }
  currentByPath.set(targetPath, current);
  return current;
}

function applyBatchEditOperation(
  session: RuntimeSession,
  targetPath: string,
  current: string,
  edit: BatchEditOperation,
  index: number,
): { ok: true; value: string; summary: string } | { ok: false; error: string } {
  const label = `${String(index)} ${formatToolPath(session, targetPath)} ${edit.type}`;
  if (edit.type === "write") {
    if (edit.content === undefined) {
      return { ok: false, error: `edit ${label}: content required` };
    }
    return { ok: true, value: edit.content, summary: `${label} (${String(edit.content.length)} chars)` };
  }
  if (edit.type === "prepend") {
    if (edit.content === undefined) {
      return { ok: false, error: `edit ${label}: content required` };
    }
    return { ok: true, value: `${edit.content}${current}`, summary: `${label} (${String(edit.content.length)} chars)` };
  }
  if (edit.type === "append") {
    if (edit.content === undefined) {
      return { ok: false, error: `edit ${label}: content required` };
    }
    return { ok: true, value: `${current}${edit.content}`, summary: `${label} (${String(edit.content.length)} chars)` };
  }
  if (edit.type === "replace") {
    if (!edit.find) {
      return { ok: false, error: `edit ${label}: find required` };
    }
    const replacement = edit.replace ?? "";
    const occurrences = current.split(edit.find).length - 1;
    if (occurrences === 0) {
      return { ok: false, error: `edit ${label}: find text not found` };
    }
    if (!edit.replaceAll && occurrences > 1) {
      return { ok: false, error: `edit ${label}: find text ambiguous (${String(occurrences)} matches)` };
    }
    const value = edit.replaceAll ? current.split(edit.find).join(replacement) : current.replace(edit.find, replacement);
    return { ok: true, value, summary: `${label} (${String(occurrences)} match${occurrences === 1 ? "" : "es"})` };
  }

  if (!edit.anchor) {
    return { ok: false, error: `edit ${label}: anchor required` };
  }
  if (edit.content === undefined) {
    return { ok: false, error: `edit ${label}: content required` };
  }
  const occurrences = current.split(edit.anchor).length - 1;
  if (occurrences === 0) {
    return { ok: false, error: `edit ${label}: anchor not found` };
  }
  if (occurrences > 1) {
    return { ok: false, error: `edit ${label}: anchor ambiguous (${String(occurrences)} matches)` };
  }
  const value = edit.type === "insert_before"
    ? current.replace(edit.anchor, `${edit.content}${edit.anchor}`)
    : current.replace(edit.anchor, `${edit.anchor}${edit.content}`);
  return { ok: true, value, summary: `${label} (anchor matched)` };
}

function executePreviewPatchTool(
  session: RuntimeSession,
  inputPath: string,
  find: string,
  replace: string,
  replaceAll: boolean,
): InternalToolResult {
  if (!find.length) {
    return fail("preview_patch", "find required");
  }

  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateWriteToolPath(session, targetPath);
  if (policyFailure) {
    return fail("preview_patch", policyFailure);
  }

  try {
    const stats = statSync(targetPath);
    if (!stats.isFile()) {
      return fail("preview_patch", `${formatToolPath(session, targetPath)} is not a file`);
    }

    const current = readFileSync(targetPath, "utf8");
    const occurrences = current.split(find).length - 1;
    if (occurrences === 0) {
      return fail("preview_patch", `patch target not found in ${formatToolPath(session, targetPath)}`);
    }
    if (!replaceAll && occurrences > 1) {
      return fail("preview_patch", `patch target ambiguous in ${formatToolPath(session, targetPath)}; ${String(occurrences)} matches`);
    }

    const next = replaceAll ? current.split(find).join(replace) : current.replace(find, replace);
    return ok("preview_patch", buildPatchPreview(formatToolPath(session, targetPath), current, next));
  } catch (error) {
    return fail("preview_patch", formatToolError(targetPath, error));
  }
}

function executeSearchContentTool(session: RuntimeSession, pattern: string, inputPath?: string): InternalToolResult {
  if (!pattern.trim()) {
    return fail("search_content", "pattern required");
  }

  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateReadToolPath(session, targetPath);
  if (policyFailure) {
    return fail("search_content", policyFailure);
  }

  try {
    if (hasRipgrep()) {
      const output = execFileSync("rg", ["-n", "--color", "never", "--max-count", "100", pattern, targetPath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      return ok("search_content", output.length > 0 ? normalizeContentMatchLines(output, targetPath) : "(no matches)");
    }
  } catch (error) {
    const result = error as NodeJS.ErrnoException & { status?: number; stderr?: string | Buffer };
    if (result.status === 1) {
      return ok("search_content", "(no matches)");
    }
    return fail("search_content", formatToolError(targetPath, result.stderr ? String(result.stderr) : error));
  }

  try {
    const matches = findContentMatches(targetPath, pattern).slice(0, 100);
    return ok("search_content", matches.length > 0 ? matches.join("\n") : "(no matches)");
  } catch (error) {
    return fail("search_content", formatToolError(targetPath, error));
  }
}

function executeSearchFilesTool(session: RuntimeSession, pattern: string, inputPath?: string): InternalToolResult {
  if (!pattern.trim()) {
    return fail("search_files", "pattern required");
  }

  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateReadToolPath(session, targetPath);
  if (policyFailure) {
    return fail("search_files", policyFailure);
  }

  try {
    const matches = searchFilesWithIgnore({ cwd: targetPath, pattern, limit: 100 });
    return ok("search_files", matches.length > 0 ? matches.join("\n") : "(no matches)");
  } catch (error) {
    try {
      const matches = findPathMatches(targetPath, pattern).slice(0, 100);
      return ok("search_files", matches.length > 0 ? matches.join("\n") : "(no matches)");
    } catch {
      return fail("search_files", formatToolError(targetPath, error));
    }
  }
}

function executeGitStatusTool(session: RuntimeSession): InternalToolResult {
  const freshness = session.repo.freshness;
  return ok(
    "git_status",
    [
      `repo: ${session.repo.name}`,
      `branch: ${session.repo.branch ?? "detached"}`,
      `tracking: ${freshness.tracking ?? "none"}`,
      `status: ${freshness.status}`,
      `ahead: ${String(freshness.ahead ?? 0)}`,
      `behind: ${String(freshness.behind ?? 0)}`,
      `dirty: ${String(freshness.dirty)}`,
      `needsPull: ${String(freshness.needsPull)}`,
    ].join("\n"),
  );
}

function executeGitDiffTool(session: RuntimeSession, inputPath?: string): InternalToolResult {
  if (session.repo.vcs !== "git") {
    return fail("git_diff", "git diff unavailable; session repo is not git-backed");
  }

  const repoRoot = session.repo.root || session.cwd;
  if (inputPath) {
    const targetPath = resolveRepoPath(session, inputPath);
    const policyFailure = validateRepoToolPath(session, targetPath);
    if (policyFailure) {
      return fail("git_diff", policyFailure);
    }
  }

  try {
    const output = execFileSync(
      "git",
      inputPath
        ? ["diff", "--no-ext-diff", "--", path.relative(repoRoot, resolveRepoPath(session, inputPath))]
        : ["diff", "--no-ext-diff"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trimEnd();
    return ok("git_diff", output.length > 0 ? capDiffOutput(output) : "(no diff)");
  } catch (error) {
    const result = error as NodeJS.ErrnoException & { status?: number; stderr?: string | Buffer; stdout?: string | Buffer };
    const stdout = result.stdout ? String(result.stdout).trimEnd() : "";
    if (result.status === 0 || stdout.length > 0) {
      return ok("git_diff", stdout.length > 0 ? capDiffOutput(stdout) : "(no diff)");
    }
    return fail("git_diff", formatToolError(repoRoot, result.stderr ? String(result.stderr) : error));
  }
}

function executeShellCommandTool(session: RuntimeSession, command: string): InternalToolResult {
  const normalized = command.trim();
  if (!normalized) {
    return fail("shell_command", "command required");
  }

  const blockedPattern = findBlockedShellPattern(normalized);
  if (blockedPattern) {
    return fail("shell_command", `shell policy blocked command; destructive pattern matched: ${blockedPattern.source}`);
  }

  try {
    const result = spawnSync("bash", ["-lc", normalized], {
      cwd: session.cwd,
      encoding: "utf8",
      env: {
        ...process.env,
      },
      timeout: SHELL_TIMEOUT_MS,
    });

    if (result.error) {
      return fail("shell_command", `shell failed: ${result.error.message}`);
    }

    const transcript = [
      result.stdout?.trimEnd() ?? "",
      result.stderr?.trimEnd() ?? "",
    ].filter((value) => value.length > 0).join("\n");
    const capped = capShellOutput(transcript.length > 0 ? transcript : "(no output)");

    if (result.signal === "SIGTERM") {
      return fail("shell_command", `shell timed out after ${String(SHELL_TIMEOUT_MS)}ms\n${capped}`);
    }

    if ((result.status ?? 0) !== 0) {
      return fail("shell_command", `shell exit ${String(result.status ?? 1)}\n${capped}`);
    }

    return ok("shell_command", withNexsightRouteHint(capped));
  } catch (error) {
    return fail("shell_command", `shell failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function withNexsightRouteHint(output: string): string {
  const lines = output.split(/\r?\n/);
  return output.length > SHELL_MAX_CHARS / 2 || lines.length > SHELL_MAX_LINES / 2
    ? `${output}\n\nnexsight: large output; use nexsight_execute to summarize or nexsight_index to store/search it.`
    : output;
}

async function executeWebFetchTool(inputUrl: string): Promise<InternalToolResult> {
  const url = inputUrl.trim();
  if (!url) {
    return fail("web_fetch", "url required");
  }

  const safetyFailure = await validatePublicHttpUrl(url);
  if (safetyFailure) {
    return fail("web_fetch", safetyFailure);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEB_TIMEOUT_MS);
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html,text/plain,application/json;q=0.9,*/*;q=0.1",
        "user-agent": "nexagent/0.1 web_fetch",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return fail("web_fetch", `fetch failed ${String(response.status)} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "unknown";
    const text = await response.text();
    return ok("web_fetch", withNexsightRouteHint(capWebOutput(`url: ${response.url}\ncontent-type: ${contentType}\n\n${htmlToText(text)}`)));
  } catch (error) {
    return fail("web_fetch", `fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function executeWebSearchTool(query: string, limit: number): Promise<InternalToolResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return fail("web_search", "query required");
  }

  const resultLimit = Math.max(1, Math.min(8, Math.floor(limit)));
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(trimmed)}`;
  const safetyFailure = await validatePublicHttpUrl(searchUrl);
  if (safetyFailure) {
    return fail("web_search", safetyFailure);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEB_TIMEOUT_MS);
    const response = await fetch(searchUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html",
        "user-agent": "nexagent/0.1 web_search",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return fail("web_search", `search failed ${String(response.status)} ${response.statusText}`);
    }

    const html = await response.text();
    const results = parseDuckDuckGoResults(html).slice(0, resultLimit);
    if (results.length === 0) {
      return ok("web_search", "(no results)");
    }
    return ok("web_search", results.map((result, index) => [
      `${String(index + 1)}. ${result.title}`,
      `   ${result.url}`,
      result.snippet ? `   ${result.snippet}` : "",
    ].filter(Boolean).join("\n")).join("\n\n"));
  } catch (error) {
    return fail("web_search", `search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function executeArchivistSaveTool(
  session: RuntimeSession,
  summary: string,
  content?: string,
  tags?: string[],
  type?: string,
): Promise<InternalToolResult> {
  try {
    const result = await saveArchivistMemory(session, { summary, content, tags, type });
    return ok("archivist_save", `saved memory; entries=${String(result.entryCount)}\n${result.preview}`);
  } catch (error) {
    return fail("archivist_save", error instanceof Error ? error.message : String(error));
  }
}

function executeNexsightIndexTool(session: RuntimeSession, args: Record<string, unknown>): InternalToolResult {
  const source = asString(args.source, "");
  const content = asOptionalString(args.content);
  const inputPath = asOptionalString(args.path);
  if (inputPath) {
    const targetPath = resolveRepoPath(session, inputPath);
    const policyFailure = validateReadToolPath(session, targetPath);
    if (policyFailure) {
      return fail("nexsight_index", policyFailure);
    }
    return toToolResult("nexsight_index", indexNexsightFile(session, source || inputPath, targetPath));
  }
  return toToolResult("nexsight_index", indexNexsight(session, { source, content: content ?? "" }));
}

function executeNexsightExecuteTool(session: RuntimeSession, args: Record<string, unknown>): InternalToolResult {
  const command = asOptionalString(args.command ?? args.cmd);
  const code = asString(args.code ?? command ?? args.script, "");
  const requestedLanguage = normalizeNexsightLanguage(asOptionalString(args.language ?? args.lang));
  const language = requestedLanguage ?? inferNexsightLanguage(code, Boolean(command));
  return toToolResult("nexsight_execute", executeNexsight(session, {
    language,
    code,
    timeoutMs: asNumber(args.timeoutMs, 30_000),
  }));
}

function isNexsightShellCall(args: Record<string, unknown>): boolean {
  const language = normalizeNexsightLanguage(asOptionalString(args.language ?? args.lang));
  return language === "shell" || Boolean(asOptionalString(args.command ?? args.cmd));
}

function normalizeNexsightLanguage(value?: string): string | undefined {
  const language = value?.trim().toLowerCase();
  if (!language) {
    return undefined;
  }
  if (language === "js" || language === "node") {
    return "javascript";
  }
  if (language === "py") {
    return "python";
  }
  if (language === "sh" || language === "bash") {
    return "shell";
  }
  return language;
}

function inferNexsightLanguage(code: string, hasCommand: boolean): string {
  if (hasCommand) {
    return "shell";
  }
  const trimmed = code.trim();
  if (/^(from\s+\S+\s+import\s+|import\s+(os|sys|json|pathlib|subprocess|re)\b|print\s*\(|for\s+\w+\s+in\s+|def\s+\w+\s*\()/m.test(trimmed)) {
    return "python";
  }
  if (/^(find|rg|grep|ls|cat|sed|awk|printf|git|python3?)\b/m.test(trimmed)) {
    return "shell";
  }
  return "javascript";
}

function executeNexsightBatchTool(session: RuntimeSession, args: Record<string, unknown>): InternalToolResult {
  const inputPath = asOptionalString(args.root);
  if (inputPath) {
    const targetPath = resolveRepoPath(session, inputPath);
    const policyFailure = validateReadToolPath(session, targetPath);
    if (policyFailure) {
      return fail("nexsight_batch", policyFailure);
    }
  }
  return toToolResult("nexsight_batch", batchIndexNexsight(session, {
    root: inputPath,
    pattern: asOptionalString(args.pattern),
    limit: asNumber(args.limit, 100),
  }));
}

async function executeArchivistCheckpointTool(session: RuntimeSession, reason?: string): Promise<InternalToolResult> {
  try {
    const result = await checkpointArchivistSession(session, reason);
    return ok("archivist_checkpoint", `saved checkpoint; entries=${String(result.entryCount)}\n${result.preview}`);
  } catch (error) {
    return fail("archivist_checkpoint", error instanceof Error ? error.message : String(error));
  }
}

function findContentMatches(rootPath: string, pattern: string): string[] {
  const matches: string[] = [];
  const queue = [rootPath];
  const normalizedPattern = pattern.toLowerCase();

  while (queue.length > 0 && matches.length < 100) {
    const currentPath = queue.shift();
    if (!currentPath) {
      continue;
    }

    const stats = statSync(currentPath);
    if (stats.isDirectory()) {
      const entries = readdirSync(currentPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") {
          continue;
        }
        queue.push(path.join(currentPath, entry.name));
      }
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    const content = readFileSync(currentPath, "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length && matches.length < 100; index += 1) {
      if (lines[index].toLowerCase().includes(normalizedPattern)) {
        matches.push(`${formatMatchPath(rootPath, currentPath)}:${index + 1}:${lines[index]}`);
      }
    }
  }

  return matches;
}

function findPathMatches(rootPath: string, pattern: string): string[] {
  const matches: string[] = [];
  const queue = [rootPath];
  const matcher = globToRegExp(pattern);

  while (queue.length > 0 && matches.length < 100) {
    const currentPath = queue.shift();
    if (!currentPath) {
      continue;
    }

    const stats = statSync(currentPath);
    if (stats.isDirectory()) {
      const entries = readdirSync(currentPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") {
          continue;
        }
        queue.push(path.join(currentPath, entry.name));
      }
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    const relativePath = path.relative(rootPath, currentPath).split(path.sep).join("/");
    if (matcher.test(relativePath)) {
      matches.push(relativePath);
    }
  }

  return matches;
}

function globToRegExp(globPattern: string): RegExp {
  const normalized = globPattern.trim().split(path.sep).join("/");
  let source = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index];
    const next = normalized[index + 1];

    if (current === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (current === "*") {
      source += "[^/]*";
      continue;
    }
    if (current === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(current ?? "");
  }

  source += "$";
  return new RegExp(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function hasRipgrep(): boolean {
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function capShellOutput(output: string): string {
  const lines = output.split(/\r?\n/);
  const cappedLines = lines.slice(0, SHELL_MAX_LINES);
  let capped = cappedLines.join("\n");
  if (capped.length > SHELL_MAX_CHARS) {
    capped = `${capped.slice(0, SHELL_MAX_CHARS)}\n... output truncated ...`;
  } else if (lines.length > SHELL_MAX_LINES) {
    capped = `${capped}\n... output truncated ...`;
  }
  return capped;
}

function capDiffOutput(output: string): string {
  const lines = output.split(/\r?\n/);
  const cappedLines = lines.slice(0, DIFF_MAX_LINES);
  let capped = cappedLines.join("\n");
  if (capped.length > DIFF_MAX_CHARS) {
    capped = `${capped.slice(0, DIFF_MAX_CHARS)}\n... diff truncated ...`;
  } else if (lines.length > DIFF_MAX_LINES) {
    capped = `${capped}\n... diff truncated ...`;
  }
  return capped;
}

function capWebOutput(output: string): string {
  const normalized = output.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return normalized.length > WEB_MAX_CHARS ? `${normalized.slice(0, WEB_MAX_CHARS)}\n... web output truncated ...` : normalized;
}

async function validatePublicHttpUrl(inputUrl: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    return "invalid URL";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "only http and https URLs are allowed";
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "local host URLs are blocked";
  }

  if (isPrivateAddress(hostname)) {
    return "private network URLs are blocked";
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.some((address) => isPrivateAddress(address.address))) {
      return "private network URLs are blocked";
    }
  } catch {
    return `unable to resolve host: ${hostname}`;
  }

  return null;
}

function isPrivateAddress(value: string): boolean {
  const version = isIP(value);
  if (version === 4) {
    const parts = value.split(".").map((part) => Number.parseInt(part, 10));
    const [a = 0, b = 0] = parts;
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }
  if (version === 6) {
    return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:");
  }
  return false;
}

function htmlToText(value: string): string {
  return decodeHtmlEntities(value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " "));
}

function parseDuckDuckGoResults(html: string): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(html)) && results.length < 8) {
    results.push({
      title: htmlToText(match[2] ?? ""),
      url: normalizeDuckDuckGoUrl(decodeHtmlEntities(match[1] ?? "")),
      snippet: htmlToText(match[3] ?? ""),
    });
  }
  return results;
}

function normalizeDuckDuckGoUrl(value: string): string {
  try {
    const parsed = new URL(value, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : parsed.toString();
  } catch {
    return value;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function ok(tool: InternalToolName, output: string): InternalToolResult {
  return { ok: true, tool, output };
}

function fail(tool: InternalToolName, output: string): InternalToolResult {
  return { ok: false, tool, output };
}

function toToolResult(tool: InternalToolName, result: { ok: boolean; output: string }): InternalToolResult {
  return { ok: result.ok, tool, output: result.output };
}

function pending(tool: InternalToolName, detail: string): InternalToolResult {
  return { ok: false, tool, output: `${tool} requires ${detail} execution path` };
}

function formatToolError(targetPath: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${targetPath}: ${message}`;
}

function formatToolPath(session: RuntimeSession, targetPath: string): string {
  const relativePath = path.relative(session.cwd, targetPath);
  if (relativePath.length === 0) {
    return ".";
  }
  return relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : targetPath;
}

function normalizeContentMatchLines(output: string, rootPath: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => normalizeContentMatchLine(line, rootPath))
    .join("\n");
}

function normalizePathMatchLines(output: string, rootPath: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => formatMatchPath(rootPath, line))
    .join("\n");
}

function normalizeContentMatchLine(line: string, rootPath: string): string {
  const match = line.match(/^(.+?):(\d+):(.*)$/);
  if (!match) {
    return line;
  }

  return `${formatMatchPath(rootPath, match[1] ?? "")}:${match[2]}:${match[3] ?? ""}`;
}

function formatMatchPath(rootPath: string, filePath: string): string {
  const relativePath = path.relative(rootPath, filePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return filePath;
  }
  return relativePath.split(path.sep).join("/");
}
