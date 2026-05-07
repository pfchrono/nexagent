import type { RuntimeDebugOptions } from "../runtime/debug.js";
import { COMMAND_CATALOG } from "./catalog.js";

interface RunCommand {
  kind: "run";
  prompt: string | null;
  yolo: boolean;
  debug: RuntimeDebugOptions;
}

interface InspectCommand {
  kind: "inspect";
  yolo: boolean;
  debug: RuntimeDebugOptions;
}

interface GrpcCommand {
  kind: "grpc";
  yolo: boolean;
  debug: RuntimeDebugOptions;
  host: string;
  port: number;
}

interface HelpCommand {
  kind: "help";
}

export type CliCommand = RunCommand | InspectCommand | GrpcCommand | HelpCommand;

export const LAUNCH_SWITCHES = [
  { flag: "--help", alias: "-h", description: "show this help and exit" },
  { flag: "--yolo", description: "bypass guarded approval prompts while preserving destructive-command blocks" },
  { flag: "--debug", description: "write diagnostic log to /tmp/nexagent-debug-<timestamp>.log" },
  { flag: "--debugfile", description: "write diagnostic log to a .log path under home or /tmp" },
  { flag: "--verbose", description: "include internal core input/output in debug logs" },
] as const;

type LaunchSwitch = {
  flag: string;
  alias?: string;
  description: string;
};

export function parseCommand(argv: string[]): CliCommand {
  if (argv.includes("--help") || argv.includes("-h") || argv[0] === "help") {
    return { kind: "help" };
  }
  const yolo = argv.includes("--yolo");
  const debug = parseDebugOptions(argv);
  const normalizedArgv = stripLaunchSwitches(argv);

  if (normalizedArgv[0] === "grpc") {
    return {
      kind: "grpc",
      yolo,
      debug,
      host: parseGrpcHost(readOption(argv, "--host", "usage: grpc [--host 127.0.0.1] [--port 0-65535]") ?? "127.0.0.1"),
      port: parsePort(readOption(argv, "--port", "usage: grpc [--host 127.0.0.1] [--port 0-65535]") ?? "0"),
    };
  }

  if (normalizedArgv[0] !== "run") {
    return { kind: "inspect", yolo, debug };
  }

  const prompt = normalizedArgv.slice(1).join(" ").trim();
  const command: RunCommand = {
    kind: "run",
    prompt: prompt.length > 0 ? prompt : null,
    yolo,
    debug,
  };
  return command;
}

function readOption(argv: string[], name: string, usage: string): string | null {
  const index = argv.indexOf(name);
  if (index < 0) {
    return null;
  }
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(usage);
  }
  return value;
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("usage: grpc [--host 127.0.0.1] [--port 0-65535]");
  }
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("usage: grpc [--host 127.0.0.1] [--port 0-65535]");
  }
  return port;
}

function parseGrpcHost(value: string): string {
  if (value !== "127.0.0.1" && value !== "localhost") {
    throw new Error("usage: grpc only supports loopback hosts: 127.0.0.1 or localhost");
  }
  return value;
}

function parseDebugOptions(argv: string[]): RuntimeDebugOptions {
  const debugFileIndex = argv.indexOf("--debugfile");
  const debugFile = debugFileIndex >= 0 ? argv[debugFileIndex + 1] ?? null : null;
  if (debugFileIndex >= 0 && !debugFile) {
    throw new Error("usage: --debugfile <path.log>");
  }
  return {
    enabled: argv.includes("--debug"),
    verbose: argv.includes("--verbose"),
    debugFile,
  };
}

function stripLaunchSwitches(argv: string[]): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--yolo" || arg === "--opentui" || arg === "--debug" || arg === "--verbose") {
      continue;
    }
    if (arg === "--debugfile" || arg === "--host" || arg === "--port") {
      index += 1;
      continue;
    }
    normalized.push(arg);
  }
  return normalized;
}

export function formatLaunchHelp(): string {
  return [
    "nexagent",
    "",
    "Usage:",
    "  nexagent [--yolo]",
    "  nexagent run [--yolo] <prompt>",
    "  nexagent grpc [--yolo] [--host 127.0.0.1] [--port 0]",
    "  nexagent --help",
    "",
    "Launch switches:",
    ...LAUNCH_SWITCHES.map((entry) => formatLaunchSwitchHelp(entry)),
    "",
    "Commands:",
    "  run          execute one prompt from arguments and/or piped stdin",
    "  grpc         start gRPC automation server for external harnesses",
    "  help         show this help and exit",
    "",
    "In-session slash commands:",
    formatCommandCatalog(),
  ].join("\n");
}

function formatLaunchSwitchHelp(entry: LaunchSwitch): string {
  const label = entry.alias ? `${entry.flag}, ${entry.alias}` : entry.flag;
  return `  ${label.padEnd(12, " ")} ${entry.description}`;
}

function formatCommandCatalog(): string {
  return [
    "  <enter>      start interactive session",
    ...COMMAND_CATALOG.map((command) => `${command.usage} - ${command.description}`),
  ].join("\n");
}

export function resolvePrompt(prompt: string | null, pipedInput: string | null): string {
  const normalizedPrompt = prompt?.trim() ?? "";
  const normalizedInput = pipedInput?.trim() ?? "";

  if (normalizedPrompt.length > 0 && normalizedInput.length > 0) {
    return `${normalizedPrompt}\n\n${normalizedInput}`;
  }

  if (normalizedPrompt.length > 0) {
    return normalizedPrompt;
  }

  if (normalizedInput.length > 0) {
    return normalizedInput;
  }

  throw new Error('usage: nexagent run "prompt" or pipe stdin');
}
