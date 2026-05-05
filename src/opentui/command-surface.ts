import { autocompletePromptBuffer, describePromptHint, type PromptCompletionResult, type PromptCompletionSuggestion } from "../cli/autocomplete.js";
import { COMMAND_CATALOG } from "../cli/catalog.js";
import { CODEX_MODEL_CATALOG } from "../models.js";
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
    title: surfaceTitle(trimmed, completion),
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
  const matches = rankSkillMatches(skills, needle);

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
  if (/^\/model(?:\s+list)?\s*$/i.test(trimmed)) {
    const selected = clampIndex(selectedIndex, CODEX_MODEL_CATALOG.length);
    return CODEX_MODEL_CATALOG.map((entry, index) => ({
      label: entry.id,
      hint: `${entry.description} · effort: ${entry.supportedReasoningEfforts.join("/")}`,
      value: `/model ${entry.id} `,
      selected: index === selected,
    }));
  }

  if (/^\/effort\s*$/i.test(trimmed)) {
    const efforts = ["low", "medium", "high", "xhigh"];
    const selected = clampIndex(selectedIndex, efforts.length);
    return efforts.map((effort, index) => ({
      label: effort,
      hint: effortHint(effort),
      value: `/effort ${effort}`,
      selected: index === selected,
    }));
  }

  if (trimmed.startsWith("/") && !trimmed.includes(" ")) {
    const query = trimmed.replace(/^\//, "");
    const matches = rankByQuery(COMMAND_CATALOG, query, (entry) => entry.name.replace(/^\//, ""));
    const selected = clampIndex(selectedIndex, matches.length);
    return matches.map((entry, index) => ({
      label: entry.name,
      hint: `${commandCategory(entry.name)} · ${entry.description}`,
      value: `${entry.name} `,
      selected: index === selected,
    }));
  }

  if (/^\/model\s+\S*$/.test(trimmed)) {
    const query = trimmed.replace(/^\/model\s+/, "").toLowerCase();
    const matches = rankByQuery(CODEX_MODEL_CATALOG, query, (entry) => `${entry.id} ${entry.label}`);
    const selected = clampIndex(selectedIndex, matches.length);
    return matches.map((entry, index) => ({
      label: entry.id,
      hint: `${entry.description} · effort: ${entry.supportedReasoningEfforts.join("/")}`,
      value: `/model ${entry.id} `,
      selected: index === selected,
    }));
  }

  if (/^\/effort\s+\S*$/.test(trimmed) || /^\/model\s+\S+\s+\S*$/.test(trimmed)) {
    const modelMatch = trimmed.match(/^\/model\s+(\S+)\s+(\S*)$/);
    const commandPrefix = modelMatch ? `/model ${modelMatch[1]} ` : "/effort ";
    const query = (modelMatch?.[2] ?? trimmed.replace(/^\/effort\s+/, "")).toLowerCase();
    const efforts = ["low", "medium", "high", "xhigh"];
    const matches = rankByQuery(efforts, query, (effort) => effort);
    const selected = clampIndex(selectedIndex, matches.length);
    return matches.map((effort, index) => ({
      label: effort,
      hint: effortHint(effort),
      value: `${commandPrefix}${effort}`,
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

function rankByQuery<T>(items: readonly T[], rawQuery: string, getText: (item: T) => string): T[] {
  const query = rawQuery.trim().toLowerCase();
  return items
    .map((item, index) => ({ item, index, score: fuzzyMatchScore(getText(item).toLowerCase(), query) }))
    .filter((entry) => entry.score !== null)
    .sort((left, right) => left.score! - right.score! || left.index - right.index)
    .map((entry) => entry.item);
}

function rankSkillMatches(skills: RuntimeSkillDefinition[], needle: string): RuntimeSkillDefinition[] {
  const prefixMatches = skills
    .filter((skill) => normalizeSkillToken(skill.name).startsWith(needle))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (needle.length === 0 || prefixMatches.length > 0) {
    return prefixMatches;
  }
  return rankByQuery(skills, needle, (skill) => normalizeSkillToken(skill.name));
}

function fuzzyMatchScore(text: string, query: string): number | null {
  if (query.length === 0 || query === "/") {
    return 0;
  }
  if (text === query) {
    return 0;
  }
  if (text.startsWith(query)) {
    return 10 + text.length - query.length;
  }
  const wordStart = text
    .split(/[\s/_:-]+/)
    .some((part) => part.startsWith(query));
  if (wordStart) {
    return 40 + text.indexOf(query);
  }
  if (text.includes(query)) {
    return 80 + text.indexOf(query);
  }

  let searchFrom = 0;
  let gapCost = 0;
  for (const char of query) {
    const index = text.indexOf(char, searchFrom);
    if (index === -1) {
      return null;
    }
    gapCost += index - searchFrom;
    searchFrom = index + 1;
  }
  return 140 + gapCost + text.length - query.length;
}

function commandCategory(command: string): string {
  if (["/help", "/reload", "/quit", "/continue", "/finish", "/status", "/usage", "/doctor", "/keys"].includes(command)) {
    return "session";
  }
  if (["/provider", "/model", "/effort", "/codex", "/login", "/approval"].includes(command)) {
    return "control";
  }
  if (["/skill", "/boomerang", "/goal", "/btw", "/agents", "/todos", "/ask", "/steer", "/cancel"].includes(command)) {
    return "workflow";
  }
  if (["/pwd", "/ls", "/read", "/find", "/glob", "/rg", "/diff", "/lsp", "/scip", "/nexsight", "/tools"].includes(command)) {
    return "context";
  }
  if (["/notify", "/emoji", "/color", "/mouse", "/statusline", "/config", "/attach", "/detach"].includes(command)) {
    return "ui";
  }
  if (["/memory", "/compact"].includes(command)) {
    return "memory";
  }
  if (["/safegit", "/why-blocked", "/hooks", "/extensions"].includes(command)) {
    return "safety";
  }
  return "command";
}

function skillPaletteHint(skill: RuntimeSkillDefinition): string {
  const description = skill.description.trim();
  return description ? `${description} (${skill.source})` : skill.source;
}

function effortHint(effort: string): string {
  if (effort === "low") {
    return "fastest, lighter reasoning";
  }
  if (effort === "medium") {
    return "balanced default";
  }
  if (effort === "high") {
    return "deeper reasoning";
  }
  return "extra high reasoning";
}

function surfaceTitle(trimmed: string, completion: PromptCompletionResult): string {
  if (trimmed.startsWith("$") || trimmed.startsWith("/skill")) {
    return "$ Skills";
  }
  if (/^\/model(?:\s+list)?\s*$/i.test(trimmed) || /^\/model\s+\S+$/i.test(trimmed)) {
    return "Models";
  }
  if (/^\/effort(?:\s+\S*)?$/i.test(trimmed) || /^\/model\s+\S+\s+\S*$/i.test(trimmed)) {
    return "Effort";
  }
  if (trimmed.startsWith("/") && !trimmed.includes(" ")) {
    return "/ Commands";
  }
  if (completionLooksLikePath(trimmed) || completion.suggestions.some((row) => row.hint === "file" || row.hint === "directory")) {
    return "Files";
  }
  return "Suggestions";
}

function completionLooksLikePath(trimmed: string): boolean {
  const token = trimmed.split(/\s+/).at(-1) ?? "";
  return token.startsWith("./") || token.startsWith("../") || token.startsWith("~/") || token.startsWith("/");
}

function parseSkillInput(input: string): { skillName: string; rawArgs: string } | null {
  const trimmed = input.trim();
  if (trimmed === "$") {
    return { skillName: "", rawArgs: "" };
  }
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
