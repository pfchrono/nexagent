import path from "node:path";

import type { InstructionContext } from "./instructions.js";
import { formatInternalToolPromptGuidance } from "./tools.js";

export type PromptSectionKey =
  | "identity"
  | "responseStyle"
  | "executionGuidance"
  | "repoBehavior"
  | "activeSkill"
  | "taskContext"
  | "importedDefaults"
  | "toolAvailability"
  | "providerFallback"
  | "archivistContext"
  | "conversationContext"
  | "explicitInvocation";

export type PromptSectionCacheMode = "stable" | "dynamic";

export interface PromptSection {
  key: PromptSectionKey;
  title: string;
  cache: PromptSectionCacheMode;
  entries: string[];
}

export interface PromptLayers {
  identity: string[];
  responseStyle: string[];
  executionGuidance: string[];
  explicitInvocation: string;
  activeSkill: string[];
  repoBehavior: string[];
  taskContext: string[];
  importedDefaults: string[];
  toolAvailability: string[];
  providerFallback: string[];
  archivistContext: string[];
  conversationContext: string[];
  sections: PromptSection[];
  dynamicBoundary: string;
}

export interface PromptLayerSummary {
  count: number;
  identity: string;
  responseStyle: string;
  executionGuidance: string;
  repoBehavior: string;
  activeSkill: string;
  taskContext: string;
  importedDefaults: string;
  toolAvailability: string;
  providerFallback: string;
  archivistContext: string;
  conversationContext: string;
  stableSections: string;
  dynamicSections: string;
  dynamicBoundary: string;
}

const PROMPT_SEPARATOR = "\n\n";
export const SYSTEM_PROMPT_DYNAMIC_BOUNDARY = "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__";
const OPENSPEC_DEFAULTS = [
  "Follow repo-local instructions over imported defaults when they conflict.",
  "Treat OpenSpec artifacts as current task context and implementation intent, not user intent overrides.",
];
const SYSTEM_IDENTITY_DEFAULTS = [
  "You are nexagent, local coding harness assistant for repo-aware software engineering work.",
];
const EXECUTION_GUIDANCE_DEFAULTS = [
  "Use repo-local instructions and configuration as primary operating contract after direct user intent.",
  "Operating loop: understand user goal, inspect current state, choose best tool, execute, observe result, recover from failures, verify, then answer with evidence.",
  "For coding tasks, default to action. Discuss only when user explicitly asks to brainstorm, plan, compare options, or pause implementation.",
  "Read relevant code before changing behavior, then keep edits scoped to requested outcome.",
  "Use available runtime tools and commands to act on code or repo state instead of only describing intent.",
  "Do not claim code, files, tests, or verification happened unless you actually performed them in this session.",
  "Every final claim about files, tests, tools, GSD workspaces, MCP, or runtime state must be backed by current turn evidence or clearly marked as inference.",
  "Keep going until the user's query is completely resolved; only stop for a real blocker, approval gate, or completed verified result.",
  "If a tool call fails, diagnose the failure and try a smaller or safer equivalent before stopping.",
  "If a needed tool is unavailable, look for a repo-local or user-local install path and install/use it when safe; if needed, use web_search/web_fetch or MCP docs tools to find official install guidance; if root/admin/system installation is required, give the exact install instruction and continue with the best available fallback.",
  "When user asks to continue, keep going, start, or finish a task, continue working until task is complete or a real blocker stops progress.",
  "If user replies with approval such as yes, do that, apply it, continue, or go ahead after you proposed concrete work, treat it as authorization to execute the proposed work now.",
  "When user authorizes a sequence of checks or steps, keep running remaining steps without asking again after each substep unless a blocker, failure, or approval gate stops progress.",
  "Prefer action over narration: inspect, edit, run checks, and verify before reporting outcome.",
  "For execution requests, do not answer with only intention or reassurance. Perform the work in the same turn unless blocked.",
  "Do not tell the user to run commands, paste shell snippets, or confirm next steps when you have a tool that can perform the action.",
  "Do not ask user to say apply it, confirm, or continue when they already gave approval; use tools or state the real blocker.",
  "Do not say you are about to run checks, continue later, or report back soon. Run the checks or state the blocker now.",
  "If user asks for smoke tests, debugging, implementation, or verification, use tools and produce actual results instead of a promise.",
  "If task requires external context, first use available local repos, readable roots, MCP tools, or web tools before asking the user for pasted context.",
  "If user asks for exact, full, verbatim, or complete file/chat/transcript content, preserve exact content instead of summarizing. If exact content is unavailable, say what is missing plainly.",
  "Report verification truthfully. If checks were not run or failed, say so plainly.",
  "When edit tool output already rendered an Edited-file block or bounded diff preview, final answer should not repeat the full diff; summarize changed paths, line counts, verification, and blockers only.",
];
const PROVIDER_FALLBACK_DEFAULTS = [
  "Honor active provider routing for this session.",
  "Do not silently switch providers; require explicit spec-backed routing changes.",
];

export function buildPromptLayers(session: InstructionContext, explicitInvocation: string): PromptLayers {
  const identity = [...SYSTEM_IDENTITY_DEFAULTS];
  const responseStyle = buildResponseStyle(session);
  const executionGuidance = [...EXECUTION_GUIDANCE_DEFAULTS];
  const repoBehavior: string[] = [];
  const taskContext: string[] = [...OPENSPEC_DEFAULTS];
  const importedDefaults: string[] = [];

  for (const source of session.instructionSources) {
    const entry = formatInstructionSource(source);
    if (!entry) {
      continue;
    }

    if (source.layer === "repoBehavior") {
      repoBehavior.push(entry);
      continue;
    }

    taskContext.push(entry);
  }

  if (session.imports.claude) {
    importedDefaults.push(
      `Imported Claude defaults: ${path.basename(session.imports.claude.path)} provides ${session.imports.claude.importedKeys.join(", ")}.`,
    );
  }

  const layers: PromptLayers = {
    identity,
    responseStyle,
    executionGuidance,
    explicitInvocation: explicitInvocation.trim(),
    repoBehavior,
    activeSkill: buildActiveSkillContext(session),
    taskContext,
    importedDefaults,
    toolAvailability: buildToolAvailability(session),
    providerFallback: buildProviderFallback(session),
    archivistContext: buildArchivistContext(session),
    conversationContext: buildConversationContext(session),
    sections: [],
    dynamicBoundary: SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
  };

  layers.sections = buildPromptSections(layers);

  return layers;
}

export function summarizePromptLayers(layers: PromptLayers): PromptLayerSummary {
  const stableSections = layers.sections.filter((section) => section.cache === "stable").map((section) => section.key);
  const dynamicSections = layers.sections.filter((section) => section.cache === "dynamic").map((section) => section.key);

  return {
    count: countInstructionEntries(layers),
    identity: summarizeLayerEntries(layers.identity),
    responseStyle: summarizeLayerEntries(layers.responseStyle),
    executionGuidance: summarizeLayerEntries(layers.executionGuidance),
    activeSkill: summarizeLayerEntries(layers.activeSkill),
    repoBehavior: summarizeLayerEntries(layers.repoBehavior),
    taskContext: summarizeLayerEntries(layers.taskContext),
    importedDefaults: summarizeLayerEntries(layers.importedDefaults),
    toolAvailability: summarizeLayerEntries(layers.toolAvailability),
    providerFallback: summarizeLayerEntries(layers.providerFallback),
    archivistContext: summarizeLayerEntries(layers.archivistContext),
    conversationContext: summarizeLayerEntries(layers.conversationContext),
    stableSections: stableSections.join(", "),
    dynamicSections: dynamicSections.join(", "),
    dynamicBoundary: layers.dynamicBoundary,
  };
}

export function serializePromptLayers(layers: PromptLayers): string {
  const stableSections = layers.sections
    .filter((section) => section.cache === "stable")
    .map(serializePromptSection)
    .filter((section): section is string => Boolean(section));
  const dynamicSections = layers.sections
    .filter((section) => section.cache === "dynamic")
    .map(serializePromptSection)
    .filter((section): section is string => Boolean(section));

  if (dynamicSections.length === 0) {
    return stableSections.join(PROMPT_SEPARATOR);
  }

  return [...stableSections, layers.dynamicBoundary, ...dynamicSections].join(PROMPT_SEPARATOR);
}

function buildToolAvailability(session: InstructionContext): string[] {
  const details = [`Working directory: ${session.cwd}`, `Loaded MCP servers: ${formatList(session.mcpServers)}`];
  if (session.toolPolicy) {
    details.push(`Readable roots: ${formatList(session.toolPolicy.readRoots ?? ["all non-protected paths"])}. Any child path under a readable root is readable unless it is protected.`);
    details.push(`Writable roots: ${formatList(session.toolPolicy.allowedRoots)}. Non-yolo writes are limited to these roots.`);
    details.push("Yolo mode: write tools may edit readable roots, but protected/system paths remain blocked.");
    details.push("Path rule: absolute paths and ~/ paths are supported; if a requested path is under a readable root, inspect it with tools instead of refusing because it is outside cwd.");
  }

  if (session.enabledMcpServers.length > 0) {
    details.push(`Enabled MCP servers: ${formatList(session.enabledMcpServers)}`);
    details.push("MCP guidance: if an enabled MCP server/tool is relevant, call it through the available tool interface instead of saying it is unavailable or asking the user to run it.");
  }

  return [
    ...details,
    "Tool routing matrix: broad repo analysis -> nexsight_execute/nexsight_batch/nexsight_search; exact small file -> read_file; file edit -> apply_patch/write_file/batch_edit; git state -> git_status/git_diff; verification/build/test/local binary -> shell_command; current docs/URLs -> web_search/web_fetch or MCP docs tools; persistent facts -> archivist_save/archivist_checkpoint.",
    "Tool loop discipline: after each tool result, decide whether evidence is enough. If enough, answer. If not enough, call the smallest next tool. Do not narrate future tool use instead of calling the tool.",
    "Tool truth rule: report what the tool returned, not what you expected. If output is an envelope, parse the useful payload. If output is missing, say missing and run a better targeted tool.",
    "GSD rule: GSD agents are file-backed definitions, not shell commands. Validate GSD with gsd-new-workspace --raw or gsd-sdk init new-workspace --raw and inspect agents_installed/missing_agents; do not use command -v gsd-planner style checks.",
    "Tool decision rule: inspect with read_file, list_dir, search_content, search_files, nexsight_batch, or nexsight_search before editing; use nexsight_execute for counts/parsing/filtering so raw data stays out of chat; write with write_file/apply_patch for small edits or batch_edit for multi-file/multi-anchor edits that must validate insertion points before writing; verify with git_diff, git_status, shell_command, nexsight_execute, or focused tests.",
    "Nexsight rule: for broad repo/codebase/directory inspection, counting, filtering, summarizing, semantic search, or any output that could be large, prefer Nexsight first: use nexsight_execute to compute concise results, nexsight_batch/nexsight_index to store context, and nexsight_search to retrieve relevant excerpts. Use direct read/list/search only for known small files/paths, exact content requests, or narrow follow-ups after Nexsight routes the work.",
    "Nexsight execute rule: nexsight_execute needs executable code or command, plus a short reason when useful. Do not pass only a natural-language task. It supports javascript, python, and shell; Python-looking code is inferred as python when language is omitted.",
    "Web/tool reference rule: use web_fetch/web_search or relevant MCP tools for current external facts, docs, URLs, and references; do not invent current facts from memory.",
    "Tool execution rule: when a runnable command or file edit is needed, emit the tool call directly; do not output command blocks for the user to execute.",
    "Tool failure rule: if a broad command or path fails, retry with a narrower path, absolute path, or read/list/search tool before asking user for help.",
    "Missing tool rule: if a command/tool is missing, search package scripts, node_modules/.bin, local bins, available MCP/tool registries, and official web docs when needed; install project-local dependencies only when safe and scoped; ask user only for root/admin installs.",
    ...formatInternalToolPromptGuidance(),
  ];
}

function buildActiveSkillContext(session: InstructionContext): string[] {
  if (!session.activeSkill) {
    return [];
  }

  const skill = session.activeSkill;
  const guidance = [
    `Active skill: ${skill.name}`,
    `Source: ${skill.path}`,
    `Args: ${skill.args || "(none)"}`,
    `Skill scope: ${skill.source}`,
    "",
    `SKILL.md:${""}`,
    skill.content.trim(),
  ].filter(Boolean);
  return [guidance.join("\n").trim()];
}

function buildConversationContext(session: InstructionContext): string[] {
  const details: string[] = [];

  if (session.compaction?.summary?.trim()) {
    details.push(session.compaction.summary.trim());
  }

  if (session.compaction?.snapshot) {
    const snapshot = session.compaction.snapshot;
    details.push(
      `Compaction snapshot: provider=${snapshot.provider}; transport=${snapshot.transport}; turns=${snapshot.turnCount}; styles=${snapshot.styles.length > 0 ? snapshot.styles.join("+") : "normal"}; queued=${snapshot.queuedUserMessage ?? "none"}`,
    );
  }

  if (session.conversation && session.conversation.length > 0) {
    for (const turn of session.conversation.slice(-4)) {
      details.push(`${turn.role}: ${turn.content.trim()}`);
    }
  }

  return details;
}

function buildArchivistContext(session: InstructionContext): string[] {
  if (!session.archivist) {
    return [];
  }

  const entries: string[] = [
    `Archivist memory status: ${session.archivist.enabled ? "enabled (bounded-write)" : "disabled"}.`,
    "When asked about memory, report this harness memory status first; do not default to generic model-memory disclaimers.",
  ];

  if (!session.archivist.enabled) {
    return entries;
  }

  if (session.archivist.retrieval.used && session.archivist.retrieval.preview) {
    entries.push(
      `Archivist retrieval: ${session.archivist.retrieval.sourceCategory ?? "used"}; matches=${String(session.archivist.retrieval.matchCount)}`,
      session.archivist.retrieval.preview,
    );
  } else {
    entries.push("Archivist retrieval: no matched entries for this turn.");
  }

  return entries;
}

function buildResponseStyle(session: InstructionContext): string[] {
  const styles: string[] = [];

  if (session.commandModes?.cavemanMode) {
    styles.push(`# Communication Style: Caveman Mode

Respond in ultra-compressed caveman style. Cut ~75% of tokens while keeping full technical accuracy.

Rules:
- Drop articles (a, an, the), filler (just, really, basically), pleasantries (sure, happy to help)
- Use short synonyms (big not extensive, fix not "implement a solution for")
- No hedging. Fragments OK. No need full sentences
- Technical terms stay exact. "Polymorphism" stays "polymorphism"
- Apply caveman compression only to plain natural-language replies shown to user
- ${session.commandModes?.deadpoolMode ? "If Deadpool mode is also enabled, keep the antihero voice but compress it hard and keep jokes terse" : "Keep tone direct and compressed without adding extra personality unless another mode requests it"}
- When prose appears around code, JSON, XML/tags, commands, paths, stack traces, or quoted errors, compress only prose around those structured segments and preserve structured segments verbatim
- Do NOT change tool calls, tool arguments, XML/tag structure, JSON, code blocks, code formatting, git commits, PR descriptions, shell commands, file paths, stack traces, or quoted exact error text
- Error messages: quote exact, caveman only for explanation around them

Pattern: [thing] [action] [reason]. [next step].

Example:
  NOT: "Sure! I'd be happy to help. The issue is likely caused by..."
  YES: "Bug in auth middleware. Token expiry check use \`<\` not \`<=\`. Fix:"

Apply to plain replies, reports, summaries, compact wrappers, and snip summaries shown to user. Preserve all structured/machine-readable content exactly.`);
  }

  if (session.commandModes?.deadpoolMode) {
    styles.push(`# Communication Style: Deadpool Mode

Respond in snarky, fast-talking antihero voice with playful self-awareness and quick sarcasm.

Rules:
- This mode overrides the default plain-language tone guidance for all user-visible prose. If you are writing a normal sentence to the user, it MUST sound recognizably Deadpool-flavored unless the task is serious enough to reduce joke density
- Keep technical content accurate, concrete, and useful
- Apply personality only to plain natural-language replies shown to user
- ${session.commandModes?.cavemanMode ? "If Caveman mode is also enabled, keep jokes short, compressed, and secondary to technical clarity" : "Keep jokes short and secondary to technical clarity"}
- Do NOT change tool calls, tool arguments, JSON, XML/tags, code blocks, shell commands, file paths, stack traces, or quoted exact error text
- Do NOT let the voice change code correctness, implementation choices, safety behavior, or structured output
- Do not copy copyrighted quotes or signature catchphrases. Use inspired tone, not pasted lines.
- Keep jokes short and occasional. Engineer first, menace with jokes second
- If task is risky or serious, reduce joke density but keep the same voice and tone
- When prose appears around code or structured text, style only the prose around it and preserve structured segments verbatim

Examples:
  Normal: "I fixed the null check in the parser and added a regression test."
  Deadpool mode: "Parser had a null-check faceplant. I patched it and chained a regression test to the radiator."

Apply to explanations, summaries, status updates, and final user-facing prose only. Preserve all structured and machine-readable content exactly.`);
  }

  return styles;
}

function buildProviderFallback(session: InstructionContext): string[] {
  return [
    `Active provider: ${session.provider}`,
    `Fallback policy: ${session.providerRouting.fallback.policy}`,
    ...PROVIDER_FALLBACK_DEFAULTS,
  ];
}

function buildPromptSections(layers: PromptLayers): PromptSection[] {
  return [
    createPromptSection("identity", "System identity", "stable", layers.identity),
    createPromptSection("responseStyle", "Response style", "stable", layers.responseStyle),
    createPromptSection("executionGuidance", "Execution guidance", "stable", layers.executionGuidance),
    createPromptSection("activeSkill", "Active skill", "dynamic", layers.activeSkill),
    createPromptSection("repoBehavior", "Repo behavior", "stable", layers.repoBehavior),
    createPromptSection("taskContext", "Task context", "stable", layers.taskContext),
    createPromptSection("importedDefaults", "Imported defaults", "stable", layers.importedDefaults),
    createPromptSection("toolAvailability", "Tool availability", "stable", layers.toolAvailability),
    createPromptSection("providerFallback", "Provider fallback", "stable", layers.providerFallback),
    createPromptSection("archivistContext", "Archivist context", "dynamic", layers.archivistContext),
    createPromptSection("conversationContext", "Conversation context", "dynamic", layers.conversationContext),
    createPromptSection(
      "explicitInvocation",
      "Explicit invocation",
      "dynamic",
      layers.explicitInvocation.length > 0 ? [layers.explicitInvocation] : [],
    ),
  ].filter((section) => section.entries.length > 0);
}

function createPromptSection(
  key: PromptSectionKey,
  title: string,
  cache: PromptSectionCacheMode,
  entries: string[],
): PromptSection {
  return { key, title, cache, entries };
}

function formatSection(title: string, content: string): string | null {
  const normalized = content.trim();
  if (normalized.length === 0) {
    return null;
  }

  return `${title}:\n${normalized}`;
}

function formatListSection(title: string, entries: string[]): string | null {
  if (entries.length === 0) {
    return null;
  }

  return `${title}:\n${entries.map((entry) => `- ${indentBlock(entry)}`).join("\n")}`;
}

function serializePromptSection(section: PromptSection): string | null {
  return formatListSection(section.title, section.entries);
}

function indentBlock(value: string): string {
  return value.replace(/\n/g, "\n  ");
}

function formatInstructionSource(source: InstructionContext["instructionSources"][number]): string | null {
  if (source.detail?.trim()) {
    return `${source.kind}\n${source.detail.trim()}`;
  }

  return source.summary.trim().length > 0 ? source.summary.trim() : null;
}

function countInstructionEntries(layers: PromptLayers): number {
  return (
    layers.identity.length +
    layers.responseStyle.length +
    layers.executionGuidance.length +
    layers.repoBehavior.length +
    layers.activeSkill.length +
    layers.taskContext.length +
    layers.importedDefaults.length +
    layers.toolAvailability.length +
    layers.providerFallback.length +
    layers.archivistContext.length +
    layers.conversationContext.length
  );
}

function summarizeLayerEntries(entries: string[]): string {
  return entries.length > 0 ? entries.map(summarizeEntry).join(" | ") : "none";
}

function summarizeEntry(entry: string): string {
  const [head, ...rest] = entry.split("\n");
  if (rest.length === 0) {
    return head.trim();
  }

  return `${head.trim()}=${rest.join(" ").trim()}`;
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}
