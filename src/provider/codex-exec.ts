import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { RuntimeSession } from "../runtime/session.js";

export interface CodexExecInvocation {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
}

export interface CodexExecAdapter {
  id: "codex-cli-exec";
  transport: "codex";
  mode: "cli-exec";
  authSource: "codex-login";
  command: string;
  supportsProviders: readonly ["codex", "openai"];
}

export const CODEX_EXEC_ADAPTER: CodexExecAdapter = {
  id: "codex-cli-exec",
  transport: "codex",
  mode: "cli-exec",
  authSource: "codex-login",
  command: process.env.NEXAGENT_CODEX_BIN || "codex",
  supportsProviders: ["codex", "openai"],
};

const DEFAULT_CODEX_EXEC_TIMEOUT_MS = 30_000;

export async function invokeCodexExecTransport(request: { session: RuntimeSession; prompt: string; abortSignal?: AbortSignal }, model: string | null): Promise<CodexExecInvocation> {
  const scratchDir = await mkdtemp(path.join(tmpdir(), "nexagent-codex-"));
  const outputPath = path.join(scratchDir, "last-message.txt");
  const args = [
    "exec",
    "--json",
    "--output-last-message",
    outputPath,
    "--skip-git-repo-check",
    "-C",
    request.session.cwd,
  ];

  if (model) {
    args.push("--model", model);
  }

  try {
    const { exitCode, stdout, stderr } = await spawnAndCollect(
      CODEX_EXEC_ADAPTER.command,
      args,
      request.prompt,
      request.session.cwd,
      createProviderEnv(request.session),
      getCodexExecTimeoutMs(),
      request.abortSignal,
    );
    const output = await readOutputFile(outputPath);
    return { exitCode, stdout, stderr, output };
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}

function createProviderEnv(session: RuntimeSession): NodeJS.ProcessEnv {
  const openaiBaseUrl = session.providerRouting.transport.openaiBaseUrl;

  if (!openaiBaseUrl) {
    return process.env;
  }

  return {
    ...process.env,
    OPENAI_BASE_URL: openaiBaseUrl,
  };
}

async function readOutputFile(outputPath: string): Promise<string> {
  try {
    return await readFile(outputPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function spawnAndCollect(
  command: string,
  args: string[],
  input: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const abortHandler = () => {
      if (settled) {
        return;
      }
      stderr += `${stderr.length > 0 ? "\n" : ""}operation canceled by operator`;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
    };

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      stderr += `${stderr.length > 0 ? "\n" : ""}codex exec timed out after ${String(timeoutMs)}ms`;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 500).unref();
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      abortSignal?.removeEventListener("abort", abortHandler);
      reject(error);
    });
    child.once("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      abortSignal?.removeEventListener("abort", abortHandler);
      resolve({
        exitCode: exitCode ?? (stderr.includes("timed out") ? 124 : 1),
        stdout,
        stderr,
      });
    });

    abortSignal?.addEventListener("abort", abortHandler, { once: true });

    child.stdin.end(input);
  });
}

function getCodexExecTimeoutMs(): number {
  const raw = Number(process.env.NEXAGENT_CODEX_TIMEOUT_MS ?? "");
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_CODEX_EXEC_TIMEOUT_MS;
}
