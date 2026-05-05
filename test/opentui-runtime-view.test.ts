import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "bun:test";

import { createLocalOutputBlock, createOpenTuiRuntimeView } from "../src/opentui/runtime-view.js";
import { createDefaultProviderRegistry } from "../src/provider/registry.js";
import { touchLspFileSync } from "../src/runtime/lsp.js";
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
    headerTitle: "nexagent",
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
    configSections: [
      {
        title: "provider",
        rows: ["active codex", "transport cli-exec", "auth ready"],
      },
      {
        title: "ui",
        rows: ["logo full", "mouse undefined", "statusline off"],
      },
      {
        title: "memory",
        rows: ["archivist off", "storage disabled", "retrieval idle"],
      },
      {
        title: "mcp",
        rows: ["configured 0", "hydrated 0/0", "tools 0", "failed none"],
      },
      {
        title: "lsp",
        rows: ["status disabled", "enabled off", "configured no", "command none", "source disabled", "problems 0", "lastTouched none", "indexArchivist off"],
      },
      {
        title: "diagnostics",
        rows: ["sentry /status --sentry", "redaction tags-only"],
      },
    ],
    lspProblems: {
      visible: false,
      count: 0,
      lastTouched: null,
      source: "disabled",
      rows: [],
    },
    logo: {
      mode: "full",
      frames: [
        "nexagent  ◜◆◝  terminal agent",
        "nexagent  ◠◆◡  terminal agent",
        "nexagent  ◟◆◞  terminal agent",
        "nexagent  ◡◆◠  terminal agent",
      ],
      metadata: "codex/gpt-5.4 · cli-exec · repo · main · cfg:full",
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

test("createOpenTuiRuntimeView maps config sections and logo modes", () => {
  const session = createSession();
  session.ui = { logoMode: "condensed" };
  session.lsp = { enabled: true, command: "typescript-language-server", args: ["--stdio"], indexArchivist: true };
  session.commandModes.mouseMode = "scroll";
  session.archivist.enabled = true;
  session.archivist.storagePath = "/repo/.nexagent/archivist.json";
  session.archivist.retrieval = { used: true, sourceCategory: "failure-playbook", matchCount: 1, preview: "tool retry" };

  const view = createOpenTuiRuntimeView(session);

  assert.equal(view.logo.mode, "condensed");
  assert.match(view.logo.frames[0] ?? "", /nexagent/);
  assert.match(view.logo.metadata, /cfg:condensed/);
  assert.deepEqual(view.configSections.map((section) => section.title), ["provider", "ui", "memory", "mcp", "lsp", "diagnostics"]);
  const lspRows = view.configSections.find((section) => section.title === "lsp")?.rows ?? [];
  assert.match(lspRows.join("\n"), /^status (ready|fallback)$/m);
  assert.deepEqual(lspRows.slice(1, 4), [
    "enabled on",
    "configured yes",
    "command typescript-language-server",
  ]);
  assert.match(lspRows.join("\n"), /^source (language-server|typescript-service)$/m);
  assert.match(lspRows.join("\n"), /^problems 0$/m);
  assert.match(lspRows.join("\n"), /^lastTouched none$/m);
  assert.match(lspRows.join("\n"), /^indexArchivist on$/m);
  assert.match(view.configSections.find((section) => section.title === "memory")?.rows.join("\n") ?? "", /failure-playbook/);
});

test("createOpenTuiRuntimeView exposes compact LSP problems panel data", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-opentui-lsp-problems-"));
  try {
    await writeFile(path.join(cwd, "sample.ts"), "export const value = 1;\n// TODO fix this\n", "utf8");
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.lsp = { enabled: true, command: "typescript-language-server", args: ["--stdio"], indexArchivist: false };
    touchLspFileSync(session, "sample.ts");

    const view = createOpenTuiRuntimeView(session);

    assert.equal(view.lspProblems.visible, true);
    assert.equal(view.lspProblems.count, 1);
    assert.equal(view.lspProblems.lastTouched, "sample.ts");
    assert.deepEqual(view.lspProblems.rows, [
      "Problems",
      "1 issue",
      "last sample.ts",
      "/lsp diagnostics sample.ts",
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("createOpenTuiRuntimeView surfaces MCP hydration health", () => {
  const session = createSession();
  session.mcpServers = ["filesystem", "sentry"];
  session.mcpRegistry = {
    serverNames: ["filesystem", "sentry"],
    servers: {},
    tools: [
      { server: "filesystem", name: "read_file", description: "read", inputSchema: {} },
      { server: "filesystem", name: "search", description: "search", inputSchema: {} },
    ],
    statuses: [
      { name: "filesystem", transport: "stdio", status: "hydrated", toolCount: 2, startupTimeoutMs: 10000, message: null },
      { name: "sentry", transport: "stdio", status: "failed", toolCount: 0, startupTimeoutMs: 10000, message: "Authorization Expired" },
    ],
    clients: new Map(),
  };

  const view = createOpenTuiRuntimeView(session);

  assert.deepEqual(view.configSections.find((section) => section.title === "mcp")?.rows, [
    "configured 2",
    "hydrated 1/2",
    "tools 2",
    "failed sentry",
  ]);
  assert.deepEqual(view.cockpit.warnings.find((warning) => warning.type === "mcp"), {
    severity: "warning",
    type: "mcp",
    message: "MCP failed: sentry",
    action: "/config or /status --sentry",
  });
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
    "↗ Provider started · provider request started",
    "◇ Done Nexsight · ↑ 12",
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
  assert.match(view.traceBlocks[0]?.detailLines.join("\n") ?? "", /Provider failed/);
  assert.match(view.traceBlocks[0]?.detailLines.join("\n") ?? "", /kind provider · status failed/);
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
  assert.deepEqual(view.transcriptBlocks.map((block) => block.label), ["you", "🔎 Running Search files", "🔎 Done Search files · 0.04s ↓ 3 ↑ 9", "agent"]);
  assert.match(view.transcriptBlocks[1]?.detailLines.join("\n") ?? "", /🔎 Running Search files/);
  assert.match(view.transcriptBlocks[2]?.detailLines.join("\n") ?? "", /0\.04s ↓ 3 ↑ 9/);
  assert.match(view.transcriptBlocks[2]?.detailLines.join("\n") ?? "", /output=src\/opentui\/App\.tsx/);
  assert.equal(view.statusline.lastInputTokens, 3);
  assert.equal(view.statusline.lastOutputTokens, 9);
});

test("createOpenTuiRuntimeView groups repeated collapsed tool trace blocks", () => {
  const session = createSession();
  session.conversation = [
    { role: "user", content: "inspect with nexsight", tokens: 2 },
    { role: "assistant", content: "done", tokens: 1 },
  ];
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "inspect with nexsight" },
    { at: "2025-01-01T00:00:02.000Z", kind: "tool", status: "started", summary: "tool nexsight_execute started", detail: "low; args={\"reason\":\"one\"}" },
    { at: "2025-01-01T00:00:03.000Z", kind: "tool", status: "completed", summary: "tool nexsight_execute completed", detail: "low; duration=0.04s; in~10; out~20; output=one" },
    { at: "2025-01-01T00:00:04.000Z", kind: "tool", status: "started", summary: "tool nexsight_execute started", detail: "low; args={\"reason\":\"two\"}" },
    { at: "2025-01-01T00:00:05.000Z", kind: "tool", status: "completed", summary: "tool nexsight_execute completed", detail: "low; duration=0.03s; in~11; out~21; output=two" },
    { at: "2025-01-01T00:00:06.000Z", kind: "assistant", status: "completed", summary: "assistant response completed", detail: "done" },
  ];

  const view = createOpenTuiRuntimeView(session);

  assert.deepEqual(view.transcriptBlocks.map((block) => block.kind), ["user", "tool", "assistant"]);
  assert.equal(view.transcriptBlocks[1]?.label, "◇ Nexsight × 4");
  assert.equal(view.transcriptBlocks[1]?.collapsedByDefault, true);
  assert.match(view.transcriptBlocks[1]?.detailLines.join("\n") ?? "", /Grouped 4 Nexsight tool events/);
  assert.match(view.transcriptBlocks[1]?.detailLines.join("\n") ?? "", /Done Nexsight · 0\.04s ↓ 10 ↑ 20/);
  assert.match(view.traceBlocks[0]?.detailLines.join("\n") ?? "", /◇ Done Nexsight × 4/);
  assert.match(view.traceBlocks[0]?.detailLines.join("\n") ?? "", /Grouped 4 Nexsight tool events/);
});

test("createOpenTuiRuntimeView leaves short repeated tool trace runs ungrouped", () => {
  const session = createSession();
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "inspect" },
    { at: "2025-01-01T00:00:02.000Z", kind: "tool", status: "started", summary: "tool nexsight_execute started", detail: "low; args={\"reason\":\"one\"}" },
    { at: "2025-01-01T00:00:03.000Z", kind: "tool", status: "completed", summary: "tool nexsight_execute completed", detail: "low; duration=0.04s; in~10; out~20; output=one" },
  ];

  const view = createOpenTuiRuntimeView(session);
  const traceText = view.traceBlocks[0]?.detailLines.join("\n") ?? "";

  assert.doesNotMatch(traceText, /Nexsight × 2/);
  assert.match(traceText, /◇ Running Nexsight/);
  assert.match(traceText, /◇ Done Nexsight/);
});

test("createOpenTuiRuntimeView preserves failure state in grouped tool trace runs", () => {
  const session = createSession();
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "inspect" },
    { at: "2025-01-01T00:00:02.000Z", kind: "tool", status: "started", summary: "tool read_file started", detail: "low; args={\"path\":\"a\"}" },
    { at: "2025-01-01T00:00:03.000Z", kind: "tool", status: "failed", summary: "tool read_file failed", detail: "low; output=unexpected arguments" },
    { at: "2025-01-01T00:00:04.000Z", kind: "tool", status: "completed", summary: "tool read_file completed", detail: "low; duration=0.01s; output=ok" },
  ];

  const view = createOpenTuiRuntimeView(session);
  const traceText = view.traceBlocks[0]?.detailLines.join("\n") ?? "";

  assert.match(traceText, /📖 Failed Read file × 3/);
  assert.match(traceText, /Grouped 3 Read file tool events/);
  assert.match(traceText, /unexpected arguments/);
});

test("createOpenTuiRuntimeView retains deeper transcript scrollback", () => {
  const session = createSession();
  session.conversation = [];
  session.events = Array.from({ length: 60 }, (_, index) => ({
    at: `2025-01-01T00:00:${String(index).padStart(2, "0")}.000Z`,
    kind: "prompt" as const,
    status: "queued" as const,
    summary: "user prompt accepted",
    detail: `prompt ${String(index)}`,
  }));

  const view = createOpenTuiRuntimeView(session);

  assert.equal(view.transcriptBlocks.length, 60);
  assert.equal(view.transcriptBlocks[0]?.detailLines[0], "prompt 0");
  assert.equal(view.transcriptBlocks.at(-1)?.detailLines[0], "prompt 59");
});

test("createOpenTuiRuntimeView surfaces turn token metrics in chat control rows", () => {
  const session = createSession();
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "Testing 1 2 3" },
    { at: "2025-01-01T00:00:01.500Z", kind: "control", status: "started", summary: "turn run started" },
    { at: "2025-01-01T00:00:01.750Z", kind: "control", status: "started", summary: "turn run provider step" },
    { at: "2025-01-01T00:00:02.000Z", kind: "assistant", status: "completed", summary: "assistant response completed", detail: "done" },
    { at: "2025-01-01T00:00:03.000Z", kind: "control", status: "completed", summary: "turn run completed", detail: "duration=1.76s; turn_in~2223; turn_out~11" },
  ];

  const view = createOpenTuiRuntimeView(session);
  const controlBlock = view.transcriptBlocks.find((block) => block.label === "turn complete");

  assert.equal(controlBlock?.kind, "system");
  assert.deepEqual(view.transcriptBlocks.map((block) => block.label), ["you", "agent", "turn complete"]);
  assert.match(controlBlock?.summaryLines.join("\n") ?? "", /1\.76s ↓ 2223 ↑ 11/);
  assert.match(controlBlock?.detailLines.join("\n") ?? "", /turn_in~2223/);
  assert.doesNotMatch(view.transcriptBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /turn run started|turn run provider step/);
  assert.equal(view.statusline.lastInputTokens, 2223);
  assert.equal(view.statusline.lastOutputTokens, 11);
});

test("createOpenTuiRuntimeView shows model-authored turn intent", () => {
  const session = createSession();
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "verify config copy" },
    { at: "2025-01-01T00:00:01.100Z", kind: "control", status: "started", summary: "model turn intent", detail: "Inspect config copy path, then verify failing checks." },
  ];

  const view = createOpenTuiRuntimeView(session);

  assert.deepEqual(view.transcriptBlocks.map((block) => block.label), ["you", "agent"]);
  assert.equal(view.transcriptBlocks[1]?.collapsedByDefault, false);
  assert.equal(view.transcriptBlocks[1]?.detailLines[0], "Inspect config copy path, then verify failing checks.");
});

test("createOpenTuiRuntimeView expands edit tool diff previews in chat", () => {
  const session = createSession();
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "patch smoke" },
    {
      at: "2025-01-01T00:00:02.000Z",
      kind: "tool",
      status: "completed",
      summary: "tool apply_patch completed",
      detail: [
        "guarded; duration=0.01s; in~12; out~40",
        "patched .nexagent/patch-preview-smoke.txt (1 match)",
        "Edited .nexagent/patch-preview-smoke.txt (+1 -1)",
        "diff:",
        "@@ -1,2 +1,2 @@",
        " alpha",
        "-beta",
        "+gamma",
      ].join("\n"),
    },
  ];

  const view = createOpenTuiRuntimeView(session);
  const toolBlock = view.transcriptBlocks.find((block) => block.kind === "tool");

  assert.equal(toolBlock?.collapsedByDefault, false);
  assert.match(toolBlock?.detailLines.join("\n") ?? "", /Edited \.nexagent\/patch-preview-smoke\.txt \(\+1 -1\)/);
  assert.match(toolBlock?.detailLines.join("\n") ?? "", /-beta/);
  assert.match(toolBlock?.detailLines.join("\n") ?? "", /\+gamma/);
  assert.doesNotMatch(toolBlock?.detailLines[0] ?? "", /output=patched/);
});

test("createOpenTuiRuntimeView keeps provider nudge debug payloads out of chat", () => {
  const session = createSession();
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "run tests" },
    { at: "2025-01-01T00:00:02.000Z", kind: "control", status: "queued", summary: "malformed tool call nudge applied", detail: "<tool_call>\n{\"name\":\"shell_command\",\"arguments\":{\"command\":\"bun test\"}}\n</tool_call>" },
    { at: "2025-01-01T00:00:03.000Z", kind: "control", status: "queued", summary: "claim evidence nudge applied", detail: "claimed test evidence without shell_command result" },
    { at: "2025-01-01T00:00:04.000Z", kind: "assistant", status: "completed", summary: "assistant response completed", detail: "Use bun test ./test/tools.test.ts" },
  ];

  const view = createOpenTuiRuntimeView(session);
  const transcriptText = view.transcriptBlocks.map((block) => block.detailLines.join("\n")).join("\n");
  const traceText = view.traceBlocks.map((block) => block.detailLines.join("\n")).join("\n");

  assert.deepEqual(view.transcriptBlocks.map((block) => block.kind), ["user", "assistant"]);
  assert.doesNotMatch(transcriptText, /<tool_call>|shell_command|claim evidence nudge/);
  assert.match(traceText, /malformed tool call nudge applied/);
  assert.match(traceText, /<tool_call>/);
});

test("createOpenTuiRuntimeView hides raw assistant tool call markup in chat", () => {
  const session = createSession();
  session.conversation = [
    { role: "user", content: "resume", tokens: 1 },
    {
      role: "assistant",
      content: '<nexagent_tool_call>{"name":"shell_command","arguments":{"command":"pwd"}}</nexagent_tool_call>Done.',
      tokens: 8,
    },
  ];
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "resume" },
    {
      at: "2025-01-01T00:00:02.000Z",
      kind: "assistant",
      status: "completed",
      summary: "assistant response completed",
      detail: '<nexagent_tool_call>{"name":"shell_command","arguments":{"command":"pwd"}}</nexagent_tool_call>Done.',
    },
  ];

  const view = createOpenTuiRuntimeView(session);
  const transcriptText = view.transcriptBlocks.map((block) => block.detailLines.join("\n")).join("\n");

  assert.doesNotMatch(transcriptText, /<nexagent_tool_call>|"arguments"/);
  assert.match(transcriptText, /\[tool call hidden: shell_command\]Done\./);
});

test("createOpenTuiRuntimeView shows command output in chat without diagnostic control detail", () => {
  const session = createSession();
  session.conversation = [
    { role: "user", content: "show memory", tokens: 2 },
    { role: "assistant", content: "memory checked", tokens: 2 },
  ];
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "prompt", status: "queued", summary: "user prompt accepted", detail: "show memory" },
    { at: "2025-01-01T00:00:02.000Z", kind: "command", status: "completed", summary: "memory status", detail: "memory\nenabled: true\nmatches=3" },
    { at: "2025-01-01T00:00:03.000Z", kind: "control", status: "failed", summary: "error command.failed: runtime command failed", detail: "command_name=/memory; class=command.failed" },
    { at: "2025-01-01T00:00:04.000Z", kind: "assistant", status: "completed", summary: "assistant response completed", detail: "memory checked" },
  ];

  const view = createOpenTuiRuntimeView(session);

  assert.deepEqual(view.transcriptBlocks.map((block) => block.kind), ["user", "command", "assistant"]);
  assert.deepEqual(view.transcriptBlocks.map((block) => block.label), ["you", "command memory status", "agent"]);
  assert.match(view.transcriptBlocks[1]?.detailLines.join("\n") ?? "", /matches=3/);
  assert.doesNotMatch(view.transcriptBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /class=command\.failed/);
  assert.match(view.traceBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /Command completed/);
  assert.match(view.traceBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /kind command · status completed/);
  assert.match(view.traceBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /output rendered in chat; command payload hidden from trace/);
  assert.doesNotMatch(view.traceBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /matches=3/);
  assert.match(view.traceBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /class=command\.failed/);
});

test("createOpenTuiRuntimeView shows command-only output before first chat turn", () => {
  const session = createSession();
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "command", status: "completed", summary: "help", detail: "/help - show available runtime commands\n/status - show runtime status" },
  ];

  const view = createOpenTuiRuntimeView(session);

  assert.deepEqual(view.transcriptBlocks.map((block) => block.kind), ["command"]);
  assert.equal(view.transcriptBlocks[0]?.label, "command help");
  assert.match(view.transcriptBlocks[0]?.detailLines.join("\n") ?? "", /\/help - show available runtime commands/);
  assert.doesNotMatch(view.traceBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /show available runtime commands/);
  assert.match(view.traceBlocks.map((block) => block.detailLines.join("\n")).join("\n"), /output rendered in chat; command payload hidden from trace/);
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

test("createOpenTuiRuntimeView keeps manual compact diagnostics out of chat command output", () => {
  const session = createSession();
  session.events = [
    { at: "2025-01-01T00:00:01.000Z", kind: "compact", status: "completed", summary: "manual compaction completed", detail: "summary=present · turns=4 · tokens=2172->1314" },
    { at: "2025-01-01T00:00:02.000Z", kind: "command", status: "completed", summary: "compact manual · 2172 -> 1314", detail: "manual compaction completed\nsummary=present · turns=4 · tokens=2172->1314" },
  ];

  const view = createOpenTuiRuntimeView(session);
  const transcriptText = view.transcriptBlocks.map((block) => block.detailLines.join("\n")).join("\n");

  assert.match(transcriptText, /manual compaction completed/);
  assert.match(transcriptText, /summary=present · turns=4 · tokens=2172->1314/);
  assert.doesNotMatch(transcriptText, /threshold|remainingTokens|preserveTurns|lastCompactedAt/);
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

test("OpenTUI cockpit result prefers assistant output over generic event summary", () => {
  const session = createSession();
  session.events = [
    {
      at: "2026-04-30T00:00:01.000Z",
      kind: "prompt",
      status: "completed",
      summary: "summarize repo",
    },
    {
      at: "2026-04-30T00:00:02.000Z",
      kind: "tool",
      status: "completed",
      summary: "tool read_file completed",
      detail: "README.md read",
    },
    {
      at: "2026-04-30T00:00:03.000Z",
      kind: "assistant",
      status: "completed",
      summary: "assistant response completed",
      detail: "Repo summary ready.\nSecond line.",
    },
  ];

  const view = createOpenTuiRuntimeView(session);

  assert.equal(view.cockpit.ladder.intent, "summarize repo");
  assert.equal(view.cockpit.ladder.act, "tool read_file completed");
  assert.equal(view.cockpit.ladder.result, "Repo summary ready.");
});

test("OpenTUI cockpit promotes latest failed turn event", () => {
  const session = createSession();
  session.events = [
    {
      at: "2026-04-30T00:00:01.000Z",
      kind: "prompt",
      status: "completed",
      summary: "run tests",
    },
    {
      at: "2026-04-30T00:00:02.000Z",
      kind: "command",
      status: "failed",
      summary: "command test failed",
      detail: "bun test exited 1\nstack omitted",
    },
  ];

  const view = createOpenTuiRuntimeView(session);

  assert.equal(view.cockpit.ladder.result, "command test failed");
  assert.deepEqual(view.cockpit.warnings.find((warning) => warning.type === "command"), {
    severity: "warning",
    type: "command",
    message: "bun test exited 1",
    action: "open trace detail or retry after fix",
  });
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
    startedAt: new Date().toISOString(),
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
    mcpRegistry: {
      serverNames: [],
      servers: {},
      tools: [],
      statuses: [],
      clients: new Map(),
    },
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
