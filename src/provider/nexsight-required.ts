import {
  compactToolTranscriptEntries,
  createPromptWithToolTranscript,
} from "./transcript.js";
import { recordRuntimeEvent, type RuntimeSession } from "../runtime/session.js";
import type { InternalToolCall, InternalToolResult } from "../runtime/tools.js";

type RequiredNexsightRequest = {
  session: RuntimeSession;
};

type RequiredNexsightExecutor = (
  session: RuntimeSession,
  call: InternalToolCall,
) => Promise<InternalToolResult>;

export type RequiredNexsightProviderSuccess = {
  ok: true;
  provider: string;
  model: string | null;
  transport: "codex" | "openai";
  adapter: "codex-cli-exec" | "openai-http-responses" | "codex-chatgpt-http";
  fallbackApplied: false;
  output: string;
};

export function createGuidedPrompt(basePrompt: string, toolTranscript: string[], nudge: string): string {
  return createPromptWithToolTranscript(basePrompt, toolTranscript, nudge);
}

export async function runRequiredNexsightFallback(
  request: RequiredNexsightRequest,
  userPrompt: string,
  executeTool: RequiredNexsightExecutor,
): Promise<{ call: InternalToolCall; result: InternalToolResult }> {
  const call = createRequiredNexsightEvidenceCall(userPrompt, "fallback");
  recordRuntimeEvent(request.session, {
    kind: "control",
    status: "queued",
    summary: "required nexsight fallback started",
    detail: "model ignored explicit Nexsight evidence requirement; harness running bounded inspection",
  });
  const result = await executeTool(request.session, call);
  return { call, result };
}

export async function runRequiredNexsightPreflight(
  request: RequiredNexsightRequest,
  userPrompt: string,
  executeTool: RequiredNexsightExecutor,
): Promise<{ call: InternalToolCall; result: InternalToolResult }> {
  const call = createRequiredNexsightEvidenceCall(userPrompt, "preflight");
  recordRuntimeEvent(request.session, {
    kind: "control",
    status: "queued",
    summary: "required nexsight preflight started",
    detail: "user explicitly requested Nexsight; harness running bounded inspection before provider",
  });
  const result = await executeTool(request.session, call);
  return { call, result };
}

export function createRequiredNexsightPreflightPrompt(basePrompt: string, toolTranscript: string[]): string {
  return [
    basePrompt,
    "",
    "Required Nexsight preflight evidence:",
    compactToolTranscriptEntries(toolTranscript, 3).join("\n\n"),
    "",
    "The harness already ran Nexsight because the user explicitly required it.",
    "Answer from this evidence. If the evidence is insufficient, request one focused Nexsight tool call next.",
    "Do not say Nexsight was not used.",
  ].join("\n");
}

export function createRequiredNexsightFallbackPrompt(basePrompt: string, toolTranscript: string[]): string {
  return [
    basePrompt,
    "",
    "Required Nexsight fallback evidence:",
    compactToolTranscriptEntries(toolTranscript, 3).join("\n\n"),
    "",
    "The harness ran Nexsight because the user explicitly required it and prior output did not contain Nexsight tool evidence.",
    "Answer from this evidence. Do not claim any additional inspection unless you request another valid tool call.",
  ].join("\n");
}

export function createRequiredNexsightFallbackSuccess(
  request: RequiredNexsightRequest,
  model: string | null,
  transport: RequiredNexsightProviderSuccess["transport"],
  adapter: RequiredNexsightProviderSuccess["adapter"],
  result: InternalToolResult,
): RequiredNexsightProviderSuccess {
  const output = summarizeRequiredNexsightFallbackOutput(result.output);
  recordRuntimeEvent(request.session, {
    kind: "assistant",
    status: "completed",
    summary: "assistant response completed",
    detail: output,
  });
  recordRuntimeEvent(request.session, {
    kind: "provider",
    status: "completed",
    summary: `${request.session.provider} turn completed`,
    detail: `transport=${request.session.providerTransport.mode}; output_chars=${String(output.length)}; harness_nexsight_fallback=true`,
  });
  return {
    ok: true,
    provider: request.session.provider,
    model,
    transport,
    adapter,
    fallbackApplied: false,
    output,
  };
}

function summarizeRequiredNexsightFallbackOutput(rawOutput: string): string {
  const parsed = parseJsonObject(rawOutput);
  if (!parsed) {
    return [
      "Nexsight fallback completed.",
      "",
      "Nexsight returned unstructured output:",
      rawOutput.slice(0, 1600),
    ].join("\n");
  }
  if (!isRequiredNexsightScanObject(parsed)) {
    return [
      "Nexsight fallback did not produce repo scan output.",
      "",
      "Returned payload looked like runtime/session metadata or another non-scan object, so it was not treated as repo evidence.",
      "",
      "Output preview:",
      rawOutput.slice(0, 1600),
    ].join("\n");
  }

  const root = typeof parsed.root === "string" ? parsed.root : "(unknown)";
  const requested = typeof parsed.requested === "string" ? parsed.requested : ".";
  const exists = parsed.exists === true;
  const kind = typeof parsed.kind === "string" ? parsed.kind : "(unknown)";
  const topLevel = summarizeNamedEntries(parsed.topLevel, 20);
  const keyFiles = summarizeStringArray(parsed.keyFiles, 16);
  const directories = summarizeStringArray(parsed.directories, 16);
  const fileTypes = summarizeFileTypes(parsed.filesByExt, 12);
  const sampleFiles = summarizeStringArray(parsed.sampleFiles, 16);

  return [
    "Nexsight fallback completed.",
    "",
    "What Nexsight inspected:",
    `- requested: ${requested}`,
    `- root: ${root}`,
    `- exists: ${String(exists)}`,
    `- kind: ${kind}`,
    "",
    "Repo shape:",
    `- top-level entries: ${topLevel}`,
    `- directories: ${directories}`,
    `- key files: ${keyFiles}`,
    `- file types: ${fileTypes}`,
    `- sample files: ${sampleFiles}`,
  ].join("\n");
}

function parseJsonObject(rawOutput: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(rawOutput);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    const start = rawOutput.indexOf("{");
    const end = rawOutput.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(rawOutput.slice(start, end + 1));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      return null;
    }
  }
}

function isRequiredNexsightScanObject(value: Record<string, unknown>): boolean {
  return (
    typeof value.requested === "string" &&
    typeof value.root === "string" &&
    typeof value.exists === "boolean" &&
    "kind" in value &&
    Array.isArray(value.topLevel) &&
    Array.isArray(value.keyFiles) &&
    Array.isArray(value.directories) &&
    value.filesByExt !== null &&
    typeof value.filesByExt === "object" &&
    !Array.isArray(value.filesByExt) &&
    Array.isArray(value.sampleFiles)
  );
}

function summarizeStringArray(value: unknown, limit: number): string {
  if (!Array.isArray(value)) {
    return "(none)";
  }
  const names = value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .slice(0, limit);
  if (names.length === 0) {
    return "(none)";
  }
  const suffix = value.length > names.length ? `, +${String(value.length - names.length)} more` : "";
  return `${names.join(", ")}${suffix}`;
}

function summarizeNamedEntries(value: unknown, limit: number): string {
  if (!Array.isArray(value)) {
    return "(none)";
  }
  const names = value
    .map((entry) => {
      if (typeof entry === "string" && entry.length > 0) {
        return entry;
      }
      if (entry && typeof entry === "object" && "name" in entry && typeof entry.name === "string") {
        return entry.name;
      }
      return null;
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, limit);
  if (names.length === 0) {
    return "(none)";
  }
  const suffix = value.length > names.length ? `, +${String(value.length - names.length)} more` : "";
  return `${names.join(", ")}${suffix}`;
}

function summarizeFileTypes(value: unknown, limit: number): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "(none)";
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([ext, count]) => `${ext} ${String(count)}`);
  return entries.length > 0 ? entries.join(", ") : "(none)";
}

function createRequiredNexsightEvidenceCall(userPrompt: string, mode: "preflight" | "fallback"): InternalToolCall {
  const target = extractLikelyNexsightTarget(userPrompt);
  const code = `
const fs = require("fs");
const path = require("path");

const requested = ${JSON.stringify(target)};
const cwd = process.env.NEXAGENT_CWD || process.cwd();
const home = process.env.HOME || cwd;
const skip = new Set([".git", "node_modules", "dist", "build", "coverage", ".next", ".cache", ".bun", ".nexagent"]);
const keyFileRe = /^(README|AGENTS|CLAUDE|package|tsconfig|bun|pnpm|yarn|Cargo|pyproject|go\\.mod|Makefile|Dockerfile)/i;
const sourceExt = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go", ".sh", ".md", ".json", ".toml", ".yml", ".yaml"]);

function resolveTarget(input) {
  if (!input || input === ".") return cwd;
  if (input.startsWith("~/")) return path.resolve(home, input.slice(2));
  if (path.isAbsolute(input)) return path.resolve(input);
  return path.resolve(cwd, input);
}

function safeReadDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

const root = resolveTarget(requested);
const out = {
  requested,
  root,
  exists: false,
  kind: null,
  topLevel: [],
  keyFiles: [],
  directories: [],
  filesByExt: {},
  sampleFiles: [],
};

try {
  if (!fs.existsSync(root)) {
    console.log(JSON.stringify(out));
    process.exit(0);
  }
  const stat = fs.statSync(root);
  out.exists = true;
  out.kind = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other";
  if (!stat.isDirectory()) {
    out.keyFiles.push(path.basename(root));
    console.log(JSON.stringify(out));
    process.exit(0);
  }

  const top = safeReadDir(root).slice(0, 120);
  out.topLevel = top.map((entry) => \`\${entry.isDirectory() ? "dir" : "file"}:\${entry.name}\`).slice(0, 32);
  out.directories = top.filter((entry) => entry.isDirectory()).map((entry) => entry.name).slice(0, 20);
  out.keyFiles = top.filter((entry) => entry.isFile() && keyFileRe.test(entry.name)).map((entry) => entry.name).slice(0, 20);

  function walk(dir, depth) {
    if (depth > 3 || out.sampleFiles.length >= 40) return;
    for (const entry of safeReadDir(dir)) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name) || "<none>";
      out.filesByExt[ext] = (out.filesByExt[ext] || 0) + 1;
      if (sourceExt.has(ext) || keyFileRe.test(entry.name)) {
        out.sampleFiles.push(path.relative(root, full));
      }
    }
  }

  walk(root, 0);
  console.log(JSON.stringify(out));
} catch (error) {
  console.log(JSON.stringify({ requested, root, error: error && error.message ? error.message : String(error) }));
}
`.trim();

  return {
    name: "nexsight_execute",
    arguments: {
      language: "javascript",
      reason: mode === "preflight"
        ? "required Nexsight preflight for explicit user request"
        : "required Nexsight fallback after missing model-provided evidence",
      code,
      timeoutMs: 10_000,
    },
  };
}

function extractLikelyNexsightTarget(prompt: string): string {
  const candidates = prompt.match(/(?:~\/|\/)[^\s"'`),;]+/g) ?? [];
  for (const candidate of candidates) {
    const cleaned = candidate.replace(/[.?!:]+$/, "");
    if (cleaned && !/^\/(?:etc|dev|proc|sys|run)\b/.test(cleaned)) {
      return cleaned;
    }
  }
  return ".";
}
