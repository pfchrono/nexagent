import type { RuntimeSession } from "../runtime/session.js";

export interface OpenTuiRuntimeView {
  product: string;
  sessionId: string;
  provider: string;
  model: string;
  cwd: string;
  status: string;
  detail: string;
  turnCount: number;
  approval: string;
  toolPolicy: string;
  providerTransportMode: string;
  imageAttachmentSupported: boolean;
  headerTitle: string;
  providerLabel: string;
  sessionLabel: string;
  statusLabel: string;
  cwdLabel: string;
  transcriptLines: string[];
  composerHint: string;
  footerLabel: string;
  traceCollapsedLabel: string;
  traceExpandedLabel: string;
  traceSummaryLines: string[];
  traceDetailLines: string[];
}

export function createOpenTuiRuntimeView(session: RuntimeSession): OpenTuiRuntimeView {
  const configuredModels = session.providerRouting.modelSelection.configuredModels as Record<string, string | undefined>;
  const provider = session.providerTransport.activeProvider;
  const model = configuredModels[provider] ?? "unknown";
  const approval = session.operationControls.yoloMode
    ? "yolo"
    : session.operationControls.requireApprovalForGuarded
      ? "guarded"
      : "open";
  const transcriptLines = createTranscriptLines(session);
  const traceSummaryLines = createTraceSummaryLines(session);
  const traceDetailLines = createTraceDetailLines(session);
  return {
    product: session.product,
    sessionId: session.id,
    provider,
    model,
    cwd: session.cwd,
    status: session.action.status,
    detail: session.action.detail,
    turnCount: session.telemetry.turnCount,
    approval,
    toolPolicy: session.toolPolicy.mode,
    providerTransportMode: session.providerTransport.mode,
    imageAttachmentSupported: session.providerTransport.mode !== "cli-exec",
    headerTitle: "nexagent :: opentui",
    providerLabel: `${provider}/${model}`,
    sessionLabel: `session ${session.id} | turns ${String(session.telemetry.turnCount)}`,
    statusLabel: `${session.action.status} - ${session.action.detail}`,
    cwdLabel: session.cwd,
    transcriptLines,
    composerHint: "Type prompt. Enter submit. Esc clear/cancel. Ctrl+C quit.",
    footerLabel: `approval ${approval} | tools ${session.toolPolicy.mode}`,
    traceCollapsedLabel: "trace closed - Ctrl+T expand",
    traceExpandedLabel: "trace open - Ctrl+T collapse",
    traceSummaryLines,
    traceDetailLines,
  };
}

function createTranscriptLines(session: RuntimeSession): string[] {
  const lines = session.conversation
    .slice(-8)
    .map((turn) => `${turn.role === "user" ? "you" : "agent"}: ${firstLine(turn.content)}`)
    .filter((line) => line.trim().length > 0);

  if (lines.length > 0) {
    return lines;
  }

  const eventLines = session.events
    .filter((event) => event.kind === "prompt" || event.kind === "assistant" || event.kind === "command")
    .slice(-8)
    .map((event) => `${event.kind}: ${firstLine(event.detail || event.summary)}`)
    .filter((line) => line.trim().length > 0);

  return eventLines.length > 0 ? eventLines : ["No transcript yet"];
}

function createTraceSummaryLines(session: RuntimeSession): string[] {
  if (session.events.length === 0) {
    return ["no turn events"];
  }

  return session.events.slice(-6).map((event) => `${event.kind} ${event.status} - ${event.summary}`);
}

function createTraceDetailLines(session: RuntimeSession): string[] {
  if (session.events.length === 0) {
    return ["trace empty"];
  }

  return session.events.slice(-12).map((event) => {
    const detail = firstLine(event.detail || event.summary);
    return `${event.at} | ${event.kind} | ${event.status} | ${detail}`;
  });
}

function firstLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
