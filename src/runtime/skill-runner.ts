import type { RuntimeSession } from "./session.js";
import type { InternalToolCall, InternalToolResult } from "./tools.js";
import type { SkillRunRecord } from "./skill-types.js";

function createSkillRunId(): string {
  return `skillrun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function shouldTriggerSkillRun(prompt: string): boolean {
  const lower = prompt.trim().toLowerCase();
  return lower.startsWith("/skill ")
    || lower.startsWith("execute active skill")
    || /^(start|go|run|execute|continue|proceed|do it|do that|same|ok|okay|yes)\b/.test(lower);
}

export function beginSkillRun(session: RuntimeSession, prompt: string): SkillRunRecord | null {
  const activeSkill = session.activeSkill;
  if (!activeSkill || !shouldTriggerSkillRun(prompt)) {
    return null;
  }

  const now = new Date().toISOString();
  return {
    id: createSkillRunId(),
    skillName: activeSkill.name,
    sourcePath: activeSkill.path,
    args: activeSkill.args,
    requestedBy: prompt,
    requiredArtifacts: [],
    status: "running",
    blocker: null,
    completionEvidence: [],
    startedAt: now,
    updatedAt: now,
  };
}

export function recordSkillToolResult(
  run: SkillRunRecord | null,
  call: InternalToolCall,
  result: InternalToolResult,
): SkillRunRecord | null {
  if (!run) {
    return null;
  }
  run.updatedAt = new Date().toISOString();
  run.completionEvidence.push(`${call.name}:${result.ok ? "ok" : "failed"}`);
  if (!result.ok && !run.blocker) {
    run.status = "blocked";
    run.blocker = result.output;
  }
  return run;
}

export function completeSkillRun(run: SkillRunRecord | null, finalOutput: string): SkillRunRecord | null {
  if (!run) {
    return null;
  }
  run.updatedAt = new Date().toISOString();
  if (run.status !== "blocked") {
    run.status = "completed";
  }
  if (finalOutput.trim().length > 0) {
    run.completionEvidence.push(`assistant:${finalOutput.slice(0, 180)}`);
  }
  return run;
}
