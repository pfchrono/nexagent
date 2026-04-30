import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

test("OpenTUI app shell renders live view fields and Phase 66 command surfaces", async () => {
  const source = await readFile(new URL("../src/opentui/App.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /OpenTUI sidecar proof\. Full transcript port begins after migration contract\./);
  assert.match(source, /view\.transcriptLines/);
  assert.match(source, /view\.composerHint/);
  assert.match(source, /traceExpanded/);
  assert.doesNotMatch(source, /submitted shell intent:/);
  assert.doesNotMatch(source, /history placeholder - Phase 66/);
  assert.doesNotMatch(source, /model picker placeholder - Phase 66/);
  assert.match(source, /No matches/);
  assert.match(source, /Select skill/);
  assert.match(source, /skill:/);
  assert.match(source, /clear attachment/);
  assert.match(source, /No history matches/);
  assert.match(source, /move-selection/);
  assert.match(source, /accept-selection/);
  assert.match(source, /move-cursor/);
  assert.match(source, /move-cursor-to/);
  assert.match(source, /renderComposerLine/);
  assert.match(source, /printableValue/);
  assert.match(source, /keyboardSource/);
  assert.match(source, /subscribe/);
  assert.match(source, /selectedValue\.trim\(\) === composer\.text\.trim\(\)/);
  assert.doesNotMatch(source, /key\.name === "q" \|\|/);
  assert.match(source, /outputLines/);
  assert.match(source, /result\.output/);
  assert.match(source, /intent\.input\.trim\(\) === "\/quit"/);
  assert.match(source, /ALT_V_UNSUPPORTED_MESSAGE/);
  assert.match(source, /COMPOSER_CURSOR/);
  assert.match(source, /#8bd5ff/);
  assert.match(source, /#f9e2af/);
  assert.doesNotMatch(source, /\.\.\/provider/);
  assert.doesNotMatch(source, /\.\.\/runtime\/tools/);
});
