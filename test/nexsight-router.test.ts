import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveTurnObligations,
  promptRequiresNexsightEvidence,
  promptRequiresWriteEvidence,
  shouldRouteToNexsightOnly,
} from "../src/runtime/nexsight-router.js";

test("nexsight router derives write and nexsight evidence obligations", () => {
  const write = deriveTurnObligations("edit README.md and fix typo");
  assert.equal(write.requiresWriteEvidence, true);
  assert.equal(write.requiresNexsightEvidence, false);

  const scan = deriveTurnObligations("use Nexsight to scan repo architecture");
  assert.equal(scan.requiresNexsightEvidence, true);
});

test("nexsight router recognizes broad repo analysis routes", () => {
  const shouldRoute = shouldRouteToNexsightOnly("analyze repo structure and dependencies", { name: "search_files" });
  assert.equal(shouldRoute, true);

  const directRead = shouldRouteToNexsightOnly("read src/cli.ts", { name: "read_file" });
  assert.equal(directRead, false);
});

test("nexsight router respects explicit skip signals", () => {
  assert.equal(promptRequiresNexsightEvidence("nexsight analysis"), true);
  assert.equal(promptRequiresNexsightEvidence("skip nexsight and use local read"), false);
  assert.equal(promptRequiresWriteEvidence("do not write files"), false);
});
