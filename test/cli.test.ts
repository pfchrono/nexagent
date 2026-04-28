import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import type { RuntimeTuiView } from "../src/cli.js";
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
  assert.match(output, /◜◆◝ Bootstrapping/);
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

test("parseCommand preserves empty run prompt for resolvePrompt", async () => {
  const { parseCommand } = await import("../src/cli.js");

  assert.deepEqual(parseCommand([]), { kind: "inspect", yolo: false });
  assert.deepEqual(parseCommand(["run", "say", "hi"]), { kind: "run", prompt: "say hi", yolo: false });
  assert.deepEqual(parseCommand(["run"]), { kind: "run", prompt: null, yolo: false });
  assert.deepEqual(parseCommand(["--yolo"]), { kind: "inspect", yolo: true });
  assert.deepEqual(parseCommand(["--yolo", "run", "say", "hi"]), { kind: "run", prompt: "say hi", yolo: true });
  assert.deepEqual(parseCommand(["run", "--yolo", "say", "hi"]), { kind: "run", prompt: "say hi", yolo: true });
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

test("formatProgressChrome keeps semantic verb stable while emblem animates", async () => {
  const { formatProgressChrome } = await import("../src/cli.js");

  assert.equal(
    formatProgressChrome(0, { status: "ready", detail: "runtime baseline" }),
    "◜◆◝ Bootstrapping · ready · runtime baseline",
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

function createSession(provider = "codex"): RuntimeSession {
  return {
    id: "session_test",
    startedAt: "2025-01-01T00:00:00.000Z",
    product: "nexagent",
    provider,
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
      lastDecision: null,
      cancelRequested: false,
      activeAbortController: null,
      steerMessage: null,
      steerState: null,
      lastAppliedSteer: null,
      steerHistory: [],
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
    "/reload - reload runtime state from repo config",
    "/quit - exit interactive TTY session",
    "/provider [status|name|transport ...] [--verbose] - show or switch provider and transport mode",
    "/skill [name] [args...] - list skills or resolve and route a skill by name",
    "/mouse [status|mode <auto|scroll|select>] - show or set transcript mouse interaction mode",
    "/memory [--verbose|save <text>|checkpoint [reason]|session [focus]] - inspect or persist archivist memory/checkpoints",
    "/attach <image-path> - attach local image for next prompt (http transports only)",
    "/detach - clear queued image attachment",
  ];
  for (const line of required) {
    assert.ok(outputLines.includes(line), `${line} missing`);
  }
  assert.equal(result?.activity, "help");
});

test("runRuntimeCommand shows and sets model for active provider", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();

  assert.deepEqual(runRuntimeCommand(session, "/model"), {
    ok: true,
    output: "provider: codex\ncurrent: gpt-5.4\navailable: gpt-5.4, gpt-5.5, gpt-5.4-mini, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.2",
    activity: "model status · codex",
  });

  assert.deepEqual(runRuntimeCommand(session, "/model gpt-5.5"), {
    ok: true,
    output: "provider: codex\ncurrent: gpt-5.5\navailable: gpt-5.4, gpt-5.5, gpt-5.4-mini, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.2",
    activity: "model set · gpt-5.5",
  });
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
  assert.match(result?.output ?? "", /summary: present/);
  assert.match(result?.output ?? "", /compacts: 1/);
  assert.match(result?.output ?? "", /last-compact: 7 ->/);
});

test("runRuntimeCommand toggles caveman mode", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();

  const result = runRuntimeCommand(session, "/caveman-mode on");

  assert.deepEqual(result, {
    ok: true,
    output: "Caveman mode ON. Style stack: caveman + mouse:auto.",
    activity: "caveman mode on",
  });
  assert.equal(session.commandModes.cavemanMode, true);
});

test("runRuntimeCommand toggles deadpool mode", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();
  session.commandModes.cavemanMode = true;

  const result = runRuntimeCommand(session, "/deadpoolmode on");

  assert.deepEqual(result, {
    ok: true,
    output: "Deadpool mode ON. Style stack: deadpool + caveman + mouse:auto.",
    activity: "deadpool mode on",
  });
  assert.equal(session.commandModes.deadpoolMode, true);
});

test("runRuntimeCommand toggles statusline", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();

  const result = runRuntimeCommand(session, "/statusline on");

  assert.deepEqual(result, {
    ok: true,
    output: "Statusline ON. Footer now shows codex | gpt-5.4 | cli-exec | ready | approval=off | mouse=auto/scroll | mouse:auto | in~0 out~0 | ctx~272000.",
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
  const result = runRuntimeCommand(createSession(), "/nope");

  assert.deepEqual(result, {
    ok: false,
    message: "unknown command /nope; use /help",
    activity: "command failed · /nope",
  });
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

    const verboseMemory = runRuntimeCommand(session, "/memory --verbose");
    assert.equal(verboseMemory?.ok, true);
    assert.equal(verboseMemory?.activity, "memory status");
    assert.match(verboseMemory?.output ?? "", /^memory$/m);
    assert.match(verboseMemory?.output ?? "", /^enabled: false$/m);
    assert.match(verboseMemory?.output ?? "", /^retrieval: idle$/m);
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

test("runRuntimeCommand blocks reading outside repo-local roots", async () => {
  const { runRuntimeCommand } = await import("../src/cli.js");
  const session = createSession();

  assert.deepEqual(runRuntimeCommand(session, "/read ../secrets.txt"), {
    ok: false,
    message: "tool policy blocked /secrets.txt; outside repo-local roots",
    activity: "command blocked · /secrets.txt",
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

test("createRuntimeInspectPayload includes instruction layer summaries", async () => {
  const { createRuntimeInspectPayload } = await import("../src/cli.js");
  const payload = createRuntimeInspectPayload(createSession());

  assert.equal(payload.instructionLayers.count, 29);
  assert.match(payload.instructionLayers.identity, /nexagent, local coding harness assistant/);
  assert.equal(payload.instructionLayers.responseStyle, "none");
  assert.match(payload.instructionLayers.executionGuidance, /Read relevant code before changing behavior/);
  assert.match(payload.instructionLayers.repoBehavior, /AGENTS\.md: # Repo Guardrails/);
  assert.match(payload.instructionLayers.taskContext, /OpenSpec artifacts as current task context/);
  assert.match(payload.instructionLayers.taskContext, /openspec includes changes, SPEC\.md/);
  assert.match(payload.instructionLayers.toolAvailability, /Working directory: \/repo/);
  assert.match(payload.instructionLayers.toolAvailability, /Available internal tools: read_file, write_file, apply_patch, list_dir, search_content, search_files, git_status, git_diff, shell_command, archivist_save, archivist_checkpoint/);
  assert.match(payload.instructionLayers.providerFallback, /Active provider: codex/);
  assert.equal(payload.instructionLayers.stableSections, "identity, executionGuidance, repoBehavior, taskContext, toolAvailability, providerFallback");
  assert.equal(payload.instructionLayers.dynamicSections, "archivistContext");
  assert.equal(payload.instructionLayers.dynamicBoundary, "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__");
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
  assert.match(instructionRows.get("identity") ?? "", /nexagent, local coding harness assistant/);
  assert.match(instructionRows.get("executionGuidance") ?? "", /Use repo-local instructions and configuration as primary operating contract/);
  assert.match(instructionRows.get("repoBehavior") ?? "", /AGENTS\.md: # Repo Guardrails/);
  assert.match(instructionRows.get("taskContext") ?? "", /OpenSpec artifacts as current task context/);
  assert.equal(instructionRows.get("responseStyle"), "none");
  assert.equal(instructionRows.get("stableSections"), "identity, executionGuidance, repoBehavior, taskContext, toolAvailability, providerFallback");
  assert.equal(instructionRows.get("dynamicSections"), "archivistContext");
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
