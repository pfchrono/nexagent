#!/usr/bin/env node

import { captureCliException, captureSentryDiagnostic, getSentryDiagnosticsStatus, runSentryDiagnosticsSelfTest } from "./instrument.js";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import process from "node:process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { executeProviderRequest, type ImageAttachment } from "./provider.js";
import { launchCodexLogin, probeCodexAuthStateSync } from "./runtime/auth.js";
import { addArchivistMemorySync, maintainArchivistMemorySync, saveArchivistMemory } from "./runtime/archivist.js";
import { bootstrapRuntime } from "./runtime/bootstrap.js";
import { beginBoomerang, buildBoomerangPrompt, cancelBoomerang, completeBoomerang } from "./runtime/boomerang.js";
import { beginBtwTurn, buildBtwInjectPrompt, cancelBtwTurn, clearBtwThread, completeBtwTurn, formatBtwStatus, type RuntimeBtwMode } from "./runtime/btw.js";
import { formatSubagentsStatus } from "./runtime/subagents.js";
import { initializeRuntimeDebug, writeDebugLog, type RuntimeDebugOptions } from "./runtime/debug.js";
import { buildPromptV2, summarizePromptV2 } from "./runtime/prompt-v2.js";
import { checkpointNexsightSession, getNexsightStats, purgeNexsight, searchNexsight } from "./runtime/nexsight.js";
import { emitTerminalNotification, formatSessionColorSwatch, getSessionColorCode, getSessionColorIndex, getSessionEmoji, notifyThresholdMs, SESSION_COLORS, SESSION_EMOJIS } from "./runtime/pi-compat.js";
import { createRuntimeExtensionArgs, createRuntimeExtensionContext, findRuntimeExtensionCommand, formatRuntimeExtensionsStatus } from "./runtime/extensions.js";
import { formatLspHealth, formatLspSetup, formatLspStatus, getLspStatus, scanLspWorkspaceSync, summarizeLspDiagnosticsSync, summarizeLspNavigationSync, summarizeLspSymbolsSync, warmLspWorkspaceSync } from "./runtime/lsp.js";
import { formatSafeGitPatterns } from "./runtime/policy.js";
import { applyQuestionnaireCommand, formatQuestionnaireStatus } from "./runtime/questionnaire.js";
import { toDiagnosticRuntimeEvent } from "./runtime/diagnostics.js";
import { savePersistedRuntimeState } from "./runtime/persistence.js";
import { executeInternalTool, getInternalToolDefinitions } from "./runtime/tools.js";
import { clearRuntimeTodos, formatTodosCommandOutput } from "./runtime/todos.js";
import { detectKeybindingConflicts, formatKeybindingDisplay, formatKeybindingRows, normalizeKeybindingAction, normalizeKeybindingKey } from "./runtime/keybindings.js";
import {
  beginGoalTurn,
  buildGoalContinuationPrompt,
  clearRuntimeGoal,
  completeGoalTurn,
  formatGoalStatus,
  parseGoalTokenBudget,
  pauseRuntimeGoal,
  resumeRuntimeGoal,
  startRuntimeGoal,
} from "./runtime/goal.js";
import { loadPiUsageStats, type UsageStats } from "./runtime/usage.js";
import { DEFAULT_CODEX_MODEL, DEFAULT_CODEX_REASONING_EFFORT, getCodexModelDefinition, normalizeCodexModel, normalizeCodexReasoningEffort, type CodexReasoningEffort } from "./models.js";
import { getProviderDefinition, getProviderModelOptions, type ProviderModelOption } from "./provider/registry.js";
import { ANSI, padLine, padVisibleLine, renderRule, renderScreen, resetScreenRenderer, tintLine, truncateLine, wrapText } from "./tui/primitives.js";
import { autocompletePromptBuffer, describePromptHint, type PromptCompletionResult } from "./cli/autocomplete.js";
import { COMMAND_CATALOG } from "./cli/catalog.js";
import { toolResultToCommandResult, type RuntimeCommandFailure, type RuntimeCommandResult } from "./cli/command-result.js";
import {
  discoverSkills,
  formatSkillList,
  normalizeSkillToken,
  rankClosestSkills,
  readSkillContent,
  resolveSkill,
  toSkillCommandFromShorthand,
} from "./cli/skills.js";
import {
  applyTransportMode,
  applyYoloMode,
  applyProviderSelection,
  compactConversation,
  createRuntimeSession,
  estimateConversationTokens,
  getCompactionThresholdTokens,
  getRemainingContextTokens,
  deriveTurnCompletionState,
  maybeCompactConversation,
  queueOperatorSteer,
  recordRuntimeEvent,
  recordConversationTurn,
  recordTurnTelemetry,
  refreshInstructionState,
  requestRuntimeCancel,
  grantRuntimeApprovalForSession,
  resolveRuntimeApproval,
  setRuntimeAction,
  syncRuntimeSession,
  type RuntimeSession,
} from "./runtime/session.js";
import { LAUNCH_SWITCHES, formatLaunchHelp, parseCommand, resolvePrompt, type CliCommand } from "./cli/launch.js";

export { autocompletePromptBuffer, describePromptHint } from "./cli/autocomplete.js";
export type { RuntimeCommandFailure, RuntimeCommandResult, RuntimeCommandSuccess } from "./cli/command-result.js";
export { LAUNCH_SWITCHES, formatLaunchHelp, parseCommand, resolvePrompt } from "./cli/launch.js";
export type { PromptCompletionResult, PromptCompletionSuggestion } from "./cli/autocomplete.js";

const SPINNER_FRAMES = ["-", "\\", "|", "/"] as const;
const NEXAGENT_EMBLEM_FRAMES = ["◜◆◝", "◠◆◡", "◟◆◞", "◡◆◠"] as const;
const PACED_REPLY_MAX_FRAMES = 120;
const PACED_REPLY_FRAME_DELAY_MS = 35;
const CHAT_HISTORY_SCROLLBACK_LINES = 800;
const PROMPT_EVENT_DETAIL_MAX_CHARS = 12_000;
const CHAT_HISTORY_RETENTION_MS = 6 * 60 * 60 * 1000;
const CHAT_HISTORY_MIN_RECENT_EVENTS = 80;
const PERIODIC_MEMORY_MIN_MS = 10 * 60 * 1000;
const PERIODIC_MEMORY_MAX_MS = 20 * 60 * 1000;
const PERIODIC_MEMORY_TICK_MS = 30 * 1000;
const MAX_IMAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};
const SPINNER_VERBS = [
  "Accomplishing",
  "Actioning",
  "Actualizing",
  "Architecting",
  "Baking",
  "Beaming",
  "Beboppin'",
  "Befuddling",
  "Billowing",
  "Blanching",
  "Bloviating",
  "Boogieing",
  "Boondoggling",
  "Booping",
  "Bootstrapping",
  "Brewing",
  "Bunning",
  "Burrowing",
  "Calculating",
  "Canoodling",
  "Caramelizing",
  "Cascading",
  "Catapulting",
  "Cerebrating",
  "Channeling",
  "Channelling",
  "Choreographing",
  "Churning",
  "Clauding",
  "Coalescing",
  "Cogitating",
  "Combobulating",
  "Composing",
  "Computing",
  "Concocting",
  "Considering",
  "Contemplating",
  "Cooking",
  "Crafting",
  "Creating",
  "Crunching",
  "Crystallizing",
  "Cultivating",
  "Deciphering",
  "Deliberating",
  "Determining",
  "Dilly-dallying",
  "Discombobulating",
  "Doing",
  "Doodling",
  "Drizzling",
  "Ebbing",
  "Effecting",
  "Elucidating",
  "Embellishing",
  "Enchanting",
  "Envisioning",
  "Evaporating",
  "Fermenting",
  "Fiddle-faddling",
  "Finagling",
  "Flambéing",
  "Flibbertigibbeting",
  "Flowing",
  "Flummoxing",
  "Fluttering",
  "Forging",
  "Forming",
  "Frolicking",
  "Frosting",
  "Gallivanting",
  "Galloping",
  "Garnishing",
  "Generating",
  "Gesticulating",
  "Germinating",
  "Gitifying",
  "Grooving",
  "Gusting",
  "Harmonizing",
  "Hashing",
  "Hatching",
  "Herding",
  "Honking",
  "Hullaballooing",
  "Hyperspacing",
  "Ideating",
  "Imagining",
  "Improvising",
  "Incubating",
  "Inferring",
  "Infusing",
  "Ionizing",
  "Jitterbugging",
  "Julienning",
  "Kneading",
  "Leavening",
  "Levitating",
  "Lollygagging",
  "Manifesting",
  "Marinating",
  "Meandering",
  "Metamorphosing",
  "Misting",
  "Moonwalking",
  "Moseying",
  "Mulling",
  "Mustering",
  "Musing",
  "Nebulizing",
  "Nesting",
  "Newspapering",
  "Noodling",
  "Nucleating",
  "Orbiting",
  "Orchestrating",
  "Osmosing",
  "Perambulating",
  "Percolating",
  "Perusing",
  "Philosophising",
  "Photosynthesizing",
  "Pollinating",
  "Pondering",
  "Pontificating",
  "Pouncing",
  "Precipitating",
  "Prestidigitating",
  "Processing",
  "Proofing",
  "Propagating",
  "Puttering",
  "Puzzling",
  "Quantumizing",
  "Razzle-dazzling",
  "Razzmatazzing",
  "Recombobulating",
  "Reticulating",
  "Roosting",
  "Ruminating",
  "Sautéing",
  "Scampering",
  "Schlepping",
  "Scurrying",
  "Seasoning",
  "Shenaniganing",
  "Shimmying",
  "Simmering",
  "Skedaddling",
  "Sketching",
  "Slithering",
  "Smooshing",
  "Sock-hopping",
  "Spelunking",
  "Spinning",
  "Sprouting",
  "Stewing",
  "Sublimating",
  "Swirling",
  "Swooping",
  "Symbioting",
  "Synthesizing",
  "Tempering",
  "Thinking",
  "Thundering",
  "Tinkering",
  "Tomfoolering",
  "Topsy-turvying",
  "Transfiguring",
  "Transmuting",
  "Twisting",
  "Undulating",
  "Unfurling",
  "Unravelling",
  "Vibing",
  "Waddling",
  "Wandering",
  "Warping",
  "Whatchamacalliting",
  "Whirlpooling",
  "Whirring",
  "Whisking",
  "Wibbling",
  "Working",
  "Wrangling",
  "Zesting",
  "Zigzagging",
  "Baseding",
  "Clutching",
  "Flexing",
  "Gaslighting",
  "Glitching",
  "Grinding",
  "Heeling",
  "Rizzing",
  "Shipping",
  "Sigma-ing",
  "Skibidi-ing",
  "Slaying",
  "Swole-ing",
  "Yeeting",
  "Bussin",
  "Delulu-ing",
  "Gyatt-ing",
  "Ohio-ing",
  "Sus-ing",
  "Mewing",
  "Mogging",
  "Fanum-taxing",
  "Brain-rotting",
  "Cap-ing",
  "Rizzling",
  "Gyatting",
  "Bruh-ing",
  "Lituation-ing",
  "W-ing",
  "Sussy-ing",
  "Based-ing",
  "Staring",
  "Ceasing",
  "Salting",
] as const;
const TUI_SECTIONS = ["overview", "routing", "auth", "instructions", "mcp", "hooks", "imports", "archivist", "agent"] as const;
const KEY_HINT = "Keys: Enter send · Esc clear · Tab complete · Alt+V paste-image (Ctrl+Alt+V) · ↑/↓ history · Ctrl+R picker · Ctrl+T trace · Ctrl+Y/N approve/reject · Ctrl+O mouse-mode · Ctrl+L focus · Ctrl+C copy/exit · /reload · /quit";
const APPROVE_PROMPT_ALIASES = new Set(["approve", "approved"]);
const REJECT_PROMPT_ALIASES = new Set(["reject", "rejected", "deny", "denied"]);

type RuntimeTuiSection = (typeof TUI_SECTIONS)[number];

interface RuntimeTuiState {
  view: RuntimeTuiView;
  action: RuntimeSession["action"];
  selectedSection: RuntimeTuiSection;
  spinnerFrame: number;
  activity: string[];
  promptBuffer: string;
  transcript: string[];
  chatHistory: string[];
  liveAssistantReply: string | null;
  currentTurnActivity: string[];
  currentTurnTraceDetails: string[];
  latestTurnTrace: string[];
  traceExpanded: boolean;
  promptCursor: number;
  promptHistory: string[];
  promptHistoryIndex: number;
  promptDraft: string | null;
  completionIndex: number;
  historyPopupOpen: boolean;
  historyPopupIndex: number;
  modelPickerOpen: boolean;
  modelPickerIndex: number;
  modelPickerEntries: Array<{ id: string; description: string; current: boolean; disabledReason?: string }>;
  modelPickerQuery: string;
  chatScrollOffset: number;
  latestUserMessage: string | null;
  latestAssistantMessage: string | null;
  copyStatus: string | null;
  copyStatusExpiresAt: number;
  lastCtrlCAt: number;
  composerFocusMode: boolean;
  pendingImageAttachment: ImageAttachment | null;
  approvalRequired: boolean;
  pendingApprovalTool: string | null;
  pendingApprovalSummary: string | null;
  lastDecision: "approved" | "rejected" | "canceled" | null;
  cancelRequested: boolean;
  steerState: string | null;
  steerMessage: string | null;
}

interface TerminalSize {
  columns: number;
  rows: number;
}

type DiagnosticRow = readonly [string, string];

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));

  if (command.kind === "help") {
    process.stdout.write(`${formatLaunchHelp()}\n`);
    return;
  }

  if (command.kind === "run") {
    const prompt = resolvePrompt(command.prompt, await readPipedStdin(process.stdin));
    const runtime = await bootstrapRuntime(process.cwd());
    const session = createRuntimeSession(runtime);
    configureSessionDebug(session, command.debug);
    if (command.yolo) {
      applyYoloMode(session);
    }
    await runPromptCommand(session, prompt);
    return;
  }

  if (command.kind === "grpc") {
    const runtime = await bootstrapRuntime(process.cwd());
    const session = createRuntimeSession(runtime);
    configureSessionDebug(session, command.debug);
    if (command.yolo) {
      applyYoloMode(session);
    }
    const { startNexagentGrpcServer } = await import("./grpc/server.js");
    let resolveStopped!: () => void;
    const stopped = new Promise<void>((resolve) => {
      resolveStopped = resolve;
    });
    const handle = await startNexagentGrpcServer({
      session,
      host: command.host,
      port: command.port,
      onStop: resolveStopped,
    });
    process.stdout.write(`nexagent grpc listening ${handle.address}\n`);
    await waitForGrpcShutdown(handle.stop, stopped);
    process.exit(0);
    return;
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    const runtime = await bootstrapRuntime(process.cwd());
    const session = createRuntimeSession(runtime);
    configureSessionDebug(session, command.debug);
    if (command.yolo) {
      applyYoloMode(session);
    }
    process.stdout.write(`${JSON.stringify(createRuntimeInspectPayload(session), null, 2)}\n`);
    return;
  }

  let stopStartup: (() => void) | undefined;
  let startupInterrupted = false;

  const onStartupSigint = () => {
    startupInterrupted = true;
    stopStartup?.();
    restoreTerminal();
    process.exitCode = 130;
  };

  process.once("SIGINT", onStartupSigint);

  try {
    stopStartup = renderStartupTui();
    const runtime = await bootstrapRuntime(process.cwd());
    if (startupInterrupted) {
      return;
    }

    const session = createRuntimeSession(runtime);
    configureSessionDebug(session, command.debug);
    if (command.yolo) {
      applyYoloMode(session);
    }
    stopStartup();
    stopStartup = undefined;
    process.removeListener("SIGINT", onStartupSigint);
    const { runOpenTuiRuntime } = await import("./opentui/entry.js");
    await runOpenTuiRuntime(session);
  } finally {
    process.removeListener("SIGINT", onStartupSigint);
    stopStartup?.();
    restoreTerminal();
  }
}

async function waitForGrpcShutdown(stop: () => Promise<void>, stopped: Promise<void>): Promise<void> {
  let resolveSignal!: () => void;
  const signal = new Promise<void>((resolve) => {
    resolveSignal = resolve;
  });
  let stopping = false;
  const shutdown = () => {
    if (stopping) {
      return;
    }
    stopping = true;
    void stop().finally(() => resolveSignal());
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    await Promise.race([stopped, signal]);
  } finally {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
  }
}

export interface RuntimeTuiView {
  title: string;
  statusline: string | null;
  metadata: ReadonlyArray<[string, string]>;
  routing: ReadonlyArray<[string, string]>;
  auth: ReadonlyArray<[string, string]>;
  instructions: ReadonlyArray<[string, string]>;
  mcp: ReadonlyArray<[string, string]>;
  hooks: ReadonlyArray<[string, string]>;
  imports: ReadonlyArray<[string, string]>;
  archivist: ReadonlyArray<[string, string]>;
}

export type RuntimeGuiView = RuntimeTuiView;

function configureSessionDebug(session: RuntimeSession, options: RuntimeDebugOptions): void {
  session.debug = initializeRuntimeDebug(options);
  writeDebugLog(session.debug, "session.start", {
    session: session.id,
    cwd: session.cwd,
    provider: session.provider,
    transport: session.providerTransport.mode,
    verbose: session.debug.verbose,
  });
  if (session.debug.logPath) {
    process.stderr.write(`debug log: ${session.debug.logPath}\n`);
  }
}

export function formatPromptEventDetail(prompt: string): string {
  if (prompt.length <= PROMPT_EVENT_DETAIL_MAX_CHARS) {
    return prompt;
  }

  return `${prompt.slice(0, PROMPT_EVENT_DETAIL_MAX_CHARS)}\n... prompt truncated after ${PROMPT_EVENT_DETAIL_MAX_CHARS} chars ...`;
}

export function createRuntimeInspectPayload(
  session: RuntimeSession,
): RuntimeSession & {
  promptV2: RuntimeSession["promptV2Summary"];
} {
  const promptV2 =
    session.promptV2Summary ?? summarizePromptV2(buildPromptV2({ session, prompt: "" }).sections);

  return { ...session, promptV2 };
}

export function createRuntimeTuiView(session: RuntimeSession): RuntimeTuiView {
  const promptV2 =
    session.promptV2Summary ?? summarizePromptV2(buildPromptV2({ session, prompt: "" }).sections);

  return {
    title: session.product,
    statusline: session.commandModes.statusline ? formatStatusline(session) : null,
    metadata: [
      ["session", session.id],
      ["started", session.startedAt],
      ["provider", session.provider],
      ["cwd", session.cwd],
      ["repo", formatRepoLabel(session)],
      ["branch", session.repo.branch ?? "detached"],
      ["git", formatRepoFreshness(session)],
      ["contextLeft", String(getRemainingContextTokens(session))],
      ["contextLimit", String(getContextWindowForSession(session))],
      ["compact", formatCompactionSummary(session)],
      ["toolPolicy", session.toolPolicy.mode],
      ["approval", formatApprovalSummary(session)],
      ["ops", formatOperationSummary(session)],
      ["status", session.action.status],
      ["detail", session.action.detail],
      ["lastActivity", session.action.lastActivity ?? "none"],
      ["sessionStyle", `${getSessionEmoji(session)} color=${String(getSessionColorCode(session))}`],
      ["styles", formatStyleStack(session)],
      ["turns", String(session.telemetry.turnCount)],
      ["lastTokens", formatTurnTokens(session)],
    ],
    routing: [
      ["activeProvider", session.providerTransport.activeProvider],
      ["transport", formatTransportSummary(session)],
      ["adapter", session.providerTransport.adapter],
      ["mode", session.providerTransport.mode],
      ["authSource", session.providerTransport.authSource],
      ["authGate", session.providerTransport.authGate],
      ["capabilities", formatTransportCapabilities(session)],
      ["caveats", formatTransportCaveat(session)],
      ["fallback", formatFallbackPolicy(session.providerRouting.fallback)],
      ["models", formatProviderModels(session.providerRouting.modelSelection.configuredModels)],
    ],
    auth: [
      ["provider", session.auth.provider],
      ["available", String(session.auth.available)],
      ["loggedIn", String(session.auth.loggedIn)],
      ["method", session.auth.method ?? "none"],
      ["status", session.auth.status],
      ["checkedAt", session.auth.checkedAt ?? "none"],
    ],
    instructions: [
      ["assembly", session.prompt?.assembly ?? "v2"],
      ["count", String(promptV2.count)],
      ["style", promptV2.style],
      ["repoSources", formatInstructionSources(session, "repoBehavior")],
      ["taskSources", formatInstructionSources(session, "taskContext")],
      ["identity", promptV2.identity],
      ["executionContract", promptV2.executionContract],
      ["toolRouting", promptV2.toolRouting],
      ["editingSafety", promptV2.editingSafety],
      ["providerGuidance", promptV2.providerGuidance],
      ["repoContext", promptV2.repoContext],
      ["runtimeState", promptV2.runtimeState],
      ["conversationState", promptV2.conversationState],
      ["stableSections", promptV2.stableSections || "none"],
      ["dynamicSections", promptV2.dynamicSections || "none"],
      ["dynamicBoundary", promptV2.dynamicBoundary],
    ],
    mcp: [
      ["enabled", formatList(session.enabledMcpServers)],
      ["loaded", formatList(session.mcpServers)],
      ["hydrated", String(session.mcpRegistry?.tools?.length ?? 0)],
      ["status", formatMcpRuntimeStatus(session)],
    ],
    hooks: [
      ["status", session.hooks.status],
      ["source", session.hooks.sourcePath ?? "none"],
      ["events", formatList(session.hooks.events)],
      ["commands", String(session.hooks.commandCount)],
      ["invalid", session.hooks.invalidEntries.length > 0 ? session.hooks.invalidEntries.join(" | ") : "none"],
    ],
    imports: [["claude", formatClaudeImport(session.imports.claude)]],
    archivist: [
      ["enabled", String(session.archivist.enabled)],
      ["boundary", session.archivist.boundary],
      ["storage", session.archivist.storagePath ?? "disabled"],
      ["persisted", String(session.archivist.storageExists)],
      ["retrieval", formatArchivistRetrieval(session.archivist.retrieval)],
      ["retrievalPreview", session.archivist.retrieval.preview ?? "none"],
      ["writes", formatArchivistWrite(session.archivist.writes)],
      ["writePreview", session.archivist.writes.preview ?? "none"],
    ],
  };
}

function renderStartupTui(): () => void {
  let frame = 0;

  const render = () => {
    process.stdout.write(renderScreen([
      "nexagent",
      "========",
      "",
      `${SPINNER_FRAMES[frame % SPINNER_FRAMES.length]} loading runtime`,
      "  config  reading .nexagent/.claude settings",
      "  mcp     loading registry and hydrating stdio tools",
      "  session waiting for runtime state",
      "",
      "Press Ctrl+C to exit.",
    ]));
    frame += 1;
  };

  render();
  const interval = setInterval(render, 120);

  return () => clearInterval(interval);
}

export function renderRuntimeTui(view: RuntimeTuiView, terminalSize?: Partial<TerminalSize>): string {
  const state = createDefaultRuntimeTuiState(view);
  const status = normalizeActionStatus(lookupValue(view.metadata, "status"));
  const detail = lookupValue(view.metadata, "detail");
  state.action = {
    status,
    detail: detail === "unknown" ? "runtime baseline" : detail,
    pending: status === "running",
    lastActivity: normalizeMetadataValue(lookupValue(view.metadata, "lastActivity")),
  };
  return renderRuntimeTuiState(state, terminalSize);
}

export function createRuntimeGuiView(session: RuntimeSession): RuntimeGuiView {
  return createRuntimeTuiView(session);
}

export function renderRuntimeGui(view: RuntimeGuiView): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(view.title)}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; background: #10131a; color: #eef2ff; }
    main { max-width: 48rem; margin: 0 auto; }
    section { border: 1px solid #334155; border-radius: 0.75rem; padding: 1rem; margin-block: 1rem; background: #161b26; }
    h1, h2 { margin-block: 0 0.75rem; }
    dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.5rem 1rem; margin: 0; }
    dt { color: #93c5fd; }
    dd { margin: 0; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(view.title)}</h1>
    ${renderGuiSection("runtime", view.metadata)}
    ${renderGuiSection("routing", view.routing)}
    ${renderGuiSection("auth", view.auth)}
    ${renderGuiSection("instructions", view.instructions)}
    ${renderGuiSection("mcp", view.mcp)}
    ${renderGuiSection("hooks", view.hooks)}
    ${renderGuiSection("imports", view.imports)}
    ${renderGuiSection("archivist", view.archivist)}
  </main>
</body>
</html>
`;
}

async function readPipedStdin(stdin: NodeJS.ReadStream): Promise<string | null> {
  if (stdin.isTTY) {
    return null;
  }

  return await new Promise((resolve, reject) => {
    let data = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk: string) => {
      data += chunk;
    });
    stdin.once("end", () => resolve(data));
    stdin.once("error", reject);
    stdin.resume();
  });
}

export async function runPromptCommand(session: RuntimeSession, prompt: string): Promise<void> {
  let effectivePrompt = prompt.trim();
  let transcriptPrompt = effectivePrompt;
  let promptSummary: string | undefined;
  const skillCommand = toSkillCommandFromShorthand(effectivePrompt);
  if (skillCommand) {
    effectivePrompt = skillCommand;
    transcriptPrompt = skillCommand;
  }
  const trimmedPrompt = effectivePrompt;
  if (session.debug) {
    writeDebugLog(session.debug, "prompt.accepted", {
      chars: trimmedPrompt.length,
      prompt: trimmedPrompt,
    }, { verboseOnly: true });
  }
  const memoryMutation = parseMemoryMutationCommand(trimmedPrompt);

  if (memoryMutation) {
    try {
      const output = await applyMemoryMutationCommand(session, memoryMutation);
      setRuntimeAction(session, "ready", "command complete");
      recordRuntimeEvent(session, {
        kind: "command",
        status: "completed",
        summary: `command ${trimmedPrompt.split(/\s+/)[0]} completed`,
        detail: output,
      });
      process.stdout.write(`${output}\n`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeAction(session, "error", message);
      recordRuntimeEvent(session, {
        kind: "command",
        status: "failed",
        summary: `command ${trimmedPrompt.split(/\s+/)[0]} failed`,
        detail: message,
      });
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return;
    }
  }

  if (session.operationControls.pendingQuestionnaire && !trimmedPrompt.startsWith("/")) {
    effectivePrompt = `/ask ${trimmedPrompt}`;
  } else if (session.operationControls.pendingApproval && !trimmedPrompt.startsWith("/")) {
    const lowerPrompt = trimmedPrompt.toLowerCase();
    if (APPROVE_PROMPT_ALIASES.has(lowerPrompt)) {
      effectivePrompt = "/approval approve";
    } else if (REJECT_PROMPT_ALIASES.has(lowerPrompt)) {
      effectivePrompt = "/approval reject";
    } else {
      const message = `approval pending for ${session.operationControls.pendingApproval.tool}; use /approval approve or /approval reject`;
      setRuntimeAction(session, "error", message);
      recordRuntimeEvent(session, {
        kind: "control",
        status: "blocked",
        summary: "approval still pending",
        detail: message,
      });
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
      return;
    }
  }

  if (effectivePrompt.trim() === "/reload") {
    recordRuntimeEvent(session, {
      kind: "command",
      status: "started",
      summary: "reload command started",
    });
    const runtime = await bootstrapRuntime(session.cwd);
    syncRuntimeSession(session, runtime);
    setRuntimeAction(session, "ready", "runtime baseline");
    recordRuntimeEvent(session, {
      kind: "command",
      status: "completed",
      summary: "reload command completed",
    });
    process.stdout.write("runtime reloaded (config/state). code edits require restart.\n");
    return;
  }

  if (effectivePrompt.trim() === "/quit") {
    const quitMemoryNote = await maybePersistSessionMemoryOnQuit(session, "quit command");
    setRuntimeAction(session, "ready", "command complete");
    recordRuntimeEvent(session, {
      kind: "command",
      status: "completed",
      summary: "quit command requested",
      detail: quitMemoryNote ?? "no pre-quit memory save",
    });
    process.stdout.write(`quitting interactive session${quitMemoryNote ? `\n${quitMemoryNote}` : ""}\n`);
    return;
  }

  const commandResult = runRuntimeCommand(session, effectivePrompt);

  if (commandResult) {
    // Commands with autoInvokeAfterSkill fall through to model invocation.
    if (commandResult.ok && commandResult.autoInvokeAfterSkill) {
      process.stdout.write(`${commandResult.output}\n`);
      transcriptPrompt = commandResult.transcriptPrompt ?? effectivePrompt;
      promptSummary = commandResult.promptSummary;
      effectivePrompt = commandResult.invokePrompt ?? buildActiveSkillExecutionPrompt(session, effectivePrompt);
    } else if (commandResult.ok) {
      setRuntimeAction(session, "ready", "command complete");
      recordRuntimeEvent(session, {
        kind: "command",
        status: "completed",
        summary: `command ${effectivePrompt.split(/\s+/)[0]} completed`,
        detail: commandResult.output,
      });
      await maybeArchiveAgedChatHistory(session);
      process.stdout.write(`${commandResult.output}\n`);
      return;
    } else {
      setRuntimeAction(session, "error", commandResult.message);
      recordRuntimeEvent(session, {
        kind: "command",
        status: "failed",
        summary: `command ${effectivePrompt.split(/\s+/)[0]} failed`,
        detail: commandResult.message,
      });
      process.stderr.write(`${commandResult.message}\n`);
      process.exitCode = 1;
      return;
    }
  }

  recordRuntimeEvent(session, {
    kind: "prompt",
    status: "queued",
    summary: promptSummary ?? "user prompt accepted",
    detail: formatPromptEventDetail(transcriptPrompt),
  });
  setRuntimeAction(session, "running", "provider request");

  try {
    const autoCompact = maybeCompactConversation(session, effectivePrompt);
    if (autoCompact.compacted) {
      setRuntimeAction(session, "running", `auto compact · ${autoCompact.beforeTokens} -> ${autoCompact.afterTokens}`);
    }
    beginGoalTurn(session);
    const result = await executeProviderRequest({ session, prompt: effectivePrompt });

    if (result.ok) {
      if (session.debug) {
        writeDebugLog(session.debug, "provider.result", {
          provider: result.provider,
          model: result.model,
          transport: result.transport,
          output: result.output,
        }, { verboseOnly: true });
      }
      const btwExchange = completeBtwTurn(session, result.output);
      if (btwExchange) {
        savePersistedRuntimeState(session);
        recordRuntimeEvent(session, {
          kind: "assistant",
          status: "completed",
          summary: "btw response captured",
          detail: btwExchange.saved ? `saved note: ${btwExchange.question}` : btwExchange.question,
        });
      } else {
        recordConversationTurn(session, "user", transcriptPrompt);
        recordConversationTurn(session, "assistant", result.output);
      }
      recordTurnTelemetry(session, effectivePrompt, result.output);
      const goalContinuation = completeGoalTurn(session, effectivePrompt, result.output);
      checkpointNexsightSession(session, "turn");
      const boomerangSummary = completeBoomerang(session, result.output);
      if (boomerangSummary) {
        recordRuntimeEvent(session, {
          kind: "compact",
          status: "completed",
          summary: "boomerang summary captured",
          detail: summarizeBoomerangEvent(boomerangSummary),
        });
      }
      setRuntimeAction(session, "ready", `response received · ${result.provider}`);
      await maybeArchiveAgedChatHistory(session);
      process.stdout.write(`${result.output}${goalContinuation ? `\n${goalContinuation.promptSummary}; use /goal resume in interactive mode to continue if needed.` : ""}\n`);
      return;
    }

    setRuntimeAction(session, "error", result.message);
    cancelBoomerang(session);
    cancelBtwTurn(session);
    if (session.debug) {
      writeDebugLog(session.debug, "provider.failure", {
        provider: result.provider,
        model: result.model,
        transport: result.transport,
        message: result.message,
        detail: result.detail,
      });
    }
    recordRuntimeEvent(session, {
      kind: "provider",
      status: "failed",
      summary: `${result.provider} response failed`,
      detail: result.detail,
    });
    process.stderr.write(formatProviderFailure(result));
    process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setRuntimeAction(session, "error", message);
    cancelBoomerang(session);
    cancelBtwTurn(session);
    recordRuntimeEvent(session, {
      kind: "provider",
      status: "failed",
      summary: "provider request failed",
      detail: message,
    });
    throw error;
  }
}

function summarizeBoomerangEvent(summary: string): string {
  return summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join("\n");
}

function firstBoomerangSummaryLine(summary: string): string {
  return summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && line !== "[BOOMERANG COMPLETE]") ?? "captured";
}

export function runRuntimeCommand(session: RuntimeSession, input: string): RuntimeCommandResult | null {
  const result = dispatchRuntimeCommand(session, input);
  if (result && !result.ok) {
    const command = input.trim().startsWith("!") ? "!" : input.trim().split(/\s+/)[0] ?? "unknown";
    const diagnostic = captureSentryDiagnostic({
      class: "command.failed",
      attributes: {
        command_name: command,
        failure_class: result.activity,
      },
    }, { sendEvent: false });
    recordRuntimeEvent(session, toDiagnosticRuntimeEvent(diagnostic));
  }
  return result;
}

function dispatchRuntimeCommand(session: RuntimeSession, input: string): RuntimeCommandResult | null {
  const prompt = input.trim();
  if (prompt.startsWith("!")) {
    return handleBangShellCommand(session, prompt);
  }
  if (!prompt.startsWith("/")) {
    return null;
  }

  const [command, ...args] = prompt.split(/\s+/);
  switch (command) {
    case "/help":
      return handleHelpCommand(args);
    case "/keys":
      return handleKeysCommand(session, args);
    case "/continue":
      return handleContinueCommand(session, args);
    case "/finish":
      return handleFinishCommand(session, args);
    case "/reload":
      return handleReloadCommand(args);
    case "/quit":
      return handleQuitCommand(args);
    case "/login":
      return handleLoginCommand(session, args);
    case "/codex":
      return handleCodexCommand(session, args);
    case "/provider":
      return handleProviderCommand(session, args);
    case "/model":
      return handleModelCommand(session, args);
    case "/effort":
      return handleEffortCommand(session, args);
    case "/skill":
      return handleSkillCommand(session, args);
    case "/boomerang":
      return handleBoomerangCommand(session, args);
    case "/btw":
    case "/btw:new":
    case "/btw:tangent":
    case "/btw:clear":
    case "/btw:inject":
    case "/btw:summarize":
    case "/btw:model":
    case "/btw:thinking":
      return handleBtwCommand(session, command, args);
    case "/agents":
      return handleAgentsCommand(session, args);
    case "/mouse":
      return handleMouseCommand(session, args);
    case "/status":
      return handleStatusCommand(session, args);
    case "/usage":
      return handleUsageCommand(session, args);
    case "/todos":
      return handleTodosCommand(session, args);
    case "/goal":
      return handleGoalCommand(session, args);
    case "/notify":
    case "/notify-status":
    case "/notify-test":
      return handleNotifyCommand(session, command, args);
    case "/emoji":
    case "/emoji-test":
      return handleEmojiCommand(session, command, args);
    case "/color":
    case "/color-next":
    case "/color-set":
      return handleColorCommand(session, command, args);
    case "/safegit":
    case "/safegit-status":
    case "/safegit-level":
      return handleSafeGitCommand(session, command, args);
    case "/scip":
      return handleScipCommand(session, args);
    case "/doctor":
      return handleDoctorCommand(session, args);
    case "/caveman-mode":
      return handleStyleToggleCommand(session, args, "cavemanMode");
    case "/deadpoolmode":
      return handleStyleToggleCommand(session, args, "deadpoolMode");
    case "/statusline":
      return handleStatuslineCommand(session, args);
    case "/approval":
      return handleApprovalCommand(session, args);
    case "/ask":
      return handleAskCommand(session, args);
    case "/cancel":
      return handleCancelCommand(session, args);
    case "/steer":
      return handleSteerCommand(session, args);
    case "/compact":
      return handleCompactCommand(session, args);
    case "/tools":
      return handleToolsCommand(session, args);
    case "/why-blocked":
      return handleWhyBlockedCommand(session, args);
    case "/nexsight":
      return handleNexsightCommand(session, args);
    case "/pwd":
      return handlePwdCommand(session, args);
    case "/ls":
      return handleLsCommand(session, args);
    case "/read":
      return handleReadCommand(session, args);
    case "/find":
      return handleFindCommand(session, args);
    case "/glob":
      return handleGlobCommand(session, args);
    case "/rg":
      return handleRipgrepCommand(session, args);
    case "/diff":
      return handleDiffCommand(session, args);
    case "/memory":
      return handleMemoryCommand(session, args);
    case "/config":
      return handleConfigCommand(session, args);
    case "/lsp":
      return handleLspCommand(session, args);
    case "/hooks":
      return handleHooksCommand(session, args);
    case "/extensions":
      return handleExtensionsCommand(session, args);
    case "/attach":
    case "/detach":
      return {
        ok: false,
        message: "image attachments are interactive-only; use /attach or /detach in TTY composer",
        activity: "attachment command rejected",
      };
    default:
      {
        const extensionResult = handleExtensionRuntimeCommand(session, command, args);
        if (extensionResult) {
          return extensionResult;
        }
      }
      return {
        ok: false,
        message: `unknown command ${command}; use /help`,
        activity: `command failed · ${command}`,
      };
  }
}

const DISABLE_ARGS = new Set(["off", "disable", "disabled"]);
const ENABLE_ARGS = new Set(["on", "enable", "enabled"]);
const STATUS_ARGS = new Set(["status", "state"]);
const VERBOSE_ARGS = new Set(["verbose", "--verbose", "-v", "details", "detail", "full"]);
type DetailMode = "compact" | "verbose";

function splitVerboseArg(args: string[]): { detailMode: DetailMode; args: string[] } {
  const detailMode: DetailMode = args.some((arg) => VERBOSE_ARGS.has(arg.toLowerCase())) ? "verbose" : "compact";
  return {
    detailMode,
    args: args.filter((arg) => !VERBOSE_ARGS.has(arg.toLowerCase())),
  };
}

function detectMouseCapabilities(): { wheel: boolean; reason: string | null } {
  const term = (process.env.TERM ?? "").toLowerCase();
  if (!term || term === "dumb" || term === "unknown") {
    return { wheel: false, reason: `terminal ${term || "unset"} does not support wheel capture` };
  }
  return { wheel: true, reason: null };
}

function getConfiguredMouseMode(session: RuntimeSession): "auto" | "scroll" | "select" {
  const configured = session.commandModes.mouseMode;
  return configured === "scroll" || configured === "select" || configured === "auto" ? configured : "auto";
}

function getEffectiveMouseMode(session: RuntimeSession): { mode: "scroll" | "select"; warning: string | null } {
  const configured = getConfiguredMouseMode(session);
  const caps = detectMouseCapabilities();
  if (configured === "scroll") {
    if (!caps.wheel) {
      return { mode: "select", warning: caps.reason ? `fallback select: ${caps.reason}; fix by using a wheel-capable terminal or /mouse mode select` : null };
    }
    return { mode: "scroll", warning: null };
  }
  if (configured === "select") {
    return { mode: "select", warning: null };
  }
  if (!caps.wheel) {
    return { mode: "select", warning: caps.reason ? `auto fallback select: ${caps.reason}; fix by enabling a wheel-capable terminal` : null };
  }
  return { mode: "scroll", warning: null };
}

function formatMouseStatus(session: RuntimeSession): string {
  const effective = getEffectiveMouseMode(session);
  return [
    `configured: ${getConfiguredMouseMode(session)}`,
    `effective: ${effective.mode}`,
    `wheel: ${detectMouseCapabilities().wheel ? "supported" : "unsupported"}`,
    effective.warning ? `warning: ${effective.warning}` : "warning: none",
  ].join("\n");
}

function handleMouseCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length === 0 || (args.length === 1 && STATUS_ARGS.has(args[0].toLowerCase()))) {
    return {
      ok: true,
      output: formatMouseStatus(session),
      activity: "mouse mode status",
    };
  }
  if (args.length !== 2 || args[0]?.toLowerCase() !== "mode") {
    return {
      ok: false,
      message: "usage: /mouse [status|mode <auto|scroll|select>]",
      activity: "command failed · /mouse usage",
    };
  }
  const next = args[1]?.toLowerCase();
  if (next !== "auto" && next !== "scroll" && next !== "select") {
    return {
      ok: false,
      message: "usage: /mouse [status|mode <auto|scroll|select>]",
      activity: "command failed · /mouse usage",
    };
  }
  session.commandModes.mouseMode = next;
  savePersistedRuntimeState(session);
  return {
    ok: true,
    output: formatMouseStatus(session),
    activity: `mouse mode set · ${next}`,
  };
}

function handleNotifyCommand(session: RuntimeSession, command: string, args: string[]): RuntimeCommandResult {
  const arg = args.join(" ").trim().toLowerCase();
  if (command === "/notify-test") {
    emitTerminalNotification("nexagent", "test notification");
    return { ok: true, output: formatNotifyStatus(session), activity: "notify test" };
  }
  if (command === "/notify-status" || args.length === 0 || (args.length === 1 && STATUS_ARGS.has(arg))) {
    return { ok: true, output: formatNotifyStatus(session), activity: "notify status" };
  }
  if (args.length === 1 && (ENABLE_ARGS.has(arg) || DISABLE_ARGS.has(arg))) {
    session.ui = session.ui ?? { logoMode: "full" };
    session.ui.notifyEnabled = ENABLE_ARGS.has(arg);
    savePersistedRuntimeState(session);
    return { ok: true, output: formatNotifyStatus(session), activity: `notify ${session.ui.notifyEnabled ? "on" : "off"}` };
  }
  if (args.length === 2 && args[0]?.toLowerCase() === "threshold") {
    const threshold = Number.parseInt(args[1] ?? "", 10);
    if (!Number.isFinite(threshold) || threshold < 0) {
      return { ok: false, message: "usage: /notify [on|off|status|threshold <ms>] | /notify-test", activity: "command failed · /notify usage" };
    }
    session.ui = session.ui ?? { logoMode: "full" };
    session.ui.notifyThresholdMs = threshold;
    savePersistedRuntimeState(session);
    return { ok: true, output: formatNotifyStatus(session), activity: `notify threshold · ${String(threshold)}ms` };
  }
  return { ok: false, message: "usage: /notify [on|off|status|threshold <ms>] | /notify-test", activity: "command failed · /notify usage" };
}

function handleEmojiCommand(session: RuntimeSession, command: string, args: string[]): RuntimeCommandResult {
  if (command === "/emoji-test") {
    return { ok: true, output: SESSION_EMOJIS.join(" "), activity: "emoji test" };
  }
  if (args.length === 0 || (args.length === 1 && STATUS_ARGS.has(args[0]?.toLowerCase() ?? ""))) {
    return { ok: true, output: formatEmojiStatus(session), activity: "emoji status" };
  }
  if (args.length === 1) {
    session.ui = session.ui ?? { logoMode: "full" };
    session.ui.sessionEmoji = args[0];
    savePersistedRuntimeState(session);
    return { ok: true, output: formatEmojiStatus(session), activity: `emoji set · ${args[0]}` };
  }
  return { ok: false, message: "usage: /emoji [status|emoji] | /emoji-test", activity: "command failed · /emoji usage" };
}

function handleColorCommand(session: RuntimeSession, command: string, args: string[]): RuntimeCommandResult {
  if (command === "/color-next") {
    session.ui = session.ui ?? { logoMode: "full" };
    session.ui.sessionColorIndex = (getSessionColorIndex(session) + 1) % SESSION_COLORS.length;
    savePersistedRuntimeState(session);
    return { ok: true, output: formatColorStatus(session), activity: "color next" };
  }
  const value = command === "/color-set" ? args[0] : args[0]?.toLowerCase();
  if (args.length === 0 || (args.length === 1 && STATUS_ARGS.has(value ?? ""))) {
    return { ok: true, output: formatColorStatus(session), activity: "color status" };
  }
  if ((command === "/color-set" || command === "/color") && args.length === 1) {
    const index = Number.parseInt(args[0] ?? "", 10);
    if (!Number.isFinite(index)) {
      return { ok: false, message: "usage: /color [status|index] | /color-next | /color-set <index>", activity: "command failed · /color usage" };
    }
    session.ui = session.ui ?? { logoMode: "full" };
    session.ui.sessionColorIndex = Math.max(0, index) % SESSION_COLORS.length;
    savePersistedRuntimeState(session);
    return { ok: true, output: formatColorStatus(session), activity: `color set · ${String(session.ui.sessionColorIndex)}` };
  }
  return { ok: false, message: "usage: /color [status|index] | /color-next | /color-set <index>", activity: "command failed · /color usage" };
}

function handleSafeGitCommand(session: RuntimeSession, command: string, args: string[]): RuntimeCommandResult {
  const arg = args.join(" ").trim().toLowerCase();
  if (command === "/safegit-level") {
    return { ok: true, output: "level: high\nmode: high-risk git commands blocked; other shell git commands stay guarded by approval policy", activity: "safegit level" };
  }
  if (command === "/safegit-status" || args.length === 0 || (args.length === 1 && STATUS_ARGS.has(arg))) {
    return { ok: true, output: formatSafeGitStatus(session), activity: "safegit status" };
  }
  if (args.length === 1 && arg === "patterns") {
    return { ok: true, output: formatSafeGitPatterns(), activity: "safegit patterns" };
  }
  return { ok: false, message: "usage: /safegit [status|patterns] | /safegit-status | /safegit-level", activity: "command failed · /safegit usage" };
}

function writeTerminalMouseMode(session: RuntimeSession): void {
  const configured = getConfiguredMouseMode(session);
  const effective = getEffectiveMouseMode(session);
  if (configured === "scroll" && effective.mode === "scroll") {
    process.stdout.write("\x1b[?1007h\x1b[?1006h\x1b[?1000h");
    return;
  }
  if (configured === "auto" && detectMouseCapabilities().wheel) {
    process.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?1007h");
    return;
  }
  process.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?1007l");
}

function handleSkillCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  const skills = discoverSkills(session.cwd);
  if (args.length === 0) {
    return {
      ok: true,
      output: formatSkillList(session, skills),
      activity: "skill list",
    };
  }

  const [rawName, ...rawArgParts] = args;
  const skillName = normalizeSkillToken(rawName ?? "");
  const rawArgs = rawArgParts.join(" ");
  const resolution = resolveSkill(skills, skillName);
  if (!resolution) {
    const suggestions = rankClosestSkills(skills, skillName, 3);
    return {
      ok: false,
      message: [
        `unknown skill ${rawName}`,
        suggestions.length > 0 ? `closest: ${suggestions.map((skill) => skill.name).join(", ")}` : "closest: none",
        "hint: run /skill",
      ].join("\n"),
      activity: "skill lookup failed",
    };
  }

  const routedArgs = rawArgs.length > 0 ? rawArgs : "(none)";
  session.activeSkill = {
    name: resolution.skill.name,
    source: resolution.skill.source,
    path: resolution.skill.path,
    args: routedArgs,
    content: readSkillContent(resolution.skill.path),
  };
  refreshInstructionState(session);
  return {
    ok: true,
    output: [
      `skill resolved: ${resolution.skill.name}`,
      `resolution: ${resolution.mode}`,
      `source: ${resolution.skill.source}`,
      `path: ${resolution.skill.path}`,
      `args: ${routedArgs}`,
      `route: /skill ${resolution.skill.name}${rawArgs.length > 0 ? ` ${rawArgs}` : ""}`,
    ].join("\n"),
    activity: `skill routed · ${resolution.skill.name}`,
    autoInvokeAfterSkill: true,
  };
}

function handleBoomerangCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  const [firstArg, ...restArgs] = args;
  const mode = firstArg?.toLowerCase();
  if (!firstArg || STATUS_ARGS.has(mode ?? "")) {
    return {
      ok: true,
      output: formatBoomerangStatus(session),
      activity: "boomerang status",
    };
  }
  if (mode === "cancel") {
    const canceled = cancelBoomerang(session);
    return {
      ok: true,
      output: canceled ? "boomerang canceled" : "boomerang idle",
      activity: canceled ? "boomerang canceled" : "boomerang idle",
    };
  }

  const task = [firstArg, ...restArgs].join(" ").trim();
  if (!task) {
    return {
      ok: false,
      message: "usage: /boomerang <task> | /boomerang status | /boomerang cancel",
      activity: "command failed · /boomerang usage",
    };
  }
  beginBoomerang(session, task);
  return {
    ok: true,
    output: [`boomerang queued`, `task: ${task}`].join("\n"),
    activity: "boomerang queued",
    autoInvokeAfterSkill: true,
    invokePrompt: buildBoomerangPrompt(task),
    transcriptPrompt: `/boomerang ${task}`,
    promptSummary: "boomerang task accepted",
  };
}

function handleGoalCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  const trimmed = args.join(" ").trim();
  if (!trimmed || STATUS_ARGS.has(trimmed.toLowerCase())) {
    return { ok: true, output: formatGoalStatus(session.goal), activity: "goal status" };
  }
  const normalized = trimmed.toLowerCase();
  if (normalized === "statusbar" || normalized === "statusbar toggle" || normalized === "statusbar on" || normalized === "statusbar off") {
    const [, value] = normalized.split(/\s+/, 2);
    session.goal.statusBarEnabled = value === "on" ? true : value === "off" ? false : !session.goal.statusBarEnabled;
    savePersistedRuntimeState(session);
    return { ok: true, output: formatGoalStatus(session.goal), activity: `goal statusbar ${session.goal.statusBarEnabled ? "on" : "off"}` };
  }
  if (normalized === "pause") {
    const paused = pauseRuntimeGoal(session);
    return { ok: true, output: paused ? formatGoalStatus(session.goal) : "goal\nstatus: none", activity: paused ? "goal paused" : "goal idle" };
  }
  if (normalized === "resume") {
    const goal = resumeRuntimeGoal(session);
    if (!goal) {
      return { ok: true, output: "goal\nstatus: none", activity: "goal idle" };
    }
    return {
      ok: true,
      output: formatGoalStatus(session.goal),
      activity: "goal resumed",
      autoInvokeAfterSkill: true,
      invokePrompt: buildGoalContinuationPrompt(goal),
      transcriptPrompt: `/goal resume ${goal.id}`,
      promptSummary: "goal resumed",
    };
  }
  if (normalized === "clear") {
    const cleared = clearRuntimeGoal(session);
    return { ok: true, output: cleared ? "goal cleared" : "goal idle", activity: cleared ? "goal cleared" : "goal idle" };
  }
  const parsed = parseGoalTokenBudget(trimmed);
  if (parsed.error) {
    return { ok: false, message: parsed.error, activity: "command failed · /goal usage" };
  }
  if (!parsed.objective) {
    return {
      ok: false,
      message: "usage: /goal [--tokens 50k] <objective> | /goal status | /goal pause | /goal resume | /goal clear | /goal statusbar on|off",
      activity: "command failed · /goal usage",
    };
  }
  const goal = startRuntimeGoal(session, parsed.objective, parsed.tokenBudget);
  return {
    ok: true,
    output: formatGoalStatus(session.goal),
    activity: "goal active",
    autoInvokeAfterSkill: true,
    invokePrompt: buildGoalContinuationPrompt(goal),
    transcriptPrompt: `/goal ${parsed.objective}`,
    promptSummary: "goal active",
  };
}

function formatBoomerangStatus(session: RuntimeSession): string {
  const state = session.operationControls.boomerang;
  return [
    "boomerang",
    `active: ${state.active ? "true" : "false"}`,
    `task: ${state.task ?? "none"}`,
    `lastSummary: ${state.lastSummary ? firstBoomerangSummaryLine(state.lastSummary) : "none"}`,
  ].join("\n");
}

function handleBtwCommand(session: RuntimeSession, command: string, args: string[]): RuntimeCommandResult {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h" || args[0] === "help")) {
    return { ok: true, output: BTW_HELP, activity: "btw help" };
  }

  if (command === "/btw:clear") {
    if (args.length !== 0) {
      return { ok: false, message: "usage: /btw:clear", activity: "command failed · /btw usage" };
    }
    clearBtwThread(session);
    savePersistedRuntimeState(session);
    return { ok: true, output: "btw cleared", activity: "btw cleared" };
  }

  if (command === "/btw:model") {
    const value = args.join(" ").trim();
    session.btw.modelOverride = value === "clear" || !value ? null : value;
    session.btw.updatedAt = new Date().toISOString();
    savePersistedRuntimeState(session);
    return { ok: true, output: formatBtwStatus(session.btw), activity: "btw model" };
  }

  if (command === "/btw:thinking") {
    const value = args.join(" ").trim();
    session.btw.thinkingOverride = value === "clear" || !value ? null : value;
    session.btw.updatedAt = new Date().toISOString();
    savePersistedRuntimeState(session);
    return { ok: true, output: formatBtwStatus(session.btw), activity: "btw thinking" };
  }

  if (command === "/btw:inject" || command === "/btw:summarize") {
    if (session.btw.thread.length === 0) {
      return { ok: false, message: "No BTW thread to inject.", activity: "command failed · /btw empty" };
    }
    const summarize = command === "/btw:summarize";
    const prompt = buildBtwInjectPrompt(session.btw, args.join(" "), summarize);
    clearBtwThread(session);
    savePersistedRuntimeState(session);
    return {
      ok: true,
      output: summarize ? "btw summary queued for main agent" : "btw thread queued for main agent",
      activity: summarize ? "btw summarize" : "btw inject",
      autoInvokeAfterSkill: true,
      invokePrompt: prompt,
      transcriptPrompt: `${command}${args.length > 0 ? ` ${args.join(" ")}` : ""}`,
      promptSummary: summarize ? "btw summary injected" : "btw thread injected",
    };
  }

  if (command === "/btw:new") {
    clearBtwThread(session, "contextual");
    if (args.length === 0) {
      session.btw.visible = true;
      savePersistedRuntimeState(session);
      return { ok: true, output: "btw new thread ready", activity: "btw new" };
    }
    return startBtwProviderTurn(session, "contextual", args.join(" "));
  }

  if (command === "/btw:tangent") {
    const parsed = parseBtwArgs(args);
    if (!parsed.question) {
      return { ok: false, message: "usage: /btw:tangent [--save] <question>", activity: "command failed · /btw usage" };
    }
    return startBtwProviderTurn(session, "tangent", parsed.question, parsed.save);
  }

  const parsed = parseBtwArgs(args);
  if (!parsed.question) {
    return { ok: true, output: formatBtwStatus(session.btw), activity: "btw status" };
  }
  return startBtwProviderTurn(session, "contextual", parsed.question, parsed.save);
}

const BTW_HELP = [
  "btw",
  "usage: /btw [--save] <question>",
  "usage: /btw:new [question]",
  "usage: /btw:tangent [--save] <question>",
  "usage: /btw:clear",
  "usage: /btw:inject [instructions]",
  "usage: /btw:summarize [instructions]",
  "usage: /btw:model [model|clear]",
  "usage: /btw:thinking [effort|clear]",
  "",
  "/btw asks a contextual side question without adding the exchange to the main conversation until injected.",
  "/btw:clear removes pending/thread state from prompt overlays.",
].join("\n");

function parseBtwArgs(args: string[]): { question: string; save: boolean } {
  const save = args.includes("--save") || args.includes("-s");
  return {
    save,
    question: args.filter((arg) => arg !== "--save" && arg !== "-s").join(" ").trim(),
  };
}

function startBtwProviderTurn(session: RuntimeSession, mode: RuntimeBtwMode, question: string, save = false): RuntimeCommandResult {
  const prompt = beginBtwTurn(session, mode, question, save);
  savePersistedRuntimeState(session);
  return {
    ok: true,
    output: `btw ${mode} queued`,
    activity: `btw ${mode}`,
    autoInvokeAfterSkill: true,
    invokePrompt: prompt,
    transcriptPrompt: `/btw ${question}`,
    promptSummary: `btw ${mode} side question accepted`,
  };
}

function handleAgentsCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length !== 0) {
    return {
      ok: false,
      message: "usage: /agents",
      activity: "command failed · /agents usage",
    };
  }
  return {
    ok: true,
    output: formatSubagentsStatus(session),
    activity: "agents status",
  };
}

export function buildActiveSkillExecutionPrompt(session: RuntimeSession, originalCommand: string): string {
  const skill = session.activeSkill;
  if (!skill) {
    return originalCommand;
  }

  return [
    `Execute active skill ${skill.name} now.`,
    `Args: ${skill.args || "(none)"}`,
    `Original command: ${originalCommand}`,
    "Follow skill workflow end-to-end with available tools.",
    "Do not only acknowledge activation, readiness, or start state.",
    "Ask only for required approval gates or real blockers.",
  ].join("\n");
}

function formatDiagnosticSection(
  title: string,
  detailMode: DetailMode,
  compactRows: readonly DiagnosticRow[],
  verboseRows: readonly DiagnosticRow[] = compactRows,
): string[] {
  const rows = detailMode === "verbose" ? verboseRows : compactRows;
  return [
    `${title}`,
    ...rows.map(([key, value]) => `${key}: ${value}`),
  ];
}

export function formatCommandBoundary(event: RuntimeSession["events"][number]): string[] {
  const base = `[cmd-result] ${event.at} · ${event.status} · ${event.summary}`;
  if (!event.detail) {
    return [base];
  }

  return [
    base,
    ...event.detail.split("\n").map((line) => `  ${line}`),
  ];
}

function handleHelpCommand(args: string[]): RuntimeCommandResult {
  if (args.length !== 0) {
    return {
      ok: false,
      message: "usage: /help",
      activity: "command failed · /help usage",
    };
  }

  return {
    ok: true,
    output: formatCommandCatalog(),
    activity: "help",
  };
}

function handleKeysCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length !== 0) {
    return {
      ok: false,
      message: "usage: /keys",
      activity: "command failed · /keys usage",
    };
  }

  return {
    ok: true,
    output: formatOpenTuiKeymap(session),
    activity: "keys",
  };
}

function handleReloadCommand(args: string[]): RuntimeCommandResult {
  if (args.length !== 0) {
    return {
      ok: false,
      message: "usage: /reload",
      activity: "command failed · /reload usage",
    };
  }

  return {
    ok: true,
    output: "runtime reload requested (config/state only; code edits require restart)",
    activity: "reload requested",
  };
}

function handleQuitCommand(args: string[]): RuntimeCommandResult {
  if (args.length !== 0) {
    return {
      ok: false,
      message: "usage: /quit",
      activity: "command failed · /quit usage",
    };
  }

  return {
    ok: true,
    output: "quit requested",
    activity: "quit requested",
  };
}

function handleLoginCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length === 0) {
    const result = launchCodexLogin(session.cwd);
    session.auth = result.auth;
    session.providerTransport.authGate = session.auth.loggedIn ? "ready" : "missing";
    savePersistedRuntimeState(session);

    if (!result.launched) {
      return {
        ok: false,
        message: session.auth.status,
        activity: "login failed · launch",
      };
    }

    if (session.auth.loggedIn) {
      return {
        ok: true,
        output: formatAuthStatus(session),
        activity: "login complete · codex",
      };
    }

    return {
      ok: false,
      message: formatAuthStatus(session),
      activity: "login incomplete · codex",
    };
  }

  if (args.length === 1 && args[0] === "status") {
    session.auth = probeCodexAuthStateSync();
    session.providerTransport.authGate = session.auth.loggedIn ? "ready" : "missing";
    savePersistedRuntimeState(session);
    return {
      ok: true,
      output: formatAuthStatus(session),
      activity: `login status · ${session.auth.loggedIn ? "ready" : "missing"}`,
    };
  }

  return {
    ok: false,
    message: "usage: /login [status]",
    activity: "command failed · /login usage",
  };
}

function handleCodexCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length === 0 || (args.length === 1 && args[0] === "status")) {
    return {
      ok: true,
      output: formatCodexStatus(session),
      activity: `codex status · ${session.provider}`,
    };
  }

  if (args.length !== 1) {
    return {
      ok: false,
      message: "usage: /codex [status|off]",
      activity: "command failed · /codex usage",
    };
  }

  if (args[0] === "off") {
    const fallbackProvider = resolveFallbackProvider(session);
    if (!fallbackProvider) {
      return {
        ok: false,
        message: "no alternate provider configured",
        activity: "codex rejected · off",
      };
    }

    applyProviderSelection(session, fallbackProvider);
    savePersistedRuntimeState(session);
    return {
      ok: true,
      output: formatCodexStatus(session),
      activity: `codex off · ${fallbackProvider}`,
    };
  }

  if (!session.auth.loggedIn) {
    return {
      ok: false,
      message: "codex login required; run /login",
      activity: "codex rejected · auth",
    };
  }

  applyProviderSelection(session, "codex");
  savePersistedRuntimeState(session);
  return {
    ok: true,
    output: formatCodexStatus(session),
    activity: "codex on · codex",
  };
}

function handleMemoryCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  const mutation = parseMemoryMutationCommand(`/memory ${args.join(" ")}`);
  if (mutation) {
    try {
      return {
        ok: true,
        output: applyMemoryMutationCommandSync(session, mutation),
        activity: mutation.kind === "checkpoint" ? "memory checkpoint" : mutation.kind === "session" ? "memory session" : "memory save",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        activity: `command failed · /memory ${mutation.kind}`,
      };
    }
  }

  const { detailMode, args: normalizedArgs } = splitVerboseArg(args);
  if (normalizedArgs.length === 1 && STATUS_ARGS.has(normalizedArgs[0]?.toLowerCase() ?? "")) {
    return {
      ok: true,
      output: formatMemoryStatus(session, detailMode),
      activity: "memory status",
    };
  }
  if (normalizedArgs.length === 1 && isMemoryMaintenanceArg(normalizedArgs[0] ?? "")) {
    try {
      return {
        ok: true,
        output: formatMemoryMaintenanceStatus(maintainArchivistMemorySync(session)),
        activity: "memory maintenance",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        activity: "command failed · /memory maintenance",
      };
    }
  }

  if (normalizedArgs.length !== 0) {
    return {
      ok: false,
      message: "usage: /memory [status|--verbose|--maintenance] | /memory save <text> | /memory checkpoint [reason] | /memory session [focus]",
      activity: "command failed · /memory usage",
    };
  }

  return {
    ok: true,
    output: formatMemoryStatus(session, detailMode),
    activity: "memory status",
  };
}

function handleLspCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length === 0 || (args.length === 1 && STATUS_ARGS.has(args[0]?.toLowerCase() ?? ""))) {
    return {
      ok: true,
      output: formatLspStatus(session),
      activity: "lsp status",
    };
  }
  if (args.length === 1 && args[0] === "setup") {
    return {
      ok: true,
      output: formatLspSetup(session),
      activity: "lsp setup",
    };
  }
  if (args.length === 1 && args[0] === "health") {
    return {
      ok: true,
      output: formatLspHealth(session),
      activity: "lsp health",
    };
  }
  if (args.length === 1 && args[0] === "warm") {
    return {
      ok: true,
      output: warmLspWorkspaceSync(session).output,
      activity: "lsp warm",
    };
  }
  if (args.length === 2 && args[0] === "mode") {
    const next = args[1]?.toLowerCase();
    if (!ENABLE_ARGS.has(next ?? "") && !DISABLE_ARGS.has(next ?? "")) {
      return {
        ok: false,
        message: LSP_USAGE,
        activity: "command failed · /lsp usage",
      };
    }
    session.lsp = ensureDefaultLspState(session);
    session.lsp.enabled = ENABLE_ARGS.has(next ?? "");
    savePersistedRuntimeState(session);
    return {
      ok: true,
      output: formatLspStatus(session),
      activity: `lsp ${session.lsp.enabled ? "on" : "off"}`,
    };
  }
  if (args.length === 2 && args[0] === "symbols") {
    try {
      return {
        ok: true,
        output: summarizeLspSymbolsSync(session, args[1] ?? "").output,
        activity: "lsp symbols",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        activity: "command failed · /lsp symbols",
      };
    }
  }
  if (args.length === 2 && args[0] === "diagnostics") {
    try {
      return {
        ok: true,
        output: summarizeLspDiagnosticsSync(session, args[1] ?? "").output,
        activity: "lsp diagnostics",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        activity: "command failed · /lsp diagnostics",
      };
    }
  }
  if ((args.length === 1 || args.length === 2) && (args[0] === "check" || args[0] === "workspace")) {
    try {
      return {
        ok: true,
        output: scanLspWorkspaceSync(session, args[1] ?? ".").output,
        activity: "lsp workspace",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        activity: "command failed · /lsp workspace",
      };
    }
  }
  if (args[0] === "nav" || args[0] === "navigation") {
    const operation = args[1] ?? "";
    const filePath = args[2];
    const line = args[3] ? Number.parseInt(args[3], 10) : undefined;
    const character = args[4] ? Number.parseInt(args[4], 10) : undefined;
    try {
      return {
        ok: true,
        output: summarizeLspNavigationSync(session, {
          operation,
          filePath,
          line,
          character,
          query: operation === "workspaceSymbol" ? args.slice(2).join(" ") : undefined,
        }).output,
        activity: "lsp navigation",
      };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        activity: "command failed · /lsp navigation",
      };
    }
  }
  return {
    ok: false,
    message: LSP_USAGE,
    activity: "command failed · /lsp usage",
  };
}

const LSP_USAGE = "usage: /lsp [status|setup|health|warm|mode <on|off>|symbols <path>|diagnostics <path>|check [path]|nav <operation> [path] [line] [character]]";
const SCIP_USAGE = "usage: /scip [status|symbols <path>|diagnostics <path>|check [path]]";
const CONFIG_USAGE = "usage: /config [status] | /config [set] logo <full|condensed|off> | /config [set] lsp <on|off> | /config [set] lsp-index <on|off> | /config [set] key <action> <key|clear>";

function handleScipCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length === 0 || (args.length === 1 && STATUS_ARGS.has(args[0]?.toLowerCase() ?? ""))) {
    return {
      ok: true,
      output: ["pi-agent-scip compatibility", formatLspStatus(session)].join("\n"),
      activity: "scip status",
    };
  }
  if (args[0] === "symbols" || args[0] === "diagnostics" || args[0] === "check") {
    return handleLspCommand(session, args);
  }
  return {
    ok: false,
    message: SCIP_USAGE,
    activity: "command failed · /scip usage",
  };
}

function handleConfigCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length === 0 || (args.length === 1 && STATUS_ARGS.has(args[0]?.toLowerCase() ?? ""))) {
    return {
      ok: true,
      output: formatConfigStatus(session),
      activity: "config status",
    };
  }
  const mutationArgs = args[0]?.toLowerCase() === "set" ? args.slice(1) : args;
  if (mutationArgs.length === 3 && mutationArgs[0]?.toLowerCase() === "key") {
    const action = normalizeKeybindingAction(mutationArgs[1] ?? "");
    const rawKey = mutationArgs[2] ?? "";
    if (!action) {
      return {
        ok: false,
        message: CONFIG_USAGE,
        activity: "command failed · /config usage",
      };
    }
    session.ui = session.ui ?? { logoMode: "full" };
    const overrides = { ...(session.ui.keybindings ?? {}) };
    if (DISABLE_ARGS.has(rawKey.toLowerCase()) || rawKey.toLowerCase() === "clear") {
      delete overrides[action];
    } else {
      const key = normalizeKeybindingKey(rawKey);
      if (!key) {
        return {
          ok: false,
          message: CONFIG_USAGE,
          activity: "command failed · /config usage",
        };
      }
      overrides[action] = key;
      const conflicts = detectKeybindingConflicts(overrides);
      if (conflicts.length > 0) {
        return {
          ok: false,
          message: `keybinding conflict: ${conflicts[0]}`,
          activity: "command failed · keybinding conflict",
        };
      }
    }
    session.ui.keybindings = Object.keys(overrides).length > 0 ? overrides : undefined;
    savePersistedRuntimeState(session);
    return {
      ok: true,
      output: formatConfigStatus(session),
      activity: `config key · ${action}`,
    };
  }
  if (mutationArgs.length === 2) {
    const section = mutationArgs[0]?.toLowerCase();
    const value = mutationArgs[1]?.toLowerCase() ?? "";
    if (section === "logo") {
      if (value !== "full" && value !== "condensed" && value !== "off") {
        return {
          ok: false,
          message: CONFIG_USAGE,
          activity: "command failed · /config usage",
        };
      }
      session.ui = session.ui ?? { logoMode: "full" };
      session.ui.logoMode = value;
      savePersistedRuntimeState(session);
      return {
        ok: true,
        output: formatConfigStatus(session),
        activity: `config logo · ${value}`,
      };
    }
    if (section === "lsp" || section === "lsp-index") {
      if (!ENABLE_ARGS.has(value) && !DISABLE_ARGS.has(value)) {
        return {
          ok: false,
          message: CONFIG_USAGE,
          activity: "command failed · /config usage",
        };
      }
      const enabled = ENABLE_ARGS.has(value);
      session.lsp = ensureDefaultLspState(session);
      if (section === "lsp") {
        session.lsp.enabled = enabled;
      } else {
        session.lsp.indexArchivist = enabled;
      }
      savePersistedRuntimeState(session);
      return {
        ok: true,
        output: formatConfigStatus(session),
        activity: `config ${section} · ${enabled ? "on" : "off"}`,
      };
    }
  }
  return {
    ok: false,
    message: CONFIG_USAGE,
    activity: "command failed · /config usage",
  };
}

function ensureDefaultLspState(session: RuntimeSession): RuntimeSession["lsp"] {
  session.lsp = session.lsp ?? {
    enabled: true,
    command: "typescript-language-server",
    args: ["--stdio"],
    indexArchivist: false,
  };
  session.lsp.command = session.lsp.command ?? "typescript-language-server";
  session.lsp.args = session.lsp.args.length > 0 ? session.lsp.args : ["--stdio"];
  return session.lsp;
}

function isMemoryMaintenanceArg(arg: string): boolean {
  return arg === "--maintenance" || arg === "--maintance" || arg === "maintenance" || arg === "maintance";
}

function handleStatusCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  const { detailMode, args: statusArgs } = splitVerboseArg(args);
  if (statusArgs.length === 1 && statusArgs[0]?.toLowerCase() === "dashboard") {
    return {
      ok: true,
      output: formatRuntimeDashboardStatus(session),
      activity: "status dashboard",
    };
  }
  const hasSentryStatus = statusArgs.includes("--sentry");
  const sendSentryTestEvent = statusArgs.includes("--send-test-event");
  if (sendSentryTestEvent && !hasSentryStatus) {
    return {
      ok: false,
      message: "usage: /status [--verbose|--sentry [--send-test-event]]",
      activity: "command failed · /status usage",
    };
  }
  if (hasSentryStatus) {
    const normalizedArgs = statusArgs.filter((arg) => arg !== "--sentry" && arg !== "--send-test-event");
    if (normalizedArgs.length !== 0) {
      return {
        ok: false,
        message: "usage: /status [--verbose|--sentry [--send-test-event]]",
        activity: "command failed · /status usage",
      };
    }
    const output = formatSentryStatus(sendSentryTestEvent);
    return {
      ok: true,
      output,
      activity: sendSentryTestEvent ? "sentry status · test event" : "sentry status",
    };
  }
  if (statusArgs.length !== 0) {
    return {
      ok: false,
      message: "usage: /status [--verbose|--sentry [--send-test-event]]",
      activity: "command failed · /status usage",
    };
  }

  return {
    ok: true,
    output: formatRuntimeStatus(session, detailMode),
    activity: "status",
  };
}

function handleStatuslineCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  const first = args[0]?.toLowerCase() ?? "";
  if (first === "command") {
    const command = args.slice(1).join(" ").trim();
    session.ui = session.ui ?? { logoMode: "full" };
    if (!command || DISABLE_ARGS.has(command.toLowerCase()) || command.toLowerCase() === "clear") {
      session.ui.statuslineCommand = undefined;
      savePersistedRuntimeState(session);
      return {
        ok: true,
        output: "Statusline command cleared.",
        activity: "statusline command cleared",
      };
    }
    session.ui.statuslineCommand = command;
    savePersistedRuntimeState(session);
    return {
      ok: true,
      output: `Statusline command set. Preview: ${formatCustomStatusline(session) ?? "unavailable"}`,
      activity: "statusline command set",
    };
  }
  return handleStyleToggleCommand(session, args, "statusline");
}

function handleUsageCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length !== 0) {
    return {
      ok: false,
      message: "usage: /usage",
      activity: "command failed · /usage usage",
    };
  }

  return {
    ok: true,
    output: formatUsageStatus(session),
    activity: "usage",
  };
}

function handleTodosCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length > 1) {
    return {
      ok: false,
      message: "usage: /todos [pending|in_progress|completed|all|clear]",
      activity: "command failed · /todos usage",
    };
  }
  const mode = args[0] ?? "active";
  if (!["active", "pending", "in_progress", "completed", "all", "clear"].includes(mode)) {
    return {
      ok: false,
      message: "usage: /todos [pending|in_progress|completed|all|clear]",
      activity: "command failed · /todos usage",
    };
  }
  if (mode === "clear") {
    clearRuntimeTodos(session.todos);
    savePersistedRuntimeState(session);
    return {
      ok: true,
      output: "todos cleared",
      activity: "todos",
    };
  }
  return {
    ok: true,
    output: formatTodosCommandOutput(session.todos, mode),
    activity: "todos",
  };
}

function handleDoctorCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length !== 0) {
    return {
      ok: false,
      message: "usage: /doctor",
      activity: "command failed · /doctor usage",
    };
  }

  return {
    ok: true,
    output: formatDoctorStatus(session),
    activity: "doctor status",
  };
}

function formatUsageStatus(session: RuntimeSession): string {
  const persisted = loadPiUsageStats(session.cwd);
  const usage = persisted.messages > 0 ? null : collectCurrentSessionUsage(session);
  const rows = persisted.messages > 0 ? createUsageBarRowsFromStats(persisted) : [{
    provider: usage!.provider,
    model: usage!.model,
    sessions: usage!.sessions,
    messages: usage!.assistantMessages,
    turns: usage!.turns,
    input: usage!.inputTokens,
    output: usage!.outputTokens,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0,
    tokens: usage!.tokens,
  }];
  const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0);
  const totalSessions = persisted.messages > 0 ? persisted.sessions.size : 1;
  const totalMessages = persisted.messages > 0 ? persisted.messages : usage!.assistantMessages;
  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);
  const sortedRows = [...rows].sort((a, b) => b.tokens - a.tokens);
  const visibleRows = sortedRows.slice(0, 8);
  const hiddenRows = sortedRows.length - visibleRows.length;
  const period = persisted.messages > 0
    ? "all time · Pi-compatible JSONL"
    : `current session · ${formatUsageDuration(usage!.startedAt, usage!.lastAt)}`;
  const lines = [
    "usage",
    `${period} · sessions ${formatUsageNumber(totalSessions)} · messages ${formatUsageNumber(totalMessages)} · tokens ${formatUsageNumber(totalTokens)} · cost ${formatUsageCost(totalCost)}`,
    "",
  ];
  for (const row of visibleRows) {
    const share = totalTokens > 0 ? (row.tokens / totalTokens) * 100 : 0;
    lines.push(`${row.provider} / ${row.model}`);
    lines.push(`${formatUsageBar(share, 18)} ${formatUsagePercent(share)} share · ${formatUsageNumber(row.tokens)} tokens`);
    lines.push([
      `in ${formatUsageNumber(row.input + row.cacheWrite)}`,
      `out ${formatUsageNumber(row.output)}`,
      `cache ${formatUsageNumber(row.cacheRead + row.cacheWrite)}`,
      `msgs ${formatUsageNumber(row.messages)}`,
      `cost ${formatUsageCost(row.cost)}`,
    ].join(" · "));
    lines.push("");
  }
  if (hiddenRows > 0) {
    lines.push(`+${String(hiddenRows)} more provider/model rows`);
    lines.push("");
  }
  lines.push("notes: local telemetry only; bars show token share, not provider quota");
  return lines.join("\n").trimEnd();
}

type UsageBarRow = {
  provider: string;
  model: string;
  sessions: number;
  messages: number;
  turns: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  tokens: number;
};

function createUsageBarRowsFromStats(stats: UsageStats): UsageBarRow[] {
  const rows: UsageBarRow[] = [];
  for (const [provider, providerStats] of stats.providers.entries()) {
    for (const [model, modelStats] of providerStats.models.entries()) {
      rows.push({
        provider,
        model,
        sessions: modelStats.sessions.size,
        messages: modelStats.messages,
        turns: modelStats.messages,
        input: modelStats.input,
        output: modelStats.output,
        cacheRead: modelStats.cacheRead,
        cacheWrite: modelStats.cacheWrite,
        cost: modelStats.cost,
        tokens: usageFreshTokens(modelStats),
      });
    }
  }
  return rows;
}

function usageFreshTokens(stats: Pick<UsageStats, "input" | "output" | "cacheWrite">): number {
  return stats.input + stats.output + stats.cacheWrite;
}

function formatUsageBar(percent: number, width: number): string {
  const bounded = Math.max(0, Math.min(100, percent));
  const filled = Math.min(width, Math.round((bounded / 100) * width));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function formatUsagePercent(percent: number): string {
  if (percent >= 99.5) {
    return "100%";
  }
  if (percent < 1 && percent > 0) {
    return "<1%";
  }
  return `${Math.round(percent).toString()}%`;
}

function formatUsageCost(cost: number): string {
  if (cost === 0) {
    return "n/a";
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  if (cost < 100) {
    return `$${cost.toFixed(2)}`;
  }
  return `$${Math.round(cost)}`;
}

function collectCurrentSessionUsage(session: RuntimeSession): {
  provider: string;
  model: string;
  sessions: number;
  turns: number;
  assistantMessages: number;
  inputTokens: number;
  outputTokens: number;
  tokens: number;
  startedAt: string;
  lastAt: string;
} {
  const completedTurns = session.events.filter((event) =>
    event.kind === "control" && event.status === "completed" && /\bturn run\b/i.test(event.summary)
  );
  const tokenTotals = completedTurns.reduce((totals, event) => {
    const detail = event.detail ?? "";
    totals.input += readUsageMetric(detail, "turn_in") || readUsageMetric(detail, "in");
    totals.output += readUsageMetric(detail, "turn_out") || readUsageMetric(detail, "out");
    return totals;
  }, { input: 0, output: 0 });

  const conversationInput = session.conversation
    .filter((turn) => turn.role === "user")
    .reduce((sum, turn) => sum + turn.tokens, 0);
  const conversationOutput = session.conversation
    .filter((turn) => turn.role === "assistant")
    .reduce((sum, turn) => sum + turn.tokens, 0);
  const inputTokens = tokenTotals.input || session.telemetry.lastInputTokens || conversationInput;
  const outputTokens = tokenTotals.output || session.telemetry.lastOutputTokens || conversationOutput;
  const assistantMessages = Math.max(
    session.conversation.filter((turn) => turn.role === "assistant").length,
    session.events.filter((event) => event.kind === "assistant" && event.status === "completed").length,
  );
  const lastEventAt = [...session.events].reverse().find((event) => event.at)?.at;
  return {
    provider: session.providerTransport.activeProvider,
    model: getCurrentProviderModel(session),
    sessions: 1,
    turns: completedTurns.length || session.telemetry.turnCount,
    assistantMessages,
    inputTokens,
    outputTokens,
    tokens: inputTokens + outputTokens,
    startedAt: session.startedAt,
    lastAt: lastEventAt ?? new Date().toISOString(),
  };
}

function readUsageMetric(detail: string, key: "in" | "out" | "turn_in" | "turn_out"): number {
  const match = new RegExp(`(?:^|[;\\s])${key}~(\\d+)`).exec(detail);
  return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
}

function formatUsageNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatUsageDuration(startedAt: string, lastAt: string): string {
  const start = Date.parse(startedAt);
  const end = Date.parse(lastAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return "0s";
  }
  const seconds = Math.floor((end - start) / 1000);
  if (seconds < 60) {
    return `${String(seconds)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${String(minutes)}m`;
  }
  return `${String(Math.floor(minutes / 60))}h`;
}

function formatSentryStatus(sendTestEvent: boolean): string {
  const status = getSentryDiagnosticsStatus();
  const selfTest = runSentryDiagnosticsSelfTest({ sendEvent: sendTestEvent });
  return formatDiagnosticSection("sentry", "compact", [
    ["enabled", String(status.enabled)],
    ["initialized", String(status.initialized)],
    ["dsn", status.dsnConfigured ? "configured" : "missing"],
    ["environment", status.environment],
    ["release", status.release],
    ["platform", status.platform],
    ["runtime", status.runtime],
    ["redaction", status.redactionMode],
    ["self-test", selfTest.sent ? "event requested" : "dry-run"],
  ]).join("\n");
}

function handleContinueCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length !== 0) {
    return {
      ok: false,
      message: "usage: /continue",
      activity: "command failed · /continue usage",
    };
  }

  const completion = deriveTurnCompletionState(session);
  if (completion.state === "blocked" || completion.state === "pending") {
    return {
      ok: false,
      message: `cannot continue: ${completion.objective}${completion.blocker ? ` · blocker=${completion.blocker}` : ""}`,
      activity: "continue blocked",
    };
  }

  if (completion.state === "running") {
    return {
      ok: true,
      output: `turn ${completion.state}: ${completion.objective}`,
      activity: "continue running",
    };
  }

  return {
    ok: true,
    output: `turn ${completion.state}: ${completion.objective}`,
    activity: "continue complete",
  };
}

function handleFinishCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length !== 0) {
    return {
      ok: false,
      message: "usage: /finish",
      activity: "command failed · /finish usage",
    };
  }

  const completion = deriveTurnCompletionState(session);
  if (completion.state !== "finished" || completion.unverified) {
    return {
      ok: false,
      message: `finish blocked: state=${completion.state} objective=${completion.objective}${completion.blocker ? ` blocker=${completion.blocker}` : ""} ${completion.unverified ? "(unverified)" : ""}`.trim(),
      activity: "finish blocked",
    };
  }

  return {
    ok: true,
    output: `turn finished: ${completion.objective}`,
    activity: "finish complete",
  };
}

function handleStyleToggleCommand(
  session: RuntimeSession,
  args: string[],
  mode: "cavemanMode" | "deadpoolMode" | "statusline",
): RuntimeCommandResult {
  const arg = args.join(" ").trim().toLowerCase();
  if (args.length > 1 || (arg.length > 0 && !ENABLE_ARGS.has(arg) && !DISABLE_ARGS.has(arg) && !STATUS_ARGS.has(arg))) {
    return {
      ok: false,
      message: `usage: /${mode === "deadpoolMode" ? "deadpoolmode" : mode === "statusline" ? "statusline" : "caveman-mode"} [on|off|status]`,
      activity: `command failed · /${mode === "deadpoolMode" ? "deadpoolmode" : mode === "statusline" ? "statusline" : "caveman-mode"} usage`,
    };
  }

  if (STATUS_ARGS.has(arg)) {
    return {
      ok: true,
      output: formatStyleModeStatus(session, mode),
      activity: `${formatStyleModeName(mode)} status`,
    };
  }

  const nextValue = ENABLE_ARGS.has(arg) ? true : DISABLE_ARGS.has(arg) ? false : !session.commandModes[mode];
  session.commandModes[mode] = nextValue;
  if (mode === "cavemanMode" || mode === "deadpoolMode") {
    refreshInstructionState(session);
  }
  savePersistedRuntimeState(session);
  return {
    ok: true,
    output: formatStyleModeStatus(session, mode),
    activity: `${formatStyleModeName(mode)} ${nextValue ? "on" : "off"}`,
  };
}

function handleHooksCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length !== 0) {
    return {
      ok: false,
      message: "usage: /hooks",
      activity: "command failed · /hooks usage",
    };
  }

  return {
    ok: true,
    output: formatHooksStatus(session),
    activity: "hooks status",
  };
}

function handleExtensionsCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length !== 0) {
    return {
      ok: false,
      message: "usage: /extensions",
      activity: "command failed · /extensions usage",
    };
  }
  return {
    ok: true,
    output: formatRuntimeExtensionsStatus(session),
    activity: "extensions status",
  };
}

function handleExtensionRuntimeCommand(session: RuntimeSession, command: string, args: string[]): RuntimeCommandResult | null {
  const extensionCommand = findRuntimeExtensionCommand(session, command);
  if (!extensionCommand) {
    return null;
  }
  try {
    const output = extensionCommand.handler(createRuntimeExtensionArgs(args), createRuntimeExtensionContext(session));
    if (output && typeof (output as Promise<unknown>).then === "function") {
      void (output as Promise<unknown>).catch((error) => {
        session.extensions?.invalidEntries.push(`${command}: ${error instanceof Error ? error.message : String(error)}`);
      });
      return {
        ok: true,
        output: "queued",
        activity: `extension ${command}`,
      };
    }
    return {
      ok: true,
      output: formatExtensionCommandOutput(output),
      activity: `extension ${command}`,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      activity: `command failed · ${command}`,
    };
  }
}

function formatExtensionCommandOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (output === undefined || output === null) {
    return "ok";
  }
  if (typeof output === "object" && "message" in output && typeof (output as { message?: unknown }).message === "string") {
    return (output as { message: string }).message;
  }
  return JSON.stringify(output, null, 2);
}

function handleToolsCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  const { detailMode, args: normalizedArgs } = splitVerboseArg(args);
  if (normalizedArgs.length !== 0) {
    return {
      ok: false,
      message: "usage: /tools [--verbose]",
      activity: "command failed · /tools usage",
    };
  }

  return {
    ok: true,
    output: formatToolPolicyStatus(session, detailMode),
    activity: "tools status",
  };
}

function handleWhyBlockedCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length !== 0) {
    return {
      ok: false,
      message: "usage: /why-blocked",
      activity: "command failed · /why-blocked usage",
    };
  }

  const report = session.operationControls.lastShellBlocker;
  if (!report) {
    return {
      ok: true,
      output: "lastShellBlocker: none",
      activity: "why-blocked · none",
    };
  }

  return {
    ok: true,
    output: formatShellBlockerStatus(report),
    activity: "why-blocked · shell",
  };
}

function handleNexsightCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  const [subcommand = "stats", ...rest] = args;
  if (subcommand === "stats" || subcommand === "status") {
    const result = getNexsightStats(session);
    return result.ok
      ? { ok: true, output: result.output, activity: "nexsight stats" }
      : { ok: false, message: result.output, activity: "nexsight failed · stats" };
  }
  if (subcommand === "doctor") {
    return {
      ok: true,
      output: formatDiagnosticSection("nexsight", "compact", [
        ["store", path.join(session.cwd, ".nexagent", "nexsight", "index.json")],
        ["execute", "shell,javascript,python; lean shell compression"],
        ["read", "auto,full,map,signatures,outline,lines:N-M"],
        ["index", "sqlite/json chunks; repo batch; session checkpoints"],
        ["routing", "large outputs should use nexsight_gather/execute/read/index/search"],
      ]).join("\n"),
      activity: "nexsight doctor",
    };
  }
  if (subcommand === "purge") {
    const result = purgeNexsight(session);
    return result.ok
      ? { ok: true, output: result.output, activity: "nexsight purge" }
      : { ok: false, message: result.output, activity: "nexsight failed · purge" };
  }
  if (subcommand === "search") {
    const query = rest.join(" ").trim();
    if (!query) {
      return { ok: false, message: "usage: /nexsight search <query>", activity: "command failed · /nexsight search usage" };
    }
    const result = searchNexsight(session, { query });
    return result.ok
      ? { ok: true, output: result.output, activity: `nexsight search · ${query}` }
      : { ok: false, message: result.output, activity: `nexsight failed · ${query}` };
  }
  if (subcommand === "read") {
    const target = rest[0];
    if (!target) {
      return { ok: false, message: "usage: /nexsight read <path> [mode]", activity: "command failed · /nexsight read usage" };
    }
    const mode = rest[1];
    return toolResultToCommandResult("nexsight", "read", executeInternalTool(session, {
      name: "nexsight_read",
      arguments: {
        path: target,
        ...(mode ? { mode } : {}),
      },
    }));
  }
  if (subcommand === "gather") {
    const root = rest[0] ?? ".";
    const pattern = rest[1];
    const query = rest.slice(2).join(" ").trim();
    return toolResultToCommandResult("nexsight", "gather", executeInternalTool(session, {
      name: "nexsight_gather",
      arguments: {
        root,
        ...(pattern ? { pattern } : {}),
        ...(query ? { query } : {}),
      },
    }));
  }
  if (subcommand === "index") {
    if (!rest[0]) {
      return { ok: false, message: "usage: /nexsight index <path> [pattern]", activity: "command failed · /nexsight index usage" };
    }
    const root = rest[0];
    const pattern = rest[1];
    return toolResultToCommandResult("nexsight", "index", executeInternalTool(session, {
      name: "nexsight_batch",
      arguments: {
        root,
        ...(pattern ? { pattern } : {}),
      },
    }));
  }
  return {
    ok: false,
    message: "usage: /nexsight [stats|gather <root> [pattern] [query]|read <path> [mode]|index <path> [pattern]|search <query>|purge|doctor]",
    activity: "command failed · /nexsight usage",
  };
}

function handleCompactCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length > 1 || (args.length === 1 && args[0] !== "status")) {
    return {
      ok: false,
      message: "usage: /compact [status]",
      activity: "command failed · /compact usage",
    };
  }

  if (args[0] === "status") {
    return {
      ok: true,
      output: formatCompactionStatus(session),
      activity: "compact status",
    };
  }

  const beforeTokens = estimateConversationTokens(session);
  const afterTokens = compactConversation(session, "manual");
  return {
    ok: true,
    output: [
      "manual compaction completed",
      `summary=${session.compaction.summary ? "present" : "none"} · turns=${String(session.conversation.length)} · tokens=${String(beforeTokens)}->${String(afterTokens)}`,
    ].join("\n"),
    activity: `compact manual · ${beforeTokens} -> ${afterTokens}`,
  };
}

function handleApprovalCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  const arg = args.join(" ").trim().toLowerCase();
  if (args.length > 1 || (arg.length > 0 && !ENABLE_ARGS.has(arg) && !DISABLE_ARGS.has(arg) && !STATUS_ARGS.has(arg) && arg !== "approve" && arg !== "allow-session" && arg !== "session" && arg !== "reject")) {
    return {
      ok: false,
      message: "usage: /approval [on|off|status|approve|allow-session|reject]",
      activity: "command failed · /approval usage",
    };
  }

  if (arg === "approve") {
    if (!resolveRuntimeApproval(session, "approved")) {
      return { ok: false, message: "no pending approval", activity: "approval missing" };
    }
    savePersistedRuntimeState(session);
    return { ok: true, output: formatOperationControlsStatus(session), activity: "approval granted" };
  }

  if (arg === "allow-session" || arg === "session") {
    if (!grantRuntimeApprovalForSession(session)) {
      return { ok: false, message: "no pending approval", activity: "approval missing" };
    }
    savePersistedRuntimeState(session);
    return { ok: true, output: formatOperationControlsStatus(session), activity: "approval granted · session" };
  }

  if (arg === "reject") {
    if (!resolveRuntimeApproval(session, "rejected")) {
      return { ok: false, message: "no pending approval", activity: "approval missing" };
    }
    savePersistedRuntimeState(session);
    return { ok: true, output: formatOperationControlsStatus(session), activity: "approval rejected" };
  }

  if (STATUS_ARGS.has(arg)) {
    return { ok: true, output: formatOperationControlsStatus(session), activity: "approval status" };
  }

  const nextValue = ENABLE_ARGS.has(arg) ? true : DISABLE_ARGS.has(arg) ? false : !session.operationControls.requireApprovalForGuarded;
  session.operationControls.requireApprovalForGuarded = nextValue;
  session.operationDefaults.requireApprovalForGuarded = nextValue;
  savePersistedRuntimeState(session, { persistCurrentApproval: true });
  return { ok: true, output: formatOperationControlsStatus(session), activity: `approval ${nextValue ? "on" : "off"}` };
}

function handleAskCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length === 0 || args.join(" ").trim().toLowerCase() === "status") {
    return { ok: true, output: formatQuestionnaireStatus(session), activity: "ask status" };
  }
  const result = applyQuestionnaireCommand(session, args);
  if (!result.ok) {
    return { ok: false, message: result.message, activity: "command failed · /ask" };
  }
  savePersistedRuntimeState(session);
  return {
    ok: true,
    output: result.output,
    activity: result.submitted ? "ask answered" : "ask updated",
  };
}

function handleCancelCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length !== 0) {
    return { ok: false, message: "usage: /cancel", activity: "command failed · /cancel usage" };
  }

  requestRuntimeCancel(session);
  return {
    ok: true,
    output: formatOperationControlsStatus(session),
    activity: "cancel requested",
  };
}

function handleSteerCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  const message = args.join(" ").trim();
  if (!message) {
    return { ok: false, message: "usage: /steer <message>", activity: "command failed · /steer usage" };
  }

  queueOperatorSteer(session, message);
  return {
    ok: true,
    output: formatOperationControlsStatus(session),
    activity: `steer ${session.operationControls.steerState ?? "queued"}`,
  };
}

function handleProviderCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  const { detailMode, args: normalizedArgs } = splitVerboseArg(args);
  if (normalizedArgs.length === 0 || (normalizedArgs.length === 1 && normalizedArgs[0] === "status")) {
    return {
      ok: true,
      output: formatProviderStatus(session, detailMode),
      activity: `provider status · ${session.provider}`,
    };
  }

  if (normalizedArgs[0] === "transport") {
    return handleProviderTransportCommand(session, normalizedArgs.slice(1), detailMode);
  }

  if (normalizedArgs.length !== 1) {
    return {
      ok: false,
      message: "usage: /provider [status|name|transport ...] [--verbose]",
      activity: "command failed · /provider usage",
    };
  }

  const nextProvider = normalizedArgs[0];
  const configuredProviders = new Set([session.provider, ...Object.keys(session.providerRouting.modelSelection.configuredModels)]);

  if (!configuredProviders.has(nextProvider)) {
    return {
      ok: false,
      message: `provider ${nextProvider} is not configured in this session`,
      activity: `provider rejected · ${nextProvider}`,
    };
  }

  if (nextProvider === "codex" && !session.auth.loggedIn) {
    return {
      ok: false,
      message: "codex login required; run /login",
      activity: "provider rejected · codex auth",
    };
  }

  applyProviderSelection(session, nextProvider);
  savePersistedRuntimeState(session);

  return {
    ok: true,
    output: formatProviderStatus(session),
    activity: `provider set · ${nextProvider}`,
  };
}

function handleProviderTransportCommand(
  session: RuntimeSession,
  args: string[],
  parentDetailMode: DetailMode = "compact",
): RuntimeCommandResult {
  const { detailMode, args: normalizedArgs } = splitVerboseArg(args);
  const resolvedDetailMode: DetailMode = parentDetailMode === "verbose" ? "verbose" : detailMode;
  if (normalizedArgs.length === 0 || (normalizedArgs.length === 1 && normalizedArgs[0] === "status")) {
    return {
      ok: true,
      output: formatProviderStatus(session, resolvedDetailMode),
      activity: `transport status · ${session.providerTransport.mode}`,
    };
  }

  if (normalizedArgs.length !== 1) {
    return {
      ok: false,
      message: "usage: /provider transport [status|cli-exec|http-responses|codex-http] [--verbose]",
      activity: "command failed · /provider transport usage",
    };
  }

  if (normalizedArgs[0] !== "cli-exec" && normalizedArgs[0] !== "http-responses" && normalizedArgs[0] !== "codex-http") {
    return {
      ok: false,
      message: `unknown transport ${normalizedArgs[0]}; use cli-exec, http-responses, or codex-http`,
      activity: `transport rejected · ${normalizedArgs[0]}`,
    };
  }

  applyTransportMode(session, normalizedArgs[0]);
  savePersistedRuntimeState(session);
  return {
    ok: true,
    output: formatProviderStatus(session, "verbose"),
    activity: `transport set · ${normalizedArgs[0]}`,
  };
}

function handlePwdCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length !== 0) {
    return {
      ok: false,
      message: "usage: /pwd",
      activity: "command failed · /pwd usage",
    };
  }

  return {
    ok: true,
    output: session.cwd,
    activity: "pwd",
  };
}

function handleBangShellCommand(session: RuntimeSession, prompt: string): RuntimeCommandResult {
  const command = prompt.slice(1).trim();
  if (!command) {
    return {
      ok: false,
      message: "usage: !<shell command>",
      activity: "command failed · ! usage",
    };
  }

  const result = executeInternalTool(session, {
    name: "shell_command",
    arguments: { command },
  });

  if (!result.ok) {
    const shellPolicyBlocked = result.output.startsWith("shell policy blocked command");
    return {
      ok: false,
      message: result.output,
      activity: shellPolicyBlocked ? "command blocked · shell policy" : `shell failed · ${command}`,
    };
  }

  return {
    ok: true,
    output: `$ ${command}\n${result.output}`,
    activity: `shell · ${command}`,
  };
}

function handleLsCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length > 1) {
    return {
      ok: false,
      message: "usage: /ls [path]",
      activity: "command failed · /ls usage",
    };
  }
  return toolResultToCommandResult("ls", args[0] ?? ".", executeInternalTool(session, {
    name: "list_dir",
    arguments: args[0] ? { path: args[0] } : {},
  }));
}

function handleReadCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length !== 1) {
    return {
      ok: false,
      message: "usage: /read <path>",
      activity: "command failed · /read usage",
    };
  }

  return toolResultToCommandResult("read", args[0], executeInternalTool(session, {
    name: "read_file",
    arguments: { path: args[0] },
  }));
}

function handleFindCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length === 0) {
    return {
      ok: false,
      message: "usage: /find <text> [path]",
      activity: "command failed · /find usage",
    };
  }

  const searchTerm = args[0];
  return toolResultToCommandResult("find", searchTerm, executeInternalTool(session, {
    name: "search_content",
    arguments: {
      pattern: searchTerm,
      ...(args[1] ? { path: args[1] } : {}),
    },
  }));
}

function handleGlobCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length === 0) {
    return {
      ok: false,
      message: "usage: /glob <pattern> [path]",
      activity: "command failed · /glob usage",
    };
  }

  const globPattern = args[0];
  return toolResultToCommandResult("glob", globPattern, executeInternalTool(session, {
    name: "search_files",
    arguments: {
      pattern: globPattern,
      ...(args[1] ? { path: args[1] } : {}),
    },
  }));
}

function handleRipgrepCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length === 0) {
    return {
      ok: false,
      message: "usage: /rg <pattern> [path]",
      activity: "command failed · /rg usage",
    };
  }

  const searchTerm = args[0];
  return toolResultToCommandResult("rg", searchTerm, executeInternalTool(session, {
    name: "search_content",
    arguments: {
      pattern: searchTerm,
      ...(args[1] ? { path: args[1] } : {}),
    },
  }));
}

function handleDiffCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length > 1) {
    return {
      ok: false,
      message: "usage: /diff [path]",
      activity: "command failed · /diff usage",
    };
  }

  return toolResultToCommandResult("diff", args[0] ?? ".", executeInternalTool(session, {
    name: "git_diff",
    arguments: args[0] ? { path: args[0] } : {},
  }));
}

function handleModelCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  const provider = session.providerTransport.activeProvider;
  if (args.length === 0 || (args.length === 1 && args[0] === "status")) {
    return {
      ok: true,
      output: formatModelStatus(session),
      activity: `model status · ${provider}`,
    };
  }

  if (args.length === 1 && args[0] === "list") {
    return {
      ok: true,
      output: formatModelStatus(session),
      activity: `model list · ${provider}`,
    };
  }

  if (args.length > 2) {
    return {
      ok: false,
      message: "usage: /model [status|list|name [effort]]",
      activity: "command failed · /model usage",
    };
  }

  const requestedModel = args[0]?.trim();
  if (!requestedModel) {
    return {
      ok: false,
      message: "usage: /model [status|list|name [effort]]",
      activity: "command failed · /model usage",
    };
  }

  const normalizedModel = normalizeModelForProvider(session, provider, requestedModel);
  if (!normalizedModel) {
    return {
      ok: false,
      message: `model ${requestedModel} is not available for ${provider}`,
      activity: `model rejected · ${requestedModel}`,
    };
  }

  const configuredModels = session.providerRouting.modelSelection.configuredModels as Record<string, string | undefined>;
  configuredModels[provider] = normalizedModel;
  if (args[1]) {
    const effortResult = setReasoningEffortForProvider(session, provider, normalizedModel, args[1]);
    if (!effortResult.ok) {
      return effortResult;
    }
  } else {
    ensureReasoningEffortSupported(session, provider, normalizedModel);
  }
  refreshInstructionState(session);
  savePersistedRuntimeState(session);
  return {
    ok: true,
    output: formatModelStatus(session),
    activity: `model set · ${normalizedModel} ${getCurrentProviderReasoningEffort(session)}`,
  };
}

function handleEffortCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  const provider = session.providerTransport.activeProvider;
  const model = getCurrentProviderModel(session);
  if (args.length === 0 || (args.length === 1 && args[0] === "status")) {
    return {
      ok: true,
      output: formatEffortStatus(session),
      activity: `effort status · ${provider}`,
    };
  }
  if (args.length !== 1) {
    return {
      ok: false,
      message: "usage: /effort [status|low|medium|high|xhigh]",
      activity: "command failed · /effort usage",
    };
  }
  const result = setReasoningEffortForProvider(session, provider, model, args[0]);
  if (!result.ok) {
    return result;
  }
  refreshInstructionState(session);
  savePersistedRuntimeState(session);
  return {
    ok: true,
    output: formatEffortStatus(session),
    activity: `effort set · ${getCurrentProviderReasoningEffort(session)}`,
  };
}

function formatProviderStatus(session: RuntimeSession, detailMode: DetailMode = "compact"): string {
  const definition = getProviderDefinition(session.providerRegistry, session.providerTransport.activeProvider);
  const registryWarnings = [
    ...(session.providerRegistry.warnings ?? []),
    ...(definition?.warnings ?? []),
  ];
  const compactRows: DiagnosticRow[] = [
    ["provider", session.provider],
    ["model", getCurrentProviderModel(session)],
    ["transport", session.providerTransport.mode],
    ["wire-api", definition?.wireApi ?? "unknown"],
    ["auth-gate", session.providerTransport.authGate],
    ["active", session.providerTransport.activeProvider],
    ["caveats", formatTransportCaveat(session)],
  ];
  const verboseRows: DiagnosticRow[] = [
    ["provider", session.provider],
    ["model", getCurrentProviderModel(session)],
    ["active", session.providerTransport.activeProvider],
    ["configured", formatProviderModels(session.providerRouting.modelSelection.configuredModels)],
    ["fallback", formatFallbackPolicy(session.providerRouting.fallback)],
    ["transport", formatTransportSummary(session)],
    ["adapter", session.providerTransport.adapter],
    ["mode", session.providerTransport.mode],
    ["wire-api", definition?.wireApi ?? "unknown"],
    ["base-url", definition?.baseUrl ?? "none"],
    ["auth-source", session.providerTransport.authSource],
    ["auth-gate", session.providerTransport.authGate],
    ["registry", definition?.disabledReason ? `disabled · ${definition.disabledReason}` : "ready"],
    ["registry-warnings", registryWarnings.length > 0 ? registryWarnings.join(" | ") : "none"],
    ["capabilities", formatTransportCapabilities(session)],
    ["caveats", formatTransportCaveat(session)],
  ];
  return formatDiagnosticSection("provider", detailMode, compactRows, verboseRows).join("\n");
}

function formatModelStatus(session: RuntimeSession): string {
  const provider = session.providerTransport.activeProvider;
  return [
    `provider: ${provider}`,
    `current: ${getCurrentProviderModel(session)}`,
    `effort: ${getCurrentProviderReasoningEffort(session)}`,
    `available: ${formatAvailableModels(session, provider)}`,
    `efforts: ${formatAvailableReasoningEfforts(session, provider, getCurrentProviderModel(session))}`,
  ].join("\n");
}

function formatEffortStatus(session: RuntimeSession): string {
  const provider = session.providerTransport.activeProvider;
  const model = getCurrentProviderModel(session);
  return [
    `provider: ${provider}`,
    `model: ${model}`,
    `current: ${getCurrentProviderReasoningEffort(session)}`,
    `available: ${formatAvailableReasoningEfforts(session, provider, model)}`,
  ].join("\n");
}

export function formatRuntimeStatus(session: RuntimeSession, detailMode: DetailMode = "compact"): string {
  const completion = deriveTurnCompletionState(session);
  const compactTurnSummary = `state=${completion.state} | objective=${completion.objective} | blocker=${completion.blocker ?? "none"}`;
  if (detailMode === "verbose") {
    return [
      ...formatDiagnosticSection("runtime", detailMode, [
        ["product", session.product],
        ["repo", formatRepoLabel(session)],
        ["branch", session.repo.branch ?? "detached"],
        ["cwd", session.cwd],
        ["git", formatRepoFreshness(session)],
        ["context-left", String(getRemainingContextTokens(session))],
        ["compact", formatCompactionSummary(session)],
        ["approval", formatApprovalSummary(session)],
        ["turn", compactTurnSummary],
        ["ops", formatOperationSummary(session)],
        ["styles", formatStyleStack(session)],
      ], [
        ["product", session.product],
        ["cwd", session.cwd],
        ["repo", formatRepoLabel(session)],
        ["branch", session.repo.branch ?? "detached"],
        ["git", formatRepoFreshness(session)],
        ["context-left", String(getRemainingContextTokens(session))],
        ["compact", formatCompactionSummary(session)],
        ["tool-policy", session.toolPolicy.mode],
        ["approval", formatApprovalSummary(session)],
        ["turn", compactTurnSummary],
        ["ops", formatOperationSummary(session)],
        ["styles", formatStyleStack(session)],
      ]),
      formatProviderStatus(session, "verbose"),
      "auth:",
      formatAuthStatus(session),
      "compaction:",
      formatCompactionStatus(session),
      "approval-control:",
      formatOperationControlsStatus(session),
      formatToolPolicyStatus(session, "verbose"),
      formatHooksStatus(session),
      formatMemoryStatus(session, "verbose"),
    ].join("\n");
  }

  return formatDiagnosticSection("runtime", detailMode, [
    ["turn", compactTurnSummary],
    ["product", `${session.product} / ${formatRepoLabel(session)} / ${session.repo.branch ?? "detached"}`],
    ["provider", `${session.provider} / ${getCurrentProviderModel(session)} / ${session.providerTransport.mode}`],
    ["approval", formatApprovalSummary(session)],
    ["tool-policy", `${session.toolPolicy.mode} · memory ${session.archivist.enabled ? "enabled" : "disabled"} · ${session.toolPolicy.writes}/${session.toolPolicy.deletes}`],
    ["git", `${formatRepoFreshness(session)} · ${getRemainingContextTokens(session)} tokens left`],
  ]).join("\n");
}

function formatDoctorStatus(session: RuntimeSession): string {
  const lsp = getLspStatus(session);
  const mcpStatuses = session.mcpRegistry?.statuses ?? [];
  const failedMcp = mcpStatuses.filter((status) => status.status !== "hydrated" && status.status !== "configured");
  const clipboard = formatClipboardDoctorStatus();
  const shellBlocker = session.operationControls.lastShellBlocker;
  const issues = [
    !session.auth.loggedIn ? "provider auth not ready" : null,
    failedMcp.length > 0 ? `${String(failedMcp.length)} MCP server(s) failed or unavailable` : null,
    lsp.enabled && !lsp.available ? "LSP language server missing; fallback active" : null,
    lsp.problemCount > 0 ? `${String(lsp.problemCount)} cached LSP problem(s)` : null,
    clipboard.copy === "missing" ? "clipboard copy backend missing" : null,
    shellBlocker ? "recent shell command blocked" : null,
  ].filter((issue): issue is string => Boolean(issue));
  const next = [
    !session.auth.loggedIn ? "/login" : null,
    failedMcp.length > 0 ? "check .nexagent/mcp.json env/commands, then /reload" : null,
    lsp.enabled && !lsp.available ? "bun install or /lsp setup" : null,
    lsp.problemCount > 0 ? (lsp.lastTouchedPath ? `/lsp diagnostics ${lsp.lastTouchedPath}` : "/lsp workspace") : null,
    clipboard.copy === "missing" ? "install wl-copy/xclip/xsel/pbcopy or rely on OSC52 terminal support" : null,
    shellBlocker ? "/why-blocked" : null,
  ].filter((item): item is string => Boolean(item));

  return [
    "doctor",
    `status: ${issues.length === 0 ? "ok" : "attention"}`,
    `issues: ${issues.length === 0 ? "none" : issues.join(" | ")}`,
    "provider",
    `active: ${session.provider}`,
    `transport: ${session.providerTransport.mode}`,
    `auth: ${session.auth.loggedIn ? "ready" : session.auth.status}`,
    "mcp",
    `servers: ${String(session.mcpServers.length)}`,
    `tools: ${String(session.mcpRegistry?.tools?.length ?? 0)}`,
    `failed: ${failedMcp.length === 0 ? "none" : failedMcp.map((status) => status.name).slice(0, 5).join(", ")}`,
    "lsp",
    `enabled: ${String(lsp.enabled)}`,
    `source: ${lsp.source}`,
    `available: ${String(lsp.available)}`,
    `problems: ${String(lsp.problemCount)}`,
    `last: ${lsp.lastTouchedPath ?? "none"}`,
    "clipboard",
    `copy: ${clipboard.copy}`,
    `paste: ${clipboard.paste}`,
    "shell",
    `guard: ${session.toolPolicy.shell}; ${session.toolPolicy.deletes}`,
    `lastBlocked: ${shellBlocker ? shellBlocker.reason : "none"}`,
    "next",
    next.length === 0 ? "none" : next.map((item) => `- ${item}`).join("\n"),
  ].join("\n");
}

function formatClipboardDoctorStatus(): { copy: string; paste: string } {
  const copyBackends = ["pbcopy", "wl-copy", "xclip", "xsel", "powershell.exe"].filter(isCommandOnPath);
  const pasteBackends = ["pbpaste", "wl-paste", "xclip", "xsel", "powershell.exe"].filter(isCommandOnPath);
  return {
    copy: copyBackends.length > 0 ? copyBackends.join(", ") : "missing",
    paste: pasteBackends.length > 0 ? pasteBackends.join(", ") : "missing",
  };
}

function isCommandOnPath(command: string): boolean {
  const pathEntries = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(entry, command.endsWith(extension) ? command : `${command}${extension}`);
      try {
        if (statSync(candidate).isFile()) {
          return true;
        }
      } catch {
        // Try next PATH entry.
      }
    }
  }
  return false;
}

function formatAuthStatus(session: RuntimeSession): string {
  return [
    `provider: ${session.auth.provider}`,
    `available: ${String(session.auth.available)}`,
    `loggedIn: ${String(session.auth.loggedIn)}`,
    `method: ${session.auth.method ?? "none"}`,
    `status: ${session.auth.status}`,
    `checkedAt: ${session.auth.checkedAt ?? "none"}`,
  ].join("\n");
}

function formatCodexStatus(session: RuntimeSession): string {
  return [
    `active: ${String(session.provider === "codex")}`,
    formatProviderStatus(session),
    formatAuthStatus(session),
  ].join("\n");
}

function formatProviderFailure(result: Extract<Awaited<ReturnType<typeof executeProviderRequest>>, { ok: false }>): string {
  const model = result.model ?? "none";
  return [
    `[${result.provider}/${model}] ${result.code}: ${result.message}`,
    `transport: ${result.transport}; adapter=${result.adapter}; silent-fallback=${String(result.fallbackApplied)}`,
    result.detail,
  ].join("\n") + "\n";
}

function formatHooksStatus(session: RuntimeSession): string {
  return [
    `status: ${session.hooks.status}`,
    `source: ${session.hooks.sourcePath ?? "none"}`,
    `events: ${formatList(session.hooks.events)}`,
    `commands: ${String(session.hooks.commandCount)}`,
    `invalid: ${session.hooks.invalidEntries.length > 0 ? session.hooks.invalidEntries.join(" | ") : "none"}`,
  ].join("\n");
}

function formatMemoryStatus(session: RuntimeSession, detailMode: DetailMode = "compact"): string {
  const diagnostics = session.archivist.diagnostics ?? {
    retrievalMatchCount: session.archivist.retrieval.matchCount,
    retrievalSourceCategory: session.archivist.retrieval.sourceCategory,
    saveCount: 0,
    checkpointCount: 0,
    duplicateSuspectCount: 0,
    staleSignalCount: 0,
    noisySignalCount: 0,
  };
  return formatDiagnosticSection("memory", detailMode, [
    ["enabled", String(session.archivist.enabled)],
    ["boundary", session.archivist.boundary],
    ["storage", session.archivist.storagePath ?? "disabled"],
    ["persisted", String(session.archivist.storageExists)],
    ["signal", formatArchivistDiagnostics(diagnostics)],
    ["preview", session.archivist.writes.preview ?? "none"],
  ], [
    ["enabled", String(session.archivist.enabled)],
    ["boundary", session.archivist.boundary],
    ["storage", session.archivist.storagePath ?? "disabled"],
    ["persisted", String(session.archivist.storageExists)],
    ["retrieval", formatArchivistRetrieval(session.archivist.retrieval)],
    ["retrievalPreview", session.archivist.retrieval.preview ?? "none"],
    ["writes", formatArchivistWrite(session.archivist.writes)],
    ["diagnostics", formatArchivistDiagnostics(diagnostics)],
    ["writePreview", session.archivist.writes.preview ?? "none"],
  ]).join("\n");
}

function formatMemoryMaintenanceStatus(result: ReturnType<typeof maintainArchivistMemorySync>): string {
  return [
    "memory maintenance",
    `storage: ${result.storagePath}`,
    `entries: ${String(result.totalBefore)} -> ${String(result.totalAfter)}`,
    `removedDuplicates: ${String(result.removedDuplicates)}`,
    `remainingDuplicateSuspects: ${String(result.duplicateSuspects)}`,
    `stale: ${String(result.stale)}`,
    `noisy: ${String(result.noisy)}`,
    `persisted: ${String(result.persisted)}`,
  ].join("\n");
}

function formatConfigStatus(session: RuntimeSession): string {
  return formatRuntimeDashboardStatus(session);
}

function formatRuntimeDashboardStatus(session: RuntimeSession): string {
  const provider = session.providerTransport.activeProvider;
  const configuredModels = session.providerRouting.modelSelection.configuredModels as Record<string, string | undefined>;
  const model = configuredModels[provider] ?? "unknown";
  const effort = session.providerRouting.modelSelection.configuredReasoningEfforts?.[provider] ?? "default";
  const contextWindow = getCodexModelDefinition(model)?.contextWindow ?? 128000;
  const remainingContext = getRemainingContextTokens(session);
  const contextUsed = Math.max(0, contextWindow - remainingContext);
  const contextPercent = contextWindow > 0 ? Math.round((contextUsed / contextWindow) * 100) : 0;
  const keyConflicts = detectKeybindingConflicts(session.ui?.keybindings);
  return [
    "dashboard",
    "provider",
    `active: ${session.provider}`,
    `transport: ${session.providerTransport.mode}`,
    "model",
    `active: ${model}`,
    `effort: ${effort}`,
    "approval",
    `mode: ${session.operationControls.yoloMode ? "yolo" : session.operationControls.requireApprovalForGuarded ? "guarded" : "open"}`,
    `pending: ${session.operationControls.pendingApproval?.tool ?? "none"}`,
    "ui",
    `logoMode: ${session.ui?.logoMode ?? "full"}`,
    `mouseMode: ${session.commandModes.mouseMode}`,
    `sessionEmoji: ${getSessionEmoji(session)}`,
    `sessionColor: ${String(getSessionColorCode(session))}`,
    `notify: ${session.ui?.notifyEnabled === true ? "on" : "off"} threshold=${String(notifyThresholdMs(session))}ms`,
    `statuslineCommand: ${session.ui?.statuslineCommand ?? "none"}`,
    `keybindings: ${String(Object.keys(session.ui?.keybindings ?? {}).length)} custom`,
    `keyConflicts: ${keyConflicts.length > 0 ? keyConflicts.join("; ") : "none"}`,
    "memory",
    `archivist: ${session.archivist.enabled ? "on" : "off"}`,
    `storage: ${session.archivist.storagePath ?? "disabled"}`,
    "tools",
    `mode: ${session.toolPolicy.mode}`,
    `mcpTools: ${String(session.mcpRegistry?.tools?.length ?? 0)}`,
    `extensionTools: ${String(session.extensions?.tools.size ?? 0)}`,
    "lsp",
    `enabled: ${String(session.lsp?.enabled === true)}`,
    `configured: ${String(Boolean(session.lsp?.command))}`,
    `command: ${session.lsp?.command ?? "none"}`,
    `indexArchivist: ${String(session.lsp?.indexArchivist === true)}`,
    "context",
    `used: ${String(contextUsed)}`,
    `window: ${String(contextWindow)}`,
    `percent: ${String(contextPercent)}`,
    `compaction: ${session.compaction.summary ? "summary" : "raw"}`,
    "diagnostics",
    "sentry: /status --sentry",
    "redaction: tags-only",
  ].join("\n");
}

function formatNotifyStatus(session: RuntimeSession): string {
  return [
    `enabled: ${session.ui?.notifyEnabled === true ? "on" : "off"}`,
    `thresholdMs: ${String(notifyThresholdMs(session))}`,
    "backend: terminal bell + notify-send/osascript when available",
  ].join("\n");
}

function formatEmojiStatus(session: RuntimeSession): string {
  return [
    `emoji: ${getSessionEmoji(session)}`,
    `configured: ${session.ui?.sessionEmoji ?? "deterministic"}`,
    `available: ${SESSION_EMOJIS.join(" ")}`,
  ].join("\n");
}

function formatColorStatus(session: RuntimeSession): string {
  return [
    `swatch: ${formatSessionColorSwatch(session)}`,
    `configuredIndex: ${session.ui?.sessionColorIndex ?? "deterministic"}`,
    `palette: ${SESSION_COLORS.join(", ")}`,
  ].join("\n");
}

function formatSafeGitStatus(session: RuntimeSession): string {
  return [
    "enabled: true",
    "level: high",
    "highRisk: force push, hard reset, forced clean, stash deletion, forced branch delete, reflog expire",
    `lastBlocker: ${session.operationControls.lastShellBlocker?.source === "safe-git" ? session.operationControls.lastShellBlocker.reason : "none"}`,
  ].join("\n");
}

function formatArchivistDiagnostics(diagnostics: NonNullable<RuntimeSession["archivist"]["diagnostics"]>): string {
  return [
    `matches=${String(diagnostics.retrievalMatchCount)}`,
    `source=${diagnostics.retrievalSourceCategory ?? "none"}`,
    `saves=${String(diagnostics.saveCount)}`,
    `checkpoints=${String(diagnostics.checkpointCount)}`,
    `duplicates=${String(diagnostics.duplicateSuspectCount)}`,
    `stale=${String(diagnostics.staleSignalCount)}`,
    `noisy=${String(diagnostics.noisySignalCount)}`,
  ].join(" · ");
}

function formatOperationControlsStatus(session: RuntimeSession): string {
  const pending = session.operationControls.pendingApproval
    ? `${session.operationControls.pendingApproval.tool}; ${session.operationControls.pendingApproval.risk}; ${session.operationControls.pendingApproval.summary}`
    : "none";
  const steerHistory = session.operationControls.steerHistory.length > 0
    ? session.operationControls.steerHistory
      .slice(-3)
      .map((entry) => `${entry.status}:${entry.message}${entry.detail ? ` (${entry.detail})` : ""}`)
      .join(" | ")
    : "none";
  const lines = [
    `approvalRequired: ${String(session.operationControls.requireApprovalForGuarded)}`,
    `yoloMode: ${String(session.operationControls.yoloMode)}`,
    `pendingApproval: ${pending}`,
    `lastDecision: ${session.operationControls.lastDecision ?? "none"}`,
    `cancelRequested: ${String(session.operationControls.cancelRequested)}`,
    `steerState: ${session.operationControls.steerState ?? "none"}`,
    `steer: ${session.operationControls.steerMessage ?? "none"}`,
    `lastAppliedSteer: ${session.operationControls.lastAppliedSteer ?? "none"}`,
    `steerHistory: ${steerHistory}`,
  ];
  if (session.operationControls.pendingApproval) {
    lines.push("approvalOptions: approve once | allow-session | reject");
    lines.push(`approvalPattern: ${session.operationControls.pendingApproval.pattern ?? "none"}`);
  }
  const sessionApprovalCount = session.operationControls.approvalSessionGrants?.length ?? 0;
  if (sessionApprovalCount > 0) {
    lines.push(`sessionApprovals: ${String(sessionApprovalCount)}`);
  }
  return lines.join("\n");
}

function formatToolPolicyStatus(session: RuntimeSession, detailMode: DetailMode = "compact"): string {
  const internalTools = getInternalToolDefinitions().map((tool) => tool.name).join(", ");
  const extensionTools = [...(session.extensions?.tools.keys() ?? [])].sort().join(", ") || "none";
  return formatDiagnosticSection("tool-policy", detailMode, [
    ["mode", session.toolPolicy.mode],
    ["readable", (session.toolPolicy.readRoots ?? ["all non-protected paths"]).join(" | ")],
    ["allowed", session.toolPolicy.allowedRoots.join(" | ")],
    ["yoloWrites", session.operationControls.yoloMode ? "readable workspace paths" : "repo write roots only"],
    ["writes", session.toolPolicy.writes],
    ["deletes", session.toolPolicy.deletes],
    ["shell", session.toolPolicy.shell],
    ["shellGuard", "repo-pinned; destructive-blocked"],
    ["internalTools", internalTools],
    ["extensionTools", extensionTools],
    ["ripgrep", hasRipgrep() ? "available" : "missing"],
  ], [
    ["mode", session.toolPolicy.mode],
    ["readable", (session.toolPolicy.readRoots ?? ["all non-protected paths"]).join(" | ")],
    ["allowed", session.toolPolicy.allowedRoots.join(" | ")],
    ["yoloWrites", session.operationControls.yoloMode ? "readable workspace paths" : "repo write roots only"],
    ["protected", `${session.toolPolicy.protectedRoots.slice(0, 8).join(" | ")}${session.toolPolicy.protectedRoots.length > 8 ? " | ..." : ""}`],
    ["shell", session.toolPolicy.shell],
    ["shellGuard", "repo-pinned; destructive-blocked; timeout=5000ms; output<=120 lines"],
    ["writes", session.toolPolicy.writes],
    ["deletes", session.toolPolicy.deletes],
    ["internalTools", internalTools],
    ["extensionTools", extensionTools],
    ["ripgrep", hasRipgrep() ? "available" : "missing"],
  ]).join("\n");
}

function formatShellBlockerStatus(report: NonNullable<RuntimeSession["operationControls"]["lastShellBlocker"]>): string {
  return [
    "lastShellBlocker",
    `source: ${report.source}`,
    `reason: ${report.reason}`,
    `matched: ${report.matchedText ?? "none"}`,
    `pattern: ${report.pattern}`,
    `command: ${report.command}`,
    `safer: ${report.advice}`,
  ].join("\n");
}

function formatCompactionStatus(session: RuntimeSession): string {
  return [
    `enabled: ${String(session.compaction.enabled ?? true)}`,
    `status: ${session.compaction.status}`,
    `threshold: ${Math.round(session.compaction.thresholdPercent * 100)}%`,
    `thresholdTokens: ${String(getCompactionThresholdTokens(session))}`,
    `remainingTokens: ${String(getRemainingContextTokens(session))}`,
    `conversationTokens: ${String(estimateConversationTokens(session))}`,
    `preserveTurns: ${String(session.compaction.preserveTurns ?? 4)}`,
    `queued: ${session.compaction.queuedUserMessage ?? "none"}`,
    `summary: ${session.compaction.summary ? "present" : "none"}`,
    `compacts: ${String(session.compaction.compactCount)}`,
    `lastTrigger: ${session.compaction.lastTrigger ?? "none"}`,
    `lastCompactedAt: ${session.compaction.lastCompactedAt ?? "none"}`,
    `normalTurnSteering: ${session.compaction.normalTurnSteering}`,
    `compactTurnSteering: ${session.compaction.compactTurnSteering}`,
  ].join("\n");
}

function formatCompactionSummary(session: RuntimeSession): string {
  return `${Math.round(session.compaction.thresholdPercent * 100)}% · left ${getRemainingContextTokens(session)} · compacts ${session.compaction.compactCount}`;
}

function formatApprovalSummary(session: RuntimeSession): string {
  if (session.operationControls.yoloMode) {
    return "approval=yolo";
  }
  return `approval=${session.operationControls.requireApprovalForGuarded ? "on" : "off"}`;
}

export function formatOperationSummary(session: RuntimeSession): string {
  const summary = deriveTurnCompletionState(session);
  if (summary.state === "blocked" && summary.blocker) {
    return `blocked · ${summary.blocker}`;
  }
  if (summary.state === "pending" && summary.objective !== "idle") {
    return `pending · ${summary.objective}`;
  }
  if (summary.state === "running") {
    return `running · ${summary.objective}`;
  }
  if (summary.state === "finished") {
    return `finished · ${summary.objective}`;
  }
  return summary.unverified ? `state=${summary.state} [unverified]` : `state=${summary.state}`;
}

function formatStyleModeName(mode: "cavemanMode" | "deadpoolMode" | "statusline"): string {
  if (mode === "cavemanMode") {
    return "caveman mode";
  }
  if (mode === "deadpoolMode") {
    return "deadpool mode";
  }
  return "statusline";
}

function formatStyleModeStatus(session: RuntimeSession, mode: "cavemanMode" | "deadpoolMode" | "statusline"): string {
  const enabled = session.commandModes[mode];
  if (mode === "cavemanMode") {
    if (enabled) {
      return session.commandModes.deadpoolMode
        ? `Caveman mode ON. Deadpool mode still ON. Replies now compressed hard, with Deadpool voice kept terse. ${formatStyleStackMessage(session)}`
        : "Caveman mode ON. Responses now ultra-compressed. ~75% fewer tokens. Technical accuracy preserved.";
    }
    return session.commandModes.deadpoolMode
      ? "Caveman mode OFF. Deadpool mode still ON."
      : "Caveman mode OFF. Responses back to normal.";
  }
  if (mode === "deadpoolMode") {
    if (enabled) {
      return session.commandModes.cavemanMode
        ? `Deadpool mode ON. Caveman mode still ON. Replies keep antihero voice, but compressed. ${formatStyleStackMessage(session)}`
        : "Deadpool mode ON. Replies now use snarky antihero voice. Code and structured output stay normal.";
    }
    return session.commandModes.cavemanMode
      ? `Deadpool mode OFF. Caveman mode still ON. ${formatStyleStackMessage(session)}`
      : `Deadpool mode OFF. Replies back to normal voice. ${formatStyleStackMessage(session)}`;
  }
  return enabled
    ? `Statusline ON. Footer now shows ${formatStatusline(session)}.`
    : "Statusline OFF.";
}

function formatStyleStackMessage(session: RuntimeSession): string {
  const active: string[] = [];
  if (session.commandModes.deadpoolMode) {
    active.push("deadpool");
  }
  if (session.commandModes.cavemanMode) {
    active.push("caveman");
  }
  if (active.length === 0) {
    return "Style stack: normal.";
  }
  return `Style stack: ${active.join(" + ")}.`;
}

function formatStyleStack(session: RuntimeSession): string {
  const active: string[] = [];
  if (session.commandModes.deadpoolMode) {
    active.push("deadpool");
  }
  if (session.commandModes.cavemanMode) {
    active.push("caveman");
  }
  active.push(`mouse:${getConfiguredMouseMode(session)}`);
  return active.join(" + ");
}

function formatTurnTokens(session: RuntimeSession): string {
  return `in~${session.telemetry.lastInputTokens} out~${session.telemetry.lastOutputTokens}`;
}

function getContextWindowForSession(session: RuntimeSession): number {
  return getCodexModelDefinition(getCurrentProviderModel(session))?.contextWindow ?? 128000;
}

function formatCommandCatalog(): string {
  return [
    ...COMMAND_CATALOG.map((command) => `${command.usage} - ${command.description}`),
    "!<command> - run guarded shell command and add output to transcript",
  ].join("\n");
}

function formatOpenTuiKeymap(session?: RuntimeSession): string {
  return [
    "Composer basics",
    "  Enter - send prompt",
    "  Shift+Enter or Alt+Enter - insert newline",
    "  Tab - accept selected completion",
    "  Esc - clear input or close overlay",
    "",
    ...formatKeybindingRows(session?.ui?.keybindings),
    "",
    "Transcript extras",
    "  PageUp/PageDown - scroll transcript",
    "  Ctrl+Up/Ctrl+Down - scroll one line",
    "  Ctrl+End - jump to latest output",
    "",
    "Customize",
    `  /config key command-palette ${formatKeybindingDisplay("ctrl+p")}`,
    "  /config key command-palette clear",
  ].join("\n");
}

function formatStatusline(session: RuntimeSession): string {
  const custom = formatCustomStatusline(session);
  if (custom) {
    return custom;
  }
  return [
    `${getSessionEmoji(session)} color=${String(getSessionColorCode(session))}`,
    session.provider,
    getCurrentProviderModel(session),
    session.providerTransport.mode,
    session.providerTransport.authGate,
    formatApprovalSummary(session),
    `mouse=${getConfiguredMouseMode(session)}/${getEffectiveMouseMode(session).mode}`,
    formatStyleStack(session),
    formatTurnTokens(session),
    formatContextMeter(getRemainingContextTokens(session), getContextWindowForSession(session)),
  ].join(" | ");
}

function formatCustomStatusline(session: RuntimeSession): string | null {
  const command = session.ui?.statuslineCommand?.trim();
  if (!command) {
    return null;
  }
  try {
    const output = execFileSync("bash", ["-lc", command], {
      cwd: pathExists(session.cwd) ? session.cwd : process.cwd(),
      encoding: "utf8",
      timeout: 500,
      maxBuffer: 4096,
      env: {
        ...process.env,
        NEXAGENT_PROVIDER: session.provider,
        NEXAGENT_MODEL: getCurrentProviderModel(session),
        NEXAGENT_TRANSPORT: session.providerTransport.mode,
        NEXAGENT_APPROVAL: formatApprovalSummary(session),
        NEXAGENT_CONTEXT_LEFT: String(getRemainingContextTokens(session)),
        NEXAGENT_CONTEXT_WINDOW: String(getContextWindowForSession(session)),
        NEXAGENT_TURN_COUNT: String(session.telemetry.turnCount),
        NEXAGENT_CWD: session.cwd,
      },
    }).split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
    return output.length > 0 ? truncateLine(output, 180) : null;
  } catch {
    return "statusline command failed";
  }
}

function pathExists(target: string): boolean {
  try {
    statSync(target);
    return true;
  } catch {
    return false;
  }
}

function getCurrentProviderModel(session: RuntimeSession): string {
  const provider = session.providerTransport.activeProvider;
  const configuredModels = session.providerRouting.modelSelection.configuredModels as Record<string, string | undefined>;
  const configured = configuredModels[provider]?.trim();
  if (configured) {
    return configured;
  }
  if (provider === "codex") {
    return DEFAULT_CODEX_MODEL;
  }
  return "unset";
}

export function getCurrentProviderReasoningEffort(session: RuntimeSession): CodexReasoningEffort {
  const provider = session.providerTransport.activeProvider;
  const model = getCurrentProviderModel(session);
  const configuredEfforts = session.providerRouting.modelSelection.configuredReasoningEfforts as Record<string, string | undefined> | undefined;
  const configured = normalizeCodexReasoningEffort(configuredEfforts?.[provider]);
  const modelDefinition = getAvailableModelsForProvider(session, provider).find((entry) => entry.id === model);
  if (configured && modelDefinition?.supportedReasoningEfforts.includes(configured)) {
    return configured;
  }
  const defaultEffort = modelDefinition?.defaultReasoningEffort ?? getCodexModelDefinition(model)?.defaultReasoningEffort ?? DEFAULT_CODEX_REASONING_EFFORT;
  return defaultEffort;
}

function formatAvailableModels(session: RuntimeSession, provider: string): string {
  const models = getAvailableModelsForProvider(session, provider);
  if (models.length === 0) {
    return "no catalog";
  }
  return models
    .map((definition) => definition.disabledReason ? `${definition.id} (${definition.disabledReason})` : definition.id)
    .join(", ");
}

function formatAvailableReasoningEfforts(session: RuntimeSession, provider: string, model: string): string {
  const modelDefinition = getAvailableModelsForProvider(session, provider).find((entry) => entry.id === model);
  return (modelDefinition?.supportedReasoningEfforts ?? ["low", "medium", "high", "xhigh"]).join(", ");
}

function getAvailableModelsForProvider(session: RuntimeSession, provider: string): ProviderModelOption[] {
  const registryModels = getProviderModelOptions(session.providerRegistry, provider, session.providerTransport.mode);
  if (registryModels.length > 0) {
    return registryModels;
  }
  const configuredModels = session.providerRouting.modelSelection.configuredModels as Record<string, string | undefined>;
  const configured = configuredModels[provider];
  if (!configured) {
    return [];
  }

  return [{
    id: configured,
    label: configured,
    description: "configured model",
    family: "gpt" as const,
    supportedInApi: true,
    defaultReasoningEffort: "medium" as const,
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"] as const,
    thinkingLevelMetadata: {
      defaultThinkingLevel: "medium" as const,
      supportedThinkingLevels: ["minimal", "low", "medium", "high"] as const,
      providerControls: [
        { provider: "openai" as const, transportModes: ["http-responses"] as const, parameter: "reasoning.effort" },
      ],
    },
    contextWindow: 0,
    maxContextWindow: 0,
  }];
}

function normalizeModelForProvider(session: RuntimeSession, provider: string, requestedModel: string): string | null {
  const requested = provider === "codex"
    ? (normalizeCodexModel(requestedModel) ?? requestedModel.trim())
    : requestedModel.trim();
  if (!requested) {
    return null;
  }
  const match = getAvailableModelsForProvider(session, provider).find((model) => model.id === requested);
  return match && !match.disabledReason ? match.id : null;
}

function setReasoningEffortForProvider(
  session: RuntimeSession,
  provider: string,
  model: string,
  requestedEffort: string,
): RuntimeCommandResult {
  const normalizedEffort = normalizeCodexReasoningEffort(requestedEffort);
  const modelDefinition = getAvailableModelsForProvider(session, provider).find((entry) => entry.id === model);
  const supportedEfforts = modelDefinition?.supportedReasoningEfforts ?? ["low", "medium", "high", "xhigh"];
  if (!normalizedEffort || !supportedEfforts.includes(normalizedEffort)) {
    return {
      ok: false,
      message: `effort ${requestedEffort} is not available for ${model}`,
      activity: `effort rejected · ${requestedEffort}`,
    };
  }
  const configuredEfforts = session.providerRouting.modelSelection.configuredReasoningEfforts ?? {};
  configuredEfforts[provider as keyof typeof configuredEfforts] = normalizedEffort;
  session.providerRouting.modelSelection.configuredReasoningEfforts = configuredEfforts;
  return { ok: true, output: "", activity: `effort set · ${normalizedEffort}` };
}

function ensureReasoningEffortSupported(session: RuntimeSession, provider: string, model: string): void {
  const configuredEfforts = session.providerRouting.modelSelection.configuredReasoningEfforts as Record<string, string | undefined> | undefined;
  const configured = normalizeCodexReasoningEffort(configuredEfforts?.[provider]);
  if (!configured) {
    return;
  }
  const modelDefinition = getAvailableModelsForProvider(session, provider).find((entry) => entry.id === model);
  if (!modelDefinition || modelDefinition.supportedReasoningEfforts.includes(configured)) {
    return;
  }
  configuredEfforts![provider] = modelDefinition.defaultReasoningEffort;
}

function resolveCommandPath(session: RuntimeSession, inputPath?: string): string {
  if (!inputPath || inputPath === ".") {
    return session.cwd;
  }

  return path.resolve(session.cwd, inputPath);
}

function validateToolPath(session: RuntimeSession, targetPath: string): RuntimeCommandFailure | null {
  const resolvedPath = path.resolve(targetPath);

  for (const protectedRoot of session.toolPolicy.protectedRoots) {
    if (isWithinRoot(resolvedPath, protectedRoot)) {
      return {
        ok: false,
        message: `tool policy blocked ${resolvedPath}; protected path`,
        activity: `command blocked · ${resolvedPath}`,
      };
    }
  }

  if (session.toolPolicy.allowedRoots.some((root) => isWithinRoot(resolvedPath, root))) {
    return null;
  }

  return {
    ok: false,
    message: `tool policy blocked ${resolvedPath}; outside repo-local roots`,
    activity: `command blocked · ${resolvedPath}`,
  };
}

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const resolvedRoot = path.resolve(rootPath);
  if (targetPath === resolvedRoot) {
    return true;
  }

  const relativePath = path.relative(resolvedRoot, targetPath);
  return relativePath.length > 0 && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

function formatCommandPath(session: RuntimeSession, targetPath: string): string {
  const relativePath = path.relative(session.cwd, targetPath);
  if (relativePath.length === 0) {
    return ".";
  }

  return relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : targetPath;
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, index));
}

function commandError(command: string, targetPath: string, error: unknown): RuntimeCommandFailure {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    message: `${command} failed for ${targetPath}: ${message}`,
    activity: `command failed · /${command} ${targetPath}`,
  };
}

function findMatches(rootPath: string, searchTerm: string): string[] {
  const matches: string[] = [];
  const queue = [rootPath];
  const normalizedTerm = searchTerm.toLowerCase();

  while (queue.length > 0 && matches.length < 50) {
    const currentPath = queue.shift();
    if (!currentPath) {
      continue;
    }

    const stats = statSync(currentPath);
    if (stats.isDirectory()) {
      const entries = readdirSync(currentPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") {
          continue;
        }

        queue.push(path.join(currentPath, entry.name));
      }
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    const content = readFileSync(currentPath, "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length && matches.length < 50; index += 1) {
      if (lines[index].toLowerCase().includes(normalizedTerm)) {
        matches.push(`${currentPath}:${index + 1}: ${lines[index]}`);
      }
    }
  }

  return matches;
}

function findGlobMatches(rootPath: string, globPattern: string): string[] {
  const matches: string[] = [];
  const queue = [rootPath];
  const pattern = globToRegExp(globPattern);

  while (queue.length > 0 && matches.length < 100) {
    const currentPath = queue.shift();
    if (!currentPath) {
      continue;
    }

    const stats = statSync(currentPath);
    if (stats.isDirectory()) {
      const entries = readdirSync(currentPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") {
          continue;
        }
        queue.push(path.join(currentPath, entry.name));
      }
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    const relativePath = path.relative(rootPath, currentPath).split(path.sep).join("/");
    if (pattern.test(relativePath)) {
      matches.push(relativePath);
    }
  }

  return matches;
}

function globToRegExp(globPattern: string): RegExp {
  const normalized = globPattern.trim().split(path.sep).join("/");
  let source = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index];
    const next = normalized[index + 1];

    if (current === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }

    if (current === "*") {
      source += "[^/]*";
      continue;
    }

    if (current === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(current ?? "");
  }

  source += "$";
  return new RegExp(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function hasRipgrep(): boolean {
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function formatInstructionSources(session: RuntimeSession, layer: "repoBehavior" | "taskContext"): string {
  const sources = session.instructionSources.filter((source) => source.layer === layer);
  if (sources.length === 0) {
    return "none";
  }

  return sources.map((source) => `${source.kind}=${source.summary}`).join(" | ");
}

function formatTransportSummary(session: RuntimeSession): string {
  const endpoint = session.providerTransport.openaiBaseUrl ?? "default";
  return `${session.providerTransport.executor}; adapter=${session.providerTransport.adapter}; mode=${session.providerTransport.mode}; endpoint=${endpoint}; auth=${session.providerTransport.authSource}/${session.providerTransport.authGate}; silent-fallback=${String(session.providerTransport.silentFallback)}`;
}

function formatTransportCapabilities(session: RuntimeSession): string {
  if (session.providerTransport.mode === "http-responses") {
    return "turns=bounded; tool-calls=native-functions; approval=guarded; steer=boundary-only; model-scope=api-limited";
  }
  if (session.providerTransport.mode === "codex-http") {
    return "turns=bounded; tool-calls=xml-loop; approval=guarded; steer=boundary-only; model-scope=api-limited";
  }
  return "turns=bounded; tool-calls=xml-loop; approval=guarded; steer=boundary-only; model-scope=local-cli";
}

function formatTransportCaveat(session: RuntimeSession): string {
  if (session.providerTransport.mode === "http-responses") {
    return "native tool calling works here, but API model set is smaller than CLI/local Codex paths";
  }
  if (session.providerTransport.mode === "codex-http") {
    return "working default live path here; still uses harness XML tool loop instead of native function calls";
  }
  return "depends on local Codex CLI behavior; parity can differ from HTTP transports";
}

function formatRepoFreshness(session: RuntimeSession): string {
  const freshness = session.repo.freshness;
  const dirtyState = freshness.dirty ? "dirty" : "clean";

  switch (freshness.status) {
    case "no-repo":
      return "no git repo";
    case "no-upstream":
      return `no upstream; ${dirtyState}`;
    case "up-to-date":
      return `up to date with ${freshness.tracking}; ${dirtyState}`;
    case "ahead":
      return `ahead ${freshness.ahead ?? 0} of ${freshness.tracking}; ${dirtyState}`;
    case "behind":
      return `behind ${freshness.behind ?? 0} of ${freshness.tracking}; pull needed; ${dirtyState}`;
    case "diverged":
      return `diverged from ${freshness.tracking}; ahead ${freshness.ahead ?? 0}, behind ${freshness.behind ?? 0}; ${dirtyState}`;
  }
}

function resolveFallbackProvider(session: RuntimeSession): string | null {
  const configuredProviders = Object.keys(session.providerRouting.modelSelection.configuredModels).filter((provider) => provider !== "codex");
  if (configuredProviders.length > 0) {
    return configuredProviders[0];
  }

  return session.provider !== "codex" ? session.provider : null;
}

function createDefaultRuntimeTuiState(view: RuntimeTuiView): RuntimeTuiState {
  return {
    view,
    action: {
      status: "ready",
      detail: "runtime baseline",
      pending: false,
      lastActivity: null,
    },
    selectedSection: "agent",
    spinnerFrame: 0,
    activity: [],
    promptBuffer: "",
    transcript: ["assistant: runtime baseline ready"],
    chatHistory: [],
    liveAssistantReply: null,
    currentTurnActivity: [],
    currentTurnTraceDetails: [],
    latestTurnTrace: [],
    traceExpanded: false,
    promptCursor: 0,
    promptHistory: [],
    promptHistoryIndex: -1,
    promptDraft: null,
    completionIndex: 0,
    historyPopupOpen: false,
    historyPopupIndex: 0,
    modelPickerOpen: false,
    modelPickerIndex: 0,
    modelPickerEntries: [],
    modelPickerQuery: "",
    chatScrollOffset: 0,
    latestUserMessage: null,
    latestAssistantMessage: null,
    copyStatus: null,
    copyStatusExpiresAt: 0,
    lastCtrlCAt: 0,
    composerFocusMode: false,
    pendingImageAttachment: null,
    approvalRequired: false,
    pendingApprovalTool: null,
    pendingApprovalSummary: null,
    lastDecision: null,
    cancelRequested: false,
    steerState: null,
    steerMessage: null,
  };
}

function syncTuiEventBuffers(session: RuntimeSession, state: RuntimeTuiState): void {
  const recent = session.events.slice(-20);
  state.activity = recent
    .slice()
    .reverse()
    .map((event) => formatActivityLine(`${event.kind} ${event.status} · ${event.summary}`))
    .slice(0, 6);
  state.transcript = recent.length > 0
    ? recent.flatMap((event) => formatTranscriptEvent(event))
    : ["assistant: no messages yet"];
  state.chatHistory = buildChatHistoryFromSession(session).slice(-CHAT_HISTORY_SCROLLBACK_LINES);
  state.liveAssistantReply = null;
  const lastPromptIndex = [...session.events].map((event) => event.kind).lastIndexOf("prompt");
  const latestTurnEvents = (lastPromptIndex >= 0 ? session.events.slice(lastPromptIndex) : recent)
    .filter((event) => !["system", "prompt", "assistant"].includes(event.kind));
  state.currentTurnActivity = latestTurnEvents
    .slice(-16)
    .flatMap((event) => formatTranscriptEvent(event))
    .slice(-40);
  state.currentTurnTraceDetails = latestTurnEvents
    .slice(-24)
    .flatMap((event) => formatVerboseTraceEvent(event))
    .slice(-80);
  state.latestTurnTrace = summarizeTurnEvents(latestTurnEvents);
  state.latestUserMessage = [...session.conversation].reverse().find((turn) => turn.role === "user")?.content ?? null;
  state.latestAssistantMessage = [...session.conversation].reverse().find((turn) => turn.role === "assistant")?.content ?? null;
  state.approvalRequired = session.operationControls.requireApprovalForGuarded;
  state.pendingApprovalTool = session.operationControls.pendingApproval?.tool ?? null;
  state.pendingApprovalSummary = session.operationControls.pendingApproval?.summary ?? null;
  state.lastDecision = session.operationControls.lastDecision;
  state.cancelRequested = session.operationControls.cancelRequested;
  state.steerState = session.operationControls.steerState ?? null;
  state.steerMessage = session.operationControls.steerMessage ?? null;
  const provider = session.providerTransport.activeProvider;
  const currentModel = getCurrentProviderModel(session);
  state.modelPickerEntries = getAvailableModelsForProvider(session, provider).map((entry) => ({
    id: entry.id,
    description: entry.description,
    current: entry.id === currentModel,
    disabledReason: entry.disabledReason,
  }));
}

export function buildChatHistoryFromSession(session: RuntimeSession): string[] {
  const lines: string[] = [];
  const assistantReplies = session.conversation.filter((turn) => turn.role === "assistant");
  let assistantIndex = 0;
  let currentTurnEvents: RuntimeSession["events"] = [];

  const flushTurnEvents = () => {
    const turnLines = formatInlineTurnBlock(currentTurnEvents);
    if (turnLines.length > 0) {
      lines.push(...turnLines);
    }
    currentTurnEvents = [];
  };

  for (const event of session.events) {
    if (event.kind === "prompt" && event.detail) {
      flushTurnEvents();
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push(`you: ${event.detail}`);
      continue;
    }

    if (event.kind === "assistant" && event.status === "completed") {
      flushTurnEvents();
      const reply = assistantReplies[assistantIndex]?.content ?? event.detail;
      assistantIndex += 1;
      if (!reply) {
        continue;
      }
      lines.push(`agent: ${reply}`);
      if (assistantIndex === assistantReplies.length && (session.telemetry.lastInputTokens > 0 || session.telemetry.lastOutputTokens > 0)) {
        lines.push(`turn-detail: tokens ${formatTurnTokens(session)}`);
      }
      lines.push("");
      continue;
    }

    if (event.kind === "command") {
      flushTurnEvents();
      const commandName = event.summary.match(/command\s+(\S+)/)?.[1] ?? "command";
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push(`you: ${commandName}`);
      lines.push(...formatCommandBoundary(event));
      lines.push("");
      continue;
    }

    if (!["system", "compact"].includes(event.kind)) {
      currentTurnEvents.push(event);
    }
  }

  flushTurnEvents();

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

function formatInlineTurnBlock(events: RuntimeSession["events"]): string[] {
  if (events.length === 0) {
    return [];
  }

  const providerStarted = events.some((event) => event.kind === "provider" && event.status === "started");
  const providerFailed = events.find((event) => event.kind === "provider" && event.status === "failed");
  const toolEvents = events.filter((event) => event.kind === "tool");
  const toolStarted = toolEvents.filter((event) => event.status === "started");
  const toolFinal = toolEvents.filter((event) => ["completed", "failed", "blocked", "canceled"].includes(event.status));
  const controlEvents = events.filter((event) => event.kind === "control");
  const toolNames = [...new Set((toolStarted.length > 0 ? toolStarted : toolEvents)
    .map((event) => event.summary.match(/tool\s+([a-z0-9_]+)/i)?.[1] ?? null)
    .filter((value): value is string => value !== null))];
  const lines: string[] = [];

  if (providerStarted) {
    lines.push("turn: Thinking");
  }
  if (toolNames.length > 0) {
    lines.push(`turn: Tool calls (${String(toolNames.length)})`);
    for (const event of toolFinal.slice(-12)) {
      lines.push(`turn-detail: ${formatCompactToolEvent(event)}`);
    }
  }
  for (const event of controlEvents.slice(-4)) {
    lines.push(`turn-detail: ${event.summary}`);
  }
  if (providerFailed) {
    lines.push(`turn-detail: ${providerFailed.summary}`);
  }

  return lines;
}

export function formatTranscriptEvent(event: RuntimeSession["events"][number]): string[] {
  if (!event.detail) {
    return [`${event.kind}: ${event.summary}`];
  }

  if (event.kind === "assistant") {
    return [`assistant: ${event.detail}`];
  }

  if (event.kind === "command") {
    return formatCommandBoundary(event);
  }

  const detailLines = event.detail.split("\n");
  const [firstLine, ...rest] = detailLines;
  const lines = [`${event.kind}: ${event.summary} · ${firstLine}`];
  if (rest.length > 0) {
    lines.push(`… ${String(rest.length)} more line${rest.length === 1 ? "" : "s"} hidden`);
  }
  return lines;
}

function formatVerboseTraceEvent(event: RuntimeSession["events"][number]): string[] {
  if (event.kind === "tool") {
    return [`${event.at} · ${formatCompactToolEvent(event)}`];
  }

  const header = `${event.at} · ${event.kind} · ${event.status} · ${event.summary}`;
  if (!event.detail) {
    return [header];
  }

  const detailLines = event.detail.split("\n");
  return [
    header,
    ...detailLines.map((line) => `  ${line}`),
  ];
}

function formatCompactToolEvent(event: RuntimeSession["events"][number]): string {
  const name = event.summary.match(/tool\s+([a-z0-9_]+)/i)?.[1] ?? "tool";
  const meta = parseToolEventDetail(event.detail ?? "");
  const pieces = [formatToolDisplayName(name), event.status];
  if (meta.duration) {
    pieces.push(meta.duration);
  }
  if (meta.outputTokens) {
    pieces.push(meta.outputTokens);
  }
  if (meta.risk && meta.risk !== "low") {
    pieces.push(meta.risk);
  }
  const outputSummary = summarizeToolOutput(name, meta.output, event.status);
  if (outputSummary) {
    pieces.push(outputSummary);
  }
  return pieces.join(" · ");
}

function formatToolDisplayName(name: string): string {
  const labels: Record<string, string> = {
    read_file: "File Read",
    write_file: "File Write",
    apply_patch: "Patch Apply",
    preview_patch: "Patch Preview",
    list_dir: "Dir List",
    search_content: "Text Search",
    search_files: "File Search",
    web_fetch: "Web Fetch",
    web_search: "Web Search",
    git_status: "Git Status",
    git_diff: "Git Diff",
    shell_command: "Shell",
    nexsight_execute: "Nexsight Run",
    nexsight_index: "Nexsight Index",
    nexsight_search: "Nexsight Search",
    archivist_save: "Memory Save",
    archivist_checkpoint: "Checkpoint",
  };
  return labels[name] ?? name.replace(/_/g, " ").replace(/\b\w/g, (value) => value.toUpperCase());
}

function summarizeToolOutput(name: string, output: string | null, status: string): string | null {
  if (!output || output === "none") {
    return null;
  }

  if (name === "list_dir") {
    const files = output.match(/\bfile\b/g)?.length ?? 0;
    const dirs = output.match(/\bdir\b/g)?.length ?? 0;
    const entries = files + dirs;
    if (entries > 0) {
      return `${entries} entries${files > 0 || dirs > 0 ? ` (${files} files, ${dirs} dirs)` : ""}`;
    }
  }

  if (name === "search_files" || name === "search_content") {
    const matches = output === "(no matches)" ? 0 : Math.max(1, output.split(/\s+/).filter(Boolean).length);
    return `${matches} matches`;
  }

  if (name === "read_file") {
    const lines = output.match(/\n/g)?.length ?? 0;
    return lines > 0 ? `${lines + 1} lines` : "read";
  }

  if (status === "failed" || status === "blocked" || status === "canceled") {
    return truncateLine(output, 72);
  }

  if (name === "write_file" || name === "apply_patch" || name === "preview_patch" || name === "git_status" || name === "git_diff") {
    return truncateLine(output, 72);
  }

  return null;
}

function parseToolEventDetail(detail: string): { risk: string | null; duration: string | null; outputTokens: string | null; output: string | null } {
  if (!detail) {
    return { risk: null, duration: null, outputTokens: null, output: null };
  }

  const duration = detail.match(/duration=([^;]+)/)?.[1]?.trim() ?? null;
  const outputTokens = detail.match(/out~\d+/)?.[0] ?? null;
  const output = detail.match(/output=([\s\S]+)/)?.[1]?.replace(/\s+/g, " ").trim() ?? null;
  const risk = detail.split(";")[0]?.trim() ?? null;
  return { risk, duration, outputTokens, output };
}

function renderRuntimeTuiState(state: RuntimeTuiState, terminalSize?: Partial<TerminalSize>): string {
  const size = resolveTerminalSize(terminalSize);
  const contentWidth = Math.max(40, size.columns - 4);
  const leftPad = size.columns > contentWidth ? 2 : 0;
  const header = `${state.view.title} :: agent tui`;
  const summary = truncateLine(
    `provider ${lookupValue(state.view.metadata, "provider")} | session ${lookupValue(state.view.metadata, "session")}`,
    contentWidth,
  );
  const workspace = renderWorkspacePanel(state, contentWidth);
  const topPane = [
    tintLine(truncateLine(header, contentWidth), ANSI.header),
    tintLine(truncateLine("=".repeat(Math.min(header.length, contentWidth)), contentWidth), ANSI.dim),
    tintLine(summary, ANSI.dim),
    "",
    ...workspace.top,
  ];
  const middlePane = [...workspace.middle];
  const bottomPane = [
    ...workspace.bottom,
    truncateLine(KEY_HINT, contentWidth),
  ];
  const lines = composeTuiPanes(topPane, middlePane, bottomPane, Math.max(10, size.rows) - 1, state.chatScrollOffset, contentWidth)
    .map((line) => `${" ".repeat(leftPad)}${line}`);

  return renderScreen(lines);
}

function renderSidebar(selectedSection: RuntimeTuiSection, width: number): string[] {
  return [
    padLine("sections", width),
    padLine("--------", width),
    ...TUI_SECTIONS.map((section) => padLine(`${section === selectedSection ? ">" : " "} ${section}`, width)),
  ];
}

function renderMainPanel(state: RuntimeTuiState, width: number): string[] {
  const section = state.selectedSection;

  if (section === "agent") {
    return renderAgentPanel(state, width);
  }

  const rows = getSectionRows(state.view, section);
  const title = section === "overview" ? "runtime overview" : section;
  const content = rows.flatMap(([label, value]) => wrapPair(label, value, width));

  return [
    padLine(title, width),
    padLine("-".repeat(Math.min(title.length, width)), width),
    ...content,
  ];
}

function renderActivity(activity: string[], width: number): string[] {
  if (activity.length === 0) {
    return [];
  }

  const items = activity;
  const lines = items.flatMap((line) => wrapText(line, Math.max(12, width - 4)));
  return renderTuiBlock("activity", lines, width);
}

export function formatProgressChrome(spinnerTick: number, action: Pick<RuntimeSession["action"], "status" | "detail">): string {
  const emblem = action.status === "running"
    ? NEXAGENT_EMBLEM_FRAMES[((spinnerTick % NEXAGENT_EMBLEM_FRAMES.length) + NEXAGENT_EMBLEM_FRAMES.length) % NEXAGENT_EMBLEM_FRAMES.length]
    : NEXAGENT_EMBLEM_FRAMES[0];
  if (action.status !== "running") {
    return emblem;
  }
  const verb = selectProgressVerb(action);
  return `${emblem} ${verb} · ${action.status} · ${action.detail}`;
}

export function buildPacedReplyFrames(reply: string, maxFrames = PACED_REPLY_MAX_FRAMES): string[] {
  const normalized = reply.trimEnd();
  if (normalized.length === 0) {
    return [];
  }

  const frameCount = Math.min(maxFrames, normalized.length);
  const frames: string[] = [];
  let previousEnd = 0;
  for (let index = 1; index <= frameCount; index += 1) {
    const rawEnd = Math.ceil((normalized.length * index) / frameCount);
    const end = index === frameCount ? normalized.length : findPacedReplyBoundary(normalized, rawEnd, previousEnd);
    const frame = normalized.slice(0, end);
    if (frame !== frames[frames.length - 1]) {
      frames.push(frame);
      previousEnd = end;
    }
  }
  return frames;
}

function findPacedReplyBoundary(reply: string, targetEnd: number, previousEnd: number): number {
  const minEnd = Math.min(reply.length, Math.max(previousEnd + 1, targetEnd));
  const lookaheadEnd = Math.min(reply.length, minEnd + 18);
  for (let index = minEnd; index < lookaheadEnd; index += 1) {
    if (/\s|[.,;:!?)]/.test(reply[index] ?? "")) {
      return index + 1;
    }
  }
  return minEnd;
}

async function renderPacedAssistantReply(
  state: RuntimeTuiState,
  reply: string,
  render: () => void,
): Promise<void> {
  const frames = buildPacedReplyFrames(reply);
  for (const frame of frames) {
    state.liveAssistantReply = frame;
    render();
    await new Promise((resolve) => setTimeout(resolve, PACED_REPLY_FRAME_DELAY_MS));
  }
}

function selectProgressVerb(action: Pick<RuntimeSession["action"], "status" | "detail">): string {
  const detail = action.detail.toLowerCase();

  if (detail.includes("runtime baseline") || detail.includes("loading") || detail.includes("startup")) {
    return "Bootstrapping";
  }
  if (detail.includes("refresh")) {
    return "Perusing";
  }
  if (detail.includes("provider request") || detail.includes("response received")) {
    return "Thinking";
  }
  if (detail.includes("auto compact") || detail.includes("compact")) {
    return "Synthesizing";
  }
  if (detail.includes("awaiting approval")) {
    return "Considering";
  }
  if (detail.includes("tool read_file") || detail.includes("tool list_dir") || detail.includes("tool search_") || detail.includes("tool git_status")) {
    return "Perusing";
  }
  if (detail.includes("tool write_file") || detail.includes("tool apply_patch")) {
    return "Crafting";
  }
  if (detail.includes("tool shell_command")) {
    return "Crunching";
  }
  if (detail.includes("tool archivist_")) {
    return "Synthesizing";
  }
  if (detail.includes("login") || detail.includes("auth")) {
    return "Determining";
  }

  const source = `${action.status}:${action.detail}`;
  return SPINNER_VERBS[stableVerbIndex(source)];
}

function stableVerbIndex(source: string): number {
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash * 31) + source.charCodeAt(index)) >>> 0;
  }
  return hash % SPINNER_VERBS.length;
}

function formatCompletionPreview(completion: PromptCompletionResult | null, fallbackHint: string | null): string {
  if (!completion || completion.suggestions.length === 0) {
    return `hint ${fallbackHint ?? "none"}`;
  }
  const selected = completion.suggestions[completion.selectedIndex];
  const preview = completion.value.trim().length > 0 ? completion.value : selected?.value ?? "";
  return `preview ${preview}`;
}

function renderCompletionMenu(completion: PromptCompletionResult | null, width: number): string[] {
  if (!completion || completion.suggestions.length === 0) {
    return [];
  }

  const windowSize = Math.min(8, completion.suggestions.length);
  const start = Math.max(0, Math.min(
    completion.suggestions.length - windowSize,
    completion.selectedIndex - Math.floor(windowSize / 2),
  ));
  const visible = completion.suggestions.slice(start, start + windowSize);
  const header = completion.suggestions.length > windowSize
    ? `suggestions ${completion.selectedIndex + 1}/${completion.suggestions.length} · ↑/↓ select · Tab accept`
    : "suggestions · ↑/↓ select · Tab accept";

  return [
    header,
    ...visible.map((suggestion, offset) => {
      const index = start + offset;
      const marker = index === completion.selectedIndex ? ">" : " ";
      return truncateLine(`${marker} ${suggestion.label.padEnd(28)} ${suggestion.hint}`, width);
    }),
  ];
}

function renderAgentPanel(state: RuntimeTuiState, width: number): string[] {
  const transcript = state.transcript.length > 0 ? state.transcript : ["assistant: no messages yet"];
  const composer = renderPromptBuffer(state.promptBuffer, state.promptCursor);
  const completion = state.promptBuffer.length > 0
    ? autocompletePromptBuffer({ cwd: lookupValue(state.view.metadata, "cwd") }, state.promptBuffer, state.completionIndex)
    : null;
  const composerHint = state.promptBuffer.length > 0 ? describePromptHint({ cwd: lookupValue(state.view.metadata, "cwd") }, state.promptBuffer) : "start typing or use slash command";
  const promptComposerLines = renderPromptForComposer(composer, width);
  const lines = [
    padLine("agent console", width),
    padLine("-------------", width),
    ...wrapText(`status: ${state.action.pending ? "running" : "idle"}`, width),
    ...wrapText(`runtime: ${state.action.status} · ${state.action.detail}`, width),
    ...wrapText(`last activity: ${state.action.lastActivity ?? "none"}`, width),
    ...wrapText(`panel: ${state.selectedSection} · activity: ${state.activity.length}`, width),
    ...wrapText(`attachment: ${formatAttachmentLabel(state.pendingImageAttachment)}`, width),
    ...wrapText(`turns: ${lookupMetadataValue(state.view.metadata, "turns", "0")} · tokens: ${lookupMetadataValue(state.view.metadata, "lastTokens", "in~0 out~0")}`, width),
    "",
    padLine("composer", width),
    ...promptComposerLines,
    ...wrapText(formatCompletionPreview(completion, composerHint), width),
    ...renderCompletionMenu(completion, width),
    padLine("transcript", width),
    ...transcript.flatMap((entry) => wrapText(entry, width)),
  ];

  return lines.map((line) => padLine(line, width));
}

function renderWorkspacePanel(
  state: RuntimeTuiState,
  width: number,
): { top: string[]; middle: string[]; bottom: string[] } {
  if (state.chatHistory.length === 0 && state.action.status === "ready" && !state.action.pending) {
    return renderIdleHomePanel(state, width);
  }

  const composer = renderPromptBuffer(state.promptBuffer, state.promptCursor);
  const completion = state.promptBuffer.length > 0 ? autocompletePromptBuffer({ cwd: lookupValue(state.view.metadata, "cwd") }, state.promptBuffer, state.completionIndex) : null;
  const composerHint = state.promptBuffer.length > 0 ? describePromptHint({ cwd: lookupValue(state.view.metadata, "cwd") }, state.promptBuffer) : "start typing or use slash command";
  const promptComposerLines = renderPromptForComposer(composer, width);
  const chatLines = renderConversationTranscript(state.chatHistory, width, state.liveAssistantReply);
  const operatorPanels = renderOperatorTurnPanels(state, width);
  const footerStatus = buildFooterStatus(state, width);
  const hasTrace = state.latestTurnTrace.length > 0 || state.currentTurnActivity.length > 0;
  const expandedTraceLines: string[] = [
    "▾ Ctrl+T collapse",
    ...(state.latestTurnTrace.length > 0 ? ["", "summary", ...state.latestTurnTrace] : []),
    ...(state.currentTurnTraceDetails.length > 0 ? ["", "events", ...state.currentTurnTraceDetails] : []),
  ];
  const fullTraceBlock = hasTrace && state.traceExpanded
    ? [
      ...renderMessageBox("trace", expandedTraceLines.join("\n"), width),
    ]
    : [];
  const compactTraceBlock = hasTrace && !state.traceExpanded
    ? renderCollapsedTraceSummary(state, width)
    : [];
  const composerMeta = [
    `chars ${state.promptBuffer.length}`,
    `cursor ${Math.min(state.promptCursor + 1, Math.max(1, state.promptBuffer.length + 1))}`,
    `focus ${state.composerFocusMode ? "on" : "off"}`,
    ...(state.pendingImageAttachment ? [`img ${state.pendingImageAttachment.name} ${formatBytes(state.pendingImageAttachment.bytes)}`] : []),
  ].join(" · ");
  const composerBody = [
    ...promptComposerLines.map((line) => tintLine(line, ANSI.prompt)),
    ...(state.pendingImageAttachment
      ? wrapText(`image attached ${state.pendingImageAttachment.path}`, width).map((line) => tintLine(line, ANSI.preview))
      : []),
    ...wrapText(formatCompletionPreview(completion, composerHint), width).map((line) => tintLine(line, completion?.suggestions.length ? ANSI.preview : ANSI.dim)),
    ...renderCompletionMenu(completion, width).map((line) => tintLine(line, ANSI.preview)),
    tintLine(truncateLine(composerMeta, width), ANSI.footer),
  ];
  const composerLines = [
    tintLine(renderRule(width), ANSI.rule),
    tintLine(footerStatus, ANSI.footer),
    tintLine(renderRule(width), ANSI.rule),
    ...renderTuiBlock(state.composerFocusMode ? "composer (focus)" : "composer", composerBody, width),
  ];

  return {
    top: renderWorkspaceTopStatus(state, width),
    middle: [
      ...renderControlCard(state, width),
      ...(state.modelPickerOpen
        ? renderModelPicker(state, width)
        : state.historyPopupOpen
          ? renderHistoryPopup(state, width)
          : [...operatorPanels, ...chatLines]),
      ...(compactTraceBlock.length > 0 ? ["", ...compactTraceBlock] : []),
      ...(fullTraceBlock.length > 0 ? ["", ...fullTraceBlock] : []),
    ],
    bottom: [
      ...composerLines,
    ],
  };
}

function buildFooterStatus(state: RuntimeTuiState, width: number): string {
  const provider = lookupValue(state.view.metadata, "provider");
  const turns = lookupMetadataValue(state.view.metadata, "turns", "0");
  const tokens = lookupMetadataValue(state.view.metadata, "lastTokens", "in~0 out~0");
  const cwd = lookupValue(state.view.metadata, "cwd");
  const contextMeter = formatContextMeterFromState(state);
  const model = lookupActiveModel(state) ?? "none";
  const verb = selectProgressVerb(state.action);
  const runBadge = state.action.pending
    ? `${formatActiveEmblemFrame(state.spinnerFrame)} ${verb}`
    : NEXAGENT_EMBLEM_FRAMES[0];
  const copyPart = state.copyStatus ? ` │ ${state.copyStatus}` : "";
  const attachmentPart = state.pendingImageAttachment ? " │ image 1" : "";
  const approvalPart = state.pendingApprovalTool ? ` │ approval ${state.pendingApprovalTool}` : "";
  const steerPart = state.steerMessage ? ` │ steer ${state.steerState ?? "queued"}` : "";
  const modePart = state.composerFocusMode ? " │ focus composer" : "";
  const legacyStatusline = state.view.statusline ? ` │ ${state.view.statusline}` : "";
  return truncateLine(`${runBadge} │ ${model}@${provider} │ turns ${turns} │ ${tokens} │ ${contextMeter}${attachmentPart}${approvalPart}${steerPart}${copyPart}${modePart}${legacyStatusline} │ ${formatShortPath(cwd)}`, width);
}

function formatActiveEmblemFrame(frame: number): string {
  const emblem = NEXAGENT_EMBLEM_FRAMES[((frame % NEXAGENT_EMBLEM_FRAMES.length) + NEXAGENT_EMBLEM_FRAMES.length) % NEXAGENT_EMBLEM_FRAMES.length];
  const spinner = SPINNER_FRAMES[((frame % SPINNER_FRAMES.length) + SPINNER_FRAMES.length) % SPINNER_FRAMES.length];
  return `${spinner}${emblem}`;
}

function renderWorkspaceTopStatus(state: RuntimeTuiState, width: number): string[] {
  const scroll = formatScrollState(state, width);
  if (!scroll) {
    return [];
  }

  return [tintLine(padLeftVisible(scroll, width), ANSI.dim)];
}

function padLeftVisible(value: string, width: number): string {
  return truncateLine(value.padStart(width, " "), width);
}

function formatContextMeterFromState(state: RuntimeTuiState): string {
  const left = Number.parseInt(lookupMetadataValue(state.view.metadata, "contextLeft", "0"), 10);
  const limit = Number.parseInt(lookupMetadataValue(state.view.metadata, "contextLimit", "0"), 10);
  return formatContextMeter(Number.isFinite(left) ? left : 0, Number.isFinite(limit) ? limit : 0);
}

function formatContextMeter(left: number, limit: number): string {
  const safeLimit = limit > 0 ? limit : 128000;
  const safeLeft = Math.max(0, Math.min(left, safeLimit));
  const used = safeLimit - safeLeft;
  const usedRatio = safeLimit === 0 ? 0 : used / safeLimit;
  const slots = 10;
  const filled = Math.max(0, Math.min(slots, Math.round(usedRatio * slots)));
  const graph = `${"#".repeat(filled)}${"-".repeat(slots - filled)}`;
  return `ctx [${graph}] ${Math.round(usedRatio * 100)}% ${formatCompactNumber(safeLeft)}/${formatCompactNumber(safeLimit)} free`;
}

function formatCompactNumber(value: number): string {
  if (value >= 1000) {
    return `${Math.round(value / 1000)}k`;
  }
  return String(value);
}

function formatShortPath(value: string): string {
  const home = process.env.HOME;
  const normalized = home && value.startsWith(home) ? `~${value.slice(home.length)}` : value;
  if (normalized.length <= 44) {
    return normalized;
  }

  const parts = normalized.split("/").filter(Boolean);
  if (normalized.startsWith("~/") && parts.length >= 3) {
    return `~/${["...", ...parts.slice(-2)].join("/")}`;
  }
  if (parts.length >= 3) {
    return `/${["...", ...parts.slice(-2)].join("/")}`;
  }
  return truncateLine(normalized, 44);
}

function renderTurnHeaderBadges(state: RuntimeTuiState, width: number): string[] {
  const provider = lookupValue(state.view.metadata, "provider");
  const model = lookupActiveModel(state) ?? "none";
  const mode = lookupMetadataValue(state.view.routing, "mode", lookupMetadataValue(state.view.routing, "transport", "unknown"));
  const tokens = lookupMetadataValue(state.view.metadata, "lastTokens", "in~0 out~0");
  const time = state.action.lastActivity ?? "now";
  const toolCount = state.latestTurnTrace.filter((line) => line.includes("tools:") || line.includes("tool")).length;
  const duration = state.action.pending ? "running" : state.action.status;
  return [
    tintLine(truncateLine(`turn · ${time} · ${mode} · ${provider}/${model} · tools ${toolCount} · ${duration} · ${tokens}`, width), ANSI.footer),
    tintLine(renderRule(width), ANSI.rule),
  ];
}

function renderOperatorTurnPanels(state: RuntimeTuiState, width: number): string[] {
  return [
    ...renderPinnedWarningLane(state, width),
  ];
}

function renderPinnedWarningLane(state: RuntimeTuiState, width: number): string[] {
  const warnings = [
    ...(state.action.status === "error" ? [`error: ${state.action.detail}`] : []),
    ...(state.pendingApprovalTool ? [`waiting approval: ${state.pendingApprovalTool}`] : []),
    ...(state.cancelRequested ? ["cancel requested"] : []),
  ];
  return warnings.length > 0 ? renderMessageBox("warning lane", warnings.join("\n"), width) : [];
}

function renderIntentEchoLine(state: RuntimeTuiState, width: number): string[] {
  const intent = state.latestUserMessage ?? [...state.chatHistory].reverse().find((line) => line.startsWith("you: "))?.slice(5) ?? null;
  return intent ? [tintLine(truncateLine(`intent: ${intent}`, width), ANSI.user)] : [];
}

function renderStructuredTurnBlocks(state: RuntimeTuiState, width: number): string[] {
  const intent = state.latestUserMessage ?? "awaiting operator intent";
  const actions = state.latestTurnTrace.length > 0 ? state.latestTurnTrace.join(" | ") : state.action.detail;
  const result = state.latestAssistantMessage ?? (state.action.pending ? "in progress" : state.action.status);
  const nextStep = state.pendingApprovalTool
    ? "approve or reject"
    : state.action.status === "error"
      ? "inspect warning lane"
      : state.action.pending
        ? "wait or steer"
        : "ready for next prompt";
  return renderMessageBox("turn blocks", [
    `intent  ${intent}`,
    `actions ${actions}`,
    `result  ${result}`,
    `next    ${nextStep}`,
  ].join("\n"), width);
}

function renderDiffSummaryCard(state: RuntimeTuiState, width: number): string[] {
  const writeHints = state.currentTurnActivity.filter((line) => /write_file|apply_patch|git_diff|diff/i.test(line));
  const summary = writeHints.length > 0
    ? writeHints.slice(0, 3).join("\n")
    : "no file-change evidence in current turn";
  return renderMessageBox("diff summary", summary, width);
}

function renderRiskBadgeLine(state: RuntimeTuiState, width: number): string[] {
  const risk = state.action.status === "error" || state.cancelRequested
    ? "high"
    : state.pendingApprovalTool
      ? "guarded"
      : state.action.pending
        ? "medium"
        : "low";
  const confidence = state.action.status === "error" ? "blocked" : state.action.pending ? "working" : "ready";
  return [tintLine(truncateLine(`risk ${risk} · confidence ${confidence} · approval ${state.approvalRequired ? "on" : "off"}`, width), ANSI.footer)];
}

function renderOutcomeFooter(state: RuntimeTuiState, width: number): string[] {
  const outcome = state.pendingApprovalTool
    ? "waiting"
    : state.action.status === "error"
      ? "failed"
      : state.action.pending
        ? "running"
        : "completed";
  return [truncateLine(`outcome: ${outcome} · detail: ${state.action.detail}`, width)];
}

function renderInlineActionChips(state: RuntimeTuiState, width: number): string[] {
  const chips = state.pendingApprovalTool
    ? ["[approve Ctrl+Y]", "[reject Ctrl+N]", "[details /tools]"]
    : state.action.status === "error"
      ? ["[retry /continue]", "[inspect /status]", "[diff /diff]"]
      : state.action.pending
        ? ["[abort Esc]", "[hold /cancel]", "[replan /steer]"]
        : ["[next prompt]", "[status /status]", "[memory /memory]"];
  return [truncateLine(`actions: ${chips.join(" ")}`, width)];
}

function renderKeyboardNavigationLine(width: number): string[] {
  return [truncateLine("nav: Tab sections · Ctrl+T trace · PgUp/PgDn scroll · wheel scroll · drag select", width)];
}

function renderDensityControlLine(width: number): string[] {
  return [truncateLine("density: compact cards · expanded trace on Ctrl+T · detailed panels stay one line when idle", width)];
}

function renderTerminalCapabilityPanel(state: RuntimeTuiState, width: number): string[] {
  const caps = lookupMetadataValue(state.view.routing, "capabilities", "unknown");
  const auth = lookupMetadataValue(state.view.routing, "authGate", "unknown");
  const toolPolicy = lookupMetadataValue(state.view.metadata, "toolPolicy", "unknown");
  return renderMessageBox("terminal capabilities", `transport ${caps}\nauth ${auth}\ntools ${toolPolicy}`, width);
}

function formatScrollState(state: RuntimeTuiState, width: number): string {
  if (state.chatHistory.length === 0 && state.latestTurnTrace.length === 0 && state.currentTurnActivity.length === 0) {
    return "";
  }
  const middle = [
    ...renderConversationTranscript(state.chatHistory, width, state.liveAssistantReply),
    ...((state.latestTurnTrace.length > 0 || state.currentTurnActivity.length > 0) && !state.traceExpanded ? renderCollapsedTraceSummary(state, width) : []),
    ...((state.latestTurnTrace.length > 0 || state.currentTurnActivity.length > 0) && state.traceExpanded
      ? [
        ...(state.latestTurnTrace.length > 0 ? renderMessageBox("trace", state.latestTurnTrace.join("\n"), width) : []),
        ...(state.currentTurnActivity.length > 0 ? renderMessageBox("working", state.currentTurnActivity.join("\n"), width) : []),
      ]
      : []),
  ];
  const availableMiddle = Math.max(1, Math.max(10, resolveTerminalSize().rows) - 8);
  const maxScroll = Math.max(0, middle.length - availableMiddle);
  if (maxScroll === 0) {
    return "";
  }
  if (state.chatScrollOffset === 0) {
    return "scroll bottom";
  }
  if (state.chatScrollOffset >= maxScroll) {
    return "scroll top";
  }
  return `scroll ${state.chatScrollOffset}/${maxScroll}`;
}

function renderIdleHomePanel(
  state: RuntimeTuiState,
  width: number,
): { top: string[]; middle: string[]; bottom: string[] } {
  const innerWidth = Math.max(20, width - 4);
  const leftWidth = Math.max(18, Math.floor(innerWidth * 0.42));
  const rightWidth = Math.max(18, innerWidth - leftWidth - 3);
  const recent = (state.activity.length > 0 ? state.activity : [formatActivityLine("runtime baseline ready")])
    .slice(0, 3)
    .map(stripActivityTimestamp);
  const provider = lookupValue(state.view.metadata, "provider");
  const repo = lookupValue(state.view.metadata, "repo");
  const cwd = lookupValue(state.view.metadata, "cwd");
  const model = lookupValue(state.view.routing, "models").split(",").find((entry) => entry.startsWith(`${provider}=`))?.split("=")[1] ?? "none";
  const left = [
    "Welcome back.",
    "",
    `${provider} · ${model}`,
    repo,
    cwd,
  ].flatMap((line) => wrapText(line, leftWidth));
  const right = [
    "Recent activity",
    ...recent,
    "",
    "What's new",
    "workspace-first chat",
    "colored footer HUD",
    "approval gate + steer",
    "",
    "Quick start",
    "/status",
    "/provider",
    "type prompt below",
  ].flatMap((line) => wrapText(line, rightWidth));
  const composer = renderPromptBuffer(state.promptBuffer, state.promptCursor);
  const completion = state.promptBuffer.length > 0 ? autocompletePromptBuffer({ cwd }, state.promptBuffer, state.completionIndex) : null;
  const composerHint = state.promptBuffer.length > 0 ? describePromptHint({ cwd }, state.promptBuffer) : "start typing or use slash command";
  const promptComposerLines = renderPromptForComposer(composer, width);
  const promptBlock = [
    tintLine("prompt", ANSI.agent),
    ...promptComposerLines.map((line) => tintLine(line, ANSI.prompt)),
    ...wrapText(formatCompletionPreview(completion, composerHint), width)
      .map((line) => tintLine(line, completion?.suggestions.length ? ANSI.preview : ANSI.dim)),
    ...renderCompletionMenu(completion, width).map((line) => tintLine(line, ANSI.preview)),
  ];
  const footerStatus = buildFooterStatus(state, width);

  return {
    top: [],
    middle: [
      ...renderTuiBlock("home", combineColumns(left, right, leftWidth, rightWidth), width),
    ],
    bottom: [...promptBlock, tintLine(renderRule(width), ANSI.rule), tintLine(footerStatus, ANSI.footer), tintLine(renderRule(width), ANSI.rule)],
  };
}

function renderTuiBlock(title: string, contentLines: string[], width: number): string[] {
  const innerWidth = Math.max(12, width - 4);
  const titleText = ` ${title} `;
  const horizontal = "─".repeat(Math.max(0, innerWidth - titleText.length));
  const lines = contentLines.length > 0 ? contentLines : ["none"];
  const framelessBody = title.startsWith("composer");
  return [
    truncateLine(`╭${titleText}${horizontal}╮`, width),
    ...lines.map((line) => truncateLine(framelessBody ? `  ${line}` : `│ ${padLine(line, innerWidth)} │`, width)),
    truncateLine(`╰${"─".repeat(innerWidth + 2)}╯`, width),
  ];
}

function renderPromptBuffer(buffer: string, cursor: number): string {
  const boundedCursor = Math.max(0, Math.min(cursor, buffer.length));
  const before = buffer.slice(0, boundedCursor);
  const after = buffer.slice(boundedCursor);
  return `${before}▌${after}`;
}

function renderPromptForComposer(buffer: string, width: number): string[] {
  const lines: string[] = [];
  const segments = buffer.split("\n");
  let firstLine = true;
  for (const segment of segments) {
    const segmentWidth = Math.max(12, width - (firstLine ? 2 : 0));
    const wrapped = segment.length > 0 ? wrapText(segment, segmentWidth) : [""];
    for (const line of wrapped) {
      lines.push(firstLine ? `> ${line}` : line);
      firstLine = false;
    }
  }
  return lines.length > 0 ? lines : ["> "];
}

function renderHistoryPopup(state: RuntimeTuiState, width: number): string[] {
  const entries = [...state.promptHistory].reverse();
  if (entries.length === 0) {
    return renderMessageBox("history", "no saved prompts yet", Math.min(width, 96));
  }

  const boxWidth = Math.min(width, 108);
  const windowSize = 8;
  const start = Math.max(0, Math.min(entries.length - windowSize, state.historyPopupIndex - Math.floor(windowSize / 2)));
  const visible = entries.slice(start, start + windowSize);
  const listWidth = Math.max(24, Math.floor((boxWidth - 3) * 0.42));
  const previewWidth = Math.max(24, boxWidth - listWidth - 3);
  const lines = visible.flatMap((entry, index) => {
    const absoluteIndex = start + index;
    const prefix = absoluteIndex === state.historyPopupIndex ? "› " : "  ";
    return wrapText(`${prefix}${entry.replaceAll("\n", " ↵ ")}`, Math.max(16, listWidth));
  });
  const selected = entries[state.historyPopupIndex] ?? "";
  const preview = [
    "preview",
    "",
    ...wrapText(selected || "empty", Math.max(16, previewWidth)),
  ];
  const combined = combineColumns(lines, preview, listWidth, previewWidth);

  return renderMessageBox(
    "history",
    `${state.historyPopupIndex + 1}/${entries.length} · recent prompts · Enter load · Esc close\n\n${combined.join("\n")}`,
    boxWidth,
  );
}

function renderModelPicker(state: RuntimeTuiState, width: number): string[] {
  const provider = lookupValue(state.view.metadata, "provider");
  const entries = getFilteredModelPickerEntries(state);
  if (entries.length === 0) {
    return renderMessageBox(
      "model picker",
      state.modelPickerQuery.trim().length > 0
        ? `no matches for "${state.modelPickerQuery}"\n\nEsc close · Backspace edit filter`
        : "no catalog for current provider",
      Math.min(width, 96),
    );
  }
  const boxWidth = Math.min(width, 104);
  const windowSize = 8;
  const start = Math.max(0, Math.min(entries.length - windowSize, state.modelPickerIndex - Math.floor(windowSize / 2)));
  const visible = entries.slice(start, start + windowSize);
  const lines = visible.flatMap((entry, index) => {
    const absoluteIndex = start + index;
    const selected = absoluteIndex === state.modelPickerIndex;
    const currentMark = entry.current ? " • current" : "";
    const disabledMark = entry.disabledReason ? ` • unavailable: ${entry.disabledReason}` : "";
    return wrapText(`${selected ? "›" : " "} ${entry.id}${currentMark}${disabledMark} - ${entry.description}`, Math.max(20, boxWidth - 6));
  });

  return renderMessageBox(
    "model picker",
    `${provider} models · ${state.modelPickerIndex + 1}/${entries.length} · Enter apply · Esc close\nfilter: ${state.modelPickerQuery || "(none)"} · type to filter · Backspace delete · Home/End jump\n\n${lines.join("\n")}`,
    boxWidth,
  );
}

function renderCollapsedTraceSummary(state: RuntimeTuiState, width: number): string[] {
  const totalEntries = state.currentTurnTraceDetails.length || (state.latestTurnTrace.length + state.currentTurnActivity.length);
  return renderMessageBox("trace", `▸ Ctrl+T expand · ${totalEntries} entries`, width);
}

function renderControlCard(state: RuntimeTuiState, width: number): string[] {
  const hasPending = Boolean(state.pendingApprovalTool);
  const hasCancel = state.cancelRequested;
  const hasSteer = Boolean(state.steerMessage);
  const hasRecentDecision = Boolean(state.lastDecision);
  if (!hasPending && !hasCancel && !hasSteer && !hasRecentDecision) {
    return [];
  }

  const lines: string[] = [];
  lines.push(`approval required: ${state.approvalRequired ? "on" : "off"}`);

  if (hasPending) {
    lines.push("");
    lines.push(`PENDING APPROVAL`);
    lines.push(`tool: ${state.pendingApprovalTool}`);
    if (state.pendingApprovalSummary) {
      lines.push(`summary: ${state.pendingApprovalSummary}`);
    }
    lines.push("actions: Ctrl+Y approve · Ctrl+N reject");
    lines.push("commands: /approval approve | /approval reject");
  }

  if (hasCancel) {
    lines.push("");
    lines.push("cancel: requested");
    lines.push("command: /cancel");
  }

  if (hasSteer) {
    lines.push("");
    lines.push(`steer: ${state.steerState ?? "queued"}`);
    lines.push(`message: ${state.steerMessage}`);
    lines.push("command: /steer <message>");
  }

  if (hasRecentDecision) {
    lines.push("");
    lines.push(`last decision: ${state.lastDecision}`);
  }

  return renderMessageBox("control", lines.join("\n"), width);
}

function renderConversationTranscript(lines: string[], width: number, liveAssistantReply: string | null = null): string[] {
  const rendered: string[] = [];

  for (const line of lines) {
    if (line.length === 0) {
      if (rendered.length > 0 && rendered[rendered.length - 1] !== "") {
        rendered.push("");
      }
      continue;
    }

    if (line.startsWith("you: ")) {
      if (rendered.length > 0 && rendered[rendered.length - 1] !== "") {
        rendered.push("");
      }
      rendered.push(...wrapLabeledChatLine("● you", line.slice(5), width, ANSI.user));
      continue;
    }

    if (line.startsWith("agent: ")) {
      rendered.push(...renderMessageBox("agent", line.slice(7), width));
      continue;
    }

    if (line.startsWith("turn: ")) {
      rendered.push(...renderInlineTurnLine(line.slice(6), width, false));
      continue;
    }

    if (line.startsWith("turn-detail: ")) {
      rendered.push(...renderInlineTurnLine(line.slice(13), width, true));
      continue;
    }

    rendered.push(...wrapText(line, width));
  }

  if (liveAssistantReply) {
    if (rendered.length > 0 && rendered[rendered.length - 1] !== "") {
      rendered.push("");
    }
    rendered.push(...renderMessageBox("agent streaming", liveAssistantReply, width));
  }

  return rendered;
}

function renderInlineTurnLine(value: string, width: number, detail: boolean): string[] {
  const prefix = detail ? "   └─ " : "└─ ";
  const available = Math.max(12, width - prefix.length);
  return wrapText(value, available).map((line, index) => {
    const leader = index === 0 ? prefix : " ".repeat(prefix.length);
    return tintLine(truncateLine(`${leader}${line}`, width), detail ? ANSI.dim : ANSI.trace);
  });
}

function stripActivityTimestamp(line: string): string {
  return line.replace(/^•\s+\S+\s+/, "");
}

function formatChatLine(line: string, width: number): string[] {
  if (line.length === 0) {
    return [""];
  }
  if (line.startsWith("you: ")) {
    return wrapLabeledChatLine("› you", line.slice(5), width);
  }
  if (line.startsWith("agent: ")) {
    return wrapLabeledChatLine("! agent", line.slice(7), width);
  }
  return [truncateLine(line, width)];
}

function wrapLabeledChatLine(label: string, value: string, width: number, tint: string = ANSI.none): string[] {
  const prefix = `${label}  `;
  const continuation = " ".repeat(prefix.length);
  const availableWidth = Math.max(12, width - prefix.length);
  const wrapped = value
    .split("\n")
    .flatMap((segment, segmentIndex) => {
      const segmentLines = wrapText(segment, availableWidth);
      return segmentIndex > 0 ? ["", ...segmentLines] : segmentLines;
    });
  return wrapped.map((line, index) => {
    if (line.length === 0) {
      return "";
    }
    return tintLine(truncateLine(`${index === 0 ? prefix : continuation}${line}`, width), tint);
  });
}

function renderMessageBox(title: string, value: string, width: number): string[] {
  const titleText = ` ${title} `;
  const boxWidth = title === "agent"
    ? Math.min(width, Math.max(104, Math.floor(width * 0.92)))
    : width;
  const innerWidth = Math.max(12, boxWidth - 4);
  const style = title === "agent" ? ANSI.agent : title === "trace" ? ANSI.trace : ANSI.working;
  const framelessBody = title === "agent";
  const top = tintLine(`╭${titleText}${"─".repeat(Math.max(0, innerWidth + 2 - titleText.length))}╮`, style);
  const bottom = tintLine(`╰${"─".repeat(innerWidth + 2)}╯`, style);
  const renderedValue = title === "agent" ? normalizeAgentReply(value) : value;
  const bodyLines = renderedValue.split("\n").flatMap((segment) => {
    if (segment.length === 0) {
      return [""];
    }
    return wrapText(segment, innerWidth);
  });

  return [
    top,
    ...bodyLines.map((line) => tintLine(framelessBody ? `  ${line}` : `│ ${padLine(line, innerWidth)} │`, style)),
    bottom,
  ];
}

function normalizeAgentReply(value: string): string {
  return value
    .split("\n")
    .filter((line) => !/^```[\w-]*\s*$/.test(line.trim()))
    .map((line) => line.trim() === "\\[" || line.trim() === "\\]" || line.trim() === "\\(" || line.trim() === "\\)" ? "" : line)
    .map((line) => normalizeInlineLatex(line))
    .map((line) => line
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s?/, ""))
    .join("\n")
    .trim();
}

function normalizeInlineLatex(value: string): string {
  return value
    .replace(/\\\((.*?)\\\)/g, "$1")
    .replace(/\\\[(.*?)\\\]/g, "$1")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "($1)/($2)")
    .replace(/\\cdot/g, "*")
    .replace(/\\times/g, "*")
    .replace(/\\infty/g, "inf")
    .replace(/\\pi/g, "pi")
    .replace(/\\zeta/g, "zeta")
    .replace(/\\Gamma/g, "Gamma")
    .replace(/\\sum/g, "sum")
    .replace(/\\int/g, "int")
    .replace(/\\left|\\right/g, "")
    .replace(/[{}]/g, "")
    .replace(/\\([a-zA-Z]+)/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trimEnd();
}

type MemoryMutationCommand =
  | { kind: "save"; text: string }
  | { kind: "checkpoint"; reason: string | null }
  | { kind: "session"; focus: string | null };

function parseMemoryMutationCommand(prompt: string): MemoryMutationCommand | null {
  const trimmed = prompt.trim();
  if (!trimmed.startsWith("/memory")) {
    return null;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return null;
  }

  const action = (parts[1] ?? "").toLowerCase();
  if (action === "save") {
    const text = trimmed.replace(/^\/memory\s+save\s*/i, "").trim();
    return { kind: "save", text };
  }

  if (action === "checkpoint") {
    const reason = trimmed.replace(/^\/memory\s+checkpoint\s*/i, "").trim();
    return { kind: "checkpoint", reason: reason.length > 0 ? reason : null };
  }

  if (action === "session") {
    const focus = trimmed.replace(/^\/memory\s+session\s*/i, "").trim();
    return { kind: "session", focus: focus.length > 0 ? focus : null };
  }

  return null;
}

async function applyMemoryMutationCommand(session: RuntimeSession, command: MemoryMutationCommand): Promise<string> {
  if (!session.archivist.enabled) {
    throw new Error("archivist memory disabled");
  }

  if (command.kind === "save") {
    if (!command.text.trim()) {
      throw new Error("usage: /memory save <text>");
    }
    const result = await saveArchivistMemory(session, {
      summary: command.text,
      content: command.text,
      type: "operator-memory",
    });
    return `memory saved; entries=${String(result.entryCount)}\n${result.preview}`;
  }

  if (command.kind === "checkpoint") {
    const result = checkpointArchivistSessionSync(session, command.reason ?? "manual checkpoint");
    return `memory checkpoint saved; entries=${String(result.entryCount)}\n${result.preview}`;
  }

  const sessionDigest = buildSessionMemoryDigest(session, command.focus);
  const saved = addArchivistMemorySync(session, {
    summary: sessionDigest.summary,
    content: sessionDigest.content,
    type: "session-summary",
    tags: ["session", "summary", ...(command.focus ? ["focused"] : [])],
  });
  return `memory session summary saved; entries=${String(saved.entryCount)}\n${saved.preview}`;
}

function applyMemoryMutationCommandSync(session: RuntimeSession, command: MemoryMutationCommand): string {
  if (!session.archivist.enabled) {
    throw new Error("archivist memory disabled");
  }

  if (command.kind === "save") {
    if (!command.text.trim()) {
      throw new Error("usage: /memory save <text>");
    }
    const result = addArchivistMemorySync(session, {
      summary: command.text,
      content: command.text,
      type: "operator-memory",
    });
    return `memory saved; entries=${String(result.entryCount)}\n${result.preview}`;
  }

  if (command.kind === "checkpoint") {
    const result = checkpointArchivistSessionSync(session, command.reason ?? "manual checkpoint");
    return `memory checkpoint saved; entries=${String(result.entryCount)}\n${result.preview}`;
  }

  const sessionDigest = buildSessionMemoryDigest(session, command.focus);
  const saved = addArchivistMemorySync(session, {
    summary: sessionDigest.summary,
    content: sessionDigest.content,
    type: "session-summary",
    tags: ["session", "summary", ...(command.focus ? ["focused"] : [])],
  });
  return `memory session summary saved; entries=${String(saved.entryCount)}\n${saved.preview}`;
}

function checkpointArchivistSessionSync(session: RuntimeSession, reason: string): ReturnType<typeof addArchivistMemorySync> {
  const summary = `Session checkpoint: ${normalizeCompactText(reason || "manual checkpoint")}`;
  const content = [
    summary,
    `Provider: ${session.provider}`,
    `Transport: ${session.providerTransport.mode}`,
    `Turns: ${String(session.telemetry.turnCount)}`,
    session.compaction.summary ? `Compaction: ${normalizeCompactText(session.compaction.summary)}` : "Compaction: none",
  ].join("\n");
  return addArchivistMemorySync(session, {
    type: "checkpoint",
    summary,
    content,
    tags: ["checkpoint", session.provider],
    sourceCategory: "session-checkpoint",
    action: "checkpoint",
  });
}

function buildSessionMemoryDigest(session: RuntimeSession, focus: string | null): { summary: string; content: string } {
  const recent = session.conversation.slice(-8);
  const userTurns = recent.filter((turn) => turn.role === "user").slice(-4);
  const assistantTurns = recent.filter((turn) => turn.role === "assistant").slice(-4);
  const recentUserTopics = userTurns
    .map((turn) => normalizeCompactText(turn.content))
    .filter((line) => line.length > 0)
    .slice(-3);
  const recentAssistantOutcomes = assistantTurns
    .map((turn) => normalizeCompactText(turn.content))
    .filter((line) => line.length > 0)
    .slice(-3);

  const summaryParts = [
    focus ? `focus=${focus}` : null,
    `provider=${session.provider}`,
    `transport=${session.providerTransport.mode}`,
    `turns=${String(session.telemetry.turnCount)}`,
    `contextLeft=${String(getRemainingContextTokens(session))}`,
    recentUserTopics.length > 0 ? `topics=${recentUserTopics.join(" | ")}` : null,
  ].filter((part): part is string => Boolean(part));

  const contentLines = [
    focus ? `Focus: ${focus}` : "Focus: session digest",
    `Provider: ${session.provider}`,
    `Transport: ${session.providerTransport.mode}`,
    `Turns: ${String(session.telemetry.turnCount)}`,
    `Context left: ${String(getRemainingContextTokens(session))}`,
    "",
    "Recent user topics:",
    ...(recentUserTopics.length > 0 ? recentUserTopics.map((line) => `- ${line}`) : ["- none"]),
    "",
    "Recent assistant outcomes:",
    ...(recentAssistantOutcomes.length > 0 ? recentAssistantOutcomes.map((line) => `- ${line}`) : ["- none"]),
  ];

  return {
    summary: summaryParts.join("; ").slice(0, 220),
    content: contentLines.join("\n").slice(0, 2000),
  };
}

function normalizeCompactText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/[`*_#>-]/g, "")
    .trim()
    .slice(0, 160);
}

export type AttachmentMutationCommand =
  | { kind: "attach"; rawPath: string }
  | { kind: "detach" };

function parseAttachmentMutationCommand(prompt: string): AttachmentMutationCommand | null {
  const trimmed = prompt.trim();
  if (trimmed === "/detach") {
    return { kind: "detach" };
  }
  if (!trimmed.startsWith("/attach")) {
    return null;
  }
  const rawPath = trimmed.replace(/^\/attach\s*/i, "").trim();
  if (!rawPath || rawPath.toLowerCase() === "clear") {
    return { kind: "detach" };
  }
  return { kind: "attach", rawPath };
}

export function applyAttachmentMutationCommand(
  session: RuntimeSession,
  command: AttachmentMutationCommand,
): { output: string; attachment: ImageAttachment | null } {
  if (command.kind === "detach") {
    return {
      output: "image attachment cleared",
      attachment: null,
    };
  }

  if (session.providerTransport.mode === "cli-exec") {
    throw new Error("current transport cli-exec does not support images; switch with /provider transport codex-http or /provider transport http-responses");
  }

  const absolutePath = path.isAbsolute(command.rawPath)
    ? command.rawPath
    : path.resolve(session.cwd, command.rawPath);
  const fileStats = statSync(absolutePath);
  if (!fileStats.isFile()) {
    throw new Error(`not a file: ${absolutePath}`);
  }
  if (fileStats.size > MAX_IMAGE_ATTACHMENT_BYTES) {
    throw new Error(`image too large (${formatBytes(fileStats.size)}); max ${formatBytes(MAX_IMAGE_ATTACHMENT_BYTES)}`);
  }

  const extension = path.extname(absolutePath).toLowerCase();
  const mimeType = IMAGE_MIME_BY_EXTENSION[extension];
  if (!mimeType) {
    throw new Error("unsupported image type; supported: .png .jpg .jpeg .webp .gif");
  }

  const bytes = readFileSync(absolutePath);
  const attachment: ImageAttachment = {
    path: absolutePath,
    name: path.basename(absolutePath),
    mimeType,
    bytes: bytes.byteLength,
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
  };

  return {
    output: `image attached: ${attachment.name} (${attachment.mimeType}, ${formatBytes(attachment.bytes)})`,
    attachment,
  };
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value}B`;
  }
  const kib = value / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)}KB`;
  }
  const mib = kib / 1024;
  return `${mib.toFixed(1)}MB`;
}

export function formatAttachmentLabel(attachment: ImageAttachment | null): string {
  if (!attachment) {
    return "none";
  }
  return `${attachment.name} (${attachment.mimeType}, ${formatBytes(attachment.bytes)})`;
}

export function extractClipboardImageToTempFile(): { path: string; source: string } {
  const tempDir = mkdtempSync(path.join(tmpdir(), "nexagent-clipboard-"));
  const outputPath = path.join(tempDir, "clipboard.png");

  const cleanupAndThrow = (message: string): never => {
    rmSync(tempDir, { recursive: true, force: true });
    throw new Error(message);
  };

  try {
    execFileSync("pngpaste", [outputPath], { stdio: "ignore" });
    if (statSync(outputPath).size > 0) {
      return { path: outputPath, source: "pngpaste" };
    }
  } catch {
    // fallthrough
  }

  try {
    const bytes = execFileSync("wl-paste", ["--no-newline", "--type", "image/png"], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
    if (Buffer.isBuffer(bytes) && bytes.length > 0) {
      writeFileSync(outputPath, bytes);
      return { path: outputPath, source: "wl-paste" };
    }
  } catch {
    // fallthrough
  }

  try {
    const bytes = execFileSync("xclip", ["-selection", "clipboard", "-t", "image/png", "-o"], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 });
    if (Buffer.isBuffer(bytes) && bytes.length > 0) {
      writeFileSync(outputPath, bytes);
      return { path: outputPath, source: "xclip" };
    }
  } catch {
    // fallthrough
  }

  try {
    const base64 = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $img=Get-Clipboard -Format Image; if($img -eq $null){ exit 1 }; $ms=New-Object System.IO.MemoryStream; $img.Save($ms,[System.Drawing.Imaging.ImageFormat]::Png); [Convert]::ToBase64String($ms.ToArray())",
      ],
      { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
    ).trim();
    if (base64.length > 0) {
      writeFileSync(outputPath, Buffer.from(base64, "base64"));
      return { path: outputPath, source: "powershell" };
    }
  } catch {
    // fallthrough
  }

  try {
    const windowsPath = execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $img=Get-Clipboard -Format Image; if($img -eq $null){ exit 1 }; $p=[System.IO.Path]::GetTempFileName(); $p=[System.IO.Path]::ChangeExtension($p,'png'); $img.Save($p,[System.Drawing.Imaging.ImageFormat]::Png); Write-Output $p",
      ],
      { encoding: "utf8", maxBuffer: 1024 * 1024 },
    ).trim();
    if (windowsPath.length > 0) {
      const wslPath = windowsPathToWslPath(windowsPath);
      const bytes = readFileSync(wslPath);
      writeFileSync(outputPath, bytes);
      return { path: outputPath, source: "powershell.exe" };
    }
  } catch {
    // fallthrough
  }

  return cleanupAndThrow("no clipboard image found (tried pngpaste, wl-paste, xclip, powershell)");
}

function windowsPathToWslPath(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  const drive = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (!drive) {
    return normalized;
  }
  const letter = drive[1].toLowerCase();
  const rest = drive[2];
  return `/mnt/${letter}/${rest}`;
}

async function maybeAutoPersistMemory(session: RuntimeSession, prompt: string): Promise<void> {
  if (!session.archivist.enabled) {
    return;
  }
  const threshold = getCompactionThresholdTokens(session);
  const estimated = estimateConversationTokens(session);
  if (threshold <= 0 || estimated < Math.floor(threshold * 0.9)) {
    return;
  }

  await persistSessionDigestMemory(
    session,
    `pre-compaction threshold (${estimated}/${threshold})`,
    `pre-compaction threshold; prompt=${normalizeCompactText(prompt).slice(0, 120)}`,
    "pre-compaction",
    ["auto", "compaction-threshold", "session"],
  );
}

export async function maybeArchiveAgedChatHistory(session: RuntimeSession, now = Date.now()): Promise<boolean> {
  const cutoff = now - CHAT_HISTORY_RETENTION_MS;
  if (session.events.length <= CHAT_HISTORY_MIN_RECENT_EVENTS) {
    return false;
  }

  const protectedStart = Math.max(0, session.events.length - CHAT_HISTORY_MIN_RECENT_EVENTS);
  const agedEvents = session.events.filter((event, index) =>
    index < protectedStart
    && event.kind !== "system"
    && event.kind !== "compact"
    && Date.parse(event.at) < cutoff
  );
  if (agedEvents.length === 0) {
    return false;
  }

  const firstAt = agedEvents[0]?.at ?? "unknown";
  const lastAt = agedEvents.at(-1)?.at ?? "unknown";
  const eventCounts = agedEvents.reduce<Record<string, number>>((counts, event) => {
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
    return counts;
  }, {});
  const countSummary = Object.entries(eventCounts)
    .map(([kind, count]) => `${kind}=${String(count)}`)
    .join(", ");
  const digestLines = agedEvents
    .flatMap((event) => formatTranscriptEvent(event))
    .map((line) => normalizeCompactText(line))
    .filter((line) => line.length > 0)
    .slice(-40);

  if (session.archivist.enabled) {
    await saveArchivistMemory(session, {
      summary: `aged chat history ${firstAt}..${lastAt}; events=${String(agedEvents.length)}`,
      content: [
        `Archived aged chat history before local transcript pruning.`,
        `Range: ${firstAt}..${lastAt}`,
        `Counts: ${countSummary || "none"}`,
        "",
        ...digestLines,
      ].join("\n"),
      type: "chat-history-archive",
      tags: ["auto", "chat-history", "aged"],
    });
  }

  const aged = new Set(agedEvents);
  session.events = session.events.filter((event) => !aged.has(event));
  recordRuntimeEvent(session, {
    kind: "compact",
    status: "completed",
    summary: "aged chat history archived",
    detail: `events=${String(agedEvents.length)}; range=${firstAt}..${lastAt}; archivist=${session.archivist.enabled ? "saved" : "disabled"}`,
  });
  return true;
}

async function maybePersistCompactionMemory(session: RuntimeSession, prompt: string, beforeTokens: number, afterTokens: number): Promise<void> {
  if (!session.archivist.enabled) {
    return;
  }
  await persistSessionDigestMemory(
    session,
    `auto compact ${beforeTokens}->${afterTokens}`,
    `auto compact ${beforeTokens}->${afterTokens}; prompt=${normalizeCompactText(prompt).slice(0, 120)}`,
    "auto-compaction",
    ["auto", "compaction", "session"],
  );
}

function scheduleNextPeriodicMemoryAutosave(now: number): number {
  const window = PERIODIC_MEMORY_MAX_MS - PERIODIC_MEMORY_MIN_MS;
  const jitter = window > 0 ? Math.floor(Math.random() * (window + 1)) : 0;
  return now + PERIODIC_MEMORY_MIN_MS + jitter;
}

async function maybePersistPeriodicMemory(session: RuntimeSession): Promise<boolean> {
  if (!session.archivist.enabled) {
    return false;
  }
  if (session.conversation.length === 0 && session.events.length === 0) {
    return false;
  }

  await persistSessionDigestMemory(
    session,
    "periodic autosave",
    "periodic autosave digest",
    "periodic-autosave",
    ["auto", "periodic", "session"],
  );
  return true;
}

async function maybePersistSessionMemoryOnQuit(session: RuntimeSession, reason: string): Promise<string | null> {
  if (!session.archivist.enabled) {
    return null;
  }
  try {
    await persistSessionDigestMemory(
      session,
      reason,
      "pre-quit autosave",
      "session-quit",
      ["auto", "quit", "session"],
    );
    return session.archivist.writes.preview ?? "memory session autosaved before quit";
  } catch {
    return null;
  }
}

async function persistSessionDigestMemory(
  session: RuntimeSession,
  checkpointReason: string,
  focus: string,
  type: string,
  tags: string[],
): Promise<void> {
  checkpointArchivistSessionSync(session, checkpointReason);
  const digest = buildSessionMemoryDigest(session, focus);
  await saveArchivistMemory(session, {
    summary: digest.summary,
    content: digest.content,
    type,
    tags,
  });
}

function buildCopyPayload(state: RuntimeTuiState): { text: string; label: string } | null {
  const assistant = state.latestAssistantMessage?.trim();
  if (assistant) {
    return { text: assistant.slice(0, 12000), label: "latest assistant reply" };
  }

  const user = state.latestUserMessage?.trim();
  if (user) {
    return { text: user.slice(0, 12000), label: "latest user prompt" };
  }

  const transcript = state.chatHistory.filter((line) => line.trim().length > 0).slice(-30).join("\n").trim();
  if (transcript) {
    return { text: transcript.slice(0, 12000), label: "recent transcript" };
  }

  return null;
}

function copyTextToClipboard(text: string): boolean {
  if (!text.trim()) {
    return false;
  }

  const clipboardCommands: ReadonlyArray<{ cmd: string; args: string[] }> = [
    { cmd: "pbcopy", args: [] },
    { cmd: "wl-copy", args: [] },
    { cmd: "xclip", args: ["-selection", "clipboard"] },
    { cmd: "clip.exe", args: [] },
  ];

  for (const candidate of clipboardCommands) {
    try {
      execFileSync(candidate.cmd, candidate.args, {
        input: text,
        stdio: ["pipe", "ignore", "ignore"],
      });
      return true;
    } catch {
      // Try next clipboard transport.
    }
  }

  try {
    const encoded = Buffer.from(text, "utf8").toString("base64");
    if (!encoded) {
      return false;
    }
    process.stdout.write(`\u001b]52;c;${encoded}\u0007`);
    return true;
  } catch {
    return false;
  }
}

export function summarizeTurnEvents(events: RuntimeSession["events"]): string[] {
  if (events.length === 0) {
    return [];
  }

  const toolStarted = events.filter((event) => event.kind === "tool" && event.status === "started");
  const toolCompleted = events.filter((event) => event.kind === "tool" && event.status === "completed");
  const toolFailed = events.filter((event) => event.kind === "tool" && event.status === "failed");
  const waitingApproval = events.find((event) => event.kind === "control" && event.status === "queued");
  const blocked = events.find((event) =>
    event.status === "blocked"
    || event.status === "failed"
    || (event.kind === "control" && event.status === "canceled"),
  );
  const providerStarted = events.find((event) => event.kind === "provider" && event.status === "started");
  const providerFailed = events.find((event) => event.kind === "provider" && event.status === "failed");
  const lines: string[] = [];
  const toolEventsForNames = [...toolStarted, ...toolCompleted, ...toolFailed];
  const toolNames = [...new Set(toolEventsForNames
    .map((event) => event.summary.match(/tool\s+([a-z0-9_]+)/i)?.[1] ?? null)
    .filter((value): value is string => value !== null))];

  if (blocked) {
    lines.push(`▾ blocker: ${blocked.summary}`);
  }
  if (waitingApproval) {
    lines.push("▾ waiting approval");
  }
  if (toolFailed.length > 0 || providerFailed) {
    lines.push("▾ hit issue");
  }
  if (providerStarted) {
    lines.push("▾ thinking");
  }
  if (toolNames.length > 0) {
    lines.push(`  ↳ tools: ${toolNames.join(", ")}`);
  } else if (toolEventsForNames.length > 0) {
    lines.push(`  ↳ tool calls (${toolEventsForNames.length})`);
  }
  if (waitingApproval) {
    lines.push("  ↳ waiting approval");
  }
  if (toolFailed.length > 0 || providerFailed || blocked) {
    lines.push("  ↳ hit issue");
  }

  return lines;
}

function getFilteredModelPickerEntries(state: RuntimeTuiState): Array<{ id: string; description: string; current: boolean; disabledReason?: string }> {
  const query = state.modelPickerQuery.trim().toLowerCase();
  if (!query) {
    return state.modelPickerEntries;
  }
  return state.modelPickerEntries.filter((entry) =>
    entry.id.toLowerCase().includes(query) || entry.description.toLowerCase().includes(query) || (entry.disabledReason ?? "").toLowerCase().includes(query),
  );
}

function getSectionRows(view: RuntimeTuiView, section: RuntimeTuiSection): ReadonlyArray<[string, string]> {
  switch (section) {
    case "overview":
      return [...view.metadata, ...view.mcp];
    case "routing":
      return view.routing;
    case "auth":
      return view.auth;
    case "instructions":
      return view.instructions;
    case "mcp":
      return view.mcp;
    case "hooks":
      return view.hooks;
    case "imports":
      return view.imports;
    case "archivist":
      return view.archivist;
    case "agent":
      return view.metadata;
  }
}

function combineColumns(left: string[], right: string[], leftWidth: number, rightWidth: number): string[] {
  const height = Math.max(left.length, right.length);
  const rows: string[] = [];

  for (let index = 0; index < height; index += 1) {
    const leftLine = padLine(left[index] ?? "", leftWidth);
    const rightLine = padLine(right[index] ?? "", rightWidth);
    rows.push(`${leftLine} │ ${rightLine}`);
  }

  return rows;
}

function wrapPair(label: string, value: string, width: number): string[] {
  const prefix = `${label}: `;
  const availableWidth = Math.max(12, width - prefix.length);
  const wrapped = wrapText(value, availableWidth);

  return wrapped.map((line, index) => {
    const actualPrefix = index === 0 ? prefix : " ".repeat(prefix.length);
    return padLine(`${actualPrefix}${line}`, width);
  });
}

function lookupValue(rows: ReadonlyArray<[string, string]>, key: string): string {
  return rows.find(([label]) => label === key)?.[1] ?? "unknown";
}

function lookupMetadataValue(rows: ReadonlyArray<[string, string]>, key: string, fallback: string): string {
  const value = lookupValue(rows, key);
  return value === "unknown" ? fallback : value;
}

function lookupActiveModel(state: RuntimeTuiState): string | null {
  const provider = lookupValue(state.view.metadata, "provider");
  const models = lookupValue(state.view.routing, "models");
  if (models === "unknown") {
    return null;
  }
  const match = models
    .split(",")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${provider}=`));
  return match ? match.slice(provider.length + 1) : null;
}

function normalizeMetadataValue(value: string): string | null {
  return value === "unknown" || value === "none" ? null : value;
}

function normalizeActionStatus(value: string): RuntimeSession["action"]["status"] {
  if (value === "running" || value === "error") {
    return value;
  }

  return "ready";
}

function resolveTerminalSize(terminalSize?: Partial<TerminalSize>): TerminalSize {
  return {
    columns: Math.max(60, terminalSize?.columns ?? process.stdout.columns ?? 100),
    rows: Math.max(20, terminalSize?.rows ?? process.stdout.rows ?? 30),
  };
}

function renderGuiSection(title: string, rows: ReadonlyArray<[string, string]>): string {
  return `<section>
      <h2>${escapeHtml(title)}</h2>
      <dl>
${rows.map(([label, value]) => `        <dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("\n")}
      </dl>
    </section>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function composeTuiPanes(top: string[], middle: string[], bottom: string[], rows: number, scrollOffset = 0, width = 80): string[] {
  const availableMiddle = Math.max(1, rows - top.length - bottom.length);
  const maxScroll = Math.max(0, middle.length - availableMiddle);
  const normalizedOffset = Math.max(0, Math.min(scrollOffset, maxScroll));
  const start = middle.length > availableMiddle
    ? Math.max(0, middle.length - availableMiddle - normalizedOffset)
    : 0;
  const visibleMiddle = middle.slice(start, start + availableMiddle);
  const fillerCount = Math.max(0, availableMiddle - visibleMiddle.length);
  const decoratedMiddle = decorateMiddleScrollPane(visibleMiddle, width, {
    availableMiddle,
    totalMiddle: middle.length,
    start,
  });
  return [
    ...top,
    ...decoratedMiddle,
    ...Array.from({ length: fillerCount }, () => ""),
    ...bottom,
  ];
}

function measureMiddleScroll(
  state: RuntimeTuiState,
  terminalSize: TerminalSize,
): { maxScroll: number; step: number } {
  const contentWidth = Math.max(40, terminalSize.columns - 4);
  const workspace = renderWorkspacePanel(state, contentWidth);
  const topPaneLength = 5 + workspace.top.length;
  const bottomPaneLength = workspace.bottom.length + 1;
  const availableMiddle = Math.max(1, Math.max(10, terminalSize.rows) - 1 - topPaneLength - bottomPaneLength);
  const maxScroll = Math.max(0, workspace.middle.length - availableMiddle);
  const step = Math.max(3, Math.floor(availableMiddle / 2));
  return { maxScroll, step };
}

function decorateMiddleScrollPane(
  lines: string[],
  width: number,
  info: { availableMiddle: number; totalMiddle: number; start: number },
): string[] {
  const maxScroll = Math.max(0, info.totalMiddle - info.availableMiddle);
  if (maxScroll === 0) {
    return lines;
  }

  const thumbSize = Math.max(1, Math.floor((info.availableMiddle * info.availableMiddle) / info.totalMiddle));
  const thumbTravel = Math.max(0, info.availableMiddle - thumbSize);
  const thumbStart = maxScroll === 0 ? 0 : Math.round((info.start / maxScroll) * thumbTravel);
  const contentWidth = Math.max(8, width - 2);

  return lines.map((line, index) => {
    const rail = index >= thumbStart && index < thumbStart + thumbSize ? "█" : "│";
    return `${padVisibleLine(line, contentWidth)} ${tintLine(rail, ANSI.rule)}`;
  });
}

function restoreTerminal(): void {
  process.stdout.write("\x1b[?25h\x1b[?1007l\x1b[?1006l\x1b[?1000l\x1b[?1049l");
  resetScreenRenderer();
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function formatMcpRuntimeStatus(session: RuntimeSession): string {
  const statuses = (session.mcpRegistry?.statuses ?? []).map((status) => {
    const message = status.message ? `:${status.message}` : "";
    return `${status.name}=${status.status}/${status.toolCount}${message}`;
  });
  return statuses.length > 0 ? statuses.join(", ") : "none";
}

function formatClaudeImport(claudeImport: RuntimeSession["imports"]["claude"]): string {
  if (!claudeImport) {
    return "disabled";
  }

  const imported = claudeImport.importedKeys.length > 0 ? claudeImport.importedKeys.join(", ") : "none";
  return `${claudeImport.path} (${imported})`;
}

function formatArchivistRetrieval(retrieval: RuntimeSession["archivist"]["retrieval"]): string {
  if (!retrieval.used) {
    return "idle";
  }

  const category = retrieval.sourceCategory ? `${retrieval.sourceCategory}` : "used";
  return `${category}; matches=${String(retrieval.matchCount)}`;
}

function formatArchivistWrite(writes: RuntimeSession["archivist"]["writes"]): string {
  if (!writes.used) {
    return "idle";
  }

  return `${writes.sourceCategory ?? writes.action ?? "write"}; action=${writes.action ?? "none"}; entries=${String(writes.entryCount)}; savedAt=${writes.savedAt ?? "none"}`;
}

function formatRepoLabel(session: RuntimeSession): string {
  return session.repo.name.trim();
}

function formatFallbackPolicy(fallback: RuntimeSession["providerRouting"]["fallback"]): string {
  return `${fallback.policy}; silent-switch=${String(fallback.silentProviderSwitch)}`;
}

function formatProviderModels(models: RuntimeSession["providerRouting"]["modelSelection"]["configuredModels"]): string {
  const entries = Object.entries(models).map(([provider, model]) => `${provider}=${model}`);
  return entries.length > 0 ? entries.join(", ") : "none";
}

function formatActivityLine(message: string): string {
  return `• ${new Date().toISOString()} ${message}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error: unknown) => {
    await captureCliException(error);
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
