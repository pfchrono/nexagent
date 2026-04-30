import { autocompletePromptBuffer, describePromptHint, type PromptCompletionResult, type PromptCompletionSuggestion } from "../cli/autocomplete.js";
import { COMMAND_CATALOG } from "../cli/catalog.js";
import {
  discoverSkills,
  normalizeSkillToken,
  parseSkillShorthand,
  toSkillCommandFromShorthand,
  type RuntimeSkillDefinition,
} from "../cli/skills.js";

export interface CommandPaletteRow {
  label: string;
  hint: string;
  value: string;
  selected: boolean;
}

export interface CommandSurface {
  title: string;
  query: string;
  rows: CommandPaletteRow[];
  completion: PromptCompletionResult;
  hint: string | null;
}

export interface SkillPreview {
  status: "none" | "resolved" | "ambiguous" | "missing";
  label: string;
  command: string | null;
  rows: CommandPaletteRow[];
}

export interface RuntimeCommandIntent {
  kind: "runtime-command" | "prompt";
  input: string;
}

export function createCommandSurface(cwd: string, input: string, selectedIndex = 0): CommandSurface {
  const completion = autocompletePromptBuffer({ cwd }, input, selectedIndex);
  const hint = describePromptHint({ cwd }, input);
  const trimmed = input.trimStart();
  const rows = rowsForInput(cwd, trimmed, completion, selectedIndex);
  return {
    title: surfaceTitle(trimmed),
    query: trimmed,
    rows,
    completion,
    hint,
  };
}

export function resolveSkillPreview(cwd: string, input: string, selectedIndex = 0): SkillPreview {
  const parsed = parseSkillInput(input);
  if (!parsed) {
    return { status: "none", label: "", command: null, rows: [] };
  }

  const skills = discoverSkills(cwd);
  const needle = normalizeSkillToken(parsed.skillName);
  const matches = skills
    .filter((skill) => normalizeSkillToken(skill.name).startsWith(needle))
    .sort((left, right) => left.name.localeCompare(right.name));

  if (matches.length === 0) {
    return { status: "missing", label: "No matches", command: null, rows: [] };
  }

  const selected = clampIndex(selectedIndex, matches.length);
  const rows = matches.map((skill, index) => ({
    label: skill.name,
    hint: skillPaletteHint(skill),
    value: `/skill ${skill.name}${parsed.rawArgs ? ` ${parsed.rawArgs}` : ""}`,
    selected: index === selected,
  }));

  if (matches.length === 1 || normalizeSkillToken(matches[0]?.name ?? "") === needle) {
    const skill = matches[0]!;
    const command = `/skill ${skill.name}${parsed.rawArgs ? ` ${parsed.rawArgs}` : ""}`;
    return {
      status: "resolved",
      label: `skill: ${skill.name}`,
      command,
      rows: rows.slice(0, 1),
    };
  }

  return {
    status: "ambiguous",
    label: "Select skill",
    command: null,
    rows,
  };
}

export function createRuntimeCommandIntent(input: string, skillPreview?: SkillPreview): RuntimeCommandIntent {
  const trimmed = input.trim();
  if (skillPreview?.command) {
    return { kind: "runtime-command", input: skillPreview.command };
  }
  const shorthand = toSkillCommandFromShorthand(trimmed);
  if (shorthand) {
    return { kind: "runtime-command", input: shorthand };
  }
  return {
    kind: trimmed.startsWith("/") || trimmed.startsWith("!") ? "runtime-command" : "prompt",
    input: trimmed,
  };
}

function rowsForInput(
  cwd: string,
  trimmed: string,
  completion: PromptCompletionResult,
  selectedIndex: number,
): CommandPaletteRow[] {
  if (trimmed.startsWith("/") && !trimmed.includes(" ")) {
    const partial = trimmed.toLowerCase();
    const matches = COMMAND_CATALOG.filter((entry) => entry.name.startsWith(partial));
    const selected = clampIndex(selectedIndex, matches.length);
    return matches.map((entry, index) => ({
      label: entry.name,
      hint: entry.description,
      value: `${entry.name} `,
      selected: index === selected,
    }));
  }

  const skill = resolveSkillPreview(cwd, trimmed, selectedIndex);
  if (skill.status !== "none") {
    return skill.rows;
  }

  return completion.suggestions.map((suggestion, index) => suggestionToRow(suggestion, index, completion.selectedIndex));
}

function suggestionToRow(suggestion: PromptCompletionSuggestion, index: number, selectedIndex: number): CommandPaletteRow {
  return {
    label: suggestion.label,
    hint: suggestion.hint,
    value: suggestion.value,
    selected: index === selectedIndex,
  };
}

function skillPaletteHint(skill: RuntimeSkillDefinition): string {
  const description = skill.description.trim();
  return description ? `${description} (${skill.source})` : skill.source;
}

function surfaceTitle(trimmed: string): string {
  if (trimmed.startsWith("$") || trimmed.startsWith("/skill")) {
    return "Select skill";
  }
  return "Command palette";
}

function parseSkillInput(input: string): { skillName: string; rawArgs: string } | null {
  const trimmed = input.trim();
  const shorthand = parseSkillShorthand(trimmed);
  if (shorthand) {
    return shorthand;
  }
  const skillCommand = trimmed.match(/^\/skill(?:\s+([^\s]+))?(?:\s+(.*))?$/);
  if (!skillCommand) {
    return null;
  }
  const skillName = normalizeSkillToken(skillCommand[1] ?? "");
  return {
    skillName,
    rawArgs: skillCommand[2] ?? "",
  };
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, index));
}
