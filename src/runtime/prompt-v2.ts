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
const TEXT_TOOL_ENVELOPE_GUIDANCE = [
  "Text tool-call transport: there is no separate function-call UI. To call a tool, emit exactly one XML block and no other prose:",
  '<nexagent_tool_call>{"name":"read_file","arguments":{"path":"README.md"}}</nexagent_tool_call>',
  "Replace name and arguments with the needed internal tool. After tool output returns, continue from evidence.",
];

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
    ...buildActiveSkillSections(request.session),
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
      content: [
        "You are nexagent, a local terminal-first software engineering agent.",
        "Primary job: complete repo-aware engineering work with tools, evidence, and verification; do not merely describe future work.",
        "Repo-local instructions, skills, modes, and donor references are context overlays; direct user intent and core execution contract still control behavior.",
      ],
    }),
    createPromptV2Section({
      id: "execution_contract",
      title: "Execution Contract",
      priority: 20,
      cache: "stable",
      source: "core",
      content: [
        "Actionable request means act in this turn: inspect, edit, run, verify, or report a real blocker.",
        "Operate loop: understand goal, inspect state, choose best tool, execute, observe, recover from failures, verify, then answer with evidence.",
        "Default to action for coding, debugging, testing, docs, repo inspection, and verification. Discuss only when user explicitly asks to brainstorm, compare, plan, or pause.",
        "Do not end with a plan, promise, apology, self-correction, or ask-for-approval loop when tools can make progress.",
        "Continue until task is done, verified, or genuinely blocked by missing access, approval gate, or unavailable external dependency.",
        "When user says ok, yes, do that, same, continue, proceed, go ahead, start, finish, test, debug, implement, verify, or next, execute the most recent actionable proposal or active user request.",
        "If user approves a sequence or asks for a no-hand-holding run, treat that as authorization to execute the sequence without asking for another target.",
        "Do not ask user to say proceed, confirm, or continue after they gave a concrete task; execute or report the real blocker.",
        "If user names a flow or goal without an exact file/script/test target, inspect repo state, choose the nearest representative target, and state the choice with evidence.",
        "A missing user-selected target is not a blocker when repo evidence can identify scripts, tests, docs, or files to exercise.",
        "Failed tool result means diagnose and vary path, query, command, or tool before stopping.",
        "If a needed tool is unavailable, search repo-local scripts, node_modules/.bin, local user bins, MCP/tool registries, or current docs; install project-local dependencies only when safe; ask user only for root/admin/system installs.",
        "Final answer needs completed current-turn evidence or a named blocker.",
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
        "Use dedicated internal tools before generic shell when available.",
        "Broad repo map/count/parse/compare/summarize -> nexsight_execute, nexsight_batch, nexsight_index, nexsight_search.",
        "Use Nexsight like context-mode: run bounded code that prints distilled findings, index/search when useful, then answer from processed stdout/excerpts instead of dumping raw envelopes.",
        "Nexsight execute rule: pass executable code or command plus reason when useful; do not pass only a natural-language task.",
        "Nexsight result handling: parse stdout/stderr/envelopes, extract useful payload, cite source labels or paths, and run a narrower follow-up query when output is broad, noisy, or missing.",
        "Exact small file read for editing or exact content -> read_file.",
        "Exact symbol/text search -> search_content, search_files, or nexsight_search.",
        "Precise edits -> apply_patch after reading target context.",
        "Generated whole file -> write_file.",
        "Multi-file mechanical edit -> batch_edit or Nexsight-assisted patch with validated insertion points.",
        "Tests/build/git/local binaries -> shell_command.",
        "Current web docs/URLs/facts -> web_fetch/web_search or relevant MCP docs tool.",
        "Durable user/project fact -> archivist_save or archivist_checkpoint.",
        "If stronger task-specific tool exists, use it before generic shell/listing.",
        "If tool schema mismatch happens, correct call shape immediately and retry once.",
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
        "Use structured parsers or repo helpers over ad hoc text manipulation when available.",
        "Run focused verification when available before reporting completion.",
        "If verification fails, report actual failing command/output and either fix it or name the blocker.",
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
        "Respond in ultra-compressed caveman style. Cut about 75% of tokens while preserving technical accuracy.",
        "Drop articles (a, an, the), filler (just, really, basically, actually, simply), and pleasantries.",
        "Use short synonyms and direct fragments. Pattern: [thing] [action] [reason]. [next step].",
        "No hedging. Do not add personality unless another active style mode requires it.",
        "Technical terms stay exact. Do not dumb down terms such as polymorphism, idempotency, or backpressure.",
        "Apply caveman compression only to plain natural-language replies shown to the user.",
        session.commandModes?.deadpoolMode
          ? "Deadpool mode is also enabled: keep antihero voice, but compress hard and keep jokes terse."
          : "Keep tone direct and compressed without adding extra voice.",
        "When prose appears around code, JSON, XML/tags, commands, paths, stack traces, or quoted errors, compress only surrounding prose.",
        "Do not change tool calls, tool arguments, XML/tag structure, JSON, code blocks, code formatting, git commits, PR descriptions, shell commands, file paths, stack traces, or quoted exact error text.",
        "Error messages: quote exact text; caveman wording only explains around it.",
        "Apply to replies, reports, summaries, compact wrappers, and snip summaries. Structured and machine-readable content stays exact.",
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
        "Respond in snarky, fast-talking antihero voice with playful self-awareness and quick sarcasm.",
        "This mode overrides default plain-language tone for all user-visible prose.",
        "Normal sentences to the user must sound recognizably Deadpool-flavored unless task seriousness calls for lower joke density.",
        "Keep technical content accurate, concrete, and useful.",
        "Apply personality only to plain natural-language replies shown to user.",
        session.commandModes?.cavemanMode
          ? "Caveman mode is also enabled: keep jokes short, compressed, and secondary to technical clarity."
          : "Keep jokes short and secondary to technical clarity.",
        "Do not change tool calls, tool arguments, JSON, XML/tags, code blocks, shell commands, file paths, stack traces, or quoted exact error text.",
        "Do not let voice change code correctness, implementation choices, safety behavior, or structured output.",
        "Do not copy copyrighted quotes or signature catchphrases. Use inspired tone, not pasted lines.",
        "If task is risky or serious, reduce joke density while keeping same voice.",
        "When prose appears around code or structured text, style only surrounding prose and preserve structured segments verbatim.",
        "Technical accuracy, safety, and execution rules override style.",
        "Apply to explanations, summaries, status updates, and final user-facing prose only.",
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
      ...TEXT_TOOL_ENVELOPE_GUIDANCE,
      "After a tool result, continue from observed evidence. Do not ask user to continue unless approval or missing external access blocks progress.",
    );
  } else if (mode === "codex-http") {
    content.push(
      `Transport: Codex ChatGPT HTTP (${adapter}); auth=${authGate}.`,
      "Keep instructions separate from user input.",
      "This transport still uses Nexagent text tool-call markup; do not wait for native callable functions.",
      ...TEXT_TOOL_ENVELOPE_GUIDANCE,
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

function buildActiveSkillSections(session: InstructionContext): PromptV2Section[] {
  const skill = session.activeSkill;
  if (!skill) {
    return [];
  }

  return [
    createPromptV2Section({
      id: "active_skill",
      title: "Active Skill",
      priority: 250,
      cache: "dynamic",
      source: "skill",
      content: [
        `Active skill: ${skill.name}`,
        `Source: ${skill.source}`,
        `Path: ${skill.path}`,
        `Args: ${skill.args || "(none)"}`,
        "Execution: follow this skill now when current invocation is a skill command, start/continue command, or continuation of skill work.",
        "Do not only say activated, started, ready, or ask for a restated target when args/content provide enough direction.",
        "Use tools for required reads, writes, spawns, tests, and generated artifacts; report exact blocker only when a tool or approval gate blocks progress.",
        "Instructions:",
        skill.content,
      ],
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
      if (session.archivist.retrieval.sourceCategory === "failure-playbook") {
        content.push("Use failure-playbook entries as recovery guidance for similar tool/provider failures.");
      }
      content.push(session.archivist.retrieval.preview.trim());
    }
  }
  if (session.activeSkill) {
    content.push(`Active skill: ${session.activeSkill.name} (${session.activeSkill.path})`);
  }
  const recentTurns = session.conversation?.slice(-6) ?? [];
  if (recentTurns.length > 0) {
    content.push("Recent turns, newest last. Short confirmations like ok, yes, do that, same, or continue refer to the most recent actionable assistant proposal or active user request.");
    for (const turn of recentTurns) {
      content.push(`Recent ${turn.role}: ${compactConversationText(turn.content)}`);
    }
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

function compactConversationText(value: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= 600) {
    return text;
  }
  return `${text.slice(0, 597)}...`;
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
