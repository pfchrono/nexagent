import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { executeInternalTool, executeInternalToolAsync } from "../src/runtime/tools.js";
import type { RuntimeSession } from "../src/runtime/session.js";

function createSession(cwd: string): RuntimeSession {
  return {
    id: "session_test",
    startedAt: "2025-01-01T00:00:00.000Z",
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
    assert.deepEqual(writeResult, {
      ok: true,
      tool: "write_file",
      output: "wrote notes.txt (11 chars)",
    });
    assert.equal(await readFile(filePath, "utf8"), "alpha\nbeta\n");

    const patchResult = executeInternalTool(session, {
      name: "apply_patch",
      arguments: {
        path: "notes.txt",
        find: "beta",
        replace: "gamma",
      },
    });
    assert.deepEqual(patchResult, {
      ok: true,
      tool: "apply_patch",
      output: "patched notes.txt (1 match)",
    });
    assert.equal(await readFile(filePath, "utf8"), "alpha\ngamma\n");
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

test("executeInternalTool blocks destructive shell and caps long output", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-shell-guard-"));

  try {
    const session = createSession(cwd);

    const blocked = executeInternalTool(session, {
      name: "shell_command",
      arguments: {
        command: "rm -rf .",
      },
    });
    assert.equal(blocked.ok, false);
    assert.match(blocked.output, /shell policy blocked command; destructive pattern matched/);

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

test("executeInternalTool blocks destructive shell while yolo mode is active", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-tools-yolo-shell-guard-"));

  try {
    const session = createSession(cwd);
    session.operationControls.yoloMode = true;
    session.operationControls.requireApprovalForGuarded = false;

    const blocked = executeInternalTool(session, {
      name: "shell_command",
      arguments: {
        command: "rm -rf .",
      },
    });

    assert.equal(blocked.ok, false);
    assert.match(blocked.output, /shell policy blocked command; destructive pattern matched/);
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
