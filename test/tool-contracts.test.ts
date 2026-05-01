import assert from "node:assert/strict";
import test from "node:test";

import { getToolContract, getToolContracts, isNexsightToolName, isWriteToolName } from "../src/runtime/tool-contracts.js";
import { getInternalToolDefinitions } from "../src/runtime/tools.js";

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
