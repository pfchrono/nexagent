import type { PromptCompletionResult } from "../cli/autocomplete.js";

export type ComposerOverlayMode = "none" | "command" | "skill" | "history-search";

export interface ComposerAttachmentState {
  label: string;
  supported: boolean;
}

export interface OpenTuiComposerState {
  text: string;
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
  | { kind: "backspace" }
  | { kind: "enter"; shift?: boolean }
  | { kind: "tab"; completion?: PromptCompletionResult | null }
  | { kind: "move-selection"; direction: -1 | 1; rowCount: number }
  | { kind: "accept-selection"; values: string[] }
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
      const text = `${state.text}${event.value}`;
      return {
        state: {
          ...state,
          text,
          overlayMode: overlayForText(text, state.overlayMode),
          historyIndex: -1,
          selectedIndex: 0,
          notice: "editing",
        },
        intent: null,
      };
    }
    case "backspace": {
      const text = state.text.slice(0, -1);
      return {
        state: {
          ...state,
          text,
          overlayMode: overlayForText(text, state.overlayMode),
          selectedIndex: 0,
          notice: "editing",
        },
        intent: null,
      };
    }
    case "enter": {
      if (event.shift) {
        return {
          state: { ...state, text: `${state.text}\n`, notice: "newline inserted" },
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
          overlayMode: "none",
          selectedIndex: 0,
          historyIndex: -1,
          notice: "selection accepted",
        },
        intent: state.overlayMode === "history-search" ? null : { kind: "accept-selection", value },
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
          state: { ...state, text: "", promptDraft: null, historyIndex: -1, notice: "composer cleared" },
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
      promptDraft: draft,
      historyIndex,
      overlayMode: "history-search",
      selectedIndex: newestIndex - historyIndex,
      notice: "history browsing",
    },
    intent: null,
  };
}

function overlayForText(text: string, current: ComposerOverlayMode): ComposerOverlayMode {
  const trimmed = text.trimStart();
  if (current === "history-search") {
    return "history-search";
  }
  if (trimmed.startsWith("$") || trimmed.startsWith("/skill")) {
    return "skill";
  }
  if (trimmed.startsWith("/")) {
    return "command";
  }
  return "none";
}
