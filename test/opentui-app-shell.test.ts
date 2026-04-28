import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

test("OpenTUI app shell renders live view fields and Phase 65 key notices", async () => {
  const source = await readFile(new URL("../src/opentui/App.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /OpenTUI sidecar proof\. Full transcript port begins after migration contract\./);
  assert.match(source, /view\.transcriptLines/);
  assert.match(source, /view\.composerHint/);
  assert.match(source, /traceExpanded/);
  assert.match(source, /submitted shell intent:/);
  assert.match(source, /history placeholder - Phase 66/);
  assert.match(source, /model picker placeholder - Phase 66/);
  assert.match(source, /#8bd5ff/);
  assert.match(source, /#f9e2af/);
  assert.doesNotMatch(source, /\.\.\/provider/);
  assert.doesNotMatch(source, /\.\.\/runtime\/tools/);
});
