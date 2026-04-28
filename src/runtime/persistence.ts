import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { RuntimeAuthState } from "./auth.js";
import type { RuntimeSession } from "./session.js";

export type PersistedTransportMode = "cli-exec" | "http-responses" | "codex-http";

export interface PersistedRuntimeState {
  provider?: string;
  providerModels?: Record<string, string>;
  transportMode?: PersistedTransportMode;
  commandModes?: PersistedCommandModes;
  operationControls?: PersistedOperationControls;
  auth?: RuntimeAuthState;
  savedAt: string;
}

export interface PersistedCommandModes {
  cavemanMode?: boolean;
  deadpoolMode?: boolean;
  statusline?: boolean;
  mouseMode?: "auto" | "scroll" | "select";
}

export interface PersistedOperationControls {
  requireApprovalForGuarded?: boolean;
}

export interface SavePersistedRuntimeStateOptions {
  persistCurrentApproval?: boolean;
}

const SESSION_STATE_FILE = path.join(".nexagent", "session.json");
const PROMPT_HISTORY_FILE = path.join(".nexagent", "history.json");

export async function loadPersistedRuntimeState(cwd: string): Promise<PersistedRuntimeState | null> {
  try {
    const raw = readFileSync(path.join(cwd, SESSION_STATE_FILE), "utf8");
    return normalizePersistedRuntimeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function savePersistedRuntimeState(session: RuntimeSession, options: SavePersistedRuntimeStateOptions = {}): void {
  try {
    const requireApprovalForGuarded = session.operationControls.yoloMode && !options.persistCurrentApproval
      ? session.operationDefaults.requireApprovalForGuarded
      : session.operationControls.requireApprovalForGuarded;
    const state: PersistedRuntimeState = {
      provider: session.providerTransport.activeProvider,
      providerModels: Object.fromEntries(
        Object.entries(session.providerRouting.modelSelection.configuredModels)
          .filter(([, model]) => typeof model === "string" && model.trim().length > 0),
      ),
      transportMode: session.providerTransport.mode,
      commandModes: {
        cavemanMode: session.commandModes.cavemanMode,
        deadpoolMode: session.commandModes.deadpoolMode,
        statusline: session.commandModes.statusline,
        mouseMode: session.commandModes.mouseMode,
      },
      operationControls: {
        requireApprovalForGuarded,
      },
      auth: session.auth,
      savedAt: new Date().toISOString(),
    };
    const targetPath = path.join(session.cwd, SESSION_STATE_FILE);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    // Persistence is best-effort. Runtime commands should still work if session cwd is read-only.
  }
}

export function loadPersistedPromptHistory(cwd: string): string[] {
  try {
    const raw = readFileSync(path.join(cwd, PROMPT_HISTORY_FILE), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      .slice(-100);
  } catch {
    return [];
  }
}

export function savePersistedPromptHistory(cwd: string, history: string[]): void {
  try {
    const targetPath = path.join(cwd, PROMPT_HISTORY_FILE);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(
      targetPath,
      `${JSON.stringify(history.filter((entry) => entry.trim().length > 0).slice(-100), null, 2)}\n`,
      "utf8",
    );
  } catch {
    // best-effort only
  }
}

function normalizePersistedRuntimeState(value: unknown): PersistedRuntimeState | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  return {
    provider: typeof candidate.provider === "string" ? candidate.provider : undefined,
    providerModels: normalizeProviderModels(candidate.providerModels),
    transportMode:
      candidate.transportMode === "http-responses"
        ? "http-responses"
        : candidate.transportMode === "codex-http"
          ? "codex-http"
          : candidate.transportMode === "cli-exec"
            ? "cli-exec"
            : undefined,
    commandModes: normalizeCommandModes(candidate.commandModes),
    operationControls: normalizeOperationControls(candidate.operationControls),
    auth: normalizePersistedAuth(candidate.auth),
    savedAt: typeof candidate.savedAt === "string" ? candidate.savedAt : new Date(0).toISOString(),
  };
}

function normalizeOperationControls(value: unknown): PersistedOperationControls | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const controls = value as Record<string, unknown>;
  return {
    requireApprovalForGuarded: controls.requireApprovalForGuarded === true,
  };
}

function normalizeCommandModes(value: unknown): PersistedCommandModes | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const modes = value as Record<string, unknown>;
  return {
    cavemanMode: modes.cavemanMode === true,
    deadpoolMode: modes.deadpoolMode === true,
    statusline: modes.statusline === true,
    mouseMode:
      modes.mouseMode === "scroll"
        ? "scroll"
        : modes.mouseMode === "select"
          ? "select"
          : "auto",
  };
}

function normalizePersistedAuth(value: unknown): RuntimeAuthState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const auth = value as Record<string, unknown>;
  if (auth.provider !== "codex") {
    return undefined;
  }

  return {
    provider: "codex",
    available: Boolean(auth.available),
    loggedIn: Boolean(auth.loggedIn),
    method: typeof auth.method === "string" ? auth.method : null,
    status: typeof auth.status === "string" ? auth.status : "Auth status unavailable",
    checkedAt: typeof auth.checkedAt === "string" ? auth.checkedAt : null,
  };
}

function normalizeProviderModels(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const entries = Object.entries(candidate)
    .filter(([, model]) => typeof model === "string" && model.trim().length > 0)
    .map(([provider, model]) => [provider, String(model).trim()]);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
