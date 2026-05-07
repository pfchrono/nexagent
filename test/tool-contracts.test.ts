import assert from "node:assert/strict";
import test from "node:test";

import { getToolContract, getToolContracts, isNexsightToolName, isWriteToolName } from "../src/runtime/tool-contracts.js";
import { fail, formatToolError, formatToolPath, ok, pending, toToolResult } from "../src/runtime/tool-results.js";
import { classifyInternalToolRisk } from "../src/runtime/tool-risk.js";
import { getInternalToolDefinitions } from "../src/runtime/tools.js";
import type { RuntimeSession } from "../src/runtime/session.js";

test("tool contracts cover all internal tool definitions", () => {
  const defs = getInternalToolDefinitions();
  for (const def of defs) {
    const contract = getToolContract(def.name);
    assert.equal(contract.name, def.name);
    assert.ok(contract.summary.length > 0);
  }
});

test("tool contracts expose stable write and nexsight evidence flags", () => {
  assert.equal(isWriteToolName("write_file"), true);
  assert.equal(isWriteToolName("apply_patch"), true);
  assert.equal(isWriteToolName("read_file"), false);

  assert.equal(isNexsightToolName("nexsight_execute"), true);
  assert.equal(isNexsightToolName("nexsight_search"), true);
  assert.equal(isNexsightToolName("shell_command"), false);
});

test("tool contracts remain unique by name", () => {
  const names = getToolContracts().map((contract) => contract.name);
  assert.equal(new Set(names).size, names.length);
});

test("tool result helpers define stable guarded tool result shape", () => {
  assert.deepEqual(ok("read_file", "content"), { ok: true, tool: "read_file", output: "content" });
  assert.deepEqual(fail("write_file", "blocked"), { ok: false, tool: "write_file", output: "blocked" });
  assert.deepEqual(toToolResult("nexsight_search", { ok: true, output: "hits" }), { ok: true, tool: "nexsight_search", output: "hits" });
  assert.deepEqual(pending("archivist_save", "async"), { ok: false, tool: "archivist_save", output: "archivist_save requires async execution path" });
});

test("tool result helpers format paths and errors consistently", () => {
  const session = { cwd: "/repo" } as RuntimeSession;

  assert.equal(formatToolPath(session, "/repo/src/app.ts"), "src/app.ts");
  assert.equal(formatToolPath(session, "/other/app.ts"), "/other/app.ts");
  assert.equal(formatToolError("/repo/src/app.ts", new Error("missing")), "/repo/src/app.ts: missing");
});

test("tool risk helper keeps policy classification independent of execution", () => {
  assert.equal(classifyInternalToolRisk({ name: "read_file", arguments: { path: "src/app.ts" } }), "low");
  assert.equal(classifyInternalToolRisk({ name: "write_file", arguments: { path: "src/app.ts", content: "" } }), "guarded");
  assert.equal(classifyInternalToolRisk({ name: "nexsight_execute", arguments: { language: "javascript", code: "console.log(1)" } }), "low");
  assert.equal(classifyInternalToolRisk({ name: "nexsight_execute", arguments: { cmd: "ls" } }), "guarded");
});
