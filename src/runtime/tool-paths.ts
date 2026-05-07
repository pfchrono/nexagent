import path from "node:path";

import {
  validateReadToolPath as validateReadPathPolicy,
  validateRepoToolPath as validateRepoPathPolicy,
  validateWriteToolPath as validateWritePathPolicy,
} from "./policy.js";
import type { RuntimeSession } from "./session.js";

export function resolveRepoPath(session: RuntimeSession, inputPath?: string): string {
  if (!inputPath || inputPath === ".") {
    return session.cwd;
  }
  return path.resolve(session.cwd, expandHomePath(inputPath));
}

function expandHomePath(inputPath: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!home) {
    return inputPath;
  }
  if (inputPath === "~") {
    return home;
  }
  if (inputPath.startsWith("~/")) {
    return path.join(home, inputPath.slice(2));
  }
  return inputPath;
}

export function validateRepoToolPath(session: RuntimeSession, targetPath: string): string | null {
  return validateRepoPathPolicy(session, targetPath);
}

export function validateReadToolPath(session: RuntimeSession, targetPath: string): string | null {
  return validateReadPathPolicy(session, targetPath);
}

export function validateWriteToolPath(session: RuntimeSession, targetPath: string): string | null {
  return validateWritePathPolicy(session, targetPath);
}
