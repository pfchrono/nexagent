import { CODEX_CHATGPT_HTTP_ADAPTER, hasCodexAuthJsonCredentialsSync } from "../provider/codex-chatgpt-http.js";
import { CODEX_HTTP_ADAPTER } from "../provider/codex-http.js";
import { CODEX_EXEC_ADAPTER } from "../provider/codex-exec.js";
import { createDefaultProviderRegistry, getTransportProviderDefinition, type ProviderRegistry } from "../provider/registry.js";
import { buildPromptV2, summarizePromptV2, type PromptV2Summary } from "./prompt-v2.js";
import { probeCodexAuthState, type RuntimeAuthState } from "./auth.js";
import { loadHarnessConfig, type HarnessConfig, type HooksConfig } from "./config.js";
import { loadMcpRegistrySummary, type McpRegistrySummary } from "./mcp.js";
import { loadPersistedRuntimeState, type PersistedRuntimeState, type PersistedTransportMode } from "./persistence.js";

export interface RuntimeBootstrap {
  config: HarnessConfig;
  mcp: McpRegistrySummary;
  auth: RuntimeAuthState;
  persisted?: PersistedRuntimeState | null;
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
  imports: HarnessConfig["imports"];
  instructionSources: HarnessConfig["instructionSources"];
  promptV2Summary: PromptV2Summary;
  hooks: HooksConfig;
  archivist: HarnessConfig["archivist"];
  auth: RuntimeAuthState;
}

export interface ProviderTransportState {
  executor: "codex" | "fetch";
  adapter: "codex-cli-exec" | "openai-http-responses" | "codex-chatgpt-http";
  mode: "cli-exec" | "http-responses" | "codex-http";
  authSource: "codex-login" | "openai-api-key" | "codex-auth-json";
  authGate: "ready" | "missing";
  activeProvider: string;
  openaiBaseUrl: string | null;
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

export async function bootstrapRuntime(cwd: string): Promise<RuntimeBootstrap> {
  const config = await loadHarnessConfig(cwd);
  const mcp = await loadMcpRegistrySummary(config.mcpConfigPath, config.enabledMcpServers);
  const persisted = await loadPersistedRuntimeState(cwd);
  const auth = mergeRuntimeAuth(await probeCodexAuthState(), persisted);

  return {
    config,
    mcp,
    auth,
    persisted,
  };
}

export function createRuntimeState(runtime: RuntimeBootstrap): RuntimeState {
  const providerRouting = {
    ...runtime.config.providerRouting,
    modelSelection: {
      ...runtime.config.providerRouting.modelSelection,
      configuredModels: {
        ...runtime.config.providerRouting.modelSelection.configuredModels,
        ...(runtime.persisted?.providerModels ?? {}),
      },
    },
  };
  const providerRegistry = runtime.config.providerRegistry ?? createDefaultProviderRegistry();
  const provider = resolveActiveProvider(runtime);
  const providerTransport = createProviderTransportState(runtime, provider);
  const promptV2 = buildPromptV2({
    session: {
      provider,
      prompt: runtime.config.prompt,
      providerRouting,
      providerTransport,
      cwd: runtime.config.cwd,
      toolPolicy: runtime.config.toolPolicy,
      mcpServers: runtime.mcp.serverNames,
      enabledMcpServers: runtime.config.enabledMcpServers,
      imports: runtime.config.imports,
      instructionSources: runtime.config.instructionSources,
      archivist: runtime.config.archivist,
    },
    prompt: "",
  });

  return {
    product: runtime.config.productName,
    provider,
    prompt: runtime.config.prompt,
    providerRegistry,
    providerRouting,
    providerTransport,
    commandModes: {
      cavemanMode: runtime.persisted?.commandModes?.cavemanMode ?? false,
      deadpoolMode: runtime.persisted?.commandModes?.deadpoolMode ?? false,
      statusline: runtime.persisted?.commandModes?.statusline ?? false,
      mouseMode: runtime.persisted?.commandModes?.mouseMode ?? "auto",
    },
    operationDefaults: {
      requireApprovalForGuarded: runtime.persisted?.operationControls?.requireApprovalForGuarded ?? false,
    },
    cwd: runtime.config.cwd,
    repo: runtime.config.repo,
    toolPolicy: runtime.config.toolPolicy,
    mcpServers: runtime.mcp.serverNames,
    enabledMcpServers: runtime.config.enabledMcpServers,
    imports: runtime.config.imports,
    instructionSources: runtime.config.instructionSources,
    promptV2Summary: summarizePromptV2(promptV2.sections),
    hooks: {
      sourcePath: runtime.config.imports.claude?.path ?? runtime.config.hooks?.sourcePath ?? null,
      status: runtime.config.hooks?.status ?? "none",
      events: runtime.config.hooks?.events ?? [],
      commandCount: runtime.config.hooks?.commandCount ?? 0,
      invalidEntries: runtime.config.hooks?.invalidEntries ?? [],
    },
    archivist: runtime.config.archivist,
    auth: runtime.auth,
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
