import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_NEXAGENT_HOME = ".nexagent";

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
