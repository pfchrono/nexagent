import assert from "node:assert/strict";
import test from "node:test";

import type { ProviderResult } from "../src/provider.js";
import { TurnRun } from "../src/runtime/turn-run.js";
import type { RuntimeSession } from "../src/runtime/session.js";

function createSession(): RuntimeSession {
  return {
    action: {
      status: "ready",
      detail: "runtime baseline",
      pending: false,
      lastActivity: null,
    },
    events: [],
    operationControls: {
      requireApprovalForGuarded: false,
      yoloMode: false,
      pendingApproval: null,
      lastDecision: null,
      cancelRequested: false,
      activeAbortController: null,
      steerMessage: null,
      steerState: null,
      lastAppliedSteer: null,
      steerHistory: [],
    },
  } as RuntimeSession;
}

test("turn run reaches completed state on successful provider result", async () => {
  const session = createSession();
  const run = new TurnRun({ session, prompt: "fix bug" });

  const result = await run.run(async () => ({
    ok: true,
    provider: "codex",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    output: "done",
  }));

  assert.equal(result.ok, true);
  assert.equal(run.getState(), "completed");
  const states = run.getTransitions().map((entry) => entry.to);
  assert.deepEqual(states, ["provider_loop", "finalizing", "completed"]);
});

test("turn run reaches blocked state on provider failure", async () => {
  const session = createSession();
  const run = new TurnRun({ session, prompt: "fix bug" });

  const failure: ProviderResult = {
    ok: false,
    provider: "codex",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    code: "transport_error",
    message: "failed",
    detail: "stderr",
  };

  const result = await run.run(async () => failure);
  assert.equal(result.ok, false);
  assert.equal(run.getState(), "blocked");
  assert.equal(session.action.status, "error");
});

test("turn run records provider and tool loop ownership events", async () => {
  const session = createSession();
  const run = new TurnRun({ session, prompt: "inspect repo" });

  await run.run(async () => {
    run.onProviderStep(1, { inputTokens: 10, outputTokens: 4, durationMs: 40 });
    run.onToolStep("read_file");
    return {
      ok: true,
      provider: "codex",
      model: "gpt-5.4",
      transport: "codex",
      adapter: "codex-cli-exec",
      fallbackApplied: false,
      output: "done",
    };
  });

  const providerStep = session.events.find((event) => event.summary === "turn run provider step");
  assert.ok(providerStep);
  assert.match(providerStep.detail ?? "", /duration=0\.04s; in~10; out~4/);
  assert.ok(session.events.some((event) => event.summary === "turn run tool step"));
  const completed = session.events.find((event) => event.summary === "turn run completed");
  assert.ok(completed);
  assert.match(completed.detail ?? "", /turn_in~10; turn_out~4/);
  assert.match(run.getTransitions()[0]?.reason ?? "", /owned provider\/tool loop/);
});

test("turn run exposes derived obligations", () => {
  const session = createSession();
  const run = new TurnRun({ session, prompt: "write docs.md" });
  assert.equal(run.getObligations().requiresWriteEvidence, true);
});

test("turn run requires ask evidence for active discussion skill", () => {
  const session = createSession();
  session.activeSkill = {
    name: "gsd-discuss-phase",
    source: "repo",
    path: "/repo/.codex/skills/gsd-discuss-phase/SKILL.md",
    args: "73",
    content: "Discuss phase before planning.",
  };
  session.events.push({
    at: new Date().toISOString(),
    kind: "tool",
    status: "completed",
    summary: "tool git_status completed",
    detail: "guarded",
  });
  const run = new TurnRun({ session, prompt: "start" });

  assert.equal(run.getObligations().requiresAskEvidence, true);
  assert.equal(run.evaluateFinalEvidence(0, [], "Need to choose a direction."), "ask user");
});

test("turn run owns final evidence checks for claimed tests and Nexsight work", () => {
  const session = createSession();
  const run = new TurnRun({ session, prompt: "summarize validation" });

  assert.equal(
    run.evaluateFinalEvidence(0, [], "I ran the tests and they passed."),
    "test",
  );
  assert.equal(
    run.evaluateFinalEvidence(0, [], "I used Nexsight to inspect the repo."),
    "Nexsight",
  );
  assert.equal(
    run.evaluateFinalEvidence(0, [], "I will run a smoke test and Nexsight search if possible."),
    null,
  );
});

test("turn run allows blocker reports without todo evidence", () => {
  const session = createSession();
  const run = new TurnRun({ session, prompt: "continue GSD workflow and finish next slice" });

  assert.equal(run.getObligations().requiresTodoEvidence, true);
  assert.equal(
    run.evaluateFinalEvidence(0, [], "Blocked: state is inconsistent and python -m gsd is unavailable."),
    null,
  );
  assert.equal(
    run.evaluateFinalEvidence(0, [], "Phase complete and ready for next slice."),
    "todo",
  );
});

test("turn run accepts patch-preview smoke evidence from edit and read tools", () => {
  const session = createSession();
  session.events.push(
    {
      at: new Date().toISOString(),
      kind: "tool",
      status: "completed",
      summary: "tool write_file completed",
      detail: "guarded; output=Edited .nexagent/patch-preview-smoke.txt (+2 -0)",
    },
    {
      at: new Date().toISOString(),
      kind: "tool",
      status: "completed",
      summary: "tool apply_patch completed",
      detail: "guarded; output=Edited .nexagent/patch-preview-smoke.txt (+1 -1)",
    },
    {
      at: new Date().toISOString(),
      kind: "tool",
      status: "completed",
      summary: "tool read_file completed",
      detail: "low; output=alpha gamma delta",
    },
  );
  const run = new TurnRun({ session, prompt: "Run a patch preview smoke test" });

  assert.equal(
    run.evaluateFinalEvidence(0, [], "Smoke test passed. The patch preview showed the expected bounded diff preview."),
    null,
  );
});

test("turn run still requires shell evidence for real test-suite claims", () => {
  const session = createSession();
  session.events.push({
    at: new Date().toISOString(),
    kind: "tool",
    status: "completed",
    summary: "tool apply_patch completed",
    detail: "guarded; output=Edited src/app.ts (+1 -1)",
  });
  const run = new TurnRun({ session, prompt: "fix bug" });

  assert.equal(
    run.evaluateFinalEvidence(0, [], "Ran the test suite and 0 fail."),
    "test",
  );
});

test("turn run does not treat tested Nexsight-related coverage names as claimed Nexsight work", () => {
  const session = createSession();
  session.events.push({
    at: new Date().toISOString(),
    kind: "tool",
    status: "completed",
    summary: "tool shell_command completed",
    detail: "bun test ./test/tools.test.ts ./test/nexsight-router.test.ts",
  });
  const run = new TurnRun({ session, prompt: "run focused internal tool tests" });

  assert.equal(
    run.evaluateFinalEvidence(0, [], [
      "Ran the repo's focused internal-tool test set.",
      "Result: 26 pass, 0 fail.",
      "Covered areas included:",
      "- Nexsight execute/index/search routing",
      "- Nexsight router evidence obligations",
    ].join("\n")),
    null,
  );
});

test("turn run does not treat tool inventory Nexsight names as claimed Nexsight work", () => {
  const session = createSession();
  session.events.push({
    at: new Date().toISOString(),
    kind: "tool",
    status: "completed",
    summary: "tool mcp_list_tools completed",
    detail: "low; duration=0.00s",
  });
  const run = new TurnRun({ session, prompt: "What tools and mcp tools do you have in your arsenal?" });

  assert.equal(
    run.evaluateFinalEvidence(0, [], [
      "I used mcp_list_tools and can use these built-in Nexagent tools:",
      "- nexsight_execute - bounded scripts/commands through Nexsight",
      "- nexsight_search - search indexed Nexsight knowledge",
    ].join("\n")),
    null,
  );
});
