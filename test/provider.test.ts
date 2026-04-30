import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { invokeCodexChatGptHttpTransport, resolveCodexAuthJson } from "../src/provider/codex-chatgpt-http.js";
import { executeProviderRequest, type ProviderRequest } from "../src/provider.js";
import { createDefaultProviderRegistry } from "../src/provider/registry.js";
import type { RuntimeSession } from "../src/runtime/session.js";

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
  assert.equal(prompts.length, 13);
  assert.match(prompts[5] ?? "", /Tool budget is almost exhausted/);
  assert.match(prompts[6] ?? "", /Tool budget continuation cycle 2 started/);
  assert.match(prompts[12] ?? "", /Do not call more tools/);
  assert.match(result.output, /Tool budget exhausted before final assistant answer/);
  assert.match(result.output, /Partial evidence from completed tools/);
  assert.match(result.output, /Tool call: \{"name":"git_status","arguments":\{\}\}/);
  assert.equal(
    session.events.some((event) => event.kind === "control" && event.summary === "tool budget continuation cycle started"),
    true,
  );
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
        if (prompts.length <= 12) {
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
  assert.equal(prompts.length, 13);
  assert.match(prompts[12] ?? "", /Do not call more tools/);
  assert.equal(
    session.events.some((event) => event.kind === "control" && event.summary === "tool budget final synthesis requested"),
    true,
  );
});

test("executeProviderRequest resets tool budget once for bounded continuation", async () => {
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
        if (prompts.length <= 6) {
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
          output: "continued after budget reset",
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
    output: "continued after budget reset",
  });
  assert.equal(prompts.length, 7);
  assert.match(prompts[6] ?? "", /legally reset the per-cycle tool counter/);
  assert.equal(
    session.events.some((event) => event.kind === "control" && event.summary === "tool budget continuation cycle started"),
    true,
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
      session.events.some((event) => event.kind === "assistant" && event.status === "completed"),
      false,
    );
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
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
    session.operationControls.pendingApproval = null;
    session.operationControls.lastDecision = "approved";

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

  const calls: ProviderRequest[] = [];
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

test("executeProviderRequest rejects spark model on api transports using donor model truth", async () => {
  const session = createSession("codex", "codexspark");
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
      codexHttp: async () => {
        throw new Error("codex-http should not be invoked for unsupported api model");
      },
    },
  );

  assert.deepEqual(result, {
    ok: false,
    provider: "codex",
    model: "gpt-5.3-codex-spark",
    transport: "codex",
    adapter: "codex-chatgpt-http",
    fallbackApplied: false,
    code: "unsupported_model",
    message: "model gpt-5.3-codex-spark is not available for provider codex",
    detail: "needs websocket/realtime Codex adapter",
  });
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
