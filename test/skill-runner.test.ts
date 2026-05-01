import assert from "node:assert/strict";
import test from "node:test";

import { beginSkillRun, completeSkillRun, recordSkillToolResult } from "../src/runtime/skill-runner.js";
import type { RuntimeSession } from "../src/runtime/session.js";

function createSession(activeSkill: RuntimeSession["activeSkill"]): RuntimeSession {
  return {
    activeSkill,
    action: {
      status: "ready",
      detail: "runtime baseline",
      pending: false,
      lastActivity: null,
    },
    events: [],
    toolPolicy: {
      mode: "workspace-guarded",
      readRoots: [],
      allowedRoots: [],
      protectedRoots: [],
    },
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

test("skill runner starts only when active skill exists and prompt requests execution", () => {
  const noSkillRun = beginSkillRun(createSession(undefined), "execute active skill now");
  assert.equal(noSkillRun, null);

  const run = beginSkillRun(
    createSession({
      name: "gsd-execute-phase",
      source: "repo",
      path: "/repo/.codex/skills/gsd-execute-phase/SKILL.md",
      args: "--raw",
      content: "skill content",
    }),
    "execute active skill now",
  );
  assert.ok(run);
  assert.equal(run?.status, "running");
});

test("skill runner records tool evidence and completion", () => {
  const run = beginSkillRun(
    createSession({
      name: "gsd-do",
      source: "repo",
      path: "/repo/.codex/skills/gsd-do/SKILL.md",
      args: "(none)",
      content: "skill content",
    }),
    "/skill gsd-do",
  );
  assert.ok(run);

  const withTool = recordSkillToolResult(run, { name: "read_file" }, { ok: true, tool: "read_file", output: "ok" });
  assert.equal(withTool?.completionEvidence.length, 1);

  const completed = completeSkillRun(withTool, "done");
  assert.equal(completed?.status, "completed");
});

test("skill runner marks blocker from failed tool", () => {
  const run = beginSkillRun(
    createSession({
      name: "gsd-debug",
      source: "repo",
      path: "/repo/.codex/skills/gsd-debug/SKILL.md",
      args: "(none)",
      content: "skill content",
    }),
    "run",
  );
  assert.ok(run);

  const blocked = recordSkillToolResult(run, { name: "write_file" }, { ok: false, tool: "write_file", output: "permission denied" });
  assert.equal(blocked?.status, "blocked");
  assert.match(blocked?.blocker ?? "", /permission denied/);
});
