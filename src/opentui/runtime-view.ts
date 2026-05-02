import { freemem, totalmem } from "node:os";

import { getCodexModelDefinition } from "../models.js";
import { deriveTurnCompletionState, getRemainingContextTokens, type RuntimeSession } from "../runtime/session.js";

const OPEN_BY_DEFAULT_LINE_CAP = 30;

export type OpenTuiTranscriptBlockKind = "user" | "assistant" | "skill" | "command" | "tool" | "result" | "trace" | "system";

export interface OpenTuiTranscriptBlock {
  id: string;
  kind: OpenTuiTranscriptBlockKind;
  label: string;
  summaryLines: string[];
  detailLines: string[];
  collapsedByDefault: boolean;
}

export interface OpenTuiCockpitApprovalView {
  mode: string;
  pendingTool: string | null;
  lastDecision: string;
  hints: string[];
}

export interface OpenTuiCockpitWarningRow {
  severity: "info" | "warning" | "blocking";
  type: string;
  message: string;
  action: string;
}

export interface OpenTuiCockpitLadderView {
  intent: string;
  plan: string;
  act: string;
  result: string;
}

export interface OpenTuiCockpitMemoryView {
  active: string;
  retrieved: string;
  checkpoints: string;
}

export interface OpenTuiCockpitView {
  approval: OpenTuiCockpitApprovalView;
  warnings: OpenTuiCockpitWarningRow[];
  ladder: OpenTuiCockpitLadderView;
  overrideHints: string[];
  memory: OpenTuiCockpitMemoryView;
  risk: string;
}

export interface OpenTuiStatuslineView {
  model: string;
  branch: string;
  repoName: string;
  sessionAge: string;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  contextUsed: number;
  contextWindow: number;
  contextPercent: number;
  lastInputTokens: number;
  lastOutputTokens: number;
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
  cockpit: OpenTuiCockpitView;
  statusline: OpenTuiStatuslineView;
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
  const cockpit = createCockpitView(session, approval);
  const statusline = createStatuslineView(session, model);
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
    headerTitle: "nexagent :: agent tui",
    providerLabel: `${provider}/${model}`,
    sessionLabel: `session ${session.id} | turns ${String(session.telemetry.turnCount)}`,
    statusLabel: `${session.action.status} - ${session.action.detail}`,
    cwdLabel: session.cwd,
    transcriptLines,
    transcriptBlocks,
    composerHint: "",
    footerLabel: `approval ${approval} | tools ${session.toolPolicy.mode}`,
    traceCollapsedLabel: "trace closed - Ctrl+T expand",
    traceExpandedLabel: "trace open - Ctrl+T collapse",
    traceSummaryLines,
    traceDetailLines,
    traceBlocks,
    cockpit,
    statusline,
  };
}

export function createLocalOutputBlock(
  id: string,
  lines: string[],
  options: { kind?: OpenTuiTranscriptBlockKind; label?: string } = {},
): OpenTuiTranscriptBlock {
  return createBlock({
    id,
    kind: options.kind ?? "command",
    label: options.label ?? "command",
    lines,
    collapsedByDefault: false,
  });
}

function isTranscriptEvent(event: RuntimeSession["events"][number]): boolean {
  if (event.kind === "prompt" || event.kind === "assistant" || event.kind === "tool") {
    return true;
  }
  if (event.kind === "provider") {
    return event.status === "failed" || event.status === "blocked" || event.status === "canceled";
  }
  return event.kind === "control" || event.kind === "compact";
}

function createTranscriptLines(session: RuntimeSession): string[] {
  const lines = createTranscriptBlocks(session)
    .slice(-8)
    .map((block) => `${block.label}: ${firstLine(block.detailLines.join(" "))}`)
    .filter((line) => line.trim().length > 0);

  if (lines.length > 0) {
    return lines;
  }
  return [];
}

function createTranscriptBlocks(session: RuntimeSession): OpenTuiTranscriptBlock[] {
  const conversationUsers = session.conversation.filter((turn) => turn.role === "user");
  const conversationAssistants = session.conversation.filter((turn) => turn.role === "assistant");
  let promptIndex = 0;
  let assistantIndex = 0;

  const transcriptEvents = session.events
    .filter((event) => isTranscriptEvent(event));
  const hasVisibleTranscriptEvent = transcriptEvents
    .some((event) => event.kind === "prompt" || event.kind === "assistant" || event.kind === "compact");
  const blocks = hasVisibleTranscriptEvent
    ? transcriptEvents.flatMap((event, index) => {
      if (event.kind === "prompt") {
        const conversationTurn = conversationUsers[promptIndex];
        promptIndex += 1;
        const promptLines = splitTranscriptLines(conversationTurn?.content ?? event.detail ?? event.summary);
        const skillLabel = parseSkillPromptLabel(promptLines[0] ?? event.detail ?? event.summary);
        return [createBlock({
          id: `event-prompt-${String(index)}-${event.at}`,
          kind: skillLabel ? "skill" : "user",
          label: skillLabel ?? "you",
          lines: skillLabel ? [skillLabel] : promptLines,
          collapsedByDefault: Boolean(skillLabel),
          forceCollapsed: Boolean(skillLabel),
        })];
      }
      if (event.kind === "assistant") {
        const conversationTurn = conversationAssistants[assistantIndex];
        assistantIndex += 1;
        return [createBlock({
          id: `event-assistant-${String(index)}-${event.at}`,
          kind: "assistant",
          label: "agent",
          lines: splitTranscriptLines(conversationTurn?.content ?? event.detail ?? event.summary),
          collapsedByDefault: false,
        })];
      }
      if (event.kind === "tool") {
        return [createBlock({
          id: `event-tool-${String(index)}-${event.at}`,
          kind: "tool",
          label: formatToolTranscriptLabel(event.summary, event.status, event.detail),
          lines: formatToolTranscriptLines(event),
          collapsedByDefault: true,
        })];
      }
      if (event.kind === "provider" || event.kind === "control" || event.kind === "compact") {
        return [createBlock({
          id: `event-${event.kind}-${String(index)}-${event.at}`,
          kind: "system",
          label: `${event.kind} ${event.status}`,
          lines: formatRuntimeMessageLines(event),
          collapsedByDefault: true,
        })];
      }
      return [];
    })
    : [];

  if (blocks.length > 0) {
    return blocks.slice(-16);
  }

  return session.conversation.slice(-16).map((turn, index) => createBlock({
    id: `conversation-${String(index)}`,
    kind: turn.role === "user" ? "user" : "assistant",
    label: turn.role === "user" ? "you" : "agent",
    lines: splitTranscriptLines(turn.content),
    collapsedByDefault: false,
  }));
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

  return session.events.slice(-12).flatMap((event) => formatTraceEventLines(event));
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

  const promptIndex = [...session.events].map((event) => event.kind).lastIndexOf("prompt");
  const turnEvents = promptIndex >= 0 ? session.events.slice(promptIndex) : session.events.slice(-12);
  const firstEvent = turnEvents[0] ?? session.events[0];
  return [createBlock({
    id: `trace-turn-${firstEvent?.at ?? "session"}`,
    kind: "trace",
    label: "turn trace",
    lines: turnEvents.flatMap((event) => formatTraceEventLines(event)),
    collapsedByDefault: true,
    preserveLines: true,
  })];
}

function createStatuslineView(session: RuntimeSession, model: string): OpenTuiStatuslineView {
  const contextWindow = getCodexModelDefinition(model)?.contextWindow ?? 128000;
  const remainingContext = getRemainingContextTokens(session);
  const contextUsed = Math.max(0, contextWindow - remainingContext);
  const contextPercent = contextWindow > 0 ? Math.round((contextUsed / contextWindow) * 100) : 0;
  const memoryTotalBytes = totalmem();
  const memoryUsedBytes = Math.max(0, memoryTotalBytes - freemem());
  const turnMetrics = collectCurrentTurnTokenMetrics(session);
  return {
    model,
    branch: session.repo.branch ?? "detached",
    repoName: session.repo.name,
    sessionAge: formatSessionAge(session),
    memoryUsedBytes,
    memoryTotalBytes,
    contextUsed,
    contextWindow,
    contextPercent,
    lastInputTokens: turnMetrics.inputTokens || session.telemetry.lastInputTokens,
    lastOutputTokens: turnMetrics.outputTokens || session.telemetry.lastOutputTokens,
  };
}

function collectCurrentTurnTokenMetrics(session: RuntimeSession): { inputTokens: number; outputTokens: number } {
  const promptIndex = [...session.events].map((event) => event.kind).lastIndexOf("prompt");
  const events = promptIndex >= 0 ? session.events.slice(promptIndex) : session.events;
  return events.reduce((metrics, event) => {
    const detail = event.detail ?? "";
    metrics.inputTokens += readMetricTokenCount(detail, "in");
    metrics.outputTokens += readMetricTokenCount(detail, "out");
    return metrics;
  }, { inputTokens: 0, outputTokens: 0 });
}

function readMetricTokenCount(detail: string, key: "in" | "out"): number {
  const match = new RegExp(`(?:^|[;\\s])${key}~(\\d+)`).exec(detail);
  return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
}

function formatSessionAge(session: RuntimeSession): string {
  const latestAt = session.events[session.events.length - 1]?.at ?? session.startedAt;
  const startedMs = Date.parse(session.startedAt);
  const latestMs = Date.parse(latestAt);
  if (!Number.isFinite(startedMs) || !Number.isFinite(latestMs) || latestMs <= startedMs) {
    return "0s";
  }
  const seconds = Math.floor((latestMs - startedMs) / 1000);
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m`;
  }
  return `${String(Math.floor(minutes / 60))}h`;
}

function createCockpitView(session: RuntimeSession, approval: string): OpenTuiCockpitView {
  const turn = deriveTurnCompletionState(session);
  return {
    approval: {
      mode: approval,
      pendingTool: session.operationControls.pendingApproval?.tool ?? null,
      lastDecision: session.operationControls.lastDecision ?? "none",
      hints: ["/approval approve", "/approval reject"],
    },
    warnings: createCockpitWarnings(session),
    ladder: createCockpitLadder(session, turn.objective),
    overrideHints: ["Ctrl+Q quit", "/cancel", "/steer <message>", "/approval status"],
    memory: {
      active: session.compaction.summary ? "session summary active" : "session context active",
      retrieved: session.archivist.retrieval.used
        ? `${session.archivist.retrieval.sourceCategory ?? "retrieved"} · ${String(session.archivist.retrieval.matchCount)} match(es)`
        : "retrieved context idle",
      checkpoints: session.archivist.writes.used
        ? `${session.archivist.writes.action ?? "saved"} · ${String(session.archivist.writes.entryCount)} entr${session.archivist.writes.entryCount === 1 ? "y" : "ies"}`
        : formatMemoryDiagnostics(session),
    },
    risk: turn.blocker ? `blocking · ${turn.blocker}` : `${turn.state} · approval ${approval}`,
  };
}

function formatMemoryDiagnostics(session: RuntimeSession): string {
  const diagnostics = session.archivist.diagnostics;
  if (!diagnostics) {
    return "checkpoints idle";
  }
  return `memory signal · dup ${String(diagnostics.duplicateSuspectCount)} · stale ${String(diagnostics.staleSignalCount)}`;
}

function createCockpitWarnings(session: RuntimeSession): OpenTuiCockpitWarningRow[] {
  const warnings: OpenTuiCockpitWarningRow[] = [];
  if (session.operationControls.pendingApproval) {
    warnings.push({
      severity: "blocking",
      type: "approval",
      message: `waiting approval: ${session.operationControls.pendingApproval.tool}`,
      action: "/approval approve or /approval reject",
    });
  }
  if (session.operationControls.cancelRequested) {
    warnings.push({
      severity: "warning",
      type: "cancel",
      message: "cancel requested",
      action: "wait for provider/tool boundary",
    });
  }
  if (session.action.status === "error") {
    warnings.push({
      severity: "blocking",
      type: "error",
      message: session.action.detail,
      action: "inspect trace or retry after fix",
    });
  }
  if (session.operationControls.steerMessage) {
    warnings.push({
      severity: "info",
      type: "steer",
      message: `steer ${session.operationControls.steerState ?? "queued"}`,
      action: "applies at next model/tool boundary",
    });
  }
  return warnings;
}

function createCockpitLadder(session: RuntimeSession, fallbackObjective: string): OpenTuiCockpitLadderView {
  const latestPrompt = latestEventSummary(session, (event) => event.kind === "prompt");
  const latestActive = latestEventSummary(session, (event) => event.status === "started" || event.status === "queued");
  const latestAction = latestEventSummary(session, (event) => event.kind === "tool" || event.kind === "command" || event.kind === "provider");
  const latestResult = latestEventSummary(session, (event) => event.status === "completed" || event.status === "failed" || event.kind === "assistant");
  return {
    intent: latestPrompt ?? fallbackObjective,
    plan: session.action.pending ? session.action.detail : "ready",
    act: latestAction ?? latestActive ?? "idle",
    result: latestResult ?? (session.action.status === "error" ? session.action.detail : "pending"),
  };
}

function latestEventSummary(
  session: RuntimeSession,
  predicate: (event: RuntimeSession["events"][number]) => boolean,
): string | null {
  const event = [...session.events].reverse().find(predicate);
  return event ? firstLine(event.summary) : null;
}

function createBlock(options: {
  id: string;
  kind: OpenTuiTranscriptBlockKind;
  label: string;
  lines: string[];
  collapsedByDefault: boolean;
  preserveLines?: boolean;
  forceCollapsed?: boolean;
}): OpenTuiTranscriptBlock {
  const detailLines = options.lines
    .map((line) => options.preserveLines ? line.trimEnd() : firstLine(line))
    .filter((line) => line.length > 0);
  const longOutput = detailLines.length > OPEN_BY_DEFAULT_LINE_CAP;
  const summaryLines = longOutput
    ? [
      ...detailLines.slice(0, OPEN_BY_DEFAULT_LINE_CAP),
      `... truncated ${String(detailLines.length - OPEN_BY_DEFAULT_LINE_CAP)} more lines; expand for full output`,
    ]
    : options.collapsedByDefault && detailLines.length > 1
      ? [
        detailLines[0] ?? options.label,
        `... ${String(detailLines.length - 1)} more line${detailLines.length === 2 ? "" : "s"}; expand for full output`,
      ]
      : detailLines;
  const collapsedByDefault = longOutput || Boolean(options.forceCollapsed) || (options.collapsedByDefault && detailLines.length > 1);
  return {
    id: options.id,
    kind: options.kind,
    label: options.label,
    summaryLines: summaryLines.length > 0 ? summaryLines : [options.label],
    detailLines,
    collapsedByDefault,
  };
}

function firstLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseSkillPromptLabel(value: string): string | null {
  const normalized = firstLine(value);
  return normalized.match(/^skill\s*->\s*[\w:.-]+(?:\s+.+)?$/i) ? normalized : null;
}

function formatToolTranscriptLabel(summary: string, status: RuntimeSession["events"][number]["status"], detail?: string): string {
  const normalized = firstLine(summary)
    .replace(/^tool\s+/i, "")
    .replace(/\s+(started|completed|failed|not executed)$/i, "");
  const metrics = detail ? formatMetricBadge(detail) : "";
  return `tool ${normalized || status}${metrics ? ` · ${metrics}` : ""}`;
}

function formatToolTranscriptLines(event: RuntimeSession["events"][number]): string[] {
  const metrics = event.detail ? formatMetricBadge(event.detail) : "";
  const lines = [`${event.status} · ${firstLine(event.summary)}${metrics ? ` · ${metrics}` : ""}`];
  if (event.detail && event.detail !== event.summary) {
    lines.push(...splitTranscriptLines(event.detail));
  }
  return lines;
}

function formatMetricBadge(detail: string): string {
  const duration = readMetricValue(detail, "duration");
  const inputTokens = readMetricValue(detail, "in");
  const outputTokens = readMetricValue(detail, "out");
  return [
    duration,
    inputTokens ? `↓ ${inputTokens}` : null,
    outputTokens ? `↑ ${outputTokens}` : null,
  ].filter((value): value is string => Boolean(value)).join(" ");
}

function readMetricValue(detail: string, key: "duration" | "in" | "out"): string | null {
  const match = new RegExp(`(?:^|[;\\s])${key}${key === "duration" ? "=" : "~"}([^;\\s]+)`).exec(detail);
  return match?.[1] ?? null;
}

function formatRuntimeMessageLines(event: RuntimeSession["events"][number]): string[] {
  const lines = [`${event.status} · ${firstLine(event.summary)}`];
  if (event.detail && event.detail !== event.summary) {
    lines.push(...splitTranscriptLines(event.detail));
  }
  return lines;
}

function formatTraceEventLines(event: RuntimeSession["events"][number]): string[] {
  const lines = [`${event.at} | ${event.kind} | ${event.status} | ${event.summary}`];
  if (event.detail && event.detail !== event.summary) {
    lines.push(...splitTranscriptLines(event.detail).map((line) => `  ${line}`));
  }
  return lines;
}

function splitTranscriptLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
}
