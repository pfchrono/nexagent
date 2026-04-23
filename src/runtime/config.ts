import { readFile } from "node:fs/promises";
import path from "node:path";

export interface HarnessConfig {
  cwd: string;
  productName: string;
  provider: string;
  mcpConfigPath: string;
  enabledMcpServers: string[];
  imports: ConfigImports;
}

export interface ConfigImports {
  claude: ImportedClaudeSettings | null;
}

export interface ImportedClaudeSettings {
  path: string;
  importedKeys: string[];
}

interface ClaudeSettings {
  apiProvider?: string;
  enabledMcpServers?: string[];
  env?: {
    ANTHROPIC_MODEL?: string;
    CODEX_MODEL?: string;
    OPENAI_MODEL?: string;
  };
}

interface NexagentSettings {
  provider?: string;
  mcp?: {
    configPath?: string;
    enabledServers?: string[];
  };
  imports?: {
    claude?: {
      enabled?: boolean;
      paths?: string[];
    };
  };
}

interface ResolvedConfigSource {
  provider?: string;
  mcpConfigPath?: string;
  enabledMcpServers?: string[];
}

const DEFAULT_PRODUCT_NAME = "nexagent";
const DEFAULT_PROVIDER = "codex";
const DEFAULT_MCP_CONFIG_FILE = ".mcp.json";
const NEXAGENT_SETTINGS_FILE = path.join(".nexagent", "settings.json");
const NEXAGENT_LOCAL_SETTINGS_FILE = path.join(".nexagent", "settings.local.json");
const CLAUDE_SETTINGS_FILE = path.join(".claude", "settings.json");
const CLAUDE_LOCAL_SETTINGS_FILE = path.join(".claude", "settings.local.json");
const DEFAULT_CLAUDE_IMPORT_PATHS = [CLAUDE_LOCAL_SETTINGS_FILE, CLAUDE_SETTINGS_FILE];

export async function loadHarnessConfig(cwd: string): Promise<HarnessConfig> {
  const [settings, localSettings] = await Promise.all([
    readJsonIfExists<NexagentSettings>(path.join(cwd, NEXAGENT_SETTINGS_FILE)),
    readJsonIfExists<NexagentSettings>(path.join(cwd, NEXAGENT_LOCAL_SETTINGS_FILE)),
  ]);
  const importedClaude = await loadImportedClaudeSettings(cwd, settings, localSettings);
  const mergedConfig = mergeConfigSources(
    {
      provider: DEFAULT_PROVIDER,
      mcpConfigPath: DEFAULT_MCP_CONFIG_FILE,
      enabledMcpServers: [],
    },
    importedClaude?.values ?? {},
    mapNexagentSettings(settings),
    mapNexagentSettings(localSettings),
  );

  return {
    cwd,
    productName: DEFAULT_PRODUCT_NAME,
    provider: mergedConfig.provider ?? DEFAULT_PROVIDER,
    mcpConfigPath: path.join(cwd, mergedConfig.mcpConfigPath ?? DEFAULT_MCP_CONFIG_FILE),
    enabledMcpServers: normalizeServerNames(mergedConfig.enabledMcpServers),
    imports: {
      claude: importedClaude?.metadata ?? null,
    },
  };
}

async function loadImportedClaudeSettings(
  cwd: string,
  settings: NexagentSettings | null,
  localSettings: NexagentSettings | null,
): Promise<{ values: ResolvedConfigSource; metadata: ImportedClaudeSettings } | null> {
  const claudeImport = localSettings?.imports?.claude ?? settings?.imports?.claude;

  if (claudeImport?.enabled === false) {
    return null;
  }

  const candidatePaths = claudeImport?.paths?.length ? claudeImport.paths : DEFAULT_CLAUDE_IMPORT_PATHS;

  for (const candidatePath of candidatePaths) {
    const absolutePath = path.join(cwd, candidatePath);
    const parsed = await readJsonIfExists<ClaudeSettings>(absolutePath);

    if (!parsed) {
      continue;
    }

    const mapped = mapClaudeSettings(parsed);
    const importedKeys = getImportedKeys(mapped);

    if (importedKeys.length === 0) {
      continue;
    }

    return {
      values: mapped,
      metadata: {
        path: absolutePath,
        importedKeys,
      },
    };
  }

  return null;
}

function mapNexagentSettings(settings: NexagentSettings | null): ResolvedConfigSource {
  if (!settings) {
    return {};
  }

  return {
    provider: settings.provider,
    mcpConfigPath: settings.mcp?.configPath,
    enabledMcpServers: settings.mcp?.enabledServers,
  };
}

function mapClaudeSettings(settings: ClaudeSettings): ResolvedConfigSource {
  return {
    provider: inferClaudeProvider(settings),
    enabledMcpServers: settings.enabledMcpServers,
  };
}

function inferClaudeProvider(settings: ClaudeSettings): string | undefined {
  if (settings.apiProvider) {
    return settings.apiProvider;
  }

  if (settings.env?.CODEX_MODEL) {
    return "codex";
  }

  if (settings.env?.OPENAI_MODEL) {
    return "openai";
  }

  if (settings.env?.ANTHROPIC_MODEL) {
    return "anthropic";
  }

  return undefined;
}

function mergeConfigSources(...sources: ResolvedConfigSource[]): ResolvedConfigSource {
  return sources.reduce<ResolvedConfigSource>((resolved, source) => ({
    provider: source.provider ?? resolved.provider,
    mcpConfigPath: source.mcpConfigPath ?? resolved.mcpConfigPath,
    enabledMcpServers: source.enabledMcpServers ?? resolved.enabledMcpServers,
  }), {});
}

function getImportedKeys(source: ResolvedConfigSource): string[] {
  const importedKeys: string[] = [];

  if (source.provider) {
    importedKeys.push("provider");
  }

  if (source.enabledMcpServers?.length) {
    importedKeys.push("enabledMcpServers");
  }

  return importedKeys;
}

function normalizeServerNames(serverNames?: string[]): string[] {
  return [...new Set((serverNames ?? []).filter((name) => name.length > 0))].sort();
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
