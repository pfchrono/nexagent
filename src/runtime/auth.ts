import { spawn, spawnSync } from "node:child_process";

export interface RuntimeAuthState {
  provider: "codex";
  available: boolean;
  loggedIn: boolean;
  method: string | null;
  status: string;
  checkedAt: string | null;
}

export interface RuntimeAuthRefreshResult {
  auth: RuntimeAuthState;
  launched: boolean;
  exitCode: number;
}

const CODEX_BIN = process.env.NEXAGENT_CODEX_BIN || "codex";

export async function probeCodexAuthState(): Promise<RuntimeAuthState> {
  try {
    const result = await spawnAndCollect(CODEX_BIN, ["login", "status"]);
    return parseCodexAuthResult(result.exitCode, result.stdout, result.stderr);
  } catch (error) {
    return unavailableAuthState(error instanceof Error ? error.message : String(error));
  }
}

export function probeCodexAuthStateSync(): RuntimeAuthState {
  try {
    const result = spawnSync(CODEX_BIN, ["login", "status"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    return parseCodexAuthResult(result.status ?? 1, result.stdout ?? "", result.stderr ?? "");
  } catch (error) {
    return unavailableAuthState(error instanceof Error ? error.message : String(error));
  }
}

export function launchCodexLogin(cwd: string): RuntimeAuthRefreshResult {
  try {
    const result = spawnSync(CODEX_BIN, ["login"], {
      cwd,
      stdio: "inherit",
    });

    return {
      auth: probeCodexAuthStateSync(),
      launched: true,
      exitCode: result.status ?? 1,
    };
  } catch (error) {
    return {
      auth: unavailableAuthState(error instanceof Error ? error.message : String(error)),
      launched: false,
      exitCode: 1,
    };
  }
}

function parseCodexAuthResult(exitCode: number, stdout: string, stderr: string): RuntimeAuthState {
  const output = [stdout.trim(), stderr.trim()].filter((value) => value.length > 0).join("\n").trim();

  if (exitCode === 0) {
    return {
      provider: "codex",
      available: true,
      loggedIn: true,
      method: extractMethod(output),
      status: output || "Logged in",
      checkedAt: new Date().toISOString(),
    };
  }

  const normalized = output.toLowerCase();
  if (normalized.includes("not logged in") || normalized.includes("login required") || normalized.includes("authenticate")) {
    return {
      provider: "codex",
      available: true,
      loggedIn: false,
      method: null,
      status: output || "Not logged in",
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    provider: "codex",
    available: true,
    loggedIn: false,
    method: null,
    status: output || "Auth status unavailable",
    checkedAt: new Date().toISOString(),
  };
}

function extractMethod(output: string): string | null {
  const match = output.match(/logged in using\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}

function unavailableAuthState(detail: string): RuntimeAuthState {
  return {
    provider: "codex",
    available: false,
    loggedIn: false,
    method: null,
    status: `codex unavailable${detail ? `: ${detail}` : ""}`,
    checkedAt: new Date().toISOString(),
  };
}

async function spawnAndCollect(command: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      });
    });
  });
}
