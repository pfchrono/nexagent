#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import process from "node:process";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { executeProviderRequest, type ImageAttachment } from "./provider.js";
import { launchCodexLogin, probeCodexAuthStateSync } from "./runtime/auth.js";
import { checkpointArchivistSession, saveArchivistMemory } from "./runtime/archivist.js";
import { bootstrapRuntime } from "./runtime/bootstrap.js";
import { buildPromptLayers, summarizePromptLayers } from "./runtime/instructions.js";
import { loadPersistedPromptHistory, savePersistedPromptHistory, savePersistedRuntimeState } from "./runtime/persistence.js";
import { executeInternalTool, getInternalToolDefinitions } from "./runtime/tools.js";
import { CODEX_MODEL_CATALOG, DEFAULT_CODEX_MODEL, getCodexModelDefinition, normalizeCodexModel } from "./models.js";
import { ANSI, padLine, padVisibleLine, renderRule, renderScreen, resetScreenRenderer, tintLine, truncateLine, wrapText } from "./tui/primitives.js";
import { autocompletePromptBuffer, describePromptHint, type PromptCompletionResult } from "./cli/autocomplete.js";
import { COMMAND_CATALOG } from "./cli/catalog.js";
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
  setRuntimeAction,
  syncRuntimeSession,
  type RuntimeSession,
} from "./runtime/session.js";

export { autocompletePromptBuffer, describePromptHint } from "./cli/autocomplete.js";
export type { PromptCompletionResult, PromptCompletionSuggestion } from "./cli/autocomplete.js";

const SPINNER_FRAMES = ["-", "\\", "|", "/"] as const;
const NEXAGENT_EMBLEM_FRAMES = ["◜◆◝", "◠◆◡", "◟◆◞", "◡◆◠"] as const;
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
  modelPickerEntries: Array<{ id: string; description: string; current: boolean }>;
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

interface RuntimeCommandSuccess {
  ok: true;
  output: string;
  activity: string;
  autoInvokeAfterSkill?: boolean;
}

interface RuntimeCommandFailure {
  ok: false;
  message: string;
  activity: string;
}

type DiagnosticRow = readonly [string, string];

export type RuntimeCommandResult = RuntimeCommandSuccess | RuntimeCommandFailure;

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));

  if (command.kind === "run") {
    const prompt = resolvePrompt(command.prompt, await readPipedStdin(process.stdin));
    const runtime = await bootstrapRuntime(process.cwd());
    const session = createRuntimeSession(runtime);
    if (command.yolo) {
      applyYoloMode(session);
    }
    await runPromptCommand(session, prompt);
    return;
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    const runtime = await bootstrapRuntime(process.cwd());
    const session = createRuntimeSession(runtime);
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
    if (command.yolo) {
      applyYoloMode(session);
    }
    stopStartup();
    stopStartup = undefined;
    process.removeListener("SIGINT", onStartupSigint);
    if (command.openTui) {
      const { runOpenTuiRuntime } = await import("./opentui/entry.js");
      await runOpenTuiRuntime(session);
      return;
    }
    await runRuntimeTui(session);
  } finally {
    process.removeListener("SIGINT", onStartupSigint);
    stopStartup?.();
    restoreTerminal();
  }
}

interface RunCommand {
  kind: "run";
  prompt: string | null;
  yolo: boolean;
  openTui?: boolean;
}

interface InspectCommand {
  kind: "inspect";
  yolo: boolean;
  openTui?: boolean;
}

type CliCommand = RunCommand | InspectCommand;

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

export function parseCommand(argv: string[]): CliCommand {
  const yolo = argv.includes("--yolo");
  const openTui = argv.includes("--opentui");
  const normalizedArgv = argv.filter((arg) => arg !== "--yolo" && arg !== "--opentui");

  if (normalizedArgv[0] !== "run") {
    return openTui ? { kind: "inspect", yolo, openTui } : { kind: "inspect", yolo };
  }

  const prompt = normalizedArgv.slice(1).join(" ").trim();
  const command: RunCommand = {
    kind: "run",
    prompt: prompt.length > 0 ? prompt : null,
    yolo,
  };
  if (openTui) {
    command.openTui = true;
  }
  return command;
}

export function resolvePrompt(prompt: string | null, pipedInput: string | null): string {
  const normalizedPrompt = prompt?.trim() ?? "";
  const normalizedInput = pipedInput?.trim() ?? "";

  if (normalizedPrompt.length > 0 && normalizedInput.length > 0) {
    return `${normalizedPrompt}\n\n${normalizedInput}`;
  }

  if (normalizedPrompt.length > 0) {
    return normalizedPrompt;
  }

  if (normalizedInput.length > 0) {
    return normalizedInput;
  }

  throw new Error('usage: nexagent run "prompt" or pipe stdin');
}

export function createRuntimeInspectPayload(
  session: RuntimeSession,
): Omit<RuntimeSession, "instructionLayers"> & { instructionLayers: RuntimeSession["instructionLayerSummary"] } {
  const instructionLayers =
    session.instructionLayerSummary ?? summarizePromptLayers(session.instructionLayers ?? buildPromptLayers(session, ""));

  return { ...session, instructionLayers };
}

export function createRuntimeTuiView(session: RuntimeSession): RuntimeTuiView {
  const instructionLayers =
    session.instructionLayerSummary ?? summarizePromptLayers(session.instructionLayers ?? buildPromptLayers(session, ""));

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
      ["compact", formatCompactionSummary(session)],
      ["toolPolicy", session.toolPolicy.mode],
      ["approval", formatApprovalSummary(session)],
      ["ops", formatOperationSummary(session)],
      ["status", session.action.status],
      ["detail", session.action.detail],
      ["lastActivity", session.action.lastActivity ?? "none"],
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
      ["count", String(instructionLayers.count)],
      ["responseStyle", instructionLayers.responseStyle],
      ["repoSources", formatInstructionSources(session, "repoBehavior")],
      ["taskSources", formatInstructionSources(session, "taskContext")],
      ["identity", instructionLayers.identity],
      ["executionGuidance", instructionLayers.executionGuidance],
      ["repoBehavior", instructionLayers.repoBehavior],
      ["taskContext", instructionLayers.taskContext],
      ["importedDefaults", instructionLayers.importedDefaults],
      ["toolAvailability", instructionLayers.toolAvailability],
      ["providerFallback", instructionLayers.providerFallback],
      ["stableSections", instructionLayers.stableSections || "none"],
      ["dynamicSections", instructionLayers.dynamicSections || "none"],
      ["dynamicBoundary", instructionLayers.dynamicBoundary],
    ],
    mcp: [
      ["enabled", formatList(session.enabledMcpServers)],
      ["loaded", formatList(session.mcpServers)],
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
      "  mcp     loading enabled registry summary",
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
  const skillCommand = toSkillCommandFromShorthand(effectivePrompt);
  if (skillCommand) {
    effectivePrompt = skillCommand;
  }
  const trimmedPrompt = effectivePrompt;
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

  if (session.operationControls.pendingApproval && !trimmedPrompt.startsWith("/")) {
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
    // Skill commands with autoInvokeAfterSkill fall through to model invocation
    if (commandResult.ok && commandResult.autoInvokeAfterSkill) {
      process.stdout.write(`${commandResult.output}\n`);
    } else if (commandResult.ok) {
      setRuntimeAction(session, "ready", "command complete");
      recordRuntimeEvent(session, {
        kind: "command",
        status: "completed",
        summary: `command ${effectivePrompt.split(/\s+/)[0]} completed`,
        detail: commandResult.output,
      });
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
    summary: "user prompt accepted",
    detail: effectivePrompt.length > 160 ? `${effectivePrompt.slice(0, 157)}...` : effectivePrompt,
  });
  setRuntimeAction(session, "running", "provider request");

  try {
    const autoCompact = maybeCompactConversation(session, effectivePrompt);
    if (autoCompact.compacted) {
      setRuntimeAction(session, "running", `auto compact · ${autoCompact.beforeTokens} -> ${autoCompact.afterTokens}`);
    }
    const result = await executeProviderRequest({ session, prompt: effectivePrompt });

    if (result.ok) {
      recordConversationTurn(session, "user", effectivePrompt);
      recordConversationTurn(session, "assistant", result.output);
      recordTurnTelemetry(session, effectivePrompt, result.output);
      setRuntimeAction(session, "ready", `response received · ${result.provider}`);
      process.stdout.write(`${result.output}\n`);
      return;
    }

    setRuntimeAction(session, "error", result.message);
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
    recordRuntimeEvent(session, {
      kind: "provider",
      status: "failed",
      summary: "provider request failed",
      detail: message,
    });
    throw error;
  }
}

export function runRuntimeCommand(session: RuntimeSession, input: string): RuntimeCommandResult | null {
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
    case "/skill":
      return handleSkillCommand(session, args);
    case "/mouse":
      return handleMouseCommand(session, args);
    case "/status":
      return handleStatusCommand(session, args);
    case "/caveman-mode":
      return handleStyleToggleCommand(session, args, "cavemanMode");
    case "/deadpoolmode":
      return handleStyleToggleCommand(session, args, "deadpoolMode");
    case "/statusline":
      return handleStyleToggleCommand(session, args, "statusline");
    case "/approval":
      return handleApprovalCommand(session, args);
    case "/cancel":
      return handleCancelCommand(session, args);
    case "/steer":
      return handleSteerCommand(session, args);
    case "/compact":
      return handleCompactCommand(session, args);
    case "/tools":
      return handleToolsCommand(session, args);
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
    case "/hooks":
      return handleHooksCommand(session, args);
    case "/attach":
    case "/detach":
      return {
        ok: false,
        message: "image attachments are interactive-only; use /attach or /detach in TTY composer",
        activity: "attachment command rejected",
      };
    default:
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
  const { detailMode, args: normalizedArgs } = splitVerboseArg(args);
  if (normalizedArgs.length !== 0) {
    return {
      ok: false,
      message: "usage: /memory [--verbose] | /memory save <text> | /memory checkpoint [reason] | /memory session [focus]",
      activity: "command failed · /memory usage",
    };
  }

  return {
    ok: true,
    output: formatMemoryStatus(session, detailMode),
    activity: "memory status",
  };
}

function handleStatusCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  const { detailMode, args: normalizedArgs } = splitVerboseArg(args);
  if (normalizedArgs.length !== 0) {
    return {
      ok: false,
      message: "usage: /status [--verbose]",
      activity: "command failed · /status usage",
    };
  }

  return {
    ok: true,
    output: formatRuntimeStatus(session, detailMode),
    activity: "status",
  };
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
    output: `${formatCompactionStatus(session)}\nlast-compact: ${beforeTokens} -> ${afterTokens}`,
    activity: `compact manual · ${beforeTokens} -> ${afterTokens}`,
  };
}

function handleApprovalCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  const arg = args.join(" ").trim().toLowerCase();
  if (args.length > 1 || (arg.length > 0 && !ENABLE_ARGS.has(arg) && !DISABLE_ARGS.has(arg) && !STATUS_ARGS.has(arg) && arg !== "approve" && arg !== "reject")) {
    return {
      ok: false,
      message: "usage: /approval [on|off|status|approve|reject]",
      activity: "command failed · /approval usage",
    };
  }

  if (arg === "approve") {
    if (!session.operationControls.pendingApproval) {
      return { ok: false, message: "no pending approval", activity: "approval missing" };
    }
    session.operationControls.pendingApproval = null;
    session.operationControls.lastDecision = "approved";
    savePersistedRuntimeState(session);
    return { ok: true, output: formatOperationControlsStatus(session), activity: "approval granted" };
  }

  if (arg === "reject") {
    if (!session.operationControls.pendingApproval) {
      return { ok: false, message: "no pending approval", activity: "approval missing" };
    }
    session.operationControls.pendingApproval = null;
    session.operationControls.lastDecision = "rejected";
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

function handleCancelCommand(session: RuntimeSession, args: string[]): RuntimeCommandResult {
  if (args.length !== 0) {
    return { ok: false, message: "usage: /cancel", activity: "command failed · /cancel usage" };
  }

  session.operationControls.cancelRequested = true;
  if (session.operationControls.pendingApproval) {
    session.operationControls.pendingApproval = null;
    session.operationControls.lastDecision = "canceled";
  }
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
    return {
      ok: false,
      message: result.output,
      activity: `shell failed · ${command}`,
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

  if (args.length !== 1) {
    return {
      ok: false,
      message: "usage: /model [status|list|name]",
      activity: "command failed · /model usage",
    };
  }

  const requestedModel = args[0]?.trim();
  if (!requestedModel) {
    return {
      ok: false,
      message: "usage: /model [status|list|name]",
      activity: "command failed · /model usage",
    };
  }

  const normalizedModel = normalizeModelForProvider(provider, requestedModel);
  if (!normalizedModel) {
    return {
      ok: false,
      message: `model ${requestedModel} is not valid for ${provider}`,
      activity: `model rejected · ${requestedModel}`,
    };
  }

  const configuredModels = session.providerRouting.modelSelection.configuredModels as Record<string, string | undefined>;
  configuredModels[provider] = normalizedModel;
  refreshInstructionState(session);
  savePersistedRuntimeState(session);
  return {
    ok: true,
    output: formatModelStatus(session),
    activity: `model set · ${normalizedModel}`,
  };
}

function formatProviderStatus(session: RuntimeSession, detailMode: DetailMode = "compact"): string {
  const compactRows: DiagnosticRow[] = [
    ["provider", session.provider],
    ["model", getCurrentProviderModel(session)],
    ["transport", session.providerTransport.mode],
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
    ["auth-source", session.providerTransport.authSource],
    ["auth-gate", session.providerTransport.authGate],
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
    `available: ${formatAvailableModels(session, provider)}`,
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
  return formatDiagnosticSection("memory", detailMode, [
    ["enabled", String(session.archivist.enabled)],
    ["boundary", session.archivist.boundary],
    ["storage", session.archivist.storagePath ?? "disabled"],
    ["persisted", String(session.archivist.storageExists)],
    ["preview", session.archivist.writes.preview ?? "none"],
  ], [
    ["enabled", String(session.archivist.enabled)],
    ["boundary", session.archivist.boundary],
    ["storage", session.archivist.storagePath ?? "disabled"],
    ["persisted", String(session.archivist.storageExists)],
    ["retrieval", formatArchivistRetrieval(session.archivist.retrieval)],
    ["retrievalPreview", session.archivist.retrieval.preview ?? "none"],
    ["writes", formatArchivistWrite(session.archivist.writes)],
    ["writePreview", session.archivist.writes.preview ?? "none"],
  ]).join("\n");
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
  return [
    `approvalRequired: ${String(session.operationControls.requireApprovalForGuarded)}`,
    `yoloMode: ${String(session.operationControls.yoloMode)}`,
    `pendingApproval: ${pending}`,
    `lastDecision: ${session.operationControls.lastDecision ?? "none"}`,
    `cancelRequested: ${String(session.operationControls.cancelRequested)}`,
    `steerState: ${session.operationControls.steerState ?? "none"}`,
    `steer: ${session.operationControls.steerMessage ?? "none"}`,
    `lastAppliedSteer: ${session.operationControls.lastAppliedSteer ?? "none"}`,
    `steerHistory: ${steerHistory}`,
  ].join("\n");
}

function formatToolPolicyStatus(session: RuntimeSession, detailMode: DetailMode = "compact"): string {
  const internalTools = getInternalToolDefinitions().map((tool) => tool.name).join(", ");
  return formatDiagnosticSection("tool-policy", detailMode, [
    ["mode", session.toolPolicy.mode],
    ["allowed", session.toolPolicy.allowedRoots.join(" | ")],
    ["writes", session.toolPolicy.writes],
    ["deletes", session.toolPolicy.deletes],
    ["shell", session.toolPolicy.shell],
    ["shellGuard", "repo-pinned; destructive-blocked"],
    ["internalTools", internalTools],
    ["ripgrep", hasRipgrep() ? "available" : "missing"],
  ], [
    ["mode", session.toolPolicy.mode],
    ["allowed", session.toolPolicy.allowedRoots.join(" | ")],
    ["protected", `${session.toolPolicy.protectedRoots.slice(0, 8).join(" | ")}${session.toolPolicy.protectedRoots.length > 8 ? " | ..." : ""}`],
    ["shell", session.toolPolicy.shell],
    ["shellGuard", "repo-pinned; destructive-blocked; timeout=5000ms; output<=120 lines"],
    ["writes", session.toolPolicy.writes],
    ["deletes", session.toolPolicy.deletes],
    ["internalTools", internalTools],
    ["ripgrep", hasRipgrep() ? "available" : "missing"],
  ]).join("\n");
}

function formatCompactionStatus(session: RuntimeSession): string {
  return [
    `status: ${session.compaction.status}`,
    `threshold: ${Math.round(session.compaction.thresholdPercent * 100)}%`,
    `thresholdTokens: ${String(getCompactionThresholdTokens(session))}`,
    `remainingTokens: ${String(getRemainingContextTokens(session))}`,
    `conversationTokens: ${String(estimateConversationTokens(session))}`,
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
    return enabled
      ? `Caveman mode ON. Style stack: ${formatStyleStack(session)}.`
      : `Caveman mode OFF. Style stack: ${formatStyleStack(session)}.`;
  }
  if (mode === "deadpoolMode") {
    return enabled
      ? `Deadpool mode ON. Style stack: ${formatStyleStack(session)}.`
      : `Deadpool mode OFF. Style stack: ${formatStyleStack(session)}.`;
  }
  return enabled
    ? `Statusline ON. Footer now shows ${formatStatusline(session)}.`
    : "Statusline OFF.";
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

function formatCommandCatalog(): string {
  return [
    ...COMMAND_CATALOG.map((command) => `${command.usage} - ${command.description}`),
    "!<command> - run guarded shell command and add output to transcript",
  ].join("\n");
}

function formatStatusline(session: RuntimeSession): string {
  return [
    session.provider,
    getCurrentProviderModel(session),
    session.providerTransport.mode,
    session.providerTransport.authGate,
    formatApprovalSummary(session),
    `mouse=${getConfiguredMouseMode(session)}/${getEffectiveMouseMode(session).mode}`,
    formatStyleStack(session),
    formatTurnTokens(session),
    `ctx~${getRemainingContextTokens(session)}`,
  ].join(" | ");
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

function formatAvailableModels(session: RuntimeSession, provider: string): string {
  if (provider === "codex") {
    const apiOnly = session.providerTransport.mode !== "cli-exec";
    return getAvailableModelsForProvider(session, provider)
      .map((definition) => definition.id)
      .join(", ");
  }

  const configuredModels = session.providerRouting.modelSelection.configuredModels as Record<string, string | undefined>;
  const configured = configuredModels[provider];
  return configured ? configured : "no catalog";
}

function getAvailableModelsForProvider(session: RuntimeSession, provider: string) {
  if (provider === "codex") {
    const apiOnly = session.providerTransport.mode !== "cli-exec";
    return CODEX_MODEL_CATALOG.filter((definition) => !apiOnly || definition.supportedInApi);
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
    contextWindow: 0,
    maxContextWindow: 0,
  }];
}

function normalizeModelForProvider(provider: string, requestedModel: string): string | null {
  if (provider === "codex") {
    const normalized = normalizeCodexModel(requestedModel);
    return getCodexModelDefinition(normalized) ? normalized : null;
  }

  const normalized = requestedModel.trim();
  return normalized.length > 0 ? normalized : null;
}

function toolResultToCommandResult(command: string, detail: string, result: ReturnType<typeof executeInternalTool>): RuntimeCommandResult {
  if (result.ok) {
    return {
      ok: true,
      output: result.output,
      activity: `${command} · ${detail}`,
    };
  }

  if (result.output.startsWith("tool policy blocked ")) {
    const blockedPath = result.output.replace(/^tool policy blocked\s+/, "").split(";")[0] ?? detail;
    return {
      ok: false,
      message: result.output,
      activity: `command blocked · ${blockedPath}`,
    };
  }

  return {
    ok: false,
    message: result.output,
    activity: `command failed · /${command} ${detail}`,
  };
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

async function runRuntimeTui(session: RuntimeSession): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stdin = process.stdin;
    const state = createDefaultRuntimeTuiState(createRuntimeTuiView(session));
    state.promptHistory = loadPersistedPromptHistory(session.cwd);
    state.action = session.action;
    let finished = false;
    let rawModeChanged = false;
    let periodicMemoryInFlight = false;
    let lastFrame = "";
    let nextPeriodicMemoryAt = scheduleNextPeriodicMemoryAutosave(Date.now());
    const priorRawMode = stdin.isRaw;
    const priorEncoding = stdin.readableEncoding;

    const render = () => {
      if (state.copyStatus && Date.now() >= state.copyStatusExpiresAt) {
        state.copyStatus = null;
      }
      syncTuiEventBuffers(session, state);
      state.view = createRuntimeTuiView(session);
      const frame = renderRuntimeTuiState(state);
      if (frame === lastFrame) {
        return;
      }
      lastFrame = frame;
      process.stdout.write(frame);
    };

    const pushActivity = (message: string) => {
      state.activity = [formatActivityLine(message), ...state.activity].slice(0, 6);
    };

    const resetHistoryNavigation = () => {
      state.promptHistoryIndex = -1;
      state.promptDraft = null;
    };

    const resetCompletionNavigation = () => {
      state.completionIndex = 0;
    };

    const closeHistoryPopup = () => {
      state.historyPopupOpen = false;
      state.historyPopupIndex = 0;
    };

    const closeModelPicker = () => {
      state.modelPickerOpen = false;
      state.modelPickerIndex = 0;
      state.modelPickerQuery = "";
    };

    const clampChatScroll = () => {
      const metrics = measureMiddleScroll(state, resolveTerminalSize());
      state.chatScrollOffset = Math.max(0, Math.min(metrics.maxScroll, state.chatScrollOffset));
      return metrics;
    };

    const scrollChatBy = (delta: number) => {
      const metrics = clampChatScroll();
      state.chatScrollOffset = Math.max(0, Math.min(metrics.maxScroll, state.chatScrollOffset + delta));
      render();
    };

    const openHistoryPopup = () => {
      if (state.promptHistory.length === 0) {
        return;
      }
      closeModelPicker();
      state.historyPopupOpen = true;
      state.historyPopupIndex = 0;
      render();
    };

    const openModelPicker = () => {
      if (getAvailableModelsForProvider(session, session.providerTransport.activeProvider).length === 0) {
        return;
      }
      closeHistoryPopup();
      state.modelPickerOpen = true;
      const availableModels = getAvailableModelsForProvider(session, session.providerTransport.activeProvider);
      const currentModel = getCurrentProviderModel(session);
      const currentIndex = availableModels.findIndex((entry) => entry.id === currentModel);
      state.modelPickerIndex = currentIndex >= 0 ? currentIndex : 0;
      state.modelPickerQuery = "";
      render();
    };

    const toggleTraceExpanded = () => {
      if (state.latestTurnTrace.length === 0 && state.currentTurnActivity.length === 0) {
        return;
      }
      state.traceExpanded = !state.traceExpanded;
      render();
    };

    const commitPromptHistory = (prompt: string) => {
      if (!prompt.trim()) {
        return;
      }
      if (state.promptHistory[state.promptHistory.length - 1] !== prompt) {
        state.promptHistory.push(prompt);
        if (state.promptHistory.length > 50) {
          state.promptHistory.shift();
        }
        savePersistedPromptHistory(session.cwd, state.promptHistory);
      }
      state.chatScrollOffset = 0;
      resetHistoryNavigation();
      closeHistoryPopup();
    };

    const navigatePromptHistory = (direction: -1 | 1) => {
      if (state.promptHistory.length === 0) {
        return;
      }

      if (direction === -1) {
        if (state.promptHistoryIndex === -1) {
          state.promptDraft = state.promptBuffer;
          state.promptHistoryIndex = state.promptHistory.length - 1;
        } else if (state.promptHistoryIndex > 0) {
          state.promptHistoryIndex -= 1;
        }
      } else {
        if (state.promptHistoryIndex === -1) {
          return;
        }
        if (state.promptHistoryIndex < state.promptHistory.length - 1) {
          state.promptHistoryIndex += 1;
        } else {
          state.promptHistoryIndex = -1;
          state.promptBuffer = state.promptDraft ?? "";
          state.promptCursor = state.promptBuffer.length;
          state.promptDraft = null;
          render();
          return;
        }
      }

      state.promptBuffer = state.promptHistory[state.promptHistoryIndex] ?? "";
      state.promptCursor = state.promptBuffer.length;
      render();
    };

    const navigateHistoryPopup = (direction: -1 | 1) => {
      if (!state.historyPopupOpen || state.promptHistory.length === 0) {
        return;
      }
      const maxIndex = state.promptHistory.length - 1;
      state.historyPopupIndex = Math.max(0, Math.min(maxIndex, state.historyPopupIndex + (direction === -1 ? 1 : -1)));
      render();
    };

    const navigateModelPicker = (direction: -1 | 1) => {
      if (!state.modelPickerOpen) {
        return;
      }
      const availableModels = getFilteredModelPickerEntries(state);
      if (availableModels.length === 0) {
        return;
      }
      const maxIndex = availableModels.length - 1;
      state.modelPickerIndex = Math.max(0, Math.min(maxIndex, state.modelPickerIndex + (direction === -1 ? -1 : 1)));
      render();
    };

    const navigatePromptCompletion = (direction: -1 | 1) => {
      const completion = autocompletePromptBuffer(session, state.promptBuffer, state.completionIndex);
      if (completion.suggestions.length <= 1) {
        return false;
      }
      state.completionIndex = clampIndex(state.completionIndex + direction, completion.suggestions.length);
      render();
      return true;
    };

    const commitHistoryPopupSelection = () => {
      if (!state.historyPopupOpen || state.promptHistory.length === 0) {
        return false;
      }
      const selected = [...state.promptHistory].reverse()[state.historyPopupIndex];
      state.promptBuffer = selected ?? "";
      state.promptCursor = state.promptBuffer.length;
      resetHistoryNavigation();
      closeHistoryPopup();
      render();
      return true;
    };

    const commitModelPickerSelection = () => {
      if (!state.modelPickerOpen) {
        return false;
      }
      const provider = session.providerTransport.activeProvider;
      const availableModels = getFilteredModelPickerEntries(state);
      const selected = availableModels[state.modelPickerIndex];
      if (!selected) {
        return false;
      }
      const configuredModels = session.providerRouting.modelSelection.configuredModels as Record<string, string | undefined>;
      configuredModels[provider] = selected.id;
      refreshInstructionState(session);
      savePersistedRuntimeState(session);
      closeModelPicker();
      setRuntimeAction(session, "ready", "model picker complete");
      recordRuntimeEvent(session, {
        kind: "command",
        status: "completed",
        summary: "model picker applied",
        detail: `${provider}=${selected.id}`,
      });
      state.action = session.action;
      pushActivity(`model set · ${selected.id}`);
      render();
      return true;
    };

    const cleanup = () => {
      clearInterval(animationInterval);
      clearInterval(periodicMemoryInterval);
      process.removeListener("SIGINT", onSigint);
      stdin.removeListener("data", onData);
      if (rawModeChanged) {
        stdin.setRawMode?.(priorRawMode);
      }
      stdin.setEncoding(priorEncoding ?? undefined);
      stdin.pause();
    };

    const finish = () => {
      if (finished) {
        return;
      }

      finished = true;
      cleanup();
      resolve();
    };

    const fail = (error: unknown) => {
      if (finished) {
        return;
      }

      finished = true;
      cleanup();
      reject(error);
    };

    const cycleSection = (direction: 1 | -1) => {
      const currentIndex = TUI_SECTIONS.indexOf(state.selectedSection);
      const nextIndex = (currentIndex + direction + TUI_SECTIONS.length) % TUI_SECTIONS.length;
      state.selectedSection = TUI_SECTIONS[nextIndex];
      setRuntimeAction(session, "ready", `showing ${state.selectedSection} panel`);
      recordRuntimeEvent(session, {
        kind: "command",
        status: "completed",
        summary: `showing ${state.selectedSection} panel`,
      });
      state.action = session.action;
      render();
    };

    const reloadRuntime = async () => {
      setRuntimeAction(session, "running", "refreshing runtime state");
      recordRuntimeEvent(session, {
        kind: "command",
        status: "started",
        summary: "reload command started",
      });
      state.action = session.action;
      pushActivity("refresh started");
      render();

      try {
        const runtime = await bootstrapRuntime(session.cwd);
        syncRuntimeSession(session, runtime);
        setRuntimeAction(session, "ready", "runtime baseline");
        recordRuntimeEvent(session, {
          kind: "command",
          status: "completed",
          summary: "reload command completed",
          detail: `provider ${session.provider}`,
        });
        state.action = session.action;
        pushActivity(`refresh ok · provider ${session.provider}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRuntimeAction(session, "error", message);
        recordRuntimeEvent(session, {
          kind: "command",
          status: "failed",
          summary: "reload command failed",
          detail: message,
        });
        state.action = session.action;
        pushActivity(`refresh failed · ${message}`);
      }

      render();
    };

    const submitPrompt = async () => {
      const prompt = state.promptBuffer.trim();
      if (prompt.length === 0) {
        return;
      }
      const effectivePrompt = toSkillCommandFromShorthand(prompt) ?? prompt;

      const memoryMutation = parseMemoryMutationCommand(effectivePrompt);
      if (memoryMutation) {
        state.promptBuffer = "";
        state.promptCursor = 0;
        resetHistoryNavigation();
        closeHistoryPopup();
        closeModelPicker();
        try {
          const output = await applyMemoryMutationCommand(session, memoryMutation);
          setRuntimeAction(session, "ready", "command complete");
          recordRuntimeEvent(session, {
            kind: "command",
            status: "completed",
            summary: "memory command completed",
            detail: output,
          });
          state.action = session.action;
          pushActivity(memoryMutation.kind === "save" ? "memory saved" : "memory checkpoint saved");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setRuntimeAction(session, "error", message);
          recordRuntimeEvent(session, {
            kind: "command",
            status: "failed",
            summary: "memory command failed",
            detail: message,
          });
          state.action = session.action;
          pushActivity(`memory command failed · ${message}`);
        }
        render();
        return;
      }

      const attachmentMutation = parseAttachmentMutationCommand(effectivePrompt);
      if (attachmentMutation) {
        state.promptBuffer = "";
        state.promptCursor = 0;
        resetHistoryNavigation();
        closeHistoryPopup();
        closeModelPicker();
        try {
          const applied = applyAttachmentMutationCommand(session, attachmentMutation);
          state.pendingImageAttachment = applied.attachment;
          setRuntimeAction(session, "ready", "attachment updated");
          recordRuntimeEvent(session, {
            kind: "command",
            status: "completed",
            summary: "attachment command completed",
            detail: applied.output,
          });
          state.action = session.action;
          pushActivity(applied.attachment ? "image attached" : "image detached");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setRuntimeAction(session, "error", message);
          recordRuntimeEvent(session, {
            kind: "command",
            status: "failed",
            summary: "attachment command failed",
            detail: message,
          });
          state.action = session.action;
          pushActivity(`attachment failed · ${message}`);
        }
        render();
        return;
      }

      if (effectivePrompt === "/model") {
        state.promptBuffer = "";
        state.promptCursor = 0;
        resetHistoryNavigation();
        openModelPicker();
        return;
      }

      commitPromptHistory(prompt);

      const commandResult = runRuntimeCommand(session, effectivePrompt);
      if (commandResult) {
        if (effectivePrompt === "/reload") {
          state.promptBuffer = "";
          state.promptCursor = 0;
          void reloadRuntime();
          return;
        }

        if (effectivePrompt === "/quit") {
          const quitMemoryNote = await maybePersistSessionMemoryOnQuit(session, "quit command");
          state.promptBuffer = "";
          state.promptCursor = 0;
          recordRuntimeEvent(session, {
            kind: "command",
            status: "completed",
            summary: "quit command requested",
            detail: quitMemoryNote ?? "no pre-quit memory save",
          });
          if (quitMemoryNote) {
            pushActivity("memory session saved · quit");
          }
          pushActivity("quit requested");
          render();
          finish();
          return;
        }

        // Skill commands with autoInvokeAfterSkill fall through to model invocation
        if (commandResult.ok && commandResult.autoInvokeAfterSkill) {
          process.stdout.write(`${commandResult.output}\n`);
          state.promptBuffer = "";
          state.promptCursor = 0;
          // fall through to provider request below
        } else {
          state.promptBuffer = "";
          state.promptCursor = 0;
          setRuntimeAction(session, commandResult.ok ? "ready" : "error", commandResult.ok ? "command complete" : commandResult.message);
          recordRuntimeEvent(session, {
            kind: "command",
            status: commandResult.ok ? "completed" : "failed",
            summary: `command ${effectivePrompt.split(/\s+/)[0]} ${commandResult.ok ? "completed" : "failed"}`,
            detail: commandResult.ok ? commandResult.output : commandResult.message,
          });
          state.action = session.action;
          pushActivity(commandResult.activity);
          render();
          return;
        }
      }

      if (state.action.pending) {
        return;
      }

      state.promptBuffer = "";
      state.promptCursor = 0;

      recordRuntimeEvent(session, {
        kind: "prompt",
        status: "queued",
        summary: "user prompt accepted",
        detail: effectivePrompt.length > 160 ? `${effectivePrompt.slice(0, 157)}...` : effectivePrompt,
      });
      setRuntimeAction(session, "running", "provider request");
      state.action = session.action;
      pushActivity("request started");
      render();

      try {
        await maybeAutoPersistMemory(session, effectivePrompt);
        const autoCompact = maybeCompactConversation(session, effectivePrompt);
        if (autoCompact.compacted) {
          setRuntimeAction(session, "running", `auto compact · ${autoCompact.beforeTokens} -> ${autoCompact.afterTokens}`);
          state.action = session.action;
          pushActivity(`auto compact · ${autoCompact.beforeTokens} -> ${autoCompact.afterTokens}`);
          await maybePersistCompactionMemory(session, effectivePrompt, autoCompact.beforeTokens, autoCompact.afterTokens);
          render();
        }
        const queuedAttachment = state.pendingImageAttachment;
        const result = await executeProviderRequest({
          session,
          prompt: effectivePrompt,
          ...(queuedAttachment ? { attachments: [queuedAttachment] } : {}),
        });
        if (result.ok) {
          const userTurn = queuedAttachment
            ? `${effectivePrompt}\n[attachment] name=${queuedAttachment.name}; mime=${queuedAttachment.mimeType}; bytes=${String(queuedAttachment.bytes)}`
            : effectivePrompt;
          recordConversationTurn(session, "user", userTurn);
          setRuntimeAction(session, "running", `streaming reply · ${result.provider}`);
          state.action = session.action;
          pushActivity(`streaming reply · ${result.provider}`);
          await renderPacedAssistantReply(state, result.output, render);
          recordConversationTurn(session, "assistant", result.output);
          state.liveAssistantReply = null;
          recordTurnTelemetry(session, effectivePrompt, result.output);
          setRuntimeAction(session, "ready", `response received · ${result.provider}`);
          state.action = session.action;
          pushActivity(`request ok · ${result.provider}`);
          if (queuedAttachment) {
            state.pendingImageAttachment = null;
            pushActivity(`image sent · ${queuedAttachment.name}`);
          }
        } else {
          setRuntimeAction(session, "error", result.message);
          recordRuntimeEvent(session, {
            kind: "provider",
            status: "failed",
            summary: `${result.provider} response failed`,
            detail: result.detail,
          });
          state.action = session.action;
          pushActivity(`request failed · ${result.code}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setRuntimeAction(session, "error", message);
        recordRuntimeEvent(session, {
          kind: "provider",
          status: "failed",
          summary: "provider request failed",
          detail: message,
        });
        state.action = session.action;
        pushActivity(`request failed · ${message}`);
      } finally {
        state.action = session.action;
        render();
      }
    };

    const onSigint = () => finish();

    const onData = (input: Buffer | string) => {
      const key = input.toString();

      if (key === "\u0003") {
        const now = Date.now();
        if (now - state.lastCtrlCAt <= 700) {
          finish();
          return;
        }

        const copyPayload = buildCopyPayload(state);
        if (copyPayload) {
          const copied = copyTextToClipboard(copyPayload.text);
          const count = copyPayload.text.length;
          const status = copied
            ? `copied ${count} chars (${copyPayload.label})`
            : `copy unavailable (${count} chars ready)`;
          state.copyStatus = status;
          state.copyStatusExpiresAt = now + 4000;
          pushActivity(`${status} · Ctrl+C again exit`);
        } else {
          const status = "nothing to copy";
          state.copyStatus = status;
          state.copyStatusExpiresAt = now + 3000;
          pushActivity(`${status} · Ctrl+C again exit`);
        }
        state.lastCtrlCAt = now;
        render();
        return;
      }

      if (key === "\u001b") {
        if (state.historyPopupOpen) {
          closeHistoryPopup();
          render();
          return;
        }

        if (state.modelPickerOpen) {
          closeModelPicker();
          render();
          return;
        }

        if (state.action.pending) {
          session.operationControls.cancelRequested = true;
          session.operationControls.activeAbortController?.abort();
          if (session.operationControls.pendingApproval) {
            session.operationControls.pendingApproval = null;
            session.operationControls.lastDecision = "canceled";
          }
          setRuntimeAction(session, "running", "cancel requested");
          recordRuntimeEvent(session, {
            kind: "control",
            status: "canceled",
            summary: "operator cancel requested",
            detail: "escape key",
          });
          state.action = session.action;
          pushActivity("cancel requested · esc");
          render();
          return;
        }

        if (state.promptBuffer.length > 0) {
          state.promptBuffer = "";
          state.promptCursor = 0;
          resetHistoryNavigation();
          render();
        }
        return;
      }

      if (key === "\r" || key === "\n") {
        if (commitModelPickerSelection()) {
          return;
        }
        if (commitHistoryPopupSelection()) {
          return;
        }
        void submitPrompt();
        return;
      }

      if (key === "\u0012") {
        openHistoryPopup();
        return;
      }

      if (key === "\u0014") {
        toggleTraceExpanded();
        return;
      }

      if (key === "\u000c") {
        state.composerFocusMode = !state.composerFocusMode;
        pushActivity(`composer focus ${state.composerFocusMode ? "on" : "off"} · Ctrl+L`);
        render();
        return;
      }

      if (key === "\u000f") {
        const current = getConfiguredMouseMode(session);
        session.commandModes.mouseMode = current === "auto" ? "scroll" : current === "scroll" ? "select" : "auto";
        savePersistedRuntimeState(session);
        writeTerminalMouseMode(session);
        const effective = getEffectiveMouseMode(session);
        if (effective.warning) {
          recordRuntimeEvent(session, {
            kind: "control",
            status: "blocked",
            summary: "mouse mode fallback active",
            detail: effective.warning,
          });
          pushActivity(`mouse ${getConfiguredMouseMode(session)} -> ${effective.mode} · ${effective.warning}`);
        } else {
          pushActivity(`mouse mode ${getConfiguredMouseMode(session)} · Ctrl+O`);
        }
        render();
        return;
      }

      if (key === "\u0019") {
        if (state.pendingApprovalTool) {
          const commandResult = runRuntimeCommand(session, "/approval approve");
          if (commandResult?.ok) {
            setRuntimeAction(session, "ready", "approval granted");
            recordRuntimeEvent(session, {
              kind: "control",
              status: "applied",
              summary: "approval granted",
              detail: commandResult.output,
            });
            state.action = session.action;
            pushActivity("approval granted · Ctrl+Y");
            render();
          }
        }
        return;
      }

      if (key === "\u000e") {
        if (state.pendingApprovalTool) {
          const commandResult = runRuntimeCommand(session, "/approval reject");
          if (commandResult?.ok) {
            setRuntimeAction(session, "ready", "approval rejected");
            recordRuntimeEvent(session, {
              kind: "control",
              status: "blocked",
              summary: "approval rejected",
              detail: commandResult.output,
            });
            state.action = session.action;
            pushActivity("approval rejected · Ctrl+N");
            render();
          }
        }
        return;
      }

      if (key === "\u001b\u0016" || key === "\u001bv" || key === "\u001bV") {
        closeHistoryPopup();
        closeModelPicker();
        try {
          const pasted = extractClipboardImageToTempFile();
          const applied = applyAttachmentMutationCommand(session, {
            kind: "attach",
            rawPath: pasted.path,
          });
          state.pendingImageAttachment = applied.attachment;
          setRuntimeAction(session, "ready", "clipboard image attached");
          recordRuntimeEvent(session, {
            kind: "command",
            status: "completed",
            summary: "clipboard image paste completed",
            detail: `${applied.output}; source=${pasted.source}`,
          });
          state.action = session.action;
          pushActivity(`image pasted · ${applied.attachment?.name ?? "clipboard"} · ${pasted.source}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setRuntimeAction(session, "error", message);
          recordRuntimeEvent(session, {
            kind: "command",
            status: "failed",
            summary: "clipboard image paste failed",
            detail: message,
          });
          state.action = session.action;
          pushActivity(`paste-image failed · ${message}`);
        }
        render();
        return;
      }

      if (key === "\t") {
        const completion = autocompletePromptBuffer(session, state.promptBuffer, state.completionIndex);
        if (completion.value !== state.promptBuffer) {
          state.promptBuffer = completion.value;
          state.promptCursor = state.promptBuffer.length;
          resetHistoryNavigation();
          resetCompletionNavigation();
          render();
        }
        return;
      }

      if (key === "\u007f") {
        if (state.modelPickerOpen) {
          if (state.modelPickerQuery.length > 0) {
            state.modelPickerQuery = state.modelPickerQuery.slice(0, -1);
            state.modelPickerIndex = 0;
            render();
          }
          return;
        }
        if (state.promptCursor > 0) {
          state.promptBuffer = `${state.promptBuffer.slice(0, state.promptCursor - 1)}${state.promptBuffer.slice(state.promptCursor)}`;
          state.promptCursor -= 1;
          resetHistoryNavigation();
          resetCompletionNavigation();
          render();
        }
        return;
      }

      if (key === "\u001b[C") {
        if (state.promptCursor < state.promptBuffer.length) {
          state.promptCursor += 1;
          render();
        }
        return;
      }

      if (key === "\u001b[D") {
        if (state.promptCursor > 0) {
          state.promptCursor -= 1;
          render();
        }
        return;
      }

      if (key === "\u001b[A") {
        if (state.modelPickerOpen) {
          navigateModelPicker(-1);
          return;
        }
        if (state.historyPopupOpen) {
          navigateHistoryPopup(-1);
          return;
        }
        if (state.promptBuffer.length > 0 && navigatePromptCompletion(-1)) {
          return;
        }
        if (getConfiguredMouseMode(session) === "auto" && state.promptBuffer.length === 0) {
          scrollChatBy(3);
          return;
        }
        navigatePromptHistory(-1);
        return;
      }

      if (key === "\u001b[B") {
        if (state.modelPickerOpen) {
          navigateModelPicker(1);
          return;
        }
        if (state.historyPopupOpen) {
          navigateHistoryPopup(1);
          return;
        }
        if (state.promptBuffer.length > 0 && navigatePromptCompletion(1)) {
          return;
        }
        if (getConfiguredMouseMode(session) === "auto" && state.promptBuffer.length === 0) {
          scrollChatBy(-3);
          return;
        }
        navigatePromptHistory(1);
        return;
      }

      if (key === "\u001b[5~") {
        if (state.modelPickerOpen) {
          for (let index = 0; index < 5; index += 1) {
            navigateModelPicker(-1);
          }
          return;
        }
        if (state.historyPopupOpen) {
          for (let index = 0; index < 5; index += 1) {
            navigateHistoryPopup(-1);
          }
          return;
        }
        const metrics = clampChatScroll();
        state.chatScrollOffset = Math.min(metrics.maxScroll, state.chatScrollOffset + metrics.step);
        render();
        return;
      }

      if (key === "\u001b[6~") {
        if (state.modelPickerOpen) {
          for (let index = 0; index < 5; index += 1) {
            navigateModelPicker(1);
          }
          return;
        }
        if (state.historyPopupOpen) {
          for (let index = 0; index < 5; index += 1) {
            navigateHistoryPopup(1);
          }
          return;
        }
        const metrics = clampChatScroll();
        state.chatScrollOffset = Math.max(0, state.chatScrollOffset - metrics.step);
        render();
        return;
      }

      if (key === "\u001b[H" || key === "\u001b[1~" || key === "\u001bOH") {
        if (state.modelPickerOpen) {
          state.modelPickerIndex = 0;
          render();
          return;
        }
        if (state.historyPopupOpen) {
          state.historyPopupIndex = 0;
          render();
          return;
        }
        const metrics = clampChatScroll();
        state.chatScrollOffset = metrics.maxScroll;
        render();
        return;
      }

      if (key === "\u001b[F" || key === "\u001b[4~" || key === "\u001bOF") {
        if (state.modelPickerOpen) {
          state.modelPickerIndex = Math.max(0, getFilteredModelPickerEntries(state).length - 1);
          render();
          return;
        }
        if (state.historyPopupOpen) {
          state.historyPopupIndex = Math.max(0, state.promptHistory.length - 1);
          render();
          return;
        }
        state.chatScrollOffset = 0;
        render();
        return;
      }

      const wheelMatch = key.match(/^\u001b\[<(\d+);(\d+);(\d+)([mM])$/);
      if (wheelMatch) {
        const effectiveMouse = getEffectiveMouseMode(session);
        if (effectiveMouse.mode === "select") {
          if (effectiveMouse.warning) {
            recordRuntimeEvent(session, {
              kind: "control",
              status: "blocked",
              summary: "mouse wheel ignored",
              detail: effectiveMouse.warning,
            });
            pushActivity(`mouse wheel ignored · ${effectiveMouse.warning}`);
            render();
          }
          return;
        }
        const button = Number(wheelMatch[1]);
        if (state.modelPickerOpen) {
          if (button === 64) {
            navigateModelPicker(-1);
            return;
          }
          if (button === 65) {
            navigateModelPicker(1);
            return;
          }
        }
        if (state.historyPopupOpen) {
          if (button === 64) {
            navigateHistoryPopup(-1);
            return;
          }
          if (button === 65) {
            navigateHistoryPopup(1);
            return;
          }
        }
        const metrics = clampChatScroll();
        if (button === 64) {
          state.chatScrollOffset = Math.min(metrics.maxScroll, state.chatScrollOffset + 3);
          render();
          return;
        }
        if (button === 65) {
          state.chatScrollOffset = Math.max(0, state.chatScrollOffset - 3);
          render();
          return;
        }
      }

      if (!key.startsWith("\u001b") && key >= " ") {
        if (state.modelPickerOpen) {
          state.modelPickerQuery += key;
          state.modelPickerIndex = 0;
          render();
          return;
        }
        if (state.historyPopupOpen) {
          closeHistoryPopup();
        }
        state.promptBuffer = `${state.promptBuffer.slice(0, state.promptCursor)}${key}${state.promptBuffer.slice(state.promptCursor)}`;
        state.promptCursor += key.length;
        state.selectedSection = "agent";
        resetHistoryNavigation();
        resetCompletionNavigation();
        render();
      }
    };

    const animationInterval = setInterval(() => {
      if (!state.action.pending) {
        return;
      }
      state.spinnerFrame += 1;
      render();
    }, 180);

    const periodicMemoryInterval = setInterval(() => {
      if (finished || periodicMemoryInFlight) {
        return;
      }
      if (Date.now() < nextPeriodicMemoryAt) {
        return;
      }
      periodicMemoryInFlight = true;
      void maybePersistPeriodicMemory(session)
        .then((saved) => {
          if (saved) {
            pushActivity("memory checkpoint auto · periodic");
          }
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          pushActivity(`memory periodic failed · ${message}`);
        })
        .finally(() => {
          nextPeriodicMemoryAt = scheduleNextPeriodicMemoryAutosave(Date.now());
          periodicMemoryInFlight = false;
        });
    }, PERIODIC_MEMORY_TICK_MS);

    try {
      recordRuntimeEvent(session, {
        kind: "system",
        status: "info",
        summary: "runtime baseline ready",
      });
      pushActivity("runtime baseline ready");
      process.once("SIGINT", onSigint);
      stdin.setEncoding("utf8");
      if (typeof stdin.setRawMode === "function") {
        stdin.setRawMode(true);
        rawModeChanged = priorRawMode !== true;
      }
      writeTerminalMouseMode(session);
      stdin.resume();
      stdin.on("data", onData);
      render();
    } catch (error) {
      fail(error);
    }
  });
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
  state.chatHistory = buildChatHistoryFromSession(session).slice(-120);
  state.liveAssistantReply = null;
  const lastPromptIndex = [...session.events].map((event) => event.kind).lastIndexOf("prompt");
  const latestTurnEvents = (lastPromptIndex >= 0 ? session.events.slice(lastPromptIndex) : recent)
    .filter((event) => !["system", "prompt", "assistant"].includes(event.kind));
  state.currentTurnActivity = latestTurnEvents
    .slice(-16)
    .flatMap((event) => formatTranscriptEvent(event))
    .slice(-40);
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
  }));
}

export function buildChatHistoryFromSession(session: RuntimeSession): string[] {
  const lines: string[] = [];
  const assistantReplies = session.conversation.filter((turn) => turn.role === "assistant");
  let assistantIndex = 0;

  for (const event of session.events) {
    if (event.kind === "prompt" && event.detail) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push(`you: ${event.detail}`);
      continue;
    }

    if (event.kind === "assistant" && event.status === "completed") {
      const reply = assistantReplies[assistantIndex]?.content ?? event.detail;
      assistantIndex += 1;
      if (!reply) {
        continue;
      }
      lines.push(`agent: ${reply}`);
      lines.push("");
      continue;
    }

    if (event.kind === "command") {
      const commandName = event.summary.match(/command\s+(\S+)/)?.[1] ?? "command";
      if (lines.length > 0 && lines[lines.length - 1] !== "") {
        lines.push("");
      }
      lines.push(`you: ${commandName}`);
      lines.push(...formatCommandBoundary(event));
      lines.push("");
    }
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
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

export function buildPacedReplyFrames(reply: string, maxFrames = 32): string[] {
  const normalized = reply.trimEnd();
  if (normalized.length === 0) {
    return [];
  }

  const frameCount = Math.min(maxFrames, normalized.length);
  const frames: string[] = [];
  for (let index = 1; index <= frameCount; index += 1) {
    const end = Math.ceil((normalized.length * index) / frameCount);
    const frame = normalized.slice(0, end);
    if (frame !== frames[frames.length - 1]) {
      frames.push(frame);
    }
  }
  return frames;
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
    await new Promise((resolve) => setTimeout(resolve, 8));
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
  const turnHeader = renderTurnHeaderBadges(state, width);
  const operatorPanels = renderOperatorTurnPanels(state, width);
  const footerStatus = buildFooterStatus(state, width);
  const hasTrace = state.latestTurnTrace.length > 0 || state.currentTurnActivity.length > 0;
  const expandedTraceLines: string[] = [
    "▾ trace open · Ctrl+T collapse",
    ...(state.latestTurnTrace.length > 0 ? ["", ...state.latestTurnTrace] : []),
    ...(state.currentTurnActivity.length > 0 ? ["", ...state.currentTurnActivity] : []),
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
    top: [],
    middle: [
      ...renderControlCard(state, width),
      ...(state.modelPickerOpen
        ? renderModelPicker(state, width)
        : state.historyPopupOpen
          ? renderHistoryPopup(state, width)
          : [...turnHeader, ...operatorPanels, ...chatLines]),
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
  const model = lookupActiveModel(state) ?? "none";
  const verb = selectProgressVerb(state.action);
  const runBadge = state.action.pending
    ? `${NEXAGENT_EMBLEM_FRAMES[((state.spinnerFrame % NEXAGENT_EMBLEM_FRAMES.length) + NEXAGENT_EMBLEM_FRAMES.length) % NEXAGENT_EMBLEM_FRAMES.length]} ${verb}`
    : NEXAGENT_EMBLEM_FRAMES[0];
  const trace = state.latestTurnTrace.length > 0 || state.currentTurnActivity.length > 0
    ? ` │ trace ${state.traceExpanded ? "open" : "closed"}`
    : "";
  const scroll = formatScrollState(state, width);
  const scrollPart = scroll ? ` │ ${scroll}` : "";
  const copyPart = state.copyStatus ? ` │ ${state.copyStatus}` : "";
  const attachmentPart = state.pendingImageAttachment ? " │ image 1" : "";
  const approvalPart = state.pendingApprovalTool ? ` │ approval ${state.pendingApprovalTool}` : "";
  const steerPart = state.steerMessage ? ` │ steer ${state.steerState ?? "queued"}` : "";
  const modePart = state.composerFocusMode ? " │ focus composer" : "";
  const legacyStatusline = state.view.statusline ? ` │ ${state.view.statusline}` : "";
  return truncateLine(`${runBadge} │ ${model}@${provider} │ turns ${turns} │ ${tokens}${trace}${scrollPart}${attachmentPart}${approvalPart}${steerPart}${copyPart}${modePart}${legacyStatusline} │ ${cwd}`, width);
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
    ...renderIntentEchoLine(state, width),
    ...renderStructuredTurnBlocks(state, width),
    ...renderDiffSummaryCard(state, width),
    ...renderRiskBadgeLine(state, width),
    ...renderOutcomeFooter(state, width),
    ...renderInlineActionChips(state, width),
    ...renderKeyboardNavigationLine(width),
    ...renderDensityControlLine(width),
    ...renderTerminalCapabilityPanel(state, width),
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
    return wrapText(`${selected ? "›" : " "} ${entry.id}${currentMark} - ${entry.description}`, Math.max(20, boxWidth - 6));
  });

  return renderMessageBox(
    "model picker",
    `${provider} models · ${state.modelPickerIndex + 1}/${entries.length} · Enter apply · Esc close\nfilter: ${state.modelPickerQuery || "(none)"} · type to filter · Backspace delete · Home/End jump\n\n${lines.join("\n")}`,
    boxWidth,
  );
}

function renderCollapsedTraceSummary(state: RuntimeTuiState, width: number): string[] {
  const totalEntries = state.latestTurnTrace.length + state.currentTurnActivity.length;
  return renderMessageBox("trace", `▸ trace closed · Ctrl+T expand · ${totalEntries} entries`, width);
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
    const result = await checkpointArchivistSession(session, command.reason ?? "manual checkpoint");
    return `memory checkpoint saved; entries=${String(result.entryCount)}\n${result.preview}`;
  }

  const sessionDigest = buildSessionMemoryDigest(session, command.focus);
  const saved = await saveArchivistMemory(session, {
    summary: sessionDigest.summary,
    content: sessionDigest.content,
    type: "session-summary",
    tags: ["session", "summary", ...(command.focus ? ["focused"] : [])],
  });
  return `memory session summary saved; entries=${String(saved.entryCount)}\n${saved.preview}`;
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

type AttachmentMutationCommand =
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

function applyAttachmentMutationCommand(
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

function formatAttachmentLabel(attachment: ImageAttachment | null): string {
  if (!attachment) {
    return "none";
  }
  return `${attachment.name} (${attachment.mimeType}, ${formatBytes(attachment.bytes)})`;
}

function extractClipboardImageToTempFile(): { path: string; source: string } {
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
  await checkpointArchivistSession(session, checkpointReason);
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

function getFilteredModelPickerEntries(state: RuntimeTuiState): Array<{ id: string; description: string; current: boolean }> {
  const query = state.modelPickerQuery.trim().toLowerCase();
  if (!query) {
    return state.modelPickerEntries;
  }
  return state.modelPickerEntries.filter((entry) =>
    entry.id.toLowerCase().includes(query) || entry.description.toLowerCase().includes(query),
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
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
