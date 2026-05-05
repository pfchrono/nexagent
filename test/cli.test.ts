import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { RuntimeTuiView } from "../src/cli.js";
import { createDefaultProviderRegistry } from "../src/provider/registry.js";
import type { RuntimeSession } from "../src/runtime/session.js";

test("cli module import does not start the runtime", async () => {
  const writes: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    writes.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    const module = await import("../src/cli.js");
    assert.equal(typeof module.renderRuntimeTui, "function");
    assert.deepEqual(writes, []);
  } finally {
    process.stdout.write = originalWrite;
  }
});

test("renderRuntimeTui formats runtime state", async () => {
  const { renderRuntimeTui } = await import("../src/cli.js");
  const view: RuntimeTuiView = {
    title: "nexagent",
    statusline: null,
    metadata: [["session", "abc"], ["provider", "codex"], ["cwd", "/repo"]],
    routing: [
      ["activeProvider", "codex"],
      ["transport", "codex; adapter=codex-cli-exec; mode=cli-exec; endpoint=default; auth=codex-login/ready; silent-fallback=false"],
      ["adapter", "codex-cli-exec"],
      ["mode", "cli-exec"],
      ["authSource", "codex-login"],
      ["authGate", "ready"],
      ["fallback", "require-open-spec; silent-switch=false"],
      ["models", "codex=gpt-5.4"],
    ],
    auth: [
      ["provider", "codex"],
      ["available", "true"],
      ["loggedIn", "true"],
      ["method", "ChatGPT"],
      ["status", "Logged in using ChatGPT"],
      ["checkedAt", "2025-01-01T00:00:00.000Z"],
    ],
    instructions: [["count", "0"], ["repoBehavior", "none"], ["taskContext", "none"]],
    mcp: [["enabled", "none"], ["loaded", "context7"]],
    hooks: [["status", "none"], ["source", "none"], ["events", "none"], ["commands", "0"], ["invalid", "none"]],
    imports: [["claude", "disabled"]],
    archivist: [["enabled", "false"], ["boundary", "disabled"], ["storage", "disabled"], ["persisted", "false"], ["retrieval", "idle"], ["retrievalPreview", "none"], ["writes", "idle"], ["writePreview", "none"]],
  };

  const output = renderRuntimeTui(view, { columns: 80, rows: 36 });

  assert.match(output, /^\u001b\[\?1049h\u001b\[\?25l\u001b\[H/);
  assert.match(output, /nexagent :: agent tui/);
  assert.match(output, /provider codex \| session abc/);
  assert.match(output, /◜◆◝ │ gpt-5\.4@codex/);
  assert.match(output, /╭ home/);
  assert.match(output, /Welcome back\./);
  assert.match(output, /Recent activity/);
  assert.match(output, /Quick start/);
  assert.match(output, /\/status/);
  assert.match(output, /\/provider/);
});

test("renderRuntimeTui keeps composer body free of side rails", async () => {
  const { renderRuntimeTui } = await import("../src/cli.js");
  const view: RuntimeTuiView = {
    title: "nexagent",
    statusline: "codex | ready",
    metadata: [["session", "abc"], ["provider", "codex"], ["cwd", "/repo"], ["turns", "1"]],
    routing: [["models", "codex=gpt-5.4"]],
    auth: [],
    instructions: [],
    mcp: [],
    hooks: [],
    imports: [],
    archivist: [],
  };

  const output = renderRuntimeTui(view, { columns: 120, rows: 36 });
  const plain = output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");

  assert.match(plain, /prompt/);
  assert.match(plain, /\n  > ▌/);
  assert.doesNotMatch(plain, /│ > ▌/);
});

test("renderRuntimeTui shows active turn metadata in footer", async () => {
  const { renderRuntimeTui } = await import("../src/cli.js");
  const view: RuntimeTuiView = {
    title: "nexagent",
    statusline: null,
    metadata: [["session", "abc"], ["provider", "codex"], ["cwd", "/repo"], ["status", "running"], ["detail", "provider request"], ["lastActivity", "2026-04-28T07:20:00Z"], ["lastTokens", "in~10 out~4"]],
    routing: [["mode", "cli-exec"], ["models", "codex=gpt-5.4"]],
    auth: [],
    instructions: [],
    mcp: [],
    hooks: [],
    imports: [],
    archivist: [],
  };

  const output = renderRuntimeTui(view, { columns: 100, rows: 40 });
  const plain = output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");

  assert.match(plain, /Thinking │ gpt-5\.4@codex │ turns 0 │ in~10 out~4/);
});

test("renderRuntimeTui shows warning lane without pinned cockpit panels", async () => {
  const { renderRuntimeTui } = await import("../src/cli.js");
  const view: RuntimeTuiView = {
    title: "nexagent",
    statusline: null,
    metadata: [["session", "abc"], ["provider", "codex"], ["cwd", "/repo"], ["status", "error"], ["detail", "provider failed"], ["lastActivity", "2026-04-28T07:30:00Z"], ["lastTokens", "in~12 out~0"], ["toolPolicy", "repo-local-guarded"]],
    routing: [["mode", "cli-exec"], ["models", "codex=gpt-5.4"], ["capabilities", "tools+text"], ["authGate", "ready"]],
    auth: [],
    instructions: [],
    mcp: [],
    hooks: [],
    imports: [],
    archivist: [],
  };

  const output = renderRuntimeTui(view, { columns: 120, rows: 40 });
  const plain = output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, "");

  assert.match(plain, /warning lane/);
  assert.doesNotMatch(plain, /diff summary/);
  assert.doesNotMatch(plain, /risk high · confidence blocked/);
  assert.doesNotMatch(plain, /outcome: failed/);
  assert.doesNotMatch(plain, /actions: \[retry \/continue\]/);
  assert.doesNotMatch(plain, /terminal capabilities/);
});

test("parseCommand preserves empty run prompt for resolvePrompt", async () => {
  const { parseCommand } = await import("../src/cli.js");
  const debug = { enabled: false, verbose: false, debugFile: null };

  assert.deepEqual(parseCommand([]), { kind: "inspect", yolo: false, debug });
  assert.deepEqual(parseCommand(["--help"]), { kind: "help" });
  assert.deepEqual(parseCommand(["-h"]), { kind: "help" });
  assert.deepEqual(parseCommand(["help"]), { kind: "help" });
  assert.deepEqual(parseCommand(["run", "say", "hi"]), { kind: "run", prompt: "say hi", yolo: false, debug });
  assert.deepEqual(parseCommand(["run"]), { kind: "run", prompt: null, yolo: false, debug });
  assert.deepEqual(parseCommand(["--yolo"]), { kind: "inspect", yolo: true, debug });
  assert.deepEqual(parseCommand(["--opentui"]), { kind: "inspect", yolo: false, debug });
  assert.deepEqual(parseCommand(["--yolo", "run", "say", "hi"]), { kind: "run", prompt: "say hi", yolo: true, debug });
  assert.deepEqual(parseCommand(["run", "--yolo", "say", "hi"]), { kind: "run", prompt: "say hi", yolo: true, debug });
  assert.deepEqual(parseCommand(["--debug", "--verbose", "--debugfile", "trace.log", "run", "say", "hi"]), {
    kind: "run",
    prompt: "say hi",
    yolo: false,
    debug: { enabled: true, verbose: true, debugFile: "trace.log" },
  });
});

test("formatLaunchHelp documents launch switches", async () => {
  const { LAUNCH_SWITCHES, formatLaunchHelp } = await import("../src/cli.js");
  const output = formatLaunchHelp();

  assert.match(output, /Usage:/);
  for (const entry of LAUNCH_SWITCHES) {
    assert.match(output, new RegExp(`${entry.flag.replace("-", "\\-")}.*${entry.description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    if ("alias" in entry) {
      assert.match(output, new RegExp(entry.alias.replace("-", "\\-")));
    }
  }
  assert.match(output, /nexagent run/);
  assert.doesNotMatch(output, /--opentui/);
  assert.doesNotMatch(output, /--classic-tui|--legacy-tui/);
  assert.match(output, /\/help - show available runtime commands/);
  assert.match(output, /\/keys - show OpenTUI keyboard shortcuts and interaction modes/);
});

test("default interactive launch uses OpenTUI without legacy fallback switch", async () => {
  const source = await readFile(new URL("../src/cli.ts", import.meta.url), "utf8");

  assert.match(source, /import\("\.\/opentui\/entry\.js"\)/);
  assert.match(source, /await runOpenTuiRuntime\(session\)/);
  assert.doesNotMatch(source, /await runRuntimeTui\(session\)/);
  assert.doesNotMatch(source, /flag: "--opentui"/);
  assert.doesNotMatch(source, /--classic-tui|--legacy-tui/);
});

test("debug log paths stay under home or temp roots", async () => {
  const { RuntimeConfigurationError, resolveDebugLogPath } = await import("../src/runtime/debug.js");

  assert.match(resolveDebugLogPath(null, new Date("2026-04-30T12:00:00.000Z")), /\/tmp\/nexagent-debug-2026-04-30T12-00-00-000Z\.log$/);
  assert.match(resolveDebugLogPath("custom.log"), /\/\.nexagent\/debug\/custom\.log$/);
  assert.throws(() => resolveDebugLogPath("/etc/nexagent.log"), RuntimeConfigurationError);
  assert.throws(() => resolveDebugLogPath("custom.txt"), RuntimeConfigurationError);
});

test("applyYoloMode is session scoped and leaves persisted defaults intact", async () => {
  const { applyYoloMode } = await import("../src/runtime/session.js");
  const session = createSession();
  session.operationDefaults.requireApprovalForGuarded = true;
  session.operationControls.requireApprovalForGuarded = true;

  applyYoloMode(session);

  assert.equal(session.operationControls.yoloMode, true);
  assert.equal(session.operationControls.requireApprovalForGuarded, false);
  assert.equal(session.operationDefaults.requireApprovalForGuarded, true);
});

test("formatProgressChrome shows verb only while running", async () => {
  const { formatProgressChrome } = await import("../src/cli.js");

  assert.equal(
    formatProgressChrome(0, { status: "ready", detail: "runtime baseline" }),
    "◜◆◝",
  );
  assert.equal(
    formatProgressChrome(5, { status: "running", detail: "provider request" }),
    "◠◆◡ Thinking · running · provider request",
  );
  assert.equal(
    formatProgressChrome(6, { status: "running", detail: "provider request" }),
    "◟◆◞ Thinking · running · provider request",
  );
});

test("buildPacedReplyFrames reveals assistant reply monotonically", async () => {
  const { buildPacedReplyFrames } = await import("../src/cli.js");

  const frames = buildPacedReplyFrames("hello streaming reply", 4);

  assert.equal(frames.length, 4);
  assert.equal(frames.at(-1), "hello streaming reply");
  for (let index = 1; index < frames.length; index += 1) {
    assert.ok(frames[index].startsWith(frames[index - 1]));
  }
});

test("package dev script uses Bun for OpenTUI asset imports", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.dev, "bun run src/cli.ts");
});

test("package compile script routes platform targets through compile helper", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.scripts?.compile, "bun run scripts/compile.ts");
  assert.equal(packageJson.scripts?.["compile:linux"], "bun run scripts/compile.ts linux");
  assert.equal(packageJson.scripts?.["compile:dev:linux"], "bun run scripts/compile.ts dev:linux");
  assert.equal(packageJson.scripts?.["compile:linux:dev"], "bun run scripts/compile.ts linux:dev");
});

function createSession(provider = "codex"): RuntimeSession {
  return {
    id: "session_test",
    startedAt: "2025-01-01T00:00:00.000Z",
    product: "nexagent",
    provider,
    providerRegistry: createDefaultProviderRegistry(),
    providerRouting: {
      fallback: {
        policy: "require-open-spec",
        silentProviderSwitch: false,
      },
      modelSelection: {
        activeProvider: provider,
        configuredModels: {
          codex: "gpt-5.4",
          anthropic: "claude-sonnet-4-6",
        },
      },
      transport: {},
    },
    providerTransport: {
      executor: "codex",
      adapter: "codex-cli-exec",
      mode: "cli-exec",
      authSource: "codex-login",
      authGate: "ready",
      activeProvider: provider,
      openaiBaseUrl: null,
      silentFallback: false,
    },
    commandModes: {
      cavemanMode: false,
      deadpoolMode: false,
      statusline: false,
    },
    operationDefaults: {
      requireApprovalForGuarded: false,
    },
    cwd: "/repo",
    repo: {
      root: "/repo",
      name: "repo",
      vcs: "git",
      branch: "main",
      freshness: {
        status: "up-to-date",
        tracking: "origin/main",
        ahead: 0,
        behind: 0,
        dirty: false,
        needsPull: false,
        checkedAt: "2025-01-01T00:00:00.000Z",
      },
    },
    toolPolicy: {
      mode: "repo-local-guarded",
      allowedRoots: ["/repo"],
      protectedRoots: ["/etc", "/home/pfchrono/.ssh"],
      shell: "limited",
      writes: "guarded",
      deletes: "blocked",
    },
    mcpServers: [],
    enabledMcpServers: [],
    imports: { claude: null },
    hooks: {
      sourcePath: null,
      status: "none",
      events: [],
      commandCount: 0,
      invalidEntries: [],
    },
    auth: {
      provider: "codex",
      available: true,
      loggedIn: true,
      method: "ChatGPT",
      status: "Logged in using ChatGPT",
      checkedAt: "2025-01-01T00:00:00.000Z",
    },
    instructionSources: [
      {
        kind: "AGENTS.md",
        path: "/repo/AGENTS.md",
        layer: "repoBehavior",
        summary: "AGENTS.md: # Repo Guardrails",
      },
      {
        kind: "openspec",
        path: "/repo/openspec",
        layer: "taskContext",
        summary: "openspec includes changes, SPEC.md",
      },
    ],
    archivist: {
      enabled: false,
      boundary: "disabled",
      storagePath: null,
      storageExists: false,
      retrieval: {
        used: false,
        sourceCategory: null,
        matchCount: 0,
        preview: null,
      },
      writes: {
        used: false,
        action: null,
        sourceCategory: null,
        savedAt: null,
        entryCount: 0,
        preview: null,
      },
    },
    lsp: {
      enabled: false,
      command: null,
      args: [],
      indexArchivist: false,
    },
    ui: {
      logoMode: "full",
    },
    action: {
      status: "ready",
      detail: "runtime baseline",
      pending: false,
      lastActivity: null,
    },
    telemetry: {
      turnCount: 0,
      lastInputTokens: 0,
      lastOutputTokens: 0,
    },
    events: [],
    operationControls: {
      requireApprovalForGuarded: false,
      yoloMode: false,
      pendingApproval: null,
      pendingQuestionnaire: null,
      lastDecision: null,
      cancelRequested: false,
      activeAbortController: null,
      steerMessage: null,
      steerState: null,
      lastAppliedSteer: null,
      steerHistory: [],
      lastShellBlocker: null,
      boomerang: {
        active: false,
        task: null,
        startConversationIndex: 0,
        startEventIndex: 0,
        lastSummary: null,
      },
    },
    btw: {
      visible: false,
      mode: "contextual",
      thread: [],
      pending: null,
      nextId: 1,
      modelOverride: null,
      thinkingOverride: null,
      updatedAt: null,
    },
    todos: {
      tasks: [],
      nextId: 1,
      updatedAt: null,
    },
    toolMemory: {
      entries: [],
      nextId: 1,
      updatedAt: null,
    },
    subagents: {
      agents: [],
      types: [
        { name: "general-purpose", description: "General-purpose autonomous agent", prompt: "general", tools: "all", source: "default" },
        { name: "Explore", description: "Fast read-only codebase exploration", prompt: "explore", tools: "read", source: "default" },
      ],
      nextId: 1,
      updatedAt: null,
    },
    goal: {
      goal: null,
      statusBarEnabled: true,
      activeTurnStartedAt: null,
      updatedAt: null,
    },
    conversation: [],
    compaction: {
      thresholdPercent: 0.5,
      modelThresholdOverrides: {},
      queuedUserMessage: null,
      summary: null,
      snapshot: null,
      status: "idle",
      lastTrigger: null,
      lastCompactedAt: null,
      compactCount: 0,
      normalTurnSteering: "boundary-only",
      compactTurnSteering: "blocked",
    },
  };
}

test("runRuntimeCommand reports provider status", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const result = runRuntimeCommand(createSession(), "/provider");

  assert.equal(result?.ok, true);
  assert.equal(result?.activity, "provider status · codex");
  assert.match(result?.output ?? "", /^provider$/m);
  assert.match(result?.output ?? "", /^provider: codex$/m);
  assert.match(result?.output ?? "", /^model: gpt-5.4$/m);
  assert.match(result?.output ?? "", /^transport: cli-exec$/m);
  assert.match(result?.output ?? "", /^active: codex$/m);
  assert.match(result?.output ?? "", /^caveats: /m);
});

test("runRuntimeCommand switches active provider", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();

  const result = runRuntimeCommand(session, "/provider anthropic");

  assert.equal(result?.ok, true);
  assert.equal(result?.activity, "provider set · anthropic");
  assert.match(result?.output ?? "", /^provider$/m);
  assert.match(result?.output ?? "", /^provider: anthropic$/m);
  assert.match(result?.output ?? "", /^model: claude-sonnet-4-6$/m);
  assert.equal(session.provider, "anthropic");
  assert.equal(session.providerRouting.modelSelection.activeProvider, "anthropic");
  assert.equal(session.providerTransport.activeProvider, "anthropic");
});

test("runRuntimeCommand rejects unknown providers", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const result = runRuntimeCommand(createSession(), "/provider openai");

  assert.deepEqual(result, {
    ok: false,
    message: "provider openai is not configured in this session",
    activity: "provider rejected · openai",
  });
});

test("runRuntimeCommand exposes command catalog through help", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const result = runRuntimeCommand(createSession(), "/help");

  assert.equal(result?.ok, true);
  const outputLines = result?.output?.split("\n") ?? [];
  const required = [
    "/help - show available runtime commands",
    "/keys - show OpenTUI keyboard shortcuts and interaction modes",
    "/reload - reload runtime state from repo config",
    "/quit - exit interactive TTY session",
    "/provider [status|name|transport ...] [--verbose] - show or switch provider and transport mode",
    "/skill [name] [args...] - list skills or resolve and route a skill by name",
    "/boomerang <task> | /boomerang status | /boomerang cancel - run autonomous task then compact turn into handoff summary",
    "/btw [--save] <question> | /btw:new [question] | /btw:tangent [--save] <question> | /btw:clear | /btw:inject [instructions] | /btw:summarize [instructions] - run hidden side conversation and optionally inject it back",
    "/agents - show Claude-style subagent types, running agents, and recent results",
    "/mouse [status|mode <auto|scroll|select>] - show or set transcript mouse interaction mode",
    "/usage - show current session usage statistics with provider/model token totals",
    "/todos [pending|in_progress|completed|all|clear] - show or clear visual task checklist used by model planning",
    "/config [status] | /config [set] <logo|lsp|lsp-index> <value> - inspect or mutate persisted runtime configuration",
    "/lsp [status|setup|health|warm|mode <on|off>|symbols <path>|diagnostics <path>|check [path]|nav <operation> [path] [line] [character]] - inspect enabled local LSP code intelligence with bounded fallback",
    "/memory [status|--verbose|--maintenance|save <text>|checkpoint [reason]|session [focus]] - inspect, maintain, or persist archivist memory/checkpoints",
    "/attach <image-path> - attach local image for next prompt (http transports only)",
    "/detach - clear queued image attachment",
    "!<command> - run guarded shell command and add output to transcript",
  ];
  for (const line of required) {
    assert.ok(outputLines.includes(line), `${line} missing`);
  }
  assert.equal(result?.activity, "help");
});

test("runRuntimeCommand exposes OpenTUI keymap help", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const result = runRuntimeCommand(createSession(), "/keys");

  assert.equal(result?.ok, true);
  assert.match(result?.ok ? result.output : "", /Composer/);
  assert.match(result?.ok ? result.output : "", /Ctrl\+T - toggle trace/);
  assert.equal(result?.activity, "keys");
});

test("runRuntimeCommand queues BTW side thread and injects it", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const { completeBtwTurn } = await import("../src/runtime/btw.js");
  const session = createSession();

  const help = runRuntimeCommand(session, "/btw --help");
  assert.equal(help?.ok, true);
  assert.match(help?.ok ? help.output : "", /usage: \/btw \[--save\] <question>/);
  assert.notEqual(help?.ok ? help.autoInvokeAfterSkill : false, true);
  assert.equal(session.btw.pending, null);

  const queued = runRuntimeCommand(session, "/btw --save what did we learn?");
  assert.equal(queued?.ok, true);
  assert.equal(queued?.ok ? queued.autoInvokeAfterSkill : false, true);
  assert.match(queued?.ok ? queued.invokePrompt ?? "" : "", /Side question:\nwhat did we learn\?/);
  assert.equal(session.btw.pending?.save, true);

  const captured = completeBtwTurn(session, "We learned the side thread is hidden.");
  assert.equal(captured?.saved, true);
  assert.equal(session.btw.thread.length, 1);

  const injected = runRuntimeCommand(session, "/btw:inject use this");
  assert.equal(injected?.ok, true);
  assert.equal(injected?.ok ? injected.autoInvokeAfterSkill : false, true);
  assert.match(injected?.ok ? injected.invokePrompt ?? "" : "", /Use this side conversation thread/);
  assert.match(injected?.ok ? injected.invokePrompt ?? "" : "", /We learned the side thread is hidden/);
  assert.equal(session.btw.thread.length, 0);
});

test("runRuntimeCommand reports subagent status", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();
  session.subagents.agents.push({
    id: "agent-1",
    type: "Explore",
    description: "Inspect files",
    prompt: "Inspect files",
    status: "completed",
    background: true,
    inheritContext: false,
    result: "Found package.json.",
    error: null,
    steerMessages: [],
    createdAt: "2026-05-04T00:00:00.000Z",
    startedAt: "2026-05-04T00:00:00.000Z",
    completedAt: "2026-05-04T00:00:01.000Z",
    inputTokens: 12,
    outputTokens: 4,
  });

  const result = runRuntimeCommand(session, "/agents");

  assert.equal(result?.ok, true);
  assert.equal(result?.activity, "agents status");
  assert.match(result?.output ?? "", /^subagents$/m);
  assert.match(result?.output ?? "", /agent-1 completed Explore: Inspect files/);
});

test("runRuntimeCommand reports visual todos", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();
  session.todos.tasks.push({
    id: "todo-1",
    subject: "Inspect donor",
    activeForm: "Inspecting donor",
    status: "in_progress",
    blockedBy: [],
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z",
  });

  const result = runRuntimeCommand(session, "/todos");

  assert.equal(result?.ok, true);
  assert.equal(result?.activity, "todos");
  assert.match(result?.output ?? "", /^todos$/m);
  assert.match(result?.output ?? "", /\[>\] todo-1 Inspecting donor/);
});

test("runRuntimeCommand clears visual todos", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();
  session.todos.tasks.push({
    id: "todo-1",
    subject: "Inspect donor",
    status: "in_progress",
    blockedBy: [],
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z",
  });

  const result = runRuntimeCommand(session, "/todos clear");

  assert.equal(result?.ok, true);
  assert.equal(result?.output, "todos cleared");
  assert.deepEqual(session.todos.tasks, []);
});

test("runRuntimeCommand manages persistent goal lifecycle", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();

  const started = runRuntimeCommand(session, "/goal --tokens 1k finish migration with tests");
  assert.equal(started?.ok, true);
  assert.equal(started?.ok ? started.autoInvokeAfterSkill : false, true);
  assert.match(started?.ok ? started.invokePrompt ?? "" : "", /Continue working toward the active thread goal/);
  assert.match(started?.ok ? started.output : "", /status: active/);
  assert.match(started?.ok ? started.output : "", /1K/);

  const paused = runRuntimeCommand(session, "/goal pause");
  assert.equal(paused?.ok, true);
  assert.match(paused?.ok ? paused.output : "", /status: paused/);

  const resumed = runRuntimeCommand(session, "/goal resume");
  assert.equal(resumed?.ok, true);
  assert.equal(resumed?.ok ? resumed.autoInvokeAfterSkill : false, true);
  assert.match(resumed?.ok ? resumed.invokePrompt ?? "" : "", /finish migration with tests/);

  const hidden = runRuntimeCommand(session, "/goal statusbar off");
  assert.equal(hidden?.ok, true);
  assert.match(hidden?.ok ? hidden.output : "", /statusbar: off/);

  const cleared = runRuntimeCommand(session, "/goal clear");
  assert.equal(cleared?.ok, true);
  assert.match(cleared?.ok ? cleared.output : "", /goal cleared/);
});

test("runRuntimeCommand reports current session usage", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();
  session.telemetry.turnCount = 1;
  session.conversation = [
    { role: "user", content: "inspect usage", tokens: 2 },
    { role: "assistant", content: "usage checked", tokens: 3 },
  ];
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "inspect usage" },
    { at: "2025-01-01T00:00:02.000Z", kind: "assistant", status: "completed", summary: "assistant response completed", detail: "usage checked" },
    { at: "2025-01-01T00:00:03.000Z", kind: "control", status: "completed", summary: "turn run completed", detail: "duration=1.00s; turn_in~1200; turn_out~34" },
  ];

  const result = runRuntimeCommand(session, "/usage");

  assert.equal(result?.ok, true);
  assert.equal(result?.activity, "usage");
  assert.match(result?.output ?? "", /^usage$/m);
  assert.match(result?.output ?? "", /current session · 3s · sessions 1 · messages 1 · tokens 1,234 · cost n\/a/);
  assert.match(result?.output ?? "", /codex \/ gpt-5\.4/);
  assert.match(result?.output ?? "", /100% share · 1,234 tokens/);
  assert.match(result?.output ?? "", /in 1,200 · out 34 · cache 0 · msgs 1 · cost n\/a/);
  assert.match(result?.output ?? "", /notes: local telemetry only; bars show token share, not provider quota/);
});

test("recordTurnTelemetry writes Pi-compatible usage JSONL consumed by /usage", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const { recordRuntimeEvent, recordTurnTelemetry } = await import("../src/runtime/session.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-usage-jsonl-"));
  const previousPiDir = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.PI_CODING_AGENT_DIR = path.join(cwd, "pi-agent");
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.id = "usage-session";
    recordRuntimeEvent(session, { kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "inspect usage" });
    recordRuntimeEvent(session, { kind: "control", status: "completed", summary: "turn run completed", detail: "duration=1.00s; turn_in~123; turn_out~45" });
    recordTurnTelemetry(session, "inspect usage", "usage checked");

    const usagePath = path.join(cwd, ".nexagent", "usage", "sessions", "usage-session.jsonl");
    const jsonl = await readFile(usagePath, "utf8");
    const result = runRuntimeCommand(session, "/usage");

    assert.match(jsonl, /"type":"session"/);
    assert.match(jsonl, /"type":"message"/);
    assert.match(jsonl, /"provider":"codex"/);
    assert.match(jsonl, /"input":123/);
    assert.match(result?.output ?? "", /all time · Pi-compatible JSONL · sessions 1 · messages 1 · tokens 168 · cost n\/a/);
    assert.match(result?.output ?? "", /codex \/ gpt-5\.4/);
    assert.match(result?.output ?? "", /100% share · 168 tokens/);
    assert.match(result?.output ?? "", /in 123 · out 45 · cache 0 · msgs 1 · cost n\/a/);
  } finally {
    if (previousPiDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousPiDir;
    }
    await rm(cwd, { recursive: true, force: true });
  }
});

test("recordTurnTelemetry honors NEXAGENT_SESSION_DIR for isolated usage sessions", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const { recordRuntimeEvent, recordTurnTelemetry } = await import("../src/runtime/session.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-session-dir-cwd-"));
  const sessionDir = await mkdtemp(path.join(tmpdir(), "nexagent-session-dir-"));
  const previousSessionDir = process.env.NEXAGENT_SESSION_DIR;
  const previousPiDir = process.env.PI_CODING_AGENT_DIR;
  try {
    process.env.NEXAGENT_SESSION_DIR = sessionDir;
    process.env.PI_CODING_AGENT_DIR = path.join(cwd, "pi-agent");
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.id = "isolated-session";
    recordRuntimeEvent(session, { kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "inspect usage" });
    recordRuntimeEvent(session, { kind: "control", status: "completed", summary: "turn run completed", detail: "duration=1.00s; turn_in~7; turn_out~11" });
    recordTurnTelemetry(session, "inspect usage", "usage checked");

    const usagePath = path.join(sessionDir, "isolated-session.jsonl");
    const jsonl = await readFile(usagePath, "utf8");
    const result = runRuntimeCommand(session, "/usage");

    assert.match(jsonl, /"type":"session"/);
    assert.match(jsonl, /"input":7/);
    assert.match(result?.output ?? "", /all time · Pi-compatible JSONL · sessions 1 · messages 1 · tokens 18 · cost n\/a/);
  } finally {
    if (previousSessionDir === undefined) {
      delete process.env.NEXAGENT_SESSION_DIR;
    } else {
      process.env.NEXAGENT_SESSION_DIR = previousSessionDir;
    }
    if (previousPiDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previousPiDir;
    }
    await rm(cwd, { recursive: true, force: true });
    await rm(sessionDir, { recursive: true, force: true });
  }
});

test("runRuntimeCommand queues boomerang autonomous task", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();

  const result = runRuntimeCommand(session, "/boomerang improve diagnostics");

  assert.equal(result?.ok, true);
  assert.equal(result?.autoInvokeAfterSkill, true);
  assert.match(result?.invokePrompt ?? "", /BOOMERANG MODE ACTIVE/);
  assert.match(result?.invokePrompt ?? "", /Task:\nimprove diagnostics/);
  assert.equal(result?.transcriptPrompt, "/boomerang improve diagnostics");
  assert.equal(result?.promptSummary, "boomerang task accepted");
  assert.equal(session.operationControls.boomerang.active, true);
  assert.equal(session.operationControls.boomerang.task, "improve diagnostics");

  const status = runRuntimeCommand(session, "/boomerang status");
  assert.equal(status?.ok, true);
  assert.match(status?.output ?? "", /active: true/);
});

test("boomerang completion compacts turn and seeds archivist memory", async () => {
  const { beginBoomerang, completeBoomerang } = await import("../src/runtime/boomerang.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-boomerang-"));
  const session = createSession();
  session.cwd = cwd;
  session.repo.root = cwd;
  session.archivist.enabled = true;
  session.archivist.storagePath = path.join(cwd, ".nexagent", "archivist.json");

  try {
    beginBoomerang(session, "fix parser");
    session.events.push(
      {
        at: "2025-01-01T00:00:00.000Z",
        kind: "tool",
        status: "completed",
        summary: "tool read_file completed",
        detail: "read-only; args={\"path\":\"src/parser.ts\"}; duration=0.01s",
      },
      {
        at: "2025-01-01T00:00:01.000Z",
        kind: "tool",
        status: "completed",
        summary: "tool apply_patch completed",
        detail: "guarded; args={\"path\":\"src/parser.ts\"}; duration=0.02s",
      },
      {
        at: "2025-01-01T00:00:02.000Z",
        kind: "tool",
        status: "failed",
        summary: "tool shell_command failed",
        detail: "guarded; duration=0.13s; in~211; out~1718; output=shell exit 1 --- init summary --- Traceback (most recent call last): File \"<stdin>\", line 1",
      },
      {
        at: "2025-01-01T00:00:03.000Z",
        kind: "tool",
        status: "failed",
        summary: "tool shell_command failed",
        detail: "guarded; duration=0.02s; in~44; out~20; output=shell policy blocked command: rm -rf /etc/test",
      },
    );
    session.conversation.push(
      { role: "user", content: "raw boomerang prompt", tokens: 4 },
      { role: "assistant", content: "Parser fixed.", tokens: 3 },
    );

    const summary = completeBoomerang(session, "Parser fixed.");

    assert.match(summary ?? "", /\[BOOMERANG COMPLETE\]/);
    assert.match(summary ?? "", /Changed Files:\n- src\/parser\.ts/);
    assert.match(summary ?? "", /Relevant Reads:\n- src\/parser\.ts/);
    assert.match(summary ?? "", /shell_command: shell exit: init summary Traceback/);
    assert.match(summary ?? "", /shell_command: blocked by shell policy/);
    assert.doesNotMatch(summary ?? "", /guarded; duration/);
    assert.match(summary ?? "", /Archivist: saved boomerang handoff/);
    assert.equal(session.operationControls.boomerang.active, false);
    assert.equal(session.conversation.length, 2);
    assert.equal(session.conversation[0]?.content, "/boomerang fix parser");
    assert.match(session.conversation[1]?.content ?? "", /Parser fixed/);

    const rawStore = JSON.parse(await readFile(session.archivist.storagePath, "utf8")) as {
      entries: Array<{ type: string; sourceCategory: string; tags: string[]; content: string }>;
    };
    assert.equal(rawStore.entries.length, 1);
    assert.equal(rawStore.entries[0]?.type, "boomerang-handoff");
    assert.equal(rawStore.entries[0]?.sourceCategory, "boomerang-handoff");
    assert.ok(rawStore.entries[0]?.tags.includes("reseed"));
    assert.match(rawStore.entries[0]?.content ?? "", /fix parser/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runRuntimeCommand exposes and persists config and LSP settings", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const { loadPersistedRuntimeState } = await import("../src/runtime/persistence.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-cli-config-"));

  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.toolPolicy.allowedRoots = [cwd];

    const status = runRuntimeCommand(session, "/config");
    assert.equal(status?.ok, true);
    assert.match(status?.output ?? "", /^config$/m);
    assert.match(status?.output ?? "", /^logoMode: full$/m);
    assert.match(status?.output ?? "", /^enabled: false$/m);

    const logo = runRuntimeCommand(session, "/config set logo condensed");
    assert.equal(logo?.ok, true);
    assert.equal(session.ui.logoMode, "condensed");

    const directLogo = runRuntimeCommand(session, "/config logo full");
    assert.equal(directLogo?.ok, true);
    assert.equal(session.ui.logoMode, "full");

    const lsp = runRuntimeCommand(session, "/config set lsp on");
    assert.equal(lsp?.ok, true);
    assert.equal(session.lsp.enabled, true);

    const directLsp = runRuntimeCommand(session, "/config lsp off");
    assert.equal(directLsp?.ok, true);
    assert.equal(session.lsp.enabled, false);
    assert.equal(runRuntimeCommand(session, "/config lsp on")?.ok, true);

    const lspIndex = runRuntimeCommand(session, "/config set lsp-index on");
    assert.equal(lspIndex?.ok, true);
    assert.equal(session.lsp.indexArchivist, true);

    const lspStatus = runRuntimeCommand(session, "/lsp");
    assert.equal(lspStatus?.ok, true);
    assert.match(lspStatus?.output ?? "", /^enabled: true$/m);
    assert.match(lspStatus?.output ?? "", /^command: typescript-language-server$/m);

    const lspSetup = runRuntimeCommand(session, "/lsp setup");
    assert.equal(lspSetup?.ok, true);
    assert.match(lspSetup?.output ?? "", /^lsp setup$/m);
    assert.match(lspSetup?.output ?? "", /safety: no auto-download/);

    const persisted = await loadPersistedRuntimeState(cwd);
    assert.equal(persisted?.ui?.logoMode, "full");
    assert.equal(persisted?.lsp?.enabled, true);
    assert.equal(persisted?.lsp?.indexArchivist, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runRuntimeCommand accepts memory status alias", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();

  const base = runRuntimeCommand(session, "/memory");
  const alias = runRuntimeCommand(session, "/memory status");

  assert.equal(alias?.ok, true);
  assert.equal(alias?.output, base?.output);
  assert.equal(alias?.activity, "memory status");
});

test("runRuntimeCommand supports memory checkpoint and session mutations", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-memory-command-"));

  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.archivist.enabled = true;
    session.archivist.boundary = "bounded-write";
    session.archivist.storagePath = path.join(cwd, ".nexagent", "archivist.json");
    session.conversation = [
      { role: "user", content: "fix config menu", tokens: 4 },
      { role: "assistant", content: "config menu fixed", tokens: 4 },
    ];

    const checkpoint = runRuntimeCommand(session, "/memory checkpoint commit prep");
    assert.equal(checkpoint?.ok, true);
    assert.equal(checkpoint?.activity, "memory checkpoint");
    assert.match(checkpoint?.output ?? "", /^memory checkpoint saved;/);

    const sessionSummary = runRuntimeCommand(session, "/memory session config menu");
    assert.equal(sessionSummary?.ok, true);
    assert.equal(sessionSummary?.activity, "memory session");
    assert.match(sessionSummary?.output ?? "", /^memory session summary saved;/);

    const rawStore = JSON.parse(await readFile(session.archivist.storagePath, "utf8")) as {
      entries: Array<{ type: string; summary?: string; tags?: string[] }>;
    };
    assert.equal(rawStore.entries.some((entry) => entry.type === "checkpoint" && /commit prep/.test(entry.summary ?? "")), true);
    assert.equal(rawStore.entries.some((entry) => entry.type === "session-summary" && entry.tags?.includes("focused")), true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runRuntimeCommand exposes LSP symbol and diagnostic slash commands", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-cli-lsp-"));
  try {
    await mkdir(path.join(cwd, "src"));
    await writeFile(
      path.join(cwd, "src", "sample.ts"),
      "export function alpha() {}\n// TODO tighten diagnostics\nexport class Beta {}\n",
      "utf8",
    );
    await writeFile(
      path.join(cwd, "src", "regex.ts"),
      "const pattern = /\\bTODO\\b|\\bFIXME\\b|eslint-disable|@ts-ignore/;\n",
      "utf8",
    );
    await writeFile(
      path.join(cwd, "src", "large.ts"),
      `${"export const value = 1;\n".repeat(4000)}const code = \`\n`,
      "utf8",
    );
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.lsp.enabled = true;

    const symbols = runRuntimeCommand(session, "/lsp symbols src/sample.ts");
    assert.equal(symbols?.ok, true);
    assert.match(symbols?.output ?? "", /^lsp symbols$/m);
    assert.match(symbols?.output ?? "", /function alpha line=1/);
    assert.match(symbols?.output ?? "", /class Beta line=3/);

    const diagnostics = runRuntimeCommand(session, "/lsp diagnostics src/sample.ts");
    assert.equal(diagnostics?.ok, true);
    assert.match(diagnostics?.output ?? "", /^lsp diagnostics$/m);
    assert.match(diagnostics?.output ?? "", /TODO tighten diagnostics/);

    const workspace = runRuntimeCommand(session, "/lsp check src");
    assert.equal(workspace?.ok, true);
    assert.match(workspace?.output ?? "", /^lsp workspace$/m);
    assert.match(workspace?.output ?? "", /^problems: 1$/m);
    assert.match(workspace?.output ?? "", /src\/sample\.ts:2 info \/\/ TODO tighten diagnostics/);

    const health = runRuntimeCommand(session, "/lsp health");
    assert.equal(health?.ok, true);
    assert.match(health?.output ?? "", /^lsp health$/m);

    const warm = runRuntimeCommand(session, "/lsp warm");
    assert.equal(warm?.ok, true);
    assert.match(warm?.output ?? "", /^lsp warm$/m);

    const navDefinition = runRuntimeCommand(session, "/lsp nav definition src/sample.ts 1 17");
    assert.equal(navDefinition?.ok, true);
    assert.match(navDefinition?.output ?? "", /^lsp navigation$/m);
    assert.match(navDefinition?.output ?? "", /^operation: definition$/m);
    assert.match(navDefinition?.output ?? "", /function alpha src\/sample\.ts:1:1/);

    const workspaceSymbol = runRuntimeCommand(session, "/lsp nav workspaceSymbol Beta");
    assert.equal(workspaceSymbol?.ok, true);
    assert.match(workspaceSymbol?.output ?? "", /^operation: workspaceSymbol$/m);
    assert.match(workspaceSymbol?.output ?? "", /class Beta src\/sample\.ts:3:1/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runRuntimeCommand shows and sets model for active provider", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();

  assert.deepEqual(runRuntimeCommand(session, "/model"), {
    ok: true,
    output: "provider: codex\ncurrent: gpt-5.4\neffort: medium\navailable: gpt-5.4, gpt-5.5, gpt-5.4-mini, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.2\nefforts: low, medium, high, xhigh",
    activity: "model status · codex",
  });

  assert.deepEqual(runRuntimeCommand(session, "/model gpt-5.5 high"), {
    ok: true,
    output: "provider: codex\ncurrent: gpt-5.5\neffort: high\navailable: gpt-5.4, gpt-5.5, gpt-5.4-mini, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.2\nefforts: low, medium, high, xhigh",
    activity: "model set · gpt-5.5 high",
  });

  assert.deepEqual(runRuntimeCommand(session, "/effort medium"), {
    ok: true,
    output: "provider: codex\nmodel: gpt-5.5\ncurrent: medium\navailable: low, medium, high, xhigh",
    activity: "effort set · medium",
  });
});

test("runRuntimeCommand exposes Pi compatibility commands", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();

  assert.match(runRuntimeCommand(session, "/notify on")?.output ?? "", /enabled: on/);
  assert.match(runRuntimeCommand(session, "/notify threshold 1234")?.output ?? "", /thresholdMs: 1234/);
  assert.match(runRuntimeCommand(session, "/emoji ★")?.output ?? "", /emoji: ★/);
  assert.match(runRuntimeCommand(session, "/color-set 2")?.output ?? "", /index=2/);
  assert.match(runRuntimeCommand(session, "/safegit patterns")?.output ?? "", /force push/);
  assert.match(runRuntimeCommand(session, "/scip status")?.output ?? "", /pi-agent-scip compatibility/);
});

test("runRuntimeCommand dispatches sync extension commands", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const { createRuntimeExtensionHost } = await import("../src/runtime/extensions.js");
  const session = createSession();
  const host = createRuntimeExtensionHost();
  host.status = "configured";
  host.commands.set("/hello-ext", {
    name: "/hello-ext",
    handler: (args) => `hello ${args.join(" ")}`,
  });
  session.extensions = host;

  const result = runRuntimeCommand(session, "/hello-ext from shim");
  assert.deepEqual(result, {
    ok: true,
    output: "hello from shim",
    activity: "extension /hello-ext",
  });
  assert.match(runRuntimeCommand(session, "/extensions")?.output ?? "", /commands: 1/);
});

test("runRuntimeCommand maps /scip symbols to LSP summary", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-scip-"));

  try {
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(path.join(cwd, "src", "sample.ts"), "export function alpha() {}\n", "utf8");
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.lsp.enabled = true;

    const symbols = runRuntimeCommand(session, "/scip symbols src/sample.ts");
    assert.equal(symbols?.ok, true);
    assert.match(symbols?.output ?? "", /^lsp symbols$/m);
    assert.match(symbols?.output ?? "", /function alpha line=1/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runRuntimeCommand exposes reload and quit commands", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();

  assert.deepEqual(runRuntimeCommand(session, "/reload"), {
    ok: true,
    output: "runtime reload requested (config/state only; code edits require restart)",
    activity: "reload requested",
  });

  assert.deepEqual(runRuntimeCommand(session, "/quit"), {
    ok: true,
    output: "quit requested",
    activity: "quit requested",
  });
});

test("runRuntimeCommand reports runtime status and style stack", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();
  session.commandModes.cavemanMode = true;
  session.commandModes.deadpoolMode = true;

  const result = runRuntimeCommand(session, "/status");
  assert.equal(result?.ok, true);
  assert.equal(result?.activity, "status");
  assert.match(result?.output ?? "", /^runtime$/m);
  assert.match(result?.output ?? "", /^provider: /m);
  assert.match(result?.output ?? "", /^tool-policy: /m);
  assert.match(result?.output ?? "", /memory/);
  assert.match(result?.output ?? "", /provider: codex \/ gpt-5.4 \/ cli-exec/);
  assert.match(result?.output ?? "", /approval: approval=off/);
  assert.equal((result?.output ?? "").includes("configured:"), false);
  assert.equal((result?.output ?? "").split("\n").length <= 8, true);

  const verbose = runRuntimeCommand(session, "/status --verbose");
  assert.equal(verbose?.ok, true);
  assert.equal(verbose?.activity, "status");
  const verboseOutput = verbose?.output ?? "";
  assert.match(verboseOutput, /^runtime$/m);
  assert.match(verboseOutput, /^provider$/m);
  assert.match(verboseOutput, /^auth:$/m);
  assert.match(verboseOutput, /\bloggedIn: true\b/);
  assert.match(verboseOutput, /yoloMode: false/);
  assert.match(verboseOutput, /^tool-policy$/m);
  assert.match(verboseOutput, /^memory$/m);

  const sentry = runRuntimeCommand(session, "/status --sentry");
  assert.equal(sentry?.ok, true);
  assert.equal(sentry?.activity, "sentry status");
  assert.match(sentry?.output ?? "", /^sentry$/m);
  assert.match(sentry?.output ?? "", /^redaction: tags-only$/m);
  assert.match(sentry?.output ?? "", /^self-test: dry-run$/m);

  const sentryTest = runRuntimeCommand(session, "/status --sentry --send-test-event");
  assert.equal(sentryTest?.ok, true);
  assert.equal(sentryTest?.activity, "sentry status · test event");
  assert.match(sentryTest?.output ?? "", /^self-test: event requested$/m);

  const badSentry = runRuntimeCommand(session, "/status --sentry --unknown");
  assert.equal(badSentry?.ok, false);
  assert.match(badSentry?.message ?? "", /usage: \/status/);

  const missingSentry = runRuntimeCommand(session, "/status --send-test-event");
  assert.equal(missingSentry?.ok, false);
  assert.match(missingSentry?.message ?? "", /usage: \/status/);
});

test("runRuntimeCommand reports doctor health with next actions", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();
  session.auth.loggedIn = false;
  session.auth.status = "login missing";
  session.operationControls.lastShellBlocker = {
    command: "rm -rf /etc/nexagent-blocked",
    pattern: "\\brm\\s+-r[f]?\\s+\\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)",
    reason: "recursive remove targets protected system roots",
    matchedText: "rm -rf /etc/nexagent-blocked",
    source: "shell_command",
    advice: "Do not delete protected OS roots.",
  };

  const result = runRuntimeCommand(session, "/doctor");

  assert.equal(result?.ok, true);
  assert.match(result?.output ?? "", /^doctor$/m);
  assert.match(result?.output ?? "", /status: attention/);
  assert.match(result?.output ?? "", /provider auth not ready/);
  assert.match(result?.output ?? "", /recent shell command blocked/);
  assert.match(result?.output ?? "", /\/login/);
  assert.match(result?.output ?? "", /\/why-blocked/);
});

test("formatRuntimeStatus compact includes turn state/objective/blocker", async () => {
  const { formatRuntimeStatus } = await import("../src/cli.js");
  const blockedSession = createSession();
  blockedSession.operationControls.pendingApproval = {
    tool: "write_file",
    risk: "guarded",
    summary: "{\"path\":\"/tmp/example.txt\"}",
  };
  const blockedOutput = formatRuntimeStatus(blockedSession, "compact");
  assert.match(blockedOutput, /^runtime$/m);
  assert.match(blockedOutput, /state=blocked/);
  assert.match(blockedOutput, /objective=awaiting approval for write_file/);
  assert.match(blockedOutput, /blocker=pending approval: write_file/);

  const runningSession = createSession();
  runningSession.action.status = "running";
  runningSession.action.pending = true;
  runningSession.action.detail = "provider request";
  const runningOutput = formatRuntimeStatus(runningSession, "compact");
  assert.match(runningOutput, /state=running/);
  assert.match(runningOutput, /objective=provider request/);
});

test("status and statusline expose yolo mode", async () => {
  const { createRuntimeTuiView, runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();
  session.operationControls.yoloMode = true;
  session.operationControls.requireApprovalForGuarded = false;
  session.commandModes.statusline = true;

  const status = runRuntimeCommand(session, "/status");
  assert.equal(status?.ok, true);
  assert.match(status?.output ?? "", /approval: approval=yolo/);

  const approvalStatus = runRuntimeCommand(session, "/approval status");
  assert.equal(approvalStatus?.ok, true);
  assert.match(approvalStatus?.output ?? "", /yoloMode: true/);
  assert.match(approvalStatus?.output ?? "", /approvalRequired: false/);

  const view = createRuntimeTuiView(session);
  assert.match(view.statusline ?? "", /approval=yolo/);
  assert.equal(new Map(view.metadata).get("approval"), "approval=yolo");
});

test("approval on re-enables guarded approval inside yolo session", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();
  session.operationControls.yoloMode = true;
  session.operationControls.requireApprovalForGuarded = false;

  const result = runRuntimeCommand(session, "/approval on");

  assert.equal(result?.ok, true);
  assert.equal(session.operationControls.yoloMode, true);
  assert.equal(session.operationControls.requireApprovalForGuarded, true);
  assert.match(result?.output ?? "", /approvalRequired: true/);
  assert.match(result?.output ?? "", /yoloMode: true/);
});

test("non-approval saves do not persist yolo approval override", async () => {
  const { loadPersistedRuntimeState } = await import("../src/runtime/persistence.js");
  const { runRuntimeCommand } = await import("../src/cli.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-yolo-persist-"));
  const session = createSession();
  session.cwd = cwd;
  session.operationDefaults.requireApprovalForGuarded = true;
  session.operationControls.yoloMode = true;
  session.operationControls.requireApprovalForGuarded = false;

  try {
    const result = runRuntimeCommand(session, "/statusline on");
    assert.equal(result?.ok, true);

    const persisted = await loadPersistedRuntimeState(cwd);
    assert.equal(persisted?.operationControls?.requireApprovalForGuarded, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("approval command persists explicit override in yolo session", async () => {
  const { loadPersistedRuntimeState } = await import("../src/runtime/persistence.js");
  const { runRuntimeCommand } = await import("../src/cli.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-yolo-approval-"));
  const session = createSession();
  session.cwd = cwd;
  session.operationDefaults.requireApprovalForGuarded = false;
  session.operationControls.yoloMode = true;
  session.operationControls.requireApprovalForGuarded = false;

  try {
    const result = runRuntimeCommand(session, "/approval on");
    assert.equal(result?.ok, true);

    const persisted = await loadPersistedRuntimeState(cwd);
    assert.equal(persisted?.operationControls?.requireApprovalForGuarded, true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runRuntimeCommand continue command reflects blockers and run-state", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const blockedSession = createSession();
  blockedSession.operationControls.pendingApproval = {
    tool: "delete_file",
    risk: "guarded",
    summary: "{\"path\":\"/tmp/one.txt\"}",
  };

  assert.deepEqual(runRuntimeCommand(blockedSession, "/continue"), {
    ok: false,
    message: "cannot continue: awaiting approval for delete_file · blocker=pending approval: delete_file",
    activity: "continue blocked",
  });

  const runningSession = createSession();
  runningSession.action.status = "running";
  runningSession.action.pending = true;
  runningSession.action.detail = "provider request";
  assert.deepEqual(runRuntimeCommand(runningSession, "/continue"), {
    ok: true,
    output: "turn running: provider request",
    activity: "continue running",
  });
});

test("runRuntimeCommand finish blocks until verified completion proof exists", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const pendingSession = createSession();
  pendingSession.action.status = "running";
  pendingSession.action.pending = true;
  pendingSession.action.detail = "provider request";
  assert.deepEqual(runRuntimeCommand(pendingSession, "/finish"), {
    ok: false,
    message: "finish blocked: state=running objective=provider request (unverified)",
    activity: "finish blocked",
  });

  const finishedSession = createSession();
  finishedSession.events.push(
    {
      at: "2025-01-01T00:00:00.000Z",
      kind: "prompt",
      status: "queued",
      summary: "user prompt queued",
      detail: "say hi",
    },
    {
      at: "2025-01-01T00:00:00.001Z",
      kind: "assistant",
      status: "completed",
      summary: "assistant response completed",
      detail: "done",
    },
  );
  assert.deepEqual(runRuntimeCommand(finishedSession, "/finish"), {
    ok: true,
    output: "turn finished: assistant response ready",
    activity: "finish complete",
  });
});

test("runRuntimeCommand controls approval and operator steer state", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();

  assert.deepEqual(runRuntimeCommand(session, "/approval on"), {
    ok: true,
    output: "approvalRequired: true\nyoloMode: false\npendingApproval: none\nlastDecision: none\ncancelRequested: false\nsteerState: none\nsteer: none\nlastAppliedSteer: none\nsteerHistory: none",
    activity: "approval on",
  });
  assert.equal(session.operationControls.requireApprovalForGuarded, true);

  assert.deepEqual(runRuntimeCommand(session, "/steer use smaller patch"), {
    ok: true,
    output: "approvalRequired: true\nyoloMode: false\npendingApproval: none\nlastDecision: none\ncancelRequested: false\nsteerState: queued\nsteer: use smaller patch\nlastAppliedSteer: none\nsteerHistory: queued:use smaller patch (ready for next tool/model boundary)",
    activity: "steer queued",
  });

  assert.deepEqual(runRuntimeCommand(session, "/cancel"), {
    ok: true,
    output: "approvalRequired: true\nyoloMode: false\npendingApproval: none\nlastDecision: none\ncancelRequested: true\nsteerState: queued\nsteer: use smaller patch\nlastAppliedSteer: none\nsteerHistory: queued:use smaller patch (ready for next tool/model boundary)",
    activity: "cancel requested",
  });
});

test("runRuntimeCommand marks steer deferred while work is active", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();
  session.action.status = "running";
  session.action.pending = true;
  session.action.detail = "provider request";

  assert.deepEqual(runRuntimeCommand(session, "/steer wait for safer patch window"), {
    ok: true,
    output: "approvalRequired: false\nyoloMode: false\npendingApproval: none\nlastDecision: none\ncancelRequested: false\nsteerState: deferred\nsteer: wait for safer patch window\nlastAppliedSteer: none\nsteerHistory: deferred:wait for safer patch window (waiting for next tool/model boundary)",
    activity: "steer deferred",
  });
});

test("runRuntimeCommand answers pending ask_user_question", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();
  session.operationControls.pendingQuestionnaire = {
    id: "ask_test",
    createdAt: "2025-01-01T00:00:00.000Z",
    answers: [],
    response: null,
    questions: [{
      question: "Which mode?",
      header: "Mode",
      options: [
        { label: "Fast (Recommended)", description: "Smallest useful path." },
        { label: "Full", description: "Complete parity path." },
      ],
    }],
  };

  const status = runRuntimeCommand(session, "/ask status");
  assert.equal(status?.ok, true);
  assert.match(status?.output ?? "", /Which mode\?/);
  assert.match(status?.output ?? "", /1\. Fast \(Recommended\)/);

  const answer = runRuntimeCommand(session, "/ask 2");
  assert.equal(answer?.ok, true);
  assert.match(answer?.output ?? "", /User answered ask_user_question/);
  assert.match(answer?.output ?? "", /Full/);
  assert.equal(session.operationControls.pendingQuestionnaire.response?.cancelled, false);
});

test("runRuntimeCommand compacts conversation manually", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();
  session.conversation = [
    { role: "user", content: "one", tokens: 1 },
    { role: "assistant", content: "two", tokens: 1 },
    { role: "user", content: "three", tokens: 2 },
    { role: "assistant", content: "four", tokens: 1 },
    { role: "user", content: "five", tokens: 1 },
    { role: "assistant", content: "six", tokens: 1 },
  ];

  const result = runRuntimeCommand(session, "/compact");

  assert.equal(result?.ok, true);
  assert.match(result?.output ?? "", /manual compaction completed/);
  assert.match(result?.output ?? "", /summary=present/);
  assert.match(result?.output ?? "", /turns=4/);
  assert.match(result?.output ?? "", /tokens=7->/);
  assert.doesNotMatch(result?.output ?? "", /preserveTurns/);
});

test("compactConversation preserves queued intent locally without event content", async () => {
  const { compactConversation } = await import("../src/runtime/session.js");
  const session = createSession();
  session.conversation = [
    { role: "user", content: "one", tokens: 1 },
    { role: "assistant", content: "two", tokens: 1 },
    { role: "user", content: "three", tokens: 1 },
    { role: "assistant", content: "four", tokens: 1 },
    { role: "user", content: "five", tokens: 1 },
    { role: "assistant", content: "six", tokens: 1 },
  ];

  const queued = "continue with private follow-up";
  compactConversation(session, "auto", queued);

  assert.equal(session.compaction.snapshot?.queuedUserMessage, queued);
  assert.equal(session.compaction.queuedUserMessage, null);
  const compactEvents = session.events
    .filter((event) => event.kind === "compact")
    .map((event) => `${event.summary} ${event.detail ?? ""}`)
    .join("\n");
  assert.match(compactEvents, /queued user message preserved/);
  assert.doesNotMatch(compactEvents, /private follow-up/);
});

test("runRuntimeCommand toggles caveman mode", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();

  const result = runRuntimeCommand(session, "/caveman-mode on");

  assert.deepEqual(result, {
    ok: true,
    output: "Caveman mode ON. Responses now ultra-compressed. ~75% fewer tokens. Technical accuracy preserved.",
    activity: "caveman mode on",
  });
  assert.equal(session.commandModes.cavemanMode, true);
  assert.match(session.promptV2Summary.style, /ultra-compressed caveman style/);
  assert.match(session.promptV2Summary.style, /Drop articles .* filler .* pleasantries/);
});

test("runRuntimeCommand toggles deadpool mode", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();
  session.commandModes.cavemanMode = true;

  const result = runRuntimeCommand(session, "/deadpoolmode on");

  assert.deepEqual(result, {
    ok: true,
    output: "Deadpool mode ON. Caveman mode still ON. Replies keep antihero voice, but compressed. Style stack: deadpool + caveman.",
    activity: "deadpool mode on",
  });
  assert.equal(session.commandModes.deadpoolMode, true);
  assert.match(session.promptV2Summary.style, /recognizably Deadpool-flavored/);
  assert.match(session.promptV2Summary.style, /Technical accuracy, safety, and execution rules override style/);
});

test("runRuntimeCommand toggles statusline", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();

  const result = runRuntimeCommand(session, "/statusline on");

  assert.deepEqual(result, {
    ok: true,
    output: "Statusline ON. Footer now shows △ color=222 | codex | gpt-5.4 | cli-exec | ready | approval=off | mouse=auto/scroll | mouse:auto | in~0 out~0 | ctx [----------] 0% 272k/272k free.",
    activity: "statusline on",
  });
  assert.equal(session.commandModes.statusline, true);
});

test("runRuntimeCommand switches transport mode", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession("openai");

  const result = runRuntimeCommand(session, "/provider transport http-responses");

  assert.equal(result?.ok, true);
  assert.equal(result?.activity, "transport set · http-responses");
  assert.match(result?.output ?? "", /^provider$/m);
  assert.match(result?.output ?? "", /^provider: openai$/m);
  assert.match(result?.output ?? "", /^mode: http-responses$/m);
  assert.match(result?.output ?? "", /^capabilities: /m);
  assert.equal(session.providerTransport.mode, "http-responses");
  assert.equal(session.providerTransport.adapter, "openai-http-responses");
});

test("runRuntimeCommand switches codex backend transport mode", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession("codex");

  const result = runRuntimeCommand(session, "/provider transport codex-http");

  assert.equal(result?.ok, true);
  assert.equal(result?.activity, "transport set · codex-http");
  assert.match(result?.output ?? "", /^provider$/m);
  assert.match(result?.output ?? "", /^provider: codex$/m);
  assert.match(result?.output ?? "", /^mode: codex-http$/m);
  assert.match(result?.output ?? "", new RegExp(`auth-gate: ${session.providerTransport.authGate}`));
  assert.equal(session.providerTransport.mode, "codex-http");
  assert.equal(session.providerTransport.adapter, "codex-chatgpt-http");
});

test("runRuntimeCommand suggests help for unknown commands", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();
  const result = runRuntimeCommand(session, "/nope");

  assert.deepEqual(result, {
    ok: false,
    message: "unknown command /nope; use /help",
    activity: "command failed · /nope",
  });
  assert.equal(
    session.events.some((event) => event.kind === "control" && event.summary.includes("command.failed")),
    true,
  );
});

test("runRuntimeCommand supports local tool commands", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-cli-tools-"));

  try {
    await mkdir(path.join(cwd, "docs"));
    await writeFile(path.join(cwd, "notes.txt"), "alpha\nbeta\nneedle here\n", "utf8");
    await writeFile(path.join(cwd, "docs", "guide.md"), "# Guide\nneedle again\n", "utf8");

    const session = {
      ...createSession(),
      cwd,
      repo: {
        root: cwd,
        name: "repo",
        vcs: "git" as const,
        branch: "main",
        freshness: {
          status: "no-upstream" as const,
          tracking: null,
          ahead: null,
          behind: null,
          dirty: false,
          needsPull: false,
          checkedAt: "2025-01-01T00:00:00.000Z",
        },
      },
      toolPolicy: {
        mode: "repo-local-guarded" as const,
        allowedRoots: [cwd],
        protectedRoots: ["/etc", "/home/pfchrono/.ssh"],
        shell: "limited" as const,
        writes: "guarded" as const,
        deletes: "blocked" as const,
      },
    };

    assert.deepEqual(runRuntimeCommand(session, "/pwd"), {
      ok: true,
      output: cwd,
      activity: "pwd",
    });

    assert.deepEqual(runRuntimeCommand(session, "/ls"), {
      ok: true,
      output: "dir docs\nfile notes.txt",
      activity: "ls · .",
    });

    assert.deepEqual(runRuntimeCommand(session, "/read notes.txt"), {
      ok: true,
      output: "alpha\nbeta\nneedle here\n",
      activity: "read · notes.txt",
    });

    const findResult = runRuntimeCommand(session, "/find needle");
    assert.equal(findResult?.ok, true);
    assert.match(findResult?.output ?? "", /notes\.txt:3:needle here/);
    assert.match(findResult?.output ?? "", /docs\/guide\.md:2:needle again/);

    assert.deepEqual(runRuntimeCommand(session, "/glob *.txt"), {
      ok: true,
      output: "notes.txt",
      activity: "glob · *.txt",
    });

    const rgResult = runRuntimeCommand(session, "/rg needle");
    assert.equal(rgResult?.ok, true);
    assert.match(rgResult?.output ?? "", /notes\.txt:3:needle here/);
    assert.match(rgResult?.output ?? "", /guide\.md:2:needle again/);

    assert.deepEqual(runRuntimeCommand(session, "!printf 'hello\\n'"), {
      ok: true,
      output: "$ printf 'hello\\n'\nhello",
      activity: "shell · printf 'hello\\n'",
    });

    const blockedShell = runRuntimeCommand(session, "!rm -rf /etc/nexagent-blocked");
    assert.equal(blockedShell?.ok, false);
    assert.match(blockedShell?.message ?? "", /shell policy blocked command/);
    assert.match(blockedShell?.message ?? "", /reason: recursive remove targets protected system roots/);
    assert.equal(blockedShell?.activity, "command blocked · shell policy");

    const whyBlocked = runRuntimeCommand(session, "/why-blocked");
    assert.equal(whyBlocked?.ok, true);
    assert.match(whyBlocked?.output ?? "", /lastShellBlocker/);
    assert.match(whyBlocked?.output ?? "", /reason: recursive remove targets protected system roots/);
    assert.match(whyBlocked?.output ?? "", /command: rm -rf \/etc\/nexagent-blocked/);

    assert.deepEqual(runRuntimeCommand(session, "/hooks"), {
      ok: true,
      output: "status: none\nsource: none\nevents: none\ncommands: 0\ninvalid: none",
      activity: "hooks status",
    });

    const compactMemory = runRuntimeCommand(session, "/memory");
    assert.equal(compactMemory?.ok, true);
    assert.equal(compactMemory?.activity, "memory status");
    assert.match(compactMemory?.output ?? "", /^memory$/m);
    assert.match(compactMemory?.output ?? "", /^enabled: false$/m);
    assert.match(compactMemory?.output ?? "", /^boundary: disabled$/m);
    assert.match(compactMemory?.output ?? "", /^signal: matches=0 .* duplicates=0/m);

    const verboseMemory = runRuntimeCommand(session, "/memory --verbose");
    assert.equal(verboseMemory?.ok, true);
    assert.equal(verboseMemory?.activity, "memory status");
    assert.match(verboseMemory?.output ?? "", /^memory$/m);
    assert.match(verboseMemory?.output ?? "", /^enabled: false$/m);
    assert.match(verboseMemory?.output ?? "", /^retrieval: idle$/m);
    assert.match(verboseMemory?.output ?? "", /^diagnostics: matches=0 .* stale=0 .* noisy=0$/m);
    assert.match(verboseMemory?.output ?? "", /^writePreview: none$/m);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runRuntimeCommand reports tool policy", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const compactTools = runRuntimeCommand(createSession(), "/tools");
  assert.equal(compactTools?.ok, true);
  assert.equal(compactTools?.activity, "tools status");
  assert.match(compactTools?.output ?? "", /^tool-policy$/m);
  assert.match(compactTools?.output ?? "", /^mode: repo-local-guarded$/m);
  assert.match(compactTools?.output ?? "", /^writes: guarded$/m);

  const verboseTools = runRuntimeCommand(createSession(), "/tools --verbose");
  assert.equal(verboseTools?.ok, true);
  assert.equal(verboseTools?.activity, "tools status");
  assert.match(verboseTools?.output ?? "", /^tool-policy$/m);
  assert.match(verboseTools?.output ?? "", /^mode: repo-local-guarded$/m);
  assert.match(verboseTools?.output ?? "", /^protected: /m);
  assert.match(verboseTools?.output ?? "", /timeout=5000ms/);
});

test("runRuntimeCommand maintains archivist memory by removing exact duplicates", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-memory-maintenance-"));
  try {
    const storagePath = path.join(cwd, ".nexagent", "archivist.json");
    await mkdir(path.dirname(storagePath), { recursive: true });
    await writeFile(storagePath, JSON.stringify({
      version: "1.0.0",
      entries: [
        {
          type: "memory",
          summary: "same fact",
          content: "same fact content",
          tags: ["alpha"],
          projectPath: cwd,
          createdAt: "2025-01-01T00:00:00.000Z",
        },
        {
          type: "memory",
          summary: "same fact",
          content: "same fact content",
          tags: ["alpha"],
          projectPath: cwd,
          createdAt: "2025-01-02T00:00:00.000Z",
        },
        {
          type: "memory",
          summary: "different fact",
          content: "different fact content",
          tags: ["beta"],
          projectPath: cwd,
          createdAt: "2025-01-03T00:00:00.000Z",
        },
      ],
    }, null, 2), "utf8");

    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.archivist.enabled = true;
    session.archivist.boundary = "bounded-write";
    session.archivist.storagePath = storagePath;
    session.archivist.storageExists = true;

    const result = runRuntimeCommand(session, "/memory --maintance");

    assert.equal(result?.ok, true);
    assert.equal(result?.activity, "memory maintenance");
    assert.match(result?.output ?? "", /^memory maintenance$/m);
    assert.match(result?.output ?? "", /^entries: 3 -> 2$/m);
    assert.match(result?.output ?? "", /^removedDuplicates: 1$/m);
    assert.match(result?.output ?? "", /^persisted: true$/m);
    assert.equal(session.archivist.diagnostics?.saveCount, 2);
    assert.equal(session.archivist.diagnostics?.duplicateSuspectCount, 0);

    const store = JSON.parse(await readFile(storagePath, "utf8")) as { entries: Array<{ summary: string; createdAt: string }> };
    assert.equal(store.entries.length, 2);
    assert.equal(store.entries.find((entry) => entry.summary === "same fact")?.createdAt, "2025-01-02T00:00:00.000Z");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runRuntimeCommand manages nexsight store", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-nexsight-command-"));
  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.toolPolicy.allowedRoots = [cwd];
    await writeFile(path.join(cwd, "note.md"), "Nexsight command search target.\n", "utf8");

    const index = runRuntimeCommand(session, "/nexsight index . *.md");
    assert.equal(index?.ok, true);
    assert.match(index?.output ?? "", /indexed repo \(1 files/);

    const search = runRuntimeCommand(session, "/nexsight search command target");
    assert.equal(search?.ok, true);
    assert.match(search?.output ?? "", /note\.md/);

    const stats = runRuntimeCommand(session, "/nexsight stats");
    assert.equal(stats?.ok, true);
    assert.match(stats?.output ?? "", /backend: sqlite-fts5/);
    assert.match(stats?.output ?? "", /\.nexagent\/nexsight\/index\.db/);
    assert.match(stats?.output ?? "", /chunks:/);

    const missingIndexPath = runRuntimeCommand(session, "/nexsight index");
    assert.equal(missingIndexPath?.ok, false);
    assert.match(missingIndexPath?.message ?? "", /usage: \/nexsight index <path> \[pattern\]/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("formatTranscriptEvent and buildChatHistoryFromSession render command boundaries with timestamps", async () => {
  const { formatCommandBoundary, formatTranscriptEvent, buildChatHistoryFromSession } = await import("../src/cli.js");
  const commandEvent: RuntimeSession["events"][number] = {
    at: "2025-01-01T12:00:00.000Z",
    kind: "command",
    status: "completed",
    summary: "command /provider completed",
    detail: "line1\nline2\nline3",
  };

  const boundary = formatCommandBoundary(commandEvent);
  assert.match(boundary[0], /^\[cmd-result\] 2025-01-01T12:00:00\.000Z · completed · command \/provider completed$/);
  assert.equal(boundary[1], "  line1");
  assert.equal(boundary[2], "  line2");
  assert.equal(boundary[3], "  line3");

  const eventLines = formatTranscriptEvent(commandEvent);
  assert.equal(eventLines.join("\n"), boundary.join("\n"));

  const session = createSession();
  session.events = [commandEvent];
  const history = buildChatHistoryFromSession(session);
  assert.match(history.join("\n"), /\[cmd-result\] 2025-01-01T12:00:00\.000Z · completed · command \/provider completed/);
});

test("buildChatHistoryFromSession places turn activity between prompt and reply", async () => {
  const { buildChatHistoryFromSession } = await import("../src/cli.js");
  const session = createSession();
  session.conversation = [
    { role: "user", content: "inspect repo", tokens: 2 },
    { role: "assistant", content: "done", tokens: 1 },
  ];
  session.events = [
    {
      at: "2025-01-01T12:00:00.000Z",
      kind: "prompt",
      status: "queued",
      summary: "user prompt accepted",
      detail: "inspect repo",
    },
    {
      at: "2025-01-01T12:00:00.100Z",
      kind: "provider",
      status: "started",
      summary: "provider request started",
      detail: "codex",
    },
    {
      at: "2025-01-01T12:00:00.200Z",
      kind: "tool",
      status: "completed",
      summary: "tool list_dir completed",
      detail: "guarded; output=ok",
    },
    {
      at: "2025-01-01T12:00:00.300Z",
      kind: "assistant",
      status: "completed",
      summary: "assistant response completed",
      detail: "done",
    },
  ];

  const history = buildChatHistoryFromSession(session);

  assert.deepEqual(history.slice(0, 5), [
    "you: inspect repo",
    "turn: Thinking",
    "turn: Tool calls (1)",
    "turn-detail: Dir List · completed · guarded",
    "agent: done",
  ]);
  assert.ok(history.indexOf("agent: done") > history.indexOf("turn-detail: list_dir completed"));
});

test("formatPromptEventDetail preserves normal long prompts for transcript wrapping", async () => {
  const { formatPromptEventDetail, buildChatHistoryFromSession } = await import("../src/cli.js");
  const prompt = [
    "Try doing a test with nexsight using them on ~/code/openclaw/",
    "doing directory explore, a file read, and report what it gives back",
    "and what we can do with that from there without cutting off prompt text.",
  ].join(" ");
  assert.ok(prompt.length > 160);
  assert.equal(formatPromptEventDetail(prompt), prompt);

  const session = createSession();
  session.events = [
    {
      at: "2025-01-01T12:00:00.000Z",
      kind: "prompt",
      status: "queued",
      summary: "user prompt accepted",
      detail: formatPromptEventDetail(prompt),
    },
  ];

  const history = buildChatHistoryFromSession(session);
  assert.equal(history[0], `you: ${prompt}`);
  assert.match(history[0] ?? "", /without cutting off prompt text\.$/);
  assert.doesNotMatch(history[0] ?? "", /\.\.\.$/);
});

test("maybeArchiveAgedChatHistory stores old transcript with Archivist before pruning", async () => {
  const { maybeArchiveAgedChatHistory } = await import("../src/cli.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-aged-chat-"));
  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.archivist.enabled = true;
    session.archivist.boundary = "bounded-write";
    session.archivist.storagePath = path.join(cwd, ".nexagent", "archivist.json");
    session.events = [
      {
        at: "2025-01-01T00:00:00.000Z",
        kind: "prompt",
        status: "queued",
        summary: "user prompt accepted",
        detail: "old question",
      },
      {
        at: "2025-01-01T00:00:01.000Z",
        kind: "command",
        status: "completed",
        summary: "command !cat completed",
        detail: "old output",
      },
      ...Array.from({ length: 80 }, (_, index): RuntimeSession["events"][number] => ({
        at: `2025-01-01T07:${String(index).padStart(2, "0")}:00.000Z`,
        kind: "tool",
        status: "completed",
        summary: `tool read_file completed ${String(index)}`,
        detail: "recent",
      })),
    ];

    const archived = await maybeArchiveAgedChatHistory(session, Date.parse("2025-01-01T07:30:00.000Z"));

    assert.equal(archived, true);
    assert.equal(session.events.some((event) => event.detail === "old question"), false);
    assert.equal(session.events.some((event) => event.detail === "old output"), false);
    assert.equal(session.events.some((event) => event.summary === "aged chat history archived"), true);

    const raw = await readFile(session.archivist.storagePath, "utf8");
    const store = JSON.parse(raw) as { entries: Array<{ type: string; summary: string; content: string }> };
    const entry = store.entries.find((candidate) => candidate.type === "chat-history-archive");
    assert.ok(entry);
    assert.match(entry.summary, /aged chat history/);
    assert.match(entry.content, /old question/);
    assert.match(entry.content, /old output/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("runRuntimeCommand supports verbose provider output", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const result = runRuntimeCommand(createSession(), "/provider --verbose");

  assert.equal(result?.ok, true);
  assert.equal(result?.activity, "provider status · codex");
  assert.match(result?.output ?? "", /^provider$/m);
  assert.match(result?.output ?? "", /^active: codex$/m);
  assert.match(result?.output ?? "", /^capabilities: /m);
  assert.match(result?.output ?? "", /^caveats: /m);
});

test("runRuntimeCommand blocks reading protected paths", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();

  assert.deepEqual(runRuntimeCommand(session, "/read /etc/passwd"), {
    ok: false,
    message: "tool policy blocked /etc/passwd; protected path",
    activity: "command blocked · /etc/passwd",
  });
});

test("summarizeTurnEvents prioritizes blocker/error lines first", async () => {
  const { summarizeTurnEvents } = await import("../src/cli.js");
  const events: RuntimeSession["events"] = [
    {
      at: "2025-01-01T12:00:00.100Z",
      kind: "provider",
      status: "started",
      summary: "provider request started",
      detail: "step 1",
    },
    {
      at: "2025-01-01T12:00:00.200Z",
      kind: "tool",
      status: "started",
      summary: "tool write_file started",
      detail: "low",
    },
    {
      at: "2025-01-01T12:00:00.300Z",
      kind: "control",
      status: "queued",
      summary: "approval requested",
      detail: "guarded",
    },
    {
      at: "2025-01-01T12:00:00.400Z",
      kind: "tool",
      status: "failed",
      summary: "tool write_file failed",
      detail: "bad",
    },
    {
      at: "2025-01-01T12:00:00.500Z",
      kind: "assistant",
      status: "completed",
      summary: "assistant response completed",
      detail: "done",
    },
  ];

  const lines = summarizeTurnEvents(events);
  assert.match(lines[0], /^▾ blocker:/);
  assert.match(lines[1], /▾ waiting approval/);
  assert.equal(lines[2], "▾ hit issue");
});

test("autocompletePromptBuffer completes slash commands", async () => {
  const { autocompletePromptBuffer, describePromptHint } = await import("../src/cli.js");

  const completion = autocompletePromptBuffer(createSession(), "/pro");
  assert.equal(completion.value, "/provider ");
  assert.equal(completion.hint, "/provider — show or switch provider and transport mode");
  assert.deepEqual(completion.suggestions.map((suggestion) => suggestion.label), ["/provider"]);
  assert.match(describePromptHint(createSession(), "/p") ?? "", /\/provider/);
  assert.equal(autocompletePromptBuffer(createSession(), "/h").value, "/help ");
  assert.match(autocompletePromptBuffer(createSession(), "/h").hint ?? "", /commands:/);
});

test("autocompletePromptBuffer completes trailing skill shorthand inside prompt text", async () => {
  const { autocompletePromptBuffer, describePromptHint } = await import("../src/cli.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-cli-skill-complete-"));

  try {
    await mkdir(path.join(cwd, ".codex", "skills", "zz-memory"), { recursive: true });
    await writeFile(path.join(cwd, ".codex", "skills", "zz-memory", "SKILL.md"), [
      "---",
      "name: zz-memory",
      "description: test memory skill",
      "---",
      "",
      "# zz-memory",
    ].join("\n"));

    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;

    const completion = autocompletePromptBuffer(session, "ok so use $zz-m");

    assert.equal(completion.value, "ok so use $zz-memory ");
    assert.equal(completion.suggestions[0]?.value, "ok so use $zz-memory ");
    assert.match(describePromptHint(session, "ok so use $zz-m") ?? "", /zz-memory/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("autocompletePromptBuffer returns all matching skill shorthand suggestions", async () => {
  const { autocompletePromptBuffer } = await import("../src/cli.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-cli-skill-list-"));

  try {
    for (let index = 0; index < 9; index += 1) {
      const name = `zz-skill-${String(index)}`;
      await mkdir(path.join(cwd, ".codex", "skills", name), { recursive: true });
      await writeFile(path.join(cwd, ".codex", "skills", name, "SKILL.md"), [
        "---",
        `name: ${name}`,
        `description: test skill ${String(index)}`,
        "---",
        "",
        `# ${name}`,
      ].join("\n"));
    }

    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;

    const completion = autocompletePromptBuffer(session, "use $zz-skill");

    assert.equal(completion.suggestions.length, 9);
    assert.deepEqual(completion.suggestions.map((suggestion) => suggestion.label), [
      "$zz-skill-0",
      "$zz-skill-1",
      "$zz-skill-2",
      "$zz-skill-3",
      "$zz-skill-4",
      "$zz-skill-5",
      "$zz-skill-6",
      "$zz-skill-7",
      "$zz-skill-8",
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("autocompletePromptBuffer discovers global nexagent skills with repo override", async () => {
  const { autocompletePromptBuffer, describePromptHint } = await import("../src/cli.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-cli-global-skill-"));
  const nexagentHome = await mkdtemp(path.join(tmpdir(), "nexagent-home-"));
  const previousHome = process.env.NEXAGENT_HOME;

  try {
    process.env.NEXAGENT_HOME = nexagentHome;
    await mkdir(path.join(nexagentHome, "skills", "global-memory"), { recursive: true });
    await writeFile(path.join(nexagentHome, "skills", "global-memory", "SKILL.md"), [
      "---",
      "name: global-memory",
      "description: global memory skill",
      "---",
      "",
      "# global-memory",
    ].join("\n"));
    await mkdir(path.join(nexagentHome, "skills", "shared-skill"), { recursive: true });
    await writeFile(path.join(nexagentHome, "skills", "shared-skill", "SKILL.md"), [
      "---",
      "name: shared-skill",
      "description: global shared skill",
      "---",
      "",
      "# shared-skill",
    ].join("\n"));
    await mkdir(path.join(cwd, ".nexagent", "skills", "shared-skill"), { recursive: true });
    await writeFile(path.join(cwd, ".nexagent", "skills", "shared-skill", "SKILL.md"), [
      "---",
      "name: shared-skill",
      "description: project shared skill",
      "---",
      "",
      "# shared-skill",
    ].join("\n"));

    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;

    assert.equal(autocompletePromptBuffer(session, "use $global-m").value, "use $global-memory ");
    assert.match(describePromptHint(session, "use $global-m") ?? "", /global-memory \(user\)/);
    assert.match(describePromptHint(session, "use $shared") ?? "", /shared-skill \(project\)/);
  } finally {
    if (previousHome === undefined) {
      delete process.env.NEXAGENT_HOME;
    } else {
      process.env.NEXAGENT_HOME = previousHome;
    }
    await rm(cwd, { recursive: true, force: true });
    await rm(nexagentHome, { recursive: true, force: true });
  }
});

test("autocompletePromptBuffer completes repo paths", async () => {
  const { autocompletePromptBuffer } = await import("../src/cli.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-cli-complete-"));

  try {
    await mkdir(path.join(cwd, "src"));
    await writeFile(path.join(cwd, "src", "cli.ts"), "export {};\n", "utf8");
    await writeFile(path.join(cwd, "src", "clock.ts"), "export {};\n", "utf8");
    const session = {
      ...createSession(),
      cwd,
    };

    const single = autocompletePromptBuffer(session, "/read src/cli");
    assert.equal(single.value, "/read src/cli.ts");
    assert.equal(single.hint, "file: src/cli.ts");

    const multiple = autocompletePromptBuffer(session, "/glob *.ts src/cl");
    assert.equal(multiple.value, "/glob *.ts src/cli.ts");
    assert.match(multiple.hint ?? "", /file src\/cli.ts/);
    assert.match(multiple.hint ?? "", /file src\/clock.ts/);

    const selected = autocompletePromptBuffer(session, "/glob *.ts src/cl", 1);
    assert.equal(selected.value, "/glob *.ts src/clock.ts");

    const lspSymbols = autocompletePromptBuffer(session, "/lsp symbols src/cl");
    assert.equal(lspSymbols.value, "/lsp symbols src/cli.ts");
    assert.match(lspSymbols.hint ?? "", /file src\/cli.ts/);

    const lspDiagnostics = autocompletePromptBuffer(session, "/lsp diagnostics src/cl", 1);
    assert.equal(lspDiagnostics.value, "/lsp diagnostics src/clock.ts");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("autocompletePromptBuffer keeps all file suggestions selectable", async () => {
  const { autocompletePromptBuffer } = await import("../src/cli.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-cli-complete-many-"));

  try {
    await mkdir(path.join(cwd, "docs"));
    for (let index = 0; index < 10; index += 1) {
      await writeFile(path.join(cwd, "docs", `note-${String(index)}.md`), "note\n", "utf8");
    }
    const session = { ...createSession(), cwd };
    const completion = autocompletePromptBuffer(session, "open docs/note-", 9);

    assert.equal(completion.suggestions.length, 10);
    assert.equal(completion.value, "open docs/note-9.md");
    assert.equal(completion.selectedIndex, 9);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("autocompletePromptBuffer completes home and absolute path tokens without stealing slash commands", async () => {
  const { autocompletePromptBuffer } = await import("../src/cli.js");
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-cli-paths-"));
  const home = await mkdtemp(path.join(tmpdir(), "nexagent-home-"));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = home;
    await mkdir(path.join(home, "code"));
    await mkdir(path.join(home, "code", "nexagent"));
    await mkdir(path.join(cwd, "alpha"));
    await mkdir(path.join(cwd, "alpine"));
    await mkdir(path.join(cwd, ".alpha-hidden"));
    await writeFile(path.join(cwd, "alpha", "notes.md"), "notes\n", "utf8");
    const session = { ...createSession(), cwd };

    const homeCompletion = autocompletePromptBuffer(session, "open ~/co");
    assert.equal(homeCompletion.value, "open ~/code/");
    assert.equal(homeCompletion.hint, "dir: ~/code/");
    assert.deepEqual(homeCompletion.suggestions.map((suggestion) => suggestion.label), ["~/code/"]);

    const visibleRelativeCompletion = autocompletePromptBuffer(session, "open ./");
    assert.doesNotMatch(visibleRelativeCompletion.hint ?? "", /\.alpha-hidden/);

    const hiddenRelativeCompletion = autocompletePromptBuffer(session, "open ./.");
    assert.match(hiddenRelativeCompletion.hint ?? "", /\.alpha-hidden/);

    const absoluteCompletion = autocompletePromptBuffer(session, `${cwd}/alp`);
    assert.equal(absoluteCompletion.value, `${cwd}/alpha/`);
    assert.match(absoluteCompletion.hint ?? "", /directory/);
    assert.equal(autocompletePromptBuffer(session, `${cwd}/alp`, 1).value, `${cwd}/alpine/`);

    const nextSegment = autocompletePromptBuffer(session, "open ./alpha/no");
    assert.equal(nextSegment.value, "open ./alpha/notes.md");

    const slashCommand = autocompletePromptBuffer(session, "/h");
    assert.notEqual(slashCommand.value, "/home/");
    assert.match(slashCommand.hint ?? "", /commands:/);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await rm(cwd, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("runPromptCommand updates shared action state for runtime commands", async () => {
  const { runPromptCommand } = await import("../src/cli.js");
  const session = createSession();
  const stdoutChunks: string[] = [];
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array, ..._args: unknown[]) => {
    stdoutChunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  try {
    await runPromptCommand(session, "/provider anthropic");
  } finally {
    process.stdout.write = originalWrite;
  }

  assert.equal(session.action.status, "ready");
  assert.equal(session.action.detail, "command complete");
  assert.equal(session.action.pending, false);
  assert.equal(session.provider, "anthropic");
  assert.equal(session.providerTransport.activeProvider, "anthropic");
  assert.match(stdoutChunks.join(""), /provider: anthropic/);
});

test("runPromptCommand blocks unrelated plain prompt while approval is pending", async () => {
  const { runPromptCommand } = await import("../src/cli.js");
  const session = createSession();
  session.operationControls.pendingApproval = {
    tool: "write_file",
    risk: "guarded",
    summary: "{\"path\":\"tmp/example.txt\"}",
  };

  const stderrChunks: string[] = [];
  const originalWrite = process.stderr.write;
  const originalExitCode = process.exitCode;
  process.stderr.write = ((chunk: string | Uint8Array, ..._args: unknown[]) => {
    stderrChunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;

  try {
    await runPromptCommand(session, "what happened?");
  } finally {
    process.stderr.write = originalWrite;
    process.exitCode = originalExitCode ?? 0;
  }

  assert.equal(session.operationControls.pendingApproval?.tool, "write_file");
  assert.equal(session.action.status, "error");
  assert.match(session.action.detail, /approval pending for write_file/);
  assert.match(stderrChunks.join(""), /use \/approval approve or \/approval reject/);
});

test("createRuntimeInspectPayload includes prompt v2 summaries", async () => {
  const { createRuntimeInspectPayload } = await import("../src/cli.js");
  const payload = createRuntimeInspectPayload(createSession());

  assert.equal(payload.promptV2.assembly, "v2");
  assert.match(payload.promptV2.identity, /nexagent, a local terminal-first software engineering agent/);
  assert.equal(payload.promptV2.style, "none");
  assert.match(payload.promptV2.executionContract, /Continue until task is done, verified, or genuinely blocked/);
  assert.match(payload.promptV2.toolRouting, /nexsight_gather first/);
  assert.match(payload.promptV2.providerGuidance, /Transport: Codex CLI/);
  assert.match(payload.promptV2.repoContext, /AGENTS\.md: # Repo Guardrails/);
  assert.match(payload.promptV2.repoContext, /openspec includes changes, SPEC\.md/);
  assert.match(payload.promptV2.runtimeState, /Working directory: \/repo/);
  assert.equal(payload.promptV2.stableSections, "identity, execution_contract, tool_routing, editing_safety, provider_guidance");
  assert.equal(payload.promptV2.dynamicSections, "repo_context, runtime_state");
  assert.equal(payload.promptV2.dynamicBoundary, "__NEXAGENT_PROMPT_DYNAMIC_BOUNDARY__");
  assert.equal(payload.providerTransport.executor, "codex");
  assert.equal(payload.providerTransport.adapter, "codex-cli-exec");
  assert.equal(payload.providerTransport.mode, "cli-exec");
  assert.equal(payload.providerTransport.authSource, "codex-login");
  assert.equal(payload.providerTransport.authGate, "ready");
  assert.equal(payload.providerTransport.silentFallback, false);
  assert.equal(payload.auth.loggedIn, true);
});

test("createRuntimeTuiView includes grouped instruction sources", async () => {
  const { createRuntimeTuiView } = await import("../src/cli.js");
  const view = createRuntimeTuiView(createSession());
  const instructionRows = new Map(view.instructions);
  const metadataRows = new Map(view.metadata);
  const hookRows = new Map(view.hooks);
  const authRows = new Map(view.auth);

  assert.match(instructionRows.get("repoSources") ?? "", /AGENTS\.md=AGENTS\.md: # Repo Guardrails/);
  assert.match(instructionRows.get("taskSources") ?? "", /openspec=openspec includes changes, SPEC\.md/);
  assert.equal(instructionRows.get("assembly"), "v2");
  assert.match(instructionRows.get("identity") ?? "", /nexagent, a local terminal-first software engineering agent/);
  assert.match(instructionRows.get("executionContract") ?? "", /Actionable request means act in this turn/);
  assert.match(instructionRows.get("toolRouting") ?? "", /nexsight_gather first/);
  assert.match(instructionRows.get("providerGuidance") ?? "", /Transport: Codex CLI/);
  assert.match(instructionRows.get("repoContext") ?? "", /AGENTS\.md: # Repo Guardrails/);
  assert.match(instructionRows.get("runtimeState") ?? "", /Working directory: \/repo/);
  assert.equal(instructionRows.get("style"), "none");
  assert.equal(instructionRows.get("stableSections"), "identity, execution_contract, tool_routing, editing_safety, provider_guidance");
  assert.equal(instructionRows.get("dynamicSections"), "repo_context, runtime_state");
  assert.equal(metadataRows.get("lastActivity"), "none");
  assert.equal(metadataRows.get("git"), "up to date with origin/main; clean");
  assert.equal(metadataRows.get("contextLeft"), "272000");
  assert.equal(metadataRows.get("compact"), "50% · left 272000 · compacts 0");
  assert.equal(metadataRows.get("toolPolicy"), "repo-local-guarded");
  assert.equal(metadataRows.get("approval"), "approval=off");
  assert.equal(metadataRows.get("styles"), "mouse:auto");
  const routingRows = new Map(view.routing);
  assert.equal(routingRows.get("capabilities"), "turns=bounded; tool-calls=xml-loop; approval=guarded; steer=boundary-only; model-scope=local-cli");
  assert.match(routingRows.get("caveats") ?? "", /local Codex CLI behavior/);
  assert.equal(hookRows.get("status"), "none");
  assert.equal(authRows.get("loggedIn"), "true");
  assert.equal(view.statusline, null);
});

test("createRuntimeGuiView reuses the same runtime view contract as TUI", async () => {
  const { createRuntimeGuiView, createRuntimeTuiView } = await import("../src/cli.js");
  const session = createSession();

  assert.deepEqual(createRuntimeGuiView(session), createRuntimeTuiView(session));
});

test("renderRuntimeGui formats the same runtime view", async () => {
  const { renderRuntimeGui } = await import("../src/cli.js");
  const view: RuntimeTuiView = {
    title: "nex<agent>",
    statusline: "codex | gpt-5.4 | cli-exec | ready | normal",
    metadata: [["session<id>", "abc&123"]],
    routing: [
      ["activeProvider", "codex"],
      ["transport", "codex; adapter=codex-cli-exec; mode=cli-exec; endpoint=default; auth=codex-login/ready; silent-fallback=false"],
      ["adapter", "codex-cli-exec"],
      ["mode", "cli-exec"],
      ["authSource", "codex-login"],
      ["authGate", "ready"],
      ["fallback", "require-open-spec; silent-switch=false"],
      ["models", "codex=gpt-5.4"],
    ],
    auth: [
      ["provider", "codex"],
      ["available", "true"],
      ["loggedIn", "true"],
      ["method", "ChatGPT"],
      ["status", "Logged in using ChatGPT"],
      ["checkedAt", "2025-01-01T00:00:00.000Z"],
    ],
    instructions: [["count", "2"], ["responseStyle", "none"], ["repoBehavior", "AGENTS.md=Repo agent instructions"], ["taskContext", "openspec=OpenSpec changes/specs/tasks available"]],
    mcp: [["enabled", "none"]],
    hooks: [["status", "configured"], ["source", "/repo/.claude/settings.json"], ["events", "PreToolUse"], ["commands", "1"], ["invalid", "none"]],
    imports: [["claude", "disabled"]],
    archivist: [["enabled", "false"], ["boundary", "disabled"], ["storage", "disabled"], ["persisted", "false"], ["retrieval", "idle"], ["retrievalPreview", "none"], ["writes", "idle"], ["writePreview", "none"]],
  };

  assert.equal(
    renderRuntimeGui(view),
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>nex&lt;agent&gt;</title>
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
    <h1>nex&lt;agent&gt;</h1>
    <section>
      <h2>runtime</h2>
      <dl>
        <dt>session&lt;id&gt;</dt><dd>abc&amp;123</dd>
      </dl>
    </section>
    <section>
      <h2>routing</h2>
      <dl>
        <dt>activeProvider</dt><dd>codex</dd>
        <dt>transport</dt><dd>codex; adapter=codex-cli-exec; mode=cli-exec; endpoint=default; auth=codex-login/ready; silent-fallback=false</dd>
        <dt>adapter</dt><dd>codex-cli-exec</dd>
        <dt>mode</dt><dd>cli-exec</dd>
        <dt>authSource</dt><dd>codex-login</dd>
        <dt>authGate</dt><dd>ready</dd>
        <dt>fallback</dt><dd>require-open-spec; silent-switch=false</dd>
        <dt>models</dt><dd>codex=gpt-5.4</dd>
      </dl>
    </section>
    <section>
      <h2>auth</h2>
      <dl>
        <dt>provider</dt><dd>codex</dd>
        <dt>available</dt><dd>true</dd>
        <dt>loggedIn</dt><dd>true</dd>
        <dt>method</dt><dd>ChatGPT</dd>
        <dt>status</dt><dd>Logged in using ChatGPT</dd>
        <dt>checkedAt</dt><dd>2025-01-01T00:00:00.000Z</dd>
      </dl>
    </section>
    <section>
      <h2>instructions</h2>
      <dl>
        <dt>count</dt><dd>2</dd>
        <dt>responseStyle</dt><dd>none</dd>
        <dt>repoBehavior</dt><dd>AGENTS.md=Repo agent instructions</dd>
        <dt>taskContext</dt><dd>openspec=OpenSpec changes/specs/tasks available</dd>
      </dl>
    </section>
    <section>
      <h2>mcp</h2>
      <dl>
        <dt>enabled</dt><dd>none</dd>
      </dl>
    </section>
    <section>
      <h2>hooks</h2>
      <dl>
        <dt>status</dt><dd>configured</dd>
        <dt>source</dt><dd>/repo/.claude/settings.json</dd>
        <dt>events</dt><dd>PreToolUse</dd>
        <dt>commands</dt><dd>1</dd>
        <dt>invalid</dt><dd>none</dd>
      </dl>
    </section>
    <section>
      <h2>imports</h2>
      <dl>
        <dt>claude</dt><dd>disabled</dd>
      </dl>
    </section>
    <section>
      <h2>archivist</h2>
      <dl>
        <dt>enabled</dt><dd>false</dd>
        <dt>boundary</dt><dd>disabled</dd>
        <dt>storage</dt><dd>disabled</dd>
        <dt>persisted</dt><dd>false</dd>
        <dt>retrieval</dt><dd>idle</dd>
        <dt>retrievalPreview</dt><dd>none</dd>
        <dt>writes</dt><dd>idle</dd>
        <dt>writePreview</dt><dd>none</dd>
      </dl>
    </section>
  </main>
</body>
</html>
`,
  );
});
