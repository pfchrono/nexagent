import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveTurnObligations,
  promptRequiresNexsightEvidence,
  promptRequiresTodoEvidence,
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
  assert.equal(promptRequiresWriteEvidence("why did that fail instead of writing the report?"), false);
  assert.equal(promptRequiresWriteEvidence("investigate why gpt-5.3-codex-spark fails, find the problem, then fix"), false);
  assert.equal(promptRequiresWriteEvidence("write findings to REPORT.md"), true);
});

test("nexsight router requires todo evidence for multi-stage GSD work", () => {
  const obligations = deriveTurnObligations("continue GSD workflow and finish next slice");
  assert.equal(obligations.requiresTodoEvidence, true);
  assert.equal(promptRequiresTodoEvidence("Execute active skill gsd-stats now."), false);
  assert.equal(promptRequiresTodoEvidence("implement 1 through 4 for this phase"), true);
  assert.equal(promptRequiresTodoEvidence("skip todo and fix README.md"), false);
  assert.equal(promptRequiresTodoEvidence("why did that fail?"), false);
});

test("nexsight router requires ask evidence for discussion/spec skills", () => {
  const discuss = deriveTurnObligations("start", { activeSkill: { name: "gsd-discuss-phase" } });
  assert.equal(discuss.requiresAskEvidence, true);

  const spec = deriveTurnObligations("/skill gsd-spec-phase 73");
  assert.equal(spec.requiresAskEvidence, true);

  const skipped = deriveTurnObligations("start but do not ask questions", { activeSkill: { name: "gsd-discuss-phase" } });
  assert.equal(skipped.requiresAskEvidence, false);
});
