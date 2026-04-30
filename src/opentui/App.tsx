import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState } from "react";

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
import type { OpenTuiRuntimeView } from "./runtime-view.js";

const SKILL_PREVIEW_PREFIX = "skill:";
const COMPOSER_CURSOR = "|";
const ALT_V_UNSUPPORTED_MESSAGE = "Alt+V paste-image unavailable in OpenTUI; use /attach <image-path>";

export interface OpenTuiAppProps {
  view: OpenTuiRuntimeView;
  session?: RuntimeSession;
  promptHistory?: string[];
  onPromptHistoryChange?: (history: string[]) => void;
  onExit: () => void;
}

export function OpenTuiApp({ view, session, promptHistory = [], onPromptHistoryChange, onExit }: OpenTuiAppProps) {
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
  const [outputLines, setOutputLines] = useState<string[]>([]);

  const commandSurface = createCommandSurface(view.cwd, composer.text, composer.selectedIndex);
  const skillPreview = resolveSkillPreview(view.cwd, composer.text, composer.selectedIndex);
  const paletteRows = rowsForOverlay(composer, commandSurface.rows, history);
  const previewLine = skillPreview.status === "none" ? commandSurface.hint : skillPreview.label.replace(/^skill:/, SKILL_PREVIEW_PREFIX);
  const attachmentLine = composer.attachment
    ? composer.attachment.supported
      ? `attached: ${composer.attachment.label} | clear attachment`
      : "Image attach unavailable for current transport"
    : null;

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
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
    if ((key.name === "v" || key.sequence.toLowerCase() === "v") && (key.meta || key.option)) {
      appendOutput(ALT_V_UNSUPPORTED_MESSAGE);
      setShellNotice("paste-image shortcut unavailable");
      return;
    }
    if (key.name === "up") {
      if (composer.overlayMode !== "none") {
        applyComposerEvent({ kind: "move-selection", direction: -1, rowCount: paletteRows.length });
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
  });

  const transcriptLines = view.transcriptLines.slice(-12);
  const visibleTranscriptLines = [...transcriptLines, ...outputLines.slice(-8)].slice(-12);
  const traceLines = traceExpanded ? view.traceDetailLines : view.traceSummaryLines;
  const traceLabel = traceExpanded ? view.traceExpandedLabel : view.traceCollapsedLabel;
  const composerLine = composer.text.length > 0 ? renderComposerLine(composer) : `> ${view.composerHint} ${COMPOSER_CURSOR}`;

  return (
    <box flexDirection="column" width={terminalWidth} height={terminalHeight} padding={1}>
      <text width={contentWidth} fg="#8bd5ff">{view.headerTitle}</text>
      <text width={contentWidth} fg="#a6adc8">{`${view.providerLabel} | ${view.sessionLabel} | cwd ${view.cwdLabel}`}</text>
      <box flexDirection="column" width={contentWidth} marginTop={1}>
        <text width={contentWidth} fg="#f9e2af">status</text>
        <text width={contentWidth}>{view.statusLabel}</text>
        <text width={contentWidth} fg="#a6adc8">{view.footerLabel}</text>
      </box>
      <box flexDirection="column" width={contentWidth} flexGrow={1} marginTop={1}>
        <text width={contentWidth} fg="#f9e2af">transcript</text>
        {visibleTranscriptLines.map((line, index) => (
          <text key={`transcript-${String(index)}`} width={contentWidth}>{line}</text>
        ))}
        <text width={contentWidth} fg="#f9e2af">{traceLabel}</text>
        {traceLines.slice(0, traceExpanded ? 8 : 3).map((line, index) => (
          <text key={`trace-${String(index)}`} width={contentWidth} fg="#a6adc8">{line}</text>
        ))}
      </box>
      {composer.overlayMode !== "none" ? (
        <box flexDirection="column" width={paletteWidth} marginLeft={paletteMarginLeft} marginTop={1} padding={1}>
          <text width={paletteWidth} fg="#f9e2af">{commandSurface.title}</text>
          <text width={paletteWidth} fg="#a6adc8">{composer.overlayMode === "history-search" ? "history search" : commandSurface.query}</text>
          {paletteRows.length > 0 ? paletteRows.slice(0, 8).map((row, index) => (
            <text key={`palette-${String(index)}`} width={paletteWidth} fg={row.selected ? "#8bd5ff" : "#a6adc8"}>
              {`${row.selected ? "> " : "  "}${row.label} ${row.hint}`}
            </text>
          )) : (
            <text width={paletteWidth} fg="#a6adc8">{composer.overlayMode === "history-search" ? "No history matches" : "No matches"}</text>
          )}
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
    setOutputLines((current) => [...current, ...lines].slice(-40));
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
    .slice(0, 8)
    .map((entry, index) => ({
      label: entry,
      hint: "recent prompt",
      value: entry,
      selected: index === composer.selectedIndex,
    }));
}
