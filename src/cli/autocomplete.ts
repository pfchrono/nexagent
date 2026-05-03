import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { COMMAND_CATALOG, PATH_COMPLETION_COMMANDS, PATH_SUBCOMMANDS, SECOND_ARG_PATH_COMMANDS } from "./catalog.js";
import { discoverSkills, normalizeSkillToken, parseSkillShorthand } from "./skills.js";
import type { RuntimeSession } from "../runtime/session.js";

export interface PromptCompletionSuggestion {
  value: string;
  label: string;
  hint: string;
}

export interface PromptCompletionResult {
  value: string;
  hint: string | null;
  suggestions: PromptCompletionSuggestion[];
  selectedIndex: number;
}

export function autocompletePromptBuffer(
  session: Pick<RuntimeSession, "cwd">,
  input: string,
  selectedIndex = 0,
): PromptCompletionResult {
  const trimmedLeft = input.replace(/^\s+/, "");
  const skillToken = findTrailingSkillToken(input);

  if (skillToken) {
    return completeSkillShorthand(session.cwd, input, skillToken.start, selectedIndex);
  }

  if (trimmedLeft.startsWith("$")) {
    return completeSkillShorthand(session.cwd, input, 0, selectedIndex);
  }

  if (trimmedLeft.startsWith("/")) {
    if (/^\/\S*$/.test(input)) {
      const commandCompletion = completeSlashCommand(input, selectedIndex);
      if (commandCompletion.suggestions.length > 0 || commandCompletion.value !== input) {
        return commandCompletion;
      }
      const pathCompletion = completeFreeformPath(session.cwd, input, selectedIndex);
      return pathCompletion ?? emptyCompletion(input);
    }
    return completeCommandPath(session.cwd, input, selectedIndex);
  }

  return completeFreeformPath(session.cwd, input, selectedIndex) ?? emptyCompletion(input);
}

export function describePromptHint(session: Pick<RuntimeSession, "cwd">, input: string): string | null {
  const trimmedLeft = input.replace(/^\s+/, "");
  const skillToken = findTrailingSkillToken(input);

  if (skillToken) {
    return describeSkillHint(session.cwd, skillToken.token);
  }

  if (trimmedLeft.startsWith("$")) {
    return describeSkillHint(session.cwd, trimmedLeft);
  }

  if (!trimmedLeft.startsWith("/")) {
    return null;
  }

  if (/^\/\S*$/.test(input)) {
    const partial = input.toLowerCase();
    const matches = COMMAND_CATALOG
      .map((entry) => entry.name)
      .filter((name) => name.startsWith(partial))
      .slice(0, 4);
    return matches.length > 0 ? `suggest: ${matches.join(" · ")}` : null;
  }

  return completeCommandPath(session.cwd, input).hint;
}

function findTrailingSkillToken(input: string): { start: number; token: string } | null {
  const match = input.match(/(?:^|\s)(\$[^\s]*)$/);
  if (!match || match.index === undefined) {
    return null;
  }
  const token = match[1] ?? "";
  if (token.length <= 1) {
    return null;
  }
  return {
    start: match.index + match[0].length - token.length,
    token,
  };
}

function completeSkillShorthand(cwd: string, input: string, tokenStart = 0, selectedIndex = 0): PromptCompletionResult {
  const token = input.slice(tokenStart);
  const prefix = input.slice(0, tokenStart);
  const parsed = parseSkillShorthand(token);
  const skills = discoverSkills(cwd);
  const needle = parsed ? normalizeSkillToken(parsed.skillName) : "";

  const matches = skills
    .filter((s) => normalizeSkillToken(s.name).startsWith(needle));

  if (matches.length === 0) {
    return emptyCompletion(input);
  }

  if (matches.length === 1) {
    const completed = `${prefix}$${matches[0].name} `;
    return completionResult(completed, matches[0].name, [{
      value: completed,
      label: `$${matches[0].name}`,
      hint: matches[0].source,
    }], 0);
  }

  const common = longestCommonPrefix(matches.map((s) => s.name));
  const tokenPrefix = needle.length > 0 ? `$${common}` : "$";
  const suggestions = matches.map((s) => `$${s.name}`).join(" · ");
  const completionSuggestions = matches.map((s) => ({
    value: `${prefix}$${s.name} `,
    label: `$${s.name}`,
    hint: s.source,
  }));
  const selected = clampIndex(selectedIndex, completionSuggestions.length);
  const commonValue = `${prefix}${tokenPrefix}`;
  return completionResult(
    commonValue.length > input.length ? commonValue : completionSuggestions[selected]?.value ?? input,
    `suggest: ${suggestions}`,
    completionSuggestions,
    selected,
  );
}

function describeSkillHint(cwd: string, input: string): string | null {
  const parsed = parseSkillShorthand(input);
  const skills = discoverSkills(cwd);
  const needle = parsed ? normalizeSkillToken(parsed.skillName) : "";

  const matches = skills
    .filter((s) => normalizeSkillToken(s.name).startsWith(needle))
    .slice(0, 6);

  if (matches.length === 0) {
    return null;
  }

  if (needle.length === 0) {
    return `skills: ${matches.map((s) => s.name).join(" · ")}`;
  }

  if (matches.length <= 3) {
    return `skills: ${matches.map((s) => `${s.name} (${s.source})`).join(" · ")}`;
  }

  return `skills: ${matches.map((s) => s.name).join(" · ")} +${skills.length - matches.length} more`;
}

function completeSlashCommand(input: string, selectedIndex = 0): PromptCompletionResult {
  const partial = input.toLowerCase();
  const matches = COMMAND_CATALOG.filter((entry) => entry.name.startsWith(partial));
  if (matches.length === 0) {
    return emptyCompletion(input);
  }
  if (matches.length === 1) {
    const match = matches[0];
    return completionResult(`${match.name} `, `${match.name} — ${match.description}`, [{
      value: `${match.name} `,
      label: match.name,
      hint: match.description,
    }], 0);
  }

  const names = matches.map((entry) => entry.name);
  const common = longestCommonPrefix(names);
  const suggestions = matches.map((entry) => ({
    value: `${entry.name} `,
    label: entry.name,
    hint: entry.description,
  }));
  const selected = clampIndex(selectedIndex, suggestions.length);
  return {
    value: common.length > partial.length ? common : suggestions[selected]?.value ?? input,
    hint: `commands: ${matches.slice(0, 6).map((entry) => `${entry.name} — ${entry.description}`).join(" · ")}`,
    suggestions,
    selectedIndex: selected,
  };
}

function completeCommandPath(cwd: string, input: string, selectedIndex = 0): PromptCompletionResult {
  const parts = input.split(/\s+/);
  const command = parts[0] ?? "";
  const pathSubcommands = PATH_SUBCOMMANDS.get(command);
  const hasPathSubcommand = Boolean(pathSubcommands?.has((parts[1] ?? "").toLowerCase()));
  const secondArgPath = SECOND_ARG_PATH_COMMANDS.has(command) && parts.length >= 3;
  const thirdArgPath = hasPathSubcommand && parts.length >= 3;
  const pathIndex = hasPathSubcommand ? 2 : SECOND_ARG_PATH_COMMANDS.has(command) ? 2 : 1;
  if (!PATH_COMPLETION_COMMANDS.has(command) && !secondArgPath && !thirdArgPath) {
    return emptyCompletion(input);
  }

  const partialPath = parts[pathIndex] ?? "";
  const completion = completePathFromCwd(cwd, partialPath, selectedIndex);
  if (!completion) {
    return emptyCompletion(input);
  }

  const nextParts = [...parts];
  nextParts[pathIndex] = completion.value;
  return {
    value: nextParts.join(" "),
    hint: completion.hint,
    suggestions: completion.suggestions.map((suggestion) => ({
      ...suggestion,
      value: withReplacedPart(parts, pathIndex, suggestion.value),
    })),
    selectedIndex: completion.selectedIndex,
  };
}

function completeFreeformPath(cwd: string, input: string, selectedIndex = 0): PromptCompletionResult | null {
  const match = input.match(/(?:^|\s)(~\/[^\s]*|~|\.{1,2}\/[^\s]*|\/[^\s]*|[^\s]*\/[^\s]*)$/);
  if (!match || match.index === undefined) {
    return null;
  }
  const token = match[1] ?? "";
  const tokenStart = match.index + match[0].length - token.length;
  const completion = completePathFromCwd(cwd, token, selectedIndex);
  if (!completion) {
    return null;
  }
  return completionResult(
    `${input.slice(0, tokenStart)}${completion.value}`,
    completion.hint,
    completion.suggestions.map((suggestion) => ({
      ...suggestion,
      value: `${input.slice(0, tokenStart)}${suggestion.value}`,
    })),
    completion.selectedIndex,
  );
}

function completePathFromCwd(cwd: string, partialPath: string, selectedIndex = 0): PromptCompletionResult | null {
  const normalizedInput = partialPath.length > 0 ? partialPath : ".";
  const baseToken = normalizedInput.endsWith("/") ? normalizedInput : path.dirname(normalizedInput);
  const needle = normalizedInput.endsWith("/") ? "" : path.basename(normalizedInput);
  const searchDir = resolveCompletionSearchDir(cwd, baseToken);

  let entries: Array<{ label: string; isDirectory: boolean }>;
  try {
    entries = readdirSync(searchDir, { withFileTypes: true })
      .filter((entry) => needle.startsWith(".") || !entry.name.startsWith("."))
      .filter((entry) => entry.name.startsWith(needle))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => ({ label: entry.name, isDirectory: entry.isDirectory() }));
  } catch {
    return null;
  }

  if (entries.length === 0) {
    return null;
  }

  const labels = entries.map((entry) => entry.label);
  const common = longestCommonPrefix(labels);
  const prefix = formatCompletionPrefix(baseToken);
  const suggestions = entries.map((entry) => {
    const value = `${prefix}${entry.label}${entry.isDirectory ? "/" : ""}`;
    return {
      value,
      label: value,
      hint: entry.isDirectory ? "directory" : "file",
    };
  });
  const selected = clampIndex(selectedIndex, suggestions.length);

  if (entries.length === 1) {
    const only = entries[0];
    const completed = `${prefix}${only.label}`;
    return completionResult(
      only.isDirectory ? `${completed}/` : completed,
      only.isDirectory ? `dir: ${completed}/` : `file: ${completed}`,
      suggestions,
      0,
    );
  }

  if (common.length > needle.length) {
    return completionResult(
      `${prefix}${common}`,
      `suggest: ${suggestions.slice(0, 6).map((entry) => `${entry.hint} ${entry.label}`).join(" · ")}`,
      suggestions,
      selected,
    );
  }

  return completionResult(
    suggestions[selected]?.value ?? partialPath,
    `suggest: ${suggestions.slice(0, 6).map((entry) => `${entry.hint} ${entry.label}`).join(" · ")}`,
    suggestions,
    selected,
  );
}

function emptyCompletion(input: string): PromptCompletionResult {
  return {
    value: input,
    hint: null,
    suggestions: [],
    selectedIndex: 0,
  };
}

function completionResult(
  value: string,
  hint: string | null,
  suggestions: PromptCompletionSuggestion[],
  selectedIndex: number,
): PromptCompletionResult {
  return {
    value,
    hint,
    suggestions,
    selectedIndex,
  };
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, index));
}

function withReplacedPart(parts: string[], index: number, value: string): string {
  const nextParts = [...parts];
  nextParts[index] = value;
  return nextParts.join(" ");
}

function resolveCompletionSearchDir(cwd: string, baseToken: string): string {
  if (baseToken === "." || baseToken.length === 0) {
    return cwd;
  }
  if (baseToken === "~") {
    return homedir();
  }
  if (baseToken.startsWith("~/")) {
    return path.join(homedir(), baseToken.slice(2));
  }
  if (path.isAbsolute(baseToken)) {
    return baseToken;
  }
  return path.resolve(cwd, baseToken);
}

function formatCompletionPrefix(baseToken: string): string {
  if (baseToken === "." || baseToken.length === 0) {
    return "";
  }
  if (baseToken === "~") {
    return "~/";
  }
  return `${baseToken.replace(/\/+$/, "")}/`;
}

function longestCommonPrefix(values: string[]): string {
  if (values.length === 0) {
    return "";
  }

  let prefix = values[0] ?? "";
  for (const value of values.slice(1)) {
    let index = 0;
    while (index < prefix.length && index < value.length && prefix[index] === value[index]) {
      index += 1;
    }
    prefix = prefix.slice(0, index);
    if (prefix.length === 0) {
      break;
    }
  }
  return prefix;
}
