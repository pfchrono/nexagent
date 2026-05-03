import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { mergeProviderRegistryConfigs, type ProviderConfigInput, type ProviderRegistry } from "../provider/registry.js";
import { readMcpConfigFile, writeMcpConfigFile } from "./mcp.js";
import { resolveNexagentHome, resolvePathFromBase } from "./paths.js";

const execFileAsync = promisify(execFile);

export interface HarnessConfig {
  cwd: string;
  productName: string;
  provider: string;
  providerRegistry?: ProviderRegistry;
  providerRouting: ProviderRoutingConfig;
  prompt: PromptConfig;
  mcpConfigPath: string;
  enabledMcpServers: string[];
  imports: ConfigImports;
  instructionSources: RepoInstructionSource[];
  repo: RepoMetadata;
  toolPolicy: ToolPolicy;
  hooks?: HooksConfig;
  archivist: ArchivistConfig;
  lsp: LspConfig;
  ui: UiConfig;
  compaction?: CompactionConfig;
}

export interface PromptConfig {
  assembly: "legacy" | "v2";
}

export interface RepoMetadata {
  root: string | null;
  name: string;
  vcs: "git" | "none";
  branch: string | null;
  freshness: RepoFreshness;
}

export interface RepoFreshness {
  status: "no-repo" | "no-upstream" | "up-to-date" | "ahead" | "behind" | "diverged";
  tracking: string | null;
  ahead: number | null;
  behind: number | null;
  dirty: boolean;
  needsPull: boolean;
  checkedAt: string | null;
}

export interface ToolPolicy {
  mode: "workspace-guarded";
  readRoots?: string[];
  allowedRoots: string[];
  protectedRoots: string[];
  shell: "limited";
  writes: "guarded";
  deletes: "blocked";
}

export interface ArchivistConfig {
  enabled: boolean;
  boundary: "disabled" | "bounded-write";
  storagePath: string | null;
  storageExists: boolean;
  retrieval: ArchivistRetrievalState;
  writes: ArchivistWriteState;
  diagnostics?: ArchivistDiagnosticsState;
}

export interface LspConfig {
  enabled: boolean;
  command: string | null;
  args: string[];
  indexArchivist: boolean;
}

export interface UiConfig {
  logoMode: "full" | "condensed" | "off";
}

export interface ArchivistDiagnosticsState {
  retrievalMatchCount: number;
  retrievalSourceCategory: string | null;
  saveCount: number;
  checkpointCount: number;
  duplicateSuspectCount: number;
  staleSignalCount: number;
  noisySignalCount: number;
}

export interface CompactionConfig {
  enabled: boolean;
  thresholdPercent: number;
  modelThresholdOverrides: Record<string, number>;
  preserveTurns: number;
}

export interface ArchivistRetrievalState {
  used: boolean;
  sourceCategory: string | null;
  matchCount: number;
  preview: string | null;
}

export interface ArchivistWriteState {
  used: boolean;
  action: "save" | "checkpoint" | null;
  sourceCategory: string | null;
  savedAt: string | null;
  entryCount: number;
  preview: string | null;
}

export interface ProviderRoutingConfig {
  fallback: ProviderFallbackPolicy;
  modelSelection: ProviderModelSelection;
  transport: ProviderTransportConfig;
}

export interface ProviderFallbackPolicy {
  policy: "require-open-spec";
  silentProviderSwitch: false;
}

export interface ProviderModelSelection {
  activeProvider: string;
  configuredModels: ProviderModelMatrix;
  configuredReasoningEfforts?: ProviderReasoningEffortMatrix;
}

export interface ProviderTransportConfig {
  openaiBaseUrl?: string;
}

export interface ProviderModelMatrix {
  codex?: string;
  openai?: string;
}

export interface ProviderReasoningEffortMatrix {
  codex?: string;
  openai?: string;
  [provider: string]: string | undefined;
}

export interface RepoInstructionSource {
  kind: string;
  path: string;
  layer: "repoBehavior" | "taskContext";
  summary: string;
  detail?: string;
}

export interface ConfigImports {
  claude: ImportedClaudeSettings | null;
}

export interface ImportedClaudeSettings {
  path: string;
  importedKeys: string[];
}

export interface HooksConfig {
  sourcePath: string | null;
  status: "none" | "configured";
  events: string[];
  commandCount: number;
  invalidEntries: string[];
}

interface ClaudeSettings {
  apiProvider?: string;
  enabledMcpjsonServers?: string[];
  env?: ProviderModelEnv;
  memory?: ArchivistSettings;
  hooks?: Record<string, unknown>;
}

interface ArchivistSettings {
  enabled?: boolean;
  storagePath?: string;
}

interface ProviderModelEnv {
  CODEX_MODEL?: string;
  OPENAI_MODEL?: string;
  OPENAI_BASE_URL?: string;
}

interface NexagentSettings {
  provider?: string;
  prompt?: {
    assembly?: "legacy" | "v2";
  };
  mcp?: {
    configPath?: string;
    enabledServers?: string[];
  };
  archivist?: ArchivistSettings;
  lsp?: Partial<LspConfig>;
  ui?: Partial<UiConfig>;
  compaction?: Partial<CompactionConfig>;
  imports?: {
    claude?: {
      enabled?: boolean;
      paths?: string[];
    };
  };
}

interface NexagentConfig extends NexagentSettings, ProviderConfigInput {}

interface ResolvedConfigSource {
  provider?: string;
  providerModels?: ProviderModelMatrix;
  transport?: ProviderTransportConfig;
  prompt?: PromptConfig;
  mcpConfigPath?: string;
  enabledMcpServers?: string[];
  hooks?: HooksConfig;
  archivist?: ArchivistSettings;
  lsp?: Partial<LspConfig>;
  ui?: Partial<UiConfig>;
  compaction?: Partial<CompactionConfig>;
}

const DEFAULT_PRODUCT_NAME = "nexagent";
const DEFAULT_PROVIDER = "codex";
const NEXAGENT_SETTINGS_DIR = ".nexagent";
const DEFAULT_MCP_CONFIG_FILE = path.join(NEXAGENT_SETTINGS_DIR, "mcp.json");
const LEGACY_MCP_CONFIG_FILE = ".mcp.json";
const CODEX_CONFIG_FILE = ".codex/config.toml";
const NEXAGENT_CONFIG_BASENAME = "config.json";
const NEXAGENT_SETTINGS_BASENAME = "settings.json";
const NEXAGENT_LOCAL_SETTINGS_BASENAME = "settings.local.json";
const NEXAGENT_SETTINGS_FILE = path.join(NEXAGENT_SETTINGS_DIR, NEXAGENT_SETTINGS_BASENAME);
const NEXAGENT_CONFIG_FILE = path.join(NEXAGENT_SETTINGS_DIR, NEXAGENT_CONFIG_BASENAME);
const NEXAGENT_LOCAL_SETTINGS_FILE = path.join(NEXAGENT_SETTINGS_DIR, NEXAGENT_LOCAL_SETTINGS_BASENAME);
const CLAUDE_SETTINGS_FILE = path.join(".claude", "settings.json");
const CLAUDE_LOCAL_SETTINGS_FILE = path.join(".claude", "settings.local.json");
const DEFAULT_CLAUDE_IMPORT_PATHS = [CLAUDE_LOCAL_SETTINGS_FILE, CLAUDE_SETTINGS_FILE];
const SUMMARY_PREVIEW_LIMIT = 80;
const DETAIL_PREVIEW_LINES = 4;
const REPO_INSTRUCTION_SOURCE_CANDIDATES = [
  { kind: "AGENTS.md", relativePath: "AGENTS.md" },
  { kind: "CLAUDE.md", relativePath: "CLAUDE.md" },
  { kind: ".claude", relativePath: ".claude" },
  { kind: ".nexagent/mcp.json", relativePath: DEFAULT_MCP_CONFIG_FILE },
  { kind: ".mcp.json", relativePath: ".mcp.json" },
  { kind: "openspec", relativePath: "openspec" },
] as const;

export async function loadHarnessConfig(cwd: string): Promise<HarnessConfig> {
  const nexagentHome = resolveNexagentHome();
  const [globalConfig, globalSettings, globalLocalSettings, settings, localSettings, repoConfig, instructionSources] = await Promise.all([
    readJsonIfExists<NexagentConfig>(path.join(nexagentHome, NEXAGENT_CONFIG_BASENAME)),
    readJsonIfExists<NexagentSettings>(path.join(nexagentHome, NEXAGENT_SETTINGS_BASENAME)),
    readJsonIfExists<NexagentSettings>(path.join(nexagentHome, NEXAGENT_LOCAL_SETTINGS_BASENAME)),
    readJsonIfExists<NexagentSettings>(path.join(cwd, NEXAGENT_SETTINGS_FILE)),
    readJsonIfExists<NexagentSettings>(path.join(cwd, NEXAGENT_LOCAL_SETTINGS_FILE)),
    readJsonIfExists<NexagentConfig>(path.join(cwd, NEXAGENT_CONFIG_FILE)),
    discoverInstructionSources(cwd),
  ]);
  const importedClaude = await loadImportedClaudeSettings(cwd, nexagentHome, globalSettings, globalLocalSettings, settings, localSettings);
  const mergedConfig = mergeConfigSources(
    {
      provider: DEFAULT_PROVIDER,
      prompt: { assembly: "v2" },
      mcpConfigPath: DEFAULT_MCP_CONFIG_FILE,
      enabledMcpServers: [],
      archivist: { enabled: true },
    },
    mapNexagentSettings(globalConfig, nexagentHome),
    mapNexagentSettings(globalSettings, nexagentHome),
    mapNexagentSettings(globalLocalSettings, nexagentHome),
    importedClaude?.values ?? {},
    mapNexagentSettings(settings, cwd),
    mapNexagentSettings(localSettings, cwd),
    mapNexagentSettings(repoConfig, cwd),
  );
  const providerRegistry = mergeProviderRegistryConfigs(globalConfig, repoConfig);

  const provider = mergedConfig.provider ?? DEFAULT_PROVIDER;

  return {
    cwd,
    productName: DEFAULT_PRODUCT_NAME,
    provider,
    providerRegistry,
    prompt: mergedConfig.prompt ?? { assembly: "v2" },
    providerRouting: {
      fallback: {
        policy: "require-open-spec",
        silentProviderSwitch: false,
      },
      modelSelection: {
        activeProvider: provider,
        configuredModels: mergedConfig.providerModels ?? {},
      },
      transport: mergedConfig.transport ?? {},
    },
    mcpConfigPath: await resolveMcpConfigPath(cwd, nexagentHome, mergedConfig.mcpConfigPath),
    enabledMcpServers: normalizeServerNames(mergedConfig.enabledMcpServers),
    imports: {
      claude: importedClaude?.metadata ?? null,
    },
    instructionSources,
    repo: await discoverRepoMetadata(cwd),
    toolPolicy: createToolPolicy(cwd),
    hooks: mergedConfig.hooks ?? createEmptyHooksConfig(),
    archivist: await resolveArchivistConfig(cwd, mergedConfig.archivist),
    lsp: resolveLspConfig(mergedConfig.lsp),
    ui: resolveUiConfig(mergedConfig.ui),
    compaction: resolveCompactionConfig(mergedConfig.compaction),
  };
}

async function loadImportedClaudeSettings(
  cwd: string,
  nexagentHome: string,
  globalSettings: NexagentSettings | null,
  globalLocalSettings: NexagentSettings | null,
  settings: NexagentSettings | null,
  localSettings: NexagentSettings | null,
): Promise<{ values: ResolvedConfigSource; metadata: ImportedClaudeSettings } | null> {
  const claudeImport = localSettings?.imports?.claude
    ?? settings?.imports?.claude
    ?? globalLocalSettings?.imports?.claude
    ?? globalSettings?.imports?.claude;

  if (claudeImport?.enabled === false) {
    return null;
  }

  const importBaseDir = (localSettings?.imports?.claude ?? settings?.imports?.claude) ? cwd : nexagentHome;
  const candidatePaths = claudeImport?.paths?.length
    ? claudeImport.paths.map((candidatePath) => resolvePathFromBase(importBaseDir, candidatePath))
    : DEFAULT_CLAUDE_IMPORT_PATHS.map((candidatePath) => path.join(cwd, candidatePath));

  for (const absolutePath of candidatePaths) {
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

function mapNexagentSettings(settings: NexagentSettings | null, settingsDir: string): ResolvedConfigSource {
  if (!settings) {
    return {};
  }

  return {
    provider: settings.provider,
    prompt: mapPromptSettings(settings.prompt),
    mcpConfigPath: settings.mcp?.configPath ? resolvePathFromBase(settingsDir, settings.mcp.configPath) : undefined,
    enabledMcpServers: settings.mcp?.enabledServers,
    archivist: settings.archivist ? mapArchivistSettings(settings.archivist, settingsDir) : undefined,
    lsp: settings.lsp,
    ui: settings.ui,
    compaction: settings.compaction,
  };
}

function mapArchivistSettings(settings: ArchivistSettings, settingsDir: string): ArchivistSettings {
  return {
    ...settings,
    storagePath: settings.storagePath ? resolvePathFromBase(settingsDir, settings.storagePath) : undefined,
  };
}

function mapClaudeSettings(settings: ClaudeSettings): ResolvedConfigSource {
  return {
    provider: inferClaudeProvider(settings),
    providerModels: mapProviderModels(settings.env),
    transport: mapProviderTransport(settings.env),
    enabledMcpServers: settings.enabledMcpjsonServers,
    hooks: mapClaudeHooks(settings),
    archivist: settings.memory,
  };
}

function inferClaudeProvider(settings: ClaudeSettings): string | undefined {
  if (settings.apiProvider === "codex" || settings.apiProvider === "openai") {
    return settings.apiProvider;
  }

  if (settings.env?.CODEX_MODEL) {
    return "codex";
  }

  if (settings.env?.OPENAI_MODEL || settings.env?.OPENAI_BASE_URL) {
    return "openai";
  }

  return undefined;
}

function mergeConfigSources(...sources: ResolvedConfigSource[]): ResolvedConfigSource {
  return sources.reduce<ResolvedConfigSource>((resolved, source) => ({
    provider: source.provider ?? resolved.provider,
    providerModels: mergeProviderModels(resolved.providerModels, source.providerModels),
    transport: mergeProviderTransport(resolved.transport, source.transport),
    prompt: source.prompt ?? resolved.prompt,
    mcpConfigPath: source.mcpConfigPath ?? resolved.mcpConfigPath,
    enabledMcpServers: mergeServerNames(resolved.enabledMcpServers, source.enabledMcpServers),
    hooks: source.hooks ?? resolved.hooks,
    archivist: mergeArchivistSettings(resolved.archivist, source.archivist),
    lsp: mergeLspSettings(resolved.lsp, source.lsp),
    ui: mergeUiSettings(resolved.ui, source.ui),
    compaction: mergeCompactionSettings(resolved.compaction, source.compaction),
  }), {});
}

function mapPromptSettings(settings?: NexagentSettings["prompt"]): PromptConfig | undefined {
  if (settings?.assembly === "legacy" || settings?.assembly === "v2") {
    return { assembly: settings.assembly };
  }

  return undefined;
}

function getImportedKeys(source: ResolvedConfigSource): string[] {
  const importedKeys: string[] = [];

  if (source.provider) {
    importedKeys.push("provider");
  }

  if (source.providerModels && Object.keys(source.providerModels).length > 0) {
    importedKeys.push("modelSelection");
  }

  if (source.transport && Object.keys(source.transport).length > 0) {
    importedKeys.push("transport");
  }

  if (source.prompt) {
    importedKeys.push("prompt");
  }

  if (source.enabledMcpServers?.length) {
    importedKeys.push("enabledMcpServers");
  }

  if (source.hooks && (source.hooks.status === "configured" || source.hooks.invalidEntries.length > 0)) {
    importedKeys.push("hooks");
  }

  if (source.archivist && Object.keys(source.archivist).length > 0) {
    importedKeys.push("archivist");
  }
  if (source.lsp && Object.keys(source.lsp).length > 0) {
    importedKeys.push("lsp");
  }
  if (source.ui && Object.keys(source.ui).length > 0) {
    importedKeys.push("ui");
  }

  return importedKeys;
}

function normalizeServerNames(serverNames?: string[]): string[] {
  return [...new Set((serverNames ?? []).map((name) => name.trim()).filter((name) => name.length > 0))].sort();
}

function mergeServerNames(base?: string[], overlay?: string[]): string[] {
  return normalizeServerNames([...(base ?? []), ...(overlay ?? [])]);
}

function resolveConfigFilePath(cwd: string, configPath?: string): string {
  const resolvedPath = configPath?.trim().length ? configPath : DEFAULT_MCP_CONFIG_FILE;
  return path.isAbsolute(resolvedPath) ? resolvedPath : path.join(cwd, resolvedPath);
}

async function resolveMcpConfigPath(cwd: string, nexagentHome: string, configPath?: string): Promise<string> {
  const explicitPath = configPath?.trim();
  const globalMcpPath = path.join(nexagentHome, "mcp.json");
  if (explicitPath && explicitPath !== DEFAULT_MCP_CONFIG_FILE) {
    const resolvedExplicitPath = resolveConfigFilePath(cwd, explicitPath);
    if (resolvedExplicitPath === globalMcpPath) {
      const codexPath = path.join(path.dirname(nexagentHome), CODEX_CONFIG_FILE);
      const legacyRepoPath = path.join(cwd, LEGACY_MCP_CONFIG_FILE);
      if (await pathExists(codexPath)) {
        if (await pathExists(globalMcpPath)) {
          await mergeMissingMcpServers(codexPath, globalMcpPath);
        } else {
          await migrateMcpConfigOnce(codexPath, globalMcpPath);
        }
      }
      if (await pathExists(legacyRepoPath)) {
        if (await pathExists(globalMcpPath)) {
          await mergeMissingMcpServers(legacyRepoPath, globalMcpPath);
        } else {
          await migrateMcpConfigOnce(legacyRepoPath, globalMcpPath);
        }
      }
    }
    return resolvedExplicitPath;
  }

  const repoMcpPath = path.join(cwd, DEFAULT_MCP_CONFIG_FILE);
  if (await pathExists(repoMcpPath)) {
    return repoMcpPath;
  }

  if (await pathExists(globalMcpPath)) {
    const codexPath = path.join(path.dirname(nexagentHome), CODEX_CONFIG_FILE);
    const legacyRepoPath = path.join(cwd, LEGACY_MCP_CONFIG_FILE);
    if (await pathExists(codexPath)) {
      await mergeMissingMcpServers(codexPath, globalMcpPath);
    }
    if (await pathExists(legacyRepoPath)) {
      await mergeMissingMcpServers(legacyRepoPath, globalMcpPath);
    }
    return globalMcpPath;
  }

  const legacyRepoPath = path.join(cwd, LEGACY_MCP_CONFIG_FILE);
  if (await pathExists(legacyRepoPath)) {
    await migrateMcpConfigOnce(legacyRepoPath, repoMcpPath);
    return repoMcpPath;
  }

  const codexPath = path.join(path.dirname(nexagentHome), CODEX_CONFIG_FILE);
  if (await pathExists(codexPath)) {
    await migrateMcpConfigOnce(codexPath, globalMcpPath);
    return globalMcpPath;
  }

  return repoMcpPath;
}

async function migrateMcpConfigOnce(sourcePath: string, targetPath: string): Promise<void> {
  if (await pathExists(targetPath)) {
    return;
  }
  const parsed = await readMcpConfigFile(sourcePath);
  if (!parsed?.mcpServers || Object.keys(parsed.mcpServers).length === 0) {
    return;
  }
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeMcpConfigFile(targetPath, parsed);
}

async function mergeMissingMcpServers(sourcePath: string, targetPath: string): Promise<void> {
  const [source, target] = await Promise.all([
    readMcpConfigFile(sourcePath),
    readMcpConfigFile(targetPath),
  ]);
  const sourceServers = source?.mcpServers ?? {};
  const targetServers = target?.mcpServers ?? {};
  const missingEntries = Object.entries(sourceServers).filter(([name]) => !Object.hasOwn(targetServers, name));
  if (missingEntries.length === 0) {
    return;
  }

  await writeMcpConfigFile(targetPath, {
    mcpServers: {
      ...targetServers,
      ...Object.fromEntries(missingEntries),
    },
  });
}

function mapProviderModels(env?: ProviderModelEnv): ProviderModelMatrix | undefined {
  if (!env) {
    return undefined;
  }

  const providerModels: ProviderModelMatrix = {};

  if (env.CODEX_MODEL) {
    providerModels.codex = env.CODEX_MODEL;
  }

  if (env.OPENAI_MODEL) {
    providerModels.openai = env.OPENAI_MODEL;
  }

  return Object.keys(providerModels).length > 0 ? providerModels : undefined;
}

function mapProviderTransport(env?: ProviderModelEnv): ProviderTransportConfig | undefined {
  if (!env?.OPENAI_BASE_URL) {
    return undefined;
  }

  return {
    openaiBaseUrl: env.OPENAI_BASE_URL,
  };
}

function mapClaudeHooks(settings: ClaudeSettings): HooksConfig | undefined {
  if (!settings.hooks || typeof settings.hooks !== "object") {
    return undefined;
  }

  const configuredEvents: string[] = [];
  let commandCount = 0;
  const invalidEntries: string[] = [];

  for (const [eventName, matchers] of Object.entries(settings.hooks)) {
    if (!Array.isArray(matchers)) {
      invalidEntries.push(`${eventName}: expected matcher array`);
      continue;
    }

    let eventHasCommand = false;

    for (const matcher of matchers) {
      const hooks = isRecord(matcher) ? matcher.hooks : null;
      if (!Array.isArray(hooks)) {
        invalidEntries.push(`${eventName}: matcher missing hooks`);
        continue;
      }

      for (const hook of hooks) {
        if (!isRecord(hook) || hook.type !== "command" || typeof hook.command !== "string") {
          invalidEntries.push(`${eventName}: unsupported hook entry`);
          continue;
        }

        commandCount += 1;
        eventHasCommand = true;
      }
    }

    if (eventHasCommand) {
      configuredEvents.push(eventName);
    }
  }

  return {
    sourcePath: null,
    status: commandCount > 0 ? "configured" : "none",
    events: configuredEvents.sort(),
    commandCount,
    invalidEntries,
  };
}

function createEmptyHooksConfig(): HooksConfig {
  return {
    sourcePath: null,
    status: "none",
    events: [],
    commandCount: 0,
    invalidEntries: [],
  };
}

function mergeProviderModels(
  resolved?: ProviderModelMatrix,
  source?: ProviderModelMatrix,
): ProviderModelMatrix | undefined {
  if (!resolved && !source) {
    return undefined;
  }

  return {
    ...resolved,
    ...source,
  };
}

function mergeProviderTransport(
  resolved?: ProviderTransportConfig,
  source?: ProviderTransportConfig,
): ProviderTransportConfig | undefined {
  if (!resolved && !source) {
    return undefined;
  }

  return {
    ...resolved,
    ...source,
  };
}

function mergeArchivistSettings(
  resolved?: ArchivistSettings,
  source?: ArchivistSettings,
): ArchivistSettings | undefined {
  if (!resolved && !source) {
    return undefined;
  }

  return {
    ...resolved,
    ...source,
  };
}

function mergeCompactionSettings(
  resolved?: Partial<CompactionConfig>,
  source?: Partial<CompactionConfig>,
): Partial<CompactionConfig> | undefined {
  if (!resolved && !source) {
    return undefined;
  }
  return {
    ...resolved,
    ...source,
    modelThresholdOverrides: {
      ...(resolved?.modelThresholdOverrides ?? {}),
      ...(source?.modelThresholdOverrides ?? {}),
    },
  };
}

function mergeLspSettings(resolved?: Partial<LspConfig>, source?: Partial<LspConfig>): Partial<LspConfig> | undefined {
  if (!resolved && !source) {
    return undefined;
  }
  return {
    ...resolved,
    ...source,
    args: source?.args ?? resolved?.args,
  };
}

function mergeUiSettings(resolved?: Partial<UiConfig>, source?: Partial<UiConfig>): Partial<UiConfig> | undefined {
  if (!resolved && !source) {
    return undefined;
  }
  return {
    ...resolved,
    ...source,
  };
}

function resolveLspConfig(settings?: Partial<LspConfig>): LspConfig {
  return {
    enabled: settings?.enabled === true,
    command: typeof settings?.command === "string" && settings.command.trim().length > 0 ? settings.command.trim() : null,
    args: Array.isArray(settings?.args) ? settings.args.filter((arg): arg is string => typeof arg === "string").slice(0, 20) : [],
    indexArchivist: settings?.indexArchivist === true,
  };
}

function resolveUiConfig(settings?: Partial<UiConfig>): UiConfig {
  const logoMode = settings?.logoMode;
  return {
    logoMode: logoMode === "condensed" || logoMode === "off" || logoMode === "full" ? logoMode : "full",
  };
}

function resolveCompactionConfig(settings?: Partial<CompactionConfig>): CompactionConfig {
  return {
    enabled: settings?.enabled ?? true,
    thresholdPercent: normalizeThreshold(settings?.thresholdPercent, 0.5),
    modelThresholdOverrides: normalizeThresholdOverrides(settings?.modelThresholdOverrides),
    preserveTurns: normalizePreserveTurns(settings?.preserveTurns),
  };
}

function normalizeThreshold(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value < 1 ? value : fallback;
}

function normalizeThresholdOverrides(value: unknown): Record<string, number> {
  if (!value || typeof value !== "object") {
    return {};
  }
  const normalized: Record<string, number> = {};
  for (const [model, threshold] of Object.entries(value as Record<string, unknown>)) {
    const modelName = model.trim();
    if (modelName && typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0 && threshold < 1) {
      normalized[modelName] = threshold;
    }
  }
  return normalized;
}

function normalizePreserveTurns(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 2 && value <= 20 ? value : 4;
}

async function resolveArchivistConfig(cwd: string, settings?: ArchivistSettings): Promise<ArchivistConfig> {
  if (!settings?.enabled) {
    return {
      enabled: false,
      boundary: "disabled",
      storagePath: null,
      storageExists: false,
      retrieval: {
        used: false,
        sourceCategory: null,
        matchCount: 0,
        preview: null,
      },
      writes: {
        used: false,
        action: null,
        sourceCategory: null,
        savedAt: null,
        entryCount: 0,
        preview: null,
      },
    };
  }

  const storagePath = resolveArchivistStoragePath(cwd, settings.storagePath);

  return {
    enabled: true,
    boundary: "bounded-write",
    storagePath,
    storageExists: await pathExists(storagePath),
    retrieval: {
      used: false,
      sourceCategory: null,
      matchCount: 0,
      preview: null,
    },
    writes: {
      used: false,
      action: null,
      sourceCategory: null,
      savedAt: null,
      entryCount: 0,
      preview: null,
    },
  };
}

function resolveArchivistStoragePath(cwd: string, storagePath?: string): string {
  const resolvedPath = storagePath?.trim().length ? storagePath : path.join(".nexagent", "archivist.json");
  return path.isAbsolute(resolvedPath) ? resolvedPath : path.join(cwd, resolvedPath);
}

async function discoverRepoMetadata(cwd: string): Promise<RepoMetadata> {
  const root = await findGitRoot(cwd);
  const freshness = root ? await readGitFreshness(root) : createNoRepoFreshness();

  return {
    root,
    name: path.basename(root ?? cwd),
    vcs: root ? "git" : "none",
    branch: root ? await readGitBranch(root) : null,
    freshness,
  };
}

async function readGitFreshness(repoRoot: string): Promise<RepoFreshness> {
  const checkedAt = new Date().toISOString();
  const dirty = await readGitDirty(repoRoot);
  const tracking = await readGitTrackingBranch(repoRoot);

  if (!tracking) {
    return {
      status: "no-upstream",
      tracking: null,
      ahead: null,
      behind: null,
      dirty,
      needsPull: false,
      checkedAt,
    };
  }

  try {
    const { stdout } = await execFileAsync("git", ["rev-list", "--left-right", "--count", `HEAD...${tracking}`], { cwd: repoRoot });
    const [aheadText = "0", behindText = "0"] = stdout.trim().split(/\s+/);
    const ahead = Number.parseInt(aheadText, 10);
    const behind = Number.parseInt(behindText, 10);
    const safeAhead = Number.isFinite(ahead) ? ahead : 0;
    const safeBehind = Number.isFinite(behind) ? behind : 0;

    return {
      status: safeAhead > 0 && safeBehind > 0
        ? "diverged"
        : safeBehind > 0
          ? "behind"
          : safeAhead > 0
            ? "ahead"
            : "up-to-date",
      tracking,
      ahead: safeAhead,
      behind: safeBehind,
      dirty,
      needsPull: safeBehind > 0,
      checkedAt,
    };
  } catch {
    return {
      status: "no-upstream",
      tracking,
      ahead: null,
      behind: null,
      dirty,
      needsPull: false,
      checkedAt,
    };
  }
}

async function readGitDirty(repoRoot: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: repoRoot });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function readGitTrackingBranch(repoRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { cwd: repoRoot });
    const tracking = stdout.trim();
    return tracking.length > 0 ? tracking : null;
  } catch {
    return null;
  }
}

function createNoRepoFreshness(): RepoFreshness {
  return {
    status: "no-repo",
    tracking: null,
    ahead: null,
    behind: null,
    dirty: false,
    needsPull: false,
    checkedAt: null,
  };
}

function createToolPolicy(cwd: string): ToolPolicy {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  const protectedRoots = [
    "/bin",
    "/boot",
    "/dev",
    "/etc",
    "/lib",
    "/lib64",
    "/proc",
    "/root",
    "/run",
    "/sbin",
    "/sys",
    "/usr",
    "/var",
    ...(home
      ? [
          path.join(home, ".aws"),
          path.join(home, ".config", "gh"),
          path.join(home, ".codex"),
          path.join(home, ".docker"),
          path.join(home, ".env"),
          path.join(home, ".git-credentials"),
          path.join(home, ".gnupg"),
          path.join(home, ".kube"),
          path.join(home, ".npmrc"),
          path.join(home, ".op"),
          path.join(home, ".ssh"),
          path.join(home, ".bash_history"),
          path.join(home, ".zsh_history"),
        ]
      : []),
  ];

  return {
    mode: "workspace-guarded",
    readRoots: [home, cwd].filter((root, index, roots) => root.length > 0 && roots.indexOf(root) === index),
    allowedRoots: [cwd],
    protectedRoots: Array.from(new Set(protectedRoots)),
    shell: "limited",
    writes: "guarded",
    deletes: "blocked",
  };
}

async function findGitRoot(startPath: string): Promise<string | null> {
  let currentPath = startPath;

  while (true) {
    if (await pathExists(path.join(currentPath, ".git"))) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      return null;
    }

    currentPath = parentPath;
  }
}

async function readGitBranch(repoRoot: string): Promise<string | null> {
  const gitDir = await resolveGitDir(repoRoot);

  if (!gitDir) {
    return null;
  }

  try {
    const head = (await readFile(path.join(gitDir, "HEAD"), "utf8")).trim();
    const prefix = "ref: refs/heads/";

    if (head.startsWith(prefix)) {
      return head.slice(prefix.length);
    }

    return head.length > 0 ? head : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function resolveGitDir(repoRoot: string): Promise<string | null> {
  const dotGitPath = path.join(repoRoot, ".git");

  try {
    const stats = await stat(dotGitPath);

    if (stats.isDirectory()) {
      return dotGitPath;
    }

    const pointer = (await readFile(dotGitPath, "utf8")).trim();
    const prefix = "gitdir: ";
    if (!pointer.startsWith(prefix)) {
      return null;
    }

    const gitDirPath = pointer.slice(prefix.length).trim();
    return path.isAbsolute(gitDirPath) ? gitDirPath : path.join(repoRoot, gitDirPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function discoverInstructionSources(cwd: string): Promise<RepoInstructionSource[]> {
  const discovered = await Promise.all(
    REPO_INSTRUCTION_SOURCE_CANDIDATES.map(async ({ kind, relativePath }) => {
      const absolutePath = path.join(cwd, relativePath);
      return (await pathExists(absolutePath)) ? await describeInstructionSource(kind, absolutePath) : null;
    }),
  );

  const instructionSources: RepoInstructionSource[] = [];

  for (const source of discovered) {
    if (source !== null) {
      instructionSources.push(source);
    }
  }

  return instructionSources;
}

async function describeInstructionSource(kind: string, absolutePath: string): Promise<RepoInstructionSource> {
  const detail = await readInstructionDetail(kind, absolutePath);
  const source: RepoInstructionSource = {
    kind,
    path: absolutePath,
    layer: kind === "openspec" ? "taskContext" : "repoBehavior",
    summary: await summarizeInstructionSource(kind, absolutePath),
  };

  if (detail !== null) {
    source.detail = detail;
  }

  return source;
}

async function summarizeInstructionSource(kind: string, absolutePath: string): Promise<string> {
  switch (kind) {
    case "AGENTS.md":
      return summarizeTextInstruction(kind, absolutePath, "Repo agent instructions");
    case "CLAUDE.md":
      return summarizeTextInstruction(kind, absolutePath, "Repo Claude instructions");
    case ".claude":
      return summarizeDirectoryInstruction(kind, absolutePath, ".claude settings and command files");
    case ".nexagent/mcp.json":
    case ".mcp.json":
      return summarizeMcpRegistry(absolutePath);
    case "openspec":
      return summarizeDirectoryInstruction(kind, absolutePath, "OpenSpec changes/specs/tasks available");
    default:
      return `${kind} file present`;
  }
}

async function readInstructionDetail(kind: string, absolutePath: string): Promise<string | null> {
  if (kind === ".claude" || kind === "openspec") {
    return await summarizeDirectory(kind, absolutePath);
  }

  if (kind === ".nexagent/mcp.json" || kind === ".mcp.json") {
    return await summarizeMcpRegistryDetail(absolutePath);
  }

  return await readInstructionPreview(absolutePath);
}

async function summarizeDirectory(kind: string, directoryPath: string): Promise<string | null> {
  try {
    const entries = await readDirectoryNames(directoryPath);

    if (entries.length === 0) {
      return null;
    }

    return `${kind} directory present with: ${entries.join(", ")}`;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function summarizeDirectoryInstruction(kind: string, directoryPath: string, fallback: string): Promise<string> {
  const detail = await summarizeDirectory(kind, directoryPath);
  if (!detail) {
    return fallback;
  }

  return truncatePreview(`${kind} includes ${detail.replace(`${kind} directory present with: `, "")}`);
}

async function summarizeTextInstruction(kind: string, filePath: string, fallback: string): Promise<string> {
  const preview = await readInstructionPreview(filePath, 1);
  if (!preview) {
    return fallback;
  }

  const [headline] = preview.split("\n");
  return truncatePreview(`${kind}: ${headline}`);
}

async function summarizeMcpRegistry(filePath: string): Promise<string> {
  const parsed = await readMcpConfigFile(filePath);
  const serverNames = parsed?.mcpServers ? Object.keys(parsed.mcpServers).sort() : [];

  return serverNames.length > 0 ? `MCP registry: ${serverNames.join(", ")}` : "MCP registry: no servers declared";
}

async function summarizeMcpRegistryDetail(filePath: string): Promise<string | null> {
  const parsed = await readMcpConfigFile(filePath);
  const serverNames = parsed?.mcpServers ? Object.keys(parsed.mcpServers).sort() : [];

  return serverNames.length > 0 ? `Configured MCP servers: ${serverNames.join(", ")}` : "Configured MCP servers: none";
}

async function readInstructionPreview(filePath: string, maxLines = DETAIL_PREVIEW_LINES): Promise<string | null> {
  const content = await readTrimmedFile(filePath);
  if (!content) {
    return null;
  }

  const previewLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(0, maxLines)
    .map((line) => truncatePreview(line));

  return previewLines.length > 0 ? previewLines.join("\n") : null;
}

function truncatePreview(value: string): string {
  return value.length > SUMMARY_PREVIEW_LIMIT ? `${value.slice(0, SUMMARY_PREVIEW_LIMIT - 1).trimEnd()}…` : value;
}

async function readTrimmedFile(filePath: string): Promise<string | null> {
  try {
    const content = (await readFile(filePath, "utf8")).trim();
    return content.length > 0 ? content : null;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readDirectoryNames(directoryPath: string): Promise<string[]> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  return entries.map((entry) => entry.name).sort();
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;

    if (code === "ENOENT") {
      return false;
    }

    throw error;
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
