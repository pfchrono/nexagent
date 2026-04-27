#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import process from "node:process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { executeProviderRequest } from "./provider.js";
import { launchCodexLogin, probeCodexAuthStateSync } from "./runtime/auth.js";
import { bootstrapRuntime } from "./runtime/bootstrap.js";
import { buildPromptLayers, summarizePromptLayers } from "./runtime/instructions.js";
import { loadPersistedPromptHistory, savePersistedPromptHistory, savePersistedRuntimeState } from "./runtime/persistence.js";
import { executeInternalTool, getInternalToolDefinitions } from "./runtime/tools.js";
import { CODEX_MODEL_CATALOG, DEFAULT_CODEX_MODEL, getCodexModelDefinition, normalizeCodexModel } from "./models.js";
import {
  applyTransportMode,
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

const SPINNER_FRAMES = ["-", "\\", "|", "/"] as const;
const NEXAGENT_EMBLEM_FRAMES = ["◜◆◝", "◠◆◡", "◟◆◞", "◡◆◠"] as const;
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
const KEY_HINT = "Keys: type prompt · Tab accept · ↑/↓ history · Ctrl+R picker · Ctrl+T trace · ←/→ move cursor · PgUp/PgDn scroll · Home/End jump · Esc cancel/clear · Enter send · use /reload or /quit";
const COMMAND_CATALOG = [
  { name: "/help", usage: "/help", description: "show available runtime commands" },
  { name: "/reload", usage: "/reload", description: "reload runtime state from repo config" },
  { name: "/quit", usage: "/quit", description: "exit interactive TTY session" },
  { name: "/continue", usage: "/continue", description: "continue active turn if clear" },
  { name: "/finish", usage: "/finish", description: "finalize current turn only when completion proof exists" },
  { name: "/login", usage: "/login [status]", description: "check or launch Codex login" },
  { name: "/codex", usage: "/codex [status|off]", description: "activate Codex provider preference" },
  { name: "/provider", usage: "/provider [status|name|transport ...] [--verbose]", description: "show or switch provider and transport mode" },
  { name: "/model", usage: "/model [status|list|name]", description: "show or set model for active provider" },
  { name: "/status", usage: "/status [--verbose]", description: "show runtime, repo, auth, and style status (compact default)" },
  { name: "/caveman-mode", usage: "/caveman-mode [on|off|status]", description: "toggle compressed caveman response style" },
  { name: "/deadpoolmode", usage: "/deadpoolmode [on|off|status]", description: "toggle Deadpool prose style overlay" },
  { name: "/statusline", usage: "/statusline [on|off|status]", description: "toggle compact runtime statusline footer" },
  { name: "/approval", usage: "/approval [on|off|status|approve|reject]", description: "control guarded-tool approval gate" },
  { name: "/cancel", usage: "/cancel", description: "request cancel for pending operation" },
  { name: "/steer", usage: "/steer <message>", description: "queue operator steer note for next tool/model step" },
  { name: "/compact", usage: "/compact [status]", description: "compact session context now or inspect compaction state" },
  { name: "/tools", usage: "/tools [--verbose]", description: "show repo-local tool policy and safety guards" },
  { name: "/pwd", usage: "/pwd", description: "show current working directory" },
  { name: "/ls", usage: "/ls [path]", description: "list directory contents from session cwd" },
  { name: "/read", usage: "/read <path>", description: "read text file contents" },
  { name: "/find", usage: "/find <text> [path]", description: "search text in repo files" },
  { name: "/glob", usage: "/glob <pattern> [path]", description: "match repo files by glob pattern" },
  { name: "/rg", usage: "/rg <pattern> [path]", description: "search repo files with ripgrep" },
  { name: "/diff", usage: "/diff [path]", description: "show bounded git diff for repo or one path" },
  { name: "/hooks", usage: "/hooks", description: "inspect repo-local hook policy" },
  { name: "/memory", usage: "/memory [--verbose]", description: "inspect memory boundary and persisted storage (compact default)" },
] as const;
const PATH_COMPLETION_COMMANDS = new Set(["/ls", "/read", "/diff"]);
const SECOND_ARG_PATH_COMMANDS = new Set(["/find", "/glob", "/rg"]);
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
  currentTurnActivity: string[];
  latestTurnTrace: string[];
  traceExpanded: boolean;
  promptCursor: number;
  promptHistory: string[];
  promptHistoryIndex: number;
  promptDraft: string | null;
  historyPopupOpen: boolean;
  historyPopupIndex: number;
  modelPickerOpen: boolean;
  modelPickerIndex: number;
  modelPickerEntries: Array<{ id: string; description: string; current: boolean }>;
  chatScrollOffset: number;
  latestUserMessage: string | null;
  latestAssistantMessage: string | null;
}

interface TerminalSize {
  columns: number;
  rows: number;
}

interface RuntimeCommandSuccess {
  ok: true;
  output: string;
  activity: string;
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
    await runPromptCommand(session, prompt);
    return;
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    const runtime = await bootstrapRuntime(process.cwd());
    const session = createRuntimeSession(runtime);
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
    stopStartup();
    stopStartup = undefined;
    process.removeListener("SIGINT", onStartupSigint);
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
}

interface InspectCommand {
  kind: "inspect";
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
  if (argv[0] !== "run") {
    return { kind: "inspect" };
  }

  const prompt = argv.slice(1).join(" ").trim();
  return {
    kind: "run",
    prompt: prompt.length > 0 ? prompt : null,
  };
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
  const trimmedPrompt = prompt.trim();
  if (session.operationControls.pendingApproval && !trimmedPrompt.startsWith("/")) {
    const lowerPrompt = trimmedPrompt.toLowerCase();
    if (APPROVE_PROMPT_ALIASES.has(lowerPrompt)) {
      prompt = "/approval approve";
    } else if (REJECT_PROMPT_ALIASES.has(lowerPrompt)) {
      prompt = "/approval reject";
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

  if (prompt.trim() === "/reload") {
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
    process.stdout.write("runtime reloaded\n");
    return;
  }

  if (prompt.trim() === "/quit") {
    setRuntimeAction(session, "ready", "command complete");
    recordRuntimeEvent(session, {
      kind: "command",
      status: "completed",
      summary: "quit command requested",
    });
    process.stdout.write("quitting interactive session\n");
    return;
  }

  const commandResult = runRuntimeCommand(session, prompt);

  if (commandResult) {
    if (commandResult.ok) {
      setRuntimeAction(session, "ready", "command complete");
      recordRuntimeEvent(session, {
        kind: "command",
        status: "completed",
        summary: `command ${prompt.split(/\s+/)[0]} completed`,
        detail: commandResult.output,
      });
      process.stdout.write(`${commandResult.output}\n`);
      return;
    }

    setRuntimeAction(session, "error", commandResult.message);
    recordRuntimeEvent(session, {
      kind: "command",
      status: "failed",
      summary: `command ${prompt.split(/\s+/)[0]} failed`,
      detail: commandResult.message,
    });
    process.stderr.write(`${commandResult.message}\n`);
    process.exitCode = 1;
    return;
  }

  recordRuntimeEvent(session, {
    kind: "prompt",
    status: "queued",
    summary: "user prompt accepted",
    detail: prompt.length > 160 ? `${prompt.slice(0, 157)}...` : prompt,
  });
  setRuntimeAction(session, "running", "provider request");

  try {
    const autoCompact = maybeCompactConversation(session, prompt);
    if (autoCompact.compacted) {
      setRuntimeAction(session, "running", `auto compact · ${autoCompact.beforeTokens} -> ${autoCompact.afterTokens}`);
    }
    const result = await executeProviderRequest({ session, prompt });

    if (result.ok) {
      recordConversationTurn(session, "user", prompt);
      recordConversationTurn(session, "assistant", result.output);
      recordTurnTelemetry(session, prompt, result.output);
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

  const detailLines = event.detail.split("\n");
  const previewLines = detailLines.slice(0, 2);
  const hiddenLineCount = Math.max(0, detailLines.length - previewLines.length);

  return [
    base,
    ...previewLines.map((line) => `  ${line}`),
    ...(hiddenLineCount > 0 ? [`  (+${hiddenLineCount} hidden lines)`] : []),
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
    output: "runtime reload requested",
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
      message: "usage: /memory [--verbose]",
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
  savePersistedRuntimeState(session);
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
  return active.length > 0 ? active.join(" + ") : "normal";
}

function formatTurnTokens(session: RuntimeSession): string {
  return `in~${session.telemetry.lastInputTokens} out~${session.telemetry.lastOutputTokens}`;
}

function formatCommandCatalog(): string {
  return COMMAND_CATALOG.map((command) => `${command.usage} - ${command.description}`).join("\n");
}

function formatStatusline(session: RuntimeSession): string {
  return [
    session.provider,
    getCurrentProviderModel(session),
    session.providerTransport.mode,
    session.providerTransport.authGate,
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

export function autocompletePromptBuffer(
  session: Pick<RuntimeSession, "cwd">,
  input: string,
): { value: string; hint: string | null } {
  const trimmedLeft = input.replace(/^\s+/, "");
  if (!trimmedLeft.startsWith("/")) {
    return { value: input, hint: null };
  }

  if (/^\/\S*$/.test(input)) {
    return completeSlashCommand(input);
  }

  return completeCommandPath(session.cwd, input);
}

export function describePromptHint(session: Pick<RuntimeSession, "cwd">, input: string): string | null {
  const trimmedLeft = input.replace(/^\s+/, "");
  if (!trimmedLeft.startsWith("/")) {
    return null;
  }

  if (/^\/\S*$/.test(input)) {
    const partial = input.toLowerCase();
    const matches = COMMAND_CATALOG
      .map((entry) => entry.name)
      .filter((name) => name.startsWith(partial))
      .slice(0, 4);
    return matches.length > 0 ? `suggest: ${matches.join(" · ")}` : null;
  }

  return completeCommandPath(session.cwd, input).hint;
}

function completeSlashCommand(input: string): { value: string; hint: string | null } {
  const partial = input.toLowerCase();
  const matches = COMMAND_CATALOG.map((entry) => entry.name).filter((name) => name.startsWith(partial));
  if (matches.length === 0) {
    return { value: input, hint: null };
  }
  if (matches.length === 1) {
    return { value: `${matches[0]} `, hint: matches[0] };
  }

  const common = longestCommonPrefix(matches);
  return {
    value: common.length > partial.length ? common : input,
    hint: `suggest: ${matches.join(" · ")}`,
  };
}

function completeCommandPath(cwd: string, input: string): { value: string; hint: string | null } {
  const parts = input.split(/\s+/);
  const command = parts[0] ?? "";
  const pathIndex = SECOND_ARG_PATH_COMMANDS.has(command) ? 2 : 1;
  if (!PATH_COMPLETION_COMMANDS.has(command) && !(SECOND_ARG_PATH_COMMANDS.has(command) && parts.length >= 3)) {
    return { value: input, hint: null };
  }

  const partialPath = parts[pathIndex] ?? "";
  const completion = completePathFromCwd(cwd, partialPath);
  if (!completion) {
    return { value: input, hint: null };
  }

  const nextParts = [...parts];
  nextParts[pathIndex] = completion.value;
  return {
    value: nextParts.join(" "),
    hint: completion.hint,
  };
}

function completePathFromCwd(cwd: string, partialPath: string): { value: string; hint: string | null } | null {
  const normalizedInput = partialPath.length > 0 ? partialPath : ".";
  const basePath = normalizedInput.endsWith("/") ? normalizedInput : path.dirname(normalizedInput);
  const searchDir = path.resolve(cwd, basePath === "." ? "" : basePath);
  const needle = normalizedInput.endsWith("/") ? "" : path.basename(normalizedInput);

  let entries: Array<{ label: string; isDirectory: boolean }>;
  try {
    entries = readdirSync(searchDir, { withFileTypes: true })
      .filter((entry) => entry.name.startsWith(needle))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => ({ label: entry.name, isDirectory: entry.isDirectory() }));
  } catch {
    return null;
  }

  if (entries.length === 0) {
    return null;
  }

  const labels = entries.map((entry) => entry.label);
  const common = longestCommonPrefix(labels);
  const resolvedBase = basePath === "." ? "" : basePath.replace(/\/+$/, "");
  const prefix = resolvedBase ? `${resolvedBase}/` : "";

  if (entries.length === 1) {
    const only = entries[0];
    const completed = `${prefix}${only.label}`;
    return {
      value: only.isDirectory ? `${completed}/` : completed,
      hint: only.isDirectory ? `dir: ${completed}/` : `file: ${completed}`,
    };
  }

  if (common.length > needle.length) {
    return {
      value: `${prefix}${common}`,
      hint: `suggest: ${entries.slice(0, 4).map((entry) => `${entry.isDirectory ? "dir" : "file"} ${prefix}${entry.label}${entry.isDirectory ? "/" : ""}`).join(" · ")}`,
    };
  }

  return {
    value: partialPath,
    hint: `suggest: ${entries.slice(0, 4).map((entry) => `${entry.isDirectory ? "dir" : "file"} ${prefix}${entry.label}${entry.isDirectory ? "/" : ""}`).join(" · ")}`,
  };
}

function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) {
    return "";
  }

  let prefix = values[0] ?? "";
  for (const value of values.slice(1)) {
    let index = 0;
    while (index < prefix.length && index < value.length && prefix[index] === value[index]) {
      index += 1;
    }
    prefix = prefix.slice(0, index);
    if (prefix.length === 0) {
      break;
    }
  }
  return prefix;
}

function formatCommandPath(session: RuntimeSession, targetPath: string): string {
  const relativePath = path.relative(session.cwd, targetPath);
  if (relativePath.length === 0) {
    return ".";
  }

  return relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : targetPath;
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
    const priorRawMode = stdin.isRaw;
    const priorEncoding = stdin.readableEncoding;

    const render = () => {
      syncTuiEventBuffers(session, state);
      state.view = createRuntimeTuiView(session);
      process.stdout.write(renderRuntimeTuiState(state));
    };

    const pushActivity = (message: string) => {
      state.activity = [formatActivityLine(message), ...state.activity].slice(0, 6);
    };

    const resetHistoryNavigation = () => {
      state.promptHistoryIndex = -1;
      state.promptDraft = null;
    };

    const closeHistoryPopup = () => {
      state.historyPopupOpen = false;
      state.historyPopupIndex = 0;
    };

    const closeModelPicker = () => {
      state.modelPickerOpen = false;
      state.modelPickerIndex = 0;
    };

    const clampChatScroll = () => {
      const metrics = measureMiddleScroll(state, resolveTerminalSize());
      state.chatScrollOffset = Math.max(0, Math.min(metrics.maxScroll, state.chatScrollOffset));
      return metrics;
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
      const availableModels = getAvailableModelsForProvider(session, session.providerTransport.activeProvider);
      if (availableModels.length === 0) {
        return;
      }
      const maxIndex = availableModels.length - 1;
      state.modelPickerIndex = Math.max(0, Math.min(maxIndex, state.modelPickerIndex + (direction === -1 ? -1 : 1)));
      render();
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
      const availableModels = getAvailableModelsForProvider(session, provider);
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

      if (prompt === "/model") {
        state.promptBuffer = "";
        state.promptCursor = 0;
        resetHistoryNavigation();
        openModelPicker();
        return;
      }

      commitPromptHistory(prompt);

      const commandResult = runRuntimeCommand(session, prompt);
      if (commandResult) {
        if (prompt === "/reload") {
          state.promptBuffer = "";
          state.promptCursor = 0;
          void reloadRuntime();
          return;
        }

        if (prompt === "/quit") {
          state.promptBuffer = "";
          state.promptCursor = 0;
          recordRuntimeEvent(session, {
            kind: "command",
            status: "completed",
            summary: "quit command requested",
          });
          pushActivity("quit requested");
          render();
          finish();
          return;
        }

        state.promptBuffer = "";
        state.promptCursor = 0;
        setRuntimeAction(session, commandResult.ok ? "ready" : "error", commandResult.ok ? "command complete" : commandResult.message);
        recordRuntimeEvent(session, {
          kind: "command",
          status: commandResult.ok ? "completed" : "failed",
          summary: `command ${prompt.split(/\s+/)[0]} ${commandResult.ok ? "completed" : "failed"}`,
          detail: commandResult.ok ? commandResult.output : commandResult.message,
        });
        state.action = session.action;
        pushActivity(commandResult.activity);
        render();
        return;
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
        detail: prompt.length > 160 ? `${prompt.slice(0, 157)}...` : prompt,
      });
      setRuntimeAction(session, "running", "provider request");
      state.action = session.action;
      pushActivity("request started");
      render();

      try {
        const autoCompact = maybeCompactConversation(session, prompt);
        if (autoCompact.compacted) {
          setRuntimeAction(session, "running", `auto compact · ${autoCompact.beforeTokens} -> ${autoCompact.afterTokens}`);
          state.action = session.action;
          pushActivity(`auto compact · ${autoCompact.beforeTokens} -> ${autoCompact.afterTokens}`);
          render();
        }
        const result = await executeProviderRequest({ session, prompt });
        if (result.ok) {
          recordConversationTurn(session, "user", prompt);
          recordConversationTurn(session, "assistant", result.output);
          recordTurnTelemetry(session, prompt, result.output);
          setRuntimeAction(session, "ready", `response received · ${result.provider}`);
          state.action = session.action;
          pushActivity(`request ok · ${result.provider}`);
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
        finish();
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

      if (key === "\t") {
        const completion = autocompletePromptBuffer(session, state.promptBuffer);
        if (completion.value !== state.promptBuffer) {
          state.promptBuffer = completion.value;
          state.promptCursor = state.promptBuffer.length;
          resetHistoryNavigation();
          render();
        }
        return;
      }

      if (key === "\u007f") {
        if (state.promptCursor > 0) {
          state.promptBuffer = `${state.promptBuffer.slice(0, state.promptCursor - 1)}${state.promptBuffer.slice(state.promptCursor)}`;
          state.promptCursor -= 1;
          resetHistoryNavigation();
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
          state.modelPickerIndex = Math.max(0, state.modelPickerEntries.length - 1);
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
          closeModelPicker();
        }
        if (state.historyPopupOpen) {
          closeHistoryPopup();
        }
        state.promptBuffer = `${state.promptBuffer.slice(0, state.promptCursor)}${key}${state.promptBuffer.slice(state.promptCursor)}`;
        state.promptCursor += key.length;
        state.selectedSection = "agent";
        resetHistoryNavigation();
        render();
      }
    };

    const animationInterval = setInterval(() => {
      state.spinnerFrame += 1;
      render();
    }, 120);

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
    currentTurnActivity: [],
    latestTurnTrace: [],
    traceExpanded: false,
    promptCursor: 0,
    promptHistory: [],
    promptHistoryIndex: -1,
    promptDraft: null,
    historyPopupOpen: false,
    historyPopupIndex: 0,
    modelPickerOpen: false,
    modelPickerIndex: 0,
    modelPickerEntries: [],
    chatScrollOffset: 0,
    latestUserMessage: null,
    latestAssistantMessage: null,
  };
}

function syncTuiEventBuffers(session: RuntimeSession, state: RuntimeTuiState): void {
  const recent = session.events.slice(-8);
  state.activity = recent
    .slice()
    .reverse()
    .map((event) => formatActivityLine(`${event.kind} ${event.status} · ${event.summary}`))
    .slice(0, 6);
  state.transcript = recent.length > 0
    ? recent.flatMap((event) => formatTranscriptEvent(event))
    : ["assistant: no messages yet"];
  state.chatHistory = buildChatHistoryFromSession(session).slice(-120);
  state.currentTurnActivity = session.action.pending
    ? recent
      .filter((event) => event.kind !== "system")
      .slice(-4)
      .flatMap((event) => formatTranscriptEvent(event))
      .slice(-8)
    : [];
  const lastPromptIndex = [...session.events].map((event) => event.kind).lastIndexOf("prompt");
  const latestTurnEvents = (lastPromptIndex >= 0 ? session.events.slice(lastPromptIndex) : recent)
    .filter((event) => !["system", "prompt", "assistant"].includes(event.kind));
  state.latestTurnTrace = summarizeTurnEvents(latestTurnEvents);
  state.latestUserMessage = [...session.conversation].reverse().find((turn) => turn.role === "user")?.content ?? null;
  state.latestAssistantMessage = [...session.conversation].reverse().find((turn) => turn.role === "assistant")?.content ?? null;
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
  const progress = truncateLine(formatProgressChrome(state.spinnerFrame, state.action), contentWidth);
  const workspace = renderWorkspacePanel(state, contentWidth);
  const topPane = [
    tintLine(truncateLine(header, contentWidth), ANSI.header),
    tintLine(truncateLine("=".repeat(Math.min(header.length, contentWidth)), contentWidth), ANSI.dim),
    tintLine(summary, ANSI.dim),
    tintLine(progress, ANSI.progress),
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
  const emblem = NEXAGENT_EMBLEM_FRAMES[((spinnerTick % NEXAGENT_EMBLEM_FRAMES.length) + NEXAGENT_EMBLEM_FRAMES.length) % NEXAGENT_EMBLEM_FRAMES.length];
  const verb = selectProgressVerb(action);
  return `${emblem} ${verb} · ${action.status} · ${action.detail}`;
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

function renderAgentPanel(state: RuntimeTuiState, width: number): string[] {
  const transcript = state.transcript.length > 0 ? state.transcript : ["assistant: no messages yet"];
  const composer = renderPromptBuffer(state.promptBuffer, state.promptCursor);
  const composerHint = state.promptBuffer.length > 0 ? describePromptHint({ cwd: lookupValue(state.view.metadata, "cwd") }, state.promptBuffer) : "start typing or use slash command";
  const lines = [
    padLine("agent console", width),
    padLine("-------------", width),
    ...wrapText(`status: ${state.action.pending ? "running" : "idle"}`, width),
    ...wrapText(`runtime: ${state.action.status} · ${state.action.detail}`, width),
    ...wrapText(`last activity: ${state.action.lastActivity ?? "none"}`, width),
    ...wrapText(`panel: ${state.selectedSection} · activity: ${state.activity.length}`, width),
    ...wrapText(`turns: ${lookupMetadataValue(state.view.metadata, "turns", "0")} · tokens: ${lookupMetadataValue(state.view.metadata, "lastTokens", "in~0 out~0")}`, width),
    "",
    padLine("composer", width),
    ...wrapText(composer, width),
    ...wrapText(`hint: ${composerHint ?? "none"}`, width),
    padLine("transcript", width),
    ...transcript.flatMap((entry) => wrapText(entry, width)),
  ];

  return lines.map((line) => padLine(line, width));
}

function renderWorkspacePanel(
  state: RuntimeTuiState,
  width: number,
): { top: string[]; middle: string[]; bottom: string[] } {
  if (state.chatHistory.length === 0 && !state.action.pending) {
    return renderIdleHomePanel(state, width);
  }

  const composer = renderPromptBuffer(state.promptBuffer, state.promptCursor);
  const completion = state.promptBuffer.length > 0 ? autocompletePromptBuffer({ cwd: lookupValue(state.view.metadata, "cwd") }, state.promptBuffer) : null;
  const composerHint = state.promptBuffer.length > 0 ? describePromptHint({ cwd: lookupValue(state.view.metadata, "cwd") }, state.promptBuffer) : "start typing or use slash command";
  const suggestion = completion && completion.value !== state.promptBuffer ? completion.value : null;
  const chatLines = renderConversationTranscript(state.chatHistory, width);
  const footerStatus = buildFooterStatus(state, width);
  const fullTraceBlock = state.action.pending && state.traceExpanded
    ? [
      ...(state.latestTurnTrace.length > 0 ? renderMessageBox("trace", state.latestTurnTrace.join("\n"), width) : []),
      ...(state.currentTurnActivity.length > 0 ? ["", ...renderMessageBox("working", state.currentTurnActivity.join("\n"), width)] : []),
    ]
    : [];
  const compactTraceBlock = state.action.pending && !state.traceExpanded
    ? renderCollapsedTraceSummary(state, width)
    : [];
  const composerLines = [
    tintLine(renderRule(width), ANSI.rule),
    tintLine(footerStatus, ANSI.footer),
    tintLine(renderRule(width), ANSI.rule),
    tintLine(truncateLine(`> ${composer}`, width), ANSI.prompt),
    ...(suggestion ? wrapText(`preview ${suggestion}`, width).map((line) => tintLine(line, ANSI.preview)) : []),
    ...(!suggestion && composerHint ? wrapText(`hint ${composerHint}`, width).map((line) => tintLine(line, ANSI.dim)) : []),
  ];

  return {
    top: [],
    middle: [
      ...(state.modelPickerOpen
        ? renderModelPicker(state, width)
        : state.historyPopupOpen
          ? renderHistoryPopup(state, width)
          : chatLines),
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
  const badge = state.action.pending
    ? `${NEXAGENT_EMBLEM_FRAMES[((state.spinnerFrame % NEXAGENT_EMBLEM_FRAMES.length) + NEXAGENT_EMBLEM_FRAMES.length) % NEXAGENT_EMBLEM_FRAMES.length]} ${selectProgressVerb(state.action)}`
    : "◆ ready";
  const trace = state.latestTurnTrace.length > 0 || state.currentTurnActivity.length > 0
    ? ` │ trace ${state.traceExpanded ? "open" : "closed"}`
    : "";
  const scroll = formatScrollState(state, width);
  const scrollPart = scroll ? ` │ ${scroll}` : "";
  return truncateLine(`${badge} │ ${model} │ ${provider} │ turns ${turns} │ ${tokens}${trace}${scrollPart} │ ${cwd}`, width);
}

function formatScrollState(state: RuntimeTuiState, width: number): string {
  if (state.chatHistory.length === 0 && state.latestTurnTrace.length === 0 && state.currentTurnActivity.length === 0) {
    return "";
  }
  const middle = [
    ...renderConversationTranscript(state.chatHistory, width),
    ...(state.action.pending && !state.traceExpanded ? renderCollapsedTraceSummary(state, width) : []),
    ...(state.action.pending && state.traceExpanded
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
  const completion = state.promptBuffer.length > 0 ? autocompletePromptBuffer({ cwd }, state.promptBuffer) : null;
  const composerHint = state.promptBuffer.length > 0 ? describePromptHint({ cwd }, state.promptBuffer) : "start typing or use slash command";
  const suggestion = completion && completion.value !== state.promptBuffer ? completion.value : null;
  const promptBlock = [
    tintLine("prompt", ANSI.agent),
    tintLine(truncateLine(`> ${composer}`, width), ANSI.prompt),
    ...(suggestion
      ? wrapText(`preview ${suggestion}`, width).map((line) => tintLine(line, ANSI.preview))
      : wrapText(`hint ${composerHint}`, width).map((line) => tintLine(line, ANSI.dim))),
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
  return [
    truncateLine(`╭${titleText}${horizontal}╮`, width),
    ...lines.map((line) => truncateLine(`│ ${padLine(line, innerWidth)} │`, width)),
    truncateLine(`╰${"─".repeat(innerWidth + 2)}╯`, width),
  ];
}

function renderPromptBuffer(buffer: string, cursor: number): string {
  const boundedCursor = Math.max(0, Math.min(cursor, buffer.length));
  const before = buffer.slice(0, boundedCursor);
  const after = buffer.slice(boundedCursor);
  return `${before}▌${after}`;
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
  const entries = state.modelPickerEntries;
  if (entries.length === 0) {
    return renderMessageBox("model picker", "no catalog for current provider", Math.min(width, 96));
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
    `${provider} models · ${state.modelPickerIndex + 1}/${entries.length} · Enter apply · Esc close\n\n${lines.join("\n")}`,
    boxWidth,
  );
}

function renderCollapsedTraceSummary(state: RuntimeTuiState, width: number): string[] {
  const lines: string[] = [`▸ trace · Ctrl+T expand`];
  if (state.latestTurnTrace.length > 0) {
    lines.push(...state.latestTurnTrace.map((line) => `  ${line}`));
  }
  const toolLine = state.currentTurnActivity.find((line) => line.startsWith("tool:"));
  if (toolLine) {
    lines.push(`  ${toolLine}`);
  }
  const providerLine = state.currentTurnActivity.find((line) => line.startsWith("provider:"));
  if (providerLine) {
    lines.push(`  ${providerLine}`);
  }
  return renderMessageBox("trace", lines.join("\n"), width);
}

function renderConversationTranscript(lines: string[], width: number): string[] {
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
  const boxWidth = title === "agent" ? Math.min(width, 104) : width;
  const innerWidth = Math.max(12, boxWidth - 4);
  const style = title === "agent" ? ANSI.agent : title === "trace" ? ANSI.trace : ANSI.working;
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
    ...bodyLines.map((line) => tintLine(`│ ${padLine(line, innerWidth)} │`, style)),
    bottom,
  ];
}

function normalizeAgentReply(value: string): string {
  return value
    .split("\n")
    .filter((line) => !/^```[\w-]*\s*$/.test(line.trim()))
    .map((line) => line
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^#{1,6}\s+/, "")
      .replace(/^>\s?/, ""))
    .join("\n")
    .trim();
}

export function summarizeTurnEvents(events: RuntimeSession["events"]): string[] {
  if (events.length === 0) {
    return [];
  }

  const toolStarted = events.filter((event) => event.kind === "tool" && event.status === "started");
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
  const toolNames = [...new Set(toolStarted
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
  } else if (toolStarted.length > 0) {
    lines.push(`  ↳ tool calls (${toolStarted.length})`);
  }
  if (waitingApproval) {
    lines.push("  ↳ waiting approval");
  }
  if (toolFailed.length > 0 || providerFailed || blocked) {
    lines.push("  ↳ hit issue");
  }

  return lines;
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

function wrapText(value: string, width: number): string[] {
  if (value.length === 0) {
    return [""];
  }

  const chunks: string[] = [];
  let remaining = value;

  while (remaining.length > width) {
    const breakIndex = remaining.lastIndexOf(" ", width);
    const splitAt = breakIndex > Math.floor(width / 2) ? breakIndex : width;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  chunks.push(remaining);
  return chunks;
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

function renderScreen(lines: string[]): string {
  return `\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[?25l\x1b[2J\x1b[H${lines.join("\n")}\n`;
}

function renderRule(width: number): string {
  return "─".repeat(Math.max(8, width));
}

const ANSI = {
  reset: "\x1b[0m",
  none: "",
  header: "\x1b[1;97m",
  dim: "\x1b[2;37m",
  rule: "\x1b[38;5;180m",
  progress: "\x1b[38;5;186m",
  footer: "\x1b[38;5;151m",
  prompt: "\x1b[1;96m",
  preview: "\x1b[38;5;223m",
  user: "\x1b[1;97m",
  agent: "\x1b[38;5;220m",
  trace: "\x1b[38;5;111m",
  working: "\x1b[38;5;149m",
} as const;

function tintLine(value: string, ansi: string): string {
  if (!ansi || value.length === 0) {
    return value;
  }
  return `${ansi}${value}${ANSI.reset}`;
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
  process.stdout.write("\x1b[?25h\x1b[?1006l\x1b[?1000l\x1b[?1049l");
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

function padLine(value: string, width: number): string {
  return truncateLine(value, width).padEnd(width, " ");
}

function padVisibleLine(value: string, width: number): string {
  const visible = stripAnsi(value);
  if (visible.length >= width) {
    return value;
  }
  return `${value}${" ".repeat(width - visible.length)}`;
}

function truncateLine(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }

  if (width <= 1) {
    return value.slice(0, width);
  }

  return `${value.slice(0, width - 1)}…`;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
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
