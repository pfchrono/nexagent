import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "bun:test";
import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";

import { startNexagentGrpcServer } from "../src/grpc/server.js";
import { executeProviderRequest } from "../src/provider.js";
import { bootstrapRuntime } from "../src/runtime/bootstrap.js";
import { applyYoloMode, createRuntimeSession, type RuntimeSession } from "../src/runtime/session.js";

type UnaryClient = Record<string, (request: Record<string, unknown>, callback: (error: Error | null, response: Record<string, unknown>) => void) => void>;

test("gRPC server exposes health, inspect, slash command, shell command, and stop", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-grpc-server-"));
  let handle: Awaited<ReturnType<typeof startNexagentGrpcServer>> | null = null;
  try {
    const session = await createGrpcTestSession(cwd);
    handle = await startNexagentGrpcServer({ session, host: "127.0.0.1", port: 0 });
    const client = createGrpcClient(handle.address);

    const health = await callGrpc(client, "health", {});
    assert.equal(health.ok, true);
    assert.equal(health.product, "nexagent");
    assert.equal(health.sessionId, session.id);

    const inspect = await callGrpc(client, "inspect", {});
    assert.equal(inspect.ok, true);
    assert.match(String(inspect.sessionJson), /"product":"nexagent"/);

    const status = await callGrpc(client, "runCommand", { input: "/status" });
    assert.equal(status.ok, true);
    assert.match(String(status.output), /provider:/);

    const shell = await callGrpc(client, "runCommand", { input: "!printf grpc-ok" });
    assert.equal(shell.ok, true);
    assert.match(String(shell.output), /grpc-ok/);

    const rejected = await callGrpc(client, "runCommand", { input: "plain prompt" });
    assert.equal(rejected.ok, false);
    assert.match(String(rejected.error), /not a runtime command/);

    const stopped = await callGrpc(client, "stop", {});
    assert.equal(stopped.ok, true);
    await assert.rejects(() => callGrpc(client, "health", {}));
  } finally {
    await handle?.stop();
    await rm(cwd, { recursive: true, force: true });
  }
}, 30000);

test("CLI gRPC server can be driven by an external client process", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-grpc-cli-"));
  const repoRoot = path.resolve(".");
  const child = spawn(process.execPath, ["run", path.join(repoRoot, "src", "cli.ts"), "grpc", "--yolo", "--host", "127.0.0.1", "--port", "0"], {
    cwd,
    env: {
      ...process.env,
      NEXAGENT_HOME: path.join(cwd, ".nexagent-home"),
      NEXAGENT_SESSION_DIR: path.join(cwd, "sessions"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exitPromise = waitForExit(child);

  try {
    const address = await readGrpcAddress(child);
    const client = createGrpcClient(address);
    const health = await callGrpc(client, "health", {});
    assert.equal(health.ok, true);
    assert.equal(health.product, "nexagent");

    const inspect = await callGrpc(client, "inspect", {});
    assert.equal(inspect.ok, true);
    assert.match(String(inspect.sessionJson), /"product":"nexagent"/);

    const status = await callGrpc(client, "runCommand", { input: "/provider" });
    assert.equal(status.ok, true);
    assert.match(String(status.output), /provider:/);

    const stopped = await callGrpc(client, "stop", {});
    assert.equal(stopped.ok, true);
    const exitCode = await exitPromise;
    assert.equal(exitCode, 0);
  } finally {
    child.kill("SIGTERM");
    await rm(cwd, { recursive: true, force: true });
  }
}, 30000);

test("gRPC RunCommand auto-invokes skill execution through provider path", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-grpc-skill-"));
  let handle: Awaited<ReturnType<typeof startNexagentGrpcServer>> | null = null;
  try {
    await mkdir(path.join(cwd, ".codex", "skills", "demo-skill"), { recursive: true });
    await writeFile(path.join(cwd, ".codex", "skills", "demo-skill", "SKILL.md"), [
      "---",
      "name: demo-skill",
      "description: demo skill for grpc auto invoke",
      "---",
      "# Demo Skill",
      "",
      "When invoked, respond with demo skill done.",
    ].join("\n"));
    const session = await createGrpcTestSession(cwd);
    let capturedPrompt = "";
    handle = await startNexagentGrpcServer({
      session,
      host: "127.0.0.1",
      port: 0,
      providerExecutor: async (request) => {
        capturedPrompt = request.prompt;
        return {
          ok: true,
          provider: "codex",
          model: "gpt-5.3-codex-spark",
          transport: "codex",
          adapter: "codex-chatgpt-http",
          fallbackApplied: false,
          output: "demo skill done",
        };
      },
    });
    const client = createGrpcClient(handle.address);

    const result = await callGrpc(client, "runCommand", { input: "/skill demo-skill alpha beta" });
    assert.equal(result.ok, true, String(result.error));
    assert.match(String(result.output), /skill resolved: demo-skill/);
    assert.match(String(result.output), /demo skill done/);
    assert.match(capturedPrompt, /Execute active skill demo-skill now/);
    assert.match(capturedPrompt, /Args: alpha beta/);
    assert.equal(session.conversation[0]?.content, "/skill demo-skill alpha beta");
    assert.equal(session.conversation[1]?.content, "demo skill done");

    const stopped = await callGrpc(client, "stop", {});
    assert.equal(stopped.ok, true);
  } finally {
    await handle?.stop();
    await rm(cwd, { recursive: true, force: true });
  }
}, 30000);

test("gRPC RunCommand executes improve-codebase-architecture through Spark provider loop to completion", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-grpc-improve-architecture-"));
  let handle: Awaited<ReturnType<typeof startNexagentGrpcServer>> | null = null;
  try {
    await mkdir(path.join(cwd, ".codex", "skills", "improve-codebase-architecture"), { recursive: true });
    await mkdir(path.join(cwd, "src"), { recursive: true });
    await writeFile(path.join(cwd, "src", "provider.ts"), "export function provider() { return true; }\n");
    await writeFile(path.join(cwd, ".codex", "skills", "improve-codebase-architecture", "SKILL.md"), [
      "---",
      "name: improve-codebase-architecture",
      "description: Find deepening opportunities in a codebase.",
      "---",
      "# Improve Codebase Architecture",
      "",
      "Present five numbered deepening opportunities.",
      "Each opportunity includes Files, Problem, Solution, Benefits.",
      "Ask which candidate to explore.",
    ].join("\n"));
    const session = await createGrpcTestSession(cwd);
    session.cwd = cwd;
    session.repo.root = cwd;
    session.toolPolicy.allowedRoots = [cwd];
    session.providerRouting.modelSelection.configuredModels.codex = "gpt-5.3-codex-spark";
    session.providerTransport.mode = "codex-http";
    session.providerTransport.adapter = "codex-chatgpt-http";
    session.providerTransport.executor = "fetch";
    session.providerTransport.authSource = "codex-auth-json";
    session.providerTransport.authGate = "ready";
    session.providerTransport.openaiBaseUrl = "https://chatgpt.com/backend-api/codex";
    let providerCalls = 0;
    const partial = [
      "1. **Provider seam in `src/provider.ts`**",
      "**Problem:** orchestration is large.",
      "**Solution:** split module.",
      "**Benefits:** locality.",
      "2. **Transport policy in `src/provider.ts` and `src/models.ts`**",
      "**Problem:** policy coupling.",
      "**Solution:** extract adapter.",
      "**Benefits:** leverage.",
    ].join("\n");
    const complete = [
      "1. Provider policy Module",
      "**Files** - src/provider.ts",
      "**Problem** - policy mixed with execution.",
      "**Solution** - extract policy module.",
      "**Benefits** - better locality and leverage.",
      "2. Runtime turn Module\n**Files** - src/runtime/turn-run.ts\n**Problem** - final evidence spread.\n**Solution** - isolate completion contract.\n**Benefits** - smaller test surface.",
      "3. Tool adapter Module\n**Files** - src/runtime/tools.ts\n**Problem** - aliases leak.\n**Solution** - adapter contract.\n**Benefits** - stronger leverage.",
      "4. Prompt contract Module\n**Files** - src/runtime/prompt-v2.ts\n**Problem** - prompt rules drift.\n**Solution** - explicit contract builder.\n**Benefits** - cleaner locality.",
      "5. OpenTUI shell Module\n**Files** - src/opentui/App.tsx\n**Problem** - input and rendering coupled.\n**Solution** - shell adapter seam.\n**Benefits** - test leverage.",
      "Which of these would you like to explore?",
    ].join("\n");

    handle = await startNexagentGrpcServer({
      session,
      host: "127.0.0.1",
      port: 0,
      providerExecutor: (request) => executeProviderRequest(request, {
        exec: async () => {
          throw new Error("exec transport should not be used");
        },
        http: async () => {
          throw new Error("openai http transport should not be used");
        },
        codexHttp: async () => {
          providerCalls += 1;
          return {
            exitCode: 0,
            stdout: "",
            stderr: "",
            output: providerCalls === 1 ? partial : complete,
          };
        },
      }),
    });
    const client = createGrpcClient(handle.address);

    const result = await callGrpc(client, "runCommand", { input: "/skill improve-codebase-architecture" });

    assert.equal(result.ok, true, String(result.error));
    assert.match(String(result.output), /skill resolved: improve-codebase-architecture/);
    assert.match(String(result.output), /5\. OpenTUI shell Module/);
    assert.match(String(result.output), /Which of these would you like to explore\?/);
    assert.equal(providerCalls, 2);
    assert.equal(
      session.events.some((event) => event.kind === "tool" && event.summary === "tool nexsight_gather completed"),
      true,
    );
    assert.equal(
      session.events.some((event) => event.kind === "control" && event.summary === "required active skill output nudge applied"),
      true,
    );
    assert.equal(session.conversation[0]?.content, "/skill improve-codebase-architecture");
    assert.match(session.conversation[1]?.content ?? "", /5\. OpenTUI shell Module/);

    const stopped = await callGrpc(client, "stop", {});
    assert.equal(stopped.ok, true);
  } finally {
    await handle?.stop();
    await rm(cwd, { recursive: true, force: true });
  }
}, 30000);

async function createGrpcTestSession(cwd: string): Promise<RuntimeSession> {
  const runtime = await bootstrapRuntime(cwd);
  const session = createRuntimeSession(runtime);
  applyYoloMode(session);
  return session;
}

function createGrpcClient(address: string): UnaryClient {
  const packageDefinition = protoLoader.loadSync(path.resolve("proto/nexagent.proto"), {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(packageDefinition) as Record<string, unknown>;
  const service = (((loaded.nexagent as Record<string, unknown>).v1 as Record<string, unknown>).NexagentService) as grpc.ServiceClientConstructor;
  return new service(address, grpc.credentials.createInsecure()) as unknown as UnaryClient;
}

function callGrpc(client: UnaryClient, method: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    client[method]?.(request, (error, response) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(response);
    });
  });
}

function readGrpcAddress(child: ReturnType<typeof spawn>): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("timed out waiting for grpc address")), 15000);
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
      const match = stdout.match(/nexagent grpc listening ([^\s]+)/);
      if (match?.[1]) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`grpc server exited before listening: ${String(code)} ${stderr}`));
    });
  });
}

function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return new Promise((resolve) => {
    child.once("exit", (code) => resolve(code));
  });
}
