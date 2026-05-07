import type { RuntimeSession } from "./session.js";

const PROTECTED_SEGMENT_PATTERN = /```[\s\S]*?```|`[^`]*`|<[^>]+>|https?:\/\/[^\s)]+|\b(?:[A-Za-z]:\\|\.\/|\.\.\/|\/)[^\s]*/g;
const STACK_TRACE_LINE_PATTERN = /^\s*(?:at\s+.+|\.{3}\s+\d+\s+more|[A-Za-z0-9_$]+Error:.*)$/m;
const SHELLISH_LINE_PATTERN = /^\s*(?:\$\s+|bun\s+|npm\s+|npx\s+|pnpm\s+|yarn\s+|git\s+|gh\s+|python(?:3)?\s+|node\s+|deno\s+|docker\s+|kubectl\s+|cd\s+|ls\s+|cat\s+|mv\s+|cp\s+|rm\s+)/m;
const JSONISH_PATTERN = /^\s*[\[{]/;
const XMLISH_PATTERN = /<system-reminder>|<command-message>|<command-name>|<command-args>|<tool_uses>|<functions>|<function>|<nexagent_/;
const QUOTED_ERROR_PATTERN = /"[^"\n]*(?:error|exception|failed|invalid_request)[^"\n]*"/i;
const PROTECTED_PLACEHOLDER_ONLY_PATTERN = /^(?:__NEXAGENT_STYLE_PROTECTED_\d+__|\s)+$/;

const PHRASE_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bin order to\b/gi, "to"],
  [/\bdo not\b/gi, "don't"],
  [/\bdoes not\b/gi, "doesn't"],
  [/\bis not\b/gi, "isn't"],
  [/\bare not\b/gi, "aren't"],
  [/\bthat is\b/gi, "that's"],
  [/\bit is\b/gi, "it's"],
  [/\byou should\b/gi, ""],
  [/\bplease\b/gi, ""],
  [/\bjust\b/gi, ""],
  [/\breally\b/gi, ""],
  [/\bbasically\b/gi, ""],
  [/\bactually\b/gi, ""],
  [/\bessentially\b/gi, ""],
  [/\bgenerally\b/gi, ""],
  [/\bhappy to help\b/gi, ""],
  [/\bI would recommend\b/gi, "recommend"],
  [/\bit might be worth\b/gi, ""],
  [/\byou could consider\b/gi, ""],
  [/\bit would be good to\b/gi, ""],
  [/\bthe reason is because\b/gi, "because"],
  [/\bhowever\b/gi, "but"],
  [/\bfurthermore\b/gi, ""],
  [/\badditionally\b/gi, ""],
  [/\bin addition\b/gi, ""],
  [/\bextensive\b/gi, "big"],
  [/\bimplement a solution for\b/gi, "fix"],
  [/\butilize\b/gi, "use"],
];

const WORD_REPLACEMENTS: Array<[RegExp, string]> = [
  [/\bthe\b/gi, ""],
  [/\ba\b/gi, ""],
  [/\ban\b/gi, ""],
];

export function styleAssistantOutput(session: RuntimeSession, output: string): string {
  const styled = session.commandModes.cavemanMode ? compactCavemanText(output) : output;
  return compactVerboseAssistantOutput(styled);
}

export function compactVerboseAssistantOutput(output: string): string {
  const lines = output.split(/\r?\n/);
  if (!looksLikeRawEvidenceDump(output, lines)) {
    return output;
  }

  const kept = lines
    .filter((line) => shouldKeepVerboseOutputLine(line))
    .slice(0, 18);
  const fallback = lines
    .filter((line) => line.trim().length > 0)
    .slice(0, 8);
  const visible = kept.length > 0 ? kept : fallback;
  const omittedLines = Math.max(0, lines.length - visible.length);
  return [
    ...visible,
    `[assistant output compacted: omitted ${String(omittedLines)} raw evidence line${omittedLines === 1 ? "" : "s"}; expand trace for tool details]`,
  ].join("\n").trim();
}

export function shouldCompactCavemanText(text: string): boolean {
  const tokenized = text.replace(PROTECTED_SEGMENT_PATTERN, "__NEXAGENT_STYLE_PROTECTED__");
  return tokenized.split("\n").some((segment) => shouldCompactPlainText(segment));
}

export function compactCavemanText(text: string): string {
  const protectedSegments: string[] = [];
  const tokenized = text.replace(PROTECTED_SEGMENT_PATTERN, (match) => {
    const index = protectedSegments.push(match) - 1;
    return `__NEXAGENT_STYLE_PROTECTED_${String(index)}__`;
  });

  if (!tokenized.split("\n").some((segment) => shouldCompactPlainText(segment))) {
    return text;
  }

  const compactedLines = tokenized
    .split("\n")
    .map((segment) => shouldCompactPlainText(segment) ? compactPlainSegment(segment) : segment);

  const compacted = compactedLines
    .join("\n")
    .replace(/__NEXAGENT_STYLE_PROTECTED_(\d+)__/g, (_match, index: string) => protectedSegments[Number(index)] ?? "");

  return compacted || text;
}

function shouldCompactPlainText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (PROTECTED_PLACEHOLDER_ONLY_PATTERN.test(trimmed)) return false;
  if (STACK_TRACE_LINE_PATTERN.test(trimmed)) return false;
  if (SHELLISH_LINE_PATTERN.test(trimmed)) return false;
  if (JSONISH_PATTERN.test(trimmed)) return false;
  if (XMLISH_PATTERN.test(trimmed)) return false;
  if (QUOTED_ERROR_PATTERN.test(trimmed)) return false;
  return true;
}

function looksLikeRawEvidenceDump(output: string, lines: string[]): boolean {
  if (looksLikeStructuredCandidateReport(output)) {
    return false;
  }
  if (output.length > 4_000 && lines.length > 28) {
    return true;
  }
  const pathLikeLines = lines.filter((line) => /^\s*(?:\.planning\/|src\/|test\/|\.codex\/|package\.json\b|README\.md\b)/.test(line)).length;
  if (pathLikeLines >= 12) {
    return true;
  }
  const transcriptLines = lines.filter((line) => /^\s*(?:Tool call:|Tool result|Step \d+|--- [A-Z0-9 _-]+ ---)/.test(line)).length;
  return transcriptLines >= 3 && lines.length > 18;
}

function looksLikeStructuredCandidateReport(output: string): boolean {
  const numberedHeadings = new Set(
    [...output.matchAll(/^\s*(\d{1,2})[\.)]\s+\S/gm)].map((match) => match[1]),
  );
  if (numberedHeadings.size < 3) {
    return false;
  }
  if (!/\b(?:architecture|deepening|seam|module|adapter|interface|provider|runtime|transport)\b/i.test(output)) {
    return false;
  }
  const fieldCount = [
    /\bProblem\b/i,
    /\bSolution\b/i,
    /\bBenefits?\b/i,
    /\bFiles?\b/i,
    /\bEvidence\b/i,
    /\bLeverage\b/i,
  ].filter((pattern) => pattern.test(output)).length;
  return fieldCount >= 3;
}

function shouldKeepVerboseOutputLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return false;
  }
  if (/^(?:observed|verified|blocked|blocker|next|result|summary|changed|tool budget|verified:|observed\/verified)\b/i.test(trimmed)) {
    return true;
  }
  if (/^(?:\[.\]|\[x\]|\[>\]|\[ \])\s*todo-/i.test(trimmed)) {
    return true;
  }
  return /(?:complete|failed|blocked|clean|dirty|exhausted|unavailable|mismatch|next step|todo-\d+)/i.test(trimmed)
    && !/^\s*(?:\.planning\/|src\/|test\/)/.test(line);
}

function compactPlainSegment(text: string): string {
  let output = text;
  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    output = output.replace(pattern, replacement);
  }
  for (const [pattern, replacement] of WORD_REPLACEMENTS) {
    output = output.replace(pattern, replacement);
  }
  return normalizeWhitespace(output);
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
