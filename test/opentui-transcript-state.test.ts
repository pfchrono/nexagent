import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  createOpenTuiTranscriptState,
  handleOpenTuiTranscriptEvent,
  isBlockExpanded,
  visibleLineWindow,
} from "../src/opentui/transcript-state.js";

test("OpenTUI transcript state clamps line and page scrolling", () => {
  const metrics = { contentLineCount: 30, viewportLineCount: 10, blockCount: 4 };
  let state = createOpenTuiTranscriptState();

  state = handleOpenTuiTranscriptEvent(state, { kind: "content-updated", metrics });
  assert.equal(state.scrollOffset, 20);
  assert.equal(state.atLatest, true);

  state = handleOpenTuiTranscriptEvent(state, { kind: "scroll-lines", delta: -100, metrics });
  assert.equal(state.scrollOffset, 0);
  assert.equal(state.atLatest, false);

  state = handleOpenTuiTranscriptEvent(state, { kind: "scroll-page", direction: 1, metrics });
  assert.equal(state.scrollOffset, 10);

  state = handleOpenTuiTranscriptEvent(state, { kind: "scroll-page", direction: 1, metrics });
  assert.equal(state.scrollOffset, 20);
  assert.equal(state.atLatest, true);
});

test("OpenTUI transcript state preserves latest anchoring only when attached", () => {
  let state = createOpenTuiTranscriptState();
  state = handleOpenTuiTranscriptEvent(state, {
    kind: "content-updated",
    metrics: { contentLineCount: 12, viewportLineCount: 5, blockCount: 2 },
  });
  assert.equal(state.scrollOffset, 7);
  assert.equal(state.selectedBlockIndex, 1);

  state = handleOpenTuiTranscriptEvent(state, {
    kind: "content-updated",
    metrics: { contentLineCount: 16, viewportLineCount: 5, blockCount: 3 },
  });
  assert.equal(state.scrollOffset, 11);
  assert.equal(state.atLatest, true);
  assert.equal(state.selectedBlockIndex, 2);

  state = handleOpenTuiTranscriptEvent(state, {
    kind: "scroll-lines",
    delta: -2,
    metrics: { contentLineCount: 16, viewportLineCount: 5, blockCount: 3 },
  });
  assert.equal(state.atLatest, false);

  state = handleOpenTuiTranscriptEvent(state, {
    kind: "content-updated",
    metrics: { contentLineCount: 20, viewportLineCount: 5, blockCount: 4 },
  });
  assert.equal(state.scrollOffset, 9);
  assert.equal(state.atLatest, false);
  assert.equal(state.selectedBlockIndex, 2);

  state = handleOpenTuiTranscriptEvent(state, {
    kind: "jump-latest",
    metrics: { contentLineCount: 20, viewportLineCount: 5, blockCount: 4 },
  });
  assert.equal(state.scrollOffset, 15);
  assert.equal(state.atLatest, true);
});

test("OpenTUI transcript state toggles collapsed blocks and selected block", () => {
  const metrics = { contentLineCount: 10, viewportLineCount: 5, blockCount: 3 };
  let state = createOpenTuiTranscriptState();

  assert.equal(isBlockExpanded(state, "trace-1", true), false);
  state = handleOpenTuiTranscriptEvent(state, { kind: "toggle-block", blockId: "trace-1" });
  assert.equal(isBlockExpanded(state, "trace-1", true), true);

  state = handleOpenTuiTranscriptEvent(state, { kind: "select-block", direction: 1, metrics });
  state = handleOpenTuiTranscriptEvent(state, { kind: "select-block", direction: 1, metrics });
  state = handleOpenTuiTranscriptEvent(state, { kind: "select-block", direction: 1, metrics });
  assert.equal(state.selectedBlockIndex, 2);

  state = handleOpenTuiTranscriptEvent(state, { kind: "select-block", direction: -1, metrics });
  assert.equal(state.selectedBlockIndex, 1);
});

test("OpenTUI transcript visible window never returns blank bottom gaps", () => {
  const lines = Array.from({ length: 6 }, (_, index) => `line ${String(index)}`);
  const state = { ...createOpenTuiTranscriptState(), scrollOffset: 20 };

  assert.deepEqual(visibleLineWindow(lines, state, 3), ["line 3", "line 4", "line 5"]);
});
