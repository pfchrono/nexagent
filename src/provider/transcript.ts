import type { InternalToolCall, InternalToolName, InternalToolResult } from "../runtime/tools.js";

const INTERNAL_TOOL_TRANSCRIPT_LABEL = "Internal tool transcript:";

export function truncateToolOutput(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return "none";
  }
  return trimmed.length > 260 ? `${trimmed.slice(0, 257)}...` : trimmed;
}

export function formatToolTranscriptOutput(toolName: InternalToolName, result: InternalToolResult): string {
  if (!result.ok || !isDiffPreviewTool(toolName)) {
    return "";
  }
  const output = result.output.trim();
  if (!output || !/\bEdited .+ \(\+\d+ -\d+\)/.test(output)) {
    return "";
  }
  return `\n${output}`;
}

export function formatInternalToolExchange(step: number, call: InternalToolCall, result: InternalToolResult): string {
  return [
    `Step ${String(step)}`,
    `Tool call: ${JSON.stringify(call)}`,
    `Tool result (${result.ok ? "ok" : "error"}):`,
    result.output,
    formatToolRecoveryHint(call, result),
  ].filter((line) => line.length > 0).join("\n");
}

export function createPromptWithToolTranscript(basePrompt: string, toolTranscript: string[], suffix: string, limit?: number): string {
  const transcript = formatToolTranscriptSection(toolTranscript, limit);
  return transcript
    ? `${basePrompt}\n\n${transcript}\n\n${suffix}`
    : `${basePrompt}\n\n${suffix}`;
}

export function formatToolTranscriptSection(toolTranscript: string[], limit?: number): string {
  const entries = compactToolTranscriptEntries(toolTranscript, limit);
  if (entries.length === 0) {
    return "";
  }
  return `${INTERNAL_TOOL_TRANSCRIPT_LABEL}\n${entries.join("\n\n")}`;
}

export function compactToolTranscriptEntries(toolTranscript: string[], limit?: number): string[] {
  return typeof limit === "number" ? toolTranscript.slice(-limit) : toolTranscript;
}

function isDiffPreviewTool(toolName: InternalToolName): boolean {
  return toolName === "write_file" || toolName === "apply_patch" || toolName === "batch_edit" || toolName === "preview_patch";
}

function formatToolRecoveryHint(call: InternalToolCall, result: InternalToolResult): string {
  if (result.ok) {
    return "";
  }
  if (call.name === "shell_command" && result.output.startsWith("shell policy blocked command")) {
    return [
      "Recovery hint:",
      "- Do not retry same shell command.",
      "- Use read_file/list_dir/search_content for inspection.",
      "- Use write_file/apply_patch/batch_edit for workspace file changes.",
      "- Run /why-blocked if user asks why command was blocked.",
    ].join("\n");
  }
  if (/tool policy blocked .*protected path/i.test(result.output)) {
    return "Recovery hint:\n- Do not access protected roots. Use repo-local paths or ask user for safe input path.";
  }
  if (/not found|no such file|enoent|cannot find module|module not found/i.test(result.output)) {
    return [
      "Recovery hint:",
      "- Do not retry same missing path/module blindly.",
      "- Use search_files/list_dir/nexsight_gather to locate current path or package.",
      "- If dependency is missing, inspect package scripts/deps before installing project-local fallback.",
    ].join("\n");
  }
  if (/timed out|timeout/i.test(result.output)) {
    return [
      "Recovery hint:",
      "- Retry with narrower scope, shorter timeout-safe command, or Nexsight compressed inspection.",
      "- Prefer focused tests/build targets over full-suite repeats.",
      "- If long-running work is necessary, report exact command and why it must run longer.",
    ].join("\n");
  }
  if (/malformed|schema|arguments|required/i.test(result.output)) {
    return [
      "Recovery hint:",
      "- Correct tool argument shape from the tool schema.",
      "- Keep one valid tool call only; do not explain schema fixes in prose before retrying.",
    ].join("\n");
  }
  return "";
}
