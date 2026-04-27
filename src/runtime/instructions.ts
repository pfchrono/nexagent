import path from "node:path";

import type { RepoInstructionSource } from "./config.js";
import { formatInternalToolPromptGuidance } from "./tools.js";

export interface InstructionContext {
  provider: string;
  commandModes?: {
    cavemanMode: boolean;
    deadpoolMode: boolean;
  };
  conversation?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  compaction?: {
    summary: string | null;
    snapshot: {
      styles: string[];
      provider: string;
      transport: string;
      turnCount: number;
      queuedUserMessage: string | null;
    } | null;
    compactCount: number;
  };
  providerRouting: {
    fallback: {
      policy: string;
    };
  };
  cwd: string;
  mcpServers: string[];
  enabledMcpServers: string[];
  imports: {
    claude: {
      path: string;
      importedKeys: string[];
    } | null;
  };
  instructionSources: RepoInstructionSource[];
  archivist?: {
    enabled: boolean;
    retrieval: {
      used: boolean;
      sourceCategory: string | null;
      matchCount: number;
      preview: string | null;
    };
  };
}

export interface AssembledPrompt {
  layers: PromptLayers;
  prompt: string;
}

export type PromptSectionKey =
  | "identity"
  | "responseStyle"
  | "executionGuidance"
  | "repoBehavior"
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
  "Read relevant code before changing behavior, then keep edits scoped to requested outcome.",
  "Use available runtime tools and commands to act on code or repo state instead of only describing intent.",
  "Do not claim code, files, tests, or verification happened unless you actually performed them in this session.",
  "When user asks to continue, keep going, start, or finish a task, continue working until task is complete or a real blocker stops progress.",
  "When user authorizes a sequence of checks or steps, keep running remaining steps without asking again after each substep unless a blocker, failure, or approval gate stops progress.",
  "Prefer action over narration: inspect, edit, run checks, and verify before reporting outcome.",
  "For execution requests, do not answer with only intention or reassurance. Perform the work in the same turn unless blocked.",
  "Do not say you are about to run checks, continue later, or report back soon. Run the checks or state the blocker now.",
  "If user asks for smoke tests, debugging, implementation, or verification, use tools and produce actual results instead of a promise.",
  "If user asks for exact, full, verbatim, or complete file/chat/transcript content, preserve exact content instead of summarizing. If exact content is unavailable, say what is missing plainly.",
  "Report verification truthfully. If checks were not run or failed, say so plainly.",
];
const PROVIDER_FALLBACK_DEFAULTS = [
  "Honor active provider routing for this session.",
  "Do not silently switch providers; require explicit spec-backed routing changes.",
];

export async function assemblePrompt(request: { session: InstructionContext; prompt: string }): Promise<AssembledPrompt> {
  const layers = buildPromptLayers(request.session, request.prompt);
  return {
    layers,
    prompt: serializePromptLayers(layers),
  };
}

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

  if (session.enabledMcpServers.length > 0) {
    details.push(`Enabled MCP servers: ${formatList(session.enabledMcpServers)}`);
  }

  return [...details, ...formatInternalToolPromptGuidance()];
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
    styles.push("Respond in caveman mode: drop filler, keep answers short, preserve technical accuracy.");
  }

  if (session.commandModes?.deadpoolMode) {
    styles.push("Use Deadpool-style voice lightly in prose only. Keep code and structured output normal.");
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

function formatInstructionSource(source: RepoInstructionSource): string | null {
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
