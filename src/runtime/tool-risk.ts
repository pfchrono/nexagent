import type { InternalToolCall } from "./tools.js";

export type InternalToolRisk = "low" | "guarded";

export function classifyInternalToolRisk(call: InternalToolCall): InternalToolRisk {
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
    || call.name === "mcp_call"
    || call.name === "nexsight_index"
    || call.name === "nexsight_batch"
    || call.name === "archivist_save"
    || call.name === "archivist_checkpoint"
    || call.name === "lsp_symbols"
    || call.name === "lsp_diagnostics"
    || call.name === "lsp_navigation"
    ? "guarded"
    : "low";
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
  return language;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
