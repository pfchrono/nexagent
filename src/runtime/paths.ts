import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_NEXAGENT_HOME = ".nexagent";
const DEFAULT_NEXAGENT_SESSION_DIR = path.join(".nexagent", "usage", "sessions");
const PROTECTED_SESSION_ROOTS = [
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/sys",
  "/usr",
  "/var",
];

export function resolveNexagentHome(): string {
  const configuredHome = process.env.NEXAGENT_HOME?.trim();
  if (configuredHome) {
    return resolveUserPath(configuredHome);
  }
  return path.join(homedir(), DEFAULT_NEXAGENT_HOME);
}

export function resolveUserPath(value: string): string {
  if (value === "~") {
    return homedir();
  }
  if (value.startsWith("~/")) {
    return path.join(homedir(), value.slice(2));
  }
  return value;
}

export function resolvePathFromBase(baseDir: string, value: string): string {
  const expanded = resolveUserPath(value);
  return path.isAbsolute(expanded) ? expanded : path.join(baseDir, expanded);
}

export function resolveNexagentSessionDir(cwd: string): string {
  const configuredSessionDir = process.env.NEXAGENT_SESSION_DIR?.trim();
  if (configuredSessionDir) {
    const resolvedSessionDir = path.resolve(resolvePathFromBase(cwd, configuredSessionDir));
    if (!isProtectedSessionPath(resolvedSessionDir)) {
      return resolvedSessionDir;
    }
  }
  return path.join(cwd, DEFAULT_NEXAGENT_SESSION_DIR);
}

function isProtectedSessionPath(candidate: string): boolean {
  return PROTECTED_SESSION_ROOTS.some((root) => {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  });
}
