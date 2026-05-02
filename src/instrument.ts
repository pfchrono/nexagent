import * as Sentry from "@sentry/node";
import {
  createRuntimeDiagnostic,
  normalizeDiagnosticAttributes,
  type RuntimeDiagnosticEvent,
  type RuntimeDiagnosticInput,
} from "./runtime/diagnostics.js";

const DEFAULT_SENTRY_DSN =
  "https://9881aaf51ee695e2300ba4f25eb26344@o4511200561397760.ingest.us.sentry.io/4511307802738688";

let initialized = false;

type SentrySpan = {
  setAttribute(name: string, value: string | number | boolean): void;
};

type SentryAttributeValue = string | number | boolean | null | undefined;

export interface SentryDiagnosticsStatus {
  initialized: boolean;
  enabled: boolean;
  dsnConfigured: boolean;
  environment: string;
  release: string;
  platform: string;
  runtime: string;
  redactionMode: "tags-only" | "content-enabled";
}

export function initializeSentry(): boolean {
  if (initialized) {
    return true;
  }

  const dsn = process.env.SENTRY_DSN?.trim() || DEFAULT_SENTRY_DSN;
  if (!dsn) {
    return false;
  }

  const explicitEnabled = process.env.SENTRY_ENABLED?.trim().toLowerCase();
  const enabled =
    explicitEnabled !== "false" && (process.env.NODE_ENV !== "test" || explicitEnabled === "true");

  if (!enabled) {
    return false;
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,
    sendDefaultPii: parseBooleanEnv(process.env.SENTRY_SEND_DEFAULT_PII, true),
    tracesSampleRate: parseSampleRate(
      process.env.SENTRY_TRACES_SAMPLE_RATE,
      process.env.NODE_ENV === "development" ? 1.0 : 0.1,
    ),
    includeLocalVariables: parseBooleanEnv(process.env.SENTRY_INCLUDE_LOCAL_VARIABLES, false),
    enableLogs: true,
    shutdownTimeout: 2000,
    registerEsmLoaderHooks: false,
    integrations: filterSentryDefaultIntegrations,
  });

  initialized = true;
  return true;
}

export async function captureCliException(error: unknown): Promise<void> {
  if (!shouldCaptureCliException(error)) {
    return;
  }

  if (!initializeSentry()) {
    return;
  }

  Sentry.captureException(error);
  await Sentry.flush(2000);
}

export function shouldCaptureCliException(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return true;
  }
  if (error.name === "RuntimeConfigurationError") {
    return false;
  }
  return !error.message.startsWith("usage:");
}

export function filterSentryDefaultIntegrations<T extends { name: string }>(integrations: T[]): T[] {
  return integrations.filter((integration) => integration.name !== "NodeSystemError");
}

export async function withSentryAiAgentSpan<T>(
  name: string,
  attributes: Record<string, SentryAttributeValue>,
  callback: (span: SentrySpan | null) => Promise<T>,
): Promise<T> {
  return withSentrySpan("gen_ai.invoke_agent", name, attributes, callback);
}

export async function withSentryAiRequestSpan<T>(
  name: string,
  attributes: Record<string, SentryAttributeValue>,
  callback: (span: SentrySpan | null) => Promise<T>,
): Promise<T> {
  return withSentrySpan("gen_ai.request", name, attributes, callback);
}

export async function withSentryAiToolSpan<T>(
  toolName: string,
  callback: (span: SentrySpan | null) => Promise<T>,
): Promise<T> {
  return withSentrySpan("gen_ai.execute_tool", `Tool ${toolName}`, { "gen_ai.tool.name": toolName }, callback);
}

export function setSentrySpanAttributes(span: SentrySpan | null, attributes: Record<string, SentryAttributeValue>): void {
  if (!span) {
    return;
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      span.setAttribute(key, value);
    }
  }
}

export function logSentryInfo(message: string, attributes: Record<string, SentryAttributeValue> = {}): void {
  if (!initializeSentry()) {
    return;
  }

  Sentry.logger.info(message, cleanAttributes(attributes));
}

export function logSentryError(message: string, attributes: Record<string, SentryAttributeValue> = {}): void {
  if (!initializeSentry()) {
    return;
  }

  Sentry.logger.error(message, cleanAttributes(attributes));
}

export function shouldRecordSentryAiContent(): boolean {
  return parseBooleanEnv(process.env.SENTRY_RECORD_AI_CONTENT, false);
}

export function getSentryDiagnosticsStatus(): SentryDiagnosticsStatus {
  const explicitEnabled = process.env.SENTRY_ENABLED?.trim().toLowerCase();
  const enabled =
    explicitEnabled !== "false" && (process.env.NODE_ENV !== "test" || explicitEnabled === "true");
  return {
    initialized,
    enabled,
    dsnConfigured: Boolean(process.env.SENTRY_DSN?.trim() || DEFAULT_SENTRY_DSN),
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE ?? "none",
    platform: process.platform,
    runtime: `node ${process.version}`,
    redactionMode: shouldRecordSentryAiContent() ? "content-enabled" : "tags-only",
  };
}

export function buildSentryDiagnosticAttributes(input: RuntimeDiagnosticInput | RuntimeDiagnosticEvent): Record<string, string | number | boolean> {
  const event = "attributes" in input && "class" in input && "summary" in input
    ? input as RuntimeDiagnosticEvent
    : createRuntimeDiagnostic(input as RuntimeDiagnosticInput);
  return {
    "nexagent.diagnostic.class": event.class,
    "nexagent.diagnostic.severity": event.severity,
    "nexagent.diagnostic.summary": event.summary,
    ...Object.fromEntries(
      Object.entries(normalizeDiagnosticAttributes(event.attributes))
        .map(([key, value]) => [`nexagent.diagnostic.${key}`, value]),
    ),
  };
}

export function captureSentryDiagnostic(
  input: RuntimeDiagnosticInput | RuntimeDiagnosticEvent,
  options: { sendEvent?: boolean } = {},
): RuntimeDiagnosticEvent {
  const event = "attributes" in input && "class" in input && "summary" in input
    ? input as RuntimeDiagnosticEvent
    : createRuntimeDiagnostic(input as RuntimeDiagnosticInput);
  if (options.sendEvent && initializeSentry()) {
    Sentry.captureMessage(event.summary, {
      level: event.severity === "error" ? "error" : event.severity === "warning" ? "warning" : "info",
      tags: {
        "nexagent.diagnostic.class": event.class,
        "nexagent.diagnostic.severity": event.severity,
      },
      extra: buildSentryDiagnosticAttributes(event),
    });
  }
  return event;
}

export function runSentryDiagnosticsSelfTest(options: { sendEvent?: boolean } = {}): {
  sent: boolean;
  event: RuntimeDiagnosticEvent;
  attributes: Record<string, string | number | boolean>;
} {
  const event = captureSentryDiagnostic({
    class: "sentry.status",
    attributes: {
      dry_run: !options.sendEvent,
      event_sent: Boolean(options.sendEvent),
    },
  }, { sendEvent: options.sendEvent });
  return {
    sent: Boolean(options.sendEvent),
    event,
    attributes: buildSentryDiagnosticAttributes(event),
  };
}

async function withSentrySpan<T>(
  op: string,
  name: string,
  attributes: Record<string, SentryAttributeValue>,
  callback: (span: SentrySpan | null) => Promise<T>,
): Promise<T> {
  if (!initializeSentry()) {
    return callback(null);
  }

  return Sentry.startSpan(
    {
      op,
      name,
      attributes: cleanAttributes(attributes),
    },
    async (span) => callback(span),
  );
}

function cleanAttributes(attributes: Record<string, SentryAttributeValue>): Record<string, string | number | boolean> {
  return normalizeDiagnosticAttributes(attributes);
}

function parseSampleRate(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

initializeSentry();
