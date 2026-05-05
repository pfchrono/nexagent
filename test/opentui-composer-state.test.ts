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

test("OpenTUI composer pastes clipboard text at cursor", () => {
  const state = { ...createOpenTuiComposerState(), text: "ac", cursorIndex: 1 };
  const pasted = handleOpenTuiComposerEvent(state, { kind: "paste", value: "b\r\nline" });

  assert.equal(pasted.state.text, "ab\nlinec");
  assert.equal(pasted.state.cursorIndex, "ab\nline".length);
  assert.equal(pasted.state.notice, "pasted");
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

test("OpenTUI composer Backspace clears attachment chip before prompt text", () => {
  const attached = setComposerAttachment(
    { ...createOpenTuiComposerState(), text: "describe this", cursorIndex: 0 },
    { label: "image.png", supported: true },
  );
  const result = handleOpenTuiComposerEvent(attached, { kind: "backspace" });

  assert.equal(result.state.attachment, null);
  assert.equal(result.state.text, "describe this");
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

test("OpenTUI composer opens completion overlay for trailing path tokens", () => {
  const homePath = handleOpenTuiComposerEvent(createOpenTuiComposerState(), { kind: "character", value: "~" });
  const homeSlash = handleOpenTuiComposerEvent(homePath.state, { kind: "character", value: "/" });
  const relativePath = handleOpenTuiComposerEvent(createOpenTuiComposerState(), { kind: "character", value: "." });
  const relativeSlash = handleOpenTuiComposerEvent(relativePath.state, { kind: "character", value: "/" });
  const prosePath = handleOpenTuiComposerEvent(createOpenTuiComposerState(), { kind: "character", value: "look at ./" });

  assert.equal(homeSlash.state.overlayMode, "command");
  assert.equal(relativeSlash.state.overlayMode, "command");
  assert.equal(prosePath.state.overlayMode, "command");
});

test("OpenTUI composer closes generic slash command palette after args start", () => {
  const command = handleOpenTuiComposerEvent(createOpenTuiComposerState(), { kind: "character", value: "/status" });
  const withSpace = handleOpenTuiComposerEvent(command.state, { kind: "character", value: " " });
  const withArg = handleOpenTuiComposerEvent(withSpace.state, { kind: "character", value: "-" });

  assert.equal(command.state.overlayMode, "command");
  assert.equal(withSpace.state.overlayMode, "none");
  assert.equal(withArg.state.overlayMode, "none");
});

test("OpenTUI composer keeps model and effort pickers open while typing args", () => {
  const modelCommand = handleOpenTuiComposerEvent(createOpenTuiComposerState(), { kind: "character", value: "/model" });
  const modelSpace = handleOpenTuiComposerEvent(modelCommand.state, { kind: "character", value: " " });
  const modelPartial = handleOpenTuiComposerEvent(modelSpace.state, { kind: "character", value: "g" });
  const modelWithEffortSpace = handleOpenTuiComposerEvent(
    { ...modelPartial.state, text: "/model gpt-5.5 ", cursorIndex: "/model gpt-5.5 ".length },
    { kind: "character", value: "h" },
  );
  const effortCommand = handleOpenTuiComposerEvent(createOpenTuiComposerState(), { kind: "character", value: "/effort" });
  const effortSpace = handleOpenTuiComposerEvent(effortCommand.state, { kind: "character", value: " " });
  const effortPartial = handleOpenTuiComposerEvent(effortSpace.state, { kind: "character", value: "x" });

  assert.equal(modelCommand.state.overlayMode, "command");
  assert.equal(modelSpace.state.overlayMode, "command");
  assert.equal(modelPartial.state.overlayMode, "command");
  assert.equal(modelWithEffortSpace.state.overlayMode, "command");
  assert.equal(effortCommand.state.overlayMode, "command");
  assert.equal(effortSpace.state.overlayMode, "command");
  assert.equal(effortPartial.state.overlayMode, "command");
});

test("OpenTUI composer opens skill overlay for trailing skill tokens in command args", () => {
  const bareSkillToken = handleOpenTuiComposerEvent(createOpenTuiComposerState(), { kind: "character", value: "/boomerang $" });
  const partialSkillToken = handleOpenTuiComposerEvent(createOpenTuiComposerState(), { kind: "character", value: "/boomerang $dom" });

  assert.equal(bareSkillToken.state.overlayMode, "skill");
  assert.equal(partialSkillToken.state.overlayMode, "skill");
});
