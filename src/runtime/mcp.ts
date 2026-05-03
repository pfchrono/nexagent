import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface McpServerDefinition {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  bearer_token_env_var?: string;
  startup_timeout_sec?: number;
  startupTimeoutSec?: number;
  disabled?: boolean;
}

export interface McpConfigFile {
  mcpServers?: Record<string, McpServerDefinition>;
}

export interface McpHydratedTool {
  server: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerStatus {
  name: string;
  transport: "stdio" | "http" | "unknown";
  status: "configured" | "hydrated" | "failed" | "skipped";
  toolCount: number;
  startupTimeoutMs: number;
  message: string | null;
}

export interface McpRuntimeClient {
  name: string;
  process: ChildProcessWithoutNullStreams;
  requestId: number;
  buffer: string;
  pending: Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }>;
}

export interface McpRegistrySummary {
  serverNames: string[];
  servers: Record<string, McpServerDefinition>;
  tools: McpHydratedTool[];
  statuses: McpServerStatus[];
  clients: Map<string, McpRuntimeClient>;
}

export interface McpLoadOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  envFiles?: string[];
}

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000;
const MAX_STARTUP_TIMEOUT_MS = 120_000;
const MCP_PROTOCOL_VERSION = "2024-11-05";

export async function loadMcpRegistrySummary(
  filePath: string,
  enabledServers: string[] = [],
  options: McpLoadOptions = {},
): Promise<McpRegistrySummary> {
  const parsed = await readMcpConfigFile(filePath);
  const runtimeEnv = await loadMcpRuntimeEnv(filePath, options);
  const allServers = parsed?.mcpServers ?? {};
  const servers =
    enabledServers.length === 0
      ? allServers
      : Object.fromEntries(
          Object.entries(allServers).filter(([name]) => enabledServers.includes(name)),
        );
  const serverNames = Object.keys(servers).sort();
  const hydration = await Promise.all(serverNames.map((name) => hydrateServer(name, servers[name], runtimeEnv)));
  const tools = hydration.flatMap((result) => result.tools);
  const statuses = hydration.map((result) => result.status);
  const clients = new Map<string, McpRuntimeClient>();

  for (const result of hydration) {
    if (result.client) {
      clients.set(result.client.name, result.client);
    }
  }

  return {
    serverNames,
    servers,
    tools,
    statuses,
    clients,
  };
}

export async function callMcpTool(
  registry: McpRegistrySummary,
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  const client = registry.clients.get(serverName);
  if (!client) {
    throw new Error(`MCP server not hydrated: ${serverName}`);
  }

  const result = await sendMcpRequest(client, "tools/call", {
    name: toolName,
    arguments: args,
  }, getStartupTimeoutMs(registry.servers[serverName]));

  return formatMcpToolResult(result);
}

export function listMcpTools(registry: McpRegistrySummary): string {
  if (registry.tools.length === 0) {
    const statuses = registry.statuses.map((status) => `${status.name}: ${status.status}${status.message ? ` (${status.message})` : ""}`);
    return statuses.length > 0 ? statuses.join("\n") : "no hydrated MCP tools";
  }

  return registry.tools
    .map((tool) => `${tool.server}.${tool.name}${tool.description ? ` - ${tool.description}` : ""}`)
    .join("\n");
}

export function getMcpServerStatus(registry: McpRegistrySummary, serverName: string): McpServerStatus | null {
  return registry.statuses.find((status) => status.name === serverName) ?? null;
}

export function shutdownMcpRegistry(registry: McpRegistrySummary | null | undefined): void {
  if (!registry) {
    return;
  }
  for (const client of registry.clients.values()) {
    stopMcpClient(client);
  }
  registry.clients.clear();
}

export async function readMcpConfigFile(filePath: string): Promise<McpConfigFile | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const trimmed = raw.trimStart();
    if (filePath.endsWith(".toml") || trimmed.startsWith("[mcp_servers")) {
      return parseCodexTomlMcpConfig(raw);
    }
    return JSON.parse(raw) as McpConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function writeMcpConfigFile(filePath: string, config: McpConfigFile): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

async function hydrateServer(
  name: string,
  definition: McpServerDefinition | undefined,
  runtimeEnv: NodeJS.ProcessEnv,
): Promise<{ tools: McpHydratedTool[]; status: McpServerStatus; client: McpRuntimeClient | null }> {
  const startupTimeoutMs = getStartupTimeoutMs(definition);
  const transport: McpServerStatus["transport"] = definition?.command ? "stdio" : definition?.url ? "http" : "unknown";
  const baseStatus = {
    name,
    transport,
    toolCount: 0,
    startupTimeoutMs,
  };

  if (!definition || definition.disabled) {
    return {
      tools: [],
      client: null,
      status: { ...baseStatus, status: "skipped", message: definition?.disabled ? "disabled" : "missing definition" },
    };
  }

  if (!definition.command) {
    return {
      tools: [],
      client: null,
      status: { ...baseStatus, status: "configured", message: definition.url ? "http MCP transport not bridged yet" : "missing command" },
    };
  }

  let client: McpRuntimeClient | null = null;
  try {
    client = startStdioClient(name, definition, runtimeEnv);
    await sendMcpRequest(client, "initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "nexagent", version: "0.1.0" },
    }, startupTimeoutMs);
    sendMcpNotification(client, "notifications/initialized", {});
    const toolsResult = await sendMcpRequest(client, "tools/list", {}, startupTimeoutMs);
    const tools = parseToolsList(name, toolsResult);

    return {
      tools,
      client,
      status: { ...baseStatus, status: "hydrated", toolCount: tools.length, message: null },
    };
  } catch (error) {
    if (client) {
      stopMcpClient(client);
    }
    return {
      tools: [],
      client: null,
      status: { ...baseStatus, status: "failed", message: sanitizeMcpError(error) },
    };
  }
}

function startStdioClient(name: string, definition: McpServerDefinition, runtimeEnv: NodeJS.ProcessEnv): McpRuntimeClient {
  const child = spawn(definition.command ?? "", definition.args ?? [], {
    stdio: ["pipe", "pipe", "pipe"],
    env: buildMcpProcessEnv(definition, runtimeEnv),
  });
  const client: McpRuntimeClient = {
    name,
    process: child,
    requestId: 1,
    buffer: "",
    pending: new Map(),
  };

  child.stdout.on("data", (chunk: Buffer) => {
    client.buffer += chunk.toString("utf8");
    drainMcpMessages(client);
  });
  child.on("error", (error) => rejectAllPending(client, error));
  child.on("exit", (code, signal) => {
    rejectAllPending(client, new Error(`MCP server exited code=${String(code)} signal=${signal ?? "none"}`));
  });

  return client;
}

async function loadMcpRuntimeEnv(filePath: string, options: McpLoadOptions): Promise<NodeJS.ProcessEnv> {
  const baseEnv = { ...(options.env ?? process.env) };
  const envFiles = options.envFiles ?? defaultMcpEnvFiles(filePath, options.cwd);
  const fileEnv: NodeJS.ProcessEnv = {};

  for (const envFile of envFiles) {
    Object.assign(fileEnv, await readMcpEnvFile(envFile));
  }

  return {
    ...fileEnv,
    ...baseEnv,
  };
}

function defaultMcpEnvFiles(filePath: string, cwd: string | undefined): string[] {
  const files = new Set<string>();
  if (cwd) {
    files.add(path.join(cwd, ".env"));
  }
  files.add(path.join(path.dirname(filePath), ".env"));
  return [...files];
}

async function readMcpEnvFile(filePath: string): Promise<NodeJS.ProcessEnv> {
  try {
    return parseMcpEnvFile(await readFile(filePath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

function parseMcpEnvFile(raw: string): NodeJS.ProcessEnv {
  const values: NodeJS.ProcessEnv = {};

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const equals = normalized.indexOf("=");
    if (equals <= 0) {
      continue;
    }
    const key = normalized.slice(0, equals).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    values[key] = stripMcpEnvQuotes(normalized.slice(equals + 1).trim());
  }

  return values;
}

function stripMcpEnvQuotes(value: string): string {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function buildMcpProcessEnv(definition: McpServerDefinition, runtimeEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...runtimeEnv };

  for (const [key, value] of Object.entries(definition.env ?? {})) {
    env[key] = expandMcpEnvValue(value, env);
  }

  return env;
}

function expandMcpEnvValue(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, key: string) => env[key] ?? "");
}

function sendMcpRequest(
  client: McpRuntimeClient,
  method: string,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const id = client.requestId++;
  const payload = {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.pending.delete(id);
      reject(new Error(`MCP request timed out after ${String(timeoutMs)}ms`));
    }, timeoutMs);
    client.pending.set(id, { resolve, reject, timer });
    writeMcpMessage(client, payload);
  });
}

function sendMcpNotification(client: McpRuntimeClient, method: string, params: Record<string, unknown>): void {
  writeMcpMessage(client, {
    jsonrpc: "2.0",
    method,
    params,
  });
}

function writeMcpMessage(client: McpRuntimeClient, payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  client.process.stdin.write(`${body}\n`);
}

function drainMcpMessages(client: McpRuntimeClient): void {
  for (;;) {
    const lineEnd = client.buffer.indexOf("\n");
    const headerEnd = client.buffer.indexOf("\r\n\r\n");
    if (headerEnd !== -1 && (lineEnd === -1 || headerEnd < lineEnd)) {
      if (!drainMcpContentLengthMessage(client, headerEnd)) {
        return;
      }
      continue;
    }
    if (lineEnd === -1) {
      return;
    }

    const rawLine = client.buffer.slice(0, lineEnd).replace(/\r$/, "");
    client.buffer = client.buffer.slice(lineEnd + 1);
    if (!rawLine.trim()) {
      continue;
    }
    handleMcpMessage(client, rawLine);
  }
}

function drainMcpContentLengthMessage(client: McpRuntimeClient, headerEnd: number): boolean {
  const header = client.buffer.slice(0, headerEnd);
  const lengthMatch = /content-length:\s*(\d+)/i.exec(header);
  if (!lengthMatch) {
    client.buffer = "";
    return false;
  }
  const length = Number(lengthMatch[1]);
  const bodyStart = headerEnd + 4;
  const bodyEnd = bodyStart + length;
  if (client.buffer.length < bodyEnd) {
    return false;
  }
  const rawBody = client.buffer.slice(bodyStart, bodyEnd);
  client.buffer = client.buffer.slice(bodyEnd);
  handleMcpMessage(client, rawBody);
  return true;
}

function handleMcpMessage(client: McpRuntimeClient, rawBody: string): void {
  let message: unknown;
  try {
    message = JSON.parse(rawBody);
  } catch {
    return;
  }
  if (!isRecord(message) || typeof message.id !== "number") {
    return;
  }
  const pending = client.pending.get(message.id);
  if (!pending) {
    return;
  }
  client.pending.delete(message.id);
  clearTimeout(pending.timer);

  if (isRecord(message.error)) {
    pending.reject(new Error(asString(message.error.message, "MCP request failed")));
    return;
  }
  pending.resolve(message.result);
}

function parseToolsList(server: string, result: unknown): McpHydratedTool[] {
  if (!isRecord(result) || !Array.isArray(result.tools)) {
    return [];
  }

  return result.tools
    .filter(isRecord)
    .map((tool) => ({
      server,
      name: asString(tool.name, ""),
      description: asString(tool.description, ""),
      inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : {},
    }))
    .filter((tool) => tool.name.length > 0);
}

function formatMcpToolResult(result: unknown): string {
  if (!isRecord(result)) {
    return JSON.stringify(result);
  }
  if (Array.isArray(result.content)) {
    const lines = result.content
      .filter(isRecord)
      .map((item) => {
        if (typeof item.text === "string") {
          return item.text;
        }
        return JSON.stringify(item);
      });
    if (lines.length > 0) {
      return lines.join("\n");
    }
  }
  return JSON.stringify(result);
}

function stopMcpClient(client: McpRuntimeClient): void {
  rejectAllPending(client, new Error("MCP client stopped"));
  client.process.stdout.removeAllListeners();
  client.process.stderr.removeAllListeners();
  client.process.removeAllListeners();
  client.process.stdin.destroy();
  client.process.stdout.destroy();
  client.process.stderr.destroy();
  if (!client.process.killed) {
    client.process.kill();
  }
  client.process.unref();
}

function rejectAllPending(client: McpRuntimeClient, error: Error): void {
  for (const [id, pending] of client.pending) {
    clearTimeout(pending.timer);
    pending.reject(error);
    client.pending.delete(id);
  }
}

function getStartupTimeoutMs(definition: McpServerDefinition | undefined): number {
  const seconds = definition?.startup_timeout_sec ?? definition?.startupTimeoutSec;
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
    return DEFAULT_STARTUP_TIMEOUT_MS;
  }
  return Math.min(Math.round(seconds * 1000), MAX_STARTUP_TIMEOUT_MS);
}

function parseCodexTomlMcpConfig(raw: string): McpConfigFile {
  const servers: Record<string, McpServerDefinition> = {};
  let currentName: string | null = null;

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) {
      continue;
    }

    const sectionMatch = /^\[mcp_servers\.([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      currentName = unquoteTomlString(sectionMatch[1].trim());
      servers[currentName] = servers[currentName] ?? {};
      continue;
    }
    if (/^\[/.test(line)) {
      currentName = null;
      continue;
    }
    if (!currentName) {
      continue;
    }

    const equals = line.indexOf("=");
    if (equals === -1) {
      continue;
    }
    const key = line.slice(0, equals).trim();
    const value = parseTomlValue(line.slice(equals + 1).trim());
    assignMcpTomlValue(servers[currentName], key, value);
  }

  return { mcpServers: servers };
}

function assignMcpTomlValue(definition: McpServerDefinition, key: string, value: unknown): void {
  switch (key) {
    case "command":
      if (typeof value === "string") {
        definition.command = value;
      }
      return;
    case "args":
      if (Array.isArray(value)) {
        definition.args = value.filter((item): item is string => typeof item === "string");
      }
      return;
    case "url":
      if (typeof value === "string") {
        definition.url = value;
      }
      return;
    case "bearer_token_env_var":
      if (typeof value === "string") {
        definition.bearer_token_env_var = value;
      }
      return;
    case "startup_timeout_sec":
      if (typeof value === "number") {
        definition.startup_timeout_sec = value;
      }
      return;
    case "disabled":
      if (typeof value === "boolean") {
        definition.disabled = value;
      }
      return;
    case "env":
      if (isStringRecord(value)) {
        definition.env = value;
      }
      return;
  }
}

function parseTomlValue(value: string): unknown {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return unquoteTomlString(value);
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    return Number(value);
  }
  if (value.startsWith("[") && value.endsWith("]")) {
    const body = value.slice(1, -1).trim();
    if (!body) {
      return [];
    }
    return splitTomlArray(body).map((part) => parseTomlValue(part.trim()));
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    const record: Record<string, string> = {};
    for (const part of splitTomlArray(value.slice(1, -1))) {
      const equals = part.indexOf("=");
      if (equals === -1) {
        continue;
      }
      const key = part.slice(0, equals).trim();
      const parsed = parseTomlValue(part.slice(equals + 1).trim());
      if (typeof parsed === "string") {
        record[unquoteTomlString(key)] = parsed;
      }
    }
    return record;
  }
  return value;
}

function splitTomlArray(body: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (let index = 0; index < body.length; index += 1) {
    const char = body[index];
    if ((char === "\"" || char === "'") && body[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === "," && quote === null) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) {
    parts.push(current);
  }
  return parts;
}

function stripTomlComment(line: string): string {
  let quote: string | null = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if ((char === "\"" || char === "'") && line[index - 1] !== "\\") {
      quote = quote === char ? null : quote ?? char;
    }
    if (char === "#" && quote === null) {
      return line.slice(0, index);
    }
  }
  return line;
}

function unquoteTomlString(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
  return trimmed;
}

function sanitizeMcpError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 160);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}
