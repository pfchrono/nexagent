import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createDefaultProviderRegistry } from "../src/provider/registry.js";
import { applyArchivistRetrieval, rememberArchivistFailure } from "../src/runtime/archivist.js";
import { resolveNexsightRuntime } from "../src/runtime/nexsight.js";
import { analyzeBlockedShellCommand, analyzeSafeGitCommand } from "../src/runtime/policy.js";
import { formatTodoOverlayRows, formatTodoPromptSummary } from "../src/runtime/todos.js";
import { classifyInternalToolRisk, executeInternalTool, executeInternalToolAsync, getInternalToolFunctionDefinitions } from "../src/runtime/tools.js";
import type { RuntimeSession } from "../src/runtime/session.js";

function createSession(cwd: string): RuntimeSession {
  return {
    id: "session_test",
    startedAt: "2025-01-01T00:00:00.000Z",
    product: "nexagent",
    provider: "codex",
    providerRegistry: createDefaultProviderRegistry(),
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
      executor: "codex",
      adapter: "codex-cli-exec",
      mode: "cli-exec",
      authSource: "codex-login",
      authGate: "ready",
      activeProvider: "codex",
      openaiBaseUrl: null,
      silentFallback: false,
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
    mcpServers: [],
    enabledMcpServers: [],
    imports: { claude: null },
    hooks: {
      sourcePath: null,
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
    lsp: {
      enabled: false,
      command: null,
      args: [],
      indexArchivist: false,
    },
    ui: {
      logoMode: "full",
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
      pendingQuestionnaire: null,
      lastDecision: null,
      cancelRequested: false,
      steerMessage: null,
      steerState: null,
      lastAppliedSteer: null,
      steerHistory: [],
      lastShellBlocker: null,
      boomerang: {
        active: false,
        task: null,
        startConversationIndex: 0,
        startEventIndex: 0,
        lastSummary: null,
      },
    },
    btw: {
      visible: false,
      mode: "contextual",
      thread: [],
      pending: null,
      nextId: 1,
      modelOverride: null,
      thinkingOverride: null,
      updatedAt: null,
    },
    todos: {
      tasks: [],
      nextId: 1,
      updatedAt: null,
    },
    toolMemory: {
      entries: [],
      nextId: 1,
      updatedAt: null,
    },
    subagents: {
      agents: [],
      types: [],
      nextId: 1,
      updatedAt: null,
    },
    goal: {
      goal: null,
      statusBarEnabled: true,
      activeTurnStartedAt: null,
      updatedAt: null,
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

test("internal tools centrally reject unexpected arguments before execution", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-args-"));

  try {
    const session = createSession(cwd);

    const readResult = executeInternalTool(session, {
      name: "read_file",
      arguments: { path: "notes.txt", command: "cat /etc/passwd" },
    });
    assert.equal(readResult.ok, false);
    assert.equal(readResult.tool, "read_file");
    assert.match(readResult.output, /unexpected arguments for tool read_file: command/);

    const asyncResult = await executeInternalToolAsync(session, {
      name: "web_fetch",
      arguments: { url: "https://example.com", shell: "rm -rf /etc/demo" },
    });
    assert.equal(asyncResult.ok, false);
    assert.equal(asyncResult.tool, "web_fetch");
    assert.match(asyncResult.output, /unexpected arguments for tool web_fetch: shell/);

    const nestedResult = await executeInternalToolAsync(session, {
      name: "ask_user_question",
      arguments: {
        questions: [{
          question: "Pick path?",
          header: "Path",
          sneaky: true,
          options: [
            { label: "A", description: "Use A" },
            { label: "B", description: "Use B" },
          ],
        }],
      },
    });
    assert.equal(nestedResult.ok, false);
    assert.match(nestedResult.output, /unexpected arguments for tool ask_user_question: questions\.0\.sneaky/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("internal tool argument guard accepts known legacy aliases", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-aliases-"));

  try {
    const session = createSession(cwd);

    const todo = executeInternalTool(session, {
      name: "todo",
      arguments: {
        items: [
          {
            text: "Inspect alias support",
            status: "in_progress",
          },
        ],
      },
    });
    assert.equal(todo.ok, true);
    assert.match(todo.output, /\[>\] todo-1 Inspect alias support/);

    const shell = executeInternalTool(session, {
      name: "shell_command",
      arguments: {
        command: "sleep 1",
        timeout_ms: 500,
        max_output_chars: 2000,
      },
    });
    assert.equal(shell.ok, false);
    assert.match(shell.output, /shell timed out after 500ms/);

    await mkdir(path.join(cwd, "nested"), { recursive: true });
    const shellWorkdir = executeInternalTool(session, {
      name: "shell_command",
      arguments: {
        command: "pwd",
        workdir: "nested",
      },
    });
    assert.equal(shellWorkdir.ok, true);
    assert.equal(shellWorkdir.output, path.join(cwd, "nested"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("internal strict tool schemas expose compatibility aliases", () => {
  const functions = new Map(getInternalToolFunctionDefinitions().map((definition) => [definition.name, definition]));
  const propertiesFor = (name: string): Record<string, unknown> => {
    const parameters = functions.get(name)?.parameters;
    assert.equal(typeof parameters, "object");
    assert.notEqual(parameters, null);
    const properties = (parameters as { properties?: unknown }).properties;
    assert.equal(typeof properties, "object");
    assert.notEqual(properties, null);
    return properties as Record<string, unknown>;
  };

  assert.ok("start_line" in propertiesFor("read_file"));
  assert.ok("end_line" in propertiesFor("read_file"));
  assert.ok("cwd" in propertiesFor("shell_command"));
  assert.ok("workdir" in propertiesFor("shell_command"));
  assert.ok("timeout" in propertiesFor("shell_command"));
  assert.ok("timeout_ms" in propertiesFor("shell_command"));
  assert.ok("max_output_chars" in propertiesFor("shell_command"));
  assert.ok("items" in propertiesFor("todo"));
  assert.ok("operations" in propertiesFor("batch_edit"));
  assert.ok("query" in propertiesFor("search_content"));
  assert.ok("query" in propertiesFor("search_files"));
  assert.ok("path" in propertiesFor("git_status"));
  assert.ok("lang" in propertiesFor("nexsight_execute"));
  assert.ok("path" in propertiesFor("lsp_navigation"));
  assert.ok("char" in propertiesFor("lsp_navigation"));
});

test("executeInternalTool writes and patches file inside guarded repo roots", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-write-"));

  try {
    const session = createSession(cwd);
    const filePath = path.join(cwd, "notes.txt");

    const writeResult = executeInternalTool(session, {
      name: "write_file",
      arguments: {
        path: "notes.txt",
        content: "alpha\nbeta\n",
      },
    });
    assert.equal(writeResult.ok, true);
    assert.equal(writeResult.tool, "write_file");
    assert.match(writeResult.output, /wrote notes\.txt \(11 chars\)/);
    assert.match(writeResult.output, /Edited notes\.txt \(\+2 -0\)/);
    assert.match(writeResult.output, /Index: notes\.txt/);
    assert.match(writeResult.output, /\+alpha/);
    assert.equal(await readFile(filePath, "utf8"), "alpha\nbeta\n");

    const patchResult = executeInternalTool(session, {
      name: "apply_patch",
      arguments: {
        path: "notes.txt",
        find: "beta",
        replace: "gamma",
      },
    });
    assert.equal(patchResult.ok, true);
    assert.equal(patchResult.tool, "apply_patch");
    assert.match(patchResult.output, /patched notes\.txt \(1 match\)/);
    assert.match(patchResult.output, /Edited notes\.txt \(\+1 -1\)/);
    assert.match(patchResult.output, /-beta/);
    assert.match(patchResult.output, /\+gamma/);
    assert.equal(await readFile(filePath, "utf8"), "alpha\ngamma\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("todo tool creates, advances, completes, and lists visual tasks", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-todo-tool-"));
  try {
    const session = createSession(cwd);

    const created = executeInternalTool(session, {
      name: "todo",
      arguments: { action: "create", subject: "Inspect repo", activeForm: "Inspecting repo" },
    });
    assert.equal(created.ok, true);
    assert.match(created.output, /\[ \] todo-1 Inspecting repo/);

    const active = executeInternalTool(session, {
      name: "todo",
      arguments: { action: "update", id: "todo-1", status: "in_progress" },
    });
    assert.equal(active.ok, true);
    assert.match(active.output, /\[>\] todo-1 Inspecting repo/);

    const done = executeInternalTool(session, {
      name: "todo",
      arguments: { action: "update", id: "todo-1", status: "completed" },
    });
    assert.equal(done.ok, true);
    assert.match(done.output, /\[x\] todo-1 Inspecting repo/);

    const listed = executeInternalTool(session, { name: "todo", arguments: { action: "list" } });
    assert.equal(listed.ok, true);
    assert.match(listed.output, /todos/);
    assert.match(listed.output, /\[x\] todo-1 Inspecting repo/);
    assert.deepEqual(formatTodoOverlayRows(session.todos, 80), []);
    assert.equal(formatTodoPromptSummary(session.todos), null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("todo tool treats empty items alias as clear", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-todo-clear-alias-"));
  try {
    const session = createSession(cwd);
    executeInternalTool(session, { name: "todo", arguments: { action: "create", subject: "Inspect repo" } });

    const cleared = executeInternalTool(session, { name: "todo", arguments: { items: [] } });

    assert.equal(cleared.ok, true);
    assert.equal(cleared.output, "todos cleared");
    assert.deepEqual(session.todos.tasks, []);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("todo tool rejects completed regression and dependency cycles", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-todo-guard-"));
  try {
    const session = createSession(cwd);
    executeInternalTool(session, { name: "todo", arguments: { action: "create", subject: "A" } });
    executeInternalTool(session, { name: "todo", arguments: { action: "create", subject: "B", blockedBy: ["todo-1"] } });
    executeInternalTool(session, { name: "todo", arguments: { action: "update", id: "todo-1", status: "completed" } });

    const regress = executeInternalTool(session, {
      name: "todo",
      arguments: { action: "update", id: "todo-1", status: "in_progress" },
    });
    assert.equal(regress.ok, false);
    assert.match(regress.output, /completed todo can only move to deleted/);

    const cycle = executeInternalTool(session, {
      name: "todo",
      arguments: { action: "update", id: "todo-1", addBlockedBy: ["todo-2"] },
    });
    assert.equal(cycle.ok, false);
    assert.match(cycle.output, /dependency cycle/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("goal tools expose state and only allow complete updates", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-goal-tool-"));
  try {
    const session = createSession(cwd);
    session.goal.goal = {
      version: 1,
      id: "goal-1",
      objective: "finish migration",
      status: "active",
      tokenBudget: 1000,
      tokensUsed: 10,
      timeUsedSeconds: 2,
      createdAt: 1,
      updatedAt: 1,
    };

    const current = executeInternalTool(session, { name: "get_goal", arguments: {} });
    assert.equal(current.ok, true);
    assert.match(current.output, /finish migration/);

    const rejected = executeInternalTool(session, { name: "update_goal", arguments: { status: "paused" } });
    assert.equal(rejected.ok, false);
    assert.match(rejected.output, /only accepts status=complete/);

    const completed = executeInternalTool(session, { name: "update_goal", arguments: { status: "complete" } });
    assert.equal(completed.ok, true);
    assert.equal(session.goal.goal.status, "complete");
    assert.match(completed.output, /remainingTokens/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("subagent result and steer tools operate on tracked agents", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-subagent-tools-"));
  try {
    const session = createSession(cwd);
    session.subagents.agents.push({
      id: "agent-1",
      type: "Explore",
      description: "Inspect files",
      prompt: "Inspect files",
      status: "completed",
      background: true,
      inheritContext: false,
      result: "Found package.json.",
      error: null,
      steerMessages: [],
      createdAt: "2026-05-04T00:00:00.000Z",
      startedAt: "2026-05-04T00:00:00.000Z",
      completedAt: "2026-05-04T00:00:01.000Z",
      inputTokens: 12,
      outputTokens: 4,
    });

    const result = await executeInternalToolAsync(session, {
      name: "get_subagent_result",
      arguments: { agent_id: "agent-1" },
    });
    assert.equal(result.ok, true);
    assert.match(result.output, /subagent agent-1/);
    assert.match(result.output, /Found package\.json/);

    const steer = executeInternalTool(session, {
      name: "steer_subagent",
      arguments: { agent_id: "agent-1", message: "focus on tests" },
    });
    assert.equal(steer.ok, true);
    assert.deepEqual(session.subagents.agents[0]?.steerMessages, ["focus on tests"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool previews patch without writing file", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-preview-"));

  try {
    const session = createSession(cwd);
    const filePath = path.join(cwd, "notes.txt");
    await writeFile(filePath, "alpha\nbeta\n", "utf8");

    const preview = executeInternalTool(session, {
      name: "preview_patch",
      arguments: {
        path: "notes.txt",
        find: "beta",
        replace: "gamma",
      },
    });

    assert.equal(preview.ok, true);
    assert.match(preview.output, /--- notes\.txt/);
    assert.match(preview.output, /-beta/);
    assert.match(preview.output, /\+gamma/);
    assert.equal(await readFile(filePath, "utf8"), "alpha\nbeta\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool batch edits validate anchors before writing", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-batch-edit-"));

  try {
    const session = createSession(cwd);
    await mkdir(path.join(cwd, "src"));
    await writeFile(path.join(cwd, "src", "one.ts"), "alpha\n// anchor\nomega\n", "utf8");
    await writeFile(path.join(cwd, "src", "two.ts"), "first\nsecond\n", "utf8");
    executeInternalTool(session, { name: "read_file", arguments: { path: "src/one.ts" } });
    executeInternalTool(session, { name: "read_file", arguments: { path: "src/two.ts" } });

    const missingAnchor = executeInternalTool(session, {
      name: "batch_edit",
      arguments: {
        edits: [
          { type: "insert_after", path: "src/one.ts", anchor: "// missing\n", content: "nope\n" },
          { type: "replace", path: "src/two.ts", find: "first", replace: "changed" },
        ],
      },
    });
    assert.equal(missingAnchor.ok, false);
    assert.match(missingAnchor.output, /anchor not found/);
    assert.equal(await readFile(path.join(cwd, "src", "two.ts"), "utf8"), "first\nsecond\n");

    const batchResult = executeInternalTool(session, {
      name: "batch_edit",
      arguments: {
        edits: [
          { type: "insert_after", path: "src/one.ts", anchor: "// anchor\n", content: "inserted\n" },
          { type: "replace", path: "src/two.ts", find: "second", replace: "changed" },
          { type: "write", path: "src/three.ts", content: "new file\n" },
        ],
      },
    });
    assert.equal(batchResult.ok, true);
    assert.match(batchResult.output, /batch edited 3 files with 3 operations/);
    assert.match(batchResult.output, /Edited src\/one\.ts \(\+1 -0\)/);
    assert.match(batchResult.output, /Index: src\/one\.ts/);
    assert.match(batchResult.output, /\+inserted/);
    assert.equal(await readFile(path.join(cwd, "src", "one.ts"), "utf8"), "alpha\n// anchor\ninserted\nomega\n");
    assert.equal(await readFile(path.join(cwd, "src", "two.ts"), "utf8"), "first\nchanged\n");
    assert.equal(await readFile(path.join(cwd, "src", "three.ts"), "utf8"), "new file\n");
    assert.equal(classifyInternalToolRisk({ name: "batch_edit", arguments: { edits: [] } }), "guarded");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool accepts query alias for search tools", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-search-alias-"));

  try {
    const session = createSession(cwd);
    await writeFile(path.join(cwd, "ghost.ts"), "const ghostText = true;\n", "utf8");

    const contentResult = executeInternalTool(session, {
      name: "search_content",
      arguments: {
        path: ".",
        query: "ghostText",
      },
    });
    assert.equal(contentResult.ok, true);
    assert.match(contentResult.output, /ghost\.ts:1:const ghostText = true;/);

    const fileResult = executeInternalTool(session, {
      name: "search_files",
      arguments: {
        path: ".",
        query: "*.ts",
      },
    });
    assert.equal(fileResult.ok, true);
    assert.match(fileResult.output, /ghost\.ts/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool runs nexsight execute and local index search", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-nexsight-"));

  try {
    const session = createSession(cwd);
    await writeFile(path.join(cwd, "notes.md"), "# Alpha\nNexsight keeps large output out of chat.\n", "utf8");

    const executeResult = executeInternalTool(session, {
      name: "nexsight_execute",
      arguments: {
        language: "javascript",
        code: "console.log(['alpha','beta','gamma'].length)",
      },
    });
    assert.equal(executeResult.ok, true);
    assert.equal(executeResult.output, "3");

    const largeOutputResult = executeInternalTool(session, {
      name: "nexsight_execute",
      arguments: {
        language: "javascript",
        code: "console.log('x'.repeat(64_000))",
      },
    });
    assert.equal(largeOutputResult.ok, true);
    assert.match(largeOutputResult.output, /\.\.\. truncated \d+ chars$/);
    assert.ok(largeOutputResult.output.length < 8_100);

    const inferredShellResult = executeInternalTool(session, {
      name: "nexsight_execute",
      arguments: {
        command: "printf '%s\\n' nexsight-shell-alias",
      },
    });
    assert.equal(inferredShellResult.ok, true);
    assert.equal(inferredShellResult.output, "nexsight-shell-alias");

    const shortAliasResult = executeInternalTool(session, {
      name: "nexsight_execute",
      arguments: {
        cmd: "printf '%s\\n' nexsight-cmd-alias",
      },
    });
    assert.equal(shortAliasResult.ok, true);
    assert.equal(shortAliasResult.output, "nexsight-cmd-alias");

    const compressedShellResult = executeInternalTool(session, {
      name: "nexsight_execute",
      arguments: {
        command: "for i in $(seq 1 220); do echo \"ok test $i\"; done; echo \"failed test important\"",
      },
    });
    assert.equal(compressedShellResult.ok, true);
    assert.match(compressedShellResult.output, /failed test important/);
    assert.match(compressedShellResult.output, /\[nexsight lean:/);

    const inferredPythonResult = executeInternalTool(session, {
      name: "nexsight_execute",
      arguments: {
        code: "import json\nprint(json.dumps({'language':'python'}))",
        reason: "verify python inference",
      },
    });
    assert.equal(inferredPythonResult.ok, true);
    assert.equal(inferredPythonResult.output, '{"language": "python"}');

    const taskOnlyResult = executeInternalTool(session, {
      name: "nexsight_execute",
      arguments: {
        task: "inspect the repo",
      },
    });
    assert.equal(taskOnlyResult.ok, false);
    assert.match(taskOnlyResult.output, /code or command required/);

    const homeResult = executeInternalTool(session, {
      name: "nexsight_execute",
      arguments: {
        code: "console.log(process.env.HOME); console.log(process.env.NEXAGENT_CWD)",
      },
    });
    assert.equal(homeResult.ok, true);
    assert.equal(homeResult.output, `${process.env.HOME ?? cwd}\n${cwd}`);

    await writeFile(path.join(cwd, "api.ts"), [
      "import fs from 'node:fs';",
      "export interface User { id: string }",
      "export function loadUser(id: string): User {",
      "  return { id };",
      "}",
      "class LocalThing {",
      "  run(): void {}",
      "}",
    ].join("\n"), "utf8");

    const readMapResult = executeInternalTool(session, {
      name: "nexsight_read",
      arguments: { path: "api.ts", mode: "map" },
    });
    assert.equal(readMapResult.ok, true);
    assert.match(readMapResult.output, /mode: map/);
    assert.match(readMapResult.output, /export function loadUser/);
    assert.doesNotMatch(readMapResult.output, /return \{ id \}/);

    const readLinesResult = executeInternalTool(session, {
      name: "nexsight_read",
      arguments: { path: "api.ts", mode: "lines:3-4" },
    });
    assert.equal(readLinesResult.ok, true);
    assert.match(readLinesResult.output, /3: export function loadUser/);
    assert.match(readLinesResult.output, /4:   return/);

    const gatherResult = executeInternalTool(session, {
      name: "nexsight_gather",
      arguments: { root: ".", pattern: "*.ts", query: "loadUser", mode: "signatures", limit: 10 },
    });
    assert.equal(gatherResult.ok, true);
    assert.match(gatherResult.output, /nexsight gather/);
    assert.match(gatherResult.output, /api\.ts/);
    assert.match(gatherResult.output, /export function loadUser/);

    assert.equal(classifyInternalToolRisk({
      name: "nexsight_execute",
      arguments: {
        code: "console.log('payload')",
      },
    }), "low");
    assert.equal(classifyInternalToolRisk({
      name: "nexsight_execute",
      arguments: {
        cmd: "printf payload",
      },
    }), "guarded");

    const indexResult = executeInternalTool(session, {
      name: "nexsight_index",
      arguments: {
        source: "notes",
        path: "notes.md",
      },
    });
    assert.equal(indexResult.ok, true);
    assert.match(indexResult.output, /indexed notes/);
    assert.equal((await stat(path.join(cwd, ".nexagent", "nexsight", "index.db"))).isFile(), true);

    const searchResult = executeInternalTool(session, {
      name: "nexsight_search",
      arguments: {
        query: "large output",
      },
    });
    assert.equal(searchResult.ok, true);
    assert.match(searchResult.output, /notes/);
    assert.match(searchResult.output, /large output/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool batch indexes repo files for nexsight search", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-nexsight-batch-"));

  try {
    const session = createSession(cwd);
    await mkdir(path.join(cwd, "src"));
    await writeFile(path.join(cwd, "src", "alpha.ts"), "export const batchNeedle = 'nexsight batch';\n", "utf8");
    await writeFile(path.join(cwd, "src", "skip.bin"), "\u0000\u0001", "utf8");

    const batchResult = executeInternalTool(session, {
      name: "nexsight_batch",
      arguments: {
        root: "src",
        pattern: "*.ts",
      },
    });
    assert.equal(batchResult.ok, true);
    assert.match(batchResult.output, /indexed repo \(1 files/);

    const searchResult = executeInternalTool(session, {
      name: "nexsight_search",
      arguments: {
        query: "batchNeedle",
      },
    });
    assert.equal(searchResult.ok, true);
    assert.match(searchResult.output, /repo:src\/alpha\.ts/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool reads reference files outside write roots but blocks protected paths", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-read-root-"));
  const referenceRoot = await mkdtemp(path.join(tmpdir(), "nexagent-reference-"));

  try {
    const session = createSession(cwd);
    const referencePath = path.join(referenceRoot, "reference.txt");
    await writeFile(referencePath, "useful reference\n", "utf8");

    const readReference = executeInternalTool(session, {
      name: "read_file",
      arguments: {
        path: referencePath,
      },
    });
    assert.deepEqual(readReference, {
      ok: true,
      tool: "read_file",
      output: "useful reference\n",
    });

    const blockedProtected = executeInternalTool(session, {
      name: "read_file",
      arguments: {
        path: "/etc/passwd",
      },
    });
    assert.equal(blockedProtected.ok, false);
    assert.match(blockedProtected.output, /protected path/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(referenceRoot, { recursive: true, force: true });
  }
});

test("executeInternalTool read_file renders explicit line ranges with line numbers", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-read-range-"));

  try {
    const session = createSession(cwd);
    await writeFile(path.join(cwd, "sample.txt"), "one\ntwo\nthree\nfour\nfive\n", "utf8");

    const result = executeInternalTool(session, {
      name: "read_file",
      arguments: {
        path: "sample.txt",
        startLine: 2,
        endLine: 4,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.tool, "read_file");
    assert.match(result.output, /^\[read_file range: sample\.txt lines 2-4 of 6\]/);
    assert.match(result.output, /^2 \| two$/m);
    assert.match(result.output, /^4 \| four$/m);
    assert.doesNotMatch(result.output, /one/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool read_file accepts snake_case line range aliases", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-read-range-alias-"));

  try {
    const session = createSession(cwd);
    await writeFile(path.join(cwd, "sample.txt"), "one\ntwo\nthree\nfour\nfive\n", "utf8");

    const result = executeInternalTool(session, {
      name: "read_file",
      arguments: {
        path: "sample.txt",
        start_line: 3,
        end_line: 5,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.tool, "read_file");
    assert.match(result.output, /^\[read_file range: sample\.txt lines 3-5 of 6\]/);
    assert.match(result.output, /^3 \| three$/m);
    assert.match(result.output, /^5 \| five$/m);
    assert.doesNotMatch(result.output, /one/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool read_file auto-compacts large files", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-read-compact-"));

  try {
    const session = createSession(cwd);
    const content = Array.from({ length: 170 }, (_, index) => `line ${String(index + 1)}`).join("\n");
    await writeFile(path.join(cwd, "large.txt"), content, "utf8");

    const result = executeInternalTool(session, {
      name: "read_file",
      arguments: {
        path: "large.txt",
      },
    });

    assert.equal(result.ok, true);
    assert.match(result.output, /^\[read_file compact: large\.txt lines 1-160 of 170\]/);
    assert.match(result.output, /^  1 \| line 1$/m);
    assert.match(result.output, /^160 \| line 160$/m);
    assert.match(result.output, /\.\.\. 10 more lines \.\.\.$/);
    assert.doesNotMatch(result.output, /line 170/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool expands home paths for readable references", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-home-"));

  try {
    const session = createSession(cwd);
    const result = executeInternalTool(session, {
      name: "list_dir",
      arguments: {
        path: "~/code/free-code",
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.tool, "list_dir");
    assert.doesNotMatch(result.output, /outside repo-local roots|outside readable workspace roots/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool search_files fallback respects gitignore", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-ignore-"));

  try {
    const session = createSession(cwd);
    await mkdir(path.join(cwd, "visible"), { recursive: true });
    await mkdir(path.join(cwd, "ignored"), { recursive: true });
    await writeFile(path.join(cwd, ".gitignore"), "ignored/\n", "utf8");
    await writeFile(path.join(cwd, "visible", "keep.ts"), "export const keep = true;\n", "utf8");
    await writeFile(path.join(cwd, "ignored", "drop.ts"), "export const drop = true;\n", "utf8");

    const result = executeInternalTool(session, {
      name: "search_files",
      arguments: {
        path: ".",
        pattern: "**/*.ts",
      },
    });

    assert.equal(result.ok, true);
    assert.match(result.output, /visible\/keep\.ts/);
    assert.doesNotMatch(result.output, /ignored\/drop\.ts/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("nexsight javascript runtime avoids compiled nexagent executable", () => {
  const runtime = resolveNexsightRuntime("javascript", {
    execPath: "/tmp/nexagent-linux-x64",
    env: process.env,
  });

  assert.equal(runtime.ok, true);
  if (runtime.ok) {
    assert.notEqual(runtime.command, "/tmp/nexagent-linux-x64");
    assert.match(path.basename(runtime.command), /^(bun|node)(\.exe)?$/);
  }
});

test("executeInternalToolAsync blocks private web URLs", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-web-"));

  try {
    const session = createSession(cwd);
    const result = await executeInternalToolAsync(session, {
      name: "web_fetch",
      arguments: {
        url: "http://localhost:1234",
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.tool, "web_fetch");
    assert.match(result.output, /local host URLs are blocked/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool blocks writes outside repo roots and ambiguous patches", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-block-"));

  try {
    const session = createSession(cwd);
    await mkdir(path.join(cwd, "docs"), { recursive: true });
    await writeFile(path.join(cwd, "docs", "guide.txt"), "needle\nneedle\n", "utf8");

    const blocked = executeInternalTool(session, {
      name: "write_file",
      arguments: {
        path: "../escape.txt",
        content: "nope",
      },
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.output, /outside repo-local roots/);

    const ambiguous = executeInternalTool(session, {
      name: "apply_patch",
      arguments: {
        path: "docs/guide.txt",
        find: "needle",
        replace: "thread",
      },
    });
    assert.deepEqual(ambiguous, {
      ok: false,
      tool: "apply_patch",
      output: "patch target ambiguous in docs/guide.txt; 2 matches",
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool permits normal writes inside configured readable home root", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-home-write-repo-"));
  const homeRoot = await mkdtemp(path.join(tmpdir(), "nexagent-tools-home-write-home-"));

  try {
    const session = createSession(cwd);
    session.toolPolicy.readRoots = [homeRoot, cwd];
    const targetPath = path.join(homeRoot, "notes.txt");

    const result = executeInternalTool(session, {
      name: "write_file",
      arguments: {
        path: targetPath,
        content: "home write\n",
      },
    });

    assert.equal(result.ok, true);
    assert.equal(await readFile(targetPath, "utf8"), "home write\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(homeRoot, { recursive: true, force: true });
  }
});

test("executeInternalTool lets yolo write outside repo roots but not protected paths", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-yolo-write-"));
  const referenceRoot = await mkdtemp(path.join(tmpdir(), "nexagent-tools-yolo-reference-"));

  try {
    const session = createSession(cwd);
    session.operationControls.yoloMode = true;
    session.operationControls.requireApprovalForGuarded = false;
    session.toolPolicy.readRoots = [referenceRoot, cwd];

    const targetPath = path.join(referenceRoot, "notes.txt");
    const writeResult = executeInternalTool(session, {
      name: "write_file",
      arguments: {
        path: targetPath,
        content: "outside repo but inside workspace\n",
      },
    });
    assert.equal(writeResult.ok, true);
    assert.match(writeResult.output, /wrote /);
    assert.equal(await readFile(targetPath, "utf8"), "outside repo but inside workspace\n");

    const protectedWrite = executeInternalTool(session, {
      name: "write_file",
      arguments: {
        path: "/etc/nexagent-test",
        content: "nope",
      },
    });
    assert.equal(protectedWrite.ok, false);
    assert.match(protectedWrite.output, /protected path/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(referenceRoot, { recursive: true, force: true });
  }
});

test("executeInternalTool runs guarded shell command inside repo cwd", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-shell-"));

  try {
    const session = createSession(cwd);
    const result = executeInternalTool(session, {
      name: "shell_command",
      arguments: {
        command: "pwd",
      },
    });

    assert.deepEqual(result, {
      ok: true,
      tool: "shell_command",
      output: cwd,
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool preserves accumulated shell stdout and stderr on failure", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-shell-accumulator-"));

  try {
    const session = createSession(cwd);
    const result = executeInternalTool(session, {
      name: "shell_command",
      arguments: {
        command: "printf 'out-one\\nout-two\\n'; printf 'err-one\\nerr-two\\n' >&2; exit 7",
      },
    });

    assert.equal(result.ok, false);
    assert.equal(result.tool, "shell_command");
    assert.match(result.output, /shell exit 7/);
    assert.match(result.output, /out-one/);
    assert.match(result.output, /out-two/);
    assert.match(result.output, /err-one/);
    assert.match(result.output, /err-two/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("safe-git blocks high-risk git shell commands", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-safe-git-"));

  try {
    const session = createSession(cwd);
    const analysis = analyzeSafeGitCommand("git reset --hard HEAD");
    assert.equal(analysis?.reason, "safe-git blocked hard reset");

    const result = executeInternalTool(session, {
      name: "shell_command",
      arguments: {
        command: "git push --force origin main",
      },
    });

    assert.equal(result.ok, false);
    assert.match(result.output, /safe-git blocked force push/);
    assert.equal(session.operationControls.lastShellBlocker?.source, "safe-git");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool permits absolute redirects outside protected system roots", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-shell-redirect-"));

  try {
    const session = createSession(cwd);
    const target = path.join(cwd, "gsd-workspace-path.txt");
    const result = executeInternalTool(session, {
      name: "shell_command",
      arguments: {
        command: `printf '%s\\n' ok > ${JSON.stringify(target)}`,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(await readFile(target, "utf8"), "ok\n");
    assert.equal(analyzeBlockedShellCommand("printf ok > /dev/null"), null);
    assert.equal(analyzeBlockedShellCommand("printf ok 2> /dev/null"), null);
    assert.equal(analyzeBlockedShellCommand("printf ok >/dev/null"), null);
    assert.equal(analyzeBlockedShellCommand("printf ok > /dev/null; printf bad > /etc/nexagent-blocked")?.reason, "redirect writes into protected system roots");

    const blocked = executeInternalTool(session, {
      name: "shell_command",
      arguments: {
        command: "printf bad > /etc/nexagent-blocked",
      },
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.output, /shell policy blocked command/);
    assert.match(blocked.output, /reason: redirect writes into protected system roots/);
    assert.match(blocked.output, /source: shell_command/);
    assert.match(blocked.output, /safer: Use write_file\/apply_patch inside workspace/);
    assert.equal(session.operationControls.lastShellBlocker?.reason, "redirect writes into protected system roots");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool shows bounded git diff for changed repo file", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-diff-"));

  try {
    const session = createSession(cwd);
    session.repo.vcs = "git";
    session.repo.branch = "main";
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(path.join(cwd, "src", "note.txt"), "before\n", "utf8");
    executeInternalTool(session, {
      name: "shell_command",
      arguments: { command: "git init -q && git config user.email test@example.com && git config user.name test && git add src/note.txt && git commit -qm init && printf 'after\\n' > src/note.txt" },
    });

    const result = executeInternalTool(session, {
      name: "git_diff",
      arguments: { path: "src/note.txt" },
    });

    assert.equal(result.ok, true);
    assert.equal(result.tool, "git_diff");
    assert.match(result.output, /diff --git a\/src\/note.txt b\/src\/note.txt/);
    assert.match(result.output, /-before/);
    assert.match(result.output, /\+after/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool blocks protected system shell writes and caps long output", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-shell-guard-"));

  try {
    const session = createSession(cwd);

    const blocked = executeInternalTool(session, {
      name: "shell_command",
      arguments: {
        command: "rm -rf /etc/nexagent-blocked",
      },
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.output, /shell policy blocked command/);
    assert.match(blocked.output, /reason: recursive remove targets protected system roots/);

    const capped = executeInternalTool(session, {
      name: "shell_command",
      arguments: {
        command: "seq 1 200",
      },
    });
    assert.equal(capped.ok, true);
    assert.match(capped.output, /^1\n2\n3/m);
    assert.match(capped.output, /\.\.\. output truncated \.\.\./);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("shell policy parser avoids quoted false positives and catches real operators", () => {
  assert.equal(analyzeBlockedShellCommand("printf '%s\\n' 'rm -rf .'"), null);
  assert.equal(analyzeBlockedShellCommand("echo 'git reset --hard'"), null);
  assert.equal(analyzeBlockedShellCommand("echo hi | bash"), null);
  assert.equal(analyzeBlockedShellCommand("git push origin main"), null);
  assert.equal(analyzeBlockedShellCommand("git reset --hard"), null);
  assert.equal(analyzeBlockedShellCommand("rm -rf ."), null);
  assert.equal(analyzeBlockedShellCommand("printf bad > /etc/nexagent-blocked")?.reason, "redirect writes into protected system roots");
  assert.equal(analyzeBlockedShellCommand("rm -rf /etc/nexagent-blocked")?.reason, "recursive remove targets protected system roots");
});

test("executeInternalTool honors bounded shell timeout argument", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-shell-timeout-"));

  try {
    const session = createSession(cwd);
    const result = executeInternalTool(session, {
      name: "shell_command",
      arguments: {
        command: "sleep 1",
        timeoutMs: 500,
      },
    });

    assert.equal(result.ok, false);
    assert.match(result.output, /shell timed out after 500ms/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool blocks protected system shell while yolo mode is active", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-yolo-shell-guard-"));

  try {
    const session = createSession(cwd);
    session.operationControls.yoloMode = true;
    session.operationControls.requireApprovalForGuarded = false;

    const blocked = executeInternalTool(session, {
      name: "shell_command",
      arguments: {
        command: "rm -rf /etc/nexagent-blocked",
      },
    });

    assert.equal(blocked.ok, false);
    assert.match(blocked.output, /shell policy blocked command/);
    assert.match(blocked.output, /reason: recursive remove targets protected system roots/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool saves Archivist memory and checkpoint with bounded lineage", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-archivist-"));

  try {
    const session = createSession(cwd);
    session.archivist.enabled = true;
    session.archivist.boundary = "bounded-write";
    session.archivist.storagePath = path.join(cwd, ".nexagent", "archivist.json");

    const saveResult = await executeInternalToolAsync(session, {
      name: "archivist_save",
      arguments: {
        summary: "transport fix",
        content: "codex backend requires account id header",
        tags: ["codex", "auth"],
      },
    });
    assert.equal(saveResult.ok, true);
    assert.match(saveResult.output, /saved memory; entries=1/);
    assert.equal(session.archivist.writes.action, "save");

    const checkpointResult = await executeInternalToolAsync(session, {
      name: "archivist_checkpoint",
      arguments: {
        reason: "phase handoff",
      },
    });
    assert.equal(checkpointResult.ok, true);
    assert.match(checkpointResult.output, /saved checkpoint; entries=2/);
    assert.equal(session.archivist.writes.action, "checkpoint");
    assert.match(session.archivist.writes.preview ?? "", /\[checkpoint\]/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool merges repeated Archivist memory into canonical recurrence", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-archivist-recurrence-"));

  try {
    const session = createSession(cwd);
    session.archivist.enabled = true;
    session.archivist.boundary = "bounded-write";
    session.archivist.storagePath = path.join(cwd, ".nexagent", "archivist.json");

    const first = await executeInternalToolAsync(session, {
      name: "archivist_save",
      arguments: {
        summary: "repeat memory",
        content: "same bounded content",
        tags: ["phase72"],
      },
    });
    const second = await executeInternalToolAsync(session, {
      name: "archivist_save",
      arguments: {
        summary: "repeat memory",
        content: "same bounded content",
        tags: ["phase72"],
      },
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.match(second.output, /entries=1/);
    assert.match(second.output, /seen=2/);

    const raw = JSON.parse(await readFile(session.archivist.storagePath, "utf8")) as { entries: Array<{ seenCount?: number; firstSeen?: string; lastSeen?: string }> };
    assert.equal(raw.entries.length, 1);
    assert.equal(raw.entries[0]?.seenCount, 2);
    assert.ok(raw.entries[0]?.firstSeen);
    assert.ok(raw.entries[0]?.lastSeen);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool exposes LSP status without starting a service", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-lsp-status-"));

  try {
    const session = createSession(cwd);
    const result = executeInternalTool(session, {
      name: "lsp_status",
      arguments: {},
    });

    assert.equal(result.ok, true);
    assert.match(result.output, /^lsp$/m);
    assert.match(result.output, /^enabled: false$/m);
    assert.match(result.output, /^source: disabled$/m);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("file access updates bounded LSP problem cache", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-lsp-touch-"));

  try {
    await writeFile(path.join(cwd, "sample.ts"), "export function alpha() {}\n// TODO inspect me\n", "utf8");
    const session = createSession(cwd);
    session.lsp.enabled = true;

    const read = executeInternalTool(session, {
      name: "read_file",
      arguments: {
        path: "sample.ts",
      },
    });
    assert.equal(read.ok, true);

    const status = executeInternalTool(session, {
      name: "lsp_status",
      arguments: {},
    });
    assert.equal(status.ok, true);
    assert.match(status.output, /^touchedFiles: 1$/m);
    assert.match(status.output, /^problems: 1$/m);
    assert.match(status.output, /^lastTouched: sample.ts$/m);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeInternalTool indexes bounded LSP symbol summaries into Archivist when enabled", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-lsp-symbols-"));

  try {
    await writeFile(path.join(cwd, "sample.ts"), "export function alpha() { return 1; }\nclass Beta {}\n", "utf8");
    const session = createSession(cwd);
    session.lsp.enabled = true;
    session.lsp.indexArchivist = true;
    session.archivist.enabled = true;
    session.archivist.boundary = "bounded-write";
    session.archivist.storagePath = path.join(cwd, ".nexagent", "archivist.json");

    const result = await executeInternalToolAsync(session, {
      name: "lsp_symbols",
      arguments: {
        path: "sample.ts",
      },
    });

    assert.equal(result.ok, true);
    assert.match(result.output, /^lsp symbols$/m);
    assert.match(result.output, /function alpha/);
    assert.match(result.output, /class Beta/);

    const raw = JSON.parse(await readFile(session.archivist.storagePath, "utf8")) as { entries: Array<{ type?: string; content?: string }> };
    assert.equal(raw.entries.length, 1);
    assert.equal(raw.entries[0]?.type, "code-symbols");
    assert.match(raw.entries[0]?.content ?? "", /lsp symbols/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("async LSP symbols use configured JSON-RPC server when available", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-lsp-jsonrpc-"));

  try {
    const serverPath = path.join(cwd, "fake-lsp.mjs");
    await writeFile(serverPath, `
let buffer = Buffer.alloc(0);
function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body);
}
function handle(message) {
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { capabilities: { documentSymbolProvider: true } } });
    return;
  }
  if (message.method === "textDocument/documentSymbol") {
    send({ jsonrpc: "2.0", id: message.id, result: [
      { name: "ServerAlpha", kind: 12, range: { start: { line: 1, character: 0 }, end: { line: 1, character: 12 } }, selectionRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 12 } } }
    ] });
  }
}
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd < 0) break;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length: (\\d+)/i.exec(header);
    if (!match) break;
    const length = Number(match[1]);
    const start = headerEnd + 4;
    const end = start + length;
    if (buffer.length < end) break;
    handle(JSON.parse(buffer.slice(start, end).toString("utf8")));
    buffer = buffer.slice(end);
  }
});
`, "utf8");
    await chmod(serverPath, 0o755);
    await writeFile(path.join(cwd, "sample.ts"), "export function fallback() {}\n", "utf8");
    const session = createSession(cwd);
    session.lsp.enabled = true;
    session.lsp.command = process.execPath;
    session.lsp.args = [serverPath];

    const result = await executeInternalToolAsync(session, {
      name: "lsp_symbols",
      arguments: {
        path: "sample.ts",
      },
    });

    assert.equal(result.ok, true);
    assert.match(result.output, /^source: language-server$/m);
    assert.match(result.output, /function ServerAlpha line=2/);

    const status = executeInternalTool(session, {
      name: "lsp_status",
      arguments: {},
    });
    assert.equal(status.ok, true);
    assert.match(status.output, /^running: true$/m);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("lsp_navigation tool returns bounded Pi Lens-style references", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-lsp-navigation-"));

  try {
    await writeFile(path.join(cwd, "sample.ts"), "export function alpha() {}\nalpha();\n", "utf8");
    const session = createSession(cwd);
    session.lsp.enabled = true;

    const result = await executeInternalToolAsync(session, {
      name: "lsp_navigation",
      arguments: {
        operation: "references",
        filePath: "sample.ts",
        line: 1,
        character: 17,
      },
    });

    assert.equal(result.ok, true);
    assert.match(result.output, /^lsp navigation$/m);
    assert.match(result.output, /^operation: references$/m);
    assert.match(result.output, /reference alpha sample\.ts:1:17/);
    assert.match(result.output, /reference alpha sample\.ts:2:1/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("lsp_navigation tool uses JSON-RPC definition when server is available", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-lsp-navigation-server-"));

  try {
    const serverPath = path.join(cwd, "fake-lsp-nav.mjs");
    await writeFile(serverPath, `
let buffer = Buffer.alloc(0);
function send(message) {
  const body = JSON.stringify(message);
  process.stdout.write("Content-Length: " + Buffer.byteLength(body) + "\\r\\n\\r\\n" + body);
}
function handle(message) {
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: { capabilities: { definitionProvider: true, hoverProvider: true } } });
    return;
  }
  if (message.method === "textDocument/definition") {
    send({ jsonrpc: "2.0", id: message.id, result: { uri: "file://${cwd.replace(/\\/g, "/")}/sample.ts", range: { start: { line: 0, character: 16 }, end: { line: 0, character: 21 } } } });
    return;
  }
  if (message.method === "textDocument/hover") {
    send({ jsonrpc: "2.0", id: message.id, result: { contents: { value: "function alpha(): void" } } });
  }
}
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\\r\\n\\r\\n");
    if (headerEnd < 0) break;
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length: (\\d+)/i.exec(header);
    if (!match) break;
    const length = Number(match[1]);
    const start = headerEnd + 4;
    const end = start + length;
    if (buffer.length < end) break;
    handle(JSON.parse(buffer.slice(start, end).toString("utf8")));
    buffer = buffer.slice(end);
  }
});
`, "utf8");
    await chmod(serverPath, 0o755);
    await writeFile(path.join(cwd, "sample.ts"), "export function alpha() {}\nalpha();\n", "utf8");
    const session = createSession(cwd);
    session.lsp.enabled = true;
    session.lsp.command = process.execPath;
    session.lsp.args = [serverPath];

    const result = await executeInternalToolAsync(session, {
      name: "lsp_navigation",
      arguments: {
        operation: "definition",
        filePath: "sample.ts",
        line: 2,
        character: 1,
      },
    });

    assert.equal(result.ok, true);
    assert.match(result.output, /^operation: definition$/m);
    assert.match(result.output, /location sample\.ts sample\.ts:1:17/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("write tools enforce read guard, secrets guard, and JSON formatting", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-quality-hooks-"));

  try {
    const session = createSession(cwd);
    await writeFile(path.join(cwd, "existing.ts"), "export const value = 1;\n", "utf8");

    const blocked = executeInternalTool(session, {
      name: "apply_patch",
      arguments: { path: "existing.ts", find: "1", replace: "2" },
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.output, /read guard blocked existing\.ts/);

    const read = executeInternalTool(session, { name: "read_file", arguments: { path: "existing.ts" } });
    assert.equal(read.ok, true);

    await writeFile(path.join(cwd, "existing.ts"), "export const value = 1;\n// external\n", "utf8");
    const stale = executeInternalTool(session, {
      name: "apply_patch",
      arguments: { path: "existing.ts", find: "1", replace: "2" },
    });
    assert.equal(stale.ok, false);
    assert.match(stale.output, /file changed since last read/);

    const secret = executeInternalTool(session, {
      name: "write_file",
      arguments: { path: "secret.txt", content: "token=sk-12345678901234567890123456789012" },
    });
    assert.equal(secret.ok, false);
    assert.match(secret.output, /secrets guard blocked write/);

    const json = executeInternalTool(session, {
      name: "write_file",
      arguments: { path: "config.json", content: "{\"b\":2,\"a\":1}" },
    });
    assert.equal(json.ok, true);
    assert.equal(await readFile(path.join(cwd, "config.json"), "utf8"), "{\n  \"b\": 2,\n  \"a\": 1\n}\n");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("Archivist stores and recalls failure recovery playbooks", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-failure-playbook-"));

  try {
    const session = createSession(cwd);
    session.archivist.enabled = true;
    session.archivist.boundary = "bounded-write";
    session.archivist.storagePath = path.join(cwd, ".nexagent", "archivist.json");
    session.archivist.storageExists = true;

    const stored = await rememberArchivistFailure(session, {
      toolName: "lsp_symbols",
      failureClass: "path_not_found",
      message: "sample.ts: no such file",
      recoveryHint: "Retry with a project-local file path after list_dir confirms it exists.",
    });
    assert.equal(stored?.entryCount, 1);

    await applyArchivistRetrieval(session, "lsp_symbols failed with path error, how recover?");

    assert.equal(session.archivist.retrieval.used, true);
    assert.equal(session.archivist.retrieval.sourceCategory, "failure-playbook");
    assert.match(session.archivist.retrieval.preview ?? "", /lsp_symbols failed: path_not_found/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ask_user_question waits for pending user answer and returns envelope", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-ask-user-"));

  try {
    const session = createSession(cwd);
    const pending = executeInternalToolAsync(session, {
      name: "ask_user_question",
      arguments: {
        questions: [{
          question: "Which path should we take?",
          header: "Path",
          options: [
            { label: "Fast (Recommended)", description: "Ship smallest useful change." },
            { label: "Full port", description: "Spend more time for parity." },
          ],
        }],
      },
    });

    for (let index = 0; index < 20 && !session.operationControls.pendingQuestionnaire; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(session.operationControls.pendingQuestionnaire?.questions[0]?.header, "Path");
    session.operationControls.pendingQuestionnaire!.response = {
      cancelled: false,
      answers: [{
        questionIndex: 0,
        question: "Which path should we take?",
        kind: "option",
        answer: "Fast (Recommended)",
      }],
    };

    const result = await pending;
    assert.equal(result.ok, true);
    assert.match(result.output, /User answered ask_user_question/);
    assert.match(result.output, /Fast \(Recommended\)/);
    assert.equal(session.operationControls.pendingQuestionnaire, null);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ask_user_question clamps oversized option lists instead of failing", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-ask-user-clamp-"));

  try {
    const session = createSession(cwd);
    const pending = executeInternalToolAsync(session, {
      name: "ask_user_question",
      arguments: {
        questions: [{
          question: "Which gray area first?",
          header: "Phase 73",
          options: [
            { label: "A", description: "One." },
            { label: "B", description: "Two." },
            { label: "C", description: "Three." },
            { label: "D", description: "Four." },
            { label: "E", description: "Five." },
          ],
        }],
      },
    });

    for (let index = 0; index < 20 && !session.operationControls.pendingQuestionnaire; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(session.operationControls.pendingQuestionnaire?.questions[0]?.options.length, 4);
    assert.equal(session.operationControls.pendingQuestionnaire?.questions[0]?.options[3]?.label, "D");
    session.operationControls.pendingQuestionnaire!.response = {
      cancelled: false,
      answers: [{
        questionIndex: 0,
        question: "Which gray area first?",
        kind: "option",
        answer: "D",
      }],
    };

    const result = await pending;
    assert.equal(result.ok, true);
    assert.match(result.output, /Which gray area first\? -> D/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
