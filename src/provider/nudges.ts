import { recordRuntimeEvent, type RuntimeSession } from "../runtime/session.js";
import type { MissingTurnEvidence } from "../runtime/turn-run.js";

export const MAX_GUIDANCE_NUDGES_BEFORE_SYNTHESIS = 2;
export const MAX_ACTIVE_SKILL_OUTPUT_NUDGES = 4;

export const PROVIDER_NUDGES = {
  continuation: [
    "The previous response deferred action or asked for confirmation instead of executing.",
    "The user has already authorized this task.",
    "Continue now with concrete tool use or complete the task.",
    "Do not provide shell snippets or manual commands for the user to run when an internal tool can do it.",
    "Do not ask for another confirmation unless a real approval gate or blocker prevents progress.",
    "Do not apologize, explain what you should have done, or ask the user to restate a task already present in this turn.",
    "If the exact target is ambiguous, infer a safe representative target from repo evidence and run a bounded inspection.",
    "If no file/tool action is needed, provide the final verified result.",
  ].join(" "),
  writeEvidence: [
    "The previous response claimed files were written or updated, but this turn has no write tool evidence.",
    "Use write_file, apply_patch, or a shell command that performs the edit, then verify it.",
    "If no file change was actually needed, correct the final answer and do not claim changes.",
  ].join(" "),
  malformedToolCall: [
    "The previous response emitted malformed nexagent tool-call markup as visible text.",
    "Do not show raw <nexagent_tool_call> text to the user.",
    "Retry with exactly one valid tool block: <nexagent_tool_call>{\"name\":\"tool_name\",\"arguments\":{}}</nexagent_tool_call>.",
  ].join(" "),
  nexsightTool: [
    "This task should use Nexsight because it asks for broad repo/context analysis or explicitly names Nexsight.",
    "Do not use read_file, list_dir, search_content, search_files, or shell_command for this broad inspection step.",
    "Direct tools are fine only for a known small file/path, exact file content, or a narrower follow-up after Nexsight has routed the work.",
    "Retry with exactly one Nexsight tool call: nexsight_gather for broad multi-file evidence, nexsight_execute for custom parsing/counting, nexsight_read for one file, or nexsight_index/batch/search for stored context.",
  ].join(" "),
  requiredWriteEvidence: [
    "The user requested a file write/update in this turn, but no write tool evidence exists yet.",
    "Use write_file, apply_patch, batch_edit, or a shell command that performs the edit, then verify it.",
    "Do not answer as complete until current-turn write evidence exists or a write tool reports a real blocker.",
  ].join(" "),
  requiredNexsightEvidence: [
    "The user explicitly requested Nexsight in this turn, but no Nexsight tool evidence exists yet.",
    "Use nexsight_gather for broad multi-file evidence, nexsight_execute for custom parsing/counting, nexsight_read for one file, or nexsight_index/batch/search for stored context.",
    "Do not answer from narrative, generic listing, or direct file tools until Nexsight has run or a Nexsight tool reports a real blocker.",
  ].join(" "),
  requiredActiveSkillEvidence: [
    "An active skill is selected and this turn asks to run or continue it, but no tool evidence exists yet.",
    "Use the active skill instructions now with the available tools.",
    "Do not answer with only activated, started, ready, or a request to restate the target.",
    "Answer only after current-turn tool evidence exists or a real tool/approval blocker is recorded.",
  ].join(" "),
  requiredActiveSkillOutput: [
    "The previous active-skill answer did not satisfy the active skill's completion contract.",
    "For improve-codebase-architecture, return five numbered deepening opportunities.",
    "Each opportunity must include clear file evidence plus Problem, Solution, and Benefits.",
    "End by asking which candidate to explore next.",
    "Remove audit/status chatter; output only the candidate list and the selection question.",
    "Use existing tool evidence and run one more focused tool only if needed.",
  ].join(" "),
  requiredTodoEvidence: [
    "This is multi-stage work and needs visible task tracking.",
    "Use the todo tool now to create a compact checklist, mark exactly one current task in_progress, then continue with the next required tool.",
    "Update todos after evidence or verification. If blocked, leave the blocked task visible with the concrete reason.",
  ].join(" "),
  requiredAskUserEvidence: [
    "This discussion/spec skill needs an interactive user choice before it can proceed.",
    "Use ask_user_question now with one grouped question and 2-4 concrete options.",
    "Ask before spending more tool calls. Do not describe that a question is needed; create the pending UI question.",
  ].join(" "),
  requiredClaimEvidence: [
    "The previous response claimed test or Nexsight work without matching current-turn evidence.",
    "Run the matching tool now, or correct the answer and explicitly state that the work was not run.",
    "Do not claim tests, validation, or Nexsight work unless current-turn evidence exists.",
  ].join(" "),
  finalToolStep: [
    "Tool budget is almost exhausted.",
    "You have one provider step left after this transcript.",
    "Answer now from the available evidence unless one final tool call is required to complete a user-requested write, verification, or artifact update.",
    "If another tool is still required, the harness may start one bounded continuation cycle with the tool count reset.",
    "After that continuation cycle, it will return a partial result instead of failing the turn.",
  ].join(" "),
} as const;

export type RequiredEvidenceNudgeState = Partial<Record<MissingTurnEvidence, number>>;

export interface RequiredEvidenceNudge {
  label: MissingTurnEvidence;
  summary: string;
  content: string;
}

export const REQUIRED_EVIDENCE_NUDGE: Partial<Record<MissingTurnEvidence, RequiredEvidenceNudge>> = {
  Nexsight: {
    label: "Nexsight",
    summary: "required nexsight evidence nudge applied",
    content: PROVIDER_NUDGES.requiredNexsightEvidence,
  },
  write: {
    label: "write",
    summary: "required write evidence nudge applied",
    content: PROVIDER_NUDGES.requiredWriteEvidence,
  },
  "active skill": {
    label: "active skill",
    summary: "required active skill evidence nudge applied",
    content: PROVIDER_NUDGES.requiredActiveSkillEvidence,
  },
  "active skill output": {
    label: "active skill output",
    summary: "required active skill output nudge applied",
    content: PROVIDER_NUDGES.requiredActiveSkillOutput,
  },
  todo: {
    label: "todo",
    summary: "required todo evidence nudge applied",
    content: PROVIDER_NUDGES.requiredTodoEvidence,
  },
  "ask user": {
    label: "ask user",
    summary: "required ask_user_question evidence nudge applied",
    content: PROVIDER_NUDGES.requiredAskUserEvidence,
  },
};

export function getRequiredEvidenceNudge(missing: MissingTurnEvidence): RequiredEvidenceNudge {
  const nudge = REQUIRED_EVIDENCE_NUDGE[missing];
  if (!nudge) {
    return {
      label: missing,
      summary: "required evidence nudge applied",
      content: PROVIDER_NUDGES.requiredClaimEvidence,
    };
  }
  return nudge;
}

export function incrementRequiredEvidenceNudge(counts: RequiredEvidenceNudgeState, missing: MissingTurnEvidence): number {
  const next = (counts[missing] ?? 0) + 1;
  counts[missing] = next;
  return next;
}

export function recordRequiredEvidenceNudge(session: RuntimeSession, summary: string, output: string): void {
  recordRuntimeEvent(session, {
    kind: "control",
    status: "queued",
    summary,
    detail: output.length > 160 ? `${output.slice(0, 157)}...` : output,
  });
}
