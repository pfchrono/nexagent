import type { RuntimeSession } from "../runtime/session.js";

export type OpenTuiTranscriptBlockKind = "user" | "assistant" | "command" | "tool" | "result" | "trace" | "system";

export interface OpenTuiTranscriptBlock {
  id: string;
  kind: OpenTuiTranscriptBlockKind;
  label: string;
  summaryLines: string[];
  detailLines: string[];
  collapsedByDefault: boolean;
}

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
  transcriptBlocks: OpenTuiTranscriptBlock[];
  composerHint: string;
  footerLabel: string;
  traceCollapsedLabel: string;
  traceExpandedLabel: string;
  traceSummaryLines: string[];
  traceDetailLines: string[];
  traceBlocks: OpenTuiTranscriptBlock[];
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
  const transcriptBlocks = createTranscriptBlocks(session);
  const traceBlocks = createTraceBlocks(session);
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
    transcriptBlocks,
    composerHint: "Type prompt. Enter submit. Esc clear/cancel. Ctrl+Q quit.",
    footerLabel: `approval ${approval} | tools ${session.toolPolicy.mode}`,
    traceCollapsedLabel: "trace closed - Ctrl+T expand",
    traceExpandedLabel: "trace open - Ctrl+T collapse",
    traceSummaryLines,
    traceDetailLines,
    traceBlocks,
  };
}

export function createLocalOutputBlock(id: string, lines: string[]): OpenTuiTranscriptBlock {
  return createBlock({
    id,
    kind: "command",
    label: "command",
    lines,
    collapsedByDefault: lines.length > 4,
  });
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

function createTranscriptBlocks(session: RuntimeSession): OpenTuiTranscriptBlock[] {
  const conversationBlocks = session.conversation.slice(-16).map((turn, index) => createBlock({
    id: `conversation-${String(index)}`,
    kind: turn.role === "user" ? "user" : "assistant",
    label: turn.role === "user" ? "you" : "agent",
    lines: [firstLine(turn.content)],
    collapsedByDefault: false,
  }));

  if (conversationBlocks.length > 0) {
    return conversationBlocks;
  }

  const eventBlocks = session.events
    .filter((event) => event.kind === "prompt" || event.kind === "assistant" || event.kind === "command")
    .slice(-16)
    .map((event, index) => createBlock({
      id: `event-${String(index)}`,
      kind: event.kind === "assistant" ? "assistant" : event.kind === "command" ? "command" : "system",
      label: event.kind,
      lines: [firstLine(event.detail || event.summary)],
      collapsedByDefault: false,
    }));

  return eventBlocks.length > 0 ? eventBlocks : [createBlock({
    id: "empty-transcript",
    kind: "system",
    label: "system",
    lines: ["No transcript yet"],
    collapsedByDefault: false,
  })];
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

function createTraceBlocks(session: RuntimeSession): OpenTuiTranscriptBlock[] {
  if (session.events.length === 0) {
    return [createBlock({
      id: "empty-trace",
      kind: "trace",
      label: "trace",
      lines: ["trace empty"],
      collapsedByDefault: true,
    })];
  }

  return session.events.slice(-12).map((event, index) => createBlock({
    id: `trace-${String(index)}-${event.at}`,
    kind: event.kind === "tool" ? "tool" : event.kind === "command" ? "command" : "trace",
    label: `${event.kind} ${event.status}`,
    lines: [`${event.summary}`, `${event.at} | ${firstLine(event.detail || event.summary)}`],
    collapsedByDefault: true,
  }));
}

function createBlock(options: {
  id: string;
  kind: OpenTuiTranscriptBlockKind;
  label: string;
  lines: string[];
  collapsedByDefault: boolean;
}): OpenTuiTranscriptBlock {
  const detailLines = options.lines
    .map((line) => firstLine(line))
    .filter((line) => line.length > 0);
  const summaryLines = detailLines.length > 4
    ? [`${detailLines[0] ?? ""} (+${String(detailLines.length - 1)} more lines)`]
    : detailLines.slice(0, 4);
  return {
    id: options.id,
    kind: options.kind,
    label: options.label,
    summaryLines: summaryLines.length > 0 ? summaryLines : [options.label],
    detailLines,
    collapsedByDefault: options.collapsedByDefault,
  };
}

function firstLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
