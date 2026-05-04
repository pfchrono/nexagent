import path from "node:path";
import { parse, type ShellQuoteParseEntry } from "shell-quote";

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
    if (isOperator(entry) && entry.op === "|") {
      const nextCommand = nextStringToken(tokens, index + 1);
      if (nextCommand && /^(?:sh|bash)$/.test(path.basename(nextCommand).toLowerCase())) {
        return {
          pattern: /\|\s*bash\b/i,
          matchedText: `| ${nextCommand}`,
          reason: "piping remote or generated text into a shell is blocked",
          advice: adviseForBlockedShellPattern(/\|\s*bash\b/i),
        };
      }
    }
  }

  for (const commandTokens of splitShellCommands(tokens)) {
    const name = commandTokens[0]?.toLowerCase();
    if (!name) {
      continue;
    }
    if (name === "rm" && commandTokens.slice(1).some((token) => /^-[^-]*r/.test(token) || token === "--recursive")) {
      return {
        pattern: /\brm\s+-rf\b/i,
        matchedText: commandTokens.slice(0, 2).join(" "),
        reason: "recursive remove is destructive",
        advice: adviseForBlockedShellPattern(/\brm\s+-rf\b/i),
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
    if (["chmod", "chown", "sudo", "su", "shutdown", "reboot", "mkfs", "dd"].includes(name)) {
      return {
        pattern: new RegExp(`\\b${name}\\b`, "i"),
        matchedText: name,
        reason: describeBlockedShellPattern(new RegExp(`\\b${name}\\b`, "i")),
        advice: adviseForBlockedShellPattern(new RegExp(`\\b${name}\\b`, "i")),
      };
    }
    if (name === "git" && commandTokens[1] === "push") {
      return {
        pattern: /\bgit\s+push\b/i,
        matchedText: "git push",
        reason: "network publish is blocked from guarded shell",
        advice: adviseForBlockedShellPattern(/\bgit\s+push\b/i),
      };
    }
    if (name === "git" && commandTokens[1] === "reset" && commandTokens.includes("--hard")) {
      return {
        pattern: /\bgit\s+reset\s+--hard\b/i,
        matchedText: "git reset --hard",
        reason: "git destructive cleanup/reset is blocked",
        advice: adviseForBlockedShellPattern(/\bgit\s+reset\s+--hard\b/i),
      };
    }
    if (name === "git" && commandTokens[1] === "clean") {
      return {
        pattern: /\bgit\s+clean\b/i,
        matchedText: "git clean",
        reason: "git destructive cleanup/reset is blocked",
        advice: adviseForBlockedShellPattern(/\bgit\s+clean\b/i),
      };
    }
    if (name === "find" && commandTokens.includes("-delete")) {
      return {
        pattern: /\bfind\b[\s\S]*\b-delete\b/i,
        matchedText: "find -delete",
        reason: "find -delete is destructive",
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

function nextStringToken(tokens: ShellQuoteParseEntry[], start: number): string | null {
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (typeof token === "string") {
      return token;
    }
    if (isOperator(token) && ["&&", "||", ";"].includes(token.op)) {
      return null;
    }
  }
  return null;
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
    return "recursive remove is destructive";
  }
  if (source.includes("git\\s+reset") || source.includes("git\\s+clean")) {
    return "git destructive cleanup/reset is blocked";
  }
  if (source.includes("git\\s+push")) {
    return "network publish is blocked from guarded shell";
  }
  if (source.includes("chmod") || source.includes("chown") || source.includes("sudo") || source.includes("su")) {
    return "privilege or permission mutation is blocked";
  }
  if (source.includes("\\|\\s*sh") || source.includes("\\|\\s*bash")) {
    return "piping remote or generated text into a shell is blocked";
  }
  if (source.includes("find") && source.includes("-delete")) {
    return "find -delete is destructive";
  }
  return "destructive shell pattern matched";
}

function adviseForBlockedShellPattern(pattern: RegExp): string {
  const source = pattern.source;
  if (source.includes(">\\s*\\/")) {
    return "Use write_file/apply_patch inside workspace; never redirect into /etc, /usr, /bin, /var, or other protected roots.";
  }
  if (source.includes("rm\\s+-rf") || source.includes("rm\\s+-r") || source.includes("find") && source.includes("-delete")) {
    return "Use guarded file tools for scoped edits, or ask operator for explicit cleanup target before deleting.";
  }
  if (source.includes("git\\s+reset") || source.includes("git\\s+clean")) {
    return "Use git_diff/git_status and apply_patch; do not discard work from shell.";
  }
  if (source.includes("\\|\\s*sh") || source.includes("\\|\\s*bash")) {
    return "Download/read script first, inspect it, then run explicit safe commands.";
  }
  return "Use the narrow internal tool for the intended change, or run a non-destructive inspection command.";
}
