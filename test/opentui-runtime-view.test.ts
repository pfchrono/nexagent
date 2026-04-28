import assert from "node:assert/strict";
import { test } from "bun:test";

import { createOpenTuiRuntimeView } from "../src/opentui/runtime-view.js";
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
  });
  assert.equal(JSON.stringify(session.action), before);
});

function createSession(): RuntimeSession {
  return {
    id: "session_test",
    startedAt: "2025-01-01T00:00:00.000Z",
    product: "nexagent",
    provider: "codex",
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
