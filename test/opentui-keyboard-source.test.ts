import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

import { createBufferedKeyboardSource, parseRawKeyboardInput } from "../src/opentui/keyboard-source.js";

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

  keyInput.emit("data", "a");
  const unsubscribe = source.subscribe((event) => captured.push(event.name));
  keyInput.emit("data", "b");

  assert.deepEqual(captured, ["a", "b"]);
  unsubscribe();
  source.dispose();
});

test("OpenTUI raw keyboard parser splits printable chunks", () => {
  assert.deepEqual(parseRawKeyboardInput("quit").map((event) => event.sequence), ["q", "u", "i", "t"]);
});

test("OpenTUI raw keyboard parser keeps Enter and Tab as special keys", () => {
  assert.deepEqual(parseRawKeyboardInput("\r\n\t").map((event) => [event.name, event.ctrl]), [
    ["return", false],
    ["return", false],
    ["tab", false],
  ]);
});

test("OpenTUI raw keyboard parser handles Alt Enter as meta return", () => {
  assert.deepEqual(parseRawKeyboardInput("\x1b\r").map((event) => [event.name, event.meta, event.option]), [
    ["return", true, true],
  ]);
});

test("OpenTUI raw keyboard parser handles navigation keys", () => {
  assert.deepEqual(parseRawKeyboardInput("\x1b[D\x1b[C\x1b[H\x1b[F\x1b[5~\x1b[6~").map((event) => event.name), [
    "left",
    "right",
    "home",
    "end",
    "pageup",
    "pagedown",
  ]);
});

test("OpenTUI raw keyboard parser handles modified transcript scroll keys", () => {
  const events = parseRawKeyboardInput("\x1b[1;5A\x1b[1;5B");

  assert.deepEqual(events.map((event) => [event.name, event.ctrl]), [
    ["up", true],
    ["down", true],
  ]);
});

test("OpenTUI raw keyboard parser skips terminal protocol responses", () => {
  assert.deepEqual(parseRawKeyboardInput("\x1b[?2026$p").map((event) => event.name), []);
});

test("OpenTUI raw keyboard parser handles control shortcuts", () => {
  assert.deepEqual(parseRawKeyboardInput("\x03\x11\x14\x19").map((event) => [event.name, event.ctrl]), [
    ["c", true],
    ["q", true],
    ["t", true],
    ["y", true],
  ]);
});

test("OpenTUI entry disables Kitty keyboard startup negotiation", async () => {
  const source = await readFile(new URL("../src/opentui/entry.tsx", import.meta.url), "utf8");

  assert.match(source, /useKittyKeyboard: null/);
  assert.match(source, /useMouse: true/);
  assert.match(source, /enableMouseMovement: true/);
  assert.match(source, /createBufferedKeyboardSource/);
});
