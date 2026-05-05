import assert from "node:assert/strict";
import test from "node:test";

import {
  CODEX_MODEL_CATALOG,
  getCodexThinkingLevelMetadata,
  normalizeCodexThinkingLevel,
} from "../src/models.js";

test("model catalog exposes provider-specific thinking-level metadata", () => {
  assert.ok(CODEX_MODEL_CATALOG.length > 0);

  for (const model of CODEX_MODEL_CATALOG) {
    const metadata = model.thinkingLevelMetadata;
    assert.ok(metadata.supportedThinkingLevels.includes(metadata.defaultThinkingLevel));
    assert.ok(metadata.providerControls.some((control) => control.provider === "codex"));
    assert.ok(metadata.providerControls.some((control) => control.provider === "openai"));
    assert.ok(metadata.providerControls.every((control) => control.transportModes.length > 0));
    assert.ok(metadata.providerControls.every((control) => control.parameter.length > 0));
  }
});

test("thinking-level helpers normalize aliases and resolve model metadata", () => {
  assert.equal(normalizeCodexThinkingLevel("MIN"), "minimal");
  assert.equal(normalizeCodexThinkingLevel(" none "), "minimal");
  assert.equal(normalizeCodexThinkingLevel("HIGH"), "high");
  assert.equal(normalizeCodexThinkingLevel("xhigh"), null);

  assert.equal(getCodexThinkingLevelMetadata("gpt-5.4")?.defaultThinkingLevel, "medium");
  assert.equal(getCodexThinkingLevelMetadata("codexspark")?.defaultThinkingLevel, "high");
  assert.equal(getCodexThinkingLevelMetadata("missing"), null);
});
