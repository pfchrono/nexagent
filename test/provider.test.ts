import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { invokeCodexChatGptHttpTransport, resolveCodexAuthJson } from "../src/provider/codex-chatgpt-http.js";
import { executeProviderRequest, type ProviderRequest } from "../src/provider.js";
import { createDefaultProviderRegistry } from "../src/provider/registry.js";
import { createRuntimeExtensionHost } from "../src/runtime/extensions.js";
import { initializeRuntimeDebug } from "../src/runtime/debug.js";
import { resolveRuntimeApproval, type RuntimeSession } from "../src/runtime/session.js";

function createSession(provider = "codex", model: string | null = "gpt-5.4"): RuntimeSession {
  return {
    id: "session_test",
    startedAt: "2025-01-01T00:00:00.000Z",
    product: "nexagent",
    provider,
    providerRegistry: createDefaultProviderRegistry(),
    providerRouting: {
      fallback: {
        policy: "require-open-spec",
        silentProviderSwitch: false,
      },
      modelSelection: {
        activeProvider: provider,
        configuredModels: model ? { [provider]: model } : {},
      },
      transport: {},
    },
    providerTransport: {
      executor: "codex",
      adapter: "codex-cli-exec",
      mode: "cli-exec",
      authSource: "codex-login",
      authGate: "ready",
      activeProvider: provider,
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
    cwd: "/repo",
    repo: {
      root: "/repo",
      name: "repo",
      vcs: "git",
      branch: "main",
      freshness: {
        status: "up-to-date",
        tracking: "origin/main",
        ahead: 0,
        behind: 0,
        dirty: false,
        needsPull: false,
        checkedAt: "2025-01-01T00:00:00.000Z",
      },
    },
    toolPolicy: {
      mode: "repo-local-guarded",
      allowedRoots: ["/repo"],
      protectedRoots: ["/etc"],
      shell: "limited",
      writes: "guarded",
      deletes: "blocked",
    },
    mcpServers: [],
    enabledMcpServers: [],
    mcpRegistry: {
      serverNames: [],
      servers: {},
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
      pendingQuestionnaire: null,
      lastDecision: null,
      cancelRequested: false,
      activeAbortController: null,
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
      types: [
        { name: "general-purpose", description: "General-purpose autonomous agent", prompt: "general", tools: "all", source: "default" },
        { name: "Explore", description: "Fast read-only codebase exploration", prompt: "explore", tools: "read", source: "default" },
      ],
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

test("executeProviderRequest returns codex output", async () => {
  let capturedPrompt = "";

  const result = await executeProviderRequest(
    {
      session: createSession(),
      prompt: "say hi",
    },
    {
      exec: async (request) => {
        capturedPrompt = request.prompt;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "hello world\n",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.match(capturedPrompt, /## Identity/);
  assert.match(capturedPrompt, /__NEXAGENT_PROMPT_DYNAMIC_BOUNDARY__/);
  assert.match(capturedPrompt, /## Current Invocation/);
  assert.match(capturedPrompt, /## Current Invocation\n- say hi/);
  assert.match(capturedPrompt, /## Tool Routing/);

  assert.deepEqual(result, {
    ok: true,
    provider: "codex",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    output: "hello world",
  });
});

test("executeProviderRequest records model-authored intent and strips tag from final output", async () => {
  const session = createSession();

  const result = await executeProviderRequest(
    {
      session,
      prompt: "say hi",
    },
    {
      exec: async (request) => {
        assert.match(request.prompt, /<nexagent_intent>\.\.\.<\/nexagent_intent>/);
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "<nexagent_intent>Inspect request, then answer briefly.</nexagent_intent>\nhello world\n",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.output, "hello world");
  assert.equal(
    session.events.find((event) => event.summary === "model turn intent")?.detail,
    "Inspect request, then answer briefly.",
  );
});

test("executeProviderRequest compacts final output when caveman mode is active", async () => {
  const session = createSession();
  session.commandModes.cavemanMode = true;

  const result = await executeProviderRequest(
    {
      session,
      prompt: "summarize",
    },
    {
      exec: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        output: "You should just use the smaller helper in order to reduce the token count.\n",
      }),
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.output, "use smaller helper to reduce token count.");
  assert.equal(
    session.events.find((event) => event.summary === "assistant response completed")?.detail,
    "use smaller helper to reduce token count.",
  );
});

test("executeProviderRequest compacts raw evidence dumps in final output", async () => {
  const session = createSession();
  const rawOutput = [
    ".planning/phases/72/72-01-PLAN.md 1000",
    ".planning/phases/72/72-02-PLAN.md 1000",
    ".planning/phases/72/72-03-PLAN.md 1000",
    ".planning/phases/72/72-04-SUMMARY.md 1000",
    ".planning/phases/72/72-05-PLAN.md 1000",
    ".planning/phases/72/72-06-PLAN.md 1000",
    ".planning/phases/72/72-07-SUMMARY.md 1000",
    ".planning/phases/73/73-01-PLAN.md 1000",
    ".planning/phases/73/73-01-SUMMARY.md 1000",
    ".planning/phases/74/74-01-PLAN.md 1000",
    ".planning/research/gsd-explore-v1.md 1000",
    ".planning/todos/pending/context-compaction.md 1000",
    "--- PHASE ROOT TREE ---",
    "Step 5",
    'Tool call: {"name":"todo"}',
    "Tool result (ok):",
    "todos",
    "[>] todo-1 Detect current GSD state",
    "[ ] todo-2 Execute routed workflow",
    "[ ] todo-3 Verify result and report compact evidence",
  ].join("\n");

  const result = await executeProviderRequest(
    {
      session,
      prompt: "summarize output",
    },
    {
      exec: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        output: `${rawOutput}\n`,
      }),
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.match(result.output, /assistant output compacted/);
  assert.doesNotMatch(result.output, /72-01-PLAN/);
  assert.match(result.output, /\[>\] todo-1 Detect current GSD state/);
  const assistantDetail = session.events.find((event) => event.summary === "assistant response completed")?.detail ?? "";
  assert.match(assistantDetail, /assistant output compacted/);
  assert.doesNotMatch(assistantDetail, /72-01-PLAN/);
});

test("executeProviderRequest records model intent before executing first tool", async () => {
  const session = createSession();

  const result = await executeProviderRequest(
    {
      session,
      prompt: "read package",
    },
    {
      exec: async (request) => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        output: request.prompt.includes("tool todo completed")
          ? "Read package evidence."
          : '<nexagent_intent>Track task before answering.</nexagent_intent>\n<nexagent_tool_call>{"name":"todo","arguments":{"action":"create","subject":"Answer request","status":"in_progress"}}</nexagent_tool_call>',
      }),
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  const intentIndex = session.events.findIndex((event) => event.summary === "model turn intent");
  const toolIndex = session.events.findIndex((event) => event.summary === "tool todo completed");
  assert.notEqual(intentIndex, -1);
  assert.notEqual(toolIndex, -1);
  assert.equal(intentIndex < toolIndex, true);
});

test("executeProviderRequest fires extension lifecycle and injects guidance", async () => {
  const session = createSession();
  const host = createRuntimeExtensionHost();
  const seen: string[] = [];
  host.handlers.set("agent_start", [() => {
    seen.push("agent_start");
  }]);
  host.handlers.set("before_agent_start", [() => {
    seen.push("before_agent_start");
    return { message: { content: "use extension tool first" } };
  }]);
  host.handlers.set("agent_end", [() => {
    seen.push("agent_end");
  }]);
  session.extensions = host;
  let capturedPrompt = "";

  const result = await executeProviderRequest(
    {
      session,
      prompt: "say hi",
    },
    {
      exec: async (request) => {
        capturedPrompt = request.prompt;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "hello world\n",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(seen, ["agent_start", "before_agent_start", "agent_end"]);
  assert.match(capturedPrompt, /Extension guidance:/);
  assert.match(capturedPrompt, /use extension tool first/);
});

test("executeProviderRequest lets message_end extension replace assistant output", async () => {
  const session = createSession();
  const host = createRuntimeExtensionHost();
  const seen: string[] = [];
  host.handlers.set("message_end", [(event) => {
    const payload = event as { output?: string; result?: { output?: string } };
    seen.push(payload.output ?? "missing");
    assert.equal(payload.result?.output, "hello world");
    return { message: { content: "extension override" } };
  }]);
  session.extensions = host;

  const result = await executeProviderRequest(
    {
      session,
      prompt: "say hi",
    },
    {
      exec: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        output: "hello world\n",
      }),
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(seen, ["hello world"]);
  assert.equal(result.ok ? result.output : "", "extension override");
});

test("executeProviderRequest keeps last message_end replacement", async () => {
  const session = createSession();
  const host = createRuntimeExtensionHost();
  host.handlers.set("message_end", [
    () => "first override",
    () => ({ output: "final override" }),
  ]);
  session.extensions = host;

  const result = await executeProviderRequest(
    {
      session,
      prompt: "say hi",
    },
    {
      exec: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        output: "hello world\n",
      }),
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.ok ? result.output : "", "final override");
});

test("executeProviderRequest fires extension tool_result", async () => {
  const session = createSession();
  const host = createRuntimeExtensionHost();
  const seen: string[] = [];
  host.handlers.set("tool_result", [(_event) => {
    const event = _event as { tool?: string };
    seen.push(event.tool ?? "missing");
  }]);
  session.extensions = host;
  let invocationCount = 0;

  const result = await executeProviderRequest(
    {
      session,
      prompt: "run pwd",
    },
    {
      exec: async () => {
        invocationCount += 1;
        if (invocationCount > 1) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "done\n",
          };
        }
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: '<nexagent_tool_call>{"name":"shell_command","arguments":{"command":"pwd"}}</nexagent_tool_call>\n',
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(seen, ["shell_command"]);
});

test("executeProviderRequest records full assistant event detail for long output", async () => {
  const session = createSession();
  const longOutput = `final response ${"x".repeat(240)}`;

  const result = await executeProviderRequest(
    {
      session,
      prompt: "summarize",
    },
    {
      exec: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        output: `${longOutput}\n`,
      }),
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  const assistantEvent = session.events.find((event) => event.kind === "assistant" && event.status === "completed");
  assert.equal(result.ok, true);
  assert.equal(assistantEvent?.detail, longOutput);
  assert.doesNotMatch(assistantEvent?.detail ?? "", /\.\.\.$/);
});


test("executeProviderRequest writes verbose debug input and output", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-debug-provider-"));
  const logPath = path.join(cwd, "provider.log");
  const session = createSession();
  session.debug = initializeRuntimeDebug({ enabled: true, verbose: true, debugFile: logPath });

  try {
    const result = await executeProviderRequest(
      {
        session,
        prompt: "say hi",
      },
      {
        exec: async () => ({
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "hello debug\n",
        }),
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(result.ok, true);
    const log = await readFile(logPath, "utf8");
    assert.match(log, /provider\.assembled_prompt/);
    assert.match(log, /provider\.invocation/);
    assert.match(log, /say hi/);
    assert.match(log, /hello debug/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest fails when provider exits zero but assistant text is empty", async () => {
  const result = await executeProviderRequest({
    session: createSession(),
    prompt: "say hi",
  }, {
    exec: async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      output: "",
    }),
    http: async () => {
      throw new Error("http should not be used");
    },
    codexHttp: async () => {
      throw new Error("codex-http should not be used");
    },
  });

  assert.deepEqual(result, {
    ok: false,
    provider: "codex",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    code: "transport_error",
    message: "provider returned empty output",
    detail: "provider finished with exit code 0 but produced no assistant text.",
  });
});

test("executeProviderRequest fails when native transport exits zero but assistant text is empty", async () => {
  const session = createSession("openai", "gpt-5.4");
  session.providerTransport.executor = "fetch";
  session.providerTransport.adapter = "openai-http-responses";
  session.providerTransport.mode = "http-responses";
  session.providerTransport.authSource = "openai-api-key";
  session.providerTransport.authGate = "ready";
  session.providerTransport.openaiBaseUrl = "https://api.openai.test/v1";

  const result = await executeProviderRequest({
    session,
    prompt: "say hi",
  }, {
    exec: async () => {
      throw new Error("exec should not be used");
    },
    http: async () => ({
      exitCode: 0,
      stdout: "",
      stderr: "",
      output: "",
      raw: {
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "" }],
          },
        ],
      },
    }),
    codexHttp: async () => {
      throw new Error("codex-http should not be used");
    },
  });

  assert.deepEqual(result, {
    ok: false,
    provider: "openai",
    model: "gpt-5.4",
    transport: "openai",
    adapter: "openai-http-responses",
    fallbackApplied: false,
    code: "transport_error",
    message: "provider returned empty output",
    detail: "provider finished with exit code 0 but produced no assistant text.",
  });
});

test("executeProviderRequest records applied steer history at provider boundary", async () => {
  let capturedPrompt = "";
  const session = createSession();
  session.operationControls.steerMessage = "use terse answer";
  session.operationControls.steerState = "queued";

  const result = await executeProviderRequest(
    {
      session,
      prompt: "say hi",
    },
    {
      exec: async (request) => {
        capturedPrompt = request.prompt;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "hello world\n",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.match(capturedPrompt, /Operator steer:\n- use terse answer/);
  assert.equal(session.operationControls.steerMessage, null);
  assert.equal(session.operationControls.steerState, "applied");
  assert.equal(session.operationControls.lastAppliedSteer, "use terse answer");
  assert.match(
    session.operationControls.steerHistory.map((entry) => `${entry.status}:${entry.message}${entry.detail ? ` (${entry.detail})` : ""}`).join(" | "),
    /applied:use terse answer \(before provider step 1\)/,
  );
});

test("executeProviderRequest executes internal tool loop before final answer", async () => {
  const session = createSession();
  const prompts: string[] = [];

  const result = await executeProviderRequest(
    {
      session,
      prompt: "read package file then answer",
    },
    {
      exec: async (request) => {
        prompts.push(request.prompt);
        if (prompts.length === 1) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: '<nexagent_tool_call>{"name":"git_status","arguments":{}}</nexagent_tool_call>',
          };
        }

        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "repo clean",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(prompts.length, 2);
  assert.match(prompts[1] ?? "", /Internal tool transcript:/);
  assert.match(prompts[1] ?? "", /"name":"git_status"/);
  assert.match(prompts[1] ?? "", /Tool result \(ok\):/);
  assert.match(prompts[1] ?? "", /repo: repo/);
  assert.deepEqual(result, {
    ok: true,
    provider: "codex",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    output: "repo clean",
  });
});

test("executeProviderRequest gives recovery hint after blocked shell tool", async () => {
  const session = createSession();
  const prompts: string[] = [];

  const result = await executeProviderRequest(
    {
      session,
      prompt: "clean files safely",
    },
    {
      exec: async (request) => {
        prompts.push(request.prompt);
        if (prompts.length === 1) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: '<nexagent_tool_call>{"name":"shell_command","arguments":{"command":"rm -rf /etc/nexagent-blocked"}} </nexagent_tool_call>',
          };
        }

        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "Blocked shell. Use apply_patch for scoped edits.",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.match(prompts[1] ?? "", /shell policy blocked command/);
  assert.match(prompts[1] ?? "", /Recovery hint:/);
  assert.match(prompts[1] ?? "", /Use write_file\/apply_patch\/batch_edit/);
  assert.equal(session.operationControls.lastShellBlocker?.reason, "recursive remove targets protected system roots");
  const diagnostic = session.events.find((event) => event.kind === "control" && event.summary.includes("tool.blocked"));
  assert.match(diagnostic?.detail ?? "", /failure_class=policy_blocked/);
  assert.equal(session.events.some((event) => event.kind === "control" && event.summary.includes("tool.failed") && /policy_blocked/.test(event.detail ?? "")), false);
});

test("executeProviderRequest nudges todo for multi-stage GSD work", async () => {
  const session = createSession();
  const prompts: string[] = [];

  const result = await executeProviderRequest(
    {
      session,
      prompt: "continue GSD workflow and finish next slice",
    },
    {
      exec: async (request) => {
        prompts.push(request.prompt);
        if (prompts.length === 1) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "I will continue the workflow.",
          };
        }
        if (prompts.length === 2) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: '<nexagent_tool_call>{"name":"todo","arguments":{"action":"create","subject":"Inspect current GSD state","status":"in_progress"}}</nexagent_tool_call>',
          };
        }
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "Todo created; next step is inspect current state.",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.match(prompts[1] ?? "", /needs visible task tracking/);
  assert.deepEqual(session.todos.tasks, []);
  assert.equal(session.events.some((event) => event.summary === "required todo evidence nudge applied"), true);
  assert.equal(session.events.some((event) => event.summary === "tool todo completed"), true);
});

test("executeProviderRequest allows blocker report without todo evidence", async () => {
  const session = createSession();

  const result = await executeProviderRequest(
    {
      session,
      prompt: "continue GSD workflow and finish next slice",
    },
    {
      exec: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        output: "Blocked: STATE.md is inconsistent and python -m gsd is unavailable.",
      }),
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.match(result.output, /Blocked: STATE\.md is inconsistent/);
  assert.equal(session.events.some((event) => event.summary === "required todo evidence gate blocked assistant response"), false);
});

test("executeProviderRequest gives recovery hint after missing path tool failure", async () => {
  const session = createSession();
  const prompts: string[] = [];

  const result = await executeProviderRequest(
    {
      session,
      prompt: "read missing file then recover",
    },
    {
      exec: async (request) => {
        prompts.push(request.prompt);
        if (prompts.length === 1) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: '<nexagent_tool_call>{"name":"read_file","arguments":{"path":"missing.ts"}}</nexagent_tool_call>',
          };
        }
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "Missing path noted.",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.match(prompts[1] ?? "", /Recovery hint:/);
  assert.match(prompts[1] ?? "", /Use search_files\/list_dir\/nexsight_gather/);
});

test("executeProviderRequest returns partial result when tool budget is exhausted", async () => {
  const session = createSession();
  const prompts: string[] = [];

  const result = await executeProviderRequest(
    {
      session,
      prompt: "keep checking git forever",
    },
    {
      exec: async (request) => {
        prompts.push(request.prompt);
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: '<nexagent_tool_call>{"name":"git_status","arguments":{}}</nexagent_tool_call>',
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(prompts.length, 101);
  assert.equal(prompts.some((prompt) => /Tool budget is almost exhausted/.test(prompt)), true);
  assert.match(prompts[100] ?? "", /Do not call more tools/);
  assert.match(result.output, /Tool budget exhausted before final assistant answer/);
  assert.match(result.output, /Partial evidence from completed tools/);
  assert.match(result.output, /assistant output compacted/);
  assert.doesNotMatch(result.output, /Tool call: \{"name":"git_status","arguments":\{\}\}/);
  assert.equal(
    session.events.some((event) => event.kind === "control" && event.summary === "tool budget fallback returned partial result"),
    true,
  );
});

test("executeProviderRequest forces final synthesis at tool budget boundary", async () => {
  const session = createSession();
  const prompts: string[] = [];

  const result = await executeProviderRequest(
    {
      session,
      prompt: "inspect until enough evidence then summarize",
    },
    {
      exec: async (request) => {
        prompts.push(request.prompt);
        if (prompts.length <= 100) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: '<nexagent_tool_call>{"name":"git_status","arguments":{}}</nexagent_tool_call>',
          };
        }
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "Final summary from completed tool evidence.",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.deepEqual(result, {
    ok: true,
    provider: "codex",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    output: "Final summary from completed tool evidence.",
  });
  assert.equal(prompts.length, 101);
  assert.match(prompts[100] ?? "", /Do not call more tools/);
  assert.match(prompts[100] ?? "", /do not repeat the full diff/);
  assert.match(prompts[100] ?? "", /Do not describe the runtime response\/tool boundary as a blocker/);
  assert.equal(
    session.events.some((event) => event.kind === "control" && event.summary === "tool budget final synthesis requested"),
    true,
  );
});

test("executeProviderRequest allows larger single-cycle tool budget", async () => {
  const session = createSession();
  const prompts: string[] = [];

  const result = await executeProviderRequest(
    {
      session,
      prompt: "use a few tools then answer",
    },
    {
      exec: async (request) => {
        prompts.push(request.prompt);
        if (prompts.length <= 8) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: '<nexagent_tool_call>{"name":"git_status","arguments":{}}</nexagent_tool_call>',
          };
        }
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "continued within larger budget",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.deepEqual(result, {
    ok: true,
    provider: "codex",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    output: "continued within larger budget",
  });
  assert.equal(prompts.length, 9);
  assert.equal(
    session.events.some((event) => event.kind === "control" && event.summary === "tool budget continuation cycle started"),
    false,
  );
});

test("executeProviderRequest accepts attribute-style internal tool calls", async () => {
  const session = createSession();
  const result = await executeProviderRequest(
    {
      session,
      prompt: "check git",
    },
    {
      exec: async (request) => {
        if (!request.prompt.includes("Internal tool transcript")) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: '<nexagent_tool_call name="git_status" arguments="{}"></nexagent_tool_call>',
          };
        }

        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "repo clean",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.output, "repo clean");
  assert.equal(
    session.events.some((event) => event.kind === "tool" && event.summary === "tool git_status completed"),
    true,
  );
});

test("executeProviderRequest accepts generic tool_call XML with argument children", async () => {
  const session = createSession();
  const result = await executeProviderRequest(
    {
      session,
      prompt: "check git",
    },
    {
      exec: async (request) => {
        if (!request.prompt.includes("Internal tool transcript")) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: '<tool_call name="git_status"><arg name="path">/home/pfchrono/code/nexagent</arg></tool_call>',
          };
        }

        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "repo status checked",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.output, "repo status checked");
  assert.equal(
    session.events.some((event) => event.kind === "tool" && event.summary === "tool git_status completed"),
    true,
  );
});

test("executeProviderRequest accepts generic tool_call JSON body and ignores adjacent extra calls", async () => {
  const session = createSession();
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-generic-json-tool-"));
  session.cwd = cwd;
  session.repo.root = cwd;
  session.toolPolicy.allowedRoots = [cwd];
  const targetPath = path.join(cwd, "target.txt");
  await writeFile(targetPath, "ok\n", "utf8");
  const outputs = [
    `<tool_call>{"name":"read_file","arguments":{"path":${JSON.stringify(targetPath)}}}</tool_call><tool_call>{"name":"list_dir","arguments":{"path":"."}}</tool_call>`,
    "done",
  ];
  const prompts: string[] = [];

  try {
    const result = await executeProviderRequest(
      {
        session,
        prompt: "read target file",
      },
      {
        exec: async (request) => {
          prompts.push(request.prompt);
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: outputs.shift() ?? "done",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.output, "done");
    assert.equal(prompts.length, 2);
    assert.match(prompts[1] ?? "", /Internal tool transcript:/);
    assert.match(prompts[1] ?? "", /"name":"read_file"/);
    assert.equal(
      session.events.some((event) => event.kind === "control" && event.summary === "malformed tool call nudge applied"),
      false,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest accepts bare internal tool XML tags", async () => {
  const session = createSession();
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-bare-tool-"));
  session.cwd = cwd;
  session.repo.root = cwd;
  session.toolPolicy.allowedRoots = [cwd];
  await writeFile(path.join(cwd, "progress.md"), "phase 70\n", "utf8");

  try {
    const result = await executeProviderRequest(
      {
        session,
        prompt: "read progress",
      },
      {
        exec: async (request) => {
          if (!request.prompt.includes("Internal tool transcript")) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: `<read_file path="${path.join(cwd, "progress.md")}" />`,
            };
          }

          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "progress checked",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.output, "progress checked");
    assert.equal(
      session.events.some((event) => event.kind === "tool" && event.summary === "tool read_file completed"),
      true,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest carries bounded tool findings into future prompts", async () => {
  const session = createSession();
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-tool-memory-"));
  session.cwd = cwd;
  session.repo.root = cwd;
  session.toolPolicy.allowedRoots = [cwd];
  await writeFile(path.join(cwd, "package.json"), "{\"name\":\"tool-memory\"}\n", "utf8");
  let secondPrompt = "";

  try {
    const first = await executeProviderRequest(
      {
        session,
        prompt: "inspect package",
      },
      {
        exec: async (request) => {
          if (!request.prompt.includes("Internal tool transcript")) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"list_dir","arguments":{"path":"."}}</nexagent_tool_call>',
            };
          }
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "done",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(first.ok, true);
    assert.equal(session.toolMemory.entries.length, 1);
    assert.equal(session.toolMemory.entries[0]?.tool, "list_dir");
    assert.match(session.toolMemory.entries[0]?.summary ?? "", /package\.json/);

    const second = await executeProviderRequest(
      {
        session,
        prompt: "what did we inspect?",
      },
      {
        exec: async (request) => {
          secondPrompt = request.prompt;
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "used remembered tool finding",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(second.ok, true);
    assert.match(secondPrompt, /Recent tool findings:/);
    assert.match(secondPrompt, /list_dir ok/);
    assert.match(secondPrompt, /package\.json/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest omits low-signal policy blocks from tool findings", async () => {
  const session = createSession();
  let secondPrompt = "";

  const first = await executeProviderRequest(
    {
      session,
      prompt: "try blocked shell",
    },
    {
      exec: async (request) => {
        if (!request.prompt.includes("Internal tool transcript")) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: '<nexagent_tool_call>{"name":"shell_command","arguments":{"command":"rm -rf /etc/demo"}}</nexagent_tool_call>',
          };
        }
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "blocked command handled",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(first.ok, true);
  assert.equal(session.toolMemory.entries.length, 0);

  const second = await executeProviderRequest(
    {
      session,
      prompt: "what happened?",
    },
    {
      exec: async (request) => {
        secondPrompt = request.prompt;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "no stale blocked command memory",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(second.ok, true);
  assert.doesNotMatch(secondPrompt, /Recent tool findings:/);
  assert.doesNotMatch(secondPrompt, /rm -rf/);
});

test("executeProviderRequest records safe tool failure class diagnostics", async () => {
  const session = createSession();
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-tool-failure-"));
  session.cwd = cwd;
  session.repo.root = cwd;
  session.toolPolicy.allowedRoots = [cwd];

  try {
    const result = await executeProviderRequest(
      {
        session,
        prompt: "read current directory as a file",
      },
      {
        exec: async (request) => {
          if (!request.prompt.includes("Internal tool transcript")) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"read_file","arguments":{}}</nexagent_tool_call>',
            };
          }

          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "read failed; need a concrete file path",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(result.ok, true);
    const diagnostic = session.events.find((event) => event.kind === "control" && event.summary.includes("tool.blocked"));
    assert.match(diagnostic?.detail ?? "", /failure_class=path_not_file/);
    assert.match(diagnostic?.detail ?? "", /argument_count=0/);
    assert.doesNotMatch(diagnostic?.detail ?? "", new RegExp(cwd.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest records MCP unavailable diagnostics with safe server metadata", async () => {
  const session = createSession();
  session.mcpRegistry = {
    serverNames: ["github"],
    servers: {
      github: { url: "https://example.invalid/mcp", startup_timeout_sec: 5 },
    },
    tools: [],
    statuses: [{
      name: "github",
      transport: "http",
      status: "configured",
      toolCount: 0,
      startupTimeoutMs: 5000,
      message: "http MCP transport not bridged yet",
    }],
    clients: new Map(),
  };

  const result = await executeProviderRequest(
    {
      session,
      prompt: "call github mcp",
    },
    {
      exec: async (request) => {
        if (!request.prompt.includes("Internal tool transcript")) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: '<nexagent_tool_call>{"name":"mcp_call","arguments":{"server":"github","tool":"list_issues","arguments":{"query":"raw user query should not be logged"}}}</nexagent_tool_call>',
          };
        }

        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "MCP unavailable; no result to report",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  const diagnostic = session.events.find((event) => event.kind === "control" && event.summary.includes("tool.mcp_unavailable"));
  assert.match(diagnostic?.detail ?? "", /failure_class=mcp_server_not_hydrated/);
  assert.match(diagnostic?.detail ?? "", /mcp_server=github/);
  assert.match(diagnostic?.detail ?? "", /mcp_tool=list_issues/);
  assert.match(diagnostic?.detail ?? "", /mcp_status=configured/);
  assert.match(diagnostic?.detail ?? "", /mcp_transport=http/);
  assert.doesNotMatch(diagnostic?.detail ?? "", /raw user query/);
});

test("executeProviderRequest repairs multiline JSON strings in tool markup", async () => {
  const session = createSession();
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-nexsight-"));
  session.cwd = cwd;
  session.repo.root = cwd;
  session.toolPolicy.allowedRoots = [cwd];
  const prompts: string[] = [];

  try {
    const result = await executeProviderRequest(
      {
        session,
        prompt: "run nexsight command",
      },
      {
        exec: async (request) => {
          prompts.push(request.prompt);
          if (prompts.length === 1) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: `<nexagent_tool_call>{"name":"nexsight_execute","arguments":{"code":"console.log('line-one')
console.log('line-two')"}} </nexagent_tool_call>`,
            };
          }

          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "done",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(prompts.length, 2);
    assert.match(prompts[1] ?? "", /Tool result \(ok\):/);
    assert.match(prompts[1] ?? "", /line-one/);
    assert.match(prompts[1] ?? "", /line-two/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest redirects explicit Nexsight requests away from generic tools", async () => {
  const session = createSession();
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-nexsight-policy-"));
  session.cwd = cwd;
  session.repo.root = cwd;
  session.toolPolicy.allowedRoots = [cwd];
  const prompts: string[] = [];

  try {
    const result = await executeProviderRequest(
      {
        session,
        prompt: "use nexsight to inspect the repo",
      },
      {
        exec: async (request) => {
          prompts.push(request.prompt);
          if (prompts.length === 1) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"list_dir","arguments":{"path":"."}}</nexagent_tool_call>',
            };
          }
          if (prompts.length === 2) {
            assert.match(request.prompt, /This task should use Nexsight/);
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"nexsight_execute","arguments":{"code":"console.log(\\"used-nexsight\\")"}}</nexagent_tool_call>',
            };
          }

          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "done",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(prompts.length, 3);
    assert.equal(
      session.events.some((event) => event.kind === "control" && event.summary === "nexsight tool nudge applied"),
      true,
    );
    assert.equal(
      session.events.some((event) => event.kind === "tool" && event.summary === "tool list_dir completed"),
      false,
    );
    assert.equal(
      session.events.some((event) => event.kind === "tool" && event.summary === "tool nexsight_execute completed"),
      true,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest preflights Nexsight evidence before provider response", async () => {
  const session = createSession();
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-required-nexsight-fallback-"));
  session.cwd = cwd;
  session.repo.root = cwd;
  session.toolPolicy.allowedRoots = [cwd];
  const prompts: string[] = [];

  try {
    await writeFile(path.join(cwd, "README.md"), "# Test Repo\n", "utf8");
    await Promise.all(
      Array.from({ length: 90 }, async (_, index) => {
        await writeFile(path.join(cwd, `sample-${String(index).padStart(2, "0")}.ts`), "export const value = 1;\n", "utf8");
      }),
    );
    const result = await executeProviderRequest(
      {
        session,
        prompt: "use Nexsight to inspect the repo and summarize layout",
      },
      {
        exec: async (request) => {
          prompts.push(request.prompt);
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: prompts.length === 1
              ? "Done - inspected repo layout and summarized it."
              : "Done - concise layout summary from repo inspection.",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0] ?? "", /Required Nexsight preflight evidence/);
    assert.match(prompts[0] ?? "", /README\.md/);
    if (result.ok) {
      assert.equal(result.output, "Done - inspected repo layout and summarized it.");
      assert.doesNotMatch(result.output, /unstructured output/);
    }
    assert.equal(
      session.events.some((event) => event.kind === "control" && event.summary === "required nexsight preflight started"),
      true,
    );
    assert.equal(
      session.events.some((event) => event.kind === "control" && event.summary === "required nexsight fallback started"),
      false,
    );
    assert.equal(
      session.events.some((event) => event.kind === "tool" && event.summary === "tool nexsight_execute completed"),
      true,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest accepts explicit Nexsight request after preflight evidence", async () => {
  const session = createSession();
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-required-nexsight-"));
  session.cwd = cwd;
  session.repo.root = cwd;
  session.toolPolicy.allowedRoots = [cwd];
  const prompts: string[] = [];

  try {
    const result = await executeProviderRequest(
      {
        session,
        prompt: "use Nexsight to inspect the repo and summarize layout",
      },
      {
        exec: async (request) => {
          prompts.push(request.prompt);
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "Done - inspected repo layout and summarized it.",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(prompts.length, 1);
    assert.equal(
      session.events.some((event) => event.kind === "control" && event.summary === "required nexsight fallback started"),
      false,
    );
    assert.equal(
      session.events.some((event) => event.kind === "tool" && event.summary === "tool nexsight_execute completed"),
      true,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest synthesizes after repeated guidance with evidence", async () => {
  const session = createSession();
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-guidance-synthesis-"));
  session.cwd = cwd;
  session.repo.root = cwd;
  session.toolPolicy.allowedRoots = [cwd];
  const prompts: string[] = [];

  try {
    const result = await executeProviderRequest(
      {
        session,
        prompt: "use nexsight to inspect the repo",
      },
      {
        exec: async (request) => {
          prompts.push(request.prompt);
          if (prompts.length === 1) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"list_dir","arguments":{"path":"."}}</nexagent_tool_call>',
            };
          }
          if (prompts.length === 2) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"nexsight_execute","arguments":{"code":"console.log(\\"used-nexsight\\")"}}</nexagent_tool_call>',
            };
          }
          if (prompts.length === 3) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"shell_command","arguments":{"command":"pwd"}}</nexagent_tool_call>',
            };
          }
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "Final from completed Nexsight evidence.",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.output, "Final from completed Nexsight evidence.");
    assert.equal(prompts.length, 4);
    assert.match(prompts[3] ?? "", /Do not call more tools/);
    assert.match(prompts[3] ?? "", /Edited-file block or bounded diff preview/);
    assert.equal(
      session.events.some((event) => event.kind === "control" && event.summary === "guidance loop final synthesis requested"),
      true,
    );
    assert.equal(
      session.events.some((event) => event.kind === "tool" && event.summary === "tool shell_command completed"),
      false,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest returns partial evidence when final synthesis defers again", async () => {
  const session = createSession();
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-guidance-final-deferral-"));
  session.cwd = cwd;
  session.repo.root = cwd;
  session.toolPolicy.allowedRoots = [cwd];
  const prompts: string[] = [];

  try {
    const result = await executeProviderRequest(
      {
        session,
        prompt: "use nexsight to inspect the repo",
      },
      {
        exec: async (request) => {
          prompts.push(request.prompt);
          if (prompts.length === 1) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"list_dir","arguments":{"path":"."}}</nexagent_tool_call>',
            };
          }
          if (prompts.length === 2) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"nexsight_execute","arguments":{"code":"console.log(\\"used-nexsight\\")"}}</nexagent_tool_call>',
            };
          }
          if (prompts.length === 3) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"shell_command","arguments":{"command":"pwd"}}</nexagent_tool_call>',
            };
          }
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "You're right. My bad. If you want, throw me the exact task again and I'll run it properly.",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(result.ok, true);
    assert.match(result.output, /Tool budget exhausted before final assistant answer/);
    assert.match(result.output, /Blocked non-actionable final response/);
    assert.match(result.output, /used-nexsight/);
    assert.equal(prompts.length, 4);
    assert.equal(
      session.events.some((event) => event.kind === "control" && event.summary === "guidance loop fallback returned partial result"),
      true,
    );
    assert.equal(
      session.events.some((event) => event.kind === "assistant" && event.summary === "assistant partial result completed"),
      true,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest nudges malformed tool markup instead of surfacing it", async () => {
  const session = createSession();
  const prompts: string[] = [];

  const result = await executeProviderRequest(
    {
      session,
      prompt: "inspect findings",
    },
    {
      exec: async (request) => {
        prompts.push(request.prompt);
        if (prompts.length === 1) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: '<nexagent_tool_call arguments="{}"></nexagent_tool_call>',
          };
        }
        if (prompts.length === 2) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: '<nexagent_tool_call>{"name":"git_status","arguments":{}}</nexagent_tool_call>',
          };
        }
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "done",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.output, "done");
  assert.match(prompts[1] ?? "", /Do not show raw <nexagent_tool_call> text/);
  assert.equal(
    session.events.some((event) => event.kind === "control" && event.summary === "malformed tool call nudge applied"),
    true,
  );
  assert.equal(
    session.events.some((event) => event.kind === "control" && event.summary.includes("provider.malformed_tool_call")),
    true,
  );
  const diagnostic = session.events.find((event) => event.kind === "control" && event.summary.includes("provider.malformed_tool_call"));
  assert.match(diagnostic?.detail ?? "", /loop=cli/);
  assert.match(diagnostic?.detail ?? "", /step=1/);
  assert.match(diagnostic?.detail ?? "", /markup_family=nexagent_tool_call/);
  assert.match(diagnostic?.detail ?? "", /parse_failure=missing_tool_name/);
  assert.doesNotMatch(diagnostic?.detail ?? "", /<nexagent_tool_call|arguments=/);
});

test("executeProviderRequest nudges non-actionable confirmation replies to continue", async () => {
  const session = createSession();
  const prompts: string[] = [];

  const result = await executeProviderRequest(
    {
      session,
      prompt: "yes do that also",
    },
    {
      exec: async (request) => {
        prompts.push(request.prompt);
        if (prompts.length === 1) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "Please run this and I'll proceed after: cat >> Dogfood-findings-nexagent.md <<'EOF'\nNext steps\nEOF",
          };
        }
        if (prompts.length === 2) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: '<nexagent_tool_call>{"name":"git_status","arguments":{}}</nexagent_tool_call>',
          };
        }

        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "done",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(prompts.length, 3);
  assert.match(prompts[1] ?? "", /The user has already authorized this task/);
  assert.match(prompts[1] ?? "", /Do not provide shell snippets/);
  assert.match(prompts[1] ?? "", /Do not ask for another confirmation/);
  assert.equal(
    session.events.some((event) => event.kind === "control" && event.summary === "continuation nudge applied"),
    true,
  );
  assert.deepEqual(result, {
    ok: true,
    provider: "codex",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    output: "done",
  });
});

test("executeProviderRequest requires active skill tool evidence instead of accepting started", async () => {
  const session = createSession();
  session.activeSkill = {
    name: "gsd-ingest-docs",
    source: "repo",
    path: "/repo/.codex/skills/gsd-ingest-docs/SKILL.md",
    args: "./ docs/ingested-summary.md",
    content: "Execute ingest-docs workflow end-to-end.",
  };
  const prompts: string[] = [];

  const result = await executeProviderRequest(
    {
      session,
      prompt: "start",
    },
    {
      exec: async (request) => {
        prompts.push(request.prompt);
        if (prompts.length === 1) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "Started.",
          };
        }
        if (prompts.length === 2) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: '<nexagent_tool_call>{"name":"git_status","arguments":{}}</nexagent_tool_call>',
          };
        }
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "done from active skill tool evidence",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(prompts.length, 3);
  assert.match(prompts[0] ?? "", /## Active Skill/);
  assert.match(prompts[0] ?? "", /Execute ingest-docs workflow end-to-end/);
  assert.match(prompts[1] ?? "", /active skill is selected/i);
  assert.equal(
    session.events.some((event) => event.kind === "control" && event.summary === "required active skill evidence nudge applied"),
    true,
  );
  assert.deepEqual(result, {
    ok: true,
    provider: "codex",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    output: "done from active skill tool evidence",
  });
});

test("executeProviderRequest creates fallback ask prompt for discussion gate output", async () => {
  const session = createSession();
  session.activeSkill = {
    name: "gsd-discuss-phase",
    source: "repo",
    path: "/repo/.codex/skills/gsd-discuss-phase/SKILL.md",
    args: "73",
    content: "Discuss phase before planning.",
  };
  const prompts: string[] = [];

  const result = await executeProviderRequest(
    {
      session,
      prompt: "start",
    },
    {
      exec: async (request) => {
        prompts.push(request.prompt);
        if (prompts.length === 1) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: '<nexagent_tool_call>{"name":"git_status","arguments":{}}</nexagent_tool_call>',
          };
        }
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "Blocked at required interactive discussion gate: Phase 73 needs you to choose whether to use ROADMAP.md scope or the phase slug before planning.",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.match(result.ok ? result.output : "", /ask_user_question pending/);
  assert.equal(session.operationControls.pendingQuestionnaire?.questions[0]?.header, "Discuss");
  assert.match(session.operationControls.pendingQuestionnaire?.questions[0]?.question ?? "", /Phase 73/);
  assert.match(session.operationControls.pendingQuestionnaire?.questions[0]?.options[0]?.label ?? "", /roadmap/i);
});

test("executeProviderRequest accepts discussion decision write after ask answer", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-ask-decision-"));

  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.toolPolicy.allowedRoots = [cwd];
    session.activeSkill = {
      name: "gsd-discuss-phase",
      source: "repo",
      path: path.join(cwd, ".codex/skills/gsd-discuss-phase/SKILL.md"),
      args: "73",
      content: "Discuss phase before planning.",
    };
    const prompts: string[] = [];

    const result = await executeProviderRequest(
      {
        session,
        prompt: "continue from ask answer",
      },
      {
        exec: async (request) => {
          prompts.push(request.prompt);
          if (prompts.length === 1) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"write_file","arguments":{"path":"73-CONTEXT.md","content":"decisions locked"}}</nexagent_tool_call>',
            };
          }
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "Observed: wrote 73-CONTEXT.md with the locked Phase 73 decisions. Verified: file write succeeded. No more user-choice blocks left for this discussion phase.",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.deepEqual(result, {
      ok: true,
      provider: "codex",
      model: "gpt-5.4",
      transport: "codex",
      adapter: "codex-cli-exec",
      fallbackApplied: false,
      output: "Observed: wrote 73-CONTEXT.md with the locked Phase 73 decisions. Verified: file write succeeded. No more user-choice blocks left for this discussion phase.",
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest allows tool inventory answers that mention Nexsight tool names", async () => {
  const session = createSession();

  const result = await executeProviderRequest(
    {
      session,
      prompt: "What tools and mcp tools do you have in your arsenal?",
    },
    {
      exec: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        output: [
          "I used mcp_list_tools and can use these built-in Nexagent tools:",
          "- nexsight_execute - bounded scripts/commands through Nexsight",
          "- nexsight_search - search indexed Nexsight knowledge",
        ].join("\n"),
      }),
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.match(result.output, /nexsight_execute/);
});

test("executeProviderRequest catches say-proceed deferrals after direct tasks", async () => {
  const session = createSession();
  const prompts: string[] = [];

  const result = await executeProviderRequest(
    {
      session,
      prompt: "feature the v2 prompt guidance in nexagent, make sure it is working properly",
    },
    {
      exec: async (request) => {
        prompts.push(request.prompt);
        if (prompts.length === 1) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: [
              "Got it - let's ship v2 prompt guidance and prove it behaves.",
              "I'll do this in-repo, not vibes-based:",
              "1. find where prompt guidance/versioning lives,",
              "2. implement/feature v2 in the active prompt path,",
              "3. run focused smoke checks/tests for prompt assembly + runtime wiring,",
              "Please say \"proceed\" and I'll execute the full pass now.",
            ].join("\n"),
          };
        }

        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "done - continued without asking again",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(prompts.length, 2);
  assert.match(prompts[1] ?? "", /The previous response deferred action/);
  assert.match(prompts[1] ?? "", /The user has already authorized this task/);
  assert.deepEqual(result, {
    ok: true,
    provider: "codex",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    output: "done - continued without asking again",
  });
});

test("executeProviderRequest catches invented transport blocker before verification", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-invented-transport-blocker-"));

  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.toolPolicy.allowedRoots = [cwd];
    const prompts: string[] = [];

    const result = await executeProviderRequest(
      {
        session,
        prompt: "write phase-plan.md and verify it",
      },
      {
        exec: async (request) => {
          prompts.push(request.prompt);
          if (prompts.length === 1) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"todo","arguments":{"items":[{"content":"Write plan","status":"in_progress"},{"content":"Verify plan","status":"pending"}]}}</nexagent_tool_call>',
            };
          }
          if (prompts.length === 2) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"write_file","arguments":{"path":"phase-plan.md","content":"# Phase 74\\n"}}</nexagent_tool_call>',
            };
          }
          if (prompts.length === 3) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: "Blocked by a transport hiccup before I could run the final verification pass; observed work already completed: created phase-plan.md.",
            };
          }
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "Created phase-plan.md. Verification passed with focused readback.",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(prompts.length, 4);
    assert.match(prompts[3] ?? "", /The previous response deferred action/);
    assert.deepEqual(result, {
      ok: true,
      provider: "codex",
      model: "gpt-5.4",
      transport: "codex",
      adapter: "codex-cli-exec",
      fallbackApplied: false,
      output: "Created phase-plan.md. Verification passed with focused readback.",
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest catches apology-only self-correction loops", async () => {
  const session = createSession();
  const prompts: string[] = [];

  const result = await executeProviderRequest(
    {
      session,
      prompt: "inspect repo and report evidence",
    },
    {
      exec: async (request) => {
        prompts.push(request.prompt);
        if (prompts.length === 1) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: [
              "Yep - fair callout. You're right.",
              "I should have used the repo-native tooling flow instead of winging it.",
              "Short version: that miss is on me.",
              "If you want, throw me the exact task again and I'll run it properly this time.",
            ].join("\n"),
          };
        }

        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "done - executed requested task",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(prompts.length, 2);
  assert.match(prompts[1] ?? "", /Do not apologize/);
  assert.match(prompts[1] ?? "", /ask the user to restate/);
  assert.deepEqual(result, {
    ok: true,
    provider: "codex",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    output: "done - executed requested task",
  });
});

test("executeProviderRequest rejects file-change claims without write evidence", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-write-evidence-"));

  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.toolPolicy.allowedRoots = [cwd];
    const prompts: string[] = [];

    const result = await executeProviderRequest(
      {
        session,
        prompt: "update README",
      },
      {
        exec: async (request) => {
          prompts.push(request.prompt);
          if (prompts.length === 1) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"read_file","arguments":{"path":"README.md"}}</nexagent_tool_call>',
            };
          }
          if (prompts.length === 2) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: "Done — applied directly in README.md with both additions.",
            };
          }
          if (prompts.length === 3) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"write_file","arguments":{"path":"README.md","content":"updated\\n"}}</nexagent_tool_call>',
            };
          }

          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "Done — README.md updated and verified.",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(prompts.length, 4);
    assert.match(prompts[2] ?? "", /no write tool evidence/);
    assert.equal(
      session.events.some((event) =>
        event.kind === "control"
        && (event.summary === "write evidence nudge applied" || event.summary === "required write evidence nudge applied")
      ),
      true,
    );
    assert.deepEqual(result, {
      ok: true,
      provider: "codex",
      model: "gpt-5.4",
      transport: "codex",
      adapter: "codex-cli-exec",
      fallbackApplied: false,
      output: "Done — README.md updated and verified.",
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest blocks repeated file-change claims without write evidence", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-write-evidence-block-"));

  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.toolPolicy.allowedRoots = [cwd];
    const prompts: string[] = [];

    const result = await executeProviderRequest(
      {
        session,
        prompt: "create Dogfood-prompt-issues.md",
      },
      {
        exec: async (request) => {
          prompts.push(request.prompt);
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: prompts.length === 1
              ? "Done. I created Dogfood-prompt-issues.md with exact content."
              : "Verified with direct reads: Dogfood-prompt-issues.md exists.",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(prompts.length, 2);
    assert.equal(result.ok, false);
    assert.equal(result.code, "transport_error");
    assert.match(result.message, /required write evidence|without write evidence/);
    assert.equal(
      session.events.some((event) => event.kind === "control" && event.summary === "write evidence gate blocked assistant response"),
      false,
    );
    assert.equal(
      session.events.some((event) => event.kind === "control" && event.summary === "required write evidence gate blocked assistant response"),
      true,
    );
    assert.equal(
      session.events.some((event) => event.kind === "control" && event.summary.includes("provider.missing_evidence")),
      true,
    );
    assert.equal(
      session.events.some((event) => event.kind === "assistant" && event.status === "completed"),
      false,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest allows repo-state recommendations that mention uncommitted files", async () => {
  const session = createSession();
  const output = [
    "Observed: repo is mid-step with uncommitted edits in `src/runtime/tools.ts` and `test/tools.test.ts` adding `text` as a todo-item alias.",
    "Next step: finish/verify the current `todo` alias compatibility change first, then create/plan Phase 74 for remaining OpenTUI work.",
    "Verification not run this turn.",
  ].join("\n");

  const result = await executeProviderRequest(
    {
      session,
      prompt: "examine the local repo and see what our next step would be",
    },
    {
      exec: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        output,
      }),
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.output, output);
  assert.equal(
    session.events.some((event) => event.summary === "write evidence gate blocked assistant response"),
    false,
  );
});

test("executeProviderRequest clears todos after successful turn", async () => {
  const session = createSession();
  session.todos.tasks.push(
    {
      id: "todo-1",
      subject: "Already done",
      status: "completed",
      blockedBy: [],
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:01:00.000Z",
    },
    {
      id: "todo-2",
      subject: "Still active",
      status: "in_progress",
      blockedBy: [],
      createdAt: "2026-05-05T00:02:00.000Z",
      updatedAt: "2026-05-05T00:02:00.000Z",
    },
  );
  session.todos.nextId = 3;

  const result = await executeProviderRequest(
    {
      session,
      prompt: "continue",
    },
    {
      exec: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        output: "Continuing active task.",
      }),
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(result.ok, true);
  assert.deepEqual(session.todos.tasks, []);
  assert.notEqual(session.todos.updatedAt, null);
});

test("executeProviderRequest requires write evidence when user asks for a file write", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-required-write-"));

  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.toolPolicy.allowedRoots = [cwd];
    const prompts: string[] = [];

    const result = await executeProviderRequest(
      {
        session,
        prompt: "write all your findings to Nexagent-truths.md with tool calls used",
      },
      {
        exec: async (request) => {
          prompts.push(request.prompt);
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: prompts.length === 1
              ? "Done - I inspected the repo and captured the findings."
              : "Done - findings are ready with context proof.",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(prompts.length, 2);
    assert.equal(result.ok, false);
    assert.equal(result.code, "transport_error");
    assert.match(result.message, /required write evidence/);
    assert.match(prompts[1] ?? "", /no write tool evidence exists/);
    assert.equal(
      session.events.some((event) => event.kind === "control" && event.summary === "required write evidence nudge applied"),
      true,
    );
    assert.equal(
      session.events.some((event) => event.kind === "assistant" && event.status === "completed"),
      false,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest updates runtime action for guarded shell tool", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-shell-"));

  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.toolPolicy.allowedRoots = [cwd];

    let turns = 0;
    const result = await executeProviderRequest(
      {
        session,
        prompt: "show cwd then answer",
      },
      {
        exec: async () => {
          turns += 1;
          if (turns === 1) {
            return {
              exitCode: 0,
              stdout: "",
              stderr: "",
              output: '<nexagent_tool_call>{"name":"shell_command","arguments":{"command":"pwd"}}</nexagent_tool_call>',
            };
          }

          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "done",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.equal(turns, 2);
    assert.deepEqual(result, {
      ok: true,
      provider: "codex",
      model: "gpt-5.4",
      transport: "codex",
      adapter: "codex-cli-exec",
      fallbackApplied: false,
      output: "done",
    });
    assert.equal(session.action.status, "ready");
    assert.equal(session.action.detail, "tool shell_command complete · guarded");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest waits for guarded approval before tool execution", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-approval-"));

  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.toolPolicy.allowedRoots = [cwd];
    session.operationControls.requireApprovalForGuarded = true;
    let turns = 0;

    const pending = executeProviderRequest(
      {
        session,
        prompt: "show cwd after approval",
      },
      {
        exec: async () => {
          turns += 1;
          return turns === 1
            ? {
                exitCode: 0,
                stdout: "",
                stderr: "",
                output: '<nexagent_tool_call>{"name":"shell_command","arguments":{"command":"pwd"}}</nexagent_tool_call>',
              }
            : {
                exitCode: 0,
                stdout: "",
                stderr: "",
                output: cwd,
              };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    for (let index = 0; index < 20 && !session.operationControls.pendingApproval; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(session.operationControls.pendingApproval?.tool, "shell_command");
    assert.equal(resolveRuntimeApproval(session, "approved"), true);

    const result = await pending;
    assert.equal(turns, 2);
    assert.deepEqual(result, {
      ok: true,
      provider: "codex",
      model: "gpt-5.4",
      transport: "codex",
      adapter: "codex-cli-exec",
      fallbackApplied: false,
      output: cwd,
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("approval wait resumes from runtime approval notification without polling delay", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-approval-notify-"));

  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.toolPolicy.allowedRoots = [cwd];
    session.operationControls.requireApprovalForGuarded = true;
    let turns = 0;

    const pending = executeProviderRequest(
      {
        session,
        prompt: "show cwd after notified approval",
      },
      {
        exec: async () => {
          turns += 1;
          return turns === 1
            ? {
                exitCode: 0,
                stdout: "",
                stderr: "",
                output: '<nexagent_tool_call>{"name":"shell_command","arguments":{"command":"pwd"}}</nexagent_tool_call>',
              }
            : {
                exitCode: 0,
                stdout: "",
                stderr: "",
                output: cwd,
              };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    for (let index = 0; index < 20 && !session.operationControls.pendingApproval; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const approvedAt = Date.now();
    assert.equal(resolveRuntimeApproval(session, "approved"), true);
    const result = await pending;

    assert.equal(turns, 2);
    assert.equal(result.ok, true);
    assert.ok(Date.now() - approvedAt < 200);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("plain approved prompt resumes pending guarded write action", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-approval-write-"));

  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.toolPolicy.allowedRoots = [cwd];
    session.operationControls.requireApprovalForGuarded = true;
    let turns = 0;

    const pending = executeProviderRequest(
      {
        session,
        prompt: "create temp file after approval",
      },
      {
        exec: async () => {
          turns += 1;
          return turns === 1
            ? {
                exitCode: 0,
                stdout: "",
                stderr: "",
                output: '<nexagent_tool_call>{"name":"write_file","arguments":{"path":"tmp/dogfood-approval-test-2.txt","content":"approval second test\\n"}}</nexagent_tool_call>',
              }
            : {
                exitCode: 0,
                stdout: "",
                stderr: "",
                output: "Done.",
              };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    for (let index = 0; index < 20 && !session.operationControls.pendingApproval; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(session.operationControls.pendingApproval?.tool, "write_file");

    const { runPromptCommand } = await import("../src/cli.js");
    const stdoutChunks: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array, ..._args: unknown[]) => {
      stdoutChunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      await runPromptCommand(session, "approved");
    } finally {
      process.stdout.write = originalWrite;
    }

    const result = await pending;
    assert.equal(turns, 2);
    assert.deepEqual(result, {
      ok: true,
      provider: "codex",
      model: "gpt-5.4",
      transport: "codex",
      adapter: "codex-cli-exec",
      fallbackApplied: false,
      output: "Done.",
    });
    assert.equal(stdoutChunks.join(""), "approvalRequired: true\nyoloMode: false\npendingApproval: none\nlastDecision: approved\ncancelRequested: false\nsteerState: none\nsteer: none\nlastAppliedSteer: none\nsteerHistory: none\n");
    assert.equal(
      await readFile(path.join(cwd, "tmp", "dogfood-approval-test-2.txt"), "utf8"),
      "approval second test\n",
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest injects archivist retrieval into prompt and state", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-archivist-"));

  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.archivist.enabled = true;
    session.archivist.boundary = "read-only";
    session.archivist.storagePath = path.join(cwd, "archivist.json");
    session.archivist.storageExists = true;
    await writeFile(
      session.archivist.storagePath,
      JSON.stringify({
        version: "1.0.0",
        entries: [
          {
            type: "context",
            summary: "codex auth transport uses chatgpt backend",
            content: "codex auth transport uses chatgpt backend and account id header",
            projectPath: cwd,
            tags: ["auth", "codex-http"],
          },
          {
            type: "note",
            summary: "duplicate signal sample",
            content: "duplicate signal sample",
            projectPath: cwd,
          },
          {
            type: "note",
            summary: "duplicate signal sample",
            content: "duplicate signal sample",
            projectPath: cwd,
          },
          {
            type: "note",
            summary: "tiny",
            content: "tiny",
            projectPath: cwd,
          },
        ],
      }),
      "utf8",
    );

    let capturedPrompt = "";
    const result = await executeProviderRequest(
      {
        session,
        prompt: "check codex auth transport",
      },
      {
        exec: async (request) => {
          capturedPrompt = request.prompt;
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "archivist ok\n",
          };
        },
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    assert.match(capturedPrompt, /## Conversation State/);
    assert.match(capturedPrompt, /Archivist: enabled; retrieval matches=1/);
    assert.match(capturedPrompt, /Archivist retrieval: project-memory/);
    assert.match(capturedPrompt, /chatgpt backend/);
    assert.equal(session.archivist.retrieval.used, true);
    assert.equal(session.archivist.retrieval.sourceCategory, "project-memory");
    assert.equal(session.archivist.retrieval.matchCount, 1);
    assert.match(session.archivist.retrieval.preview ?? "", /chatgpt backend/);
    assert.equal(session.archivist.diagnostics?.retrievalMatchCount, 1);
    assert.equal(session.archivist.diagnostics?.retrievalSourceCategory, "project-memory");
    assert.equal(session.archivist.diagnostics?.duplicateSuspectCount, 1);
    assert.equal(session.archivist.diagnostics?.noisySignalCount, 1);
    assert.deepEqual(result, {
      ok: true,
      provider: "codex",
      model: "gpt-5.4",
      transport: "codex",
      adapter: "codex-cli-exec",
      fallbackApplied: false,
      output: "archivist ok",
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest prefers explicit memory over generic checkpoint recall", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-archivist-priority-"));

  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.archivist.enabled = true;
    session.archivist.boundary = "read-only";
    session.archivist.storagePath = path.join(cwd, "archivist.json");
    session.archivist.storageExists = true;
    await writeFile(
      session.archivist.storagePath,
      JSON.stringify({
        version: "1.0.0",
        entries: [
          {
            type: "checkpoint",
            summary: "provider=codex | transport=codex-http | turns=2",
            content: "Checkpoint summary. transport codex-http auth transport state.",
            projectPath: cwd,
            tags: ["checkpoint", "codex"],
            createdAt: "2026-04-25T12:00:00.000Z",
          },
          {
            type: "memory",
            summary: "codex auth transport uses chatgpt backend",
            content: "codex auth transport uses chatgpt backend and account id header",
            projectPath: cwd,
            tags: ["auth", "codex-http"],
            createdAt: "2026-04-20T12:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );

    await executeProviderRequest(
      {
        session,
        prompt: "check codex auth transport",
      },
      {
        exec: async () => ({
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "archivist ok\n",
        }),
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    const previewLines = (session.archivist.retrieval.preview ?? "").split("\n");
    assert.match(previewLines[0] ?? "", /\[memory\] codex auth transport uses chatgpt backend/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest prefers newer matching memory when scores tie", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-provider-archivist-recency-"));

  try {
    const session = createSession();
    session.cwd = cwd;
    session.repo.root = cwd;
    session.archivist.enabled = true;
    session.archivist.boundary = "read-only";
    session.archivist.storagePath = path.join(cwd, "archivist.json");
    session.archivist.storageExists = true;
    await writeFile(
      session.archivist.storagePath,
      JSON.stringify({
        version: "1.0.0",
        entries: [
          {
            type: "memory",
            summary: "old auth note",
            content: "codex auth token refresh uses backend token flow",
            projectPath: cwd,
            tags: ["auth"],
            createdAt: "2025-01-01T00:00:00.000Z",
          },
          {
            type: "memory",
            summary: "new auth note",
            content: "codex auth token refresh uses backend token flow",
            projectPath: cwd,
            tags: ["auth"],
            createdAt: "2026-04-25T00:00:00.000Z",
          },
        ],
      }),
      "utf8",
    );

    await executeProviderRequest(
      {
        session,
        prompt: "explain codex auth token refresh",
      },
      {
        exec: async () => ({
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "archivist ok\n",
        }),
        http: async () => {
          throw new Error("http should not be used");
        },
        codexHttp: async () => {
          throw new Error("codex-http should not be used");
        },
      },
    );

    const previewLines = (session.archivist.retrieval.preview ?? "").split("\n");
    assert.match(previewLines[0] ?? "", /\[memory\] new auth note/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("executeProviderRequest maps codex auth failures", async () => {
  const result = await executeProviderRequest(
    {
      session: createSession(),
      prompt: "say hi",
    },
    {
      exec: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "Authentication failed. Please login.",
        output: "",
      }),
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    provider: "codex",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    code: "auth_unavailable",
    message: "codex credentials unavailable",
    detail: "Authentication failed. Please login.",
  });
});

test("executeProviderRequest maps codex model failures", async () => {
  const result = await executeProviderRequest(
    {
      session: createSession(),
      prompt: "say hi",
    },
    {
      exec: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "Error: unknown model gpt-5.4-mini",
        output: "",
      }),
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    provider: "codex",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    code: "unsupported_model",
    message: "codex model gpt-5.4 is unsupported",
    detail: "Error: unknown model gpt-5.4-mini",
  });
});

test("executeProviderRequest accepts openai provider through codex transport", async () => {
  let capturedModel: string | null = null;

  const result = await executeProviderRequest(
    {
      session: createSession("openai", "gpt-5.4"),
      prompt: "say hi",
    },
    {
      exec: async (_request, model) => {
        capturedModel = model;
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "hello world\n",
        };
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(capturedModel, "gpt-5.4");
  assert.deepEqual(result, {
    ok: true,
    provider: "openai",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    output: "hello world",
  });
});

test("executeProviderRequest rejects unimplemented providers", async () => {
  const result = await executeProviderRequest({
    session: createSession("anthropic", "claude-sonnet-4-6"),
    prompt: "say hi",
  });

  assert.deepEqual(result, {
    ok: false,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    code: "unsupported_provider",
    message: "provider anthropic is not implemented",
    detail: "nexagent currently supports only codex-compatible providers.",
  });
});

test("executeProviderRequest preserves configured provider on transport errors", async () => {
  const result = await executeProviderRequest(
    {
      session: createSession("openai", "gpt-5.4"),
      prompt: "say hi",
    },
    {
      exec: async () => {
        throw new Error("spawn ENOENT");
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    provider: "openai",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    code: "transport_error",
    message: "codex execution failed",
    detail: "spawn ENOENT",
  });
});

test("executeProviderRequest surfaces codex exec timeout clearly", async () => {
  const result = await executeProviderRequest(
    {
      session: createSession(),
      prompt: "say hi",
    },
    {
      exec: async () => ({
        exitCode: 124,
        stdout: "",
        stderr: "codex exec timed out after 30000ms",
        output: "",
      }),
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    provider: "codex",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-cli-exec",
    fallbackApplied: false,
    code: "transport_error",
    message: "codex transport failed",
    detail: "codex exec timed out after 30000ms",
  });
});

test("executeProviderRequest selects http adapter when transport mode is http-responses", async () => {
  const session = createSession("openai", "gpt-5.4");
  session.providerTransport.executor = "fetch";
  session.providerTransport.adapter = "openai-http-responses";
  session.providerTransport.mode = "http-responses";
  session.providerTransport.authSource = "openai-api-key";
  session.providerTransport.authGate = "ready";
  session.providerTransport.openaiBaseUrl = "https://api.openai.test/v1";

  const result = await executeProviderRequest(
    {
      session,
      prompt: "say hi",
    },
    {
      exec: async () => {
        throw new Error("exec should not be used");
      },
      http: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        output: "http hello\n",
      }),
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.deepEqual(result, {
    ok: true,
    provider: "openai",
    model: "gpt-5.4",
    transport: "openai",
    adapter: "openai-http-responses",
    fallbackApplied: false,
    output: "http hello",
  });
});

test("executeProviderRequest uses native tool calling on http-responses transport", async () => {
  const session = createSession("openai", "gpt-5.4");
  session.providerTransport.executor = "fetch";
  session.providerTransport.adapter = "openai-http-responses";
  session.providerTransport.mode = "http-responses";
  session.providerTransport.authSource = "openai-api-key";
  session.providerTransport.authGate = "ready";
  session.providerTransport.openaiBaseUrl = "https://api.openai.test/v1";

  const calls: Array<{ request: ProviderRequest; model: string | null }> = [];
  const result = await executeProviderRequest(
    {
      session,
      prompt: "show repo status",
    },
    {
      exec: async () => {
        throw new Error("exec should not be used");
      },
      http: async (request) => {
        calls.push(request);
        if (calls.length === 1) {
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: "",
            raw: {
              id: "resp_1",
              output: [
                {
                  type: "function_call",
                  name: "git_status",
                  arguments: "{}",
                  call_id: "call_1",
                },
              ],
            },
          };
        }

        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "native tool final\n",
          raw: {
            id: "resp_2",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "native tool final" }],
              },
            ],
          },
        };
      },
      codexHttp: async () => {
        throw new Error("codex-http should not be used");
      },
    },
  );

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.nativeTools, true);
  assert.deepEqual(calls[0]?.nativeInput, [{ role: "user", content: "show repo status" }]);
  assert.equal(calls[1]?.previousResponseId, "resp_1");
  assert.deepEqual(calls[1]?.nativeInput, [
    {
      type: "function_call_output",
      call_id: "call_1",
      output: "repo: repo\nbranch: main\ntracking: origin/main\nstatus: up-to-date\nahead: 0\nbehind: 0\ndirty: false\nneedsPull: false",
    },
  ]);
  assert.deepEqual(result, {
    ok: true,
    provider: "openai",
    model: "gpt-5.4",
    transport: "openai",
    adapter: "openai-http-responses",
    fallbackApplied: false,
    output: "native tool final",
  });
});

test("executeProviderRequest selects codex chatgpt adapter when transport mode is codex-http", async () => {
  const session = createSession("codex", "gpt-5.4");
  session.providerTransport.executor = "fetch";
  session.providerTransport.adapter = "codex-chatgpt-http";
  session.providerTransport.mode = "codex-http";
  session.providerTransport.authSource = "codex-auth-json";
  session.providerTransport.authGate = "ready";
  session.providerTransport.openaiBaseUrl = "https://chatgpt.com/backend-api/codex";

  const result = await executeProviderRequest(
    {
      session,
      prompt: "say hi",
    },
    {
      exec: async () => {
        throw new Error("exec should not be used");
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async () => ({
        exitCode: 0,
        stdout: "",
        stderr: "",
        output: "codex hello\n",
      }),
    },
  );

  assert.deepEqual(result, {
    ok: true,
    provider: "codex",
    model: "gpt-5.4",
    transport: "codex",
    adapter: "codex-chatgpt-http",
    fallbackApplied: false,
    output: "codex hello",
  });
});

test("executeProviderRequest passes multiple image attachments to API transports", async () => {
  const session = createSession("codex", "gpt-5.4");
  session.providerTransport.executor = "fetch";
  session.providerTransport.adapter = "codex-chatgpt-http";
  session.providerTransport.mode = "codex-http";
  session.providerTransport.authSource = "codex-auth-json";
  session.providerTransport.authGate = "ready";
  session.providerTransport.openaiBaseUrl = "https://chatgpt.com/backend-api/codex";
  const calls: ProviderRequest[] = [];

  const result = await executeProviderRequest(
    {
      session,
      prompt: "compare images",
      attachments: [
        { path: "/tmp/one.png", name: "one.png", mimeType: "image/png", bytes: 12, dataUrl: "data:image/png;base64,one" },
        { path: "/tmp/two.png", name: "two.png", mimeType: "image/png", bytes: 34, dataUrl: "data:image/png;base64,two" },
      ],
    },
    {
      exec: async () => {
        throw new Error("exec should not be used");
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async (request) => {
        calls.push(request);
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "compared\n",
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.nativeInput, [{
    role: "user",
    content: [
      { type: "input_text", text: "compare images" },
      { type: "input_image", image_url: "data:image/png;base64,one" },
      { type: "input_text", text: "[attachment] name=one.png; path=/tmp/one.png; mime=image/png; bytes=12" },
      { type: "input_image", image_url: "data:image/png;base64,two" },
      { type: "input_text", text: "[attachment] name=two.png; path=/tmp/two.png; mime=image/png; bytes=34" },
    ],
  }]);
});

test("executeProviderRequest routes spark model through codex chatgpt responses adapter", async () => {
  const session = createSession("codex", "codexspark");
  session.providerTransport.executor = "fetch";
  session.providerTransport.adapter = "codex-chatgpt-http";
  session.providerTransport.mode = "codex-http";
  session.providerTransport.authSource = "codex-auth-json";
  session.providerTransport.authGate = "ready";
  session.providerTransport.openaiBaseUrl = "https://chatgpt.com/backend-api/codex";

  const calls: Array<{ request: ProviderRequest; model: string | null }> = [];
  const result = await executeProviderRequest(
    {
      session,
      prompt: "say hi",
    },
    {
      exec: async () => {
        throw new Error("exec should not be used");
      },
      http: async () => {
        throw new Error("http should not be used");
      },
      codexHttp: async (request, model) => {
        calls.push({ request, model });
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          output: "hi\n",
        };
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(result.model, "gpt-5.3-codex-spark");
  assert.equal(result.adapter, "codex-chatgpt-http");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.model, "gpt-5.3-codex-spark");
  assert.equal(calls[0]?.request.session.providerTransport.openaiBaseUrl, "https://chatgpt.com/backend-api/codex");
});

test("resolveCodexAuthJson refreshes expired token and rewrites auth json", async () => {
  const now = Date.parse("2026-04-25T12:00:00.000Z");
  const expiredToken = createJwt({
    exp: Math.floor((now - 5 * 60_000) / 1000),
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_old",
    },
  });
  const refreshedToken = createJwt({
    exp: Math.floor((now + 60 * 60_000) / 1000),
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_new",
    },
  });

  const writes: Array<{ path: string; value: string }> = [];
  const auth = await resolveCodexAuthJson({
    authJsonPath: "/tmp/auth.json",
    readText: async () =>
      JSON.stringify({
        auth_mode: "chatgpt",
        tokens: {
          access_token: expiredToken,
          refresh_token: "refresh_old",
          account_id: "acct_old",
        },
      }),
    writeText: async (target, value) => {
      writes.push({ path: target, value });
    },
    fetchImpl: async (_input, init) => {
      assert.equal(init.method, "POST");
      assert.match(String(init.body), /grant_type=refresh_token/);
      assert.match(String(init.body), /client_id=app_EMoamEEZ73f0CkXaXp7hrann/);
      return new Response(
        JSON.stringify({
          access_token: refreshedToken,
          refresh_token: "refresh_new",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
    now: () => now,
  });

  assert.equal(auth.accessToken, refreshedToken);
  assert.equal(auth.refreshToken, "refresh_new");
  assert.equal(auth.accountId, "acct_new");
  assert.equal(writes.length, 1);

  const persisted = JSON.parse(writes[0]!.value) as {
    last_refresh?: string;
    tokens?: {
      access_token?: string;
      refresh_token?: string;
      account_id?: string;
    };
  };
  assert.equal(persisted.last_refresh, "2026-04-25T12:00:00.000Z");
  assert.equal(persisted.tokens?.access_token, refreshedToken);
  assert.equal(persisted.tokens?.refresh_token, "refresh_new");
  assert.equal(persisted.tokens?.account_id, "acct_new");
});

test("resolveCodexAuthJson keeps valid token without refresh", async () => {
  const now = Date.parse("2026-04-25T12:00:00.000Z");
  const validToken = createJwt({
    exp: Math.floor((now + 60 * 60_000) / 1000),
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_live",
    },
  });
  let fetchCalled = false;
  let writeCalled = false;

  const auth = await resolveCodexAuthJson({
    authJsonPath: "/tmp/auth.json",
    readText: async () =>
      JSON.stringify({
        tokens: {
          access_token: validToken,
          refresh_token: "refresh_live",
          account_id: "acct_live",
        },
      }),
    writeText: async () => {
      writeCalled = true;
    },
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("fetch should not run");
    },
    now: () => now,
  });

  assert.equal(auth.accessToken, validToken);
  assert.equal(auth.refreshToken, "refresh_live");
  assert.equal(auth.accountId, "acct_live");
  assert.equal(fetchCalled, false);
  assert.equal(writeCalled, false);
});

test("invokeCodexChatGptHttpTransport sends instructions separate from user input", async () => {
  const requests: Array<{ input: unknown; instructions: unknown; previous_response_id: unknown }> = [];
  const now = Date.parse("2026-04-25T12:00:00.000Z");
  const validToken = createJwt({
    exp: Math.floor((now + 60 * 60_000) / 1000),
    "https://api.openai.com/auth": {
      chatgpt_account_id: "acct_live",
    },
  });

  const invocation = await invokeCodexChatGptHttpTransport(
    {
      session: createSession(),
      prompt: "user says hi",
      instructions: "system assembled prompt",
    },
    "gpt-5.4",
    {
      authJsonPath: "/tmp/auth.json",
      readText: async () =>
        JSON.stringify({
          tokens: {
            access_token: validToken,
            refresh_token: "refresh_live",
            account_id: "acct_live",
          },
        }),
      writeText: async () => undefined,
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>;
        requests.push({
          input: body.input,
          instructions: body.instructions,
          previous_response_id: body.previous_response_id,
        });
        return new Response(JSON.stringify({ output_text: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
      now: () => now,
    },
  );

  assert.equal(invocation.exitCode, 0);
  assert.equal(invocation.output, "ok");
  assert.deepEqual(requests, [{
    input: [{ role: "user", content: "user says hi" }],
    instructions: "system assembled prompt",
    previous_response_id: undefined,
  }]);
});

function createJwt(payload: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(payload)).toString("base64url"),
    "sig",
  ].join(".");
}
