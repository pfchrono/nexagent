import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "bun:test";

import { createBufferedKeyboardSource, type OpenTuiKeyEvent } from "../src/opentui/keyboard-source.js";

function key(name: string): OpenTuiKeyEvent {
  return {
    name,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: name,
  };
}

test("OpenTUI keyboard source buffers first key before app subscribes", () => {
  const keyInput = new EventEmitter();
  const source = createBufferedKeyboardSource({
    on(event, handler) {
      keyInput.on(event, handler);
    },
    off(event, handler) {
      keyInput.off(event, handler);
    },
  });
  const captured: string[] = [];

  keyInput.emit("keypress", key("a"));
  const unsubscribe = source.subscribe((event) => captured.push(event.name));
  keyInput.emit("keypress", key("b"));

  assert.deepEqual(captured, ["a", "b"]);
  unsubscribe();
  source.dispose();
});
