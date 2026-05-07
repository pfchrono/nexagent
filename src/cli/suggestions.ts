import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

import { CODEX_MODEL_CATALOG } from "../models.js";
import { COMMAND_CATALOG } from "./catalog.js";
import { discoverSkills } from "./skills.js";

export type UnifiedSuggestionSource = "action" | "command" | "skill" | "model" | "effort" | "path" | "issue";

export interface UnifiedSuggestion {
  label: string;
  hint: string;
  value: string;
  source: UnifiedSuggestionSource;
  sourceLabel: string;
  score: number;
}

export interface UnifiedSuggestionResult {
  suggestions: UnifiedSuggestion[];
  selectedIndex: number;
}

export function createUnifiedSuggestions(
  cwd: string,
  query: string,
  selectedIndex = 0,
  options: { limit?: number } = {},
): UnifiedSuggestionResult {
  const limit = Math.max(1, options.limit ?? 80);
  const items = [
    ...coreActionSuggestions(),
    ...commandSuggestions(),
    ...skillSuggestions(cwd),
    ...issueSuggestions(cwd),
    ...modelSuggestions(),
    ...effortSuggestions(),
    ...pathSuggestions(cwd),
  ];
  const ranked = rankSuggestions(items, query).slice(0, limit);
  return {
    suggestions: ranked,
    selectedIndex: clampIndex(selectedIndex, ranked.length),
  };
}

function coreActionSuggestions(): UnifiedSuggestion[] {
  return [
    suggestion("action", "Status dashboard", "session · unified runtime dashboard", "/status dashboard"),
    suggestion("action", "Session timeline", "session · inspect goals, events, issues, and commits", "/sessions timeline"),
    suggestion("action", "Config dashboard", "ui · open interactive runtime configuration", "/config "),
    suggestion("action", "Keys", "ui · show keyboard shortcuts and interaction modes", "/keys "),
    suggestion("action", "Provider status", "control · show provider transport and capabilities", "/provider status"),
    suggestion("action", "Model picker", "control · choose model", "/model "),
    suggestion("action", "Effort picker", "control · choose reasoning effort", "/effort "),
    suggestion("action", "LSP status", "context · inspect local code intelligence", "/lsp status"),
    suggestion("action", "Memory status", "memory · inspect archivist memory", "/memory status"),
    suggestion("action", "Goal status", "workflow · inspect persistent goal", "/goal status"),
    suggestion("action", "Tools", "context · show repo-local tool policy", "/tools "),
    suggestion("action", "Attach image", "ui · queue image attachment path", "/attach "),
  ];
}

function commandSuggestions(): UnifiedSuggestion[] {
  return COMMAND_CATALOG.map((entry) =>
    suggestion("command", entry.name, `${commandCategory(entry.name)} · ${entry.description}`, `${entry.name} `)
  );
}

function skillSuggestions(cwd: string): UnifiedSuggestion[] {
  return discoverSkills(cwd).map((skill) => {
    const description = skill.description.trim();
    return suggestion("skill", `$${skill.name}`, description ? `${description} (${skill.source})` : skill.source, `/skill ${skill.name}`);
  });
}

function issueSuggestions(cwd: string): UnifiedSuggestion[] {
  const refs = new Set<string>();
  try {
    const branch = execFileSync("git", ["branch", "--show-current"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    });
    collectIssueRefs(branch, refs);
  } catch {
    // Issue suggestions are opportunistic; non-git dirs still get other sources.
  }
  try {
    const log = execFileSync("git", ["log", "-20", "--pretty=format:%s"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    });
    collectIssueRefs(log, refs);
  } catch {
    // Same best-effort boundary as branch refs.
  }
  return [...refs].slice(0, 20).map((ref) =>
    suggestion("issue", ref, "issue · referenced in git history", "/sessions timeline")
  );
}

function modelSuggestions(): UnifiedSuggestion[] {
  return CODEX_MODEL_CATALOG.map((entry) =>
    suggestion("model", entry.id, `${entry.description} · effort: ${entry.supportedReasoningEfforts.join("/")}`, `/model ${entry.id} `)
  );
}

function effortSuggestions(): UnifiedSuggestion[] {
  return ["low", "medium", "high", "xhigh"].map((effort) =>
    suggestion("effort", `effort ${effort}`, effortHint(effort), `/effort ${effort}`)
  );
}

function pathSuggestions(cwd: string): UnifiedSuggestion[] {
  const rows: UnifiedSuggestion[] = [
    suggestion("path", "List current directory", "file · list cwd", "/ls "),
    suggestion("path", "Find in files", "file · search text in repo files", "/find "),
    suggestion("path", "Read file", "file · read a path", "/read "),
  ];
  const candidates = [
    { root: cwd, prefix: "./" },
    { root: process.env.HOME ? path.join(process.env.HOME, "code") : "", prefix: "~/code/" },
  ];
  for (const candidate of candidates) {
    if (!candidate.root) {
      continue;
    }
    try {
      for (const entry of readdirSync(candidate.root, { withFileTypes: true }).slice(0, 12)) {
        const suffix = entry.isDirectory() ? "/" : "";
        const label = `${candidate.prefix}${entry.name}${suffix}`;
        rows.push(suggestion(
          "path",
          label,
          entry.isDirectory() ? "directory · open/list path" : "file · read path",
          entry.isDirectory() ? `/ls ${label}` : `/read ${label}`,
        ));
      }
    } catch {
      // File rows are opportunistic.
    }
  }
  return rows;
}

function suggestion(source: UnifiedSuggestionSource, label: string, hint: string, value: string): UnifiedSuggestion {
  return {
    source,
    sourceLabel: source,
    label,
    hint,
    value,
    score: 0,
  };
}

function rankSuggestions(items: UnifiedSuggestion[], rawQuery: string): UnifiedSuggestion[] {
  const query = rawQuery.trim().toLowerCase();
  return items
    .map((item, index) => {
      const sourcePriority = sourceRank(item.source);
      const matchScore = fuzzyMatchScore(`${item.label} ${item.hint} ${item.value}`.toLowerCase(), query);
      return {
        ...item,
        score: matchScore === null ? Number.POSITIVE_INFINITY : sourcePriority + matchScore,
        originalIndex: index,
      };
    })
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => left.score - right.score || left.originalIndex - right.originalIndex)
    .map(({ originalIndex: _originalIndex, ...entry }) => entry);
}

function sourceRank(source: UnifiedSuggestionSource): number {
  switch (source) {
    case "action":
      return 0;
    case "command":
      return 20;
    case "skill":
      return 40;
    case "issue":
      return 50;
    case "model":
      return 60;
    case "effort":
      return 70;
    case "path":
      return 80;
  }
}

function collectIssueRefs(text: string, refs: Set<string>): void {
  for (const match of text.matchAll(/#\d+/g)) {
    refs.add(match[0]);
  }
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
  if (["/help", "/reload", "/quit", "/continue", "/finish", "/status", "/usage", "/sessions", "/doctor", "/keys"].includes(command)) {
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

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(length - 1, index));
}
