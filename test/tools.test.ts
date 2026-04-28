import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { classifyInternalToolRisk, executeInternalTool, executeInternalToolAsync } from "../src/runtime/tools.js";
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
