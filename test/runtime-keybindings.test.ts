import assert from "node:assert/strict";
import test from "node:test";

import {
  detectKeybindingConflicts,
  normalizeKeybindingKey,
  normalizeKeybindingOverrides,
  resolveKeybindingAction,
} from "../src/runtime/keybindings.js";

test("keybinding registry normalizes keys and resolves actions", () => {
  assert.equal(normalizeKeybindingKey("Ctrl+K"), "ctrl+k");
  assert.equal(normalizeKeybindingKey("Option+V"), "alt+v");
  assert.equal(normalizeKeybindingKey("bad key"), null);
  assert.deepEqual(normalizeKeybindingOverrides({
    "command-palette": "Ctrl+K",
    unknown: "ctrl+u",
    "toggle-trace": "bad key",
  }), {
    "command-palette": "ctrl+k",
  });
  assert.equal(resolveKeybindingAction({
    name: "k",
    ctrl: true,
    sequence: "\u000b",
  }, { "command-palette": "ctrl+k" }), "command-palette");
});

test("keybinding registry detects duplicate resolved shortcuts", () => {
  assert.deepEqual(detectKeybindingConflicts({ "toggle-trace": "ctrl+p" }), [
    "Ctrl+P: command-palette conflicts with toggle-trace",
  ]);
});
