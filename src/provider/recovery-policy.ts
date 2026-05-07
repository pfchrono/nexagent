import { containsToolCallMarkup } from "./model-output.js";
import type { MissingTurnEvidence } from "../runtime/tool-capable-turn.js";

export type RecoveryRetryReason =
  | "malformed_tool_call"
  | "unsupported_write_completion"
  | "non_actionable_deferral";

export type RecoveryBlockReason =
  | "missing_required_evidence"
  | "missing_claim_evidence"
  | "unsupported_write_completion";

export type RecoveryPolicyDecision =
  | { kind: "retry"; reason: RecoveryRetryReason }
  | { kind: "block"; reason: RecoveryBlockReason; missing?: MissingTurnEvidence }
  | { kind: "correct"; reason: "unsupported_test_claim" }
  | { kind: "accept" };

export interface RecoveryPolicyInput {
  output: string;
  step: number;
  maxSteps: number;
  hasWriteEvidence: boolean;
  priorWriteEvidenceNudges: number;
  maxWriteEvidenceNudges: number;
  missingRequiredEvidence?: MissingTurnEvidence | null;
  missingClaimEvidence?: MissingTurnEvidence | null;
  promptRequiresTestEvidence?: boolean;
}

export function classifyRecoveryPolicy(input: RecoveryPolicyInput): RecoveryPolicyDecision {
  const canRetry = input.step < input.maxSteps - 1;

  if (containsToolCallMarkup(input.output) && canRetry) {
    return { kind: "retry", reason: "malformed_tool_call" };
  }

  if (input.missingRequiredEvidence) {
    return {
      kind: "block",
      reason: "missing_required_evidence",
      missing: input.missingRequiredEvidence,
    };
  }

  if (claimsUnsupportedWriteCompletion(input.output, input.priorWriteEvidenceNudges) && !input.hasWriteEvidence) {
    const nextNudgeCount = input.priorWriteEvidenceNudges + 1;
    if (canRetry && nextNudgeCount < input.maxWriteEvidenceNudges) {
      return { kind: "retry", reason: "unsupported_write_completion" };
    }
    return { kind: "block", reason: "unsupported_write_completion", missing: "write" };
  }

  if (input.missingClaimEvidence) {
    if (input.missingClaimEvidence === "test" && !input.promptRequiresTestEvidence) {
      return { kind: "correct", reason: "unsupported_test_claim" };
    }
    return {
      kind: "block",
      reason: "missing_claim_evidence",
      missing: input.missingClaimEvidence,
    };
  }

  if (isNonActionableDeferral(input.output) && canRetry) {
    return { kind: "retry", reason: "non_actionable_deferral" };
  }

  return { kind: "accept" };
}

export function isNonActionableDeferral(output: string): boolean {
  const text = output.trim();
  if (!text) {
    return false;
  }

  if (containsToolCallMarkup(text) || /^(done|complete|completed|fixed|updated|implemented)\b/i.test(text)) {
    return false;
  }

  const lower = text.toLowerCase();
  const activationOnly = /^(started|starting|activated|all set|ready|on it|running now|i'm in|i am in)[.!]?\s*$/i.test(text)
    || /^(started|starting now|activated|all set|ready)\b/i.test(text);
  const asksForUserToContinue = [
    "if you want, i can",
    "if you'd like, i can",
    "i can proceed",
    "i can do that now",
    "please say",
    "please run this",
    "run this and",
    "you can run",
    "you should run",
    "reply with",
    "say \"",
    "say '",
    "say “",
    "say ‘",
    "send:",
    "tell me to",
    "want me to",
    "should i",
    "your move",
  ].some((phrase) => lower.includes(phrase));
  const admitsNoAction = [
    "i'll do",
    "i will do",
    "i'll execute",
    "i will execute",
    "i'm ready to execute",
    "i am ready to execute",
    "i need one concrete",
    "i need the exact target",
    "i need exact target",
    "need the exact target",
    "give me the exact task",
    "throw me the exact task",
    "paste the last concrete request",
    "i need to actually",
    "i need to apply",
    "i need to edit",
    "i need to run",
    "can't actually execute workspace tools",
    "cannot actually execute workspace tools",
    "couldn't actually execute workspace tools",
    "could not actually execute workspace tools",
    "i haven't",
    "i have not",
    "i didn't",
    "i did not",
    "i don't have tool execution",
    "missing tool-call execution",
    "missing tool call execution",
    "no tool-call execution",
    "no tool call execution",
    "did not expose callable tool execution",
    "callable tool execution",
    "response lane",
    "tool-enabled turn",
    "tool enabled turn",
    "all tool calls are currently failing",
    "tool calls are currently failing",
    "can't get any tool responses",
    "cannot get any tool responses",
    "couldn't get any tool responses",
    "could not get any tool responses",
    "repository tools are not returning output",
    "repository tools aren't returning output",
    "no file system read/index trace",
    "tool-path issue",
    "no tool responses",
    "no tool response",
    "received no visible output",
    "no visible output to inspect",
    "tool output is visible",
    "tools are unavailable",
    "tool access",
    "no file-change evidence",
  ].some((phrase) => lower.includes(phrase));
  const selfCorrectionOnly = [
    "you're right",
    "you are right",
    "fair callout",
    "my bad",
    "that miss is on me",
    "i should have",
    "i should've",
    "i'll follow",
    "i will follow",
    "going forward",
  ].some((phrase) => lower.includes(phrase));
  const concreteCompletionEvidence = [
    "tests pass",
    "verification passed",
    "wrote ",
    "updated ",
    "created ",
    "changed ",
    "ran ",
    "committed ",
  ].some((phrase) => lower.includes(phrase));
  const inventedTransportBlockerBeforeVerification =
    /\bblocked\b[\s\S]{0,120}\btransport (?:hiccup|error|failure)\b/i.test(text)
    && /\bbefore\b[\s\S]{0,120}\b(?:verification|verify|final verification)\b/i.test(text);

  return inventedTransportBlockerBeforeVerification
    || ((activationOnly || asksForUserToContinue || admitsNoAction || selfCorrectionOnly) && !concreteCompletionEvidence);
}

export function claimsFileMutation(output: string): boolean {
  return output
    .split(/[\n.!?;]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .some((segment) => {
      if (isPlanningOrObservationSegment(segment)) {
        return false;
      }
      const lower = segment.toLowerCase();
      const mutationClaim = [
        "done — applied",
        "done - applied",
        "applied directly",
        "i updated",
        "updated readme",
        "updated `readme",
        "readme now includes",
        "i added",
        "added sections",
        "wrote ",
        "created ",
        "modified ",
        "changed ",
      ].some((phrase) => lower.includes(phrase));
      const fileMention = /\b(readme|\.md|\.ts|\.tsx|\.json|file|files)\b/i.test(segment);
      return mutationClaim && fileMention;
    });
}

function isPlanningOrObservationSegment(segment: string): boolean {
  return /^(?:observed|observation|next step|recommendation|recommended|plan|todo)\s*:/i.test(segment)
    || /\buncommitted edits?\b/i.test(segment)
    || /\b(?:should|need to|needs to|would|will)\s+(?:create|update|write|modify|change|add|plan)\b/i.test(segment);
}

export function claimsUnsupportedWriteCompletion(output: string, priorWriteEvidenceNudges: number): boolean {
  if (claimsFileMutation(output)) {
    return true;
  }
  if (priorWriteEvidenceNudges <= 0) {
    return false;
  }

  const lower = output.toLowerCase();
  const fileMention = /\b(readme|\.md|\.ts|\.tsx|\.json|file|files)\b/i.test(output);
  const verificationClaim = [
    "exists",
    "verified",
    "direct read",
    "direct reads",
    "showed contents",
    "content is",
    "current exact content",
  ].some((phrase) => lower.includes(phrase));
  const correctionOrBlocker = [
    "no file change",
    "no file was",
    "did not write",
    "didn't write",
    "not written",
    "not created",
    "was not created",
    "blocked",
    "cannot",
    "can't",
  ].some((phrase) => lower.includes(phrase));

  return fileMention && verificationClaim && !correctionOrBlocker;
}
