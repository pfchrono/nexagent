import assert from "node:assert/strict";
import { test } from "bun:test";

import { createOpenTuiRuntimeView } from "../src/opentui/runtime-view.js";
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
    headerTitle: "nexagent :: opentui",
    providerLabel: "codex/gpt-5.4",
    sessionLabel: "session session_test | turns 2",
    statusLabel: "ready - runtime baseline",
    cwdLabel: "/repo",
    transcriptLines: ["No transcript yet"],
    transcriptBlocks: [{
      id: "empty-transcript",
      kind: "system",
      label: "system",
      summaryLines: ["No transcript yet"],
      detailLines: ["No transcript yet"],
      collapsedByDefault: false,
    }],
    composerHint: "Type prompt. Enter submit. Esc clear/cancel. Ctrl+Q quit.",
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
      collapsedByDefault: true,
    }],
  });
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
  assert.equal(view.traceBlocks[0]?.collapsedByDefault, true);
  assert.match(view.traceBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /transport=codex-http/);
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
