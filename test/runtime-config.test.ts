import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createDefaultProviderRegistry } from "../src/provider/registry.js";
import { bootstrapRuntime, createRuntimeState } from "../src/runtime/bootstrap.js";
import { loadHarnessConfig } from "../src/runtime/config.js";
import { loadMcpRegistrySummary, shutdownMcpRegistry } from "../src/runtime/mcp.js";
import { loadPersistedRuntimeState, savePersistedRuntimeState } from "../src/runtime/persistence.js";
import {
  applyProviderSelection,
  applyTransportMode,
  createRuntimeSession,
  getRuntimeSessionRevision,
  recordConversationTurn,
  recordRuntimeEvent,
  recordTurnTelemetry,
  setRuntimeAction,
  subscribeRuntimeSession,
  syncRuntimeSession,
} from "../src/runtime/session.js";

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
  mode: "workspace-guarded" as const,
  allowedRoots: ["/repo"],
  protectedRoots: ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root", "/run", "/sbin", "/sys", "/usr", "/var"],
  shell: "limited" as const,
  writes: "guarded" as const,
  deletes: "blocked" as const,
};

const EXPECTED_EXECUTION_GUIDANCE = [
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
];

const EXPECTED_TOOL_AVAILABILITY = [
  "Working directory: /repo",
  "Loaded MCP servers: context7",
  "Readable roots: all non-protected paths. Any child path under a readable root is readable unless it is protected.",
  "Writable roots: /repo. Non-yolo writes are limited to these roots.",
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
  "Available internal tools: read_file, write_file, apply_patch, batch_edit, preview_patch, list_dir, search_content, search_files, web_fetch, web_search, git_status, git_diff, shell_command, nexsight_execute, nexsight_index, nexsight_batch, nexsight_search, archivist_save, archivist_checkpoint, mcp_list_tools, mcp_call",
  "Use tools for repo inspection instead of narrating intended actions.",
];

async function withNexagentHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const previousHome = process.env.NEXAGENT_HOME;
  process.env.NEXAGENT_HOME = home;
  try {
    return await fn();
  } finally {
    if (previousHome === undefined) {
      delete process.env.NEXAGENT_HOME;
    } else {
      process.env.NEXAGENT_HOME = previousHome;
    }
  }
}

test("loadHarnessConfig discovers repo-local instruction sources", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-config-"));

  try {
    await writeFile(path.join(cwd, "AGENTS.md"), "# agents\n", "utf8");
    await writeFile(path.join(cwd, "CLAUDE.md"), "# claude\n", "utf8");
    await mkdir(path.join(cwd, ".claude"));
    await writeFile(path.join(cwd, ".mcp.json"), "{}\n", "utf8");
    await mkdir(path.join(cwd, "openspec"));

    const config = await loadHarnessConfig(cwd);

    assert.deepEqual(config.prompt, { assembly: "v2" });
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

test("loadHarnessConfig and bootstrapRuntime normalize invalid cwd inputs", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-invalid-cwd-"));
  const previousCwd = process.cwd();

  try {
    process.chdir(cwd);

    const config = await loadHarnessConfig({ path: cwd });
    assert.equal(config.cwd, cwd);

    const runtime = await bootstrapRuntime({ path: cwd });
    assert.equal(runtime.config.cwd, cwd);
  } finally {
    process.chdir(previousCwd);
    await rm(cwd, { recursive: true, force: true });
  }
});

test("recordRuntimeEvent repairs partial session event stores", () => {
  const partialSession = { id: "partial" } as unknown as Parameters<typeof recordRuntimeEvent>[0];

  const event = recordRuntimeEvent(partialSession, {
    kind: "command",
    status: "failed",
    summary: "command failed",
  });

  assert.equal(event.summary, "command failed");
  assert.deepEqual(partialSession.events.map((entry) => entry.summary), ["command failed"]);
});

test("loadHarnessConfig reads global nexagent settings from NEXAGENT_HOME", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-global-config-"));
  const nexagentHome = await mkdtemp(path.join(tmpdir(), "nexagent-home-"));

  try {
    await writeFile(
      path.join(nexagentHome, "settings.json"),
      JSON.stringify({
        provider: "openai",
        prompt: {
          assembly: "legacy",
        },
        mcp: {
          configPath: "mcp.json",
          enabledServers: ["global"],
        },
        archivist: {
          enabled: true,
          storagePath: "archivist.json",
        },
      }),
      "utf8",
    );

    const config = await withNexagentHome(nexagentHome, () => loadHarnessConfig(cwd));

    assert.equal(config.provider, "openai");
    assert.deepEqual(config.prompt, { assembly: "legacy" });
    assert.equal(config.mcpConfigPath, path.join(nexagentHome, "mcp.json"));
    assert.deepEqual(config.enabledMcpServers, ["global"]);
    assert.equal(config.archivist.storagePath, path.join(nexagentHome, "archivist.json"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(nexagentHome, { recursive: true, force: true });
  }
});

test("loadHarnessConfig lets repo nexagent settings override global settings", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-global-override-"));
  const nexagentHome = await mkdtemp(path.join(tmpdir(), "nexagent-home-"));

  try {
    await mkdir(path.join(cwd, ".nexagent"));
    await writeFile(path.join(nexagentHome, "settings.json"), JSON.stringify({ provider: "openai", prompt: { assembly: "legacy" } }), "utf8");
    await writeFile(path.join(cwd, ".nexagent", "settings.json"), JSON.stringify({ provider: "codex", prompt: { assembly: "v2" } }), "utf8");

    const config = await withNexagentHome(nexagentHome, () => loadHarnessConfig(cwd));

    assert.equal(config.provider, "codex");
    assert.deepEqual(config.prompt, { assembly: "v2" });
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(nexagentHome, { recursive: true, force: true });
  }
});

test("loadHarnessConfig resolves compaction settings with safe defaults and overrides", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-compaction-config-"));

  try {
    await mkdir(path.join(cwd, ".nexagent"));
    await writeFile(
      path.join(cwd, ".nexagent", "settings.json"),
      JSON.stringify({
        compaction: {
          enabled: false,
          thresholdPercent: 0.65,
          preserveTurns: 8,
          modelThresholdOverrides: {
            "gpt-5.4": 0.7,
            "bad-model": 2,
          },
        },
      }),
      "utf8",
    );

    const config = await loadHarnessConfig(cwd);

    assert.deepEqual(config.compaction, {
      enabled: false,
      thresholdPercent: 0.65,
      preserveTurns: 8,
      modelThresholdOverrides: {
        "gpt-5.4": 0.7,
      },
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadHarnessConfig merges global and repo provider registry JSON", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-registry-"));
  const nexagentHome = await mkdtemp(path.join(tmpdir(), "nexagent-home-"));

  try {
    await mkdir(path.join(cwd, ".nexagent"));
    await writeFile(
      path.join(nexagentHome, "config.json"),
      JSON.stringify({
        modelProviders: {
          codex: {
            baseUrl: "https://global.codex.test/backend-api/codex",
            models: ["gpt-5.4", "gpt-5.3-codex-spark"],
          },
          local: {
            name: "Local",
            baseUrl: "http://localhost:1234/v1",
            authSource: "openai-api-key",
            wireApi: "responses",
            models: ["local-model"],
            extraField: true,
          },
        },
      }),
      "utf8",
    );
    await writeFile(
      path.join(cwd, ".nexagent", "config.json"),
      JSON.stringify({
        modelProviders: {
          local: {
            baseUrl: "http://localhost:5678/v1",
            models: ["repo-model"],
            capabilities: {
              nativeTools: true,
              providerRecovery: true,
              malformedToolRecovery: true,
            },
          },
          bad: {
            wireApi: "banana",
          },
        },
      }),
      "utf8",
    );

    const config = await withNexagentHome(nexagentHome, () => loadHarnessConfig(cwd));
    const registry = config.providerRegistry;

    assert.equal(registry?.providers.codex.baseUrl, "https://global.codex.test/backend-api/codex");
    assert.deepEqual(registry?.providers.codex.modelIds, ["gpt-5.4", "gpt-5.3-codex-spark"]);
    assert.equal(registry?.providers.local.name, "Local");
    assert.equal(registry?.providers.local.baseUrl, "http://localhost:5678/v1");
    assert.deepEqual(registry?.providers.local.modelIds, ["repo-model"]);
    assert.equal(registry?.providers.local.capabilities.nativeTools, true);
    assert.equal(registry?.providers.local.capabilities.providerRecovery, true);
    assert.equal(registry?.providers.local.capabilities.malformedToolRecovery, true);
    assert.equal(registry?.providers.local.capabilities.streaming, false);
    assert.equal(registry?.providers.bad.disabledReason, "invalid wireApi");
    assert.ok(registry?.warnings.includes("modelProviders.local: unknown field extraField"));
    assert.ok(registry?.warnings.includes("modelProviders.bad.wireApi: expected cli-exec, responses, or responses_websocket"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(nexagentHome, { recursive: true, force: true });
  }
});

test("loadHarnessConfig imports enabled Claude MCP servers", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-claude-import-"));
  const nexagentHome = await mkdtemp(path.join(tmpdir(), "nexagent-home-"));

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

    const config = await withNexagentHome(nexagentHome, () => loadHarnessConfig(cwd));

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
    await rm(nexagentHome, { recursive: true, force: true });
  }
});

test("loadHarnessConfig imports Claude archivist settings", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-claude-archivist-"));
  const nexagentHome = await mkdtemp(path.join(tmpdir(), "nexagent-home-"));

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

    const config = await withNexagentHome(nexagentHome, () => loadHarnessConfig(cwd));

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
    await rm(nexagentHome, { recursive: true, force: true });
  }
});

test("loadHarnessConfig migrates Codex MCP config to global nexagent mcp once", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nexagent-codex-mcp-"));
  const cwd = path.join(root, "repo");
  const nexagentHome = path.join(root, ".nexagent");
  const codexDir = path.join(root, ".codex");

  try {
    await mkdir(cwd, { recursive: true });
    await mkdir(codexDir, { recursive: true });
    await writeFile(path.join(codexDir, "config.toml"), [
      "[mcp_servers.context7]",
      "command = \"context7-mcp\"",
      "startup_timeout_sec = 120",
      "",
      "[mcp_servers.github]",
      "url = \"https://api.githubcopilot.com/mcp/\"",
      "bearer_token_env_var = \"GITHUB_PAT_TOKEN\"",
      "startup_timeout_sec = 120",
      "",
    ].join("\n"), "utf8");

    const config = await withNexagentHome(nexagentHome, () => loadHarnessConfig(cwd));
    const migrated = JSON.parse(await readFile(path.join(nexagentHome, "mcp.json"), "utf8")) as { mcpServers: Record<string, { startup_timeout_sec?: number; url?: string }> };

    assert.equal(config.mcpConfigPath, path.join(nexagentHome, "mcp.json"));
    assert.deepEqual(Object.keys(migrated.mcpServers).sort(), ["context7", "github"]);
    assert.equal(migrated.mcpServers.context7?.startup_timeout_sec, 120);
    assert.equal(migrated.mcpServers.github?.url, "https://api.githubcopilot.com/mcp/");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadHarnessConfig prefers repo nexagent mcp over global, legacy, and codex configs", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nexagent-mcp-precedence-"));
  const cwd = path.join(root, "repo");
  const nexagentHome = path.join(root, ".nexagent");

  try {
    await mkdir(path.join(cwd, ".nexagent"), { recursive: true });
    await mkdir(nexagentHome, { recursive: true });
    await mkdir(path.join(root, ".codex"), { recursive: true });
    await writeFile(path.join(cwd, ".nexagent", "mcp.json"), '{"mcpServers":{"repo":{}}}\n', "utf8");
    await writeFile(path.join(nexagentHome, "mcp.json"), '{"mcpServers":{"global":{}}}\n', "utf8");
    await writeFile(path.join(cwd, ".mcp.json"), '{"mcpServers":{"legacy":{}}}\n', "utf8");
    await writeFile(path.join(root, ".codex", "config.toml"), '[mcp_servers.codex]\ncommand = "codex-mcp"\n', "utf8");

    const config = await withNexagentHome(nexagentHome, () => loadHarnessConfig(cwd));

    assert.equal(config.mcpConfigPath, path.join(cwd, ".nexagent", "mcp.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadHarnessConfig merges missing Codex MCP servers into global config without duplicates", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nexagent-mcp-merge-"));
  const cwd = path.join(root, "repo");
  const nexagentHome = path.join(root, ".nexagent");

  try {
    await mkdir(cwd, { recursive: true });
    await mkdir(nexagentHome, { recursive: true });
    await mkdir(path.join(root, ".codex"), { recursive: true });
    await writeFile(path.join(nexagentHome, "settings.json"), '{"mcp":{"configPath":"mcp.json"}}\n', "utf8");
    await writeFile(path.join(nexagentHome, "mcp.json"), '{"mcpServers":{"context7":{"command":"existing"},"local":{"command":"local-mcp"}}}\n', "utf8");
    await writeFile(path.join(root, ".codex", "config.toml"), [
      "[mcp_servers.context7]",
      "command = \"codex-context7\"",
      "[mcp_servers.playwright]",
      "command = \"npx\"",
      "args = [\"@playwright/mcp@latest\"]",
      "startup_timeout_sec = 120",
      "",
    ].join("\n"), "utf8");

    const config = await withNexagentHome(nexagentHome, () => loadHarnessConfig(cwd));
    const merged = JSON.parse(await readFile(path.join(nexagentHome, "mcp.json"), "utf8")) as { mcpServers: Record<string, { command?: string; startup_timeout_sec?: number }> };

    assert.equal(config.mcpConfigPath, path.join(nexagentHome, "mcp.json"));
    assert.deepEqual(Object.keys(merged.mcpServers).sort(), ["context7", "local", "playwright"]);
    assert.equal(merged.mcpServers.context7?.command, "existing");
    assert.equal(merged.mcpServers.playwright?.startup_timeout_sec, 120);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadHarnessConfig merges missing legacy repo MCP servers into global config", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nexagent-mcp-legacy-merge-"));
  const cwd = path.join(root, "repo");
  const nexagentHome = path.join(root, ".nexagent");

  try {
    await mkdir(cwd, { recursive: true });
    await mkdir(nexagentHome, { recursive: true });
    await writeFile(path.join(nexagentHome, "settings.json"), '{"mcp":{"configPath":"mcp.json","enabledServers":["context7","sentry"]}}\n', "utf8");
    await writeFile(path.join(nexagentHome, "mcp.json"), '{"mcpServers":{"context7":{"command":"existing"}}}\n', "utf8");
    await writeFile(path.join(cwd, ".mcp.json"), '{"mcpServers":{"context7":{"command":"legacy-context7"},"sentry":{"command":"npx","args":["-y","@sentry/mcp-server@latest"]}}}\n', "utf8");

    const config = await withNexagentHome(nexagentHome, () => loadHarnessConfig(cwd));
    const merged = JSON.parse(await readFile(path.join(nexagentHome, "mcp.json"), "utf8")) as { mcpServers: Record<string, { command?: string; args?: string[] }> };

    assert.equal(config.mcpConfigPath, path.join(nexagentHome, "mcp.json"));
    assert.deepEqual(Object.keys(merged.mcpServers).sort(), ["context7", "sentry"]);
    assert.equal(merged.mcpServers.context7?.command, "existing");
    assert.deepEqual(merged.mcpServers.sentry?.args, ["-y", "@sentry/mcp-server@latest"]);
    assert.deepEqual(config.enabledMcpServers, ["context7", "sentry"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("loadMcpRegistrySummary hydrates line-framed stdio MCP tools with startup timeout", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-mcp-hydrate-"));
  const serverPath = path.join(cwd, "mcp-server.mjs");
  const configPath = path.join(cwd, "mcp.json");

  try {
    await writeFile(serverPath, `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  for (;;) {
    const lineEnd = buffer.indexOf("\\n");
    if (lineEnd === -1) return;
    const line = buffer.slice(0, lineEnd).replace(/\\r$/, "");
    buffer = buffer.slice(lineEnd + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id && message.method === "initialize") respond(message.id, { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "1" } });
    if (message.id && message.method === "tools/list") respond(message.id, { tools: [{ name: "echo", description: "Echo input", inputSchema: { type: "object" } }] });
  }
});
function respond(id, result) {
  const body = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(body + "\\n");
}
`, "utf8");
    await writeFile(configPath, JSON.stringify({
      mcpServers: {
        fake: {
          command: process.execPath,
          args: [serverPath],
          startup_timeout_sec: 1,
        },
      },
    }), "utf8");

    const registry = await loadMcpRegistrySummary(configPath);

    assert.deepEqual(registry.serverNames, ["fake"]);
    assert.equal(registry.statuses[0]?.status, "hydrated");
    assert.equal(registry.statuses[0]?.startupTimeoutMs, 1000);
    assert.deepEqual(registry.tools.map((tool) => `${tool.server}.${tool.name}`), ["fake.echo"]);
    shutdownMcpRegistry(registry);
    assert.equal(registry.clients.size, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadMcpRegistrySummary validates MCP config shape", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-mcp-invalid-"));
  const configPath = path.join(cwd, "mcp.json");

  try {
    await writeFile(configPath, '{"mcpServers":{"bad":{"args":"not-array"}}}\n', "utf8");

    await assert.rejects(
      () => loadMcpRegistrySummary(configPath),
      /invalid MCP config .*mcpServers\.bad\.args/,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadMcpRegistrySummary expands MCP env placeholders from repo dotenv", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-mcp-env-"));
  const serverPath = path.join(cwd, "mcp-server.mjs");
  const configPath = path.join(cwd, "mcp.json");

  try {
    await writeFile(path.join(cwd, ".env"), "SENTRY_ACCESS_TOKEN=from-dotenv\n", "utf8");
    await writeFile(serverPath, `
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  for (;;) {
    const lineEnd = buffer.indexOf("\\n");
    if (lineEnd === -1) return;
    const line = buffer.slice(0, lineEnd).replace(/\\r$/, "");
    buffer = buffer.slice(lineEnd + 1);
    if (!line.trim()) continue;
    const message = JSON.parse(line);
    if (message.id && message.method === "initialize") respond(message.id, { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "1" } });
    if (message.id && message.method === "tools/list") respond(message.id, { tools: [{ name: "auth", description: process.env.SENTRY_ACCESS_TOKEN === "from-dotenv" ? "expanded" : "missing", inputSchema: { type: "object" } }] });
  }
});
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
`, "utf8");
    await writeFile(configPath, JSON.stringify({
      mcpServers: {
        fake: {
          command: process.execPath,
          args: [serverPath],
          env: {
            SENTRY_ACCESS_TOKEN: "${SENTRY_ACCESS_TOKEN}",
          },
        },
      },
    }), "utf8");

    const registry = await loadMcpRegistrySummary(configPath, [], { cwd, env: {} });

    assert.equal(registry.statuses[0]?.status, "hydrated");
    assert.equal(registry.tools[0]?.description, "expanded");
    shutdownMcpRegistry(registry);
    assert.equal(registry.clients.size, 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadHarnessConfig lets local nexagent settings override imported archivist config", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-archivist-override-"));
  const nexagentHome = await mkdtemp(path.join(tmpdir(), "nexagent-home-"));

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

    const config = await withNexagentHome(nexagentHome, () => loadHarnessConfig(cwd));

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
    await rm(nexagentHome, { recursive: true, force: true });
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
        prompt: {
          assembly: "v2",
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
        serverNames: ["context7"],
        servers: { context7: {} },
        tools: [],
        statuses: [],
        clients: new Map(),
      },
      auth: AUTH_STATE,
    }),
    {
      product: "nexagent",
      provider: "codex",
      providerRegistry: createDefaultProviderRegistry(),
      prompt: {
        assembly: "v2",
      },
      providerRouting: {
        fallback: {
          policy: "require-open-spec",
          silentProviderSwitch: false,
        },
        modelSelection: {
          activeProvider: "codex",
          configuredModels: { codex: "gpt-5.4" },
          configuredReasoningEfforts: {},
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
      mcpRegistry: {
        serverNames: ["context7"],
        servers: { context7: {} },
        tools: [],
        statuses: [],
        clients: new Map(),
      },
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
      promptV2Summary: {
        assembly: "v2",
        count: 63,
        stableSections: "identity, execution_contract, tool_routing, editing_safety, provider_guidance",
        dynamicSections: "repo_context, runtime_state",
        dynamicBoundary: "__NEXAGENT_PROMPT_DYNAMIC_BOUNDARY__",
        identity:
          "You are nexagent, a local terminal-first software engineering agent. | Primary job: complete repo-aware engineering work with tools, evidence, and verification; do not merely describe future work. | Repo-local instructions, skills, modes, and donor references are context overlays; direct user intent and core execution contract still control behavior.",
        executionContract:
          "Actionable request means act in this turn: inspect, edit, run, verify, or report a real blocker. | Operate loop: understand goal, inspect state, choose best tool, execute, observe, recover from failures, verify, then answer with evidence. | At turn start, the harness may display a short Attempting line. Treat it as orientation; do not repeat it unless useful. | Default to action for coding, debugging, testing, docs, repo inspection, and verification. Discuss only when user explicitly asks to brainstorm, compare, pla... | Do not end with a plan, promise, apology, self-correction, or ask-for-approval loop when tools can make progress. | Continue until task is done, verified, or genuinely blocked by missing access, approval gate, or unavailable external dependency. | When user says ok, yes, do that, same, continue, proceed, go ahead, start, finish, test, debug, implement, verify, or next, execute the most recent actionabl... | If user approves a sequence or asks for a no-hand-holding run, treat that as authorization to execute the sequence without asking for another target. | Do not ask user to say proceed, confirm, or continue after they gave a concrete task; execute or report the real blocker. | If user names a flow or goal without an exact file/script/test target, inspect repo state, choose the nearest representative target, and state the choice wit... | A missing user-selected target is not a blocker when repo evidence can identify scripts, tests, docs, or files to exercise. | Failed tool result means diagnose and vary path, query, command, or tool before stopping. | If a needed tool is unavailable, search repo-local scripts, node_modules/.bin, local user bins, MCP/tool registries, or current docs; install project-local d... | Final answer needs completed current-turn evidence or a named blocker, but keep it human-readable and compact. | Default final style: one short sentence for what changed, one short verification line if checks ran, one blocker line only if blocked. | Avoid long observed/verified/completed-evidence ledgers in chat unless user explicitly asks for audit detail or the artifact itself requires it. | Never claim file, test, tool, GSD, MCP, Nexsight, or runtime state without current-turn evidence.",
        toolRouting:
          "Use dedicated internal tools before generic shell when available. | Broad repo map/count/parse/compare/summarize -> nexsight_execute, nexsight_batch, nexsight_index, nexsight_search. | Use Nexsight like context-mode: run bounded code that prints distilled findings, index/search when useful, then answer from processed stdout/excerpts instead... | Nexsight execute rule: pass executable code or command plus reason when useful; do not pass only a natural-language task. | Nexsight result handling: parse stdout/stderr/envelopes, extract useful payload, cite source labels or paths, and run a narrower follow-up query when output ... | Exact small file read for editing or exact content -> read_file. | Exact symbol/text search -> search_content, search_files, or nexsight_search. | Precise edits -> apply_patch after reading target context. | Generated whole file -> write_file. | Multi-file mechanical edit -> batch_edit or Nexsight-assisted patch with validated insertion points. | Tests/build/git/local binaries -> shell_command. | Current web docs/URLs/facts -> web_fetch/web_search or relevant MCP docs tool. | Durable user/project fact -> archivist_save or archivist_checkpoint. | If stronger task-specific tool exists, use it before generic shell/listing. | If tool schema mismatch happens, correct call shape immediately and retry once.",
        editingSafety:
          "Read relevant code before editing behavior. | Keep changes scoped to requested outcome. | Do not revert user changes unless explicitly requested. | Prefer existing repo patterns over new abstractions. | Use structured parsers or repo helpers over ad hoc text manipulation when available. | Run focused verification when available before reporting completion. | If verification fails, report actual failing command/output and either fix it or name the blocker. | When edit tool output already rendered an Edited-file block or bounded diff preview, final answer should not repeat the full diff; summarize changed paths, l...",
        providerGuidance:
          'Active provider: codex | Provider fallback policy: require-open-spec | Do not silently switch providers. Use configured provider and transport unless user or config changes it. | Tool calls must use Nexagent internal tool envelope exactly when provider text transport requires tool markup. | Transport: Codex ChatGPT HTTP (codex-chatgpt-http); auth=ready. | Keep instructions separate from user input. | This transport still uses Nexagent text tool-call markup; do not wait for native callable functions. | Text tool-call transport: there is no separate function-call UI. To call a tool, emit exactly one XML block and no other prose: | <nexagent_tool_call>{"name":"read_file","arguments":{"path":"README.md"}}</nexagent_tool_call> | Replace name and arguments with the needed internal tool. After tool output returns, continue from evidence. | Avoid CLI-only assumptions; API transport may not expose local Codex shell behavior.',
        style: "none",
        repoContext: "Repo-local instructions are scoped context, not replacements for core execution contract. | AGENTS.md: # agents",
        runtimeState:
          "Provider: codex | Working directory: /repo | MCP servers: context7 | Readable roots: all non-protected paths | Writable roots: /repo | Protected roots: /bin, /boot, /dev, /etc, /lib, /lib64, /proc, /root, /run, /sbin, /sys, /usr, /var | Tool policy mode: workspace-guarded",
        conversationState: "none",
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
      lsp: {
        enabled: true,
        command: "typescript-language-server",
        args: ["--stdio"],
        indexArchivist: false,
      },
      ui: {
        logoMode: "full",
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

test("runtime session notifies subscribers for live UI refresh", () => {
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

  let notifications = 0;
  const unsubscribe = subscribeRuntimeSession(session, () => {
    notifications += 1;
  });

  const beforeRevision = getRuntimeSessionRevision(session);
  setRuntimeAction(session, "running", "provider request");
  recordRuntimeEvent(session, { kind: "provider", status: "started", summary: "codex turn started" });
  recordConversationTurn(session, "assistant", "hello");
  recordTurnTelemetry(session, "hi", "hello");
  unsubscribe();
  setRuntimeAction(session, "ready", "done");

  assert.equal(notifications, 4);
  assert.equal(getRuntimeSessionRevision(session), beforeRevision + 5);
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

  for (let index = 0; index < 620; index += 1) {
    recordRuntimeEvent(session, {
      kind: "command",
      status: "completed",
      summary: `event ${String(index)}`,
    });
  }

  assert.equal(session.events.length, 600);
  assert.equal(session.events.at(-1)?.summary, "event 619");
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

test("runtime session starts fresh even when legacy persisted telemetry exists", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-fresh-session-"));

  try {
    await mkdir(path.join(cwd, ".nexagent"), { recursive: true });
    await writeFile(path.join(cwd, ".nexagent", "session.json"), JSON.stringify({
      provider: "codex",
      providerModels: { codex: "gpt-5.4" },
      transportMode: "codex-http",
      telemetry: { turnCount: 12, lastInputTokens: 777, lastOutputTokens: 333 },
      events: [{ kind: "assistant", status: "completed", summary: "legacy" }],
      conversation: [{ role: "assistant", content: "legacy", tokens: 1 }],
      savedAt: new Date().toISOString(),
    }), "utf8");

    const persisted = await loadPersistedRuntimeState(cwd);
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
            },
          },
          transport: {},
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
          retrieval: { used: false, sourceCategory: null, matchCount: 0, preview: null },
          writes: { used: false, action: null, sourceCategory: null, savedAt: null, entryCount: 0, preview: null },
        },
        lsp: { enabled: true, command: "typescript-language-server", args: ["--stdio"], indexArchivist: false },
        ui: { logoMode: "full" },
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
      persisted,
    });

    assert.equal(session.telemetry.turnCount, 0);
    assert.equal(session.telemetry.lastInputTokens, 0);
    assert.equal(session.telemetry.lastOutputTokens, 0);
    assert.equal(session.conversation.length, 0);
    assert.equal(session.events.length, 1);
    assert.equal(session.events[0]?.summary, "runtime baseline ready");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
