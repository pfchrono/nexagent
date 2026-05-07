export type KeybindingAction =
  | "command-palette"
  | "toggle-cockpit"
  | "toggle-config"
  | "toggle-trace"
  | "history-search"
  | "paste-text"
  | "paste-image"
  | "copy-selection"
  | "copy-latest"
  | "quit";

export interface KeybindingDefinition {
  id: KeybindingAction;
  category: "Composer" | "Transcript" | "Panels";
  label: string;
  description: string;
  defaultKey: string;
}

export interface RuntimeKeyEventLike {
  name: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  option?: boolean;
  sequence?: string;
}

export type KeybindingOverrides = Partial<Record<KeybindingAction, string>>;

export const KEYBINDING_REGISTRY: KeybindingDefinition[] = [
  { id: "paste-text", category: "Composer", label: "Ctrl+V", description: "paste clipboard text", defaultKey: "ctrl+v" },
  { id: "paste-image", category: "Composer", label: "Alt+V", description: "attach clipboard image", defaultKey: "alt+v" },
  { id: "history-search", category: "Composer", label: "Ctrl+R", description: "open history search", defaultKey: "ctrl+r" },
  { id: "copy-selection", category: "Transcript", label: "Ctrl+C", description: "copy selected terminal text or selected block", defaultKey: "ctrl+c" },
  { id: "copy-latest", category: "Transcript", label: "Ctrl+Y", description: "copy latest selected block", defaultKey: "ctrl+y" },
  { id: "command-palette", category: "Panels", label: "Ctrl+P", description: "open command palette", defaultKey: "ctrl+p" },
  { id: "toggle-cockpit", category: "Panels", label: "Ctrl+O", description: "toggle cockpit", defaultKey: "ctrl+o" },
  { id: "toggle-config", category: "Panels", label: "Ctrl+G", description: "toggle config", defaultKey: "ctrl+g" },
  { id: "toggle-trace", category: "Panels", label: "Ctrl+T", description: "toggle trace", defaultKey: "ctrl+t" },
  { id: "quit", category: "Panels", label: "Ctrl+Q", description: "exit OpenTUI", defaultKey: "ctrl+q" },
];

const KEYBINDING_IDS = new Set(KEYBINDING_REGISTRY.map((binding) => binding.id));
const KEY_PATTERN = /^(?:(ctrl|control|cmd|meta|alt|option|shift)\+)*(?:[a-z0-9]|enter|return|escape|esc|tab|space|pageup|pagedown|home|end|up|down|left|right|backspace|delete)$/;

export function normalizeKeybindingAction(value: string): KeybindingAction | null {
  return KEYBINDING_IDS.has(value as KeybindingAction) ? value as KeybindingAction : null;
}

export function normalizeKeybindingKey(value: string): string | null {
  const normalized = value.trim().toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^control\+/, "ctrl+")
    .replace(/^cmd\+/, "meta+")
    .replace(/^option\+/, "alt+")
    .replace(/\+esc$/, "+escape");
  if (!normalized || !KEY_PATTERN.test(normalized)) {
    return null;
  }
  const parts = normalized.split("+");
  const key = parts.pop() ?? "";
  const modifiers = Array.from(new Set(parts.map((part) => {
    if (part === "control") {
      return "ctrl";
    }
    if (part === "cmd") {
      return "meta";
    }
    if (part === "option") {
      return "alt";
    }
    return part;
  })));
  const order = ["ctrl", "meta", "alt", "shift"];
  return [...order.filter((modifier) => modifiers.includes(modifier)), key === "esc" ? "escape" : key].join("+");
}

export function normalizeKeybindingOverrides(value: unknown): KeybindingOverrides {
  if (!value || typeof value !== "object") {
    return {};
  }
  const normalized: KeybindingOverrides = {};
  for (const [rawAction, rawKey] of Object.entries(value as Record<string, unknown>)) {
    const action = normalizeKeybindingAction(rawAction);
    if (!action || typeof rawKey !== "string") {
      continue;
    }
    const key = normalizeKeybindingKey(rawKey);
    if (key) {
      normalized[action] = key;
    }
  }
  return normalized;
}

export function resolveKeybindingMap(overrides?: KeybindingOverrides): Record<KeybindingAction, string> {
  const entries = KEYBINDING_REGISTRY.map((binding) => [binding.id, overrides?.[binding.id] ?? binding.defaultKey]);
  return Object.fromEntries(entries) as Record<KeybindingAction, string>;
}

export function resolveKeybindingAction(key: RuntimeKeyEventLike, overrides?: KeybindingOverrides): KeybindingAction | null {
  const normalized = keyEventToBindingKey(key);
  const map = resolveKeybindingMap(overrides);
  for (const binding of KEYBINDING_REGISTRY) {
    if (map[binding.id] === normalized) {
      return binding.id;
    }
  }
  return null;
}

export function keyEventToBindingKey(key: RuntimeKeyEventLike): string {
  const name = normalizeKeyName(key.name, key.sequence ?? "");
  const modifiers = [
    key.ctrl ? "ctrl" : null,
    key.meta ? "meta" : null,
    key.option ? "alt" : null,
    key.shift ? "shift" : null,
  ].filter((part): part is string => Boolean(part));
  return [...modifiers, name].join("+");
}

export function formatKeybindingDisplay(key: string): string {
  return key.split("+").map((part) => {
    if (part === "ctrl") {
      return "Ctrl";
    }
    if (part === "meta") {
      return "Meta";
    }
    if (part === "alt") {
      return "Alt";
    }
    if (part === "shift") {
      return "Shift";
    }
    if (part === "escape") {
      return "Esc";
    }
    return part.length === 1 ? part.toUpperCase() : part[0]?.toUpperCase() + part.slice(1);
  }).join("+");
}

export function detectKeybindingConflicts(overrides?: KeybindingOverrides): string[] {
  const seen = new Map<string, KeybindingAction>();
  const conflicts: string[] = [];
  const map = resolveKeybindingMap(overrides);
  for (const binding of KEYBINDING_REGISTRY) {
    const key = map[binding.id];
    const previous = seen.get(key);
    if (previous) {
      conflicts.push(`${formatKeybindingDisplay(key)}: ${previous} conflicts with ${binding.id}`);
      continue;
    }
    seen.set(key, binding.id);
  }
  return conflicts;
}

export function formatKeybindingRows(overrides?: KeybindingOverrides): string[] {
  const map = resolveKeybindingMap(overrides);
  const rows: string[] = [];
  let currentCategory = "";
  for (const binding of KEYBINDING_REGISTRY) {
    if (binding.category !== currentCategory) {
      if (rows.length > 0) {
        rows.push("");
      }
      rows.push(binding.category);
      currentCategory = binding.category;
    }
    const display = formatKeybindingDisplay(map[binding.id]);
    const overridden = overrides?.[binding.id] ? " (custom)" : "";
    rows.push(`  ${display} - ${binding.description}${overridden} [${binding.id}]`);
  }
  return rows;
}

function normalizeKeyName(name: string, sequence: string): string {
  const normalized = name.toLowerCase();
  if (normalized === "return") {
    return "enter";
  }
  if (normalized === "esc") {
    return "escape";
  }
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
