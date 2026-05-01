import path from "node:path";

import type { RuntimeSession } from "./session.js";

export const BLOCKED_SHELL_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\brm\s+-r\b/i,
  /\bmv\b\s+.+\s+\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)(?:\/|$)/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /\bdd\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\b/i,
  /\bfind\b[\s\S]*\b-delete\b/i,
  />\s*\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)(?:\/|$)/,
  /\|\s*sh\b/i,
  /\|\s*bash\b/i,
] as const;

function normalizeRoot(root: string): string {
  return path.resolve(root);
}

export function isWithinRoot(candidate: string, root: string): boolean {
  const relative = path.relative(normalizeRoot(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateReadToolPath(session: RuntimeSession, targetPath: string): string | null {
  const resolvedPath = path.resolve(targetPath);

  for (const protectedRoot of session.toolPolicy.protectedRoots) {
    if (isWithinRoot(resolvedPath, protectedRoot)) {
      return `tool policy blocked ${resolvedPath}; protected path`;
    }
  }

  const readRoots = session.toolPolicy.readRoots ?? [];
  if (readRoots.length === 0 || readRoots.some((root) => isWithinRoot(resolvedPath, root))) {
    return null;
  }

  return `tool policy blocked ${resolvedPath}; outside readable workspace roots`;
}

export function validateWriteToolPath(session: RuntimeSession, targetPath: string): string | null {
  const resolvedPath = path.resolve(targetPath);

  for (const protectedRoot of session.toolPolicy.protectedRoots) {
    if (isWithinRoot(resolvedPath, protectedRoot)) {
      return `tool policy blocked ${resolvedPath}; protected path`;
    }
  }

  if (session.toolPolicy.allowedRoots.some((root) => isWithinRoot(resolvedPath, root))) {
    return null;
  }

  if (session.operationControls.yoloMode) {
    const writeRoots = session.toolPolicy.readRoots ?? [];
    if (writeRoots.length === 0 || writeRoots.some((root) => isWithinRoot(resolvedPath, root))) {
      return null;
    }
    return `tool policy blocked ${resolvedPath}; outside yolo workspace roots`;
  }

  return `tool policy blocked ${resolvedPath}; outside repo-local roots`;
}

export function validateRepoToolPath(session: RuntimeSession, targetPath: string): string | null {
  return validateWriteToolPath(session, targetPath);
}

export function findBlockedShellPattern(command: string): RegExp | null {
  return BLOCKED_SHELL_PATTERNS.find((pattern) => pattern.test(command)) ?? null;
}
