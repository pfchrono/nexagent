import { spawn, spawnSync } from "node:child_process";

import type { RuntimeSession } from "./session.js";

export const SESSION_EMOJIS = ["◆", "◇", "✦", "✧", "●", "◌", "▲", "△", "■", "□", "✶", "✷"];
export const SESSION_COLORS = [39, 75, 81, 114, 141, 147, 177, 183, 210, 216, 220, 222, 228, 229, 250, 252];

export function stableSessionIndex(session: RuntimeSession, modulo: number): number {
  const source = session.id || session.startedAt || session.cwd;
  let hash = 0;
  for (const char of source) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return modulo > 0 ? hash % modulo : 0;
}

export function getSessionEmoji(session: RuntimeSession): string {
  const configured = session.ui?.sessionEmoji;
  if (configured && configured.trim().length > 0) {
    return configured;
  }
  return SESSION_EMOJIS[stableSessionIndex(session, SESSION_EMOJIS.length)] ?? "◆";
}

export function getSessionColorIndex(session: RuntimeSession): number {
  const configured = session.ui?.sessionColorIndex;
  if (typeof configured === "number" && Number.isFinite(configured)) {
    return Math.max(0, Math.floor(configured)) % SESSION_COLORS.length;
  }
  return stableSessionIndex(session, SESSION_COLORS.length);
}

export function getSessionColorCode(session: RuntimeSession): number {
  return SESSION_COLORS[getSessionColorIndex(session)] ?? 39;
}

export function formatSessionColorSwatch(session: RuntimeSession): string {
  const color = getSessionColorCode(session);
  return `\x1b[38;5;${String(color)}m████\x1b[0m color=${String(color)} index=${String(getSessionColorIndex(session))}`;
}

export function notifyThresholdMs(session: RuntimeSession): number {
  const configured = session.ui?.notifyThresholdMs;
  return typeof configured === "number" && Number.isFinite(configured) ? Math.max(0, Math.floor(configured)) : 2000;
}

export function emitTerminalNotification(title: string, body: string): void {
  process.stdout.write("\x07");
  if (process.platform === "darwin") {
    spawnIfAvailable("osascript", ["-e", `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`]);
    return;
  }
  if (process.platform === "linux") {
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY && !process.env.DBUS_SESSION_BUS_ADDRESS) {
      return;
    }
    spawnIfAvailable("notify-send", [title, body]);
  }
}

function spawnIfAvailable(command: string, args: string[]): void {
  const commandPath = findExecutable(command);
  if (!commandPath) {
    return;
  }
  try {
    const child = spawn(commandPath, args, { detached: true, stdio: "ignore" });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // Terminal bell above is primary fallback.
  }
}

function findExecutable(command: string): string | null {
  try {
    const result = spawnSync("sh", ["-lc", `command -v ${shellQuote(command)}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (result.status !== 0) {
      return null;
    }
    const resolved = result.stdout.trim().split(/\r?\n/)[0]?.trim();
    return resolved || null;
  } catch {
    return null;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
