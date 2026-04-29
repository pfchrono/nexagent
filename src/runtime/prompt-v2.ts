import type { InstructionContext } from "./instructions.js";

export const NEXAGENT_PROMPT_DYNAMIC_BOUNDARY = "__NEXAGENT_PROMPT_DYNAMIC_BOUNDARY__";

export type PromptV2CacheMode = "stable" | "dynamic";

export type PromptV2SectionSource = "core" | "provider" | "mode" | "repo" | "skill" | "runtime" | "conversation";

export interface PromptV2Section {
  id: string;
  title: string;
  priority: number;
  cache: PromptV2CacheMode;
  source: PromptV2SectionSource;
  content: string[];
}

export interface PromptV2Contribution {
  stablePrefix?: PromptV2Section[];
  dynamicSuffix?: PromptV2Section[];
  sectionOverrides?: Record<string, PromptV2Section>;
}

export interface PromptV2Result {
  sections: PromptV2Section[];
  prompt: string;
}

export interface PromptV2Summary {
  assembly: "v2";
  count: number;
  stableSections: string;
  dynamicSections: string;
  dynamicBoundary: string;
  identity: string;
  executionContract: string;
  toolRouting: string;
  editingSafety: string;
  providerGuidance: string;
  style: string;
  repoContext: string;
  runtimeState: string;
  conversationState: string;
}

const PROMPT_SEPARATOR = "\n\n";

export function buildPromptV2(request: {
  session: InstructionContext;
  prompt: string;
  contribution?: PromptV2Contribution;
}): PromptV2Result {
  const sections = normalizePromptSections([
    ...buildCoreSections(),
    ...buildProviderSections(request.session),
    ...buildModeSections(request.session),
    ...buildRepoSections(request.session),
    ...buildRuntimeSections(request.session),
    ...buildConversationSections(request.session),
    createPromptV2Section({
      id: "current_invocation",
      title: "Current Invocation",
      priority: 900,
      cache: "dynamic",
      source: "conversation",
      content: [request.prompt],
    }),
    ...(request.contribution?.stablePrefix ?? []),
    ...(request.contribution?.dynamicSuffix ?? []),
  ], request.contribution?.sectionOverrides);

  return {
    sections,
    prompt: serializePromptV2(sections),
  };
}

export function createPromptV2Section(section: PromptV2Section): PromptV2Section {
  return {
    ...section,
    content: section.content.map((entry) => entry.trim()).filter(Boolean),
  };
}

export function serializePromptV2(sections: PromptV2Section[]): string {
  const stableSections = sections.filter((section) => section.cache === "stable").map(serializeSection).filter(Boolean);
  const dynamicSections = sections.filter((section) => section.cache === "dynamic").map(serializeSection).filter(Boolean);

  if (dynamicSections.length === 0) {
    return stableSections.join(PROMPT_SEPARATOR);
  }

  return [...stableSections, NEXAGENT_PROMPT_DYNAMIC_BOUNDARY, ...dynamicSections].join(PROMPT_SEPARATOR);
}

export function summarizePromptV2(sections: PromptV2Section[]): PromptV2Summary {
  const stableSections = sections.filter((section) => section.cache === "stable").map((section) => section.id);
  const dynamicSections = sections.filter((section) => section.cache === "dynamic").map((section) => section.id);

  return {
    assembly: "v2",
    count: sections.reduce((sum, section) => sum + section.content.length, 0),
    stableSections: stableSections.join(", "),
    dynamicSections: dynamicSections.join(", "),
    dynamicBoundary: NEXAGENT_PROMPT_DYNAMIC_BOUNDARY,
    identity: summarizeSectionContent(sections, "identity"),
    executionContract: summarizeSectionContent(sections, "execution_contract"),
    toolRouting: summarizeSectionContent(sections, "tool_routing"),
    editingSafety: summarizeSectionContent(sections, "editing_safety"),
    providerGuidance: summarizeSectionContent(sections, "provider_guidance"),
    style: summarizeSectionContent(sections, "style_caveman", "style_deadpool"),
    repoContext: summarizeSectionContent(sections, "repo_context"),
    runtimeState: summarizeSectionContent(sections, "runtime_state"),
    conversationState: summarizeSectionContent(sections, "conversation_state"),
  };
}

function buildCoreSections(): PromptV2Section[] {
  return [
    createPromptV2Section({
      id: "identity",
      title: "Identity",
      priority: 10,
      cache: "stable",
      source: "core",
      content: ["You are nexagent, a local coding harness assistant for repo-aware software engineering work."],
    }),
    createPromptV2Section({
      id: "execution_contract",
      title: "Execution Contract",
      priority: 20,
      cache: "stable",
      source: "core",
      content: [
        "Actionable request means act in this turn.",
        "Use tools when tools improve grounding, correctness, or completion.",
        "Do not end with a plan, promise, or ask-for-approval loop when tools can make progress.",
        "Continue until done, verified, or genuinely blocked.",
        "Failed tool result means vary path, query, command, or tool before stopping.",
        "Final answer needs evidence or a named blocker.",
        "Never claim file, test, tool, GSD, MCP, Nexsight, or runtime state without current-turn evidence.",
      ],
    }),
    createPromptV2Section({
      id: "tool_routing",
      title: "Tool Routing",
      priority: 30,
      cache: "stable",
      source: "core",
      content: [
        "Broad repo map/count/parse/compare/summarize -> nexsight_execute, nexsight_batch, nexsight_search.",
        "Exact file read for edit -> read_file.",
        "Exact symbol/text search -> search_content or nexsight_search.",
        "Precise edits -> apply_patch.",
        "Generated whole file -> write_file.",
        "Multi-file mechanical edit -> batch_edit or nexsight_execute-assisted patch with validated insertion points.",
        "Tests/build/git/local binaries -> shell_command.",
        "Web/current docs -> web/MCP tool.",
        "Durable user/project fact -> archivist.",
        "If stronger task-specific tool exists, use it before generic shell/listing.",
        "If tool schema mismatch happens, correct call shape immediately.",
      ],
    }),
    createPromptV2Section({
      id: "editing_safety",
      title: "Editing Safety",
      priority: 40,
      cache: "stable",
      source: "core",
      content: [
        "Read relevant code before editing behavior.",
        "Keep changes scoped to requested outcome.",
        "Do not revert user changes unless explicitly requested.",
        "Prefer existing repo patterns over new abstractions.",
        "Run focused verification when available before reporting completion.",
      ],
    }),
  ];
}

function buildModeSections(session: InstructionContext): PromptV2Section[] {
  const sections: PromptV2Section[] = [];
  if (session.commandModes?.cavemanMode) {
    sections.push(createPromptV2Section({
      id: "style_caveman",
      title: "Style Overlay: Caveman",
      priority: 100,
      cache: "dynamic",
      source: "mode",
      content: [
        "Compress user-visible prose. Drop articles, filler, and pleasantries.",
        "Preserve code, JSON, commands, paths, exact errors, commits, PR text, and tool calls unchanged.",
      ],
    }));
  }
  if (session.commandModes?.deadpoolMode) {
    sections.push(createPromptV2Section({
      id: "style_deadpool",
      title: "Style Overlay: Deadpool",
      priority: 101,
      cache: "dynamic",
      source: "mode",
      content: [
        "Use brief snarky antihero flavor only in user-visible prose.",
        "Technical accuracy, safety, and execution rules override style.",
      ],
    }));
  }
  return sections;
}

function buildProviderSections(session: InstructionContext): PromptV2Section[] {
  const transport = session.providerTransport;
  const activeProvider = transport?.activeProvider ?? session.provider;
  const mode = transport?.mode ?? "unknown";
  const adapter = transport?.adapter ?? "unknown";
  const authGate = transport?.authGate ?? "unknown";
  const content = [
    `Active provider: ${activeProvider}`,
    `Provider fallback policy: ${session.providerRouting.fallback.policy}`,
    "Do not silently switch providers. Use configured provider and transport unless user or config changes it.",
    "Tool calls must use Nexagent internal tool envelope exactly when provider text transport requires tool markup.",
  ];

  if (mode === "cli-exec") {
    content.push(
      `Transport: Codex CLI (${adapter}); auth=${authGate}.`,
      "Use XML-style internal tool calls only when a tool is needed; otherwise answer directly.",
      "After a tool result, continue from observed evidence. Do not ask user to continue unless approval or missing external access blocks progress.",
    );
  } else if (mode === "codex-http") {
    content.push(
      `Transport: Codex ChatGPT HTTP (${adapter}); auth=${authGate}.`,
      "Keep instructions separate from user input. Use native/request tool loop shape supplied by transport.",
      "Avoid CLI-only assumptions; API transport may not expose local Codex shell behavior.",
    );
  } else if (mode === "http-responses") {
    content.push(
      `Transport: OpenAI Responses HTTP (${adapter}); auth=${authGate}.`,
      "Prefer native tool calling. Keep tool arguments strict JSON matching schema.",
      "Do not emit XML tool markup when native tool calling is active.",
    );
  } else {
    content.push(`Transport: ${mode}; adapter=${adapter}; auth=${authGate}.`);
  }

  return [
    createPromptV2Section({
      id: "provider_guidance",
      title: "Provider Guidance",
      priority: 50,
      cache: "stable",
      source: "provider",
      content,
    }),
  ];
}

function buildRepoSections(session: InstructionContext): PromptV2Section[] {
  const entries = session.instructionSources.map((source) => {
    const detail = source.detail?.trim() || source.summary.trim();
    return `${source.kind}: ${detail}`;
  }).filter(Boolean);

  if (entries.length === 0) {
    return [];
  }

  return [
    createPromptV2Section({
      id: "repo_context",
      title: "Repo Context",
      priority: 200,
      cache: "dynamic",
      source: "repo",
      content: [
        "Repo-local instructions are scoped context, not replacements for core execution contract.",
        ...entries,
      ],
    }),
  ];
}

function buildRuntimeSections(session: InstructionContext): PromptV2Section[] {
  const content = [
    `Provider: ${session.provider}`,
    `Working directory: ${session.cwd}`,
    `MCP servers: ${formatList(session.enabledMcpServers)}`,
  ];

  if (session.toolPolicy) {
    content.push(
      `Readable roots: ${formatList(session.toolPolicy.readRoots ?? ["all non-protected paths"])}`,
      `Writable roots: ${formatList(session.toolPolicy.allowedRoots)}`,
      `Protected roots: ${formatList(session.toolPolicy.protectedRoots)}`,
      `Tool policy mode: ${session.toolPolicy.mode}`,
    );
  }

  return [
    createPromptV2Section({
      id: "runtime_state",
      title: "Runtime State",
      priority: 300,
      cache: "dynamic",
      source: "runtime",
      content,
    }),
  ];
}

function buildConversationSections(session: InstructionContext): PromptV2Section[] {
  const content: string[] = [];
  if (session.compaction?.summary?.trim()) {
    content.push(`Compaction summary: ${session.compaction.summary.trim()}`);
  }
  if (session.archivist?.enabled) {
    content.push(`Archivist: enabled; retrieval matches=${String(session.archivist.retrieval.matchCount)}`);
    if (session.archivist.retrieval.used && session.archivist.retrieval.preview?.trim()) {
      content.push(`Archivist retrieval: ${session.archivist.retrieval.sourceCategory ?? "memory"}`);
      content.push(session.archivist.retrieval.preview.trim());
    }
  }
  if (session.activeSkill) {
    content.push(`Active skill: ${session.activeSkill.name} (${session.activeSkill.path})`);
  }

  if (content.length === 0) {
    return [];
  }

  return [
    createPromptV2Section({
      id: "conversation_state",
      title: "Conversation State",
      priority: 400,
      cache: "dynamic",
      source: "conversation",
      content,
    }),
  ];
}

function normalizePromptSections(
  sections: PromptV2Section[],
  overrides?: Record<string, PromptV2Section>,
): PromptV2Section[] {
  const byId = new Map<string, PromptV2Section>();
  for (const section of sections) {
    const normalized = createPromptV2Section(section);
    if (normalized.content.length === 0) {
      continue;
    }
    byId.set(normalized.id, normalized);
  }

  for (const [id, section] of Object.entries(overrides ?? {})) {
    const normalized = createPromptV2Section({ ...section, id });
    if (normalized.content.length === 0) {
      byId.delete(id);
      continue;
    }
    byId.set(id, normalized);
  }

  return Array.from(byId.values()).sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

function serializeSection(section: PromptV2Section): string {
  return [`## ${section.title}`, ...section.content.map((entry) => `- ${entry.replace(/\n/g, "\n  ")}`)].join("\n");
}

function summarizeSectionContent(sections: PromptV2Section[], ...ids: string[]): string {
  const entries = sections
    .filter((section) => ids.includes(section.id))
    .flatMap((section) => section.content);
  return entries.length > 0 ? entries.map(summarizeEntry).join(" | ") : "none";
}

function summarizeEntry(entry: string): string {
  const normalized = entry.replace(/\s+/g, " ").trim();
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}
