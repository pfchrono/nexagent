#!/usr/bin/env node

import process from "node:process";
import { createInterface } from "node:readline";
import { bootstrapRuntime } from "./runtime/bootstrap.js";
import { createRuntimeSession } from "./runtime/session.js";

async function main(): Promise<void> {
  const runtime = await bootstrapRuntime(process.cwd());
  const session = createRuntimeSession(runtime);

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
    return;
  }

  try {
    process.stdout.write(renderRuntimeTui(session));
    await waitForExit();
  } finally {
    restoreTerminal();
  }
}

function renderRuntimeTui(session: ReturnType<typeof createRuntimeSession>): string {
  const lines = [
    "nexagent",
    "========",
    "",
    `session   ${session.id}`,
    `started   ${session.startedAt}`,
    `provider  ${session.provider}`,
    `cwd       ${session.cwd}`,
    "",
    "mcp",
    `  enabled ${formatList(session.enabledMcpServers)}`,
    `  loaded  ${formatList(session.mcpServers)}`,
    "",
    "imports",
    `  claude  ${formatClaudeImport(session.imports.claude)}`,
    "",
    "Press q or Ctrl+C to exit.",
  ];

  return `\x1b[?1049h\x1b[2J\x1b[H${lines.join("\n")}\n`;
}

function restoreTerminal(): void {
  process.stdout.write("\x1b[?1049l");
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function formatClaudeImport(claudeImport: ReturnType<typeof createRuntimeSession>["imports"]["claude"]): string {
  if (!claudeImport) {
    return "disabled";
  }

  const imported = claudeImport.importedKeys.length > 0 ? claudeImport.importedKeys.join(", ") : "none";
  return `${claudeImport.path} (${imported})`;
}

async function waitForExit(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stdin = process.stdin;
    let finished = false;
    let rawModeChanged = false;
    const priorRawMode = stdin.isRaw;
    const priorEncoding = stdin.readableEncoding;
    let readline: ReturnType<typeof createInterface> | undefined;

    const cleanup = () => {
      readline?.close();
      process.removeListener("SIGINT", onSigint);
      stdin.removeListener("data", onData);
      if (rawModeChanged) {
        stdin.setRawMode?.(priorRawMode);
      }
      stdin.setEncoding(priorEncoding ?? undefined);
      stdin.pause();
    };

    const finish = () => {
      if (finished) {
        return;
      }

      finished = true;
      cleanup();
      resolve();
    };

    const fail = (error: unknown) => {
      if (finished) {
        return;
      }

      finished = true;
      cleanup();
      reject(error);
    };

    const onSigint = () => {
      process.stdout.write("\n");
      finish();
    };

    const onData = (input: Buffer | string) => {
      if (input === "q" || input.toString() === "\u0003") {
        finish();
      }
    };

    try {
      readline = createInterface({ input: stdin, escapeCodeTimeout: 50 });
      process.once("SIGINT", onSigint);
      stdin.setEncoding("utf8");
      if (typeof stdin.setRawMode === "function") {
        stdin.setRawMode(true);
        rawModeChanged = priorRawMode !== true;
      }
      stdin.resume();
      stdin.on("data", onData);
    } catch (error) {
      fail(error);
    }
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
