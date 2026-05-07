import { CODEX_CHATGPT_HTTP_ADAPTER, hasCodexAuthJsonCredentialsSync } from "../provider/codex-chatgpt-http.js";
import { CODEX_HTTP_ADAPTER } from "../provider/codex-http.js";
import { CODEX_EXEC_ADAPTER } from "../provider/codex-exec.js";
import { createDefaultProviderRegistry, getTransportProviderDefinition, type ProviderRegistry } from "../provider/registry.js";
import { buildPromptV2, summarizePromptV2, type PromptV2Summary } from "./prompt-v2.js";
import { probeCodexAuthState, type RuntimeAuthState } from "./auth.js";
import { loadHarnessConfig, type HarnessConfig, type HooksConfig } from "./config.js";
import { loadRuntimeExtensions, type RuntimeExtensionHost } from "./extensions.js";
import { loadMcpRegistrySummary, type McpRegistrySummary } from "./mcp.js";
import { loadPersistedRuntimeState, type PersistedRuntimeState, type PersistedTransportMode } from "./persistence.js";
import { createRuntimeTodoState, type RuntimeTodoState } from "./todos.js";
import { createRuntimeBtwState, type RuntimeBtwState } from "./btw.js";
import { createRuntimeToolMemoryState, type RuntimeToolMemoryState } from "./tool-memory.js";
import { createRuntimeSubagentState, type RuntimeSubagentState } from "./subagents.js";
import { createRuntimeGoalState, type RuntimeGoalState } from "./goal.js";

export interface RuntimeBootstrap {
  config: HarnessConfig | (Omit<HarnessConfig, "lsp" | "ui"> & Partial<Pick<HarnessConfig, "lsp" | "ui">>);
  mcp: McpRegistrySummary;
  auth: RuntimeAuthState;
  persisted?: PersistedRuntimeState | null;
  extensions?: RuntimeExtensionHost;
}

export interface RuntimeState {
  product: string;
  provider: string;
  prompt: HarnessConfig["prompt"];
  providerRegistry: ProviderRegistry;
  providerRouting: HarnessConfig["providerRouting"];
  providerTransport: ProviderTransportState;
  commandModes: RuntimeCommandModeState;
  operationDefaults: RuntimeOperationControlsDefaults;
  cwd: string;
  repo: HarnessConfig["repo"];
  toolPolicy: HarnessConfig["toolPolicy"];
  mcpServers: string[];
  enabledMcpServers: string[];
  mcpRegistry: McpRegistrySummary;
  imports: HarnessConfig["imports"];
  instructionSources: HarnessConfig["instructionSources"];
  promptV2Summary: PromptV2Summary;
  hooks: HooksConfig;
  archivist: HarnessConfig["archivist"];
  lsp: HarnessConfig["lsp"];
  ui: HarnessConfig["ui"];
  auth: RuntimeAuthState;
  btw: RuntimeBtwState;
  todos: RuntimeTodoState;
  toolMemory: RuntimeToolMemoryState;
  subagents: RuntimeSubagentState;
  goal: RuntimeGoalState;
  extensions?: RuntimeExtensionHost;
}

export interface ProviderTransportState {
  executor: "codex" | "fetch";
  adapter: "codex-cli-exec" | "openai-http-responses" | "codex-chatgpt-http";
  mode: "cli-exec" | "http-responses" | "codex-http";
  authSource: "codex-login" | "openai-api-key" | "codex-auth-json";
  authGate: "ready" | "missing";
  activeProvider: string;
  openaiBaseUrl: string | null;
  requestTimeoutMs?: number | null;
  maxRetries?: number | null;
  silentFallback: false;
}

export interface RuntimeCommandModeState {
  cavemanMode: boolean;
  deadpoolMode: boolean;
  statusline: boolean;
  mouseMode: "auto" | "scroll" | "select";
}

export interface RuntimeOperationControlsDefaults {
  requireApprovalForGuarded: boolean;
}

export async function bootstrapRuntime(cwd: string): Promise<RuntimeBootstrap>;
export async function bootstrapRuntime(cwd: unknown): Promise<RuntimeBootstrap>;
export async function bootstrapRuntime(cwd: unknown): Promise<RuntimeBootstrap> {
  const config = await loadHarnessConfig(cwd);
  const runtimeCwd = config.cwd;
  const mcp = await loadMcpRegistrySummary(config.mcpConfigPath, config.enabledMcpServers, { cwd: runtimeCwd });
  const persisted = await loadPersistedRuntimeState(runtimeCwd);
  const auth = mergeRuntimeAuth(await probeCodexAuthState(), persisted);
  const extensions = await loadRuntimeExtensions(runtimeCwd);

  return {
    config,
    mcp,
    auth,
    persisted,
    extensions,
  };
}

export function createRuntimeState(runtime: RuntimeBootstrap): RuntimeState {
  const config = normalizeRuntimeConfig(runtime.config);
  const boot: RuntimeBootstrap = { ...runtime, config };
  const providerRouting = {
    ...boot.config.providerRouting,
    modelSelection: {
      ...boot.config.providerRouting.modelSelection,
      configuredModels: {
        ...boot.config.providerRouting.modelSelection.configuredModels,
        ...(boot.persisted?.providerModels ?? {}),
      },
      configuredReasoningEfforts: {
        ...(boot.config.providerRouting.modelSelection.configuredReasoningEfforts ?? {}),
        ...(boot.persisted?.providerReasoningEfforts ?? {}),
      },
    },
  };
  const providerRegistry = boot.config.providerRegistry ?? createDefaultProviderRegistry();
  const provider = resolveActiveProvider(boot);
  const providerTransport = createProviderTransportState(boot, provider);
  const mcpRegistry = normalizeMcpRegistry(boot.mcp);
  const promptV2 = buildPromptV2({
    session: {
      provider,
      prompt: boot.config.prompt,
      providerRouting,
      providerTransport,
      cwd: boot.config.cwd,
      toolPolicy: boot.config.toolPolicy,
      mcpServers: mcpRegistry.serverNames,
      enabledMcpServers: boot.config.enabledMcpServers,
      imports: boot.config.imports,
      instructionSources: boot.config.instructionSources,
      archivist: boot.config.archivist,
    },
    prompt: "",
  });

  return {
    product: boot.config.productName,
    provider,
    prompt: boot.config.prompt,
    providerRegistry,
    providerRouting,
    providerTransport,
    commandModes: {
      cavemanMode: boot.persisted?.commandModes?.cavemanMode ?? false,
      deadpoolMode: boot.persisted?.commandModes?.deadpoolMode ?? false,
      statusline: boot.persisted?.commandModes?.statusline ?? false,
      mouseMode: boot.persisted?.commandModes?.mouseMode ?? "auto",
    },
    operationDefaults: {
      requireApprovalForGuarded: boot.persisted?.operationControls?.requireApprovalForGuarded ?? false,
    },
    cwd: boot.config.cwd,
    repo: boot.config.repo,
    toolPolicy: boot.config.toolPolicy,
    mcpServers: mcpRegistry.serverNames,
    enabledMcpServers: boot.config.enabledMcpServers,
    mcpRegistry,
    imports: boot.config.imports,
    instructionSources: boot.config.instructionSources,
    promptV2Summary: summarizePromptV2(promptV2.sections),
    hooks: {
      sourcePath: boot.config.imports.claude?.path ?? boot.config.hooks?.sourcePath ?? null,
      status: boot.config.hooks?.status ?? "none",
      events: boot.config.hooks?.events ?? [],
      commandCount: boot.config.hooks?.commandCount ?? 0,
      invalidEntries: boot.config.hooks?.invalidEntries ?? [],
    },
    archivist: boot.config.archivist,
    lsp: createRuntimeLspState(boot),
    ui: {
      ...(boot.config.ui ?? { logoMode: "full" }),
      logoMode: boot.persisted?.ui?.logoMode ?? boot.config.ui?.logoMode ?? "full",
      sessionEmoji: boot.persisted?.ui?.sessionEmoji ?? boot.config.ui?.sessionEmoji,
      sessionColorIndex: boot.persisted?.ui?.sessionColorIndex ?? boot.config.ui?.sessionColorIndex,
      notifyEnabled: boot.persisted?.ui?.notifyEnabled ?? boot.config.ui?.notifyEnabled ?? false,
      notifyThresholdMs: boot.persisted?.ui?.notifyThresholdMs ?? boot.config.ui?.notifyThresholdMs ?? 2000,
      statuslineCommand: boot.persisted?.ui?.statuslineCommand ?? boot.config.ui?.statuslineCommand,
      keybindings: mergeRuntimeKeybindings(boot.config.ui?.keybindings, boot.persisted?.ui?.keybindings),
    },
    auth: boot.auth,
    btw: createRuntimeBtwState(boot.persisted?.btw),
    todos: createRuntimeTodoState(boot.persisted?.todos),
    toolMemory: createRuntimeToolMemoryState(boot.persisted?.toolMemory),
    subagents: createRuntimeSubagentState(boot.persisted?.subagents, boot.config.cwd),
    goal: createRuntimeGoalState(boot.persisted?.goal, { pauseActiveOnLoad: Boolean(boot.persisted?.goal?.goal?.status === "active") }),
    extensions: boot.extensions,
  };
}

function mergeRuntimeKeybindings(
  configured?: Record<string, string>,
  persisted?: Record<string, string>,
): Record<string, string> | undefined {
  const merged = {
    ...(configured ?? {}),
    ...(persisted ?? {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function normalizeRuntimeConfig(config: RuntimeBootstrap["config"]): HarnessConfig {
  const unsafe = config as Partial<HarnessConfig>;
  const provider = unsafe.provider ?? "codex";
  const providerRouting = unsafe.providerRouting ?? {
    fallback: {
      policy: "require-open-spec",
      silentProviderSwitch: false,
    },
    modelSelection: {
      activeProvider: provider,
      configuredModels: {},
      configuredReasoningEfforts: {},
    },
    transport: {},
  };
  return {
    ...unsafe,
    provider,
    productName: unsafe.productName ?? "nexagent",
    prompt: unsafe.prompt ?? { assembly: "v2" },
    providerRouting: {
      fallback: {
        policy: providerRouting.fallback?.policy ?? "require-open-spec",
        silentProviderSwitch: providerRouting.fallback?.silentProviderSwitch ?? false,
      },
      modelSelection: {
        activeProvider: providerRouting.modelSelection?.activeProvider ?? provider,
        configuredModels: providerRouting.modelSelection?.configuredModels ?? {},
        configuredReasoningEfforts: providerRouting.modelSelection?.configuredReasoningEfforts ?? {},
      },
      transport: providerRouting.transport ?? {},
    },
    mcpConfigPath: unsafe.mcpConfigPath ?? ".nexagent/mcp.json",
    enabledMcpServers: unsafe.enabledMcpServers ?? [],
    imports: unsafe.imports ?? { claude: null },
    instructionSources: unsafe.instructionSources ?? [],
    repo: unsafe.repo ?? {
      root: null,
      name: "unknown",
      vcs: "none",
      branch: null,
      freshness: {
        status: "no-repo",
        tracking: null,
        ahead: null,
        behind: null,
        dirty: false,
        needsPull: false,
        checkedAt: null,
      },
    },
    toolPolicy: unsafe.toolPolicy ?? {
      mode: "workspace-guarded",
      allowedRoots: [unsafe.cwd ?? process.cwd()],
      protectedRoots: [],
      readRoots: [unsafe.cwd ?? process.cwd()],
      shell: "limited",
      writes: "guarded",
      deletes: "blocked",
    },
    hooks: unsafe.hooks ?? createEmptyHooksConfig(),
    archivist: unsafe.archivist ?? {
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
    },
    lsp: unsafe.lsp ?? {
      enabled: true,
      command: "typescript-language-server",
      args: ["--stdio"],
      indexArchivist: false,
    },
    ui: unsafe.ui ?? { logoMode: "full", notifyEnabled: false, notifyThresholdMs: 2000 },
    compaction: unsafe.compaction,
    cwd: unsafe.cwd ?? process.cwd(),
  };
}

function normalizeMcpRegistry(mcp: McpRegistrySummary): McpRegistrySummary {
  return {
    serverNames: mcp.serverNames ?? [],
    servers: mcp.servers ?? {},
    tools: mcp.tools ?? [],
    statuses: mcp.statuses ?? [],
    clients: mcp.clients ?? new Map(),
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

function createRuntimeLspState(runtime: RuntimeBootstrap): RuntimeState["lsp"] {
  const configured = runtime.config.lsp ?? {
    enabled: true,
    command: "typescript-language-server",
    args: ["--stdio"],
    indexArchivist: false,
  };
  return {
    ...configured,
    enabled: runtime.persisted?.lsp?.enabled ?? configured.enabled,
    indexArchivist: runtime.persisted?.lsp?.indexArchivist ?? configured.indexArchivist,
  };
}

function resolveActiveProvider(runtime: RuntimeBootstrap): string {
  const persistedProvider = runtime.persisted?.provider;
  const configuredProviders = new Set([
    runtime.config.provider,
    ...Object.keys(runtime.config.providerRouting.modelSelection.configuredModels),
  ]);

  if (persistedProvider && configuredProviders.has(persistedProvider)) {
    runtime.config.providerRouting.modelSelection.activeProvider = persistedProvider;
    return persistedProvider;
  }

  return runtime.config.provider;
}

function createProviderTransportState(runtime: RuntimeBootstrap, activeProvider: string): ProviderTransportState {
  const mode = resolveTransportMode(runtime.persisted?.transportMode);
  if (mode === "codex-http") {
    const definition = getTransportProviderDefinition(runtime.config.providerRegistry, mode);
    return {
      executor: definition?.executor ?? "fetch",
      adapter: definition?.adapter ?? CODEX_CHATGPT_HTTP_ADAPTER.id,
      mode: CODEX_CHATGPT_HTTP_ADAPTER.mode,
      authSource: definition?.authSource ?? CODEX_CHATGPT_HTTP_ADAPTER.authSource,
      authGate: hasCodexAuthJsonCredentialsSync() ? "ready" : "missing",
      activeProvider,
      openaiBaseUrl: runtime.config.providerRouting.transport.openaiBaseUrl ?? definition?.baseUrl ?? "https://chatgpt.com/backend-api/codex",
      ...(definition?.requestTimeoutMs !== null && definition?.requestTimeoutMs !== undefined
        ? { requestTimeoutMs: definition.requestTimeoutMs }
        : {}),
      ...(definition?.maxRetries !== null && definition?.maxRetries !== undefined ? { maxRetries: definition.maxRetries } : {}),
      silentFallback: false,
    };
  }

  if (mode === "http-responses") {
    const definition = getTransportProviderDefinition(runtime.config.providerRegistry, mode);
    return {
      executor: definition?.executor ?? "fetch",
      adapter: definition?.adapter ?? CODEX_HTTP_ADAPTER.id,
      mode: CODEX_HTTP_ADAPTER.mode,
      authSource: definition?.authSource ?? CODEX_HTTP_ADAPTER.authSource,
      authGate: process.env.OPENAI_API_KEY?.trim() ? "ready" : "missing",
      activeProvider,
      openaiBaseUrl: runtime.config.providerRouting.transport.openaiBaseUrl ?? definition?.baseUrl ?? "https://api.openai.com/v1",
      ...(definition?.requestTimeoutMs !== null && definition?.requestTimeoutMs !== undefined
        ? { requestTimeoutMs: definition.requestTimeoutMs }
        : {}),
      ...(definition?.maxRetries !== null && definition?.maxRetries !== undefined ? { maxRetries: definition.maxRetries } : {}),
      silentFallback: false,
    };
  }

  return {
    executor: "codex",
    adapter: CODEX_EXEC_ADAPTER.id,
    mode: CODEX_EXEC_ADAPTER.mode,
    authSource: CODEX_EXEC_ADAPTER.authSource,
    authGate: runtime.auth.loggedIn ? "ready" : "missing",
    activeProvider,
    openaiBaseUrl: runtime.config.providerRouting.transport.openaiBaseUrl ?? null,
    silentFallback: false,
  };
}

function resolveTransportMode(mode: PersistedTransportMode | undefined): PersistedTransportMode {
  if (mode === "http-responses" || mode === "codex-http" || mode === "cli-exec") {
    return mode;
  }

  return hasCodexAuthJsonCredentialsSync() ? "codex-http" : "cli-exec";
}

function mergeRuntimeAuth(auth: RuntimeAuthState, persisted: PersistedRuntimeState | null): RuntimeAuthState {
  if (auth.available || !persisted?.auth) {
    return auth;
  }

  return {
    ...persisted.auth,
    available: false,
    status: `${persisted.auth.status} (last known snapshot; live probe failed)`,
  };
}
