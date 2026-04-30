export interface OpenTuiTranscriptState {
  scrollOffset: number;
  atLatest: boolean;
  expandedBlockIds: string[];
  selectedBlockIndex: number;
}

export interface TranscriptMetrics {
  contentLineCount: number;
  viewportLineCount: number;
  blockCount: number;
}

export type TranscriptStateEvent =
  | { kind: "content-updated"; metrics: TranscriptMetrics }
  | { kind: "scroll-lines"; delta: number; metrics: TranscriptMetrics }
  | { kind: "scroll-page"; direction: -1 | 1; metrics: TranscriptMetrics }
  | { kind: "jump-latest"; metrics: TranscriptMetrics }
  | { kind: "select-block"; direction: -1 | 1; metrics: TranscriptMetrics }
  | { kind: "set-selected-block"; index: number; metrics: TranscriptMetrics }
  | { kind: "toggle-block"; blockId: string };

export function createOpenTuiTranscriptState(): OpenTuiTranscriptState {
  return {
    scrollOffset: 0,
    atLatest: true,
    expandedBlockIds: [],
    selectedBlockIndex: 0,
  };
}

export function handleOpenTuiTranscriptEvent(
  state: OpenTuiTranscriptState,
  event: TranscriptStateEvent,
): OpenTuiTranscriptState {
  if (event.kind === "toggle-block") {
    const expandedBlockIds = state.expandedBlockIds.includes(event.blockId)
      ? state.expandedBlockIds.filter((id) => id !== event.blockId)
      : [...state.expandedBlockIds, event.blockId];
    return { ...state, expandedBlockIds };
  }

  const metrics = normalizeMetrics(event.metrics);
  const maxOffset = maxScrollOffset(metrics);

  if (event.kind === "content-updated") {
    const scrollOffset = state.atLatest ? maxOffset : clamp(state.scrollOffset, 0, maxOffset);
    return {
      ...state,
      scrollOffset,
      atLatest: scrollOffset === maxOffset,
      selectedBlockIndex: clamp(state.selectedBlockIndex, 0, Math.max(0, metrics.blockCount - 1)),
    };
  }

  if (event.kind === "jump-latest") {
    return { ...state, scrollOffset: maxOffset, atLatest: true };
  }

  if (event.kind === "scroll-page") {
    return scrollBy(state, event.direction * metrics.viewportLineCount, metrics);
  }

  if (event.kind === "scroll-lines") {
    return scrollBy(state, event.delta, metrics);
  }

  if (event.kind === "set-selected-block") {
    return {
      ...state,
      selectedBlockIndex: clamp(event.index, 0, Math.max(0, metrics.blockCount - 1)),
    };
  }

  const selectedBlockIndex = clamp(
    state.selectedBlockIndex + event.direction,
    0,
    Math.max(0, metrics.blockCount - 1),
  );
  return { ...state, selectedBlockIndex };
}

export function isBlockExpanded(state: OpenTuiTranscriptState, blockId: string, collapsedByDefault = false): boolean {
  return collapsedByDefault ? state.expandedBlockIds.includes(blockId) : !state.expandedBlockIds.includes(blockId);
}

export function visibleLineWindow<T>(lines: T[], state: OpenTuiTranscriptState, viewportLineCount: number): T[] {
  const normalizedViewport = Math.max(1, viewportLineCount);
  const start = clamp(state.scrollOffset, 0, Math.max(0, lines.length - normalizedViewport));
  return lines.slice(start, start + normalizedViewport);
}

function scrollBy(state: OpenTuiTranscriptState, delta: number, metrics: TranscriptMetrics): OpenTuiTranscriptState {
  const maxOffset = maxScrollOffset(metrics);
  const scrollOffset = clamp(state.scrollOffset + delta, 0, maxOffset);
  return { ...state, scrollOffset, atLatest: scrollOffset === maxOffset };
}

function normalizeMetrics(metrics: TranscriptMetrics): TranscriptMetrics {
  return {
    contentLineCount: Math.max(0, metrics.contentLineCount),
    viewportLineCount: Math.max(1, metrics.viewportLineCount),
    blockCount: Math.max(0, metrics.blockCount),
  };
}

function maxScrollOffset(metrics: TranscriptMetrics): number {
  return Math.max(0, metrics.contentLineCount - metrics.viewportLineCount);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
