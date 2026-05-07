import path from "node:path";

export const DEFAULT_PRODUCT_NAME = "nexagent";
export const DEFAULT_PROVIDER = "codex";
export const NEXAGENT_SETTINGS_DIR = ".nexagent";
export const DEFAULT_MCP_CONFIG_FILE = path.join(NEXAGENT_SETTINGS_DIR, "mcp.json");
export const LEGACY_MCP_CONFIG_FILE = ".mcp.json";
export const CODEX_CONFIG_FILE = ".codex/config.toml";
export const NEXAGENT_CONFIG_BASENAME = "config.json";
export const NEXAGENT_SETTINGS_BASENAME = "settings.json";
export const NEXAGENT_LOCAL_SETTINGS_BASENAME = "settings.local.json";
export const NEXAGENT_SETTINGS_FILE = path.join(NEXAGENT_SETTINGS_DIR, NEXAGENT_SETTINGS_BASENAME);
export const NEXAGENT_CONFIG_FILE = path.join(NEXAGENT_SETTINGS_DIR, NEXAGENT_CONFIG_BASENAME);
export const NEXAGENT_LOCAL_SETTINGS_FILE = path.join(NEXAGENT_SETTINGS_DIR, NEXAGENT_LOCAL_SETTINGS_BASENAME);
export const CLAUDE_SETTINGS_FILE = path.join(".claude", "settings.json");
export const CLAUDE_LOCAL_SETTINGS_FILE = path.join(".claude", "settings.local.json");
export const DEFAULT_CLAUDE_IMPORT_PATHS = [CLAUDE_LOCAL_SETTINGS_FILE, CLAUDE_SETTINGS_FILE];
export const REPO_INSTRUCTION_SOURCE_CANDIDATES = [
  { kind: "AGENTS.md", relativePath: "AGENTS.md" },
  { kind: "CLAUDE.md", relativePath: "CLAUDE.md" },
  { kind: ".claude", relativePath: ".claude" },
  { kind: ".nexagent/mcp.json", relativePath: DEFAULT_MCP_CONFIG_FILE },
  { kind: ".mcp.json", relativePath: ".mcp.json" },
  { kind: "openspec", relativePath: "openspec" },
] as const;

export function normalizeRuntimeCwd(cwd: unknown): string {
  if (typeof cwd === "string" && cwd.trim()) {
    return path.resolve(cwd);
  }
  return process.cwd();
}
