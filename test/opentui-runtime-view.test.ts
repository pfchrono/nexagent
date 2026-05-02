import assert from "node:assert/strict";
import { test } from "bun:test";

import { createLocalOutputBlock, createOpenTuiRuntimeView } from "../src/opentui/runtime-view.js";
import { createDefaultProviderRegistry } from "../src/provider/registry.js";
import type { RuntimeSession } from "../src/runtime/session.js";

test("createOpenTuiRuntimeView maps runtime session without mutation", () => {
  const session = createSession();
  const before = JSON.stringify(session.action);

  const view = createOpenTuiRuntimeView(session);

  assert.deepEqual(view, {
    product: "nexagent",
    sessionId: "session_test",
    provider: "codex",
    model: "gpt-5.4",
    cwd: "/repo",
    status: "ready",
    detail: "runtime baseline",
    turnCount: 2,
    approval: "open",
    toolPolicy: "repo-local-guarded",
    providerTransportMode: "cli-exec",
    imageAttachmentSupported: false,
    headerTitle: "nexagent :: agent tui",
    providerLabel: "codex/gpt-5.4",
    sessionLabel: "session session_test | turns 2",
    statusLabel: "ready - runtime baseline",
    cwdLabel: "/repo",
    transcriptLines: [],
    transcriptBlocks: [],
    composerHint: "",
    footerLabel: "approval open | tools repo-local-guarded",
    traceCollapsedLabel: "trace closed - Ctrl+T expand",
    traceExpandedLabel: "trace open - Ctrl+T collapse",
    traceSummaryLines: ["no turn events"],
    traceDetailLines: ["trace empty"],
    traceBlocks: [{
      id: "empty-trace",
      kind: "trace",
      label: "trace",
      summaryLines: ["trace empty"],
      detailLines: ["trace empty"],
      collapsedByDefault: false,
    }],
    cockpit: {
      approval: {
        mode: "open",
        pendingTool: null,
        lastDecision: "none",
        hints: ["/approval approve", "/approval reject"],
      },
      warnings: [],
      ladder: {
        intent: "idle",
        plan: "ready",
        act: "idle",
        result: "pending",
      },
      overrideHints: ["Ctrl+Q quit", "/cancel", "/steer <message>", "/approval status"],
      memory: {
        active: "session context active",
        retrieved: "retrieved context idle",
        checkpoints: "checkpoints idle",
      },
      risk: "pending · approval open",
    },
    statusline: {
      model: "gpt-5.4",
      branch: "main",
      repoName: "repo",
      sessionAge: "0s",
      memoryUsedBytes: view.statusline.memoryUsedBytes,
      memoryTotalBytes: view.statusline.memoryTotalBytes,
      contextUsed: 0,
      contextWindow: 272000,
      contextPercent: 0,
      lastInputTokens: 0,
      lastOutputTokens: 0,
    },
  });
  assert.ok(view.statusline.memoryTotalBytes > 0);
  assert.ok(view.statusline.memoryUsedBytes >= 0);
  assert.ok(view.statusline.memoryUsedBytes <= view.statusline.memoryTotalBytes);
  assert.equal(JSON.stringify(session.action), before);
});

test("createOpenTuiRuntimeView maps transcript and trace lines", () => {
  const session = createSession();
  session.conversation = [
    { role: "user", content: "inspect repo\nsecond line", tokens: 2 },
    { role: "assistant", content: "done", tokens: 1 },
  ];
  session.events = [
    {
      at: "2025-01-01T00:00:01.000Z",
      kind: "provider",
      status: "started",
      summary: "provider request started",
      detail: "transport=codex-http",
    },
    {
      at: "2025-01-01T00:00:02.000Z",
      kind: "tool",
      status: "completed",
      summary: "tool nexsight_execute completed",
      detail: "out~12",
    },
  ];

  const view = createOpenTuiRuntimeView(session);

  assert.deepEqual(view.transcriptLines, ["you: inspect repo second line", "agent: done"]);
  assert.deepEqual(view.transcriptBlocks.map((block) => block.label), ["you", "agent"]);
  assert.equal(view.transcriptBlocks[0]?.kind, "user");
  assert.equal(view.transcriptBlocks[1]?.kind, "assistant");
  assert.deepEqual(view.traceSummaryLines, [
    "provider started - provider request started",
    "tool completed - tool nexsight_execute completed",
  ]);
  assert.match(view.traceDetailLines.join("\n"), /transport=codex-http/);
  assert.equal(view.traceBlocks.length, 1);
  assert.equal(view.traceBlocks[0]?.collapsedByDefault, true);
  assert.match(view.traceBlocks[0]?.summaryLines[0] ?? "", /provider request started/);
  assert.match(view.traceBlocks[0]?.summaryLines[1] ?? "", /more lines; expand/);
  assert.match(view.traceBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /transport=codex-http/);
});

test("createOpenTuiRuntimeView keeps one expanded trace block with full event detail", () => {
  const session = createSession();
  session.events = [
    {
      at: "2025-01-01T00:00:01.000Z",
      kind: "prompt",
      status: "queued",
      summary: "user prompt accepted",
      detail: "inspect tools",
    },
    {
      at: "2025-01-01T00:00:02.000Z",
      kind: "provider",
      status: "failed",
      summary: "codex response failed",
      detail: "line one\nline two with exact detail\nline three",
    },
  ];

  const view = createOpenTuiRuntimeView(session);

  assert.equal(view.traceBlocks.length, 1);
  assert.equal(view.traceBlocks[0]?.label, "turn trace");
  assert.match(view.traceBlocks[0]?.detailLines.join("\n") ?? "", /line two with exact detail/);
  assert.match(view.traceBlocks[0]?.detailLines.join("\n") ?? "", /provider \| failed/);
});

test("createOpenTuiRuntimeView keeps pending prompt visible after prior conversation", () => {
  const session = createSession();
  session.conversation = [
    { role: "user", content: "Hello!", tokens: 1 },
    { role: "assistant", content: "Hi! How can I help?", tokens: 5 },
  ];
  session.events = [
    {
      at: "2025-01-01T00:00:01.000Z",
      kind: "prompt",
      status: "queued",
      summary: "user prompt accepted",
      detail: "Hello!",
    },
    {
      at: "2025-01-01T00:00:02.000Z",
      kind: "assistant",
      status: "completed",
      summary: "assistant response completed",
      detail: "Hi! How can I help?",
    },
    {
      at: "2025-01-01T00:00:03.000Z",
      kind: "prompt",
      status: "queued",
      summary: "user prompt accepted",
      detail: "What tools and mcp tools do you have?",
    },
  ];

  const view = createOpenTuiRuntimeView(session);

  assert.deepEqual(view.transcriptBlocks.map((block) => block.label), ["you", "agent", "you"]);
  assert.equal(view.transcriptBlocks[2]?.kind, "user");
  assert.match(view.transcriptBlocks[2]?.detailLines.join("\n") ?? "", /What tools and mcp tools/);
});

test("createOpenTuiRuntimeView orders chat by prompt and assistant events", () => {
  const session = createSession();
  session.conversation = [
    { role: "user", content: "first", tokens: 1 },
    { role: "assistant", content: "first ack", tokens: 2 },
    { role: "user", content: "second", tokens: 1 },
    { role: "assistant", content: "second ack", tokens: 2 },
  ];
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "first" },
    { at: "2025-01-01T00:00:02.000Z", kind: "assistant", status: "completed", summary: "assistant response completed", detail: "first ack" },
    { at: "2025-01-01T00:00:03.000Z", kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "second" },
    { at: "2025-01-01T00:00:04.000Z", kind: "assistant", status: "completed", summary: "assistant response completed", detail: "second ack" },
    { at: "2025-01-01T00:00:05.000Z", kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "third" },
    { at: "2025-01-01T00:00:06.000Z", kind: "assistant", status: "failed", summary: "assistant failed", detail: "third failed" },
  ];

  const view = createOpenTuiRuntimeView(session);

  assert.deepEqual(view.transcriptBlocks.map((block) => block.label), ["you", "agent", "you", "agent", "you", "agent"]);
  assert.deepEqual(view.transcriptBlocks.map((block) => block.detailLines[0]), ["first", "first ack", "second", "second ack", "third", "third failed"]);
});

test("createOpenTuiRuntimeView orders chat by prompt, tools, and assistant events", () => {
  const session = createSession();
  session.conversation = [
    { role: "user", content: "run search", tokens: 2 },
    { role: "assistant", content: "found it", tokens: 2 },
  ];
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "run search" },
    { at: "2025-01-01T00:00:02.000Z", kind: "tool", status: "started", summary: "tool search_files started", detail: "read-only; args={\"pattern\":\"turn\"}" },
    { at: "2025-01-01T00:00:03.000Z", kind: "tool", status: "completed", summary: "tool search_files completed", detail: "read-only; duration=0.04s; in~3; out~9; output=src/opentui/App.tsx" },
    { at: "2025-01-01T00:00:04.000Z", kind: "assistant", status: "completed", summary: "assistant response completed", detail: "found it" },
  ];

  const view = createOpenTuiRuntimeView(session);

  assert.deepEqual(view.transcriptBlocks.map((block) => block.kind), ["user", "tool", "tool", "assistant"]);
  assert.deepEqual(view.transcriptBlocks.map((block) => block.label), ["you", "tool search_files", "tool search_files · 0.04s ↓ 3 ↑ 9", "agent"]);
  assert.match(view.transcriptBlocks[1]?.detailLines.join("\n") ?? "", /started · tool search_files started/);
  assert.match(view.transcriptBlocks[2]?.detailLines.join("\n") ?? "", /0\.04s ↓ 3 ↑ 9/);
  assert.match(view.transcriptBlocks[2]?.detailLines.join("\n") ?? "", /output=src\/opentui\/App\.tsx/);
  assert.equal(view.statusline.lastInputTokens, 3);
  assert.equal(view.statusline.lastOutputTokens, 9);
});

test("createOpenTuiRuntimeView keeps command output out of chat and available in trace", () => {
  const session = createSession();
  session.conversation = [
    { role: "user", content: "show memory", tokens: 2 },
    { role: "assistant", content: "memory checked", tokens: 2 },
  ];
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "show memory" },
    { at: "2025-01-01T00:00:02.000Z", kind: "command", status: "completed", summary: "memory status", detail: "memory\nenabled: true\nmatches=3" },
    { at: "2025-01-01T00:00:03.000Z", kind: "assistant", status: "completed", summary: "assistant response completed", detail: "memory checked" },
  ];

  const view = createOpenTuiRuntimeView(session);

  assert.deepEqual(view.transcriptBlocks.map((block) => block.kind), ["user", "assistant"]);
  assert.deepEqual(view.transcriptBlocks.map((block) => block.detailLines[0]), ["show memory", "memory checked"]);
  assert.doesNotMatch(view.transcriptBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /matches=3/);
  assert.match(view.traceBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /command \| completed/);
  assert.match(view.traceBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /matches=3/);
});

test("createOpenTuiRuntimeView renders active skill prompts as compact skill rows", () => {
  const session = createSession();
  session.conversation = [
    { role: "user", content: "skill -> gsd-stats", tokens: 2 },
    { role: "assistant", content: "stats complete", tokens: 2 },
  ];
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "prompt", status: "queued", summary: "active skill gsd-stats requested", detail: "skill -> gsd-stats" },
    { at: "2025-01-01T00:00:02.000Z", kind: "assistant", status: "completed", summary: "assistant response completed", detail: "stats complete" },
  ];

  const view = createOpenTuiRuntimeView(session);

  assert.equal(view.transcriptBlocks[0]?.kind, "skill");
  assert.equal(view.transcriptBlocks[0]?.label, "skill -> gsd-stats");
  assert.equal(view.transcriptBlocks[0]?.collapsedByDefault, true);
  assert.deepEqual(view.transcriptBlocks[0]?.summaryLines, ["skill -> gsd-stats"]);
  assert.equal(view.transcriptBlocks[1]?.kind, "assistant");
});

test("createOpenTuiRuntimeView surfaces compaction progress when no chat turn exists", () => {
  const session = createSession();
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "compact", status: "started", summary: "manual compaction started" },
    { at: "2025-01-01T00:00:02.000Z", kind: "compact", status: "completed", summary: "manual compaction completed", detail: "summary=present · turns=4 · tokens=14000->2400" },
  ];

  const view = createOpenTuiRuntimeView(session);

  assert.deepEqual(view.transcriptBlocks.map((block) => block.kind), ["system", "system"]);
  assert.match(view.transcriptBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /manual compaction started/);
  assert.match(view.transcriptBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /tokens=14000->2400/);
});

test("OpenTUI short command output stays expanded by default", () => {
  const lines = Array.from({ length: 12 }, (_, index) => `help line ${String(index + 1)}`);

  const block = createLocalOutputBlock("local-help", lines);

  assert.equal(block.collapsedByDefault, false);
  assert.deepEqual(block.summaryLines, lines);
  assert.deepEqual(block.detailLines, lines);
});

test("OpenTUI huge command output is capped until expanded", () => {
  const lines = Array.from({ length: 36 }, (_, index) => `output line ${String(index + 1)}`);

  const block = createLocalOutputBlock("local-long", lines);

  assert.equal(block.collapsedByDefault, true);
  assert.equal(block.summaryLines.length, 31);
  assert.equal(block.summaryLines[0], "output line 1");
  assert.equal(block.summaryLines[29], "output line 30");
  assert.match(block.summaryLines[30] ?? "", /\.\.\. truncated 6 more lines; expand for full output/);
  assert.equal(block.detailLines.length, 36);
});

test("OpenTUI assistant replies preserve multiline content and cap huge replies", () => {
  const session = createSession();
  session.conversation = [
    {
      role: "assistant",
      content: Array.from({ length: 32 }, (_, index) => `reply line ${String(index + 1)}`).join("\n"),
      tokens: 32,
    },
  ];

  const view = createOpenTuiRuntimeView(session);
  const block = view.transcriptBlocks[0];

  assert.equal(block?.kind, "assistant");
  assert.equal(block?.collapsedByDefault, true);
  assert.equal(block?.summaryLines.length, 31);
  assert.equal(block?.detailLines.length, 32);
  assert.equal(block?.detailLines[1], "reply line 2");
});

test("OpenTUI cockpit view maps approval warnings ladder and memory split", () => {
  const session = createSession();
  session.operationControls.requireApprovalForGuarded = true;
  session.operationControls.pendingApproval = {
    tool: "write_file",
    risk: "guarded",
    summary: "write tmp/example.txt",
  };
  session.operationControls.steerMessage = "use smaller patch";
  session.operationControls.steerState = "queued";
  session.archivist.retrieval = { used: true, sourceCategory: "memory", matchCount: 2, preview: "hidden preview" };
  session.archivist.writes = { used: true, action: "checkpoint", sourceCategory: "session", savedAt: "2026-04-30T00:00:00.000Z", entryCount: 1, preview: "hidden write" };
  session.archivist.diagnostics = {
    retrievalMatchCount: 2,
    retrievalSourceCategory: "memory",
    saveCount: 4,
    checkpointCount: 1,
    duplicateSuspectCount: 1,
    staleSignalCount: 2,
    noisySignalCount: 3,
  };
  session.events = [
    {
      at: "2026-04-30T00:00:01.000Z",
      kind: "prompt",
      status: "completed",
      summary: "build cockpit",
    },
    {
      at: "2026-04-30T00:00:02.000Z",
      kind: "tool",
      status: "queued",
      summary: "tool write_file queued",
    },
  ];

  const view = createOpenTuiRuntimeView(session);

  assert.equal(view.cockpit.approval.mode, "guarded");
  assert.equal(view.cockpit.approval.pendingTool, "write_file");
  assert.deepEqual(view.cockpit.approval.hints, ["/approval approve", "/approval reject"]);
  assert.equal(view.cockpit.warnings[0]?.type, "approval");
  assert.match(view.cockpit.warnings.map((warning) => warning.action).join("\n"), /approval approve/);
  assert.equal(view.cockpit.ladder.intent, "build cockpit");
  assert.equal(view.cockpit.ladder.act, "tool write_file queued");
  assert.match(view.cockpit.memory.retrieved, /2 match/);
  assert.match(view.cockpit.memory.checkpoints, /checkpoint/);
  assert.doesNotMatch(JSON.stringify(view.cockpit.memory), /hidden preview|hidden write/);
});

test("OpenTUI memory diagnostics fallback is counts-only", () => {
  const session = createSession();
  session.archivist.retrieval = { used: false, sourceCategory: null, matchCount: 0, preview: "hidden retrieval" };
  session.archivist.writes = { used: false, action: null, sourceCategory: null, savedAt: null, entryCount: 0, preview: "hidden write" };
  session.archivist.diagnostics = {
    retrievalMatchCount: 0,
    retrievalSourceCategory: null,
    saveCount: 4,
    checkpointCount: 1,
    duplicateSuspectCount: 1,
    staleSignalCount: 2,
    noisySignalCount: 3,
  };

  const view = createOpenTuiRuntimeView(session);

  assert.equal(view.cockpit.memory.checkpoints, "memory signal · dup 1 · stale 2");
  assert.doesNotMatch(JSON.stringify(view.cockpit.memory), /hidden retrieval|hidden write/);
});

function createSession(): RuntimeSession {
  return {
    id: "session_test",
    startedAt: "2025-01-01T00:00:00.000Z",
    product: "nexagent",
    provider: "codex",
    providerRegistry: createDefaultProviderRegistry(),
    providerRouting: {
      fallback: { policy: "require-open-spec", silentProviderSwitch: false },
      modelSelection: {
        activeProvider: "codex",
        configuredModels: { codex: "gpt-5.4" },
      },
      transport: {},
    },
    providerTransport: {
      executor: "codex",
      adapter: "codex-cli-exec",
      mode: "cli-exec",
      authSource: "codex-login",
      authGate: "ready",
      activeProvider: "codex",
      openaiBaseUrl: null,
      silentFallback: false,
    },
    commandModes: { cavemanMode: false, deadpoolMode: false, statusline: false },
    operationDefaults: { requireApprovalForGuarded: false },
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
      protectedRoots: ["/etc"],
      shell: "limited",
      writes: "guarded",
      deletes: "blocked",
    },
    mcpServers: [],
    enabledMcpServers: [],
    imports: { claude: null },
    hooks: { sourcePath: null, status: "none", events: [], commandCount: 0, invalidEntries: [] },
    auth: {
      provider: "codex",
      available: true,
      loggedIn: true,
      method: "ChatGPT",
      status: "Logged in using ChatGPT",
      checkedAt: "2025-01-01T00:00:00.000Z",
    },
    instructionSources: [],
    archivist: {
      enabled: false,
      boundary: "disabled",
      storagePath: null,
      storageExists: false,
      retrieval: { used: false, sourceCategory: null, matchCount: 0, preview: null },
      writes: { used: false, action: null, sourceCategory: null, savedAt: null, entryCount: 0, preview: null },
    },
    action: { status: "ready", detail: "runtime baseline", pending: false, lastActivity: null },
    telemetry: { turnCount: 2, lastInputTokens: 0, lastOutputTokens: 0 },
    events: [],
    operationControls: {
      requireApprovalForGuarded: false,
      yoloMode: false,
      pendingApproval: null,
      lastDecision: null,
      cancelRequested: false,
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
