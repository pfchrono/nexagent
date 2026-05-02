import { createRuntimeState, type RuntimeBootstrap, type RuntimeState } from "./bootstrap.js";
import { buildPromptV2, summarizePromptV2 } from "./prompt-v2.js";
import type { PersistedTransportMode } from "./persistence.js";
import { hasCodexAuthJsonCredentialsSync } from "../provider/codex-chatgpt-http.js";
import { getCodexModelDefinition } from "../models.js";
import { getTransportProviderDefinition } from "../provider/registry.js";
import { createRuntimeDebugState, type RuntimeDebugState } from "./debug.js";

export type RuntimeActionStatus = "ready" | "running" | "error";

export interface RuntimeActionState {
  status: RuntimeActionStatus;
  detail: string;
  pending: boolean;
  lastActivity: string | null;
}

export type RuntimeTurnCompletionState = "blocked" | "pending" | "running" | "finished";

export interface RuntimeTurnCompletionSummary {
  state: RuntimeTurnCompletionState;
  objective: string;
  blocker: string | null;
  unverified: boolean;
}

export interface RuntimeTurnTelemetryState {
  turnCount: number;
  lastInputTokens: number;
  lastOutputTokens: number;
}

export type RuntimeEventKind = "system" | "prompt" | "provider" | "assistant" | "tool" | "control" | "compact" | "command";
export type RuntimeEventStatus = "info" | "started" | "completed" | "failed" | "queued" | "applied" | "blocked" | "canceled";

export interface RuntimeEvent {
  at: string;
  kind: RuntimeEventKind;
  status: RuntimeEventStatus;
  summary: string;
  detail?: string;
}

export interface RuntimeConversationTurn {
  role: "user" | "assistant";
  content: string;
  tokens: number;
}

export interface RuntimeCompactionSnapshot {
  styles: string[];
  provider: string;
  transport: string;
  turnCount: number;
  queuedUserMessage: string | null;
}

export interface RuntimeCompactionState {
  enabled?: boolean;
  thresholdPercent: number;
  modelThresholdOverrides: Record<string, number>;
  preserveTurns?: number;
  queuedUserMessage: string | null;
  summary: string | null;
  snapshot: RuntimeCompactionSnapshot | null;
  status: "idle" | "compacting";
  lastTrigger: "auto" | "manual" | null;
  lastCompactedAt: string | null;
  compactCount: number;
  normalTurnSteering: "boundary-only";
  compactTurnSteering: "blocked";
}

export type RuntimeSteerStatus = "queued" | "deferred" | "applied" | "rejected";

export interface RuntimeSteerHistoryEntry {
  at: string;
  status: RuntimeSteerStatus;
  message: string;
  detail: string | null;
}

export interface RuntimeApprovalRequest {
  tool: string;
  risk: "guarded";
  summary: string;
}

export interface RuntimeOperationControlsState {
  requireApprovalForGuarded: boolean;
  yoloMode: boolean;
  pendingApproval: RuntimeApprovalRequest | null;
  lastDecision: "approved" | "rejected" | "canceled" | null;
  cancelRequested: boolean;
  activeAbortController: AbortController | null;
  steerMessage: string | null;
  steerState: RuntimeSteerStatus | null;
  lastAppliedSteer: string | null;
  steerHistory: RuntimeSteerHistoryEntry[];
}

export interface RuntimeSession extends RuntimeState {
  id: string;
  startedAt: string;
  action: RuntimeActionState;
  telemetry: RuntimeTurnTelemetryState;
  activeSkill?: {
    name: string;
    source: string;
    path: string;
    args: string;
    content: string;
  };
  events: RuntimeEvent[];
  conversation: RuntimeConversationTurn[];
  compaction: RuntimeCompactionState;
  operationControls: RuntimeOperationControlsState;
  debug?: RuntimeDebugState;
}

export type RuntimeSessionListener = () => void;

const runtimeSessionListeners = new WeakMap<RuntimeSession, Set<RuntimeSessionListener>>();
const runtimeSessionRevisions = new WeakMap<RuntimeSession, number>();

export function subscribeRuntimeSession(session: RuntimeSession, listener: RuntimeSessionListener): () => void {
  const listeners = runtimeSessionListeners.get(session) ?? new Set<RuntimeSessionListener>();
  listeners.add(listener);
  runtimeSessionListeners.set(session, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      runtimeSessionListeners.delete(session);
    }
  };
}

export function getRuntimeSessionRevision(session: RuntimeSession): number {
  return runtimeSessionRevisions.get(session) ?? 0;
}

export function createRuntimeSession(runtime: RuntimeBootstrap): RuntimeSession {
  const runtimeState = createRuntimeState(runtime);
  const operationControls = createRuntimeOperationControlsState();
  operationControls.requireApprovalForGuarded = runtimeState.operationDefaults.requireApprovalForGuarded;

  return {
    id: createSessionId(),
    startedAt: new Date().toISOString(),
    action: createRuntimeActionState(),
    telemetry: createRuntimeTurnTelemetryState(),
    events: createRuntimeEventLog(),
    conversation: [],
    compaction: createRuntimeCompactionState(runtime.config.compaction),
    operationControls,
    debug: createRuntimeDebugState(),
    ...runtimeState,
  };
}

export function createRuntimeActionState(): RuntimeActionState {
  return {
    status: "ready",
    detail: "runtime baseline",
    pending: false,
    lastActivity: null,
  };
}

export function createRuntimeTurnTelemetryState(): RuntimeTurnTelemetryState {
  return {
    turnCount: 0,
    lastInputTokens: 0,
    lastOutputTokens: 0,
  };
}

export function createRuntimeEventLog(): RuntimeEvent[] {
  return [{
    at: new Date().toISOString(),
    kind: "system",
    status: "info",
    summary: "runtime baseline ready",
    detail: "session created",
  }];
}

export function createRuntimeCompactionState(settings?: RuntimeBootstrap["config"]["compaction"]): RuntimeCompactionState {
  return {
    enabled: settings?.enabled ?? true,
    thresholdPercent: settings?.thresholdPercent ?? 0.5,
    modelThresholdOverrides: settings?.modelThresholdOverrides ?? {},
    preserveTurns: settings?.preserveTurns ?? 4,
    queuedUserMessage: null,
    summary: null,
    snapshot: null,
    status: "idle",
    lastTrigger: null,
    lastCompactedAt: null,
    compactCount: 0,
    normalTurnSteering: "boundary-only",
    compactTurnSteering: "blocked",
  };
}

export function createRuntimeOperationControlsState(): RuntimeOperationControlsState {
  return {
    requireApprovalForGuarded: false,
    yoloMode: false,
    pendingApproval: null,
    lastDecision: null,
    cancelRequested: false,
    activeAbortController: null,
    steerMessage: null,
    steerState: null,
    lastAppliedSteer: null,
    steerHistory: [],
  };
}

export function applyYoloMode(session: RuntimeSession): void {
  session.operationControls.yoloMode = true;
  session.operationControls.requireApprovalForGuarded = false;
}

export function setRuntimeAction(
  session: RuntimeSession,
  status: RuntimeActionStatus,
  detail: string,
  activityAt = new Date().toISOString(),
): void {
  session.action.status = status;
  session.action.detail = detail;
  session.action.pending = status === "running";
  session.action.lastActivity = activityAt;
  notifyRuntimeSessionChanged(session);
}

export function deriveTurnCompletionState(session: RuntimeSession): RuntimeTurnCompletionSummary {
  if (session.operationControls.pendingApproval) {
    return {
      state: "blocked",
      objective: `awaiting approval for ${session.operationControls.pendingApproval.tool}`,
      blocker: `pending approval: ${session.operationControls.pendingApproval.tool}`,
      unverified: true,
    };
  }

  if (session.operationControls.cancelRequested) {
    return {
      state: "blocked",
      objective: "cancel requested by operator",
      blocker: "cancel requested",
      unverified: true,
    };
  }

  if (session.operationControls.lastDecision === "rejected") {
    return {
      state: "blocked",
      objective: "tool execution denied",
      blocker: "approval rejected",
      unverified: true,
    };
  }

  if (session.action.status === "error") {
    return {
      state: "blocked",
      objective: session.action.detail,
      blocker: session.action.detail,
      unverified: true,
    };
  }

  if (session.action.status === "running") {
    return {
      state: "running",
      objective: session.action.detail,
      blocker: null,
      unverified: true,
    };
  }

  const lastPromptIndex = [...session.events].map((event) => event.kind).lastIndexOf("prompt");
  const events = lastPromptIndex >= 0
    ? session.events.slice(lastPromptIndex)
    : [];
  const hasAssistantResponse = events.some((event) => event.kind === "assistant" && event.status === "completed");
  const hasQueuedToolWork = events.some((event) => ["started", "queued"].includes(event.status) && event.kind === "tool");

  if (lastPromptIndex >= 0 && hasAssistantResponse && !hasQueuedToolWork) {
    return {
      state: "finished",
      objective: "assistant response ready",
      blocker: null,
      unverified: false,
    };
  }

  return {
    state: "pending",
    objective: lastPromptIndex >= 0 ? "awaiting verified completion" : "idle",
    blocker: null,
    unverified: true,
  };
}

export function isTurnUnverified(session: RuntimeSession): boolean {
  return deriveTurnCompletionState(session).state !== "finished";
}

export function recordRuntimeEvent(
  session: RuntimeSession,
  event: Omit<RuntimeEvent, "at"> & { at?: string },
): RuntimeEvent {
  const entry: RuntimeEvent = {
    at: event.at ?? new Date().toISOString(),
    kind: event.kind,
    status: event.status,
    summary: event.summary,
    ...(event.detail ? { detail: event.detail } : {}),
  };
  session.events.push(entry);
  if (session.events.length > 200) {
    session.events.splice(0, session.events.length - 200);
  }
  notifyRuntimeSessionChanged(session);
  return entry;
}

export function recordTurnTelemetry(session: RuntimeSession, input: string, output: string): void {
  const turnMetrics = collectCurrentTurnTokenMetrics(session);
  session.telemetry.turnCount += 1;
  session.telemetry.lastInputTokens = turnMetrics.inputTokens || estimateTokenCount(input);
  session.telemetry.lastOutputTokens = turnMetrics.outputTokens || estimateTokenCount(output);
  notifyRuntimeSessionChanged(session);
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

export function recordConversationTurn(session: RuntimeSession, role: RuntimeConversationTurn["role"], content: string): void {
  session.conversation.push({
    role,
    content,
    tokens: estimateTokenCount(content),
  });
  notifyRuntimeSessionChanged(session);
}

function notifyRuntimeSessionChanged(session: RuntimeSession): void {
  runtimeSessionRevisions.set(session, getRuntimeSessionRevision(session) + 1);
  const listeners = runtimeSessionListeners.get(session);
  if (!listeners) {
    return;
  }
  for (const listener of [...listeners]) {
    listener();
  }
}

export function maybeCompactConversation(session: RuntimeSession, nextUserMessage: string): {
  compacted: boolean;
  trigger: "auto" | "manual" | null;
  beforeTokens: number;
  afterTokens: number;
} {
  const beforeTokens = estimateConversationTokens(session, nextUserMessage);
  const thresholdTokens = getCompactionThresholdTokens(session);

  if (session.compaction.enabled === false) {
    return {
      compacted: false,
      trigger: null,
      beforeTokens,
      afterTokens: beforeTokens,
    };
  }

  if (beforeTokens <= thresholdTokens || session.conversation.length < 6) {
    return {
      compacted: false,
      trigger: null,
      beforeTokens,
      afterTokens: beforeTokens,
    };
  }

  const afterTokens = compactConversation(session, "auto", nextUserMessage);
  return {
    compacted: true,
    trigger: "auto",
    beforeTokens,
    afterTokens,
  };
}

export function compactConversation(session: RuntimeSession, trigger: "auto" | "manual", queuedUserMessage: string | null = null): number {
  const beforeTokens = estimateConversationTokens(session);
  session.compaction.status = "compacting";
  session.compaction.queuedUserMessage = queuedUserMessage;
  session.compaction.lastTrigger = trigger;
  recordRuntimeEvent(session, {
    kind: "compact",
    status: "started",
    summary: `${trigger} compaction started`,
    detail: queuedUserMessage ? `queued user message preserved` : undefined,
  });
  if (queuedUserMessage) {
    recordRuntimeEvent(session, {
      kind: "compact",
      status: "queued",
      summary: "compaction queued intent preserved",
      detail: "queued user message preserved",
    });
  }

  const preserveCount = Math.min(session.compaction.preserveTurns ?? 4, session.conversation.length);
  const preservedTurns = preserveCount > 0 ? session.conversation.slice(-preserveCount) : [];
  const compactedTurns = session.conversation.slice(0, Math.max(0, session.conversation.length - preserveCount));

  if (compactedTurns.length > 0) {
    const summaryParts = [
      session.compaction.summary?.trim(),
      summarizeConversationTurns(compactedTurns),
    ].filter((value): value is string => Boolean(value && value.trim().length > 0));
    session.compaction.summary = summaryParts.join(" ");
  }

  session.compaction.snapshot = {
    styles: [
      ...(session.commandModes.deadpoolMode ? ["deadpool"] : []),
      ...(session.commandModes.cavemanMode ? ["caveman"] : []),
    ],
    provider: session.provider,
    transport: session.providerTransport.mode,
    turnCount: session.telemetry.turnCount,
    queuedUserMessage,
  };
  session.compaction.lastCompactedAt = new Date().toISOString();
  session.compaction.compactCount += 1;
  session.conversation = preservedTurns;
  session.compaction.queuedUserMessage = null;
  session.compaction.status = "idle";
  const afterTokens = estimateConversationTokens(session);
  recordRuntimeEvent(session, {
    kind: "compact",
    status: "completed",
    summary: `${trigger} compaction completed`,
    detail: `summary=${session.compaction.summary ? "present" : "none"} · turns=${String(session.conversation.length)} · tokens=${String(beforeTokens)}->${String(afterTokens)}`,
  });
  return afterTokens;
}

export function applyProviderSelection(session: RuntimeSession, provider: string): void {
  session.provider = provider;
  session.providerRouting.modelSelection.activeProvider = provider;
  session.providerTransport.activeProvider = provider;
  refreshInstructionState(session);
}

export function applyTransportMode(session: RuntimeSession, mode: PersistedTransportMode): void {
  const definition = getTransportProviderDefinition(session.providerRegistry, mode);
  session.providerTransport.mode = mode;

  if (mode === "codex-http") {
    session.providerTransport.executor = definition?.executor ?? "fetch";
    session.providerTransport.adapter = definition?.adapter ?? "codex-chatgpt-http";
    session.providerTransport.authSource = definition?.authSource ?? "codex-auth-json";
    session.providerTransport.authGate = hasCodexAuthJsonCredentialsSync() ? "ready" : "missing";
    session.providerTransport.openaiBaseUrl = session.providerRouting.transport.openaiBaseUrl ?? definition?.baseUrl ?? "https://chatgpt.com/backend-api/codex";
    return;
  }

  if (mode === "http-responses") {
    session.providerTransport.executor = definition?.executor ?? "fetch";
    session.providerTransport.adapter = definition?.adapter ?? "openai-http-responses";
    session.providerTransport.authSource = definition?.authSource ?? "openai-api-key";
    session.providerTransport.authGate = process.env.OPENAI_API_KEY?.trim() ? "ready" : "missing";
    session.providerTransport.openaiBaseUrl = session.providerRouting.transport.openaiBaseUrl ?? definition?.baseUrl ?? "https://api.openai.com/v1";
    return;
  }

  session.providerTransport.executor = definition?.executor ?? "codex";
  session.providerTransport.adapter = definition?.adapter ?? "codex-cli-exec";
  session.providerTransport.authSource = definition?.authSource ?? "codex-login";
  session.providerTransport.authGate = session.auth.loggedIn ? "ready" : "missing";
}

export function syncRuntimeSession(session: RuntimeSession, runtime: RuntimeBootstrap): void {
  const nextState = createRuntimeState(runtime);
  const selectedProvider = session.providerRouting.modelSelection.activeProvider;
  const selectedTransportMode = session.providerTransport.mode;
  const conversation = session.conversation;
  const activeSkill = session.activeSkill;
  const compaction = session.compaction;
  const telemetry = session.telemetry;
  const action = session.action;
  const events = session.events;
  const operationControls = session.operationControls;

  Object.assign(session, nextState);
  session.action = action;
  session.telemetry = telemetry;
  session.events = events;
  session.conversation = conversation;
  session.activeSkill = activeSkill;
  session.compaction = compaction;
  session.operationControls = operationControls;

  if (selectedProvider && isConfiguredProvider(session, selectedProvider)) {
    applyProviderSelection(session, selectedProvider);
  }

  applyTransportMode(session, selectedTransportMode);
}

export function queueOperatorSteer(session: RuntimeSession, message: string): void {
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }

  if (session.operationControls.steerMessage) {
    appendSteerHistory(session, {
      status: "rejected",
      message: session.operationControls.steerMessage,
      detail: "superseded by newer steer",
    });
  }

  session.operationControls.steerMessage = trimmed;
  session.operationControls.steerState = session.action.pending ? "deferred" : "queued";
  appendSteerHistory(session, {
    status: session.operationControls.steerState,
    message: trimmed,
    detail: session.action.pending ? "waiting for next tool/model boundary" : "ready for next tool/model boundary",
  });

  if (session.operationControls.steerMessage) {
    recordRuntimeEvent(session, {
      kind: "control",
      status: "queued",
      summary: `operator steer ${session.operationControls.steerState}`,
      detail: session.operationControls.steerMessage,
    });
  }
}

export function consumeOperatorSteer(session: RuntimeSession, boundary = "next tool/model boundary"): string | null {
  const value = session.operationControls.steerMessage;
  session.operationControls.steerMessage = null;
  if (value) {
    session.operationControls.steerState = "applied";
    session.operationControls.lastAppliedSteer = value;
    appendSteerHistory(session, {
      status: "applied",
      message: value,
      detail: boundary,
    });
    recordRuntimeEvent(session, {
      kind: "control",
      status: "applied",
      summary: "operator steer applied",
      detail: `${value} · ${boundary}`,
    });
  }
  return value;
}

function appendSteerHistory(
  session: RuntimeSession,
  entry: Omit<RuntimeSteerHistoryEntry, "at"> & { at?: string },
): void {
  session.operationControls.steerHistory.push({
    at: entry.at ?? new Date().toISOString(),
    status: entry.status,
    message: entry.message,
    detail: entry.detail ?? null,
  });
  if (session.operationControls.steerHistory.length > 8) {
    session.operationControls.steerHistory.splice(0, session.operationControls.steerHistory.length - 8);
  }
}

export function refreshInstructionState(session: RuntimeSession): void {
  session.promptV2Summary = summarizePromptV2(buildPromptV2({ session, prompt: "" }).sections);
  session.providerTransport.authGate = session.providerTransport.mode === "http-responses"
    ? (process.env.OPENAI_API_KEY?.trim() ? "ready" : "missing")
    : session.providerTransport.mode === "codex-http"
      ? (hasCodexAuthJsonCredentialsSync() ? "ready" : "missing")
    : (session.auth.loggedIn ? "ready" : "missing");
}

function isConfiguredProvider(session: RuntimeSession, provider: string): boolean {
  return provider === session.provider || provider in session.providerRouting.modelSelection.configuredModels;
}

function createSessionId(): string {
  return `session_${Date.now().toString(36)}`;
}

export function estimateTokenCount(value: string): number {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return 0;
  }
  return Math.max(1, Math.ceil(normalized.length / 4));
}

export function estimateConversationTokens(session: RuntimeSession, nextUserMessage = ""): number {
  const conversationTokens = session.conversation.reduce((sum, turn) => sum + turn.tokens, 0);
  const summaryTokens = estimateTokenCount(session.compaction.summary ?? "");
  const queuedTokens = estimateTokenCount(session.compaction.queuedUserMessage ?? nextUserMessage);
  return conversationTokens + summaryTokens + queuedTokens;
}

export function getCompactionThresholdTokens(session: RuntimeSession): number {
  const selected = session.providerRouting.modelSelection.configuredModels;
  const model = selected[session.provider as keyof typeof selected] ?? null;
  const normalizedModel = typeof model === "string" ? model : null;
  const contextWindow = getCodexModelDefinition(normalizedModel)?.contextWindow ?? 128000;
  const thresholdPercent = session.compaction.modelThresholdOverrides[normalizedModel ?? ""] ?? session.compaction.thresholdPercent;
  return Math.floor(contextWindow * thresholdPercent);
}

export function getRemainingContextTokens(session: RuntimeSession): number {
  const selected = session.providerRouting.modelSelection.configuredModels;
  const model = selected[session.provider as keyof typeof selected] ?? null;
  const normalizedModel = typeof model === "string" ? model : null;
  const contextWindow = getCodexModelDefinition(normalizedModel)?.contextWindow ?? 128000;
  return Math.max(0, contextWindow - estimateConversationTokens(session));
}

function summarizeConversationTurns(turns: RuntimeConversationTurn[]): string {
  const lines = turns.slice(-12).map((turn) => `${turn.role}: ${compressTurnText(turn.content)}`);
  return `Compacted context summary: ${lines.join(" | ")}`;
}

function compressTurnText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}
