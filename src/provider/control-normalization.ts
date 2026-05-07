import { CODEX_CHATGPT_HTTP_ADAPTER } from "./codex-chatgpt-http.js";
import { CODEX_HTTP_ADAPTER } from "./codex-http.js";
import { CODEX_EXEC_ADAPTER } from "./codex-exec.js";
import { getCodexModelDefinition, normalizeCodexModel } from "../models.js";
import { getProviderModelOptions } from "./registry.js";
import type { ProviderFailure, ProviderRequest } from "../provider.js";
import type { RuntimeSession } from "../runtime/session.js";
import { createTurnCompletion } from "../runtime/turn-completion.js";

export type ProviderTransportAdapter = typeof CODEX_HTTP_ADAPTER | typeof CODEX_CHATGPT_HTTP_ADAPTER | typeof CODEX_EXEC_ADAPTER;

export function resolveModel(session: RuntimeSession): string | null {
  const selected = session.providerRouting.modelSelection.configuredModels;
  return normalizeCodexModel(selected[session.provider as keyof typeof selected] ?? null);
}

export function resolveTransport(session: RuntimeSession): ProviderTransportAdapter {
  return session.providerTransport.mode === "http-responses"
    ? CODEX_HTTP_ADAPTER
    : session.providerTransport.mode === "codex-http"
      ? CODEX_CHATGPT_HTTP_ADAPTER
      : CODEX_EXEC_ADAPTER;
}

export function createUnavailableModelFailure(
  session: RuntimeSession,
  provider: string,
  model: string | null,
  transport: ProviderTransportAdapter,
): ProviderFailure | null {
  const resolvedModel = normalizeCodexModel(model) ?? model;
  const modelOption = resolvedModel
    ? getProviderModelOptions(session.providerRegistry, provider, session.providerTransport.mode)
      .find((option) => option.id === resolvedModel)
    : null;
  if (!resolvedModel || (modelOption && !modelOption.disabledReason)) {
    return null;
  }

  const definition = getCodexModelDefinition(resolvedModel);
  return {
    ok: false,
    provider,
    model: resolvedModel,
    transport: transport.transport,
    adapter: transport.id,
    fallbackApplied: false,
    code: "unsupported_model",
    message: `model ${resolvedModel} is not available for provider ${provider}`,
    detail: modelOption?.disabledReason
      ?? (definition?.upgrade
        ? `Model ${resolvedModel} is not exposed on this transport. Suggested upgrade: ${definition.upgrade}.`
        : `Model ${resolvedModel} is not configured for provider ${provider}.`),
  };
}

export function validateAttachmentSupport(
  request: ProviderRequest,
  transport: ProviderTransportAdapter,
): ProviderFailure | null {
  const attachments = request.attachments ?? [];
  if (attachments.length === 0) {
    return null;
  }

  if (request.session.providerTransport.mode === "cli-exec") {
    return {
      ok: false,
      provider: request.session.provider,
      model: resolveModel(request.session),
      transport: transport.transport,
      adapter: transport.id,
      fallbackApplied: false,
      code: "transport_error",
      message: "image attachment unsupported on cli-exec transport",
      detail: "switch transport with /provider transport codex-http or /provider transport http-responses",
    };
  }

  return null;
}

export function createEmptyOutputFailure(
  provider: string,
  model: string | null,
  adapter: ProviderFailure["adapter"],
): ProviderFailure {
  return {
    ok: false,
    provider,
    model,
    transport: provider === "openai" ? "openai" : "codex",
    adapter,
    fallbackApplied: false,
    code: "transport_error",
    message: "provider returned empty output",
    detail: "provider finished with exit code 0 but produced no assistant text.",
    completion: createTurnCompletion({
      ok: false,
      stopReason: "empty_output",
      errors: ["provider returned empty output"],
    }),
  };
}

export function extractGenAiUsage(raw: unknown): Record<string, number> {
  const usage = isRecord(raw) ? raw.usage : undefined;
  if (!isRecord(usage)) {
    return {};
  }

  return {
    "gen_ai.usage.input_tokens": readNumericUsage(usage, ["input_tokens", "prompt_tokens"]),
    "gen_ai.usage.output_tokens": readNumericUsage(usage, ["output_tokens", "completion_tokens"]),
    "gen_ai.usage.total_tokens": readNumericUsage(usage, ["total_tokens"]),
  };
}

function readNumericUsage(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
