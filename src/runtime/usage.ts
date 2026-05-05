import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import type { RuntimeSession } from "./session.js";

export interface PiUsageMessage {
  sessionId: string;
  provider: string;
  model: string;
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  timestamp: number;
}

export interface UsageStats {
  sessions: Set<string>;
  messages: number;
  cost: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  providers: Map<string, UsageProviderStats>;
}

export interface UsageProviderStats extends Omit<UsageStats, "providers"> {
  models: Map<string, Omit<UsageStats, "providers">>;
}

export function recordPiUsageMessage(session: RuntimeSession): void {
  try {
    const input = Math.max(0, session.telemetry.lastInputTokens);
    const output = Math.max(0, session.telemetry.lastOutputTokens);
    if (input === 0 && output === 0) {
      return;
    }
    const usagePath = getNexagentUsageFilePath(session);
    mkdirSync(path.dirname(usagePath), { recursive: true });
    if (!usageFileHasSessionHeader(usagePath)) {
      appendFileSync(usagePath, `${JSON.stringify({ type: "session", id: session.id, timestamp: session.startedAt })}\n`, "utf8");
    }
    const timestamp = Date.now();
    appendFileSync(usagePath, `${JSON.stringify({
      type: "message",
      timestamp: new Date(timestamp).toISOString(),
      message: {
        role: "assistant",
        provider: session.providerTransport.activeProvider,
        model: getUsageModel(session),
        timestamp,
        usage: {
          input,
          output,
          cacheRead: 0,
          cacheWrite: 0,
          cost: { total: 0 },
        },
      },
    })}\n`, "utf8");
  } catch {
    // Usage telemetry is best-effort. Turns must not fail because usage storage is read-only.
  }
}

export function loadPiUsageStats(cwd: string): UsageStats {
  const messages = loadPiUsageMessages(cwd);
  return aggregateUsageMessages(messages);
}

export function loadPiUsageMessages(cwd: string): PiUsageMessage[] {
  const files = collectJsonlFiles(getUsageSearchRoots(cwd));
  const seen = new Set<string>();
  return files.flatMap((file) => parsePiUsageFile(file, seen));
}

export function getNexagentUsageFilePath(session: RuntimeSession): string {
  return path.join(session.cwd, ".nexagent", "usage", "sessions", `${sanitizeFileSegment(session.id)}.jsonl`);
}

function getUsageSearchRoots(cwd: string): string[] {
  const roots = [
    path.join(cwd, ".nexagent", "usage", "sessions"),
    path.join(process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent"), "sessions"),
  ];
  return Array.from(new Set(roots));
}

function collectJsonlFiles(roots: string[]): string[] {
  const files: string[] = [];
  const visit = (dir: string): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        files.push(entryPath);
      }
    }
  };
  for (const root of roots) {
    visit(root);
  }
  return files.sort();
}

function parsePiUsageFile(filePath: string, seen: Set<string>): PiUsageMessage[] {
  const messages: PiUsageMessage[] = [];
  let sessionId = "";
  let content = "";
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return messages;
  }
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    try {
      const entry = JSON.parse(line) as {
        type?: string;
        id?: string;
        timestamp?: string;
        message?: {
          role?: string;
          provider?: string;
          model?: string;
          timestamp?: number;
          usage?: {
            input?: number;
            output?: number;
            cacheRead?: number;
            cacheWrite?: number;
            cost?: { total?: number };
          };
        };
      };
      if (entry.type === "session" && typeof entry.id === "string") {
        sessionId = entry.id;
        continue;
      }
      if (entry.type !== "message" || entry.message?.role !== "assistant") {
        continue;
      }
      const msg = entry.message;
      if (!msg.provider || !msg.model || !msg.usage) {
        continue;
      }
      const input = msg.usage.input || 0;
      const output = msg.usage.output || 0;
      const cacheRead = msg.usage.cacheRead || 0;
      const cacheWrite = msg.usage.cacheWrite || 0;
      const fallbackTs = entry.timestamp ? Date.parse(entry.timestamp) : 0;
      const timestamp = msg.timestamp || (Number.isNaN(fallbackTs) ? 0 : fallbackTs);
      const hash = `${timestamp}:${input + output + cacheRead + cacheWrite}`;
      if (seen.has(hash)) {
        continue;
      }
      seen.add(hash);
      messages.push({
        sessionId: sessionId || path.basename(filePath, ".jsonl"),
        provider: msg.provider,
        model: msg.model,
        cost: msg.usage.cost?.total || 0,
        input,
        output,
        cacheRead,
        cacheWrite,
        timestamp,
      });
    } catch {
      // Skip malformed JSONL rows.
    }
  }
  return messages;
}

function aggregateUsageMessages(messages: PiUsageMessage[]): UsageStats {
  const stats = emptyUsageStats();
  for (const msg of messages) {
    const providerStats = getOrCreateProviderStats(stats.providers, msg.provider);
    const modelStats = getOrCreateModelStats(providerStats.models, msg.model);
    accumulateUsage(modelStats, msg);
    accumulateUsage(providerStats, msg);
    accumulateUsage(stats, msg);
  }
  return stats;
}

function emptyUsageStats(): UsageStats {
  return {
    sessions: new Set(),
    messages: 0,
    cost: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    providers: new Map(),
  };
}

function emptyUsageLeaf(): Omit<UsageStats, "providers"> {
  return {
    sessions: new Set(),
    messages: 0,
    cost: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
}

function getOrCreateProviderStats(target: Map<string, UsageProviderStats>, provider: string): UsageProviderStats {
  let stats = target.get(provider);
  if (!stats) {
    stats = { ...emptyUsageLeaf(), models: new Map() };
    target.set(provider, stats);
  }
  return stats;
}

function getOrCreateModelStats(target: Map<string, Omit<UsageStats, "providers">>, model: string): Omit<UsageStats, "providers"> {
  let stats = target.get(model);
  if (!stats) {
    stats = emptyUsageLeaf();
    target.set(model, stats);
  }
  return stats;
}

function accumulateUsage(target: Omit<UsageStats, "providers">, msg: PiUsageMessage): void {
  target.sessions.add(msg.sessionId);
  target.messages += 1;
  target.cost += msg.cost;
  target.input += msg.input;
  target.output += msg.output;
  target.cacheRead += msg.cacheRead;
  target.cacheWrite += msg.cacheWrite;
}

function usageFileHasSessionHeader(filePath: string): boolean {
  try {
    return readFileSync(filePath, "utf8").split(/\r?\n/, 1)[0]?.includes('"type":"session"') === true;
  } catch {
    writeFileSync(filePath, "", { flag: "a" });
    return false;
  }
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_") || "session";
}

function getUsageModel(session: RuntimeSession): string {
  const provider = session.providerTransport.activeProvider;
  const configuredModels = session.providerRouting.modelSelection.configuredModels as Record<string, string | undefined>;
  return configuredModels[provider] ?? "unknown";
}
