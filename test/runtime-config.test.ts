import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createRuntimeState } from "../src/runtime/bootstrap.js";
import { loadHarnessConfig } from "../src/runtime/config.js";
import { loadPersistedRuntimeState, savePersistedRuntimeState } from "../src/runtime/persistence.js";
import { applyProviderSelection, applyTransportMode, createRuntimeSession, recordRuntimeEvent, setRuntimeAction, syncRuntimeSession } from "../src/runtime/session.js";

const AUTH_STATE = {
  provider: "codex" as const,
  available: true,
  loggedIn: true,
  method: "ChatGPT",
  status: "Logged in using ChatGPT",
  checkedAt: "2025-01-01T00:00:00.000Z",
};

const DEFAULT_REPO_FRESHNESS = {
  status: "no-repo" as const,
  tracking: null,
  ahead: null,
  behind: null,
  dirty: false,
  needsPull: false,
  checkedAt: null,
};

const DEFAULT_GIT_FRESHNESS = {
  status: "no-upstream" as const,
  tracking: null,
  ahead: null,
  behind: null,
  dirty: false,
  needsPull: false,
  checkedAt: null,
};

const DEFAULT_TOOL_POLICY = {
  mode: "repo-local-guarded" as const,
  allowedRoots: ["/repo"],
  protectedRoots: ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root", "/run", "/sbin", "/sys", "/usr", "/var"],
  shell: "limited" as const,
  writes: "guarded" as const,
  deletes: "blocked" as const,
};

test("loadHarnessConfig discovers repo-local instruction sources", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-config-"));

  try {
    await writeFile(path.join(cwd, "AGENTS.md"), "# agents\n", "utf8");
    await writeFile(path.join(cwd, "CLAUDE.md"), "# claude\n", "utf8");
    await mkdir(path.join(cwd, ".claude"));
    await writeFile(path.join(cwd, ".mcp.json"), "{}\n", "utf8");
    await mkdir(path.join(cwd, "openspec"));

    const config = await loadHarnessConfig(cwd);

    assert.deepEqual(config.instructionSources, [
      {
        kind: "AGENTS.md",
        path: path.join(cwd, "AGENTS.md"),
        layer: "repoBehavior",
        summary: "AGENTS.md: # agents",
        detail: "# agents",
      },
      {
        kind: "CLAUDE.md",
        path: path.join(cwd, "CLAUDE.md"),
        layer: "repoBehavior",
        summary: "CLAUDE.md: # claude",
        detail: "# claude",
      },
      {
        kind: ".claude",
        path: path.join(cwd, ".claude"),
        layer: "repoBehavior",
        summary: ".claude settings and command files",
      },
      {
        kind: ".mcp.json",
        path: path.join(cwd, ".mcp.json"),
        layer: "repoBehavior",
        summary: "MCP registry: no servers declared",
        detail: "Configured MCP servers: none",
      },
      {
        kind: "openspec",
        path: path.join(cwd, "openspec"),
        layer: "taskContext",
        summary: "OpenSpec changes/specs/tasks available",
      },
    ]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadHarnessConfig imports enabled Claude MCP servers", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-claude-import-"));

  try {
    await mkdir(path.join(cwd, ".claude"));
    await writeFile(
      path.join(cwd, ".claude", "settings.json"),
      JSON.stringify({
        apiProvider: "codex",
        enabledMcpjsonServers: ["context7", "filesystem"],
        env: { CODEX_MODEL: "gpt-5.4" },
        hooks: {
          PreToolUse: [
            {
              matcher: "Edit|Write",
              hooks: [
                {
                  type: "command",
                  command: "echo guard",
                },
              ],
            },
          ],
        },
      }),
      "utf8",
    );

    const config = await loadHarnessConfig(cwd);

    assert.deepEqual(config.enabledMcpServers, ["context7", "filesystem"]);
    assert.deepEqual(config.imports.claude, {
      path: path.join(cwd, ".claude", "settings.json"),
      importedKeys: ["provider", "modelSelection", "enabledMcpServers", "hooks"],
    });
    assert.deepEqual(config.hooks, {
      sourcePath: null,
      status: "configured",
      events: ["PreToolUse"],
      commandCount: 1,
      invalidEntries: [],
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadHarnessConfig imports Claude archivist settings", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-claude-archivist-"));

  try {
    await mkdir(path.join(cwd, ".claude"));
    await writeFile(
      path.join(cwd, ".claude", "settings.local.json"),
      JSON.stringify({
        memory: {
          enabled: true,
          storagePath: ".claude/memory.json",
        },
      }),
      "utf8",
    );

    const config = await loadHarnessConfig(cwd);

    assert.deepEqual(config.archivist, {
      enabled: true,
      boundary: "bounded-write",
      storagePath: path.join(cwd, ".claude", "memory.json"),
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
    });
    assert.deepEqual(config.imports.claude, {
      path: path.join(cwd, ".claude", "settings.local.json"),
      importedKeys: ["archivist"],
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadHarnessConfig lets local nexagent settings override imported archivist config", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-archivist-override-"));

  try {
    await mkdir(path.join(cwd, ".claude"));
    await mkdir(path.join(cwd, ".nexagent"));
    await writeFile(
      path.join(cwd, ".claude", "settings.json"),
      JSON.stringify({
        memory: {
          enabled: true,
          storagePath: ".claude/memory.json",
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(cwd, ".nexagent", "settings.local.json"),
      JSON.stringify({
        archivist: {
          enabled: true,
          storagePath: ".nexagent/archivist.local.json",
        },
      }),
      "utf8",
    );

    const config = await loadHarnessConfig(cwd);

    assert.deepEqual(config.archivist, {
      enabled: true,
      boundary: "bounded-write",
      storagePath: path.join(cwd, ".nexagent", "archivist.local.json"),
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
    });
    assert.deepEqual(config.imports.claude, {
      path: path.join(cwd, ".claude", "settings.json"),
      importedKeys: ["archivist"],
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("createRuntimeState exposes discovered instruction sources", () => {
  const instructionSources = [
    {
      kind: "AGENTS.md",
      path: "/repo/AGENTS.md",
      layer: "repoBehavior",
      summary: "Repo agent instructions",
      detail: "# agents",
    },
  ];

  assert.deepEqual(
    createRuntimeState({
      config: {
        cwd: "/repo",
        productName: "nexagent",
        provider: "codex",
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
        mcpConfigPath: "/repo/.mcp.json",
        enabledMcpServers: ["context7"],
        imports: { claude: null },
        instructionSources,
        repo: {
          root: null,
          name: "repo",
          vcs: "none",
          branch: null,
          freshness: DEFAULT_REPO_FRESHNESS,
        },
        toolPolicy: DEFAULT_TOOL_POLICY,
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
      },
      mcp: {
        path: "/repo/.mcp.json",
        serverNames: ["context7"],
      },
      auth: AUTH_STATE,
    }),
    {
      product: "nexagent",
      provider: "codex",
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
      providerTransport: {
        executor: "fetch",
        adapter: "codex-chatgpt-http",
        mode: "codex-http",
        authSource: "codex-auth-json",
        authGate: "ready",
        activeProvider: "codex",
        openaiBaseUrl: "https://chatgpt.com/backend-api/codex",
        silentFallback: false,
      },
      commandModes: {
        cavemanMode: false,
        deadpoolMode: false,
        statusline: false,
        mouseMode: "auto",
      },
      operationDefaults: {
        requireApprovalForGuarded: false,
      },
      cwd: "/repo",
      repo: {
        root: null,
        name: "repo",
        vcs: "none",
        branch: null,
        freshness: DEFAULT_REPO_FRESHNESS,
      },
      toolPolicy: DEFAULT_TOOL_POLICY,
      mcpServers: ["context7"],
      enabledMcpServers: ["context7"],
      imports: { claude: null },
      hooks: {
        sourcePath: null,
        status: "none",
        events: [],
        commandCount: 0,
        invalidEntries: [],
      },
      auth: AUTH_STATE,
      instructionSources,
      instructionLayers: {
        identity: ["You are nexagent, local coding harness assistant for repo-aware software engineering work."],
        responseStyle: [],
        executionGuidance: [
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
        ],
        explicitInvocation: "",
        activeSkill: [],
        repoBehavior: ["AGENTS.md\n# agents"],
        taskContext: [
          "Follow repo-local instructions over imported defaults when they conflict.",
          "Treat OpenSpec artifacts as current task context and implementation intent, not user intent overrides.",
        ],
        importedDefaults: [],
        toolAvailability: [
          "Working directory: /repo",
          "Loaded MCP servers: context7",
          "Enabled MCP servers: context7",
          "Internal tool protocol: when tool use is required, respond with only one XML block:",
          '<nexagent_tool_call>{"name":"read_file","arguments":{"path":"src/cli.ts"}}</nexagent_tool_call>',
          "Available internal tools: read_file, write_file, apply_patch, list_dir, search_content, search_files, git_status, git_diff, shell_command, archivist_save, archivist_checkpoint",
          "Use tools for repo inspection instead of narrating intended actions.",
        ],
        providerFallback: [
          "Active provider: codex",
          "Fallback policy: require-open-spec",
          "Honor active provider routing for this session.",
          "Do not silently switch providers; require explicit spec-backed routing changes.",
        ],
        archivistContext: [
          "Archivist memory status: disabled.",
          "When asked about memory, report this harness memory status first; do not default to generic model-memory disclaimers.",
        ],
        conversationContext: [],
        sections: [
          {
            key: "identity",
            title: "System identity",
            cache: "stable",
            entries: ["You are nexagent, local coding harness assistant for repo-aware software engineering work."],
          },
          {
            key: "executionGuidance",
            title: "Execution guidance",
            cache: "stable",
            entries: [
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
            ],
          },
          {
            key: "repoBehavior",
            title: "Repo behavior",
            cache: "stable",
            entries: ["AGENTS.md\n# agents"],
          },
          {
            key: "taskContext",
            title: "Task context",
            cache: "stable",
            entries: [
              "Follow repo-local instructions over imported defaults when they conflict.",
              "Treat OpenSpec artifacts as current task context and implementation intent, not user intent overrides.",
            ],
          },
          {
            key: "toolAvailability",
            title: "Tool availability",
            cache: "stable",
            entries: [
              "Working directory: /repo",
              "Loaded MCP servers: context7",
              "Enabled MCP servers: context7",
              "Internal tool protocol: when tool use is required, respond with only one XML block:",
              '<nexagent_tool_call>{"name":"read_file","arguments":{"path":"src/cli.ts"}}</nexagent_tool_call>',
              "Available internal tools: read_file, write_file, apply_patch, list_dir, search_content, search_files, git_status, git_diff, shell_command, archivist_save, archivist_checkpoint",
              "Use tools for repo inspection instead of narrating intended actions.",
            ],
          },
          {
            key: "providerFallback",
            title: "Provider fallback",
            cache: "stable",
            entries: [
              "Active provider: codex",
              "Fallback policy: require-open-spec",
              "Honor active provider routing for this session.",
              "Do not silently switch providers; require explicit spec-backed routing changes.",
            ],
          },
          {
            key: "archivistContext",
            title: "Archivist context",
            cache: "dynamic",
            entries: [
              "Archivist memory status: disabled.",
              "When asked about memory, report this harness memory status first; do not default to generic model-memory disclaimers.",
            ],
          },
        ],
        dynamicBoundary: "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__",
      },
      instructionLayerSummary: {
        count: 29,
        identity: "You are nexagent, local coding harness assistant for repo-aware software engineering work.",
        responseStyle: "none",
        executionGuidance:
          "Use repo-local instructions and configuration as primary operating contract after direct user intent. | Read relevant code before changing behavior, then keep edits scoped to requested outcome. | Use available runtime tools and commands to act on code or repo state instead of only describing intent. | Do not claim code, files, tests, or verification happened unless you actually performed them in this session. | When user asks to continue, keep going, start, or finish a task, continue working until task is complete or a real blocker stops progress. | When user authorizes a sequence of checks or steps, keep running remaining steps without asking again after each substep unless a blocker, failure, or approval gate stops progress. | Prefer action over narration: inspect, edit, run checks, and verify before reporting outcome. | For execution requests, do not answer with only intention or reassurance. Perform the work in the same turn unless blocked. | Do not say you are about to run checks, continue later, or report back soon. Run the checks or state the blocker now. | If user asks for smoke tests, debugging, implementation, or verification, use tools and produce actual results instead of a promise. | If user asks for exact, full, verbatim, or complete file/chat/transcript content, preserve exact content instead of summarizing. If exact content is unavailable, say what is missing plainly. | Report verification truthfully. If checks were not run or failed, say so plainly.",
        activeSkill: "none",
        repoBehavior: "AGENTS.md=# agents",
        taskContext:
          "Follow repo-local instructions over imported defaults when they conflict. | Treat OpenSpec artifacts as current task context and implementation intent, not user intent overrides.",
        importedDefaults: "none",
        toolAvailability:
          'Working directory: /repo | Loaded MCP servers: context7 | Enabled MCP servers: context7 | Internal tool protocol: when tool use is required, respond with only one XML block: | <nexagent_tool_call>{"name":"read_file","arguments":{"path":"src/cli.ts"}}</nexagent_tool_call> | Available internal tools: read_file, write_file, apply_patch, list_dir, search_content, search_files, git_status, git_diff, shell_command, archivist_save, archivist_checkpoint | Use tools for repo inspection instead of narrating intended actions.',
        providerFallback:
          "Active provider: codex | Fallback policy: require-open-spec | Honor active provider routing for this session. | Do not silently switch providers; require explicit spec-backed routing changes.",
        archivistContext: "Archivist memory status: disabled. | When asked about memory, report this harness memory status first; do not default to generic model-memory disclaimers.",
        conversationContext: "none",
        stableSections: "identity, executionGuidance, repoBehavior, taskContext, toolAvailability, providerFallback",
        dynamicSections: "archivistContext",
        dynamicBoundary: "__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__",
      },
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
    },
  );
});

test("syncRuntimeSession preserves selected provider when reload still supports it", () => {
  const session = createRuntimeSession({
    config: {
      cwd: "/repo",
      productName: "nexagent",
      provider: "codex",
      providerRouting: {
        fallback: {
          policy: "require-open-spec",
          silentProviderSwitch: false,
        },
        modelSelection: {
          activeProvider: "codex",
          configuredModels: {
            codex: "gpt-5.4",
            anthropic: "claude-sonnet-4-6",
          },
        },
        transport: {},
      },
      mcpConfigPath: "/repo/.mcp.json",
      enabledMcpServers: ["context7"],
      imports: { claude: null },
      instructionSources: [],
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
    },
    mcp: {
      path: "/repo/.mcp.json",
      serverNames: ["context7"],
    },
    auth: AUTH_STATE,
  });

  session.provider = "anthropic";
  session.providerRouting.modelSelection.activeProvider = "anthropic";

  syncRuntimeSession(session, {
    config: {
      cwd: "/repo",
      productName: "nexagent",
      provider: "codex",
      providerRouting: {
        fallback: {
          policy: "require-open-spec",
          silentProviderSwitch: false,
        },
        modelSelection: {
          activeProvider: "codex",
          configuredModels: {
            codex: "gpt-5.4",
            anthropic: "claude-sonnet-4-6",
          },
        },
        transport: {},
      },
      mcpConfigPath: "/repo/.mcp.json",
      enabledMcpServers: ["context7", "filesystem"],
      imports: { claude: null },
      instructionSources: [],
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
    },
    mcp: {
      path: "/repo/.mcp.json",
      serverNames: ["context7", "filesystem"],
    },
    auth: AUTH_STATE,
  });

  assert.equal(session.provider, "anthropic");
  assert.equal(session.providerRouting.modelSelection.activeProvider, "anthropic");
  assert.equal(session.providerTransport.activeProvider, "anthropic");
  assert.deepEqual(session.mcpServers, ["context7", "filesystem"]);
});

test("syncRuntimeSession falls back to configured provider when selection disappears", () => {
  const session = createRuntimeSession({
    config: {
      cwd: "/repo",
      productName: "nexagent",
      provider: "codex",
      providerRouting: {
        fallback: {
          policy: "require-open-spec",
          silentProviderSwitch: false,
        },
        modelSelection: {
          activeProvider: "codex",
          configuredModels: {
            codex: "gpt-5.4",
            anthropic: "claude-sonnet-4-6",
          },
        },
        transport: {},
      },
      mcpConfigPath: "/repo/.mcp.json",
      enabledMcpServers: [],
      imports: { claude: null },
      instructionSources: [],
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
    },
    mcp: {
      path: "/repo/.mcp.json",
      serverNames: [],
    },
    auth: AUTH_STATE,
  });

  session.provider = "anthropic";
  session.providerRouting.modelSelection.activeProvider = "anthropic";

  syncRuntimeSession(session, {
    config: {
      cwd: "/repo",
      productName: "nexagent",
      provider: "codex",
      providerRouting: {
        fallback: {
          policy: "require-open-spec",
          silentProviderSwitch: false,
        },
        modelSelection: {
          activeProvider: "codex",
          configuredModels: {
            codex: "gpt-5.4",
          },
        },
        transport: {},
      },
      mcpConfigPath: "/repo/.mcp.json",
      enabledMcpServers: [],
      imports: { claude: null },
      instructionSources: [],
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
    },
    mcp: {
      path: "/repo/.mcp.json",
      serverNames: [],
    },
    auth: AUTH_STATE,
  });

  assert.equal(session.provider, "codex");
  assert.equal(session.providerRouting.modelSelection.activeProvider, "codex");
  assert.equal(session.providerTransport.activeProvider, "codex");
});

test("syncRuntimeSession preserves selected provider in transport state after reload", () => {
  const session = createRuntimeSession({
    config: {
      cwd: "/repo",
      productName: "nexagent",
      provider: "codex",
      providerRouting: {
        fallback: {
          policy: "require-open-spec",
          silentProviderSwitch: false,
        },
        modelSelection: {
          activeProvider: "codex",
          configuredModels: {
            codex: "gpt-5.4",
            openai: "gpt-5.4",
          },
        },
        transport: {
          openaiBaseUrl: "https://api.openai.test/v1",
        },
      },
      mcpConfigPath: "/repo/.mcp.json",
      enabledMcpServers: [],
      imports: { claude: null },
      instructionSources: [],
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
      repo: {
        root: "/repo",
        name: "repo",
        vcs: "git",
        branch: "main",
        freshness: DEFAULT_GIT_FRESHNESS,
      },
      toolPolicy: DEFAULT_TOOL_POLICY,
    },
    mcp: {
      path: "/repo/.mcp.json",
      serverNames: [],
    },
    auth: AUTH_STATE,
  });

  applyProviderSelection(session, "openai");

  syncRuntimeSession(session, {
    config: {
      cwd: "/repo",
      productName: "nexagent",
      provider: "codex",
      providerRouting: {
        fallback: {
          policy: "require-open-spec",
          silentProviderSwitch: false,
        },
        modelSelection: {
          activeProvider: "codex",
          configuredModels: {
            codex: "gpt-5.4",
            openai: "gpt-5.4",
          },
        },
        transport: {
          openaiBaseUrl: "https://api.openai.test/v1",
        },
      },
      mcpConfigPath: "/repo/.mcp.json",
      enabledMcpServers: ["context7"],
      imports: { claude: null },
      instructionSources: [],
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
      repo: {
        root: "/repo",
        name: "repo",
        vcs: "git",
        branch: "main",
        freshness: DEFAULT_GIT_FRESHNESS,
      },
      toolPolicy: DEFAULT_TOOL_POLICY,
    },
    mcp: {
      path: "/repo/.mcp.json",
      serverNames: ["context7"],
    },
    auth: AUTH_STATE,
  });

  assert.equal(session.provider, "openai");
  assert.equal(session.providerRouting.modelSelection.activeProvider, "openai");
  assert.equal(session.providerTransport.activeProvider, "openai");
  assert.equal(session.providerTransport.openaiBaseUrl, "https://api.openai.test/v1");
});

test("setRuntimeAction centralizes runtime progress state", () => {
  const session = createRuntimeSession({
    config: {
      cwd: "/repo",
      productName: "nexagent",
      provider: "codex",
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
      mcpConfigPath: "/repo/.mcp.json",
      enabledMcpServers: [],
      imports: { claude: null },
      instructionSources: [],
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
      repo: {
        root: "/repo",
        name: "repo",
        vcs: "git",
        branch: "main",
        freshness: DEFAULT_GIT_FRESHNESS,
      },
      toolPolicy: DEFAULT_TOOL_POLICY,
    },
    mcp: {
      path: "/repo/.mcp.json",
      serverNames: [],
    },
    auth: AUTH_STATE,
  });

  setRuntimeAction(session, "running", "provider request", "2026-04-25T12:00:00.000Z");
  assert.deepEqual(session.action, {
    status: "running",
    detail: "provider request",
    pending: true,
    lastActivity: "2026-04-25T12:00:00.000Z",
  });

  setRuntimeAction(session, "ready", "command complete", "2026-04-25T12:00:01.000Z");
  assert.deepEqual(session.action, {
    status: "ready",
    detail: "command complete",
    pending: false,
    lastActivity: "2026-04-25T12:00:01.000Z",
  });
});

test("runtime session keeps bounded shared event log", () => {
  const session = createRuntimeSession({
    config: {
      cwd: "/repo",
      productName: "nexagent",
      provider: "codex",
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
      mcpConfigPath: "/repo/.mcp.json",
      enabledMcpServers: [],
      imports: { claude: null },
      instructionSources: [],
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
      repo: {
        root: "/repo",
        name: "repo",
        vcs: "git",
        branch: "main",
        freshness: DEFAULT_GIT_FRESHNESS,
      },
      toolPolicy: DEFAULT_TOOL_POLICY,
    },
    mcp: {
      path: "/repo/.mcp.json",
      serverNames: [],
    },
    auth: AUTH_STATE,
  });

  assert.equal(session.events[0]?.kind, "system");
  assert.equal(session.events[0]?.summary, "runtime baseline ready");

  for (let index = 0; index < 220; index += 1) {
    recordRuntimeEvent(session, {
      kind: "command",
      status: "completed",
      summary: `event ${String(index)}`,
    });
  }

  assert.equal(session.events.length, 200);
  assert.equal(session.events.at(-1)?.summary, "event 219");
});

test("persisted runtime state stores provider and transport mode", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-session-state-"));

  try {
    const session = createRuntimeSession({
      config: {
        cwd,
        productName: "nexagent",
        provider: "codex",
        providerRouting: {
          fallback: {
            policy: "require-open-spec",
            silentProviderSwitch: false,
          },
          modelSelection: {
            activeProvider: "codex",
            configuredModels: {
              codex: "gpt-5.4",
              openai: "gpt-5.4",
            },
          },
          transport: {
            openaiBaseUrl: "https://api.openai.test/v1",
          },
        },
        mcpConfigPath: path.join(cwd, ".mcp.json"),
        enabledMcpServers: [],
        imports: { claude: null },
        instructionSources: [],
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
        repo: {
          root: cwd,
          name: "repo",
          vcs: "git",
          branch: "main",
          freshness: DEFAULT_GIT_FRESHNESS,
        },
        toolPolicy: {
          ...DEFAULT_TOOL_POLICY,
          allowedRoots: [cwd],
        },
      },
      mcp: {
        path: path.join(cwd, ".mcp.json"),
        serverNames: [],
      },
      auth: AUTH_STATE,
      persisted: null,
    });

    applyProviderSelection(session, "openai");
    applyTransportMode(session, "http-responses");
    savePersistedRuntimeState(session);

    const persisted = await loadPersistedRuntimeState(cwd);
    assert.equal(persisted?.provider, "openai");
    assert.equal(persisted?.transportMode, "http-responses");
    assert.equal(persisted?.operationControls?.requireApprovalForGuarded, false);
    assert.deepEqual(persisted?.auth, AUTH_STATE);
    assert.match(persisted?.savedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);

    const raw = await readFile(path.join(cwd, ".nexagent", "session.json"), "utf8");
    assert.match(raw, /"transportMode": "http-responses"/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
