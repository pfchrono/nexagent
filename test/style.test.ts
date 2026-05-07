import assert from "node:assert/strict";
import test from "node:test";

import { compactCavemanText, compactVerboseAssistantOutput, shouldCompactCavemanText } from "../src/runtime/style.js";

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

test("compactVerboseAssistantOutput collapses raw evidence dumps", () => {
  const output = [
    ".planning/phases/72/72-01-PLAN.md 1000",
    ".planning/phases/72/72-02-PLAN.md 1000",
    ".planning/phases/72/72-03-PLAN.md 1000",
    ".planning/phases/72/72-04-SUMMARY.md 1000",
    ".planning/phases/72/72-05-PLAN.md 1000",
    ".planning/phases/72/72-06-PLAN.md 1000",
    ".planning/phases/72/72-07-SUMMARY.md 1000",
    ".planning/phases/73/73-01-PLAN.md 1000",
    ".planning/phases/73/73-01-SUMMARY.md 1000",
    ".planning/phases/74/74-01-PLAN.md 1000",
    ".planning/research/gsd-explore-v1.md 1000",
    ".planning/todos/pending/context-compaction.md 1000",
    "--- PHASE ROOT TREE ---",
    "Step 5",
    'Tool call: {"name":"todo"}',
    "Tool result (ok):",
    "todos",
    "[>] todo-1 Detect current GSD state",
    "[ ] todo-2 Execute routed workflow",
    "[ ] todo-3 Verify result and report compact evidence",
  ].join("\n");

  const compacted = compactVerboseAssistantOutput(output);
  assert.doesNotMatch(compacted, /72-01-PLAN/);
  assert.match(compacted, /\[>\] todo-1 Detect current GSD state/);
  assert.match(compacted, /assistant output compacted/);
});

test("compactVerboseAssistantOutput preserves structured architecture candidate reports", () => {
  const candidate = (index: number) => [
    `${index}. src/provider.ts -- Provider orchestration seam`,
    "**Problem:** provider execution, model policy, transport selection, tool loop policy, and finalization stay in one broad module.",
    "**Solution:** split execution policy behind a small ProviderExecutionPlan interface and keep transport adapters thin.",
    "**Benefits:** better locality, higher leverage, focused deletion tests, and cleaner adapter replacement.",
    "**Evidence:** src/provider.ts, src/models.ts, src/provider/codex-http.ts, and test/provider.test.ts all cross the same policy boundary.",
    "**Next:** extract first interface, add tests around model alias and transport compatibility behavior.",
    "Detail: repeated policy checks make each provider fix touch unrelated request assembly and completion handling.",
    "Detail: this candidate remains user-facing analysis, not raw trace evidence, even when long enough to cross generic compaction thresholds.",
    "Detail: preserving it lets skills return complete ranked options without forcing users into trace expansion.",
  ].join("\n");
  const output = [
    "Observed: checked CONTEXT.md and docs/adr, then scouted Runtime, Provider, Transport, Guarded Tool, and OpenTUI Shell code.",
    "Here are the architecture deepening opportunities:",
    ...[1, 2, 3, 4, 5].map(candidate),
    "Which of these would you like to explore?",
  ].join("\n\n");

  assert.ok(output.length > 4_000);
  assert.ok(output.split(/\r?\n/).length > 28);
  assert.equal(compactVerboseAssistantOutput(output), output);
});
