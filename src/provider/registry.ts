import { CODEX_MODEL_CATALOG, DEFAULT_CODEX_MODEL, type CodexModelDefinition } from "../models.js";

export type ProviderAuthSource = "codex-login" | "openai-api-key" | "codex-auth-json";
export type ProviderWireApi = "cli-exec" | "responses" | "responses_websocket";
export type ProviderTransportMode = "cli-exec" | "http-responses" | "codex-http";
export type ProviderAdapterId = "codex-cli-exec" | "openai-http-responses" | "codex-chatgpt-http";
export type ProviderExecutor = "codex" | "fetch";

export interface ProviderCapabilityHooks {
  nativeTools: boolean;
  streaming: boolean;
  caching: boolean;
  providerRecovery: boolean;
  malformedToolRecovery: boolean;
  retry: boolean;
}

export interface ProviderModelOption extends CodexModelDefinition {
  disabledReason?: string;
}

export interface ProviderDefinition {
  id: string;
  name: string;
  baseUrl: string | null;
  requestTimeoutMs: number | null;
  maxRetries: number | null;
  authSource: ProviderAuthSource;
  wireApi: ProviderWireApi;
  defaultTransportMode: ProviderTransportMode;
  adapter: ProviderAdapterId;
  executor: ProviderExecutor;
  capabilities: ProviderCapabilityHooks;
  supportsWebsockets: boolean;
  modelIds: string[];
  warnings: string[];
  disabledReason: string | null;
}

export interface ProviderRegistry {
  providers: Record<string, ProviderDefinition>;
  warnings: string[];
}

export interface ProviderConfigInput {
  modelProviders?: Record<string, unknown>;
  model_providers?: Record<string, unknown>;
}

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const CODEX_SPARK_MODEL = "gpt-5.3-codex-spark";

export function createDefaultProviderRegistry(): ProviderRegistry {
  return {
    providers: {
      codex: {
        id: "codex",
        name: "Codex",
        baseUrl: DEFAULT_CODEX_BASE_URL,
        requestTimeoutMs: null,
        maxRetries: null,
        authSource: "codex-auth-json",
        wireApi: "responses",
        defaultTransportMode: "codex-http",
        adapter: "codex-chatgpt-http",
        executor: "fetch",
        capabilities: {
          nativeTools: true,
          streaming: false,
          caching: true,
          providerRecovery: true,
          malformedToolRecovery: true,
          retry: true,
        },
        supportsWebsockets: true,
        modelIds: CODEX_MODEL_CATALOG.map((model) => model.id),
        warnings: [],
        disabledReason: null,
      },
      openai: {
        id: "openai",
        name: "OpenAI",
        baseUrl: DEFAULT_OPENAI_BASE_URL,
        requestTimeoutMs: null,
        maxRetries: null,
        authSource: "openai-api-key",
        wireApi: "responses",
        defaultTransportMode: "http-responses",
        adapter: "openai-http-responses",
        executor: "fetch",
        capabilities: {
          nativeTools: true,
          streaming: false,
          caching: false,
          providerRecovery: true,
          malformedToolRecovery: true,
          retry: true,
        },
        supportsWebsockets: false,
        modelIds: CODEX_MODEL_CATALOG.filter((model) => model.supportedInApi).map((model) => model.id),
        warnings: [],
        disabledReason: null,
      },
    },
    warnings: [],
  };
}

export function mergeProviderRegistryConfigs(...configs: Array<ProviderConfigInput | null | undefined>): ProviderRegistry {
  const registry = cloneProviderRegistry(createDefaultProviderRegistry());
  for (const config of configs) {
    mergeProviderConfig(registry, config);
  }
  return registry;
}

export function getProviderDefinition(registry: ProviderRegistry | undefined, providerId: string): ProviderDefinition | null {
  return (registry ?? createDefaultProviderRegistry()).providers[providerId] ?? null;
}

export function getTransportProviderDefinition(
  registry: ProviderRegistry | undefined,
  mode: ProviderTransportMode,
): ProviderDefinition | null {
  const activeRegistry = registry ?? createDefaultProviderRegistry();
  if (mode === "codex-http") {
    return activeRegistry.providers.codex ?? null;
  }
  if (mode === "http-responses") {
    return activeRegistry.providers.openai ?? null;
  }
  return {
    id: "codex-cli",
    name: "Codex CLI",
    baseUrl: null,
    requestTimeoutMs: null,
    maxRetries: null,
    authSource: "codex-login",
    wireApi: "cli-exec",
    defaultTransportMode: "cli-exec",
    adapter: "codex-cli-exec",
    executor: "codex",
    capabilities: {
      nativeTools: false,
      streaming: false,
      caching: false,
      providerRecovery: true,
      malformedToolRecovery: true,
      retry: true,
    },
    supportsWebsockets: false,
    modelIds: CODEX_MODEL_CATALOG.map((model) => model.id),
    warnings: [],
    disabledReason: null,
  };
}

export function getProviderModelOptions(
  registry: ProviderRegistry | undefined,
  providerId: string,
  mode: ProviderTransportMode = "cli-exec",
): ProviderModelOption[] {
  const definition = getProviderDefinition(registry, providerId);
  if (!definition) {
    return [];
  }

  const modelIds = definition.modelIds.length > 0 ? definition.modelIds : [DEFAULT_CODEX_MODEL];
  return modelIds.map((id) => {
    const model = CODEX_MODEL_CATALOG.find((entry) => entry.id === id) ?? createConfiguredModel(id);
    const disabledReason = getModelDisabledReason(model, definition, mode);
    return disabledReason ? { ...model, disabledReason } : model;
  });
}

export function isProviderModelEnabled(
  registry: ProviderRegistry | undefined,
  providerId: string,
  modelId: string,
  mode: ProviderTransportMode,
): boolean {
  return getProviderModelOptions(registry, providerId, mode)
    .some((model) => model.id === modelId && !model.disabledReason);
}

function mergeProviderConfig(registry: ProviderRegistry, config: ProviderConfigInput | null | undefined): void {
  if (!config || typeof config !== "object") {
    return;
  }

  const modelProviders = config.modelProviders ?? config.model_providers;
  if (!modelProviders || typeof modelProviders !== "object" || Array.isArray(modelProviders)) {
    return;
  }

  for (const [id, rawProvider] of Object.entries(modelProviders)) {
    const parsed = parseProviderDefinition(id, rawProvider);
    if (!parsed.provider) {
      registry.warnings.push(...parsed.warnings);
      continue;
    }
    const existing = registry.providers[id];
    registry.providers[id] = {
      ...(existing ?? createFallbackProvider(id)),
      ...parsed.provider,
      id,
      warnings: [...(existing?.warnings ?? []), ...parsed.warnings],
    };
    registry.warnings.push(...parsed.warnings);
  }
}

function parseProviderDefinition(
  id: string,
  rawProvider: unknown,
): { provider: Partial<ProviderDefinition> | null; warnings: string[] } {
  const warnings: string[] = [];
  if (!rawProvider || typeof rawProvider !== "object" || Array.isArray(rawProvider)) {
    return {
      provider: { disabledReason: "provider config must be an object" },
      warnings: [`modelProviders.${id}: provider config must be an object`],
    };
  }

  const record = rawProvider as Record<string, unknown>;
  const allowedFields = new Set([
    "name",
    "baseUrl",
    "base_url",
    "requestTimeoutMs",
    "request_timeout_ms",
    "timeoutMs",
    "timeout_ms",
    "maxRetries",
    "max_retries",
    "authSource",
    "auth_source",
    "wireApi",
    "wire_api",
    "supportsWebsockets",
    "supports_websockets",
    "capabilities",
    "models",
  ]);
  for (const key of Object.keys(record)) {
    if (!allowedFields.has(key)) {
      warnings.push(`modelProviders.${id}: unknown field ${key}`);
    }
  }

  const provider: Partial<ProviderDefinition> = {};
  assignOptionalString(record.name, "name", provider, warnings, id);
  assignOptionalString(record.baseUrl ?? record.base_url, "baseUrl", provider, warnings, id);
  assignOptionalPositiveInteger(record.requestTimeoutMs ?? record.request_timeout_ms ?? record.timeoutMs ?? record.timeout_ms, "requestTimeoutMs", provider, warnings, id);
  assignOptionalNonNegativeInteger(record.maxRetries ?? record.max_retries, "maxRetries", provider, warnings, id);
  assignOptionalAuthSource(record.authSource ?? record.auth_source, provider, warnings, id);
  assignOptionalWireApi(record.wireApi ?? record.wire_api, provider, warnings, id);
  assignOptionalBoolean(record.supportsWebsockets ?? record.supports_websockets, "supportsWebsockets", provider, warnings, id);
  assignOptionalCapabilities(record.capabilities, provider, warnings, id);
  assignOptionalModels(record.models, provider, warnings, id);

  if (provider.wireApi === "responses_websocket" && provider.supportsWebsockets === false) {
    provider.disabledReason = "responses_websocket requires supportsWebsockets=true";
    warnings.push(`modelProviders.${id}: responses_websocket requires supportsWebsockets=true`);
  }

  return { provider, warnings };
}

function assignOptionalString(
  value: unknown,
  field: "name" | "baseUrl",
  provider: Partial<ProviderDefinition>,
  warnings: string[],
  providerId: string,
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "string") {
    warnings.push(`modelProviders.${providerId}.${field}: expected string`);
    return;
  }
  provider[field] = value.trim();
}

function assignOptionalAuthSource(
  value: unknown,
  provider: Partial<ProviderDefinition>,
  warnings: string[],
  providerId: string,
): void {
  if (value === undefined) {
    return;
  }
  if (value !== "codex-login" && value !== "openai-api-key" && value !== "codex-auth-json") {
    warnings.push(`modelProviders.${providerId}.authSource: expected codex-login, openai-api-key, or codex-auth-json`);
    provider.disabledReason = "invalid authSource";
    return;
  }
  provider.authSource = value;
}

function assignOptionalWireApi(
  value: unknown,
  provider: Partial<ProviderDefinition>,
  warnings: string[],
  providerId: string,
): void {
  if (value === undefined) {
    return;
  }
  if (value !== "cli-exec" && value !== "responses" && value !== "responses_websocket") {
    warnings.push(`modelProviders.${providerId}.wireApi: expected cli-exec, responses, or responses_websocket`);
    provider.disabledReason = "invalid wireApi";
    return;
  }
  provider.wireApi = value;
}

function assignOptionalBoolean(
  value: unknown,
  field: "supportsWebsockets",
  provider: Partial<ProviderDefinition>,
  warnings: string[],
  providerId: string,
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "boolean") {
    warnings.push(`modelProviders.${providerId}.${field}: expected boolean`);
    return;
  }
  provider[field] = value;
}

function assignOptionalPositiveInteger(
  value: unknown,
  field: "requestTimeoutMs",
  provider: Partial<ProviderDefinition>,
  warnings: string[],
  providerId: string,
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    warnings.push(`modelProviders.${providerId}.${field}: expected positive integer`);
    return;
  }
  provider[field] = value;
}

function assignOptionalNonNegativeInteger(
  value: unknown,
  field: "maxRetries",
  provider: Partial<ProviderDefinition>,
  warnings: string[],
  providerId: string,
): void {
  if (value === undefined) {
    return;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    warnings.push(`modelProviders.${providerId}.${field}: expected non-negative integer`);
    return;
  }
  provider[field] = value;
}

function assignOptionalModels(
  value: unknown,
  provider: Partial<ProviderDefinition>,
  warnings: string[],
  providerId: string,
): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string" && entry.trim().length > 0)) {
    warnings.push(`modelProviders.${providerId}.models: expected non-empty string array`);
    return;
  }
  provider.modelIds = value.map((entry) => entry.trim());
}

function assignOptionalCapabilities(
  value: unknown,
  provider: Partial<ProviderDefinition>,
  warnings: string[],
  providerId: string,
): void {
  if (value === undefined) {
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    warnings.push(`modelProviders.${providerId}.capabilities: expected object`);
    return;
  }
  const existing = provider.capabilities ?? createDefaultProviderCapabilities();
  const record = value as Record<string, unknown>;
  const next = { ...existing };
  for (const key of Object.keys(record)) {
    if (!(key in next)) {
      warnings.push(`modelProviders.${providerId}.capabilities.${key}: unknown capability`);
      continue;
    }
    const capability = record[key];
    if (typeof capability !== "boolean") {
      warnings.push(`modelProviders.${providerId}.capabilities.${key}: expected boolean`);
      continue;
    }
    next[key as keyof ProviderCapabilityHooks] = capability;
  }
  provider.capabilities = next;
}

function createDefaultProviderCapabilities(): ProviderCapabilityHooks {
  return {
    nativeTools: false,
    streaming: false,
    caching: false,
    providerRecovery: false,
    malformedToolRecovery: false,
    retry: false,
  };
}

function getModelDisabledReason(
  model: CodexModelDefinition,
  provider: ProviderDefinition,
  mode: ProviderTransportMode,
): string | undefined {
  if (provider.disabledReason) {
    return provider.disabledReason;
  }
  const usesCodexChatGptRoute =
    model.id === CODEX_SPARK_MODEL &&
    provider.id === "codex" &&
    mode === "codex-http" &&
    provider.adapter === "codex-chatgpt-http";
  if (mode !== "cli-exec" && !model.supportedInApi && !usesCodexChatGptRoute) {
    return "not available on this API transport";
  }
  return undefined;
}

function createConfiguredModel(id: string): CodexModelDefinition {
  return {
    id,
    label: id,
    description: "configured model",
    family: "gpt",
    supportedInApi: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    thinkingLevelMetadata: {
      defaultThinkingLevel: "medium",
      supportedThinkingLevels: ["minimal", "low", "medium", "high"],
      providerControls: [
        { provider: "openai", transportModes: ["http-responses"], parameter: "reasoning.effort" },
      ],
    },
    contextWindow: 0,
    maxContextWindow: 0,
  };
}

function createFallbackProvider(id: string): ProviderDefinition {
  return {
    id,
    name: id,
    baseUrl: null,
    requestTimeoutMs: null,
    maxRetries: null,
    authSource: "openai-api-key",
    wireApi: "responses",
    defaultTransportMode: "http-responses",
    adapter: "openai-http-responses",
    executor: "fetch",
    capabilities: createDefaultProviderCapabilities(),
    supportsWebsockets: false,
    modelIds: [],
    warnings: [],
    disabledReason: null,
  };
}

function cloneProviderRegistry(registry: ProviderRegistry): ProviderRegistry {
  return {
    providers: Object.fromEntries(
      Object.entries(registry.providers).map(([id, provider]) => [
        id,
        {
          ...provider,
          capabilities: { ...provider.capabilities },
          modelIds: [...provider.modelIds],
          warnings: [...provider.warnings],
        },
      ]),
    ),
    warnings: [...registry.warnings],
  };
}
