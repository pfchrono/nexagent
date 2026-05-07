import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

import { resolveNexagentHome } from "./paths.js";
import type { RuntimeSession } from "./session.js";

export type RuntimeExtensionEventName =
  | "session_start"
  | "before_agent_start"
  | "before_tool_execution"
  | "agent_start"
  | "tool_result"
  | "message_end"
  | "agent_end"
  | "agent_error"
  | "session_shutdown"
  | "session_switch";

export interface RuntimeExtensionCommand {
  name: string;
  description?: string;
  usage?: string;
  handler: (args: RuntimeExtensionArgs, ctx: RuntimeExtensionContext) => unknown;
}

export type RuntimeExtensionArgs = string[] & {
  trim(): string;
  toString(): string;
};

export interface RuntimeExtensionTool {
  name: string;
  label?: string;
  description?: string;
  execute?: (...args: unknown[]) => unknown;
}

export interface RuntimeExtensionActivity {
  at: string;
  event: string;
  status: "registered" | "started" | "completed" | "failed" | "info" | "warning";
  summary: string;
  source: string | null;
}

export interface RuntimeExtensionHost {
  status: "none" | "configured";
  sourcePaths: string[];
  invalidEntries: string[];
  commands: Map<string, RuntimeExtensionCommand>;
  tools: Map<string, RuntimeExtensionTool>;
  shortcuts: Map<string, RuntimeExtensionCommand>;
  handlers: Map<RuntimeExtensionEventName, RuntimeExtensionHandler[]>;
  notifications: string[];
  widgets: Map<string, string[]>;
  editorText: string;
  activity: RuntimeExtensionActivity[];
  uiBridge?: {
    notify?: (message: string, level?: string) => void;
    setWidget?: (id: string, lines: string[] | undefined) => void;
    getEditorText?: () => string;
    setEditorText?: (value: string) => void;
    custom?: <T>(factory: RuntimeExtensionCustomFactory<T>) => Promise<T>;
  };
}

export interface RuntimeExtensionCustomComponent {
  render(width: number): string[];
  invalidate?: () => void;
  handleInput?: (data: string) => void;
  dispose?: () => void;
}

export type RuntimeExtensionCustomFactory<T = unknown> = (
  tui: { requestRender: () => void },
  theme: Record<string, unknown>,
  keyboard: Record<string, unknown>,
  done: (value?: T) => void,
) => RuntimeExtensionCustomComponent;

export interface RuntimeExtensionContext {
  cwd: string;
  hasUI: boolean;
  ui: {
    notify(message: string, level?: "info" | "warn" | "error" | string): void;
    setFooter?(footer: string): void;
    setWidget?(id: string, lines: string[] | undefined): void;
    getEditorText?(): string;
    setEditorText?(value: string): void;
    custom?<T>(factory: RuntimeExtensionCustomFactory<T>): Promise<T>;
  };
  settingsManager: {
    getSettings(): Record<string, unknown>;
    get(key?: string): unknown;
    set(key?: string, value?: unknown): undefined;
    update(value?: unknown): undefined;
  };
  addSystemMessage(message: string): void;
  systemMessages: string[];
  sessionManager?: {
    getBranch(): Array<{
      type: "message";
      id: string;
      message: {
        role: "user" | "assistant";
        content: string;
      };
    }>;
  };
}

type RuntimeExtensionHandler = (event: unknown, ctx: RuntimeExtensionContext) => unknown;
type RuntimeExtensionFactory = (api: RuntimeExtensionApi) => unknown;

interface RuntimeExtensionApi {
  on(event: string, handler: RuntimeExtensionHandler): void;
  registerCommand(command: unknown, handler?: RuntimeExtensionCommand["handler"]): void;
  registerSlashCommand(command: unknown, handler?: RuntimeExtensionCommand["handler"]): void;
  registerShortcut(shortcut: string, command: unknown): void;
  registerTool(tool: RuntimeExtensionTool): void;
  getCommand(name: string): RuntimeExtensionCommand | undefined;
  [key: string]: unknown;
}

const EXTENSION_FILE_RE = /\.(?:js|mjs|cjs|ts)$/i;
const BUILTIN_SHORTCUTS = new Set([
  "ctrl+c",
  "ctrl+g",
  "ctrl+p",
  "ctrl+q",
  "ctrl+r",
  "ctrl+t",
  "ctrl+v",
  "ctrl+y",
  "alt+q",
  "alt+v",
  "option+q",
  "option+v",
  "meta+q",
  "meta+v",
]);

export async function loadRuntimeExtensions(cwd: string): Promise<RuntimeExtensionHost> {
  const host = createRuntimeExtensionHost();
  const candidates = discoverExtensionFiles(cwd);

  for (const filePath of candidates) {
    await loadRuntimeExtensionFile(host, filePath);
  }

  host.status = host.sourcePaths.length > 0 || host.invalidEntries.length > 0 ? "configured" : "none";
  return host;
}

export function createRuntimeExtensionHost(): RuntimeExtensionHost {
  return {
    status: "none",
    sourcePaths: [],
    invalidEntries: [],
    commands: new Map(),
    tools: new Map(),
    shortcuts: new Map(),
    handlers: new Map(),
    notifications: [],
    widgets: new Map(),
    editorText: "",
    activity: [],
  };
}

export function createRuntimeExtensionSummary(host?: RuntimeExtensionHost): {
  status: "none" | "configured";
  sources: string[];
  events: string[];
  commandCount: number;
  toolCount: number;
  invalidEntries: string[];
  notifications: string[];
  activity: RuntimeExtensionActivity[];
} {
  const resolved = host ?? createRuntimeExtensionHost();
  return {
    status: resolved.status,
    sources: resolved.sourcePaths,
    events: [...resolved.handlers.entries()].filter(([, handlers]) => handlers.length > 0).map(([event]) => event),
    commandCount: resolved.commands.size,
    toolCount: resolved.tools.size,
    invalidEntries: resolved.invalidEntries,
    notifications: resolved.notifications,
    activity: resolved.activity,
  };
}

export function emitRuntimeExtensionEvent(
  session: RuntimeSession,
  event: RuntimeExtensionEventName,
  payload: unknown = {},
): Promise<unknown[]> {
  const host = session.extensions;
  const handlers = host?.handlers.get(event) ?? [];
  if (handlers.length === 0) {
    return Promise.resolve([]);
  }
  const ctx = createRuntimeExtensionContext(session);
  recordRuntimeExtensionActivity(host, event, "started", `handlers ${String(handlers.length)}`);
  return Promise.all(handlers.map(async (handler) => {
    try {
      const result = await handler(payload, ctx);
      recordRuntimeExtensionActivity(host, event, "completed", "handler completed");
      return result;
    } catch (error) {
      host?.invalidEntries.push(`${event}: ${error instanceof Error ? error.message : String(error)}`);
      recordRuntimeExtensionActivity(host, event, "failed", error instanceof Error ? error.message : String(error));
      return null;
    }
  }));
}

export function emitRuntimeExtensionEventDetached(session: RuntimeSession, event: RuntimeExtensionEventName, payload: unknown = {}): void {
  void emitRuntimeExtensionEvent(session, event, payload).catch((error) => {
    session.extensions?.invalidEntries.push(`${event}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

export function findRuntimeExtensionCommand(session: RuntimeSession, name: string): RuntimeExtensionCommand | null {
  return session.extensions?.commands.get(name) ?? null;
}

export function formatRuntimeExtensionsStatus(session: RuntimeSession): string {
  const summary = createRuntimeExtensionSummary(session.extensions);
  return [
    "extensions",
    `status: ${summary.status}`,
    `sources: ${summary.sources.length > 0 ? summary.sources.join(" | ") : "none"}`,
    `events: ${summary.events.length > 0 ? summary.events.join(", ") : "none"}`,
    `commands: ${String(summary.commandCount)}`,
    `tools: ${String(summary.toolCount)}`,
    `shortcuts: ${String(session.extensions?.shortcuts.size ?? 0)}`,
    `invalid: ${summary.invalidEntries.length > 0 ? summary.invalidEntries.join(" | ") : "none"}`,
    `notifications: ${summary.notifications.slice(-4).join(" | ") || "none"}`,
    "recent:",
    ...formatRuntimeExtensionActivity(summary.activity),
  ].join("\n");
}

export function formatRuntimeExtensionActivity(activity: RuntimeExtensionActivity[]): string[] {
  if (activity.length === 0) {
    return ["  none"];
  }
  return activity.slice(-8).map((entry) =>
    `  ${entry.at} ${entry.status} ${entry.event}: ${entry.summary}${entry.source ? ` (${entry.source})` : ""}`
  );
}

function discoverExtensionFiles(cwd: string): string[] {
  const roots = [
    path.join(resolveNexagentHome(), "extensions"),
    path.join(homedir(), ".pi", "agent", "extensions"),
    path.join(cwd, ".pi", "extensions"),
    path.join(cwd, ".nexagent", "extensions"),
  ];
  const seen = new Set<string>();
  const files: string[] = [];
  for (const root of roots) {
    if (!existsSync(root)) {
      continue;
    }
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile() || !EXTENSION_FILE_RE.test(entry.name)) {
        continue;
      }
      const filePath = path.join(root, entry.name);
      if (!seen.has(filePath)) {
        seen.add(filePath);
        files.push(filePath);
      }
    }
  }
  return files;
}

async function loadRuntimeExtensionFile(host: RuntimeExtensionHost, filePath: string): Promise<void> {
  try {
    const imported = await importRuntimeExtensionModule(filePath);
    const factory = imported.default ?? imported;
    if (typeof factory === "function") {
      await (factory as RuntimeExtensionFactory)(createRuntimeExtensionApi(host, filePath));
      host.sourcePaths.push(filePath);
      recordRuntimeExtensionActivity(host, "load", "completed", `loaded ${path.basename(filePath)}`, filePath);
      return;
    }
    if (factory && typeof factory === "object") {
      registerLegacyRuntimeExtension(host, filePath, factory as Record<string, unknown>);
      host.sourcePaths.push(filePath);
      recordRuntimeExtensionActivity(host, "load", "completed", `loaded ${path.basename(filePath)}`, filePath);
      return;
    }
    host.invalidEntries.push(`${filePath}: default export must be function or extension object`);
    recordRuntimeExtensionActivity(host, "load", "failed", "default export must be function or extension object", filePath);
  } catch (error) {
    host.invalidEntries.push(`${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    recordRuntimeExtensionActivity(host, "load", "failed", error instanceof Error ? error.message : String(error), filePath);
  }
}

async function importRuntimeExtensionModule(filePath: string): Promise<Record<string, unknown>> {
  if (!filePath.endsWith(".ts")) {
    return await import(`${pathToFileURL(filePath).href}?nexagent=${Date.now().toString(36)}`) as Record<string, unknown>;
  }
  const source = readFileSync(filePath, "utf8");
  const transformed = ts.transpileModule(applyPiTuiShim(source), {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      sourceMap: false,
    },
    fileName: filePath,
  }).outputText;
  const cacheDir = path.join(resolveNexagentHome(), "extension-cache");
  mkdirSync(cacheDir, { recursive: true });
  const mtime = statSync(filePath).mtimeMs.toString(36).replace(/\W/g, "");
  const cachePath = path.join(cacheDir, `${path.basename(filePath, ".ts")}-${mtime}.mjs`);
  writeFileSync(cachePath, transformed, "utf8");
  return await import(`${pathToFileURL(cachePath).href}?nexagent=${Date.now().toString(36)}`) as Record<string, unknown>;
}

function applyPiTuiShim(source: string): string {
  const shim = [
    "const __nexagentAnsiPattern = /\\x1B(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~]|\\][^\\x07]*(?:\\x07|\\x1B\\\\))/g;",
    "const visibleWidth = (value) => String(value ?? '').replace(__nexagentAnsiPattern, '').length;",
    "const truncateToWidth = (value, width, suffix = '') => { const text = String(value ?? ''); const plain = text.replace(__nexagentAnsiPattern, ''); return plain.length <= width ? text : plain.slice(0, Math.max(0, width - String(suffix).length)) + suffix; };",
    "const matchesKey = (data, key) => { const value = String(data ?? '').toLowerCase(); const wanted = String(key ?? '').toLowerCase(); if (wanted === 'space') return value === 'space' || value === ' '; if (wanted === 'return' || wanted === 'enter') return value === 'return' || value === 'enter' || value === '\\r' || value === '\\n'; if (wanted === 'escape') return value === 'escape' || value === '\\x1b'; return value === wanted; };",
    "",
  ].join("\n");
  return source.replace(/^\s*import\s+\{[^}]*\}\s+from\s+["']@mariozechner\/pi-tui["'];?\s*$/m, shim);
}

function registerLegacyRuntimeExtension(host: RuntimeExtensionHost, sourcePath: string, extension: Record<string, unknown>): void {
  const eventMethodMap: Array<[RuntimeExtensionEventName, string]> = [
    ["agent_start", "on_agent_start"],
    ["agent_end", "on_agent_end"],
    ["agent_error", "on_agent_error"],
    ["before_agent_start", "on_agent_message"],
  ];
  for (const [eventName, methodName] of eventMethodMap) {
    const method = extension[methodName];
    if (typeof method !== "function") {
      continue;
    }
    const handlers = host.handlers.get(eventName) ?? [];
    handlers.push((_event, ctx) => eventName === "before_agent_start"
      ? method(ctx, typeof _event === "object" && _event ? (_event as { prompt?: unknown }).prompt ?? "" : "")
      : method(ctx, _event));
    host.handlers.set(eventName, handlers);
  }
  const beforeToolExecution = extension.beforeToolExecution;
  if (typeof beforeToolExecution === "function") {
    const handlers = host.handlers.get("before_tool_execution") ?? [];
    handlers.push((_event, ctx) => beforeToolExecution(ctx, (_event as { tool?: unknown }).tool, (_event as { call?: unknown }).call));
    host.handlers.set("before_tool_execution", handlers);
  }
  const afterToolExecution = extension.afterToolExecution;
  if (typeof afterToolExecution === "function") {
    const handlers = host.handlers.get("tool_result") ?? [];
    handlers.push((_event, ctx) => afterToolExecution(ctx, (_event as { tool?: unknown }).tool, (_event as { result?: unknown }).result));
    host.handlers.set("tool_result", handlers);
  }
  const registerSlashCommands = extension.registerSlashCommands;
  if (typeof registerSlashCommands === "function") {
    const registry = {
      register(command: unknown, handler?: RuntimeExtensionCommand["handler"]) {
        registerRuntimeExtensionCommand(host, sourcePath, command, handler);
      },
      registerCommand(command: unknown, handler?: RuntimeExtensionCommand["handler"]) {
        registerRuntimeExtensionCommand(host, sourcePath, command, handler);
      },
    };
    registerSlashCommands(registry);
  }
}

function createRuntimeExtensionApi(host: RuntimeExtensionHost, sourcePath: string): RuntimeExtensionApi {
  const api: RuntimeExtensionApi = {
    on(event, handler) {
      if (typeof event !== "string" || typeof handler !== "function") {
        host.invalidEntries.push(`${sourcePath}: pi.on missing event or handler`);
        return;
      }
      const eventName = event as RuntimeExtensionEventName;
      const handlers = host.handlers.get(eventName) ?? [];
      handlers.push(handler);
      host.handlers.set(eventName, handlers);
      recordRuntimeExtensionActivity(host, eventName, "registered", `handler ${String(handlers.length)}`, sourcePath);
    },
    registerCommand(command, handler) {
      registerRuntimeExtensionCommand(host, sourcePath, command, handler);
    },
    registerSlashCommand(command, handler) {
      registerRuntimeExtensionCommand(host, sourcePath, command, handler);
    },
    registerShortcut(shortcut, command) {
      registerRuntimeExtensionShortcut(host, sourcePath, shortcut, command);
    },
    registerTool(tool) {
      if (!tool || typeof tool.name !== "string" || tool.name.trim().length === 0) {
        host.invalidEntries.push(`${sourcePath}: registerTool missing name`);
        return;
      }
      host.tools.set(tool.name, tool);
      recordRuntimeExtensionActivity(host, "tool", "registered", tool.name, sourcePath);
    },
    getCommand(name) {
      return host.commands.get(normalizeCommandName(name));
    },
  };
  return new Proxy(api, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") {
        return Reflect.get(target, prop, receiver);
      }
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      return (..._args: unknown[]) => {
        host.notifications.push(`debug: ignored unsupported extension API pi.${prop}`);
        recordRuntimeExtensionActivity(host, "api", "warning", `ignored pi.${prop}`, sourcePath);
        return undefined;
      };
    },
  });
}

function registerRuntimeExtensionCommand(
  host: RuntimeExtensionHost,
  sourcePath: string,
  command: unknown,
  handler?: RuntimeExtensionCommand["handler"],
): void {
  if (typeof command === "string") {
    if (typeof handler === "function") {
      const name = normalizeCommandName(command);
      host.commands.set(name, { name, handler });
      recordRuntimeExtensionActivity(host, "command", "registered", name, sourcePath);
      return;
    }
    if (handler && typeof handler === "object") {
      registerRuntimeExtensionCommand(host, sourcePath, { ...(handler as Record<string, unknown>), name: command });
      return;
    }
    if (!handler) {
      host.invalidEntries.push(`${sourcePath}: registerCommand ${command} missing handler`);
      return;
    }
    host.invalidEntries.push(`${sourcePath}: registerCommand ${command} handler must be function or object`);
    return;
  }
  if (!command || typeof command !== "object") {
    host.invalidEntries.push(`${sourcePath}: registerCommand invalid command`);
    return;
  }
  const entry = command as Record<string, unknown>;
  const name = normalizeCommandName(typeof entry.name === "string" ? entry.name : "");
  const run = entry.handler ?? entry.run ?? entry.execute;
  if (!name || typeof run !== "function") {
    host.invalidEntries.push(`${sourcePath}: registerCommand missing name or handler`);
    return;
  }
  host.commands.set(name, {
    name,
    usage: typeof entry.usage === "string" ? entry.usage : undefined,
    description: typeof entry.description === "string" ? entry.description : undefined,
    handler: run as RuntimeExtensionCommand["handler"],
  });
  recordRuntimeExtensionActivity(host, "command", "registered", name, sourcePath);
}

function registerRuntimeExtensionShortcut(
  host: RuntimeExtensionHost,
  sourcePath: string,
  shortcut: string,
  command: unknown,
): void {
  if (!shortcut || typeof shortcut !== "string") {
    host.invalidEntries.push(`${sourcePath}: registerShortcut missing shortcut`);
    return;
  }
  const normalizedShortcut = normalizeShortcutName(shortcut);
  const resolvedShortcut = resolveExtensionShortcut(host, sourcePath, normalizedShortcut);
  if (!command || typeof command !== "object") {
    host.invalidEntries.push(`${sourcePath}: registerShortcut ${resolvedShortcut} missing command object`);
    return;
  }
  const entry = command as Record<string, unknown>;
  const run = entry.handler ?? entry.run ?? entry.execute;
  if (typeof run !== "function") {
    host.invalidEntries.push(`${sourcePath}: registerShortcut ${resolvedShortcut} missing handler`);
    return;
  }
  host.shortcuts.set(resolvedShortcut, {
    name: resolvedShortcut,
    usage: resolvedShortcut,
    description: typeof entry.description === "string" ? entry.description : undefined,
    handler: run as RuntimeExtensionCommand["handler"],
  });
  recordRuntimeExtensionActivity(host, "shortcut", "registered", resolvedShortcut, sourcePath);
}

function resolveExtensionShortcut(host: RuntimeExtensionHost, sourcePath: string, shortcut: string): string {
  if (!BUILTIN_SHORTCUTS.has(shortcut) && !host.shortcuts.has(shortcut)) {
    return shortcut;
  }
  const fallback = shortcut.replace(/^(?:ctrl|control)\+/, "alt+");
  if (fallback !== shortcut && !BUILTIN_SHORTCUTS.has(fallback) && !host.shortcuts.has(fallback)) {
    host.notifications.push(`warn: remapped extension shortcut ${shortcut} to ${fallback} (${sourcePath})`);
    recordRuntimeExtensionActivity(host, "shortcut", "warning", `remapped ${shortcut} to ${fallback}`, sourcePath);
    return fallback;
  }
  host.invalidEntries.push(`${sourcePath}: registerShortcut ${shortcut} conflicts with existing shortcut`);
  recordRuntimeExtensionActivity(host, "shortcut", "failed", `conflict ${shortcut}`, sourcePath);
  return shortcut;
}

function normalizeShortcutName(shortcut: string): string {
  return shortcut.trim().toLowerCase().replace(/^control\+/, "ctrl+").replace(/^option\+/, "alt+").replace(/^meta\+/, "alt+");
}

function normalizeCommandName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function createRuntimeExtensionContext(session: RuntimeSession): RuntimeExtensionContext {
  const systemMessages: string[] = [];
  const ui = new Proxy({
    notify(message: string, level = "info") {
      session.extensions?.notifications.push(`${level}: ${message}`);
      recordRuntimeExtensionActivity(session.extensions, "notification", level === "error" ? "failed" : level === "warn" ? "warning" : "info", String(message));
      session.extensions?.uiBridge?.notify?.(message, level);
    },
    setWidget(id: string, lines: string[] | undefined) {
      if (!session.extensions) {
        return;
      }
      if (lines === undefined) {
        session.extensions.widgets.delete(id);
        recordRuntimeExtensionActivity(session.extensions, "widget", "info", `cleared ${id}`);
        session.extensions.uiBridge?.setWidget?.(id, undefined);
        return;
      }
      const normalizedLines = Array.isArray(lines) ? lines : [String(lines)];
      session.extensions.widgets.set(id, normalizedLines);
      recordRuntimeExtensionActivity(session.extensions, "widget", "info", `set ${id}`);
      session.extensions.uiBridge?.setWidget?.(id, normalizedLines);
    },
    getEditorText() {
      const bridged = session.extensions?.uiBridge?.getEditorText?.();
      if (typeof bridged === "string") {
        return bridged;
      }
      return session.extensions?.editorText ?? "";
    },
    setEditorText(value: string) {
      if (session.extensions) {
        session.extensions.editorText = value;
        session.extensions.uiBridge?.setEditorText?.(value);
      }
    },
    setFooter(footer: string) {
      session.extensions?.widgets.set("footer", [footer]);
      recordRuntimeExtensionActivity(session.extensions, "widget", "info", "set footer");
      session.extensions?.uiBridge?.setWidget?.("footer", [footer]);
    },
    custom<T>(factory: RuntimeExtensionCustomFactory<T>) {
      const bridged = session.extensions?.uiBridge?.custom?.(factory);
      if (bridged) {
        return bridged;
      }
      return Promise.resolve(undefined as T);
    },
  }, {
    get(target, prop, receiver) {
      if (typeof prop !== "string") {
        return Reflect.get(target, prop, receiver);
      }
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }
      return (..._args: unknown[]) => undefined;
    },
  });
  return {
    cwd: session.cwd,
    hasUI: true,
    ui,
    settingsManager: {
      getSettings() {
        return loadPiLikeSettings(session.cwd);
      },
      get(key?: string) {
        const settings = loadPiLikeSettings(session.cwd);
        return key ? settings[key] : settings;
      },
      set() {
        return undefined;
      },
      update() {
        return undefined;
      },
    },
    addSystemMessage(message) {
      systemMessages.push(message);
    },
    systemMessages,
    sessionManager: {
      getBranch() {
        return session.conversation.map((turn, index) => ({
          type: "message",
          id: String(index),
          message: {
            role: turn.role,
            content: turn.content,
          },
        }));
      },
    },
  };
}

function recordRuntimeExtensionActivity(
  host: RuntimeExtensionHost | undefined,
  event: string,
  status: RuntimeExtensionActivity["status"],
  summary: string,
  source: string | null = null,
): void {
  if (!host) {
    return;
  }
  host.activity.push({
    at: new Date().toISOString(),
    event,
    status,
    summary: firstLine(summary, 120),
    source,
  });
  if (host.activity.length > 50) {
    host.activity.splice(0, host.activity.length - 50);
  }
}

function firstLine(value: string, limit: number): string {
  const line = String(value).split(/\r?\n/)[0]?.trim() ?? "";
  return line.length > limit ? `${line.slice(0, limit - 3)}...` : line;
}

export function createRuntimeExtensionArgs(args: readonly string[]): RuntimeExtensionArgs {
  const values = [...args] as RuntimeExtensionArgs;
  Object.defineProperties(values, {
    trim: {
      value: () => values.join(" ").trim(),
      enumerable: false,
    },
    toString: {
      value: () => values.join(" "),
      enumerable: false,
    },
  });
  return values;
}

function loadPiLikeSettings(cwd: string): Record<string, unknown> {
  return {
    ...readJsonObject(path.join(homedir(), ".pi", "agent", "settings.json")),
    ...readJsonObject(path.join(cwd, ".pi", "settings.json")),
    ...readJsonObject(path.join(cwd, ".nexagent", "extensions.json")),
  };
}

function readJsonObject(filePath: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}
