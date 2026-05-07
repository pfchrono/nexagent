import assert from "node:assert/strict";
import { test } from "bun:test";

import { renderRuntimeTui, type RuntimeTuiView } from "../src/cli.js";
import {
  createVisualSmokeCapture,
  formatVisualSmokeReport,
  verifyVisualSmokeCapture,
  type VisualSmokeCapture,
} from "../src/opentui/visual-smoke.js";

test("OpenTUI visual smoke harness checks key terminal states", () => {
  const captures = [
    paletteCapture(),
    configCapture(),
    approvalCapture(),
    traceCapture(),
    attachCapture(),
    smallTerminalCapture(),
  ];

  for (const capture of captures) {
    const result = verifyVisualSmokeCapture(capture, {
      expectedTokens: expectedTokens[capture.scenario],
      minNonBlankRatio: capture.scenario === "small-terminal" ? 0.04 : 0.08,
    });

    assert.equal(result.ok, true, formatVisualSmokeReport(capture, result));
  }
});

test("OpenTUI visual smoke harness catches blank, overflowing, and leaked placeholder screens", () => {
  const blank = createVisualSmokeCapture("palette", ["", "", ""], { columns: 20, rows: 8 });
  const overflow = createVisualSmokeCapture("trace", ["+ trace +", "x".repeat(32)], { columns: 20, rows: 8 });
  const leaked = createVisualSmokeCapture("config", ["+ config +", "| value undefined |"], { columns: 40, rows: 8 });

  assert.equal(verifyVisualSmokeCapture(blank).ok, false);
  assert.equal(verifyVisualSmokeCapture(overflow).ok, false);
  assert.equal(verifyVisualSmokeCapture(leaked).ok, false);
});

const expectedTokens = {
  palette: ["Command Palette", "/status", "/provider", "Enter run"],
  config: ["dashboard", "provider", "approval", "sessions"],
  approval: ["Approval required", "/approval approve", "/approval reject"],
  trace: ["turn trace", "tool search_files", "duration=0.04s"],
  attach: ["attachments", "Image #1", "/detach"],
  "small-terminal": ["nexagent", "prompt"],
} satisfies Record<VisualSmokeCapture["scenario"], string[]>;

function paletteCapture(): VisualSmokeCapture {
  return createVisualSmokeCapture("palette", [
    "+ Command Palette ------------------------------+",
    "| > /                                           |",
    "| /status     command  runtime status           |",
    "| /provider   command  switch provider          |",
    "| /model      command  select model             |",
    "| /effort     command  reasoning effort         |",
    "| Enter run - Up/Down select - Esc close        |",
    "+-----------------------------------------------+",
  ], { columns: 52, rows: 10 });
}

function configCapture(): VisualSmokeCapture {
  return createVisualSmokeCapture("config", [
    "+ dashboard ------------------------------------+",
    "| provider  active codex                        |",
    "| model     active gpt-5.4                      |",
    "| approval  mode open pending none              |",
    "| sessions  current session_test timeline       |",
    "| tools     mode repo-local-guarded             |",
    "| context   percent 0 compaction raw            |",
    "| Enter run - click select - Esc close          |",
    "+-----------------------------------------------+",
  ], { columns: 52, rows: 12 });
}

function approvalCapture(): VisualSmokeCapture {
  return createVisualSmokeCapture("approval", [
    "+ Approval required ----------------------------+",
    "| shell_command guarded                         |",
    "| summary bun test ./test/opentui*.test.ts      |",
    "| /approval approve                             |",
    "| /approval allow-session                       |",
    "| /approval reject                              |",
    "| A/Y approve once - R/N/Esc reject             |",
    "+-----------------------------------------------+",
  ], { columns: 52, rows: 10 });
}

function traceCapture(): VisualSmokeCapture {
  return createVisualSmokeCapture("trace", [
    "+ turn trace -----------------------------------+",
    "| provider started codex-http                   |",
    "| tool search_files started                     |",
    "| tool search_files completed duration=0.04s    |",
    "| output src/opentui/App.tsx                    |",
    "| wheel/PageUp/PageDown - Esc close             |",
    "+-----------------------------------------------+",
  ], { columns: 52, rows: 10 });
}

function attachCapture(): VisualSmokeCapture {
  return createVisualSmokeCapture("attach", [
    "+ composer -------------------------------------+",
    "| > describe screenshot                         |",
    "| attachments Image #1 cap.png image/png        |",
    "| [X] clear  /detach                            |",
    "| Alt+V paste image                             |",
    "+-----------------------------------------------+",
  ], { columns: 52, rows: 8 });
}

function smallTerminalCapture(): VisualSmokeCapture {
  const view: RuntimeTuiView = {
    title: "nexagent",
    statusline: null,
    metadata: [["session", "visual"], ["provider", "codex"], ["cwd", "/repo"], ["status", "ready"], ["detail", "visual smoke"]],
    routing: [["mode", "cli-exec"], ["models", "codex=gpt-5.4"]],
    auth: [],
    instructions: [],
    mcp: [],
    hooks: [],
    imports: [],
    archivist: [],
  };
  return createVisualSmokeCapture("small-terminal", renderRuntimeTui(view, { columns: 60, rows: 14 }), { columns: 60, rows: 14 });
}
