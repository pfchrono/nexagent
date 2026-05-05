import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  queueOperatorSteer,
  recordRuntimeEvent,
  type RuntimeSession,
} from "./session.js";

export type RuntimeSubagentStatus = "queued" | "running" | "completed" | "failed" | "stopped";

export interface RuntimeSubagentRecord {
  id: string;
  type: string;
  description: string;
  prompt: string;
  status: RuntimeSubagentStatus;
  background: boolean;
  inheritContext: boolean;
  model?: string;
  thinking?: string;
  result: string | null;
  error: string | null;
  steerMessages: string[];
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  inputTokens: number;
  outputTokens: number;
}

export interface RuntimeSubagentType {
  name: string;
  description: string;
  prompt: string;
  tools: string;
  source: "default" | "project" | "global";
}

export interface RuntimeSubagentState {
  agents: RuntimeSubagentRecord[];
  types: RuntimeSubagentType[];
  nextId: number;
  updatedAt: string | null;
}

const SUBAGENT_LIMIT = 24;
const runningAgents = new WeakMap<RuntimeSession, Map<string, Promise<void>>>();

export function createRuntimeSubagentState(value?: Partial<RuntimeSubagentState> | null, cwd = process.cwd()): RuntimeSubagentState {
  const agents = Array.isArray(value?.agents)
    ? value.agents.map(normalizeSubagentRecord).filter((agent): agent is RuntimeSubagentRecord => Boolean(agent)).slice(-SUBAGENT_LIMIT)
    : [];
  const maxId = agents.reduce((max, agent) => Math.max(max, Number(agent.id.replace(/^agent-/, "")) || 0), 0);
  return {
    agents,
    types: discoverSubagentTypes(cwd),
    nextId: Math.max(typeof value?.nextId === "number" && Number.isFinite(value.nextId) ? Math.floor(value.nextId) : 1, maxId + 1),
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : null,
  };
}

export async function executeAgentTool(session: RuntimeSession, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
  const prompt = asString(args.prompt);
  if (!prompt) {
    return { ok: false, output: "Agent requires prompt" };
  }
  const typeName = asString(args.subagent_type) || "general-purpose";
  const agentType = resolveSubagentType(session.subagents, typeName);
  const now = new Date().toISOString();
  const agent: RuntimeSubagentRecord = {
    id: `agent-${String(session.subagents.nextId++)}`,
    type: agentType.name,
    description: asString(args.description) || prompt.split(/\s+/).slice(0, 5).join(" "),
    prompt,
    status: "queued",
    background: args.run_in_background === true,
    inheritContext: args.inherit_context === true || /\btrue\b/i.test(asString(args.fork_context)),
    model: asString(args.model) || undefined,
    thinking: asString(args.thinking) || undefined,
    result: null,
    error: null,
    steerMessages: [],
    createdAt: now,
    startedAt: null,
    completedAt: null,
    inputTokens: 0,
    outputTokens: 0,
  };
  session.subagents.agents.push(agent);
  if (session.subagents.agents.length > SUBAGENT_LIMIT) {
    session.subagents.agents.splice(0, session.subagents.agents.length - SUBAGENT_LIMIT);
  }
  session.subagents.updatedAt = now;
  persistSession(session);

  const run = runSubagent(session, agent, agentType);
  if (agent.background) {
    trackBackgroundRun(session, agent.id, run);
    return { ok: true, output: `subagent ${agent.id} queued (${agent.type}): ${agent.description}` };
  }

  await run;
  return agent.status === "completed"
    ? { ok: true, output: formatSubagentResult(agent, false) }
    : { ok: false, output: formatSubagentResult(agent, false) };
}

export async function executeGetSubagentResultTool(session: RuntimeSession, args: Record<string, unknown>): Promise<{ ok: boolean; output: string }> {
  const id = asString(args.agent_id) || asString(args.id);
  const agent = findSubagent(session, id);
  if (!agent) {
    return { ok: false, output: "unknown subagent id" };
  }
  if (args.wait === true) {
    await runningAgents.get(session)?.get(agent.id);
  }
  return { ok: agent.status !== "failed", output: formatSubagentResult(agent, args.verbose === true) };
}

export function executeSteerSubagentTool(session: RuntimeSession, args: Record<string, unknown>): { ok: boolean; output: string } {
  const id = asString(args.agent_id) || asString(args.id);
  const message = asString(args.message);
  const agent = findSubagent(session, id);
  if (!agent) {
    return { ok: false, output: "unknown subagent id" };
  }
  if (!message) {
    return { ok: false, output: "steer_subagent requires message" };
  }
  agent.steerMessages.push(message);
  session.subagents.updatedAt = new Date().toISOString();
  persistSession(session);
  recordRuntimeEvent(session, {
    kind: "control",
    status: "queued",
    summary: `subagent ${agent.id} steered`,
    detail: message,
  });
  return { ok: true, output: `steer queued for ${agent.id}` };
}

export function formatSubagentsStatus(session: RuntimeSession): string {
  const agents = session.subagents.agents;
  const lines = [
    "subagents",
    `types: ${session.subagents.types.map((type) => type.name).join(", ") || "none"}`,
    `agents: ${String(agents.length)}`,
  ];
  for (const agent of agents.slice(-12)) {
    lines.push(`${agent.id} ${agent.status} ${agent.type}: ${agent.description}${agent.result ? ` :: ${firstLine(agent.result)}` : ""}${agent.error ? ` :: ${agent.error}` : ""}`);
  }
  return lines.join("\n");
}

export function formatSubagentOverlayRows(state: RuntimeSubagentState, width: number): Array<{ key: string; text: string; fg: string }> {
  const visible = state.agents.filter((agent) => agent.status === "queued" || agent.status === "running").slice(-4);
  if (visible.length === 0) {
    return [];
  }
  return [
    { key: "subagents-title", text: fitLine(`agents ${String(visible.length)} active`, width), fg: "#89b4fa" },
    ...visible.map((agent) => ({
      key: `subagent-${agent.id}`,
      text: fitLine(`${agent.status === "running" ? "[>]" : "[ ]"} ${agent.id} ${agent.type} ${agent.description}`, width),
      fg: agent.status === "running" ? "#f9e2af" : "#a6e3a1",
    })),
  ];
}

export function formatSubagentPromptSummary(state?: RuntimeSubagentState | null): string | null {
  if (!state || state.agents.length === 0) {
    return null;
  }
  return state.agents.slice(-8).map((agent) => {
    const outcome = agent.result ? firstLine(agent.result) : agent.error ?? agent.status;
    return `${agent.id} [${agent.status}] ${agent.type}/${agent.description}: ${outcome}`;
  }).join(" | ");
}

async function runSubagent(parent: RuntimeSession, agent: RuntimeSubagentRecord, agentType: RuntimeSubagentType): Promise<void> {
  const startedAt = Date.now();
  agent.status = "running";
  agent.startedAt = new Date(startedAt).toISOString();
  parent.subagents.updatedAt = agent.startedAt;
  recordRuntimeEvent(parent, {
    kind: "control",
    status: "started",
    summary: `subagent ${agent.id} started`,
    detail: `${agent.type}: ${agent.prompt}`,
  });
  persistSession(parent);

  try {
    const child = createChildSession(parent, agent);
    for (const message of agent.steerMessages) {
      queueOperatorSteer(child, message);
    }
    const { executeProviderRequest } = await import("../provider.js");
    const result = await executeProviderRequest({
      session: child,
      prompt: buildSubagentPrompt(agent, agentType),
    });
    if (result.ok) {
      agent.status = "completed";
      agent.result = result.output;
      agent.inputTokens = child.telemetry.lastInputTokens;
      agent.outputTokens = child.telemetry.lastOutputTokens;
      agent.completedAt = new Date().toISOString();
      recordRuntimeEvent(parent, {
        kind: "control",
        status: "completed",
        summary: `subagent ${agent.id} completed`,
        detail: firstLine(result.output),
      });
    } else {
      agent.status = "failed";
      agent.error = result.message;
      agent.completedAt = new Date().toISOString();
      recordRuntimeEvent(parent, {
        kind: "control",
        status: "failed",
        summary: `subagent ${agent.id} failed`,
        detail: result.detail,
      });
    }
  } catch (error) {
    agent.status = "failed";
    agent.error = error instanceof Error ? error.message : String(error);
    agent.completedAt = new Date().toISOString();
    recordRuntimeEvent(parent, {
      kind: "control",
      status: "failed",
      summary: `subagent ${agent.id} failed`,
      detail: agent.error,
    });
  } finally {
    parent.subagents.updatedAt = new Date().toISOString();
    persistSession(parent);
  }
}

function persistSession(session: RuntimeSession): void {
  void import("./persistence.js").then(({ savePersistedRuntimeState }) => savePersistedRuntimeState(session));
}

function createChildSession(parent: RuntimeSession, agent: RuntimeSubagentRecord): RuntimeSession {
  return {
    ...parent,
    id: `${parent.id}_${agent.id}`,
    startedAt: new Date().toISOString(),
    action: { status: "ready", detail: "subagent baseline", pending: false, lastActivity: null },
    telemetry: { turnCount: 0, lastInputTokens: 0, lastOutputTokens: 0 },
    events: [],
    conversation: agent.inheritContext ? parent.conversation.slice(-8).map((turn) => ({ ...turn })) : [],
    compaction: { ...parent.compaction, queuedUserMessage: null, status: "idle", lastTrigger: null },
    operationControls: {
      ...parent.operationControls,
      pendingApproval: null,
      pendingQuestionnaire: null,
      activeAbortController: null,
      cancelRequested: false,
      steerMessage: null,
      steerState: null,
      lastAppliedSteer: null,
      steerHistory: [],
      boomerang: {
        active: false,
        task: null,
        startConversationIndex: 0,
        startEventIndex: 0,
        lastSummary: null,
      },
    },
    todos: { tasks: [], nextId: 1, updatedAt: null },
    btw: { visible: false, mode: "contextual", thread: [], pending: null, nextId: 1, modelOverride: null, thinkingOverride: null, updatedAt: null },
    toolMemory: { entries: [], nextId: 1, updatedAt: null },
    subagents: { agents: [], types: parent.subagents.types, nextId: 1, updatedAt: null },
  };
}

function buildSubagentPrompt(agent: RuntimeSubagentRecord, agentType: RuntimeSubagentType): string {
  return [
    `You are subagent ${agent.id} (${agent.type}).`,
    `Role: ${agentType.description}.`,
    "Work independently. Return concise findings, changes, verification, and blockers.",
    "Do not spawn more subagents unless user explicitly requested nested delegation.",
    "",
    agentType.prompt,
    "",
    "Task:",
    agent.prompt,
  ].join("\n");
}

function trackBackgroundRun(session: RuntimeSession, id: string, run: Promise<void>): void {
  const map = runningAgents.get(session) ?? new Map<string, Promise<void>>();
  map.set(id, run.finally(() => map.delete(id)));
  runningAgents.set(session, map);
}

function discoverSubagentTypes(cwd: string): RuntimeSubagentType[] {
  const byName = new Map<string, RuntimeSubagentType>();
  for (const type of defaultSubagentTypes()) {
    byName.set(type.name.toLowerCase(), type);
  }
  for (const type of loadCustomAgentTypes(path.join(process.env.HOME ?? "", ".pi", "agent", "agents"), "global")) {
    byName.set(type.name.toLowerCase(), type);
  }
  for (const type of loadCustomAgentTypes(path.join(cwd, ".pi", "agents"), "project")) {
    byName.set(type.name.toLowerCase(), type);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function defaultSubagentTypes(): RuntimeSubagentType[] {
  return [
    {
      name: "general-purpose",
      description: "General-purpose autonomous agent",
      tools: "all",
      prompt: "Use the same engineering standards as the parent session. Inspect, edit, test, and report evidence.",
      source: "default",
    },
    {
      name: "Explore",
      description: "Fast read-only codebase exploration",
      tools: "read, search, shell",
      prompt: "Explore codebase state. Prefer read/search/list commands. Do not edit files.",
      source: "default",
    },
    {
      name: "Plan",
      description: "Implementation planning architect",
      tools: "read, search, shell",
      prompt: "Create an implementation plan grounded in repo evidence. Do not edit files.",
      source: "default",
    },
  ];
}

function loadCustomAgentTypes(dir: string, source: "project" | "global"): RuntimeSubagentType[] {
  if (!dir || !existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .flatMap((file) => parseAgentFile(path.join(dir, file), source));
}

function parseAgentFile(filePath: string, source: "project" | "global"): RuntimeSubagentType[] {
  try {
    const raw = readFileSync(filePath, "utf8");
    const name = path.basename(filePath, ".md");
    const { frontmatter, body } = parseFrontmatter(raw);
    if (frontmatter.enabled === "false") {
      return [];
    }
    return [{
      name,
      description: frontmatter.description || frontmatter.display_name || name,
      tools: frontmatter.tools || "all",
      prompt: body.trim() || `You are ${name}.`,
      source,
    }];
  } catch {
    return [];
  }
}

function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) {
    return { frontmatter: {}, body: raw };
  }
  const end = raw.indexOf("\n---", 3);
  if (end < 0) {
    return { frontmatter: {}, body: raw };
  }
  const frontmatter = Object.fromEntries(raw.slice(3, end).split(/\r?\n/).flatMap((line) => {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line.trim());
    return match ? [[match[1], match[2].replace(/^["']|["']$/g, "")]] : [];
  }));
  return { frontmatter, body: raw.slice(end + 4) };
}

function resolveSubagentType(state: RuntimeSubagentState, name: string): RuntimeSubagentType {
  return state.types.find((type) => type.name.toLowerCase() === name.toLowerCase()) ?? state.types.find((type) => type.name === "general-purpose") ?? defaultSubagentTypes()[0]!;
}

function findSubagent(session: RuntimeSession, id: string): RuntimeSubagentRecord | null {
  return session.subagents.agents.find((agent) => agent.id === id) ?? null;
}

function formatSubagentResult(agent: RuntimeSubagentRecord, verbose: boolean): string {
  return [
    `subagent ${agent.id}`,
    `status: ${agent.status}`,
    `type: ${agent.type}`,
    `description: ${agent.description}`,
    `tokens: ${String(agent.inputTokens)} in / ${String(agent.outputTokens)} out`,
    agent.error ? `error: ${agent.error}` : null,
    agent.result ? `result:\n${verbose ? agent.result : truncate(agent.result, 1800)}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function normalizeSubagentRecord(value: unknown): RuntimeSubagentRecord | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = asString(record.id);
  const prompt = asString(record.prompt);
  if (!id || !prompt) return null;
  return {
    id,
    type: asString(record.type) || "general-purpose",
    description: asString(record.description) || prompt.slice(0, 40),
    prompt,
    status: isStatus(record.status) ? record.status : "completed",
    background: record.background === true,
    inheritContext: record.inheritContext === true,
    model: asString(record.model) || undefined,
    thinking: asString(record.thinking) || undefined,
    result: asString(record.result) || null,
    error: asString(record.error) || null,
    steerMessages: Array.isArray(record.steerMessages) ? record.steerMessages.filter((item): item is string => typeof item === "string") : [],
    createdAt: asString(record.createdAt) || new Date(0).toISOString(),
    startedAt: asString(record.startedAt) || null,
    completedAt: asString(record.completedAt) || null,
    inputTokens: typeof record.inputTokens === "number" ? record.inputTokens : 0,
    outputTokens: typeof record.outputTokens === "number" ? record.outputTokens : 0,
  };
}

function isStatus(value: unknown): value is RuntimeSubagentStatus {
  return value === "queued" || value === "running" || value === "completed" || value === "failed" || value === "stopped";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstLine(value: string): string {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "(empty)";
}

function fitLine(value: string, width: number): string {
  const clean = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
  return clean.length <= width ? clean : `${clean.slice(0, Math.max(0, width - 3))}...`;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 3))}...`;
}
