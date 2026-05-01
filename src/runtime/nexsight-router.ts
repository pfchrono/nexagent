import type { InternalToolCall, InternalToolName } from "./tools.js";
import { isNexsightToolName } from "./tool-contracts.js";

export interface TurnObligations {
  requiresWriteEvidence: boolean;
  requiresNexsightEvidence: boolean;
  requiresActiveSkillEvidence: boolean;
}

type SkillCarrier = { activeSkill?: { name: string } };

export function deriveTurnObligations(prompt: string, session?: SkillCarrier): TurnObligations {
  return {
    requiresWriteEvidence: promptRequiresWriteEvidence(prompt),
    requiresNexsightEvidence: promptRequiresNexsightEvidence(prompt),
    requiresActiveSkillEvidence: promptRequiresActiveSkillEvidence(prompt, session),
  };
}

export function promptRequiresWriteEvidence(prompt: string): boolean {
  const lower = prompt.toLowerCase();
  if (/\b(do not|don't|dont|no need to)\s+(write|create|edit|update|modify|patch|save|append|overwrite)\b/.test(lower)) {
    return false;
  }

  const writeVerb = /\b(write|create|save|append|overwrite|edit|update|modify|patch|add|fix|implement|change)\b/.test(lower);
  const fileTarget = /\b(readme|agents\.md|claude\.md|package\.json|tsconfig\.json|bun\.lock)\b/i.test(prompt)
    || /(?:^|\s|["'`(])(?:\.{0,2}\/|~\/|\/)?[\w@./ -]+\.(?:md|ts|tsx|js|jsx|json|jsonc|toml|yaml|yml|css|scss|html|sh|py|rs|go|lock)\b/i.test(prompt);
  const explicitFileWrite = /\b(write|create|save|append|overwrite)\b.*\b(file|artifact|report|findings|summary)\b/.test(lower)
    || /\b(to|into|in)\s+(?:\.{0,2}\/|~\/|\/)?[\w@./ -]+\.[a-z0-9]+\b/i.test(prompt);

  return writeVerb && (fileTarget || explicitFileWrite);
}

export function promptRequiresNexsightEvidence(prompt: string): boolean {
  return /\bnexsight\b/i.test(prompt) && !/\b(do not|don't|dont|avoid|skip)\s+nexsight\b/i.test(prompt);
}

export function promptRequiresActiveSkillEvidence(prompt: string, session?: SkillCarrier): boolean {
  if (!session?.activeSkill) {
    return false;
  }

  const lower = prompt.trim().toLowerCase();
  return lower.startsWith("execute active skill")
    || lower.startsWith("/skill ")
    || /^(start|go|run|execute|continue|proceed|do it|do that|same|ok|okay|yes)\b/.test(lower);
}

function isGenericInspectionToolName(name: InternalToolName): boolean {
  return name === "read_file"
    || name === "list_dir"
    || name === "search_content"
    || name === "search_files"
    || name === "shell_command"
    || name === "git_status"
    || name === "git_diff";
}

export function shouldRouteToNexsightOnly(prompt: string, call: InternalToolCall): boolean {
  if (!isGenericInspectionToolName(call.name)) {
    return false;
  }
  if (promptRequiresNexsightEvidence(prompt)) {
    return true;
  }

  const lower = prompt.toLowerCase();
  const asksForBroadInspection = /\b(inspect|explore|examine|analy[sz]e|summari[sz]e|scan|map|inventory|count|find|search)\b/.test(lower);
  const broadTarget = /\b(repo|codebase|project|workspace|directory|tree|files|structure|architecture|layout|dependencies|tests?)\b/.test(lower)
    || /~\/|\/home\/|\.\/|\.\b/.test(lower);
  const exactFileRequest = /\b(read|open|show|cat)\b/.test(lower) && /\b[\w.-]+\.[a-z0-9]+\b/i.test(prompt);
  return asksForBroadInspection && broadTarget && !exactFileRequest;
}

export function isNexsightToolCall(call: InternalToolCall): boolean {
  return isNexsightToolName(call.name);
}
