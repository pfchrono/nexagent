import path from "node:path";
import { parse, type ShellQuoteParseEntry } from "shell-quote";

import type { RuntimeSession } from "./session.js";

export const BLOCKED_SHELL_PATTERNS = [
  /\brm\s+-r[f]?\s+\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)(?:\/|$)/i,
  /\bmv\b\s+.+\s+\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)(?:\/|$)/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bmkfs\b/i,
  /\bdd\b[\s\S]*\bof=\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)(?:\/|$)/i,
  /\bfind\b[\s\S]*\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)(?:\/|$)[\s\S]*\b-delete\b/i,
  />\s*\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)(?:\/|$)/,
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

  const readableWriteRoots = session.toolPolicy.readRoots ?? [];
  if (readableWriteRoots.length > 0 && readableWriteRoots.some((root) => isWithinRoot(resolvedPath, root))) {
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
  return analyzeBlockedShellCommand(command)?.pattern ?? null;
}

export interface ShellPolicyBlockAnalysis {
  pattern: RegExp;
  matchedText: string | null;
  reason: string;
  advice: string;
}

export function analyzeBlockedShellCommand(command: string): ShellPolicyBlockAnalysis | null {
  const parsed = analyzeParsedShellCommand(command);
  if (parsed !== undefined) {
    return parsed;
  }

  for (const pattern of BLOCKED_SHELL_PATTERNS) {
    const match = pattern.exec(command);
    if (!match) {
      continue;
    }
    return {
      pattern,
      matchedText: match[0] ?? null,
      reason: describeBlockedShellPattern(pattern),
      advice: adviseForBlockedShellPattern(pattern),
    };
  }
  return null;
}

function analyzeParsedShellCommand(command: string): ShellPolicyBlockAnalysis | null | undefined {
  let entries: ShellQuoteParseEntry[];
  try {
    entries = parse(command);
  } catch {
    return undefined;
  }

  const tokens = entries.filter((entry) => !(isOperator(entry) && entry.op === ";"));
  for (let index = 0; index < tokens.length; index += 1) {
    const entry = tokens[index];
    if (isOperator(entry) && isRedirectOperator(entry.op)) {
      const target = tokens[index + 1];
      if (typeof target === "string" && isProtectedShellPath(target)) {
        return {
          pattern: />\s*\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)(?:\/|$)/,
          matchedText: `${entry.op} ${target}`,
          reason: "redirect writes into protected system roots",
          advice: adviseForBlockedShellPattern(/>\s*\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)(?:\/|$)/),
        };
      }
    }
  }

  for (const commandTokens of splitShellCommands(tokens)) {
    const name = commandTokens[0]?.toLowerCase();
    if (!name) {
      continue;
    }
    if (name === "rm"
      && commandTokens.slice(1).some((token) => /^-[^-]*r/.test(token) || token === "--recursive")
      && commandTokens.slice(1).some(isProtectedShellPath)) {
      return {
        pattern: /\brm\s+-r[f]?\s+\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)(?:\/|$)/i,
        matchedText: commandTokens.join(" "),
        reason: "recursive remove targets protected system roots",
        advice: adviseForBlockedShellPattern(/\brm\s+-r[f]?\s+\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)(?:\/|$)/i),
      };
    }
    if (name === "mv" && commandTokens.length > 2 && isProtectedShellPath(commandTokens[commandTokens.length - 1] ?? "")) {
      return {
        pattern: /\bmv\b\s+.+\s+\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)(?:\/|$)/i,
        matchedText: commandTokens.join(" "),
        reason: "move into protected system roots is blocked",
        advice: "Use write_file/apply_patch inside workspace; never move files into protected roots.",
      };
    }
    if ((name === "chmod" || name === "chown") && commandTokens.slice(1).some(isProtectedShellPath)) {
      return {
        pattern: new RegExp(`\\b${name}\\b`, "i"),
        matchedText: commandTokens.join(" "),
        reason: "permission mutation targets protected system roots",
        advice: "Do not change permissions or ownership under protected OS roots.",
      };
    }
    if (["shutdown", "reboot", "mkfs"].includes(name)) {
      return {
        pattern: new RegExp(`\\b${name}\\b`, "i"),
        matchedText: name,
        reason: describeBlockedShellPattern(new RegExp(`\\b${name}\\b`, "i")),
        advice: adviseForBlockedShellPattern(new RegExp(`\\b${name}\\b`, "i")),
      };
    }
    if (name === "dd" && commandTokens.some((token) => /^of=/.test(token) && isProtectedShellPath(token.slice(3)))) {
      return {
        pattern: /\bdd\b[\s\S]*\bof=\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)(?:\/|$)/i,
        matchedText: commandTokens.join(" "),
        reason: "raw disk/file write targets protected system roots",
        advice: "Do not run raw writes against protected OS roots.",
      };
    }
    if (name === "find" && commandTokens.includes("-delete") && commandTokens.slice(1).some(isProtectedShellPath)) {
      return {
        pattern: /\bfind\b[\s\S]*\b-delete\b/i,
        matchedText: "find -delete",
        reason: "find -delete targets protected system roots",
        advice: adviseForBlockedShellPattern(/\bfind\b[\s\S]*\b-delete\b/i),
      };
    }
  }

  return null;
}

function splitShellCommands(tokens: ShellQuoteParseEntry[]): string[][] {
  const commands: string[][] = [];
  let current: string[] = [];
  for (const token of tokens) {
    if (typeof token === "string") {
      current.push(token);
      continue;
    }
    if (isOperator(token) && ["&&", "||", "|", ";"].includes(token.op)) {
      if (current.length > 0) {
        commands.push(current);
        current = [];
      }
    }
  }
  if (current.length > 0) {
    commands.push(current);
  }
  return commands;
}

function isOperator(entry: ShellQuoteParseEntry): entry is { op: string } {
  return typeof entry === "object" && entry !== null && "op" in entry;
}

function isRedirectOperator(operator: string): boolean {
  return operator === ">" || operator === ">>" || operator === ">|" || operator === "&>" || operator === "2>" || operator === "2>>";
}

function isProtectedShellPath(value: string): boolean {
  return /^\/(?:etc|usr|bin|sbin|var|opt|lib|boot|dev|proc|sys|run)(?:\/|$)/.test(value);
}

function describeBlockedShellPattern(pattern: RegExp): string {
  const source = pattern.source;
  if (source.includes(">\\s*\\/")) {
    return "redirect writes into protected system roots";
  }
  if (source.includes("rm\\s+-rf") || source.includes("rm\\s+-r")) {
    return "recursive remove targets protected system roots";
  }
  if (source.includes("chmod") || source.includes("chown")) {
    return "permission mutation targets protected system roots";
  }
  if (source.includes("shutdown") || source.includes("reboot") || source.includes("mkfs")) {
    return "OS-level destructive command is blocked";
  }
  if (source.includes("\\bdd")) {
    return "raw disk/file write targets protected system roots";
  }
  if (source.includes("find") && source.includes("-delete")) {
    return "find -delete targets protected system roots";
  }
  return "protected system path mutation matched";
}

function adviseForBlockedShellPattern(pattern: RegExp): string {
  const source = pattern.source;
  if (source.includes(">\\s*\\/")) {
    return "Use write_file/apply_patch inside workspace; never redirect into /etc, /usr, /bin, /var, or other protected roots.";
  }
  if (source.includes("rm\\s+-rf") || source.includes("rm\\s+-r") || source.includes("find") && source.includes("-delete")) {
    return "Do not delete protected OS roots.";
  }
  return "Avoid mutating protected OS roots.";
}
