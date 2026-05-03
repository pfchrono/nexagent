import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

import { createBufferedKeyboardSource, createOpenTuiKeyboardSource, parseRawKeyboardInput } from "../src/opentui/keyboard-source.js";

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

test("OpenTUI raw keyboard parser keeps multiline paste as one event", () => {
  const events = parseRawKeyboardInput("first line\nsecond line\nthird line");

  assert.equal(events.length, 1);
  assert.equal(events[0]?.name, "paste");
  assert.equal(events[0]?.paste, true);
  assert.equal(events[0]?.sequence, "first line\nsecond line\nthird line");
});

test("OpenTUI raw keyboard parser unwraps bracketed paste as one event", () => {
  const events = parseRawKeyboardInput("\x1b[200~first line\r\nsecond line\x1b[201~");

  assert.equal(events.length, 1);
  assert.equal(events[0]?.name, "paste");
  assert.equal(events[0]?.paste, true);
  assert.equal(events[0]?.sequence, "first line\r\nsecond line");
});

test("OpenTUI renderer key source buffers initial slash before app subscribes", () => {
  const keyInput = new EventEmitter();
  const source = createOpenTuiKeyboardSource({
    on(event, handler) {
      keyInput.on(event, handler);
    },
    off(event, handler) {
      keyInput.off(event, handler);
    },
  });
  const captured: string[] = [];

  keyInput.emit("keypress", {
    name: "slash",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: "/",
  });
  const unsubscribe = source.subscribe((event) => captured.push(event.sequence));
  keyInput.emit("keypress", {
    name: "h",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: "h",
  });

  assert.deepEqual(captured, ["/", "h"]);
  unsubscribe();
  source.dispose();
});

test("OpenTUI renderer key source preserves startup named printable keys without sequence", () => {
  const keyInput = new EventEmitter();
  const source = createOpenTuiKeyboardSource({
    on(event, handler) {
      keyInput.on(event, handler);
    },
    off(event, handler) {
      keyInput.off(event, handler);
    },
  });
  const captured: string[] = [];

  keyInput.emit("keypress", {
    name: "slash",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: "",
  });
  keyInput.emit("keypress", {
    name: "dollar",
    ctrl: false,
    meta: false,
    shift: true,
    option: false,
    sequence: "",
  });
  const unsubscribe = source.subscribe((event) => captured.push(event.sequence));

  assert.deepEqual(captured, ["/", "$"]);
  unsubscribe();
  source.dispose();
});

test("OpenTUI renderer key source normalizes Ctrl+G and Ctrl+V variants", () => {
  const keyInput = new EventEmitter();
  const source = createOpenTuiKeyboardSource({
    on(event, handler) {
      keyInput.on(event, handler);
    },
    off(event, handler) {
      keyInput.off(event, handler);
    },
  });
  const captured: Array<[string, boolean]> = [];

  keyInput.emit("keypress", {
    name: "ctrl+g",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: "",
  });
  keyInput.emit("keypress", {
    name: "C-v",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: "",
  });
  const unsubscribe = source.subscribe((event) => captured.push([event.name, event.ctrl]));

  assert.deepEqual(captured, [["g", true], ["v", true]]);
  unsubscribe();
  source.dispose();
});

test("OpenTUI renderer key source can fall back to raw stdin for startup keys", () => {
  const keyInput = new EventEmitter();
  const rawInput = new EventEmitter();
  const source = createOpenTuiKeyboardSource({
    on(event, handler) {
      keyInput.on(event, handler);
    },
    off(event, handler) {
      keyInput.off(event, handler);
    },
  }, {
    on(event, handler) {
      rawInput.on(event, handler);
    },
    off(event, handler) {
      rawInput.off(event, handler);
    },
  });
  const captured: string[] = [];

  rawInput.emit("data", "/a");
  const unsubscribe = source.subscribe((event) => captured.push(event.sequence));

  assert.deepEqual(captured, ["/", "a"]);
  unsubscribe();
  source.dispose();
});

test("OpenTUI renderer key source dedupes raw fallback when both streams report same key", () => {
  const keyInput = new EventEmitter();
  const rawInput = new EventEmitter();
  const source = createOpenTuiKeyboardSource({
    on(event, handler) {
      keyInput.on(event, handler);
    },
    off(event, handler) {
      keyInput.off(event, handler);
    },
  }, {
    on(event, handler) {
      rawInput.on(event, handler);
    },
    off(event, handler) {
      rawInput.off(event, handler);
    },
  });
  const captured: string[] = [];

  keyInput.emit("keypress", {
    name: "slash",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: "/",
  });
  rawInput.emit("data", "/");
  const unsubscribe = source.subscribe((event) => captured.push(event.sequence));

  assert.deepEqual(captured, ["/"]);
  unsubscribe();
  source.dispose();
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

test("OpenTUI raw keyboard parser handles shifted Enter CSI variants", () => {
  assert.deepEqual(parseRawKeyboardInput("\x1b[13;2u\x1b[13;2~").map((event) => [event.name, event.shift]), [
    ["return", true],
    ["return", true],
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
  assert.deepEqual(parseRawKeyboardInput("\x03\x07\x11\x14\x16\x19").map((event) => [event.name, event.ctrl]), [
    ["c", true],
    ["g", true],
    ["q", true],
    ["t", true],
    ["v", true],
    ["y", true],
  ]);
});

test("OpenTUI raw keyboard parser handles Kitty printable control shortcuts", () => {
  assert.deepEqual(parseRawKeyboardInput("\x1b[103;5u").map((event) => [event.name, event.ctrl]), [
    ["g", true],
  ]);
});

test("OpenTUI entry disables Kitty keyboard startup negotiation", async () => {
  const source = await readFile(new URL("../src/opentui/entry.tsx", import.meta.url), "utf8");

  assert.match(source, /useKittyKeyboard: null/);
  assert.match(source, /useMouse: true/);
  assert.match(source, /enableMouseMovement: true/);
  assert.match(source, /createOpenTuiKeyboardSource/);
  assert.match(source, /renderer\.keyInput, renderer\.stdin/);
  assert.doesNotMatch(source, /createBufferedKeyboardSource\(process\.stdin\)/);
});
