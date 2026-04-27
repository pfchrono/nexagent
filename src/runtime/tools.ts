import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import { checkpointArchivistSession, saveArchivistMemory } from "./archivist.js";
import type { RuntimeSession } from "./session.js";

export type InternalToolName =
  | "read_file"
  | "write_file"
  | "apply_patch"
  | "list_dir"
  | "search_content"
  | "search_files"
  | "git_status"
  | "git_diff"
  | "shell_command"
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
const BLOCKED_SHELL_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\brm\s+-r\b/i,
  /\bmv\b\s+.+\s+\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)(?:\/|$)/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /\bdd\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\b/i,
  /\bfind\b[\s\S]*\b-delete\b/i,
  />\s*\//,
  /\|\s*sh\b/i,
  /\|\s*bash\b/i,
] as const;

export function getInternalToolDefinitions(): readonly InternalToolDefinition[] {
  return [
    {
      name: "read_file",
      description: "Read UTF-8 text file inside repo-local allowed roots.",
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
      description: "Write UTF-8 text file inside repo-local allowed roots.",
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
      description: "Apply exact text replacement inside existing UTF-8 file inside repo-local allowed roots.",
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
      description: "List directory contents inside repo-local allowed roots.",
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
    case "list_dir":
      return executeListDirTool(session, asOptionalString(call.arguments?.path));
    case "search_content":
      return executeSearchContentTool(session, asString(call.arguments?.pattern, ""), asOptionalString(call.arguments?.path));
    case "search_files":
      return executeSearchFilesTool(session, asString(call.arguments?.pattern, ""), asOptionalString(call.arguments?.path));
    case "git_status":
      return executeGitStatusTool(session);
    case "git_diff":
      return executeGitDiffTool(session, asOptionalString(call.arguments?.path));
    case "shell_command":
      return executeShellCommandTool(session, asString(call.arguments?.command, ""));
    case "archivist_save":
      return pending("archivist_save", "async");
    case "archivist_checkpoint":
      return pending("archivist_checkpoint", "async");
  }
}

export async function executeInternalToolAsync(session: RuntimeSession, call: InternalToolCall): Promise<InternalToolResult> {
  switch (call.name) {
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
  return call.name === "shell_command"
    || call.name === "write_file"
    || call.name === "apply_patch"
    || call.name === "archivist_save"
    || call.name === "archivist_checkpoint"
    ? "guarded"
    : "low";
}

export function resolveRepoPath(session: RuntimeSession, inputPath?: string): string {
  if (!inputPath || inputPath === ".") {
    return session.cwd;
  }
  return path.resolve(session.cwd, inputPath);
}

export function validateRepoToolPath(session: RuntimeSession, targetPath: string): string | null {
  const resolvedPath = path.resolve(targetPath);

  for (const protectedRoot of session.toolPolicy.protectedRoots) {
    if (isWithinRoot(resolvedPath, protectedRoot)) {
      return `tool policy blocked ${resolvedPath}; protected path`;
    }
  }

  if (session.toolPolicy.allowedRoots.some((root) => isWithinRoot(resolvedPath, root))) {
    return null;
  }

  return `tool policy blocked ${resolvedPath}; outside repo-local roots`;
}

function executeReadFileTool(session: RuntimeSession, inputPath: string): InternalToolResult {
  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateRepoToolPath(session, targetPath);
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
  const policyFailure = validateRepoToolPath(session, targetPath);
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
  const policyFailure = validateRepoToolPath(session, targetPath);
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
  const policyFailure = validateRepoToolPath(session, targetPath);
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

function executeSearchContentTool(session: RuntimeSession, pattern: string, inputPath?: string): InternalToolResult {
  if (!pattern.trim()) {
    return fail("search_content", "pattern required");
  }

  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateRepoToolPath(session, targetPath);
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
  const policyFailure = validateRepoToolPath(session, targetPath);
  if (policyFailure) {
    return fail("search_files", policyFailure);
  }

  try {
    if (hasRipgrep()) {
      const output = execFileSync("rg", ["--files", "-g", pattern, targetPath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      return ok("search_files", output.length > 0 ? normalizePathMatchLines(output, targetPath) : "(no matches)");
    }
  } catch (error) {
    const result = error as NodeJS.ErrnoException & { status?: number; stderr?: string | Buffer };
    if (result.status === 1) {
      return ok("search_files", "(no matches)");
    }
    return fail("search_files", formatToolError(targetPath, result.stderr ? String(result.stderr) : error));
  }

  try {
    const matches = findPathMatches(targetPath, pattern).slice(0, 100);
    return ok("search_files", matches.length > 0 ? matches.join("\n") : "(no matches)");
  } catch (error) {
    return fail("search_files", formatToolError(targetPath, error));
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

  const blockedPattern = BLOCKED_SHELL_PATTERNS.find((pattern) => pattern.test(normalized));
  if (blockedPattern) {
    return fail("shell_command", `shell policy blocked command; destructive pattern matched: ${blockedPattern.source}`);
  }

  try {
    const result = spawnSync("bash", ["-lc", normalized], {
      cwd: session.cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: session.cwd,
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

    return ok("shell_command", capped);
  } catch (error) {
    return fail("shell_command", `shell failed: ${error instanceof Error ? error.message : String(error)}`);
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

function ok(tool: InternalToolName, output: string): InternalToolResult {
  return { ok: true, tool, output };
}

function fail(tool: InternalToolName, output: string): InternalToolResult {
  return { ok: false, tool, output };
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

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const resolvedRoot = path.resolve(rootPath);
  if (targetPath === resolvedRoot) {
    return true;
  }

  const relativePath = path.relative(resolvedRoot, targetPath);
  return relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}
