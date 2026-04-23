import { readFile } from "node:fs/promises";
import path from "node:path";

export interface HarnessConfig {
  cwd: string;
  productName: string;
  defaultProvider: string;
  mcpConfigPath: string;
}

interface ClaudeSettings {
  env?: {
    ANTHROPIC_MODEL?: string;
    CODEX_MODEL?: string;
    OPENAI_MODEL?: string;
  };
}

const DEFAULT_PRODUCT_NAME = "nexagent";
const DEFAULT_PROVIDER = "codex";
const MCP_CONFIG_FILE = ".mcp.json";
const CLAUDE_SETTINGS_FILE = path.join(".claude", "settings.local.json");

export async function loadHarnessConfig(cwd: string): Promise<HarnessConfig> {
  const settings = await readJsonIfExists<ClaudeSettings>(path.join(cwd, CLAUDE_SETTINGS_FILE));
  const env = settings?.env ?? {};

  return {
    cwd,
    productName: DEFAULT_PRODUCT_NAME,
    defaultProvider: inferDefaultProvider(env),
    mcpConfigPath: path.join(cwd, MCP_CONFIG_FILE),
  };
}

function inferDefaultProvider(env: ClaudeSettings["env"]): string {
  if (env?.CODEX_MODEL) {
    return "codex";
  }

  if (env?.OPENAI_MODEL) {
    return "openai";
  }

  if (env?.ANTHROPIC_MODEL) {
    return "anthropic";
  }

  return DEFAULT_PROVIDER;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      return null;
    }

    throw error;
  }
}
