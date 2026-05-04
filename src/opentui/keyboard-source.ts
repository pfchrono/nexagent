export interface OpenTuiKeyEvent {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  option: boolean;
  sequence: string;
  paste?: boolean;
}

export interface OpenTuiKeyboardSource {
  subscribe(handler: (key: OpenTuiKeyEvent) => void): () => void;
  dispose(): void;
}

interface KeyInputEmitter {
  on(event: "data", handler: (chunk: Buffer | string) => void): void;
  off(event: "data", handler: (chunk: Buffer | string) => void): void;
}

interface OpenTuiKeyInputEmitter {
  on(event: "keypress", handler: (key: OpenTuiKeyEvent) => void): void;
  off(event: "keypress", handler: (key: OpenTuiKeyEvent) => void): void;
}

export function createBufferedKeyboardSource(keyInput: KeyInputEmitter): OpenTuiKeyboardSource {
  return createBufferedSource<KeyInputEmitter, Buffer | string>(
    keyInput,
    "data",
    (chunk) => parseRawKeyboardInput(chunk),
  );
}

export function createOpenTuiKeyboardSource(
  keyInput: OpenTuiKeyInputEmitter,
  fallbackInput?: KeyInputEmitter,
): OpenTuiKeyboardSource {
  const rendererSource = createBufferedSource<OpenTuiKeyInputEmitter, OpenTuiKeyEvent>(
    keyInput,
    "keypress",
    (key) => [normalizeOpenTuiKeyEvent(key)],
  );
  if (!fallbackInput) {
    return rendererSource;
  }
  return createMergedKeyboardSource(rendererSource, createBufferedKeyboardSource(fallbackInput));
}

function createBufferedSource<TEmitter extends {
  on(event: TEvent, handler: (payload: TPayload) => void): void;
  off(event: TEvent, handler: (payload: TPayload) => void): void;
}, TPayload, TEvent extends string = string>(
  keyInput: TEmitter,
  eventName: TEvent,
  parse: (payload: TPayload) => OpenTuiKeyEvent[],
): OpenTuiKeyboardSource {
  const subscribers = new Set<(key: OpenTuiKeyEvent) => void>();
  const pending: OpenTuiKeyEvent[] = [];
  const emit = (key: OpenTuiKeyEvent): void => {
    if (subscribers.size === 0) {
      pending.push(key);
      return;
    }
    for (const subscriber of subscribers) {
      subscriber(key);
    }
  };
  const listener = (payload: TPayload): void => {
    for (const key of parse(payload)) {
      emit(key);
    }
  };

  keyInput.on(eventName, listener);

  return {
    subscribe(handler) {
      subscribers.add(handler);
      while (pending.length > 0) {
        const key = pending.shift();
        if (key) {
          handler(key);
        }
      }
      return () => {
        subscribers.delete(handler);
      };
    },
    dispose() {
      subscribers.clear();
      pending.length = 0;
      keyInput.off(eventName, listener);
    },
  };
}

function createMergedKeyboardSource(primary: OpenTuiKeyboardSource, fallback: OpenTuiKeyboardSource): OpenTuiKeyboardSource {
  return {
    subscribe(handler) {
      let primarySeen = false;
      const emitPrimary = (key: OpenTuiKeyEvent): void => {
        if (isUsableKeyEvent(key)) {
          primarySeen = true;
        }
        handler(key);
      };
      const emitFallback = (key: OpenTuiKeyEvent): void => {
        if (!primarySeen) {
          handler(key);
        }
      };
      const unsubscribers = [
        primary.subscribe(emitPrimary),
        fallback.subscribe(emitFallback),
      ];
      return () => {
        for (const unsubscribe of unsubscribers) {
          unsubscribe();
        }
      };
    },
    dispose() {
      primary.dispose();
      fallback.dispose();
    },
  };
}

function normalizeOpenTuiKeyEvent(key: OpenTuiKeyEvent): OpenTuiKeyEvent {
  const normalizedName = normalizeKeyName(key.name, key.sequence);
  const fallbackSequence = !key.ctrl && !key.meta && !key.option ? printableSequenceForNamedKey(normalizedName, key.shift) : "";
  return {
    name: normalizedName,
    ctrl: key.ctrl || isControlShortcutKey(key.name, key.sequence),
    meta: key.meta,
    shift: key.shift,
    option: key.option,
    sequence: key.sequence && key.sequence.length > 0 ? key.sequence : fallbackSequence,
  };
}

function normalizeKeyName(name: string, sequence: string): string {
  const normalized = name.toLowerCase();
  if (normalized === "ctrl+g" || normalized === "c-g" || normalized === "^g" || sequence === "\x07") {
    return "g";
  }
  if (normalized === "ctrl+v" || normalized === "c-v" || normalized === "^v" || sequence === "\x16") {
    return "v";
  }
  if (normalized === "ctrl+c" || normalized === "c-c" || normalized === "^c" || sequence === "\x03") {
    return "c";
  }
  return normalized;
}

function isControlShortcutKey(name: string, sequence: string): boolean {
  const normalized = name.toLowerCase();
  if (sequence.length === 1) {
    const code = sequence.charCodeAt(0);
    if (code >= 1 && code <= 26) {
      return true;
    }
  }
  return normalized === "ctrl+g" || normalized === "c-g" || normalized === "^g"
    || normalized === "ctrl+v" || normalized === "c-v" || normalized === "^v"
    || normalized === "ctrl+c" || normalized === "c-c" || normalized === "^c";
}

function printableSequenceForNamedKey(name: string, shifted: boolean): string {
  if (name.length === 1) {
    return shifted ? name.toUpperCase() : name;
  }
  const printableNames: Record<string, string> = {
    space: " ",
    slash: "/",
    backslash: "\\",
    dollar: "$",
    exclamation: "!",
    bang: "!",
    at: "@",
    hash: "#",
    pound: "#",
    percent: "%",
    caret: "^",
    ampersand: "&",
    asterisk: "*",
    star: "*",
    minus: "-",
    hyphen: "-",
    underscore: "_",
    equal: "=",
    plus: "+",
    comma: ",",
    period: ".",
    dot: ".",
    semicolon: ";",
    colon: ":",
    quote: "'",
    apostrophe: "'",
    doublequote: "\"",
    backtick: "`",
    tilde: "~",
    leftbracket: "[",
    rightbracket: "]",
    leftbrace: "{",
    rightbrace: "}",
    leftparen: "(",
    rightparen: ")",
    question: "?",
    questionmark: "?",
    less: "<",
    greater: ">",
    pipe: "|",
  };
  return printableNames[name.toLowerCase()] ?? "";
}

export function parseRawKeyboardInput(chunk: Buffer | string): OpenTuiKeyEvent[] {
  const input = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk;
  const bracketedPaste = parseBracketedPaste(input);
  if (bracketedPaste) {
    return [pasteKey(bracketedPaste)];
  }
  if (looksLikeRawMultilinePaste(input)) {
    return [pasteKey(input)];
  }
  const events: OpenTuiKeyEvent[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? "";
    if (char === "\x1b") {
      const parsed = parseEscapeSequence(input, index);
      index = parsed.nextIndex;
      if (parsed.event) {
        events.push(parsed.event);
      }
      continue;
    }
    const event = keyEventForCharacter(char);
    if (event) {
      events.push(event);
    }
  }
  return events;
}

function parseBracketedPaste(input: string): string | null {
  const start = "\x1b[200~";
  const end = "\x1b[201~";
  if (!input.startsWith(start)) {
    return null;
  }
  const endIndex = input.indexOf(end, start.length);
  if (endIndex < 0) {
    return null;
  }
  return input.slice(start.length, endIndex);
}

function looksLikeRawMultilinePaste(input: string): boolean {
  if (input.startsWith("\x1b")) {
    return false;
  }
  if (input.length <= 1 || (!input.includes("\n") && !input.includes("\r"))) {
    return false;
  }
  return /[ -~]/.test(input);
}

function parseEscapeSequence(input: string, startIndex: number): { event: OpenTuiKeyEvent | null; nextIndex: number } {
  const next = input[startIndex + 1];
  if (!next) {
    return { event: specialKey("escape", "\x1b"), nextIndex: startIndex };
  }
  if (next === "[") {
    let endIndex = startIndex + 2;
    while (endIndex < input.length && !/[A-Za-z~]/.test(input[endIndex] ?? "")) {
      endIndex += 1;
    }
    const sequence = input.slice(startIndex, Math.min(endIndex + 1, input.length));
    const final = input[endIndex];
    const mapped = mapCsiSequence(sequence, final);
    return { event: mapped, nextIndex: Math.min(endIndex, input.length - 1) };
  }
  if (next === "]") {
    const belIndex = input.indexOf("\x07", startIndex + 2);
    const stIndex = input.indexOf("\x1b\\", startIndex + 2);
    const endCandidates = [belIndex, stIndex >= 0 ? stIndex + 1 : -1].filter((value) => value >= 0);
    return { event: null, nextIndex: endCandidates.length > 0 ? Math.min(...endCandidates) : input.length - 1 };
  }
  if (next === "\r" || next === "\n") {
    return { event: specialKey("return", input.slice(startIndex, startIndex + 2), { meta: true, option: true }), nextIndex: startIndex + 1 };
  }
  if (next.length === 1 && /[ -~]/.test(next)) {
    const event = keyEventForCharacter(next, true);
    return { event, nextIndex: startIndex + 1 };
  }
  return { event: null, nextIndex: startIndex + 1 };
}

function mapCsiSequence(sequence: string, final: string | undefined): OpenTuiKeyEvent | null {
  const modifier = parseCsiModifier(sequence);
  const withModifier = (name: string): OpenTuiKeyEvent => specialKey(name, sequence, modifier);
  switch (final) {
    case "A":
      return withModifier("up");
    case "B":
      return withModifier("down");
    case "C":
      return withModifier("right");
    case "D":
      return withModifier("left");
    case "H":
      return withModifier("home");
    case "F":
      return withModifier("end");
    case "~": {
      if (sequence === "\x1b[13;2~") {
        return specialKey("return", sequence, { shift: true });
      }
      if (sequence === "\x1b[1~" || sequence === "\x1b[7~") {
        return withModifier("home");
      }
      if (sequence === "\x1b[4~" || sequence === "\x1b[8~") {
        return withModifier("end");
      }
      if (sequence === "\x1b[3~") {
        return withModifier("delete");
      }
      if (sequence === "\x1b[5~") {
        return withModifier("pageup");
      }
      if (sequence === "\x1b[6~") {
        return withModifier("pagedown");
      }
      return null;
    }
    case "u":
      return mapKittyStyleKeyCode(sequence);
    default:
      return null;
  }
}

function mapKittyStyleKeyCode(sequence: string): OpenTuiKeyEvent | null {
  const match = sequence.match(/^\x1b\[(\d+)(?:;(\d+))?u$/);
  if (!match) {
    return null;
  }
  const code = Number(match[1]);
  const modifier = parseCsiModifier(sequence);
  if (code === 13) {
    return specialKey("return", sequence, modifier);
  }
  if (code === 9) {
    return specialKey("tab", sequence, modifier);
  }
  if (code >= 32 && code <= 126) {
    const char = String.fromCharCode(code);
    return {
      name: char.toLowerCase(),
      ctrl: modifier.ctrl === true,
      meta: modifier.meta === true,
      shift: modifier.shift === true || (char.toUpperCase() === char && char.toLowerCase() !== char),
      option: modifier.option === true,
      sequence,
    };
  }
  return null;
}

function parseCsiModifier(sequence: string): Partial<OpenTuiKeyEvent> {
  const match = sequence.match(/;(\d+)[A-Za-z~]$/);
  const code = match ? Number(match[1]) : 1;
  return {
    shift: code === 2 || code === 4 || code === 6 || code === 8,
    meta: code === 3 || code === 4 || code === 7 || code === 8,
    option: code === 3 || code === 4 || code === 7 || code === 8,
    ctrl: code === 5 || code === 6 || code === 7 || code === 8,
  };
}

function keyEventForCharacter(char: string, meta = false): OpenTuiKeyEvent | null {
  if (char === "\r" || char === "\n") {
    return specialKey("return", char);
  }
  if (char === "\t") {
    return specialKey("tab", char);
  }
  if (char === "\x7f" || char === "\b") {
    return specialKey("backspace", char);
  }
  const controlCode = char.charCodeAt(0);
  if (controlCode >= 1 && controlCode <= 26) {
    return {
      name: String.fromCharCode(controlCode + 96),
      ctrl: true,
      meta: false,
      shift: false,
      option: false,
      sequence: char,
    };
  }
  if (!/^[ -~]$/.test(char)) {
    return null;
  }
  return {
    name: char.toLowerCase(),
    ctrl: false,
    meta,
    shift: char.toUpperCase() === char && char.toLowerCase() !== char,
    option: meta,
    sequence: char,
  };
}

function specialKey(name: string, sequence: string, overrides: Partial<OpenTuiKeyEvent> = {}): OpenTuiKeyEvent {
  return {
    name,
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence,
    ...overrides,
  };
}

function pasteKey(value: string): OpenTuiKeyEvent {
  return {
    name: "paste",
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: value,
    paste: true,
  };
}

function isUsableKeyEvent(key: OpenTuiKeyEvent): boolean {
  return key.sequence.length > 0 || key.name.length > 0 || key.ctrl || key.meta || key.option;
}
