import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadHarnessConfig } from "../src/runtime/config.js";
import { assemblePrompt } from "../src/runtime/instructions.js";
import { createDefaultProviderRegistry } from "../src/provider/registry.js";
import type { RuntimeSession } from "../src/runtime/session.js";

function createSession(cwd: string): RuntimeSession {
  return {
    id: "session_test",
    startedAt: "2025-01-01T00:00:00.000Z",
    product: "nexagent",
    provider: "codex",
    providerRegistry: createDefaultProviderRegistry(),
    prompt: {
      assembly: "legacy",
    },
    providerRouting: {
      fallback: {
        policy: "require-open-spec",
        silentProviderSwitch: false,
      },
      modelSelection: {
        activeProvider: "codex",
        configuredModels: { codex: "gpt-5.4" },
      },
      transport: {},
    },
    commandModes: {
      cavemanMode: false,
      deadpoolMode: false,
      statusline: false,
    },
    operationDefaults: {
      requireApprovalForGuarded: false,
    },
    cwd,
    repo: {
      root: cwd,
      name: path.basename(cwd),
      vcs: "none",
      branch: null,
      freshness: {
        status: "no-repo",
        tracking: null,
        ahead: null,
        behind: null,
        dirty: false,
        needsPull: false,
        checkedAt: null,
      },
    },
    toolPolicy: {
      mode: "repo-local-guarded",
      allowedRoots: [cwd],
      protectedRoots: ["/etc"],
      shell: "limited",
      writes: "guarded",
      deletes: "blocked",
    },
    mcpServers: ["context7"],
    enabledMcpServers: ["context7"],
    hooks: {
      sourcePath: path.join(cwd, ".claude", "settings.json"),
      status: "none",
      events: [],
      commandCount: 0,
      invalidEntries: [],
    },
    auth: {
      provider: "codex",
      available: true,
      loggedIn: true,
      method: "ChatGPT",
      status: "Logged in using ChatGPT",
      checkedAt: "2025-01-01T00:00:00.000Z",
    },
    imports: {
      claude: {
        path: path.join(cwd, ".claude", "settings.json"),
        importedKeys: ["provider", "modelSelection"],
      },
    },
    instructionSources: [
      {
        kind: "AGENTS.md",
        path: path.join(cwd, "AGENTS.md"),
        layer: "repoBehavior",
        summary: "Repo agent instructions",
        detail: "Repo rule A",
      },
      {
        kind: "CLAUDE.md",
        path: path.join(cwd, "CLAUDE.md"),
        layer: "repoBehavior",
        summary: "Repo Claude instructions",
        detail: "Repo rule B",
      },
      {
        kind: ".claude",
        path: path.join(cwd, ".claude"),
        layer: "repoBehavior",
        summary: ".claude directory present with: settings.json",
        detail: ".claude directory present with: settings.json",
      },
      {
        kind: ".mcp.json",
        path: path.join(cwd, ".mcp.json"),
        layer: "repoBehavior",
        summary: "MCP registry: context7",
        detail: '{"mcpServers":{}}',
      },
      {
        kind: "openspec",
        path: path.join(cwd, "openspec"),
        layer: "taskContext",
        summary: "openspec directory present with: SPEC.md",
        detail: "openspec directory present with: SPEC.md",
      },
    ],
    archivist: {
      enabled: false,
      boundary: "disabled",
      storagePath: null,
      storageExists: false,
      retrieval: {
        used: false,
        sourceCategory: null,
        matchCount: 0,
        preview: null,
      },
      writes: {
        used: false,
        action: null,
        sourceCategory: null,
        savedAt: null,
        entryCount: 0,
        preview: null,
      },
    },
    action: {
      status: "ready",
      detail: "runtime baseline",
      pending: false,
      lastActivity: null,
    },
    telemetry: {
      turnCount: 0,
      lastInputTokens: 0,
      lastOutputTokens: 0,
    },
    events: [],
    operationControls: {
      requireApprovalForGuarded: false,
      yoloMode: false,
      pendingApproval: null,
      lastDecision: null,
      cancelRequested: false,
      steerMessage: null,
      steerState: null,
      lastAppliedSteer: null,
      steerHistory: [],
    },
    conversation: [],
    compaction: {
      thresholdPercent: 0.5,
      modelThresholdOverrides: {},
      queuedUserMessage: null,
      summary: null,
      snapshot: null,
      status: "idle",
      lastTrigger: null,
      lastCompactedAt: null,
      compactCount: 0,
      normalTurnSteering: "boundary-only",
      compactTurnSteering: "blocked",
    },
  };
}

test("assemblePrompt keeps precedence layers distinct before serialization", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-instructions-"));

  try {
    await writeFile(path.join(cwd, "AGENTS.md"), "Repo rule A\n", "utf8");
    await writeFile(path.join(cwd, "CLAUDE.md"), "Repo rule B\n", "utf8");
    await mkdir(path.join(cwd, ".claude"));
    await writeFile(path.join(cwd, ".claude", "settings.json"), "{}\n", "utf8");
    await writeFile(path.join(cwd, ".mcp.json"), '{"mcpServers":{}}\n', "utf8");
    await mkdir(path.join(cwd, "openspec"));
    await writeFile(path.join(cwd, "openspec", "SPEC.md"), "# spec\n", "utf8");

    const assembled = await assemblePrompt({
      session: createSession(cwd),
      prompt: "Ship fix now",
    });

    assert.equal(assembled.layers.explicitInvocation, "Ship fix now");
    assert.deepEqual(assembled.layers.identity, [
      "You are nexagent, local coding harness assistant for repo-aware software engineering work.",
    ]);
    assert.deepEqual(assembled.layers.executionGuidance, [
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
    ]);
    assert.deepEqual(assembled.layers.repoBehavior, [
      "AGENTS.md\nRepo rule A",
      "CLAUDE.md\nRepo rule B",
      ".claude\n.claude directory present with: settings.json",
      '.mcp.json\n{"mcpServers":{}}',
    ]);
    assert.match(assembled.layers.taskContext.join("\n"), /Follow repo-local instructions over imported defaults when they conflict\./);
    assert.match(assembled.layers.taskContext.join("\n"), /openspec directory present with: SPEC.md/);
    assert.deepEqual(assembled.layers.importedDefaults, [
      "Imported Claude defaults: settings.json provides provider, modelSelection.",
    ]);
    assert.deepEqual(assembled.layers.toolAvailability, [
      `Working directory: ${cwd}`,
      "Loaded MCP servers: context7",
      "Readable roots: all non-protected paths. Any child path under a readable root is readable unless it is protected.",
      `Writable roots: ${cwd}. Non-yolo writes are limited to these roots.`,
      "Yolo mode: write tools may edit readable roots, but protected/system paths remain blocked.",
      "Path rule: absolute paths and ~/ paths are supported; if a requested path is under a readable root, inspect it with tools instead of refusing because it is outside cwd.",
      "Enabled MCP servers: context7",
      "MCP guidance: if an enabled MCP server/tool is relevant, call it through the available tool interface instead of saying it is unavailable or asking the user to run it.",
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
      "Internal tool protocol: when tool use is required, respond with only one XML block:",
      '<nexagent_tool_call>{"name":"read_file","arguments":{"path":"src/cli.ts"}}</nexagent_tool_call>',
      "Available internal tools: read_file, write_file, apply_patch, batch_edit, preview_patch, list_dir, search_content, search_files, web_fetch, web_search, git_status, git_diff, shell_command, nexsight_execute, nexsight_index, nexsight_batch, nexsight_search, archivist_save, archivist_checkpoint",
      "Use tools for repo inspection instead of narrating intended actions.",
    ]);
    assert.deepEqual(assembled.layers.providerFallback, [
      "Active provider: codex",
      "Fallback policy: require-open-spec",
      "Honor active provider routing for this session.",
      "Do not silently switch providers; require explicit spec-backed routing changes.",
    ]);
    assert.equal(assembled.layers.dynamicBoundary, "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__");
    assert.deepEqual(
      assembled.layers.sections.map((section) => [section.key, section.cache]),
      [
        ["identity", "stable"],
        ["executionGuidance", "stable"],
        ["repoBehavior", "stable"],
        ["taskContext", "stable"],
        ["importedDefaults", "stable"],
        ["toolAvailability", "stable"],
        ["providerFallback", "stable"],
        ["archivistContext", "dynamic"],
        ["explicitInvocation", "dynamic"],
      ],
    );
    assert.match(assembled.prompt, /System identity:/);
    assert.match(assembled.prompt, /Execution guidance:/);
    assert.match(assembled.prompt, /__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__/);
    assert.match(assembled.prompt, /Explicit invocation:\n- Ship fix now/);
    assert.match(assembled.prompt, /Repo behavior:/);
    assert.match(assembled.prompt, /Task context:/);
    assert.match(assembled.prompt, /Imported defaults:/);
    assert.match(assembled.prompt, /Tool availability:/);
    assert.match(assembled.prompt, /Provider fallback:/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("assemblePrompt includes compacted conversation context when present", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-instructions-compact-"));

  try {
    const session = createSession(cwd);
    session.compaction.summary = "Compacted context summary: user: asked for auth fix | assistant: explained transport path";
    session.compaction.snapshot = {
      styles: ["caveman"],
      provider: "codex",
      transport: "cli-exec",
      turnCount: 3,
      queuedUserMessage: "continue fix",
    };
    session.conversation = [
      { role: "user", content: "show current status", tokens: 5 },
      { role: "assistant", content: "status is green", tokens: 4 },
    ];

    const assembled = await assemblePrompt({
      session,
      prompt: "continue",
    });

    assert.match(assembled.prompt, /Conversation context:/);
    assert.match(assembled.prompt, /Compacted context summary:/);
    assert.match(assembled.prompt, /Compaction snapshot:/);
    assert.match(assembled.prompt, /user: show current status/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("assemblePrompt injects Free-Code-style caveman and deadpool sections", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-instructions-style-"));

  try {
    const session = createSession(cwd);
    session.commandModes.cavemanMode = true;
    session.commandModes.deadpoolMode = true;

    const assembled = await assemblePrompt({
      session,
      prompt: "explain parser fix",
    });

    assert.equal(assembled.layers.responseStyle.length, 2);
    assert.match(assembled.layers.responseStyle.join("\n"), /# Communication Style: Caveman Mode/);
    assert.match(assembled.layers.responseStyle.join("\n"), /Cut ~75% of tokens while keeping full technical accuracy/);
    assert.match(assembled.layers.responseStyle.join("\n"), /Pattern: \[thing\] \[action\] \[reason\]\. \[next step\]\./);
    assert.match(assembled.layers.responseStyle.join("\n"), /# Communication Style: Deadpool Mode/);
    assert.match(assembled.layers.responseStyle.join("\n"), /MUST sound recognizably Deadpool-flavored/);
    assert.match(assembled.layers.responseStyle.join("\n"), /If Caveman mode is also enabled, keep jokes short, compressed, and secondary/);
    assert.match(assembled.prompt, /Response style:/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("assemblePrompt includes archivist retrieval context when present", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-instructions-archivist-"));

  try {
    const session = createSession(cwd);
    session.archivist.enabled = true;
    session.archivist.retrieval = {
      used: true,
      sourceCategory: "project-memory",
      matchCount: 2,
      preview: "- [context] auth transport uses codex-http\n- [insight] prefer local readonly tools",
    };

    const assembled = await assemblePrompt({
      session,
      prompt: "continue auth work",
    });

    assert.match(assembled.prompt, /Archivist context:/);
    assert.match(assembled.prompt, /Archivist retrieval: project-memory; matches=2/);
    assert.match(assembled.prompt, /auth transport uses codex-http/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("assemblePrompt uses prompt v2 when configured", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-instructions-v2-"));

  try {
    const session = createSession(cwd);
    session.prompt = {
      assembly: "v2",
    };

    const assembled = await assemblePrompt({
      session,
      prompt: "Fix tool loop",
    });

    assert.ok(assembled.v2);
    assert.equal(assembled.layers, null);
    assert.match(assembled.prompt, /## Execution Contract/);
    assert.match(assembled.prompt, /__NEXAGENT_PROMPT_DYNAMIC_BOUNDARY__/);
    assert.match(assembled.prompt, /## Current Invocation/);
    assert.doesNotMatch(assembled.prompt, /Execution guidance:/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadHarnessConfig summarizes material instruction sources", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-config-"));

  try {
    await writeFile(path.join(cwd, "AGENTS.md"), "# Repo Guardrails\nUse repo rules first.\n", "utf8");
    await writeFile(path.join(cwd, "CLAUDE.md"), "Prefer baseline runtime truth.\n", "utf8");
    await mkdir(path.join(cwd, ".claude"));
    await writeFile(path.join(cwd, ".claude", "settings.json"), "{}\n", "utf8");
    await writeFile(path.join(cwd, ".mcp.json"), '{"mcpServers":{"context7":{},"sentry":{}}}\n', "utf8");
    await mkdir(path.join(cwd, "openspec"));
    await writeFile(path.join(cwd, "openspec", "SPEC.md"), "# Prompt Assembly\nKeep layers visible.\n", "utf8");

    const config = await loadHarnessConfig(cwd);
    const sourceByKind = new Map(config.instructionSources.map((source) => [source.kind, source]));

    assert.match(sourceByKind.get("AGENTS.md")?.summary ?? "", /AGENTS\.md: # Repo Guardrails/);
    assert.match(sourceByKind.get("AGENTS.md")?.detail ?? "", /Use repo rules first\./);
    assert.match(sourceByKind.get("CLAUDE.md")?.summary ?? "", /CLAUDE\.md: Prefer baseline runtime truth\./);
    assert.equal(sourceByKind.get(".mcp.json")?.summary, "MCP registry: context7, sentry");
    assert.equal(sourceByKind.get(".mcp.json")?.detail, "Configured MCP servers: context7, sentry");
    assert.match(sourceByKind.get(".claude")?.summary ?? "", /\.claude includes settings\.json/);
    assert.match(sourceByKind.get("openspec")?.summary ?? "", /openspec includes SPEC\.md/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
