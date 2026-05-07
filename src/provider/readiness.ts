import { getProviderDefinition, getProviderModelOptions } from "./registry.js";
import type { RuntimeSession } from "../runtime/session.js";

export type ProviderReadinessStatus = "ready" | "warning" | "blocked";

export interface ProviderReadiness {
  status: ProviderReadinessStatus;
  provider: string;
  model: string;
  transport: string;
  adapter: string;
  authSource: string;
  authGate: string;
  endpoint: string;
  warnings: string[];
  errors: string[];
}

export interface ProviderErrorJournalEntry {
  at: string;
  category: "readiness" | "transport" | "model" | "auth" | "retry";
  provider: string;
  transport: string;
  adapter: string;
  model: string | null;
  message: string;
  detail?: string;
}

const PROVIDER_ERROR_JOURNAL_LIMIT = 20;

export function getProviderReadiness(session: RuntimeSession): ProviderReadiness {
  const provider = session.providerTransport.activeProvider;
  const definition = getProviderDefinition(session.providerRegistry, provider);
  const model = session.providerRouting.modelSelection.configuredModels[provider as keyof typeof session.providerRouting.modelSelection.configuredModels] ?? "default";
  const modelOption = getProviderModelOptions(session.providerRegistry, provider, session.providerTransport.mode)
    .find((option) => option.id === model);
  const warnings = [
    ...(session.providerRegistry.warnings ?? []),
    ...(definition?.warnings ?? []),
  ];
  const errors = [
    !definition ? `provider ${provider} missing from registry` : null,
    definition?.disabledReason ? `provider ${provider} disabled: ${definition.disabledReason}` : null,
    session.providerTransport.authGate !== "ready" ? `auth ${session.providerTransport.authSource} is ${session.providerTransport.authGate}` : null,
    modelOption?.disabledReason ? `model ${model} disabled: ${modelOption.disabledReason}` : null,
  ].filter((entry): entry is string => Boolean(entry));

  return {
    status: errors.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    provider,
    model,
    transport: session.providerTransport.mode,
    adapter: session.providerTransport.adapter,
    authSource: session.providerTransport.authSource,
    authGate: session.providerTransport.authGate,
    endpoint: session.providerTransport.openaiBaseUrl ?? definition?.baseUrl ?? "local",
    warnings,
    errors,
  };
}

export function recordProviderErrorJournal(
  session: RuntimeSession,
  entry: Omit<ProviderErrorJournalEntry, "at" | "provider" | "transport" | "adapter"> & Partial<Pick<ProviderErrorJournalEntry, "provider" | "transport" | "adapter">>,
): ProviderErrorJournalEntry {
  const journalEntry: ProviderErrorJournalEntry = {
    at: new Date().toISOString(),
    provider: entry.provider ?? session.providerTransport.activeProvider,
    transport: entry.transport ?? session.providerTransport.mode,
    adapter: entry.adapter ?? session.providerTransport.adapter,
    model: entry.model,
    category: entry.category,
    message: entry.message,
    ...(entry.detail ? { detail: entry.detail } : {}),
  };
  session.providerErrorJournal = [...(session.providerErrorJournal ?? []), journalEntry].slice(-PROVIDER_ERROR_JOURNAL_LIMIT);
  return journalEntry;
}
