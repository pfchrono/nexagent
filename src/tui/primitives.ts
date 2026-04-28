let screenInitialized = false;

export const ANSI = {
  reset: "\x1b[0m",
  none: "",
  header: "\x1b[1;97m",
  dim: "\x1b[2;37m",
  rule: "\x1b[38;5;180m",
  progress: "\x1b[38;5;186m",
  footer: "\x1b[38;5;151m",
  prompt: "\x1b[1;96m",
  preview: "\x1b[38;5;223m",
  user: "\x1b[1;97m",
  agent: "\x1b[38;5;220m",
  trace: "\x1b[38;5;111m",
  working: "\x1b[38;5;149m",
} as const;

export function wrapText(value: string, width: number): string[] {
  if (value.length === 0) {
    return [""];
  }

  const chunks: string[] = [];
  let remaining = value;

  while (remaining.length > width) {
    const breakIndex = remaining.lastIndexOf(" ", width);
    const splitAt = breakIndex > Math.floor(width / 2) ? breakIndex : width;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  chunks.push(remaining);
  return chunks;
}

export function renderScreen(lines: string[]): string {
  const prefix = screenInitialized
    ? "\x1b[H"
    : "\x1b[?1049h\x1b[?25l\x1b[H";
  screenInitialized = true;
  return `${prefix}${lines.join("\x1b[K\n")}\x1b[K\x1b[J`;
}

export function resetScreenRenderer(): void {
  screenInitialized = false;
}

export function renderRule(width: number): string {
  return "─".repeat(Math.max(8, width));
}

export function tintLine(value: string, ansi: string): string {
  if (!ansi || value.length === 0) {
    return value;
  }
  return `${ansi}${value}${ANSI.reset}`;
}

export function padLine(value: string, width: number): string {
  return truncateLine(value, width).padEnd(width, " ");
}

export function padVisibleLine(value: string, width: number): string {
  const visible = stripAnsi(value);
  if (visible.length >= width) {
    return value;
  }
  return `${value}${" ".repeat(width - visible.length)}`;
}

export function truncateLine(value: string, width: number): string {
  if (value.length <= width) {
    return value;
  }

  if (width <= 1) {
    return value.slice(0, width);
  }

  return `${value.slice(0, width - 1)}…`;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}
