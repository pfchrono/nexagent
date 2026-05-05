export function formatTurnStartIntent(prompt: string): string {
  const compact = prompt
    .replace(/\s+/g, " ")
    .replace(/^\/skill\s+/i, "")
    .trim();
  if (!compact) {
    return "Attempting: work request";
  }
  return `Attempting: ${summarizeTurnIntent(compact)}`;
}

function summarizeTurnIntent(prompt: string): string {
  const lower = prompt.toLowerCase();
  if (/^(what|which|who|why|how|when|where)\b/.test(lower) || lower.endsWith("?")) {
    return summarizeQuestionIntent(lower);
  }
  if (/\bsentry\b|\berror logs?\b|\bnew logs?\b/.test(lower)) {
    return "Checking Sentry for current errors and matching them to code fixes";
  }
  if (/\bcommit\b|\bstaged\b|\bdirty\b|\buntracked\b|\bgit\b|\bpush\b/.test(lower)) {
    return "Inspecting git changes, staged files, and commit readiness";
  }
  if (/\b(memory|archivist|resume|last action|handoff)\b/.test(lower)) {
    return "Checking memory and recent handoff context before resuming work";
  }
  if (/\b(test|build|verify|lint|typecheck)\b/.test(lower)) {
    return "Running verification and inspecting failures if they appear";
  }
  if (/\b(fix|address|resolve|debug|diagnose|broken|failing|issue)\b/.test(lower)) {
    return "Diagnosing issue, applying fix, and verifying result";
  }
  if (/\b(add|implement|integrate|update|change|make|create)\b/.test(lower)) {
    return "Inspecting code, making requested change, and validating behavior";
  }
  return truncateIntent(prompt);
}

function summarizeQuestionIntent(lowerPrompt: string): string {
  if (/\b(files?|added|staged|commit|dirty|untracked|message)\b/.test(lowerPrompt)) {
    return "Checking git status and summarizing commit-ready changes";
  }
  if (/\bsentry\b|\blogs?\b|\berrors?\b/.test(lowerPrompt)) {
    return "Checking Sentry status and summarizing relevant errors";
  }
  if (/\bmemory|last action|resume|handoff\b/.test(lowerPrompt)) {
    return "Checking memory and recent context";
  }
  if (/\blsp|diagnostics?|warnings?\b/.test(lowerPrompt)) {
    return "Checking LSP diagnostics and warning state";
  }
  return "Inspecting project state to answer requested question";
}

function truncateIntent(value: string): string {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}
