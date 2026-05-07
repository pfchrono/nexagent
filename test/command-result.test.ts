import assert from "node:assert/strict";
import test from "node:test";

import { toolResultToCommandResult } from "../src/cli/command-result.js";

test("command result helper maps successful tool output to structured command success", () => {
  assert.deepEqual(
    toolResultToCommandResult("read", "src/app.ts", { ok: true, tool: "read_file", output: "content" }),
    { ok: true, output: "content", activity: "read · src/app.ts" },
  );
});

test("command result helper maps tool policy blocks to structured command failure", () => {
  assert.deepEqual(
    toolResultToCommandResult("read", "/etc/passwd", {
      ok: false,
      tool: "read_file",
      output: "tool policy blocked /etc/passwd; protected path",
    }),
    {
      ok: false,
      message: "tool policy blocked /etc/passwd; protected path",
      activity: "command blocked · /etc/passwd",
    },
  );
});

test("command result helper maps shell policy blocks to structured command failure", () => {
  assert.deepEqual(
    toolResultToCommandResult("sh", "rm -rf /", {
      ok: false,
      tool: "shell_command",
      output: "shell policy blocked command: rm -rf /",
    }),
    {
      ok: false,
      message: "shell policy blocked command: rm -rf /",
      activity: "command blocked · shell policy",
    },
  );
});
