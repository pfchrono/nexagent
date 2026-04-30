import { flushSync, useTerminalDimensions } from "@opentui/react";
import { useEffect, useRef, useState } from "react";

import { runRuntimeCommand } from "../cli.js";
import type { RuntimeSession } from "../runtime/session.js";
import {
  createOpenTuiComposerState,
  handleOpenTuiComposerEvent,
  setComposerAttachment,
  type ComposerKeyEvent,
  type OpenTuiComposerState,
} from "./composer-state.js";
import { createCommandSurface, createRuntimeCommandIntent, resolveSkillPreview, type CommandPaletteRow } from "./command-surface.js";
import type { OpenTuiKeyEvent, OpenTuiKeyboardSource } from "./keyboard-source.js";
import {
  createLocalOutputBlock,
  type OpenTuiRuntimeView,
  type OpenTuiTranscriptBlock,
} from "./runtime-view.js";
import {
  createOpenTuiTranscriptState,
  handleOpenTuiTranscriptEvent,
  isBlockExpanded,
  visibleLineWindow,
  type OpenTuiTranscriptState,
  type TranscriptMetrics,
} from "./transcript-state.js";

const SKILL_PREVIEW_PREFIX = "skill:";
const COMPOSER_CURSOR = "|";
const ALT_V_UNSUPPORTED_MESSAGE = "Alt+V paste-image unavailable in OpenTUI; use /attach <image-path>";
const COPIED_RESULTS_NOTICE = "copied results to clipboard";
const PALETTE_VISIBLE_ROWS = 5;

export interface OpenTuiAppProps {
  view: OpenTuiRuntimeView;
  session?: RuntimeSession;
  keyboardSource?: OpenTuiKeyboardSource;
  promptHistory?: string[];
  onPromptHistoryChange?: (history: string[]) => void;
  onExit: () => void;
}

export function OpenTuiApp({ view, session, keyboardSource, promptHistory = [], onPromptHistoryChange, onExit }: OpenTuiAppProps) {
  const { width, height } = useTerminalDimensions();
  const terminalWidth = width > 0 ? width : process.stdout.columns || 80;
  const terminalHeight = height > 0 ? height : process.stdout.rows || 24;
  const contentWidth = Math.max(20, terminalWidth - 2);
  const paletteWidth = Math.min(Math.max(32, Math.floor(contentWidth * 0.7)), Math.max(32, contentWidth - 4));
  const paletteMarginLeft = Math.max(0, Math.floor((contentWidth - paletteWidth) / 2));
  const [composer, setComposer] = useState<OpenTuiComposerState>(() => createOpenTuiComposerState());
  const [history, setHistory] = useState(promptHistory);
  const [traceExpanded, setTraceExpanded] = useState(false);
  const [shellNotice, setShellNotice] = useState("ready");
  const [outputBlocks, setOutputBlocks] = useState<OpenTuiTranscriptBlock[]>([]);
  const [transcriptState, setTranscriptState] = useState<OpenTuiTranscriptState>(() => createOpenTuiTranscriptState());

  const commandSurface = createCommandSurface(view.cwd, composer.text, composer.selectedIndex);
  const skillPreview = resolveSkillPreview(view.cwd, composer.text, composer.selectedIndex);
  const paletteRows = rowsForOverlay(composer, commandSurface.rows, history);
  const visiblePaletteRows = visiblePaletteWindow(paletteRows, composer.selectedIndex, PALETTE_VISIBLE_ROWS);
  const previewLine = skillPreview.status === "none" ? commandSurface.hint : skillPreview.label.replace(/^skill:/, SKILL_PREVIEW_PREFIX);
  const attachmentLine = composer.attachment
    ? composer.attachment.supported
      ? `attached: ${composer.attachment.label} | clear attachment`
      : "Image attach unavailable for current transport"
    : null;

  const keyHandlerRef = useRef<(key: OpenTuiKeyEvent) => void>(() => undefined);
  keyHandlerRef.current = handleKeyboardKey;

  useEffect(() => {
    return keyboardSource?.subscribe((key) => {
      flushSync(() => keyHandlerRef.current(key));
    });
  }, [keyboardSource]);

  function handleKeyboardKey(key: OpenTuiKeyEvent): void {
    if (key.ctrl && key.name === "c") {
      copySelectedTranscriptBlock();
      return;
    }
    if (key.ctrl && key.name === "q") {
      onExit();
      return;
    }
    if (key.ctrl && key.name === "t") {
      setTraceExpanded((current) => !current);
      return;
    }
    if (key.ctrl && key.name === "r") {
      applyComposerEvent({ kind: "open-history-search" });
      return;
    }
    if (key.ctrl && key.name === "y") {
      copySelectedTranscriptBlock();
      return;
    }
    if ((key.name === "v" || key.sequence.toLowerCase() === "v") && (key.meta || key.option)) {
      appendOutput(ALT_V_UNSUPPORTED_MESSAGE);
      setShellNotice("paste-image shortcut unavailable");
      return;
    }
    if (key.name === "pageup") {
      updateTranscriptState({ kind: "scroll-page", direction: -1, metrics: transcriptMetrics });
      return;
    }
    if (key.name === "pagedown") {
      updateTranscriptState({ kind: "scroll-page", direction: 1, metrics: transcriptMetrics });
      return;
    }
    if (key.name === "up") {
      if (composer.overlayMode !== "none") {
        applyComposerEvent({ kind: "move-selection", direction: -1, rowCount: paletteRows.length });
        return;
      }
      if (key.ctrl) {
        updateTranscriptState({ kind: "scroll-lines", delta: -1, metrics: transcriptMetrics });
        return;
      }
      applyComposerEvent({ kind: "history", direction: -1, force: key.ctrl, history });
      return;
    }
    if (key.name === "down") {
      if (composer.overlayMode !== "none") {
        applyComposerEvent({ kind: "move-selection", direction: 1, rowCount: paletteRows.length });
        return;
      }
      if (key.ctrl) {
        updateTranscriptState({ kind: "scroll-lines", delta: 1, metrics: transcriptMetrics });
        return;
      }
      applyComposerEvent({ kind: "history", direction: 1, force: key.ctrl, history });
      return;
    }
    if (key.name === "left") {
      applyComposerEvent({ kind: "move-cursor", direction: -1 });
      return;
    }
    if (key.name === "right") {
      applyComposerEvent({ kind: "move-cursor", direction: 1 });
      return;
    }
    if (key.name === "home") {
      applyComposerEvent({ kind: "move-cursor-to", position: "start" });
      return;
    }
    if (key.name === "end") {
      if (key.ctrl) {
        updateTranscriptState({ kind: "jump-latest", metrics: transcriptMetrics });
        return;
      }
      applyComposerEvent({ kind: "move-cursor-to", position: "end" });
      return;
    }
    if (key.name === "escape") {
      applyComposerEvent({ kind: "escape" });
      return;
    }
    if (key.name === "tab") {
      if (composer.overlayMode !== "none") {
        applyComposerEvent({ kind: "accept-selection", values: paletteRows.map((row) => row.value) });
        return;
      }
      applyComposerEvent({ kind: "tab", completion: commandSurface.completion });
      return;
    }
    if (key.name === "enter" || key.name === "return") {
      if (!key.shift && composer.overlayMode !== "none") {
        const selectedValue = paletteRows[composer.selectedIndex]?.value ?? paletteRows[0]?.value ?? "";
        if (selectedValue.trim() === composer.text.trim()) {
          applyComposerEvent({ kind: "enter", shift: false });
          return;
        }
        applyComposerEvent({ kind: "accept-selection", values: paletteRows.map((row) => row.value) });
        return;
      }
      applyComposerEvent({ kind: "enter", shift: key.shift });
      return;
    }
    if (key.name === "backspace") {
      applyComposerEvent({ kind: "backspace" });
      return;
    }
    if (key.name === "delete") {
      applyComposerEvent({ kind: "delete-forward" });
      return;
    }
    const printableValue = !key.ctrl && !key.meta && !key.option
      ? key.sequence.length === 1
        ? key.sequence
        : key.name.length === 1
          ? key.name
          : null
      : null;
    if (printableValue) {
      applyComposerEvent({ kind: "character", value: printableValue });
    }
  }

  const transcriptViewportHeight = Math.max(4, terminalHeight - 14);
  const transcriptBlocks = [...view.transcriptBlocks, ...outputBlocks, ...(traceExpanded ? view.traceBlocks : [])];
  const transcriptRenderRows = flattenTranscriptBlocks(transcriptBlocks, transcriptState);
  const transcriptMetrics: TranscriptMetrics = {
    contentLineCount: transcriptRenderRows.length,
    viewportLineCount: transcriptViewportHeight,
    blockCount: transcriptBlocks.length,
  };
  const visibleTranscriptRows = visibleLineWindow(transcriptRenderRows, transcriptState, transcriptViewportHeight);
  const traceLabel = traceExpanded ? view.traceExpandedLabel : view.traceCollapsedLabel;
  const composerLine = composer.text.length > 0 ? renderComposerLine(composer) : `> ${view.composerHint} ${COMPOSER_CURSOR}`;

  useEffect(() => {
    setTranscriptState((current) => handleOpenTuiTranscriptEvent(current, {
      kind: "content-updated",
      metrics: transcriptMetrics,
    }));
  }, [transcriptRenderRows.length, transcriptViewportHeight, transcriptBlocks.length]);

  return (
    <box flexDirection="column" width={terminalWidth} height={terminalHeight} padding={1}>
      <text width={contentWidth} fg="#8bd5ff">{view.headerTitle}</text>
      <text width={contentWidth} fg="#a6adc8">{`${view.providerLabel} | ${view.sessionLabel} | cwd ${view.cwdLabel}`}</text>
      <box flexDirection="column" width={contentWidth} marginTop={1}>
        <text width={contentWidth} fg="#f9e2af">status</text>
        <text width={contentWidth}>{view.statusLabel}</text>
        <text width={contentWidth} fg="#a6adc8">{view.footerLabel}</text>
      </box>
      <box
        flexDirection="column"
        width={contentWidth}
        flexGrow={1}
        marginTop={1}
        onMouseScroll={(event) => {
          const direction = event.button === 4 ? -3 : 3;
          updateTranscriptState({ kind: "scroll-lines", delta: direction, metrics: transcriptMetrics });
          event.preventDefault();
        }}
      >
        <text width={contentWidth} fg="#f9e2af">transcript</text>
        {visibleTranscriptRows.map((row) => (
          <text
            key={row.key}
            width={contentWidth}
            selectable
            selectionBg="#8bd5ff"
            selectionFg="#000000"
            fg={row.fg}
            onMouseDown={(event) => {
              updateTranscriptState({ kind: "set-selected-block", index: row.blockIndex, metrics: transcriptMetrics });
              if (row.canToggle) {
                updateTranscriptState({ kind: "toggle-block", blockId: row.blockId });
              }
              event.preventDefault();
            }}
          >
            {row.text}
          </text>
        ))}
        <text width={contentWidth} fg="#f9e2af">{traceLabel}</text>
        <text width={contentWidth} fg="#a6adc8">
          {`${transcriptState.atLatest ? "latest" : "scrolled"} | ${String(transcriptState.scrollOffset + 1)}/${String(Math.max(1, transcriptRenderRows.length))} | PageUp/PageDown Ctrl+Up/Ctrl+Down wheel | Ctrl+C/Ctrl+Y copy`}
        </text>
      </box>
      {composer.overlayMode !== "none" ? (
        <box flexDirection="column" width={paletteWidth} marginLeft={paletteMarginLeft} marginTop={1} padding={1}>
          <text width={paletteWidth} fg="#f9e2af">{commandSurface.title}</text>
          <text width={paletteWidth} fg="#a6adc8">{composer.overlayMode === "history-search" ? "history search" : commandSurface.query}</text>
          {paletteRows.length > 0 ? visiblePaletteRows.map((row) => (
            <text key={`palette-${row.value}`} width={paletteWidth} fg={row.selected ? "#8bd5ff" : "#a6adc8"}>
              {`${row.selected ? "> " : "  "}${row.label} ${row.hint}`}
            </text>
          )) : (
            <text width={paletteWidth} fg="#a6adc8">{composer.overlayMode === "history-search" ? "No history matches" : "No matches"}</text>
          )}
          {paletteRows.length > PALETTE_VISIBLE_ROWS ? (
            <text width={paletteWidth} fg="#a6adc8">{`${String(composer.selectedIndex + 1)}/${String(paletteRows.length)} - use arrows`}</text>
          ) : null}
        </box>
      ) : null}
      <box flexDirection="column" width={contentWidth} marginTop={1}>
        <text width={contentWidth} fg="#f9e2af">composer</text>
        {attachmentLine ? <text width={contentWidth} fg={composer.attachment?.supported ? "#f9e2af" : "#f38ba8"}>{attachmentLine}</text> : null}
        <text width={contentWidth}>{composerLine}</text>
        {previewLine ? <text width={contentWidth} fg="#a6adc8">{previewLine}</text> : null}
      </box>
      <text width={contentWidth} fg="#a6adc8">{`${String(terminalWidth)}x${String(terminalHeight)} | ${traceLabel} | ${shellNotice}`}</text>
    </box>
  );

  function applyComposerEvent(event: ComposerKeyEvent): void {
    const result = handleOpenTuiComposerEvent(composer, event);
    setComposer(result.state);
    setShellNotice(result.state.notice);
    if (!result.intent) {
      return;
    }
    if (result.intent.kind === "cancel") {
      setShellNotice("cancel requested");
      return;
    }
    if (result.intent.kind === "clear-attachment") {
      setShellNotice("attachment cleared");
      return;
    }
    if (result.intent.kind === "accept-selection") {
      setShellNotice("selection accepted");
      return;
    }
    submitPrompt(result.intent.prompt);
  }

  function submitPrompt(prompt: string): void {
    if (skillPreview.status === "ambiguous") {
      setShellNotice("Select skill");
      setComposer((current) => ({ ...current, text: prompt, cursorIndex: prompt.length, overlayMode: "skill" }));
      return;
    }
    if (prompt === "/detach" || prompt === "/attach clear") {
      setComposer((current) => setComposerAttachment(current, null));
      appendOutput("attachment cleared");
      setShellNotice("attachment cleared");
      return;
    }
    if (prompt.startsWith("/attach")) {
      const label = prompt.replace(/^\/attach\s*/i, "").trim();
      setComposer((current) => setComposerAttachment(current, {
        label: label.length > 0 ? label : "clipboard",
        supported: view.imageAttachmentSupported,
      }));
      const message = view.imageAttachmentSupported ? "image attached" : "Image attach unavailable for current transport";
      appendOutput(message);
      setShellNotice(message);
      return;
    }

    const nextHistory = history[history.length - 1] === prompt ? history : [...history, prompt].slice(-100);
    setHistory(nextHistory);
    onPromptHistoryChange?.(nextHistory);

    const intent = createRuntimeCommandIntent(prompt, skillPreview);
    if (intent.kind === "runtime-command" && session) {
      const result = runRuntimeCommand(session, intent.input);
      if (result?.ok && result.output) {
        appendOutput(result.output);
      }
      if (result && !result.ok) {
        appendOutput(result.message);
      }
      setShellNotice(result ? result.activity : "command routed");
      if (result?.ok && intent.input.trim() === "/quit") {
        onExit();
      }
      return;
    }
    appendOutput(`prompt queued: ${intent.input}`);
    setShellNotice(`prompt queued: ${intent.input}`);
  }

  function appendOutput(output: string): void {
    const lines = output
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);
    if (lines.length === 0) {
      return;
    }
    const block = createLocalOutputBlock(`local-output-${Date.now().toString(36)}-${String(lines.length)}`, lines);
    setOutputBlocks((current) => [...current, block].slice(-20));
  }

  function updateTranscriptState(event: Parameters<typeof handleOpenTuiTranscriptEvent>[1]): void {
    setTranscriptState((current) => handleOpenTuiTranscriptEvent(current, event));
  }

  function copySelectedTranscriptBlock(): void {
    const selectedBlock = transcriptBlocks[transcriptState.selectedBlockIndex] ?? transcriptBlocks[transcriptBlocks.length - 1];
    const text = selectedBlock ? blockTextForCopy(selectedBlock, transcriptState) : "";
    if (!text.trim()) {
      setShellNotice("nothing selected to copy");
      return;
    }
    const copied = copyTextToClipboardOsc52(text);
    setShellNotice(copied ? COPIED_RESULTS_NOTICE : "copy unavailable");
  }
}

interface TranscriptRenderRow {
  key: string;
  text: string;
  fg?: string;
  blockId: string;
  blockIndex: number;
  isLabel: boolean;
  canToggle: boolean;
}

function flattenTranscriptBlocks(blocks: OpenTuiTranscriptBlock[], state: OpenTuiTranscriptState): TranscriptRenderRow[] {
  return blocks.flatMap((block, blockIndex) => {
    const selected = blockIndex === state.selectedBlockIndex;
    const expanded = isBlockExpanded(state, block.id, block.collapsedByDefault);
    const detailAvailable = block.detailLines.length > block.summaryLines.length || block.collapsedByDefault;
    const label = `${selected ? "> " : "  "}${block.label}${detailAvailable ? (expanded ? " [-]" : " [+]") : ""}`;
    const lines = expanded ? block.detailLines : block.summaryLines;
    return [
      {
        key: `${block.id}-label`,
        text: label,
        fg: selected ? "#8bd5ff" : "#f9e2af",
        blockId: block.id,
        blockIndex,
        isLabel: true,
        canToggle: detailAvailable,
      },
      ...lines.map((line, lineIndex) => ({
        key: `${block.id}-${String(lineIndex)}`,
        text: `    ${line}`,
        fg: block.kind === "trace" || block.kind === "tool" ? "#a6adc8" : undefined,
        blockId: block.id,
        blockIndex,
        isLabel: false,
        canToggle: detailAvailable,
      })),
    ];
  });
}

function blockTextForCopy(block: OpenTuiTranscriptBlock, state: OpenTuiTranscriptState): string {
  const expanded = isBlockExpanded(state, block.id, block.collapsedByDefault);
  const lines = expanded ? block.detailLines : block.summaryLines;
  return [`${block.label}:`, ...lines].join("\n");
}

function copyTextToClipboardOsc52(text: string): boolean {
  try {
    const encoded = Buffer.from(text, "utf8").toString("base64");
    process.stdout.write(`\x1b]52;c;${encoded}\x07`);
    return true;
  } catch {
    return false;
  }
}

function renderComposerLine(composer: OpenTuiComposerState): string {
  const cursorIndex = Math.max(0, Math.min(composer.text.length, composer.cursorIndex));
  return `> ${composer.text.slice(0, cursorIndex)}${COMPOSER_CURSOR}${composer.text.slice(cursorIndex)}`;
}

function rowsForOverlay(
  composer: OpenTuiComposerState,
  commandRows: CommandPaletteRow[],
  history: string[],
): CommandPaletteRow[] {
  if (composer.overlayMode !== "history-search") {
    return commandRows;
  }
  const query = composer.historyQuery.trim().toLowerCase();
  return [...history]
    .reverse()
    .filter((entry) => query.length === 0 || entry.toLowerCase().includes(query))
    .map((entry, index) => ({
      label: entry,
      hint: "recent prompt",
      value: entry,
      selected: index === composer.selectedIndex,
    }));
}

function visiblePaletteWindow(rows: CommandPaletteRow[], selectedIndex: number, maxRows: number): CommandPaletteRow[] {
  if (rows.length <= maxRows) {
    return rows;
  }
  const clampedIndex = Math.max(0, Math.min(rows.length - 1, selectedIndex));
  const halfWindow = Math.floor(maxRows / 2);
  const start = Math.max(0, Math.min(rows.length - maxRows, clampedIndex - halfWindow));
  return rows.slice(start, start + maxRows);
}
