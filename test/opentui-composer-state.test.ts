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
  assert.equal(result.state.cursorIndex, "/status ".length);
});

test("OpenTUI composer Left Right Home and End move editing cursor", () => {
  const state = { ...createOpenTuiComposerState(), text: "abcd", cursorIndex: 4 };

  const left = handleOpenTuiComposerEvent(state, { kind: "move-cursor", direction: -1 });
  assert.equal(left.state.cursorIndex, 3);

  const home = handleOpenTuiComposerEvent(left.state, { kind: "move-cursor-to", position: "start" });
  assert.equal(home.state.cursorIndex, 0);

  const right = handleOpenTuiComposerEvent(home.state, { kind: "move-cursor", direction: 1 });
  assert.equal(right.state.cursorIndex, 1);

  const end = handleOpenTuiComposerEvent(right.state, { kind: "move-cursor-to", position: "end" });
  assert.equal(end.state.cursorIndex, 4);
});

test("OpenTUI composer inserts and deletes at cursor", () => {
  const state = { ...createOpenTuiComposerState(), text: "ac", cursorIndex: 1 };

  const inserted = handleOpenTuiComposerEvent(state, { kind: "character", value: "b" });
  assert.equal(inserted.state.text, "abc");
  assert.equal(inserted.state.cursorIndex, 2);

  const backspaced = handleOpenTuiComposerEvent(inserted.state, { kind: "backspace" });
  assert.equal(backspaced.state.text, "ac");
  assert.equal(backspaced.state.cursorIndex, 1);

  const deleted = handleOpenTuiComposerEvent(backspaced.state, { kind: "delete-forward" });
  assert.equal(deleted.state.text, "a");
  assert.equal(deleted.state.cursorIndex, 1);
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
