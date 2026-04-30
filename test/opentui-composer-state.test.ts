import assert from "node:assert/strict";
import { test } from "bun:test";

import {
  createOpenTuiComposerState,
  handleOpenTuiComposerEvent,
  setComposerAttachment,
} from "../src/opentui/composer-state.js";

test("OpenTUI composer Enter submits non-empty prompt", () => {
  const editing = handleOpenTuiComposerEvent(createOpenTuiComposerState(), { kind: "character", value: "h" }).state;
  const result = handleOpenTuiComposerEvent(editing, { kind: "enter" });

  assert.deepEqual(result.intent, { kind: "submit", prompt: "h" });
  assert.equal(result.state.text, "");
});

test("OpenTUI composer Shift+Enter inserts newline", () => {
  const editing = handleOpenTuiComposerEvent(createOpenTuiComposerState(), { kind: "character", value: "h" }).state;
  const result = handleOpenTuiComposerEvent(editing, { kind: "enter", shift: true });

  assert.equal(result.intent, null);
  assert.equal(result.state.text, "h\n");
});

test("OpenTUI composer Tab accepts first matching completion", () => {
  const state = { ...createOpenTuiComposerState(), text: "/st" };
  const result = handleOpenTuiComposerEvent(state, {
    kind: "tab",
    completion: {
      value: "/status ",
      hint: "commands",
      selectedIndex: 0,
      suggestions: [
        { value: "/status ", label: "/status", hint: "show status" },
        { value: "/steer ", label: "/steer", hint: "queue steer" },
      ],
    },
  });

  assert.equal(result.state.text, "/status ");
});

test("OpenTUI composer history browsing preserves draft text", () => {
  const state = { ...createOpenTuiComposerState(), text: "draft" };

  const blocked = handleOpenTuiComposerEvent(state, { kind: "history", direction: -1, history: ["old"] });
  assert.equal(blocked.state.text, "draft");

  const browsed = handleOpenTuiComposerEvent(state, { kind: "history", direction: -1, force: true, history: ["old"] });
  assert.equal(browsed.state.text, "old");
  assert.equal(browsed.state.promptDraft, "draft");
});

test("OpenTUI composer empty Up browses history", () => {
  const result = handleOpenTuiComposerEvent(createOpenTuiComposerState(), {
    kind: "history",
    direction: -1,
    history: ["first", "latest"],
  });

  assert.equal(result.state.text, "latest");
});

test("OpenTUI composer clear attachment emits intent", () => {
  const attached = setComposerAttachment(createOpenTuiComposerState(), { label: "image.png", supported: true });
  const result = handleOpenTuiComposerEvent(attached, { kind: "clear-attachment" });

  assert.equal(result.state.attachment, null);
  assert.deepEqual(result.intent, { kind: "clear-attachment" });
});

test("OpenTUI composer overlay Up and Down move selected index", () => {
  const state = { ...createOpenTuiComposerState(), text: "/", overlayMode: "command" as const, selectedIndex: 0 };

  const moved = handleOpenTuiComposerEvent(state, { kind: "move-selection", direction: 1, rowCount: 3 });
  assert.equal(moved.state.selectedIndex, 1);

  const clamped = handleOpenTuiComposerEvent(moved.state, { kind: "move-selection", direction: 1, rowCount: 2 });
  assert.equal(clamped.state.selectedIndex, 1);
});

test("OpenTUI composer history overlay selected row can load text", () => {
  const state = { ...createOpenTuiComposerState(), overlayMode: "history-search" as const, selectedIndex: 1 };
  const result = handleOpenTuiComposerEvent(state, {
    kind: "accept-selection",
    values: ["first", "second"],
  });

  assert.equal(result.state.text, "second");
  assert.equal(result.state.overlayMode, "none");
  assert.equal(result.intent, null);
});
