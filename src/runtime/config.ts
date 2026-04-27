import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface HarnessConfig {
  cwd: string;
  productName: string;
  provider: string;
  providerRouting: ProviderRoutingConfig;
  mcpConfigPath: string;
  enabledMcpServers: string[];
  imports: ConfigImports;
  instructionSources: RepoInstructionSource[];
  repo: RepoMetadata;
  toolPolicy: ToolPolicy;
  hooks?: HooksConfig;
  archivist: ArchivistConfig;
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
  mode: "repo-local-guarded";
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
}

export interface ProviderTransportConfig {
  openaiBaseUrl?: string;
}

export interface ProviderModelMatrix {
  codex?: string;
  openai?: string;
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
  mcp?: {
    configPath?: string;
    enabledServers?: string[];
  };
  archivist?: ArchivistSettings;
  imports?: {
    claude?: {
      enabled?: boolean;
      paths?: string[];
    };
  };
}

interface ResolvedConfigSource {
  provider?: string;
  providerModels?: ProviderModelMatrix;
  transport?: ProviderTransportConfig;
  mcpConfigPath?: string;
  enabledMcpServers?: string[];
  hooks?: HooksConfig;
  archivist?: ArchivistSettings;
}

const DEFAULT_PRODUCT_NAME = "nexagent";
const DEFAULT_PROVIDER = "codex";
const DEFAULT_MCP_CONFIG_FILE = ".mcp.json";
const NEXAGENT_SETTINGS_FILE = path.join(".nexagent", "settings.json");
const NEXAGENT_LOCAL_SETTINGS_FILE = path.join(".nexagent", "settings.local.json");
const CLAUDE_SETTINGS_FILE = path.join(".claude", "settings.json");
const CLAUDE_LOCAL_SETTINGS_FILE = path.join(".claude", "settings.local.json");
const DEFAULT_CLAUDE_IMPORT_PATHS = [CLAUDE_LOCAL_SETTINGS_FILE, CLAUDE_SETTINGS_FILE];
const SUMMARY_PREVIEW_LIMIT = 80;
const DETAIL_PREVIEW_LINES = 4;
const REPO_INSTRUCTION_SOURCE_CANDIDATES = [
  { kind: "AGENTS.md", relativePath: "AGENTS.md" },
  { kind: "CLAUDE.md", relativePath: "CLAUDE.md" },
  { kind: ".claude", relativePath: ".claude" },
  { kind: ".mcp.json", relativePath: ".mcp.json" },
  { kind: "openspec", relativePath: "openspec" },
] as const;

export async function loadHarnessConfig(cwd: string): Promise<HarnessConfig> {
  const [settings, localSettings, instructionSources] = await Promise.all([
    readJsonIfExists<NexagentSettings>(path.join(cwd, NEXAGENT_SETTINGS_FILE)),
    readJsonIfExists<NexagentSettings>(path.join(cwd, NEXAGENT_LOCAL_SETTINGS_FILE)),
    discoverInstructionSources(cwd),
  ]);
  const importedClaude = await loadImportedClaudeSettings(cwd, settings, localSettings);
  const mergedConfig = mergeConfigSources(
    {
      provider: DEFAULT_PROVIDER,
      mcpConfigPath: DEFAULT_MCP_CONFIG_FILE,
      enabledMcpServers: [],
      archivist: { enabled: true },
    },
    importedClaude?.values ?? {},
    mapNexagentSettings(settings),
    mapNexagentSettings(localSettings),
  );

  const provider = mergedConfig.provider ?? DEFAULT_PROVIDER;

  return {
    cwd,
    productName: DEFAULT_PRODUCT_NAME,
    provider,
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
    mcpConfigPath: path.join(cwd, mergedConfig.mcpConfigPath ?? DEFAULT_MCP_CONFIG_FILE),
    enabledMcpServers: normalizeServerNames(mergedConfig.enabledMcpServers),
    imports: {
      claude: importedClaude?.metadata ?? null,
    },
    instructionSources,
    repo: await discoverRepoMetadata(cwd),
    toolPolicy: createToolPolicy(cwd),
    hooks: mergedConfig.hooks ?? createEmptyHooksConfig(),
    archivist: await resolveArchivistConfig(cwd, mergedConfig.archivist),
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
    archivist: settings.archivist,
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
    mcpConfigPath: source.mcpConfigPath ?? resolved.mcpConfigPath,
    enabledMcpServers: source.enabledMcpServers ?? resolved.enabledMcpServers,
    hooks: source.hooks ?? resolved.hooks,
    archivist: mergeArchivistSettings(resolved.archivist, source.archivist),
  }), {});
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

  if (source.enabledMcpServers?.length) {
    importedKeys.push("enabledMcpServers");
  }

  if (source.hooks && (source.hooks.status === "configured" || source.hooks.invalidEntries.length > 0)) {
    importedKeys.push("hooks");
  }

  if (source.archivist && Object.keys(source.archivist).length > 0) {
    importedKeys.push("archivist");
  }

  return importedKeys;
}

function normalizeServerNames(serverNames?: string[]): string[] {
  return [...new Set((serverNames ?? []).filter((name) => name.length > 0))].sort();
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
          path.join(home, ".gnupg"),
          path.join(home, ".npmrc"),
          path.join(home, ".ssh"),
        ]
      : []),
  ];

  return {
    mode: "repo-local-guarded",
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

  if (kind === ".mcp.json") {
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
  const parsed = await readJsonIfExists<{ mcpServers?: Record<string, unknown> }>(filePath);
  const serverNames = parsed?.mcpServers ? Object.keys(parsed.mcpServers).sort() : [];

  return serverNames.length > 0 ? `MCP registry: ${serverNames.join(", ")}` : "MCP registry: no servers declared";
}

async function summarizeMcpRegistryDetail(filePath: string): Promise<string | null> {
  const parsed = await readJsonIfExists<{ mcpServers?: Record<string, unknown> }>(filePath);
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
