import { freemem, totalmem } from "node:os";

import { getCodexModelDefinition } from "../models.js";
import { deriveTurnCompletionState, getRemainingContextTokens, type RuntimeSession } from "../runtime/session.js";

const OPEN_BY_DEFAULT_LINE_CAP = 30;
const TRANSCRIPT_BLOCK_LIMIT = 80;

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

export interface OpenTuiConfigSectionView {
  title: string;
  rows: string[];
}

export interface OpenTuiLogoView {
  mode: "full" | "condensed" | "off";
  frames: string[];
  metadata: string;
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
  configSections: OpenTuiConfigSectionView[];
  logo: OpenTuiLogoView;
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
  const logo = createLogoView(session, provider, model);
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
    headerTitle: logo.mode === "off" ? "nexagent :: agent tui" : "nexagent",
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
    configSections: createConfigSections(session),
    logo,
    statusline,
  };
}

function createLogoView(session: RuntimeSession, provider: string, model: string): OpenTuiLogoView {
  const mode = session.ui?.logoMode ?? "full";
  const metadata = [
    `${provider}/${model}`,
    session.providerTransport.mode,
    session.repo.name,
    session.repo.branch ?? "detached",
    `cfg:${mode}`,
  ].join(" · ");
  if (mode === "off") {
    return { mode, frames: [], metadata };
  }
  if (mode === "condensed") {
    return {
      mode,
      frames: ["nexagent ◜◆◝", "nexagent ◠◆◡", "nexagent ◟◆◞", "nexagent ◡◆◠"],
      metadata,
    };
  }
  return {
    mode,
    frames: [
      "nexagent  ◜◆◝  terminal agent",
      "nexagent  ◠◆◡  terminal agent",
      "nexagent  ◟◆◞  terminal agent",
      "nexagent  ◡◆◠  terminal agent",
    ],
    metadata,
  };
}

function createConfigSections(session: RuntimeSession): OpenTuiConfigSectionView[] {
  const mcpStatuses = session.mcpRegistry?.statuses ?? [];
  const hydratedMcpServers = mcpStatuses.filter((status) => status.status === "hydrated");
  const failedMcpServers = mcpStatuses.filter((status) => status.status === "failed");
  const skippedMcpServers = mcpStatuses.filter((status) => status.status === "skipped");
  const mcpRows = [
    `configured ${String(session.mcpServers.length)}`,
    `hydrated ${String(hydratedMcpServers.length)}/${String(mcpStatuses.length || session.mcpServers.length)}`,
    `tools ${String(session.mcpRegistry?.tools?.length ?? 0)}`,
    failedMcpServers.length > 0
      ? `failed ${failedMcpServers.map((status) => status.name).join(", ")}`
      : "failed none",
  ];
  if (skippedMcpServers.length > 0) {
    mcpRows.push(`skipped ${skippedMcpServers.map((status) => status.name).join(", ")}`);
  }
  const lspEnabled = session.lsp?.enabled === true;
  const lspConfigured = Boolean(session.lsp?.command);
  const lspStatus = lspEnabled
    ? lspConfigured ? "ready to start" : "enabled but missing command"
    : lspConfigured ? "configured but disabled" : "disabled by default";
  return [
    {
      title: "provider",
      rows: [
        `active ${session.provider}`,
        `transport ${session.providerTransport.mode}`,
        `auth ${session.providerTransport.authGate}`,
      ],
    },
    {
      title: "ui",
      rows: [
        `logo ${session.ui?.logoMode ?? "full"}`,
        `mouse ${session.commandModes.mouseMode}`,
        `statusline ${session.commandModes.statusline ? "on" : "off"}`,
      ],
    },
    {
      title: "memory",
      rows: [
        `archivist ${session.archivist.enabled ? "on" : "off"}`,
        `storage ${session.archivist.storagePath ?? "disabled"}`,
        `retrieval ${session.archivist.retrieval.sourceCategory ?? "idle"}`,
      ],
    },
    {
      title: "mcp",
      rows: mcpRows,
    },
    {
      title: "lsp",
      rows: [
        `status ${lspStatus}`,
        `enabled ${lspEnabled ? "on" : "off"}`,
        `configured ${lspConfigured ? "yes" : "no"}`,
        `indexArchivist ${session.lsp?.indexArchivist === true ? "on" : "off"}`,
      ],
    },
    {
      title: "diagnostics",
      rows: [
        "sentry /status --sentry",
        "redaction tags-only",
      ],
    },
  ];
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
  if (event.kind === "prompt" || event.kind === "assistant" || event.kind === "tool" || event.kind === "command") {
    return true;
  }
  if (event.kind === "provider") {
    return event.status === "failed" || event.status === "blocked" || event.status === "canceled";
  }
  if (event.kind === "control" && (isDiagnosticControlEvent(event.summary) || isTraceOnlyControlEvent(event.summary))) {
    return false;
  }
  if (event.kind === "control") {
    return isUserFacingControlEvent(event);
  }
  return event.kind === "compact";
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
    .some((event) => event.kind === "prompt" || event.kind === "assistant" || event.kind === "command" || event.kind === "compact");
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
        const lines = formatToolTranscriptLines(event);
        return [createBlock({
          id: `event-tool-${String(index)}-${event.at}`,
          kind: "tool",
          label: formatToolTranscriptLabel(event.summary, event.status, event.detail),
          lines,
          collapsedByDefault: !isPatchPreviewToolEvent(event, lines),
        })];
      }
      if (event.kind === "command") {
        return [createBlock({
          id: `event-command-${String(index)}-${event.at}`,
          kind: "command",
          label: formatCommandTranscriptLabel(event.summary, event.status),
          lines: splitTranscriptLines(event.detail ?? event.summary),
          collapsedByDefault: false,
        })];
      }
      if (event.kind === "provider" || event.kind === "control" || event.kind === "compact") {
        return [createBlock({
          id: `event-${event.kind}-${String(index)}-${event.at}`,
          kind: "system",
          label: formatRuntimeTranscriptLabel(event),
          lines: formatRuntimeMessageLines(event),
          collapsedByDefault: true,
        })];
      }
      return [];
    })
    : [];

  if (blocks.length > 0) {
    return blocks.slice(-TRANSCRIPT_BLOCK_LIMIT);
  }

  return session.conversation.slice(-TRANSCRIPT_BLOCK_LIMIT).map((turn, index) => createBlock({
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

  return session.events.slice(-6).map((event) => formatTraceEventTitle(event));
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
    metrics.inputTokens += readMetricTokenCount(detail, "turn_in") || readMetricTokenCount(detail, "in");
    metrics.outputTokens += readMetricTokenCount(detail, "turn_out") || readMetricTokenCount(detail, "out");
    return metrics;
  }, { inputTokens: 0, outputTokens: 0 });
}

function readMetricTokenCount(detail: string, key: "in" | "out" | "turn_in" | "turn_out"): number {
  const match = new RegExp(`(?:^|[;\\s])${key}~(\\d+)`).exec(detail);
  return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
}

function formatSessionAge(session: RuntimeSession): string {
  const startedMs = Date.parse(session.startedAt);
  if (!Number.isFinite(startedMs)) {
    return "0s";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
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
  const failedMcpServers = session.mcpRegistry?.statuses?.filter((status) => status.status === "failed") ?? [];
  if (failedMcpServers.length > 0) {
    warnings.push({
      severity: "warning",
      type: "mcp",
      message: `MCP failed: ${failedMcpServers.map((status) => status.name).join(", ")}`,
      action: "/config or /status --sentry",
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

function isDiagnosticControlEvent(summary: string): boolean {
  return /^(?:info|warning|error)\s+[\w.-]+:\s+/i.test(summary);
}

function isTraceOnlyControlEvent(summary: string): boolean {
  return /\b(?:nudge applied|tool budget continuation cycle started|tool budget final synthesis requested|fallback returned partial result)\b/i.test(summary);
}

function isUserFacingControlEvent(event: RuntimeSession["events"][number]): boolean {
  if (event.status !== "completed" && event.status !== "failed" && event.status !== "blocked" && event.status !== "canceled") {
    return false;
  }
  return /\b(?:turn run|turn completed|turn canceled|request cancel|operation canceled)\b/i.test(event.summary);
}

function formatRuntimeTranscriptLabel(event: RuntimeSession["events"][number]): string {
  if (event.kind === "compact") {
    return `compact ${event.status}`;
  }
  if (event.kind === "provider") {
    return `provider ${event.status}`;
  }
  if (event.kind === "control" && /\bturn run\b/i.test(event.summary)) {
    return event.status === "completed" ? "turn complete" : `turn ${event.status}`;
  }
  return `${event.kind} ${event.status}`;
}

function formatStatusVerb(status: RuntimeSession["events"][number]["status"]): string {
  return status === "started" ? "started"
    : status === "queued" ? "queued"
      : status === "completed" ? "completed"
        : status === "failed" ? "failed"
          : status === "blocked" ? "blocked"
            : status === "canceled" ? "canceled"
              : status;
}

function formatTraceEventTitle(event: RuntimeSession["events"][number]): string {
  if (event.kind === "tool") {
    return formatToolTranscriptLabel(event.summary, event.status, event.detail);
  }
  const icon = formatTraceEventIcon(event);
  const noun = event.kind === "prompt" ? "User prompt"
    : event.kind === "assistant" ? "Agent response"
      : event.kind === "provider" ? "Provider"
        : event.kind === "command" ? "Command"
          : event.kind === "control" ? "Runtime"
            : event.kind === "compact" ? "Compaction"
              : event.kind;
  const summary = firstLine(event.summary);
  return `${icon} ${noun} ${formatStatusVerb(event.status)}${summary ? ` · ${summary}` : ""}`;
}

function formatTraceEventIcon(event: RuntimeSession["events"][number]): string {
  if (event.kind === "prompt") {
    return "🧭";
  }
  if (event.kind === "assistant") {
    return "💬";
  }
  if (event.kind === "provider") {
    return event.status === "failed" || event.status === "blocked" ? "⚠" : "↗";
  }
  if (event.kind === "command") {
    return "⌘";
  }
  if (event.kind === "control") {
    return event.status === "failed" || event.status === "blocked" ? "⚠" : "◆";
  }
  if (event.kind === "compact") {
    return "🧠";
  }
  return "•";
}

function formatCommandTranscriptLabel(summary: string, status: RuntimeSession["events"][number]["status"]): string {
  const normalized = firstLine(summary)
    .replace(/\s+command\s*$/i, "")
    .replace(/^command\s+/i, "");
  return `command ${normalized || status}`;
}

function formatToolTranscriptLabel(summary: string, status: RuntimeSession["events"][number]["status"], detail?: string): string {
  const normalized = firstLine(summary)
    .replace(/^tool\s+/i, "")
    .replace(/\s+(started|completed|failed|not executed)$/i, "");
  const metrics = detail ? formatMetricBadge(detail) : "";
  const displayName = formatToolDisplayName(normalized || "tool");
  const icon = formatToolIcon(normalized || displayName);
  const statusLabel = status === "started" ? "Running"
    : status === "completed" ? "Done"
      : status === "failed" ? "Failed"
        : status === "blocked" ? "Blocked"
          : status === "canceled" ? "Canceled"
            : status;
  return `${icon} ${statusLabel} ${displayName}${metrics ? ` · ${metrics}` : ""}`;
}

function formatToolTranscriptLines(event: RuntimeSession["events"][number]): string[] {
  const metrics = event.detail ? formatMetricBadge(event.detail) : "";
  const lines = [`${formatToolTranscriptLabel(event.summary, event.status, event.detail)}${metrics ? "" : ""}`];
  if (event.detail && event.detail !== event.summary) {
    lines.push(...formatToolDetailLines(event.detail));
  }
  return lines;
}

function formatToolDisplayName(toolName: string): string {
  const display: Record<string, string> = {
    read_file: "Read file",
    write_file: "Write file",
    apply_patch: "Apply patch",
    batch_edit: "Batch edit",
    preview_patch: "Preview patch",
    list_dir: "List directory",
    search_content: "Search content",
    search_files: "Search files",
    shell_command: "Run shell",
    git_status: "Git status",
    git_diff: "Git diff",
    nexsight_execute: "Nexsight",
    nexsight_index: "Index context",
    nexsight_batch: "Batch index",
    nexsight_search: "Search context",
    archivist_save: "Save memory",
    archivist_checkpoint: "Checkpoint memory",
    lsp_status: "LSP status",
    lsp_symbols: "LSP symbols",
    lsp_diagnostics: "LSP diagnostics",
  };
  return display[toolName] ?? toolName.replace(/_/g, " ");
}

function formatToolIcon(toolName: string): string {
  const normalized = toolName.toLowerCase().replace(/\s+/g, "_");
  if (normalized.includes("read_file") || normalized.includes("read")) {
    return "📖";
  }
  if (normalized.includes("write") || normalized.includes("patch") || normalized.includes("edit")) {
    return "✎";
  }
  if (normalized.includes("search") || normalized.includes("find") || normalized.includes("glob") || normalized.includes("rg")) {
    return "🔎";
  }
  if (normalized.includes("shell") || normalized.includes("command")) {
    return "⚙";
  }
  if (normalized.includes("git")) {
    return "⑂";
  }
  if (normalized.includes("nexsight") || normalized.includes("context") || normalized.includes("index")) {
    return "◇";
  }
  if (normalized.includes("archivist") || normalized.includes("memory") || normalized.includes("checkpoint")) {
    return "🧠";
  }
  if (normalized.includes("lsp")) {
    return "λ";
  }
  return "🔧";
}

function formatToolDetailLines(detail: string): string[] {
  return splitTranscriptLines(detail)
    .map((line) => firstLine(line)
      .replace(/\bread-only\b/g, "read only")
      .replace(/\bguarded\b/g, "approval guarded")
      .replace(/\blow\b/g, "low risk")
      .replace(/^duration=/, "duration ")
      .replace(/;\s*/g, " · ")
      .replace(/\bin~/g, "in ")
      .replace(/\bout~/g, "out "));
}

function isPatchPreviewToolEvent(event: RuntimeSession["events"][number], lines: readonly string[]): boolean {
  if (event.kind !== "tool" || event.status !== "completed") {
    return false;
  }
  return /\btool\s+(write_file|apply_patch|batch_edit|preview_patch)\b/i.test(event.summary)
    && lines.some((line) => /^Edited .+ \(\+\d+ -\d+\)$/.test(line));
}

function formatMetricBadge(detail: string): string {
  const duration = readMetricValue(detail, "duration");
  const inputTokens = readMetricValue(detail, "turn_in") ?? readMetricValue(detail, "in");
  const outputTokens = readMetricValue(detail, "turn_out") ?? readMetricValue(detail, "out");
  return [
    duration,
    inputTokens ? `↓ ${inputTokens}` : null,
    outputTokens ? `↑ ${outputTokens}` : null,
  ].filter((value): value is string => Boolean(value)).join(" ");
}

function readMetricValue(detail: string, key: "duration" | "in" | "out" | "turn_in" | "turn_out"): string | null {
  const separator = key === "duration" ? "=" : "~";
  const match = new RegExp(`(?:^|[;\\s])${key}${separator}([^;\\s]+)`).exec(detail);
  return match?.[1] ?? null;
}

function formatRuntimeMessageLines(event: RuntimeSession["events"][number]): string[] {
  const metrics = event.detail ? formatMetricBadge(event.detail) : "";
  const label = formatRuntimeTranscriptLabel(event);
  const summary = event.kind === "control" && /\bturn run\b/i.test(event.summary)
    ? label
    : firstLine(event.summary);
  const lines = [`${summary}${metrics ? ` · ${metrics}` : ""}`];
  if (event.detail && event.detail !== event.summary) {
    lines.push(...splitTranscriptLines(event.detail));
  }
  return lines;
}

function formatTraceEventLines(event: RuntimeSession["events"][number]): string[] {
  const lines = [
    formatTraceEventTitle(event),
    `  at ${event.at} · kind ${event.kind} · status ${event.status}`,
  ];
  if (event.kind === "command") {
    lines.push("  output rendered in chat; command payload hidden from trace");
    return lines;
  }
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
