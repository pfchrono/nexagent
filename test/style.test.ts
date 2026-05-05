import assert from "node:assert/strict";
import test from "node:test";

import { compactCavemanText, shouldCompactCavemanText } from "../src/runtime/style.js";

test("compactCavemanText compresses plain natural-language text", () => {
  assert.equal(
    compactCavemanText("You should just use the smaller helper in order to reduce the token count."),
    "use smaller helper to reduce token count.",
  );
});

test("compactCavemanText preserves protected structured content", () => {
  assert.equal(
    compactCavemanText("Keep this intro.\n```ts\nconst value = 1\n```\nAnd this outro."),
    "Keep this intro.\n```ts\nconst value = 1\n```\nAnd this outro.",
  );
  assert.equal(compactCavemanText("Run `bun test` in /home/pfchrono/code/nexagent before commit."), "Run `bun test` in /home/pfchrono/code/nexagent before commit.");
  assert.equal(compactCavemanText("<nexagent_tool_call>{\"name\":\"read_file\"}</nexagent_tool_call>"), "<nexagent_tool_call>{\"name\":\"read_file\"}</nexagent_tool_call>");
  assert.equal(compactCavemanText("Saw \"invalid_request error\" in logs."), "Saw \"invalid_request error\" in logs.");
});

test("compactCavemanText compacts prose around protected content", () => {
  assert.equal(
    compactCavemanText("You should just use `useMemo` in order to reduce the token count."),
    "use `useMemo` to reduce token count.",
  );
  assert.equal(
    compactCavemanText("You should just use smaller reply text.\n{\"keep\":\"exact\",\"count\":1}"),
    "use smaller reply text.\n{\"keep\":\"exact\",\"count\":1}",
  );
});

test("shouldCompactCavemanText detects eligible prose", () => {
  assert.equal(shouldCompactCavemanText("You should just use smaller reply text."), true);
  assert.equal(shouldCompactCavemanText("bun test test/style.test.ts"), false);
});
