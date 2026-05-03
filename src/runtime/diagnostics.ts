export type DiagnosticSeverity = "info" | "warning" | "error";

export type DiagnosticClass =
  | "provider.auth"
  | "provider.transport"
  | "provider.malformed_tool_call"
  | "provider.missing_evidence"
  | "tool.blocked"
  | "tool.failed"
  | "tool.mcp_unavailable"
  | "command.failed"
  | "startup.bootstrap"
  | "compact.threshold"
  | "compact.started"
  | "compact.queued_intent"
  | "compact.completed"
  | "compact.failed"
  | "opentui.input"
  | "opentui.render"
  | "opentui.update"
  | "memory.signal"
  | "sentry.status";

export type SafeDiagnosticAttributeValue = string | number | boolean;
export type SafeDiagnosticAttributes = Record<string, SafeDiagnosticAttributeValue>;

export interface RuntimeDiagnosticEvent {
  class: DiagnosticClass;
  severity: DiagnosticSeverity;
  summary: string;
  attributes: SafeDiagnosticAttributes;
}

export interface RuntimeDiagnosticInput {
  class: DiagnosticClass;
  severity?: DiagnosticSeverity;
  summary?: string;
  attributes?: Record<string, unknown> | null;
}

export const DIAGNOSTIC_CLASS_METADATA: Record<DiagnosticClass, { severity: DiagnosticSeverity; summary: string }> = {
  "provider.auth": { severity: "error", summary: "provider auth unavailable" },
  "provider.transport": { severity: "error", summary: "provider transport failure" },
  "provider.malformed_tool_call": { severity: "warning", summary: "provider emitted malformed tool call" },
  "provider.missing_evidence": { severity: "error", summary: "provider response blocked by missing evidence" },
  "tool.blocked": { severity: "warning", summary: "tool execution blocked" },
  "tool.failed": { severity: "error", summary: "tool execution failed" },
  "tool.mcp_unavailable": { severity: "warning", summary: "MCP tool unavailable" },
  "command.failed": { severity: "warning", summary: "runtime command failed" },
  "startup.bootstrap": { severity: "error", summary: "startup bootstrap failure" },
  "compact.threshold": { severity: "info", summary: "compaction threshold reached" },
  "compact.started": { severity: "info", summary: "compaction started" },
  "compact.queued_intent": { severity: "warning", summary: "compaction preserved queued intent" },
  "compact.completed": { severity: "info", summary: "compaction completed" },
  "compact.failed": { severity: "error", summary: "compaction failed" },
  "opentui.input": { severity: "info", summary: "OpenTUI input interaction" },
  "opentui.render": { severity: "info", summary: "OpenTUI render update" },
  "opentui.update": { severity: "info", summary: "OpenTUI state update" },
  "memory.signal": { severity: "info", summary: "memory signal diagnostic" },
  "sentry.status": { severity: "info", summary: "Sentry diagnostic status" },
};

const UNSAFE_ATTRIBUTE_KEY = /(?:prompt|content|output|transcript|file|path|stdout|stderr|detail|message|text|body|payload|raw|error|secret|token|key)/i;
const MAX_SAFE_STRING_LENGTH = 160;

export function getDiagnosticClasses(): DiagnosticClass[] {
  return Object.keys(DIAGNOSTIC_CLASS_METADATA) as DiagnosticClass[];
}

export function createRuntimeDiagnostic(input: RuntimeDiagnosticInput): RuntimeDiagnosticEvent {
  const metadata = DIAGNOSTIC_CLASS_METADATA[input.class];
  return {
    class: input.class,
    severity: input.severity ?? metadata.severity,
    summary: sanitizeSummary(input.summary ?? metadata.summary),
    attributes: normalizeDiagnosticAttributes({
      ...(input.attributes ?? {}),
      class: input.class,
      severity: input.severity ?? metadata.severity,
    }),
  };
}

export function normalizeDiagnosticAttributes(attributes: Record<string, unknown> | null | undefined): SafeDiagnosticAttributes {
  const safe: SafeDiagnosticAttributes = {};
  for (const [rawKey, value] of Object.entries(attributes ?? {})) {
    const key = normalizeAttributeKey(rawKey);
    if (!key || UNSAFE_ATTRIBUTE_KEY.test(key) || value === null || value === undefined) {
      continue;
    }
    if (typeof value === "boolean" || typeof value === "number") {
      if (typeof value === "number" && !Number.isFinite(value)) {
        continue;
      }
      safe[key] = value;
      continue;
    }
    if (typeof value === "string") {
      const normalized = value.replace(/\s+/g, " ").trim();
      if (!normalized || looksSensitive(normalized)) {
        continue;
      }
      safe[key] = normalized.length > MAX_SAFE_STRING_LENGTH
        ? `${normalized.slice(0, MAX_SAFE_STRING_LENGTH - 3)}...`
        : normalized;
    }
  }
  return safe;
}

export function formatRuntimeDiagnostic(event: RuntimeDiagnosticEvent): string {
  return `${event.severity} ${event.class}: ${event.summary}`;
}

export function toDiagnosticRuntimeEvent(event: RuntimeDiagnosticEvent): {
  kind: "control";
  status: "info" | "blocked" | "failed";
  summary: string;
  detail: string;
} {
  return {
    kind: "control",
    status: event.severity === "error" ? "failed" : event.severity === "warning" ? "blocked" : "info",
    summary: formatRuntimeDiagnostic(event),
    detail: Object.entries(event.attributes)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join("; ") || "none",
  };
}

function sanitizeSummary(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "diagnostic event";
  }
  return normalized.length > MAX_SAFE_STRING_LENGTH ? `${normalized.slice(0, MAX_SAFE_STRING_LENGTH - 3)}...` : normalized;
}

function normalizeAttributeKey(key: string): string {
  return key
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function looksSensitive(value: string): boolean {
  return /(?:sk-[a-z0-9_-]{12,}|ghp_[a-z0-9_]{12,}|BEGIN [A-Z ]*PRIVATE KEY|password=|authorization:|bearer\s+[a-z0-9._-]+)/i.test(value);
}
