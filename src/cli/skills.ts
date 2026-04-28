import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { RuntimeSession } from "../runtime/session.js";

export interface RuntimeSkillDefinition {
  name: string;
  description: string;
  source: string;
  path: string;
  aliases: string[];
}

export interface RuntimeSkillResolution {
  mode: "exact" | "alias" | "prefix" | "fuzzy";
  skill: RuntimeSkillDefinition;
}

export function formatSkillList(session: RuntimeSession, skills: RuntimeSkillDefinition[]): string {
  if (skills.length === 0) {
    return "no skills found";
  }
  const activeName = session.activeSkill?.name ?? "";
  const withStatus = skills.map((skill) => ({ ...skill, status: skill.name === activeName ? "*" : "" }));
  const nameWidth = Math.max(4, ...withStatus.map((skill) => visibleLength(skill.name)));
  const sourceWidth = Math.max(6, ...withStatus.map((skill) => visibleLength(skill.source)));
  const lines = [
    `${padText("name", nameWidth)}  ${padText("source", sourceWidth)}  description`,
    `${"-".repeat(nameWidth)}  ${"-".repeat(sourceWidth)}  -----------`,
  ];
  for (const skill of withStatus) {
    lines.push(`${skill.status ? "*" : " "}${padText(skill.name, nameWidth)}  ${padText(skill.source, sourceWidth)}  ${skill.description}`);
  }
  return lines.join("\n");
}

export function discoverSkills(cwd: string): RuntimeSkillDefinition[] {
  const roots = [
    path.join(cwd, ".codex", "skills"),
    path.join(cwd, ".agents", "skills"),
    path.join(homedir(), ".codex", "skills"),
    path.join(homedir(), ".agents", "skills"),
  ];
  const skills: RuntimeSkillDefinition[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }
    const source = root.startsWith(cwd) ? "project" : "user";
    for (const entry of safeReaddir(root)) {
      const folderPath = path.join(root, entry);
      const stat = safeStat(folderPath);
      if (!stat?.isDirectory()) {
        continue;
      }
      const skillPath = path.join(folderPath, "SKILL.md");
      if (!existsSync(skillPath)) {
        continue;
      }
      const parsed = parseSkillFile(skillPath, entry);
      const dedupe = normalizeSkillToken(parsed.name);
      if (!dedupe || seen.has(dedupe)) {
        continue;
      }
      seen.add(dedupe);
      skills.push({
        name: parsed.name,
        description: parsed.description,
        source,
        path: skillPath,
        aliases: parsed.aliases,
      });
    }
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}

function parseSkillFile(skillPath: string, fallbackName: string): { name: string; description: string; aliases: string[] } {
  const content = safeReadFile(skillPath) ?? "";
  const frontmatter = content.match(/^---\n([\s\S]*?)\n---/);
  const metadata = frontmatter?.[1] ?? "";
  const name = metadata.match(/^name:\s*"?([^"\n]+)"?\s*$/m)?.[1]?.trim() || fallbackName;
  const description = metadata.match(/^description:\s*"?([^"\n]+)"?\s*$/m)?.[1]?.trim()
    || metadata.match(/^short-description:\s*"?([^"\n]+)"?\s*$/m)?.[1]?.trim()
    || "no description";
  const aliasesLine = metadata.match(/^aliases:\s*\[([^\]]*)\]\s*$/m)?.[1] ?? "";
  const aliases = aliasesLine
    .split(",")
    .map((alias) => normalizeSkillToken(alias.replaceAll('"', "").replaceAll("'", "")))
    .filter((alias) => alias.length > 0);
  return { name, description, aliases };
}

export function readSkillContent(skillPath: string): string {
  const content = safeReadFile(skillPath);
  if (!content) {
    throw new Error(`unable to read skill: ${skillPath}`);
  }
  return content;
}

export function resolveSkill(skills: RuntimeSkillDefinition[], skillName: string): RuntimeSkillResolution | null {
  const needle = normalizeSkillToken(skillName);
  if (!needle) {
    return null;
  }
  const exact = skills.find((skill) => normalizeSkillToken(skill.name) === needle);
  if (exact) {
    return { mode: "exact", skill: exact };
  }
  const alias = skills.find((skill) => skill.aliases.includes(needle));
  if (alias) {
    return { mode: "alias", skill: alias };
  }
  const prefixCandidates = skills.filter((skill) => normalizeSkillToken(skill.name).startsWith(needle));
  if (prefixCandidates.length > 0) {
    prefixCandidates.sort((left, right) => left.name.localeCompare(right.name));
    return { mode: "prefix", skill: prefixCandidates[0]! };
  }
  const fuzzy = rankClosestSkills(skills, needle, 1)[0];
  return fuzzy ? { mode: "fuzzy", skill: fuzzy } : null;
}

export function rankClosestSkills(skills: RuntimeSkillDefinition[], skillName: string, limit: number): RuntimeSkillDefinition[] {
  const needle = normalizeSkillToken(skillName);
  return skills
    .map((skill) => ({ skill, distance: levenshteinDistance(needle, normalizeSkillToken(skill.name)) }))
    .sort((left, right) => (left.distance - right.distance) || left.skill.name.localeCompare(right.skill.name))
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.skill);
}

export function normalizeSkillToken(value: string): string {
  return value.trim().replace(/^\$+/, "").replace(/^\/+/, "").toLowerCase();
}

export function parseSkillShorthand(input: string): { skillName: string; rawArgs: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("$") || trimmed.startsWith("$ ")) {
    return null;
  }
  const match = trimmed.match(/^\$([^\s]+)(?:\s+(.*))?$/);
  if (!match) {
    return null;
  }
  const skillName = normalizeSkillToken(match[1] ?? "");
  return skillName ? { skillName, rawArgs: match[2] ?? "" } : null;
}

export function toSkillCommandFromShorthand(input: string): string | null {
  const parsed = parseSkillShorthand(input);
  if (!parsed) {
    return null;
  }
  return `/skill ${parsed.skillName}${parsed.rawArgs.length > 0 ? ` ${parsed.rawArgs}` : ""}`;
}

function safeReadFile(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

function safeReaddir(dirPath: string): string[] {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

function safeStat(filePath: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

function padText(value: string, width: number): string {
  const visible = visibleLength(value);
  return visible >= width ? value : `${value}${" ".repeat(width - visible)}`;
}

function visibleLength(value: string): number {
  return [...value].length;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }
  const prev = new Array<number>(b.length + 1);
  const next = new Array<number>(b.length + 1);
  for (let index = 0; index <= b.length; index += 1) {
    prev[index] = index;
  }
  for (let i = 1; i <= a.length; i += 1) {
    next[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(
        (next[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = next[j] ?? 0;
    }
  }
  return prev[b.length] ?? 0;
}
