import type { InternalToolName } from "./tools.js";

export type ToolEvidenceKind = "read" | "write" | "search" | "analysis" | "memory" | "shell" | "vcs" | "web";

export interface ToolContract {
  name: InternalToolName;
  displayName: string;
  summary: string;
  evidence: ToolEvidenceKind;
  writes: boolean;
  nexsight: boolean;
}

const TOOL_CONTRACTS: Record<InternalToolName, ToolContract> = {
  read_file: {
    name: "read_file",
    displayName: "read_file",
    summary: "Read UTF-8 file content from allowed roots.",
    evidence: "read",
    writes: false,
    nexsight: false,
  },
  write_file: {
    name: "write_file",
    displayName: "write_file",
    summary: "Write UTF-8 file content in writable roots.",
    evidence: "write",
    writes: true,
    nexsight: false,
  },
  apply_patch: {
    name: "apply_patch",
    displayName: "apply_patch",
    summary: "Apply exact text patch in writable roots.",
    evidence: "write",
    writes: true,
    nexsight: false,
  },
  batch_edit: {
    name: "batch_edit",
    displayName: "batch_edit",
    summary: "Apply multiple anchored edits atomically.",
    evidence: "write",
    writes: true,
    nexsight: false,
  },
  preview_patch: {
    name: "preview_patch",
    displayName: "preview_patch",
    summary: "Preview patch without writing file.",
    evidence: "analysis",
    writes: false,
    nexsight: false,
  },
  list_dir: {
    name: "list_dir",
    displayName: "list_dir",
    summary: "List directory entries from allowed roots.",
    evidence: "read",
    writes: false,
    nexsight: false,
  },
  search_content: {
    name: "search_content",
    displayName: "search_content",
    summary: "Search text content within allowed files.",
    evidence: "search",
    writes: false,
    nexsight: false,
  },
  search_files: {
    name: "search_files",
    displayName: "search_files",
    summary: "Find files by pattern with ignore support.",
    evidence: "search",
    writes: false,
    nexsight: false,
  },
  web_fetch: {
    name: "web_fetch",
    displayName: "web_fetch",
    summary: "Fetch and return bounded web page content.",
    evidence: "web",
    writes: false,
    nexsight: false,
  },
  web_search: {
    name: "web_search",
    displayName: "web_search",
    summary: "Run web search and return bounded results.",
    evidence: "web",
    writes: false,
    nexsight: false,
  },
  git_status: {
    name: "git_status",
    displayName: "git_status",
    summary: "Show repository status.",
    evidence: "vcs",
    writes: false,
    nexsight: false,
  },
  git_diff: {
    name: "git_diff",
    displayName: "git_diff",
    summary: "Show bounded git diff for file.",
    evidence: "vcs",
    writes: false,
    nexsight: false,
  },
  shell_command: {
    name: "shell_command",
    displayName: "shell_command",
    summary: "Run guarded shell command with destructive patterns blocked.",
    evidence: "shell",
    writes: true,
    nexsight: false,
  },
  nexsight_execute: {
    name: "nexsight_execute",
    displayName: "nexsight_execute",
    summary: "Run bounded script/command in Nexsight sandbox.",
    evidence: "analysis",
    writes: false,
    nexsight: true,
  },
  nexsight_index: {
    name: "nexsight_index",
    displayName: "nexsight_index",
    summary: "Index source content into Nexsight knowledge base.",
    evidence: "analysis",
    writes: false,
    nexsight: true,
  },
  nexsight_batch: {
    name: "nexsight_batch",
    displayName: "nexsight_batch",
    summary: "Batch index files into Nexsight knowledge base.",
    evidence: "analysis",
    writes: false,
    nexsight: true,
  },
  nexsight_search: {
    name: "nexsight_search",
    displayName: "nexsight_search",
    summary: "Search Nexsight indexed knowledge.",
    evidence: "analysis",
    writes: false,
    nexsight: true,
  },
  archivist_save: {
    name: "archivist_save",
    displayName: "archivist_save",
    summary: "Persist memory entry to Archivist.",
    evidence: "memory",
    writes: false,
    nexsight: false,
  },
  archivist_checkpoint: {
    name: "archivist_checkpoint",
    displayName: "archivist_checkpoint",
    summary: "Persist checkpoint lineage to Archivist.",
    evidence: "memory",
    writes: false,
    nexsight: false,
  },
};

export function getToolContract(toolName: InternalToolName): ToolContract {
  return TOOL_CONTRACTS[toolName];
}

export function getToolContracts(): readonly ToolContract[] {
  return Object.values(TOOL_CONTRACTS);
}

export function isWriteToolName(toolName: InternalToolName): boolean {
  return TOOL_CONTRACTS[toolName].writes;
}

export function isNexsightToolName(toolName: InternalToolName): boolean {
  return TOOL_CONTRACTS[toolName].nexsight;
}
