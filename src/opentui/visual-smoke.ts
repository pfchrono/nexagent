export type VisualSmokeScenario =
  | "palette"
  | "config"
  | "approval"
  | "trace"
  | "attach"
  | "small-terminal";

export interface VisualSmokeSize {
  columns: number;
  rows: number;
}

export interface VisualSmokeCapture {
  scenario: VisualSmokeScenario;
  size: VisualSmokeSize;
  rows: string[];
}

export interface VisualSmokeCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VisualSmokeResult {
  ok: boolean;
  checks: VisualSmokeCheck[];
}

export interface VisualSmokeOptions {
  minNonBlankRatio?: number;
  requireFrame?: boolean;
  expectedTokens?: string[];
  forbiddenTokens?: string[];
}

const ANSI_PATTERN = /\u001b\[[0-9;?]*[A-Za-z]/g;
const DEFAULT_FORBIDDEN_TOKENS = ["undefined", "NaN", "[object Object]"];
const FRAME_CHARS = new Set(["+", "-", "|", "╭", "╮", "╰", "╯", "─", "│", "┌", "┐", "└", "┘"]);

export function stripAnsi(value: string): string {
  return value.replace(ANSI_PATTERN, "");
}

export function createVisualSmokeCapture(
  scenario: VisualSmokeScenario,
  content: string | readonly string[],
  size: Partial<VisualSmokeSize> = {},
): VisualSmokeCapture {
  const columns = clampInteger(size.columns ?? 80, 20, 240);
  const rows = clampInteger(size.rows ?? 24, 8, 120);
  const sourceRows: string[] = typeof content === "string" ? content.split(/\r?\n/) : [...content];
  const visibleRows = sourceRows.map((row: string) => stripAnsi(row).replace(/\r/g, "")).slice(0, rows);

  return {
    scenario,
    size: { columns, rows },
    rows: visibleRows,
  };
}

export function verifyVisualSmokeCapture(
  capture: VisualSmokeCapture,
  options: VisualSmokeOptions = {},
): VisualSmokeResult {
  const expectedTokens = options.expectedTokens ?? [];
  const forbiddenTokens = [...DEFAULT_FORBIDDEN_TOKENS, ...(options.forbiddenTokens ?? [])];
  const text = capture.rows.join("\n");
  const usedCells = capture.rows.reduce((total, row) => total + row.replace(/\s/g, "").length, 0);
  const totalCells = Math.max(1, capture.size.columns * capture.size.rows);
  const nonBlankRatio = usedCells / totalCells;
  const overflowRows = capture.rows
    .map((row, index) => ({ index, width: visibleWidth(row), row }))
    .filter((entry) => entry.width > capture.size.columns);
  const checks: VisualSmokeCheck[] = [
    {
      name: "nonblank",
      ok: nonBlankRatio >= (options.minNonBlankRatio ?? 0.02),
      detail: `ratio ${nonBlankRatio.toFixed(3)}`,
    },
    {
      name: "framing",
      ok: options.requireFrame === false || hasFrame(capture.rows),
      detail: options.requireFrame === false ? "not required" : "frame chars present",
    },
    {
      name: "width",
      ok: overflowRows.length === 0,
      detail: overflowRows.length === 0
        ? `all rows <= ${String(capture.size.columns)} columns`
        : overflowRows.map((entry) => `row ${String(entry.index + 1)} width ${String(entry.width)}`).join("; "),
    },
    {
      name: "height",
      ok: capture.rows.length <= capture.size.rows,
      detail: `${String(capture.rows.length)}/${String(capture.size.rows)} rows`,
    },
    {
      name: "expected-tokens",
      ok: expectedTokens.every((token) => text.includes(token)),
      detail: expectedTokens.length === 0 ? "none" : expectedTokens.join(", "),
    },
    {
      name: "forbidden-tokens",
      ok: forbiddenTokens.every((token) => !text.includes(token)),
      detail: forbiddenTokens.join(", "),
    },
  ];

  return {
    ok: checks.every((check) => check.ok),
    checks,
  };
}

export function formatVisualSmokeReport(capture: VisualSmokeCapture, result: VisualSmokeResult): string {
  const status = result.ok ? "PASS" : "FAIL";
  return [
    `${status} ${capture.scenario} ${String(capture.size.columns)}x${String(capture.size.rows)}`,
    ...result.checks.map((check) => `${check.ok ? "ok" : "bad"} ${check.name}: ${check.detail}`),
  ].join("\n");
}

function visibleWidth(value: string): number {
  return [...stripAnsi(value)].length;
}

function hasFrame(rows: readonly string[]): boolean {
  let frameRows = 0;
  for (const row of rows) {
    let frameChars = 0;
    for (const char of row) {
      if (FRAME_CHARS.has(char)) {
        frameChars += 1;
      }
    }
    if (frameChars >= 2) {
      frameRows += 1;
    }
  }
  return frameRows >= 2;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
