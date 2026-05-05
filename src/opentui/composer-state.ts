import type { PromptCompletionResult } from "../cli/autocomplete.js";

export type ComposerOverlayMode = "none" | "command" | "skill" | "history-search";

export interface ComposerAttachmentState {
  label: string;
  supported: boolean;
}

export interface OpenTuiComposerState {
  text: string;
  cursorIndex: number;
  overlayMode: ComposerOverlayMode;
  selectedIndex: number;
  promptDraft: string | null;
  historyIndex: number;
  historyQuery: string;
  attachment: ComposerAttachmentState | null;
  notice: string;
}

export type ComposerIntent =
  | { kind: "submit"; prompt: string }
  | { kind: "cancel" }
  | { kind: "accept-selection"; value: string }
  | { kind: "clear-attachment" };

export type ComposerKeyEvent =
  | { kind: "character"; value: string }
  | { kind: "paste"; value: string }
  | { kind: "backspace" }
  | { kind: "delete-forward" }
  | { kind: "move-cursor"; direction: -1 | 1 }
  | { kind: "move-cursor-to"; position: "start" | "end" }
  | { kind: "enter"; shift?: boolean }
  | { kind: "tab"; completion?: PromptCompletionResult | null }
  | { kind: "move-selection"; direction: -1 | 1; rowCount: number }
  | { kind: "accept-selection"; values: string[] }
  | { kind: "accept-value"; value: string }
  | { kind: "escape" }
  | { kind: "history"; direction: -1 | 1; force?: boolean; history: string[] }
  | { kind: "open-history-search" }
  | { kind: "clear-attachment" };

export interface ComposerEventResult {
  state: OpenTuiComposerState;
  intent: ComposerIntent | null;
}

export function createOpenTuiComposerState(): OpenTuiComposerState {
  return {
    text: "",
    cursorIndex: 0,
    overlayMode: "none",
    selectedIndex: 0,
    promptDraft: null,
    historyIndex: -1,
    historyQuery: "",
    attachment: null,
    notice: "ready",
  };
}

export function handleOpenTuiComposerEvent(
  state: OpenTuiComposerState,
  event: ComposerKeyEvent,
): ComposerEventResult {
  switch (event.kind) {
    case "character": {
      const cursorIndex = clampCursor(state.cursorIndex, state.text);
      const text = `${state.text.slice(0, cursorIndex)}${event.value}${state.text.slice(cursorIndex)}`;
      return {
        state: {
          ...state,
          text,
          cursorIndex: cursorIndex + event.value.length,
          overlayMode: overlayForText(text, state.overlayMode),
          historyIndex: -1,
          selectedIndex: 0,
          notice: "editing",
        },
        intent: null,
      };
    }
    case "paste": {
      const pasted = event.value.replace(/\r\n?/g, "\n");
      if (!pasted) {
        return { state: { ...state, notice: "clipboard empty" }, intent: null };
      }
      const cursorIndex = clampCursor(state.cursorIndex, state.text);
      const text = `${state.text.slice(0, cursorIndex)}${pasted}${state.text.slice(cursorIndex)}`;
      return {
        state: {
          ...state,
          text,
          cursorIndex: cursorIndex + pasted.length,
          overlayMode: overlayForText(text, state.overlayMode),
          historyIndex: -1,
          selectedIndex: 0,
          notice: "pasted",
        },
        intent: null,
      };
    }
    case "backspace": {
      const cursorIndex = clampCursor(state.cursorIndex, state.text);
      if (cursorIndex === 0) {
        if (state.attachment) {
          return {
            state: { ...state, attachment: null, notice: "attachment cleared" },
            intent: { kind: "clear-attachment" },
          };
        }
        return { state: { ...state, notice: "editing" }, intent: null };
      }
      const text = `${state.text.slice(0, cursorIndex - 1)}${state.text.slice(cursorIndex)}`;
      return {
        state: {
          ...state,
          text,
          cursorIndex: cursorIndex - 1,
          overlayMode: overlayForText(text, state.overlayMode),
          selectedIndex: 0,
          notice: "editing",
        },
        intent: null,
      };
    }
    case "delete-forward": {
      const cursorIndex = clampCursor(state.cursorIndex, state.text);
      if (cursorIndex >= state.text.length) {
        return { state: { ...state, notice: "editing" }, intent: null };
      }
      const text = `${state.text.slice(0, cursorIndex)}${state.text.slice(cursorIndex + 1)}`;
      return {
        state: {
          ...state,
          text,
          cursorIndex,
          overlayMode: overlayForText(text, state.overlayMode),
          selectedIndex: 0,
          notice: "editing",
        },
        intent: null,
      };
    }
    case "move-cursor": {
      return {
        state: {
          ...state,
          cursorIndex: Math.max(0, Math.min(state.text.length, clampCursor(state.cursorIndex, state.text) + event.direction)),
          notice: "cursor moved",
        },
        intent: null,
      };
    }
    case "move-cursor-to": {
      return {
        state: {
          ...state,
          cursorIndex: event.position === "start" ? 0 : state.text.length,
          notice: "cursor moved",
        },
        intent: null,
      };
    }
    case "enter": {
      if (event.shift) {
        const cursorIndex = clampCursor(state.cursorIndex, state.text);
        const text = `${state.text.slice(0, cursorIndex)}\n${state.text.slice(cursorIndex)}`;
        return {
          state: { ...state, text, cursorIndex: cursorIndex + 1, notice: "newline inserted" },
          intent: null,
        };
      }
      const prompt = state.text.trim();
      if (prompt.length === 0) {
        return { state: { ...state, notice: "Nothing to submit" }, intent: null };
      }
      return {
        state: {
          ...state,
          text: "",
          cursorIndex: 0,
          overlayMode: "none",
          historyIndex: -1,
          promptDraft: null,
          selectedIndex: 0,
          notice: "submitted",
        },
        intent: { kind: "submit", prompt },
      };
    }
    case "tab": {
      const first = event.completion?.suggestions[0]?.value ?? event.completion?.value;
      if (!first || first === state.text) {
        return { state: { ...state, notice: "No matches" }, intent: null };
      }
      return {
        state: {
          ...state,
          text: first,
          cursorIndex: first.length,
          overlayMode: overlayForText(first, state.overlayMode),
          selectedIndex: 0,
          notice: "completion accepted",
        },
        intent: null,
      };
    }
    case "move-selection": {
      const rowCount = Math.max(0, event.rowCount);
      if (state.overlayMode === "none" || rowCount === 0) {
        return { state: { ...state, notice: "No matches" }, intent: null };
      }
      const selectedIndex = Math.max(0, Math.min(rowCount - 1, state.selectedIndex + event.direction));
      return {
        state: { ...state, selectedIndex, notice: "selection moved" },
        intent: null,
      };
    }
    case "accept-selection": {
      const value = event.values[state.selectedIndex] ?? event.values[0];
      if (!value) {
        return { state: { ...state, notice: "No matches" }, intent: null };
      }
      return {
        state: {
          ...state,
          text: value,
          cursorIndex: value.length,
          overlayMode: "none",
          selectedIndex: 0,
          historyIndex: -1,
          notice: "selection accepted",
        },
        intent: state.overlayMode === "history-search" ? null : { kind: "accept-selection", value },
      };
    }
    case "accept-value": {
      if (!event.value) {
        return { state: { ...state, notice: "No matches" }, intent: null };
      }
      const overlayMode = state.overlayMode === "history-search" ? "none" : overlayForText(event.value, state.overlayMode);
      return {
        state: {
          ...state,
          text: event.value,
          cursorIndex: event.value.length,
          overlayMode,
          selectedIndex: 0,
          historyIndex: -1,
          notice: "selection accepted",
        },
        intent: state.overlayMode === "history-search" ? null : { kind: "accept-selection", value: event.value },
      };
    }
    case "escape": {
      if (state.overlayMode !== "none") {
        return {
          state: { ...state, overlayMode: "none", selectedIndex: 0, historyQuery: "", notice: "palette closed" },
          intent: null,
        };
      }
      if (state.text.length > 0) {
        return {
          state: { ...state, text: "", cursorIndex: 0, promptDraft: null, historyIndex: -1, notice: "composer cleared" },
          intent: null,
        };
      }
      return { state: { ...state, notice: "cancel requested" }, intent: { kind: "cancel" } };
    }
    case "history":
      return browseHistory(state, event.history, event.direction, event.force === true);
    case "open-history-search":
      return {
        state: { ...state, overlayMode: "history-search", historyQuery: state.text, selectedIndex: 0, notice: "history search" },
        intent: null,
      };
    case "clear-attachment":
      return {
        state: { ...state, attachment: null, notice: "attachment cleared" },
        intent: { kind: "clear-attachment" },
      };
  }
}

export function setComposerAttachment(
  state: OpenTuiComposerState,
  attachment: ComposerAttachmentState | null,
): OpenTuiComposerState {
  return {
    ...state,
    attachment,
    notice: attachment ? "attachment updated" : "attachment cleared",
  };
}

function browseHistory(
  state: OpenTuiComposerState,
  history: string[],
  direction: -1 | 1,
  force: boolean,
): ComposerEventResult {
  if (history.length === 0) {
    return { state: { ...state, notice: "No history matches" }, intent: null };
  }
  if (!force && state.text.length > 0) {
    return { state: { ...state, notice: "history waits for empty composer" }, intent: null };
  }

  const draft = state.promptDraft ?? state.text;
  const newestIndex = history.length - 1;
  let historyIndex = state.historyIndex;
  if (historyIndex === -1) {
    historyIndex = direction === -1 ? newestIndex : 0;
  } else {
    historyIndex = Math.max(0, Math.min(newestIndex, historyIndex + direction));
  }

  return {
    state: {
      ...state,
      text: history[historyIndex] ?? draft,
      cursorIndex: (history[historyIndex] ?? draft).length,
      promptDraft: draft,
      historyIndex,
      overlayMode: "history-search",
      selectedIndex: newestIndex - historyIndex,
      notice: "history browsing",
    },
    intent: null,
  };
}

function clampCursor(cursorIndex: number, text: string): number {
  return Math.max(0, Math.min(text.length, cursorIndex));
}

function overlayForText(text: string, current: ComposerOverlayMode): ComposerOverlayMode {
  const trimmed = text.trimStart();
  if (current === "history-search") {
    return "history-search";
  }
  if (trimmed.startsWith("$") || trimmed.startsWith("/skill") || hasTrailingSkillToken(text)) {
    return "skill";
  }
  if (isArgumentCommandPaletteText(trimmed)) {
    return "command";
  }
  if (/^\/\S*$/.test(trimmed)) {
    return "command";
  }
  if (hasTrailingPathCompletionToken(text)) {
    return "command";
  }
  return "none";
}

function isArgumentCommandPaletteText(trimmed: string): boolean {
  return /^\/model(?:\s+\S*){0,2}$/.test(trimmed) || /^\/effort(?:\s+\S*)?$/.test(trimmed);
}

function hasTrailingPathCompletionToken(text: string): boolean {
  return /(?:^|\s)(~\/[^\s]*|~|\.{1,2}\/[^\s]*|\/[^\s]*|[^\s]*\/[^\s]*)$/.test(text);
}

function hasTrailingSkillToken(text: string): boolean {
  return /(?:^|\s)\$[^\s]*$/.test(text);
}
