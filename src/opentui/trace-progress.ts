import type { OpenTuiTranscriptBlock } from "./runtime-view.js";

export interface TraceProgressRow {
  key: string;
  text: string;
  fg: string;
  toggleKey: string;
  canToggle: boolean;
  detailLines: string[];
}

export function renderTraceProgressRows(blocks: OpenTuiTranscriptBlock[], width: number): TraceProgressRow[] {
  return renderTraceProgressEventRows(blocks.flatMap((block) => block.detailLines), width);
}

export function markActiveTraceProgressRow(rows: TraceProgressRow[], activeKey: string | null, width: number): TraceProgressRow[] {
  if (!activeKey) {
    return rows;
  }
  return rows.map((row) => {
    if (row.key !== activeKey || !row.canToggle) {
      return row;
    }
    return {
      ...row,
      text: fitLine(row.text.replace(/ \[\+\]$/, " [-]"), width),
    };
  });
}

export function limitTraceProgressRows(rows: TraceProgressRow[], width: number, maxRows: number): TraceProgressRow[] {
  if (rows.length <= maxRows) {
    return rows;
  }
  const headCount = Math.min(3, Math.max(1, Math.floor(maxRows / 4)));
  const tailCount = Math.max(1, maxRows - headCount - 1);
  return [
    ...rows.slice(0, headCount),
    {
      key: "trace-progress-overflow",
      text: fitLine(`  ... ${String(rows.length - headCount - tailCount)} older progress events`, width),
      fg: "#6c7086",
      toggleKey: "trace-progress-overflow",
      canToggle: false,
      detailLines: [],
    },
    ...rows.slice(rows.length - tailCount),
  ];
}

function renderTraceProgressEventRows(lines: string[], width: number): TraceProgressRow[] {
  const rows: TraceProgressRow[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const detailLines: string[] = [];
    while (lines[index + 1]?.startsWith("  ")) {
      detailLines.push(lines[index + 1] ?? "");
      index += 1;
    }
    const row = parseTraceProgressLine(line, detailLines, width);
    if (!row) {
      continue;
    }
    rows.push(row);
  }
  return rows;
}

function parseTraceProgressLine(line: string, detailLines: string[], width: number): TraceProgressRow | null {
  const parsed = parseTraceProgressEvent(line, detailLines);
  if (!parsed) {
    return null;
  }
  const { kind, status, summary } = parsed;
  const statusMark = status === "completed" ? "ok"
    : status === "failed" || status === "blocked" ? "!"
      : status === "started" ? ">"
        : "-";
  const compactSummary = formatTraceProgressSummary(kind, status, summary, line);
  const metrics = formatTraceProgressMetricBadge(detailLines);
  const key = `trace-progress-${parsed.at ?? line}-${kind}-${status}-${summary}`;
  const hasDetail = detailLines.length > 0;
  const suffix = hasDetail ? " [+]" : "";
  const fg = status === "failed" || status === "blocked" ? "#f38ba8"
    : kind === "tool" ? "#89b4fa"
      : kind === "assistant" || kind === "provider" ? "#cba6f7"
        : "#a6adc8";
  return {
    key,
    text: fitLine(`${statusMark} ${compactSummary}${metrics ? ` · ${metrics}` : ""}${suffix}`, width),
    fg,
    toggleKey: key,
    canToggle: hasDetail,
    detailLines,
  };
}

function parseTraceProgressEvent(
  line: string,
  detailLines: string[],
): { at: string | null; kind: string; status: string; summary: string } | null {
  const parts = line.split(" | ");
  if (parts.length >= 4 && /^\d{4}-\d{2}-\d{2}T/.test(parts[0] ?? "")) {
    return {
      at: parts[0] ?? null,
      kind: parts[1] ?? "event",
      status: parts[2] ?? "queued",
      summary: parts.slice(3).join(" | "),
    };
  }
  const metadata = detailLines.find((detailLine) => /\bat\s+\d{4}-\d{2}-\d{2}T.*\bkind\s+\w+.*\bstatus\s+\w+/.test(detailLine));
  const metaMatch = metadata?.match(/\bat\s+(\S+)\s+·\s+kind\s+(\w+)\s+·\s+status\s+(\w+)/);
  if (!metaMatch) {
    return null;
  }
  return {
    at: metaMatch[1] ?? null,
    kind: metaMatch[2] ?? "event",
    status: metaMatch[3] ?? "queued",
    summary: line.replace(/^[^\p{L}\p{N}]+/u, "").trim(),
  };
}

function formatTraceProgressMetricBadge(detailLines: string[]): string {
  const detail = detailLines.map((line) => line.trim()).join("; ");
  const duration = readTraceProgressMetric(detail, "duration");
  const inputTokens = readTraceProgressMetric(detail, "turn_in") ?? readTraceProgressMetric(detail, "in");
  const outputTokens = readTraceProgressMetric(detail, "turn_out") ?? readTraceProgressMetric(detail, "out");
  return [
    duration,
    inputTokens ? `↓ ${inputTokens}` : null,
    outputTokens ? `↑ ${outputTokens}` : null,
  ].filter((value): value is string => Boolean(value)).join(" ");
}

export function readTraceProgressMetric(detail: string, key: "duration" | "in" | "out" | "turn_in" | "turn_out"): string | null {
  const separator = key === "duration" ? "=" : "~";
  const match = new RegExp(`(?:^|[;\\s])${key}${separator}([^;\\s]+)`).exec(detail);
  return match?.[1] ?? null;
}

function formatTraceProgressSummary(kind: string, status: string, summary: string, sourceLine?: string): string {
  if (sourceLine && !sourceLine.includes(" | ")) {
    return summary;
  }
  if (kind === "tool") {
    const toolName = summary
      .replace(/^tool\s+/, "")
      .replace(/\s+(started|completed|failed|blocked)$/i, "");
    return `tool ${toolName} ${status}`;
  }
  if (kind === "prompt") {
    return `prompt ${status} · ${summary}`;
  }
  return `${kind} ${status} · ${summary}`;
}

function fitLine(line: string, width: number): string {
  if (line.length <= width) {
    return line;
  }
  if (width <= 1) {
    return "";
  }
  return `${line.slice(0, Math.max(0, width - 1))}…`;
}
