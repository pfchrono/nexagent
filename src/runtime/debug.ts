import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

export interface RuntimeDebugState {
  enabled: boolean;
  verbose: boolean;
  logPath: string | null;
}

export interface RuntimeDebugOptions {
  enabled: boolean;
  verbose: boolean;
  debugFile: string | null;
}

export function createRuntimeDebugState(): RuntimeDebugState {
  return {
    enabled: false,
    verbose: false,
    logPath: null,
  };
}

export function initializeRuntimeDebug(options: RuntimeDebugOptions): RuntimeDebugState {
  const enabled = options.enabled || options.debugFile !== null || options.verbose;
  const state: RuntimeDebugState = {
    enabled,
    verbose: options.verbose,
    logPath: enabled ? resolveDebugLogPath(options.debugFile) : null,
  };
  if (state.logPath) {
    mkdirSync(path.dirname(state.logPath), { recursive: true });
    writeFileSync(state.logPath, `[${new Date().toISOString()}] debug log started\n`, { flag: "a" });
  }
  return state;
}

export function writeDebugLog(
  state: RuntimeDebugState,
  event: string,
  detail: Record<string, unknown> = {},
  options: { verboseOnly?: boolean } = {},
): void {
  if (!state.enabled || !state.logPath || (options.verboseOnly && !state.verbose)) {
    return;
  }
  const record = {
    at: new Date().toISOString(),
    event,
    ...detail,
  };
  appendFileSync(state.logPath, `${JSON.stringify(record)}\n`);
}

export function resolveDebugLogPath(input: string | null, now = new Date()): string {
  if (!input) {
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    return path.join(tmpdir(), `nexagent-debug-${stamp}.log`);
  }

  const safeBase = path.join(homedir(), ".nexagent", "debug");
  const rawPath = path.isAbsolute(input) ? path.resolve(input) : path.resolve(safeBase, input);
  if (!isPathInside(rawPath, homedir()) && !isPathInside(rawPath, tmpdir())) {
    throw new Error(`debug file must be under ${homedir()} or ${tmpdir()}`);
  }
  if (!rawPath.endsWith(".log")) {
    throw new Error("debug file must end with .log");
  }
  return rawPath;
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
