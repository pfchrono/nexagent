import { flushSync, useRenderer, useTerminalDimensions } from "@opentui/react";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { useEffect, useRef, useState } from "react";

import {
  applyAttachmentMutationCommand,
  buildActiveSkillExecutionPrompt,
  extractClipboardImageToTempFile,
  formatProgressChrome,
  formatPromptEventDetail,
  runRuntimeCommand,
  type RuntimeCommandResult,
} from "../cli.js";
import { executeProviderRequest, type ImageAttachment } from "../provider.js";
import { cancelBoomerang, completeBoomerang } from "../runtime/boomerang.js";
import {
  createRuntimeExtensionArgs,
  createRuntimeExtensionContext,
  findRuntimeExtensionCommand,
  type RuntimeExtensionCustomComponent,
} from "../runtime/extensions.js";
import { checkpointNexsightSession } from "../runtime/nexsight.js";
import type { RuntimeSession } from "../runtime/session.js";
import { cancelBtwTurn, completeBtwTurn, formatBtwOverlayRows } from "../runtime/btw.js";
import { savePersistedRuntimeState } from "../runtime/persistence.js";
import { formatSubagentOverlayRows } from "../runtime/subagents.js";
import { formatTodoOverlayRows } from "../runtime/todos.js";
import { beginGoalTurn, completeGoalTurn, formatGoalOverlayRows, type GoalContinuation } from "../runtime/goal.js";
import { formatTurnStartIntent } from "../runtime/turn-intent.js";
import {
  maybeCompactConversation,
  recordConversationTurn,
  recordRuntimeEvent,
  recordTurnTelemetry,
  setRuntimeAction,
  subscribeRuntimeSession,
} from "../runtime/session.js";
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
  createOpenTuiRuntimeView,
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
const ALT_V_UNSUPPORTED_MESSAGE = "No clipboard image found; use /attach <image-path>";
const CTRL_V_UNSUPPORTED_MESSAGE = "clipboard text unavailable";
const COPIED_RESULTS_NOTICE = "copied to clipboard";
const PALETTE_VISIBLE_ROWS = 5;
const PALETTE_CHROME_ROWS = 5;
const TRACE_DETAIL_PALETTE_MIN_ROWS = 8;
const COMPOSER_VISIBLE_PROMPT_ROWS = 4;
const STATUSLINE_RESERVED_ROWS = 3;
const WARNING_VISIBLE_ROWS = 3;
const WIDE_COCKPIT_MIN_COLUMNS = 120;
const IDLE_REFRESH_INTERVAL_MS = 1000;
const RUNNING_REFRESH_INTERVAL_MS = 80;
const MOUSE_SCROLL_LINES = 1;
const ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const CONTROL_CHARACTER_PATTERN = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

function summarizeBoomerangEvent(summary: string): string {
  return summary
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join("\n");
}

function sanitizeExtensionUiText(value: string): string {
  return value
    .replace(ANSI_ESCAPE_PATTERN, "")
    .replace(CONTROL_CHARACTER_PATTERN, "");
}

function formatExtensionInputKey(key: OpenTuiKeyEvent): string {
  if (key.name === "escape") {
    return "escape";
  }
  if (key.name === "enter" || key.name === "return") {
    return "enter";
  }
  if (key.name === "space") {
    return " ";
  }
  if (key.sequence && key.sequence.length > 0 && !key.ctrl && !key.meta && !key.option) {
    return key.sequence;
  }
  return key.name;
}

function findExtensionShortcutForKey(session: RuntimeSession, key: OpenTuiKeyEvent) {
  if (!session.extensions) {
    return null;
  }
  const candidates: string[] = [];
  if (key.ctrl) {
    candidates.push(`ctrl+${key.name}`);
  }
  if (key.meta || key.option) {
    candidates.push(`alt+${key.name}`, `option+${key.name}`, `meta+${key.name}`);
  }
  for (const candidate of candidates) {
    const shortcut = session.extensions.shortcuts.get(candidate);
    if (shortcut) {
      return shortcut;
    }
  }
  return null;
}

interface OpenTuiMouseLikeEvent {
  type?: string;
  button?: number;
  scroll?: {
    direction?: string;
    delta?: number;
  };
  preventDefault: () => void;
  stopPropagation: () => void;
}

export interface OpenTuiAppProps {
  view: OpenTuiRuntimeView;
  session?: RuntimeSession;
  keyboardSource?: OpenTuiKeyboardSource;
  promptHistory?: string[];
  onPromptHistoryChange?: (history: string[]) => void;
  onExit: () => void;
}

export function OpenTuiApp({ view: initialView, session, keyboardSource, promptHistory = [], onPromptHistoryChange, onExit }: OpenTuiAppProps) {
  const { width, height } = useTerminalDimensions();
  const renderer = useRenderer();
  const terminalWidth = width > 0 ? width : process.stdout.columns || 80;
  const terminalHeight = height > 0 ? height : process.stdout.rows || 24;
  const contentWidth = Math.max(20, terminalWidth - 2);
  const paletteWidth = Math.min(Math.max(32, Math.floor(contentWidth * 0.7)), Math.max(32, contentWidth - 4));
  const paletteMarginLeft = Math.max(0, Math.floor((contentWidth - paletteWidth) / 2));
  const [composer, setComposer] = useState<OpenTuiComposerState>(() => createOpenTuiComposerState());
  const [history, setHistory] = useState(promptHistory);
  const [traceExpanded, setTraceExpanded] = useState(false);
  const [traceProgressPaletteKey, setTraceProgressPaletteKey] = useState<string | null>(null);
  const [traceDetailScrollOffset, setTraceDetailScrollOffset] = useState(0);
  const [shellNotice, setShellNotice] = useState("ready");
  const [runtimeView, setRuntimeView] = useState<OpenTuiRuntimeView>(initialView);
  const [transcriptState, setTranscriptState] = useState<OpenTuiTranscriptState>(() => createOpenTuiTranscriptState());
  const [pendingImageAttachments, setPendingImageAttachments] = useState<ImageAttachment[]>([]);
  const [cockpitExpanded, setCockpitExpanded] = useState(false);
  const [configExpanded, setConfigExpanded] = useState(false);
  const [configSelectedIndex, setConfigSelectedIndex] = useState(0);
  const [askSelectedIndex, setAskSelectedIndex] = useState(0);
  const [extensionCustomLines, setExtensionCustomLines] = useState<string[] | null>(null);
  const [spinnerTick, setSpinnerTick] = useState(0);
  const providerRunningRef = useRef(false);
  const mountedRef = useRef(true);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clipboardPasteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerRef = useRef<OpenTuiComposerState>(composer);
  const extensionCustomRef = useRef<RuntimeExtensionCustomComponent | null>(null);
  const [, setExtensionWidgetRevision] = useState(0);
  const view = runtimeView;
  composerRef.current = composer;

  const commandSurface = createCommandSurface(view.cwd, composer.text, composer.selectedIndex);
  const skillPreview = resolveSkillPreview(view.cwd, composer.text, composer.selectedIndex);
  const paletteRows = rowsForOverlay(composer, commandSurface.rows, history);
  const visiblePaletteRows = visiblePaletteWindow(paletteRows, composer.selectedIndex, PALETTE_VISIBLE_ROWS);
  const paletteDisplayRows = createPaletteDisplayRows(composer, paletteRows, visiblePaletteRows, paletteWidth);
  const paletteFooterLine = paletteRows.length > PALETTE_VISIBLE_ROWS ? `${String(composer.selectedIndex + 1)}/${String(paletteRows.length)} - use arrows` : "";
  const paletteTitle = paletteTitleForOverlay(composer, commandSurface.title);
  const palettePanelRows = renderPalettePanelRows({
    width: paletteWidth,
    title: paletteTitle,
    query: composer.overlayMode === "history-search" ? "history search" : commandSurface.query,
    displayRows: paletteDisplayRows,
    footerLine: paletteFooterLine,
  });
  const previewLine = skillPreview.status === "none" ? commandSurface.hint ?? "" : skillPreview.label.replace(/^skill:/, SKILL_PREVIEW_PREFIX);
  const showCockpitPanel = cockpitExpanded;
  const wideCockpitLayout = terminalWidth >= WIDE_COCKPIT_MIN_COLUMNS;
  const compactCockpitLayout = terminalHeight < 30;
  const cockpitWarningRows = view.cockpit.warnings.slice(0, WARNING_VISIBLE_ROWS);
  const cockpitWarningOverflow = Math.max(0, view.cockpit.warnings.length - WARNING_VISIBLE_ROWS);
  const cockpitMemoryRows = wideCockpitLayout
    ? [
      view.cockpit.memory.active,
      view.cockpit.memory.retrieved,
      view.cockpit.memory.checkpoints,
    ]
    : [
      `${view.cockpit.memory.active} | ${view.cockpit.memory.retrieved}`,
    ];
  const cockpitPanelRows = renderCockpitPanelRows({
    width: contentWidth,
    warningRows: cockpitWarningRows,
    warningOverflow: cockpitWarningOverflow,
    ladder: view.cockpit.ladder,
    memoryRows: cockpitMemoryRows,
    overrideHints: view.cockpit.overrideHints,
    risk: view.cockpit.risk,
    compact: compactCockpitLayout,
  });
  const attachmentLine = composer.attachment
    ? composer.attachment.supported
      ? `images: ${composer.attachment.label}  [X] clear`
      : "Image attach unavailable for current transport"
    : null;

  const keyHandlerRef = useRef<(key: OpenTuiKeyEvent) => void>(() => undefined);
  keyHandlerRef.current = handleKeyboardKey;

  useEffect(() => {
    return keyboardSource?.subscribe((key) => {
      flushSync(() => keyHandlerRef.current(key));
    });
  }, [keyboardSource]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
      if (session?.extensions?.uiBridge) {
        session.extensions.uiBridge = undefined;
      }
      extensionCustomRef.current?.dispose?.();
      extensionCustomRef.current = null;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (clipboardPasteTimerRef.current) {
        clearTimeout(clipboardPasteTimerRef.current);
        clipboardPasteTimerRef.current = null;
      }
    };
  }, [session]);

  useEffect(() => {
    if (!session?.extensions) {
      return undefined;
    }
    session.extensions.uiBridge = {
      notify(message, level = "info") {
        setShellNotice(sanitizeExtensionUiText(`${level}: ${message}`));
      },
      setWidget() {
        setExtensionWidgetRevision((current) => current + 1);
      },
      getEditorText() {
        return composerRef.current.text;
      },
      setEditorText(value) {
        const text = sanitizeExtensionUiText(value);
        setComposer((current) => ({ ...current, text, cursorIndex: text.length, overlayMode: "none" }));
      },
      custom(factory) {
        return new Promise((resolve) => {
          const renderCustom = (component: RuntimeExtensionCustomComponent) => {
            const lines = component.render(Math.max(20, contentWidth - 2)).map(sanitizeExtensionUiText);
            setExtensionCustomLines(lines);
          };
          const done = (value?: unknown) => {
            extensionCustomRef.current?.dispose?.();
            extensionCustomRef.current = null;
            setExtensionCustomLines(null);
            resolve(value as never);
          };
          const component = factory({
            requestRender: () => {
              if (extensionCustomRef.current) {
                renderCustom(extensionCustomRef.current);
              }
            },
          }, {}, {}, done);
          extensionCustomRef.current?.dispose?.();
          extensionCustomRef.current = component;
          renderCustom(component);
        });
      },
    };
    return () => {
      if (session.extensions?.uiBridge) {
        session.extensions.uiBridge = undefined;
      }
    };
  }, [session]);

  useEffect(() => {
    if (!session) {
      return undefined;
    }
    return subscribeRuntimeSession(session, () => scheduleRuntimeViewRefresh(16));
  }, [session]);

  useEffect(() => {
    if (!session) {
      return undefined;
    }
    const intervalMs = view.status === "running" ? RUNNING_REFRESH_INTERVAL_MS : IDLE_REFRESH_INTERVAL_MS;
    const interval = setInterval(() => {
      setSpinnerTick((current) => current + 1);
      scheduleRuntimeViewRefresh(0);
    }, intervalMs);
    return () => clearInterval(interval);
  }, [session, view.status]);

  function handleKeyboardKey(key: OpenTuiKeyEvent): void {
    if (key.paste) {
      if (clipboardPasteTimerRef.current) {
        clearTimeout(clipboardPasteTimerRef.current);
        clipboardPasteTimerRef.current = null;
      }
      applyComposerEvent({ kind: "paste", value: key.sequence });
      setShellNotice(`pasted ${String(key.sequence.length)} chars`);
      return;
    }
    if ((key.ctrl || key.meta || key.option) && key.name === "q") {
      onExit();
      return;
    }
    if (extensionCustomRef.current) {
      extensionCustomRef.current.handleInput?.(formatExtensionInputKey(key));
      return;
    }
    if (session?.operationControls.pendingQuestionnaire && composer.overlayMode === "none") {
      if (handleAskKeyboardKey(key)) {
        return;
      }
    }
    if (key.ctrl && key.name === "t") {
      setTraceExpanded((current) => {
        const next = !current;
        if (!next) {
          setTraceProgressPaletteKey(null);
          setTraceDetailScrollOffset(0);
        }
        return next;
      });
      return;
    }
    if (key.ctrl && key.name === "p") {
      setCockpitExpanded((current) => !current);
      setShellNotice(cockpitExpanded ? "cockpit hidden" : "cockpit shown");
      return;
    }
    if (key.ctrl && key.name === "g") {
      setConfigExpanded((current) => !current);
      setShellNotice(configExpanded ? "config hidden" : "config shown");
      return;
    }
    const extensionShortcut = session ? findExtensionShortcutForKey(session, key) : null;
    if (extensionShortcut) {
      const output = extensionShortcut.handler(createRuntimeExtensionArgs([]), createRuntimeExtensionContext(session!));
      if (output && typeof (output as Promise<unknown>).then === "function") {
        void (output as Promise<unknown>).then(() => {
          setExtensionWidgetRevision((current) => current + 1);
        }).catch((error) => {
          session!.extensions?.invalidEntries.push(`shortcut ${extensionShortcut.name}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
      setShellNotice(extensionShortcut.description ?? extensionShortcut.name);
      setExtensionWidgetRevision((current) => current + 1);
      return;
    }
    if (key.ctrl && key.name === "r") {
      applyComposerEvent({ kind: "open-history-search" });
      return;
    }
    if (key.ctrl && key.name === "v") {
      scheduleTextPasteFromClipboard();
      return;
    }
    if (key.ctrl && key.name === "c") {
      copySelectedText();
      return;
    }
    if (key.ctrl && key.name === "y") {
      copyLatestResultBlock();
      return;
    }
    if (traceProgressPaletteKey && composer.overlayMode === "none" && key.name === "escape") {
      closeTraceDetailPalette();
      return;
    }
    if (traceProgressPaletteKey && composer.overlayMode === "none" && key.name === "pageup") {
      scrollTraceDetailPalette(-traceDetailVisibleRows);
      return;
    }
    if (traceProgressPaletteKey && composer.overlayMode === "none" && key.name === "pagedown") {
      scrollTraceDetailPalette(traceDetailVisibleRows);
      return;
    }
    if (configExpanded && composer.overlayMode === "none" && key.name === "escape") {
      setConfigExpanded(false);
      setShellNotice("config hidden");
      return;
    }
    if (configExpanded && composer.overlayMode === "none" && key.name === "up") {
      moveConfigSelection(-1);
      return;
    }
    if (configExpanded && composer.overlayMode === "none" && key.name === "down") {
      moveConfigSelection(1);
      return;
    }
    if (configExpanded && composer.overlayMode === "none" && (key.name === "enter" || key.name === "return")) {
      applyConfigSelection();
      return;
    }
    if ((key.name === "v" || key.sequence.toLowerCase() === "v") && (key.meta || key.option)) {
      void pasteImageFromClipboard();
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
      if (key.meta || key.option) {
        applyComposerEvent({ kind: "enter", shift: true });
        return;
      }
      if (!key.shift && composer.overlayMode !== "none") {
        if (paletteRows.length === 0) {
          applyComposerEvent({ kind: "enter", shift: false });
          return;
        }
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

  const paletteOverlayHeight = PALETTE_VISIBLE_ROWS + PALETTE_CHROME_ROWS;
  const cockpitRowBudget = showCockpitPanel ? compactCockpitLayout ? 6 : wideCockpitLayout ? 9 : 8 : 0;
  const askPanel = createAskPanel(session?.operationControls.pendingQuestionnaire ?? null, askSelectedIndex, Math.min(Math.max(48, Math.floor(contentWidth * 0.72)), Math.max(32, contentWidth - 4)));
  const extensionCustomRows = extensionCustomLines?.map((line, index) => ({ key: `extension-custom-${String(index)}`, text: line })) ?? [];
  const btwRows = session ? formatBtwOverlayRows(session.btw, Math.max(12, contentWidth - 6)) : [];
  const goalRows = session ? formatGoalOverlayRows(session.goal, Math.max(12, contentWidth - 6)) : [];
  const subagentRows = session ? formatSubagentOverlayRows(session.subagents, Math.max(12, contentWidth - 6)) : [];
  const todoRows = session ? formatTodoOverlayRows(session.todos, Math.max(12, contentWidth - 6)) : [];
  const todoStatusRows = renderTodoStatusRows(todoRows, contentWidth);
  const todoReservedRows = todoStatusRows.length;
  const extensionWidgetRows = [
    ...goalRows,
    ...subagentRows,
    ...btwRows,
    ...extensionCustomRows,
    ...(session?.extensions
      ? [...session.extensions.widgets.entries()].flatMap(([id, lines]) => lines.map((line, index) => ({ key: `extension-widget-${id}-${String(index)}`, text: sanitizeExtensionUiText(line) })))
      : []),
  ];
  const composerPromptRows = renderComposerPromptRows(composer, contentWidth);
  const composerReservedRows = composerPanelHeight(composerPromptRows.length + extensionWidgetRows.length, Boolean(attachmentLine));
  const bottomReservedRows = composerReservedRows + todoReservedRows;
  const configPanelWidth = Math.min(Math.max(52, Math.floor(contentWidth * 0.38)), Math.max(36, contentWidth - 4));
  const configPanelLeft = Math.max(0, contentWidth - configPanelWidth - 1);
  const configPanelRows = renderConfigPanelRows(view, configPanelWidth, configSelectedIndex);
  const configPanelHeight = Math.min(Math.max(8, configPanelRows.length), Math.max(8, terminalHeight - bottomReservedRows - STATUSLINE_RESERVED_ROWS - 3));
  const configPanelTop = 2;
  const lspProblemsPanelWidth = Math.min(Math.max(34, Math.floor(contentWidth * 0.26)), Math.max(28, contentWidth - 4));
  const lspProblemsPanelRows = renderLspProblemsPanelRows(view, lspProblemsPanelWidth);
  const lspProblemsPanelHeight = Math.min(Math.max(4, lspProblemsPanelRows.length), 6);
  const lspProblemsPanelLeft = Math.max(0, contentWidth - lspProblemsPanelWidth - 1);
  const lspProblemsPanelTop = 2;
  const paletteTop = Math.max(4, terminalHeight - bottomReservedRows - STATUSLINE_RESERVED_ROWS - paletteOverlayHeight - 1);
  const askPanelWidth = askPanel?.width ?? paletteWidth;
  const askPanelHeight = askPanel?.rows.length ?? 0;
  const askPanelLeft = Math.max(0, Math.floor((contentWidth - askPanelWidth) / 2));
  const askPanelTop = Math.max(4, terminalHeight - bottomReservedRows - STATUSLINE_RESERVED_ROWS - askPanelHeight - 1);
  const traceProgressAllRows = traceExpanded
    ? renderTraceProgressRows(view.traceBlocks, contentWidth)
    : [];
  const traceProgressDisplayRows = markActiveTraceProgressRow(traceProgressAllRows, traceProgressPaletteKey, contentWidth);
  const traceProgressRows = traceExpanded
    ? limitTraceProgressRows(traceProgressDisplayRows, contentWidth, Math.max(6, Math.min(18, Math.floor(terminalHeight * 0.28))))
    : [];
  const activeTraceProgressRow = traceProgressPaletteKey
    ? traceProgressDisplayRows.find((row) => row.key === traceProgressPaletteKey) ?? null
    : null;
  const traceDetailPaletteWidth = Math.min(Math.max(48, Math.floor(contentWidth * 0.78)), Math.max(32, contentWidth - 4));
  const traceDetailPaletteLeft = Math.max(0, Math.floor((contentWidth - traceDetailPaletteWidth) / 2));
  const traceDetailPaletteHeight = Math.max(
    TRACE_DETAIL_PALETTE_MIN_ROWS,
    Math.min(Math.max(TRACE_DETAIL_PALETTE_MIN_ROWS, terminalHeight - bottomReservedRows - STATUSLINE_RESERVED_ROWS - 7), Math.floor(terminalHeight * 0.56)),
  );
  const traceDetailVisibleRows = Math.max(1, traceDetailPaletteHeight - 4);
  const traceDetailPaletteRows = activeTraceProgressRow
    ? renderTraceDetailPaletteRows({
      width: traceDetailPaletteWidth,
      row: activeTraceProgressRow,
      scrollOffset: traceDetailScrollOffset,
      visibleRows: traceDetailVisibleRows,
    })
    : [];
  const traceDetailPaletteTop = Math.max(4, Math.floor((terminalHeight - bottomReservedRows - STATUSLINE_RESERVED_ROWS - traceDetailPaletteHeight) / 2));
  const progressRowBudget = traceProgressRows.length;
  const transcriptViewportHeight = Math.max(1, terminalHeight - 8 - cockpitRowBudget - progressRowBudget - STATUSLINE_RESERVED_ROWS - bottomReservedRows);
  const transcriptBlocks = view.transcriptBlocks;
  const transcriptRenderRows = flattenTranscriptBlocks(transcriptBlocks, transcriptState, contentWidth);
  const transcriptMetrics: TranscriptMetrics = {
    contentLineCount: transcriptRenderRows.length,
    viewportLineCount: transcriptViewportHeight,
    blockCount: transcriptBlocks.length,
  };
  const visibleTranscriptRows = visibleLineWindow(transcriptRenderRows, transcriptState, transcriptViewportHeight);
  const transcriptLineTotal = Math.max(1, transcriptRenderRows.length);
  const transcriptWindowEnd = Math.min(transcriptLineTotal, transcriptState.scrollOffset + transcriptViewportHeight);
  const transcriptPositionLabel = `${String(transcriptWindowEnd)}/${String(transcriptLineTotal)}`;
  const transcriptFillerRows = Array.from(
    { length: Math.max(0, transcriptViewportHeight - visibleTranscriptRows.length) },
    (_, index) => `transcript-filler-${String(index)}`,
  );
  const traceLabel = traceExpanded ? view.traceExpandedLabel : view.traceCollapsedLabel;
  const statuslineProgress = formatOpenTuiStatuslineProgress(spinnerTick, view);
  const statuslineRows = renderStatuslineRows({
    width: contentWidth,
    progress: statuslineProgress,
    statusline: view.statusline,
    traceLabel,
    shellNotice,
    transcriptPosition: transcriptPositionLabel,
    attachmentLabel: composer.attachment?.supported ? composer.attachment.label : null,
  });
  const composerPanelRows = renderComposerPanelRows({
    width: contentWidth,
    attachmentLine,
    attachmentSupported: composer.attachment?.supported ?? false,
    extensionRows: extensionWidgetRows,
    promptLines: composerPromptRows,
    previewLine,
    statusLine: `${String(terminalWidth)}x${String(terminalHeight)} · ${traceLabel} · ${shellNotice}`,
  });
  const keyLine = "Keys: ↵ send · Esc clear · Tab complete | 📋 Ctrl+V text · Alt+V image | ↕ history · PgUp/PgDn scroll | ⌘ Ctrl+P cockpit · Ctrl+G config · Ctrl+T trace · Ctrl+C copy · Ctrl+Y latest · /quit";

  useEffect(() => {
    setTranscriptState((current) => handleOpenTuiTranscriptEvent(current, {
      kind: "content-updated",
      metrics: transcriptMetrics,
    }));
  }, [transcriptRenderRows.length, transcriptViewportHeight, transcriptBlocks.length]);

  return (
    <box flexDirection="column" width={terminalWidth} height={terminalHeight} padding={1}>
      {renderLogoRows(view, spinnerTick, contentWidth).map((row) => (
        <text key={row.key} width={contentWidth} fg={row.fg}>{row.text}</text>
      ))}
      <text width={contentWidth} fg="#a6adc8">{`provider ${view.providerLabel.split("/")[0]} | ${view.sessionLabel}`}</text>
      {configExpanded ? (
        <box
          flexDirection="column"
          width={configPanelWidth}
          height={configPanelHeight}
          position="absolute"
          top={configPanelTop}
          left={configPanelLeft + 1}
          zIndex={94}
          padding={1}
          overflow="hidden"
          shouldFill
          backgroundColor="#000000"
        >
          {configPanelRows.slice(0, configPanelHeight).map((row) => (
            <text
              key={row.key}
              width={configPanelWidth}
              fg={row.fg}
              onMouseUp={row.selectable ? (event) => handleConfigRowClick(row, event) : undefined}
            >{row.text}</text>
          ))}
        </box>
      ) : null}
      {!configExpanded && view.lspProblems.visible ? (
        <box
          flexDirection="column"
          width={lspProblemsPanelWidth}
          height={lspProblemsPanelHeight}
          position="absolute"
          top={lspProblemsPanelTop}
          left={lspProblemsPanelLeft + 1}
          zIndex={88}
          padding={1}
          overflow="hidden"
          shouldFill
          backgroundColor="#000000"
        >
          {lspProblemsPanelRows.slice(0, lspProblemsPanelHeight).map((row) => (
            <text key={row.key} width={lspProblemsPanelWidth} fg={row.fg}>{row.text}</text>
          ))}
        </box>
      ) : null}
      {view.cockpit.approval.pendingTool ? (
        <box
          flexDirection="column"
          width={paletteWidth}
          height={5}
          position="absolute"
          top={Math.max(4, paletteTop - 6)}
          left={paletteMarginLeft + 1}
          zIndex={90}
          padding={1}
          shouldFill
          backgroundColor="#000000"
        >
          <text width={paletteWidth} fg="#f9e2af">Approval required</text>
          <text width={paletteWidth} fg="#f38ba8">{fitLine(`tool ${view.cockpit.approval.pendingTool}`, paletteWidth)}</text>
          <text width={paletteWidth} fg="#a6adc8">{fitLine(view.cockpit.approval.hints.join(" | "), paletteWidth)}</text>
        </box>
      ) : null}
      {askPanel ? (
        <box
          flexDirection="column"
          width={askPanelWidth}
          height={askPanelHeight}
          position="absolute"
          top={askPanelTop}
          left={askPanelLeft + 1}
          zIndex={101}
          padding={0}
          overflow="hidden"
          shouldFill
          backgroundColor="#000000"
        >
          {askPanel.rows.map((row) => (
            <text
              key={row.key}
              width={askPanelWidth}
              fg={row.fg}
              onMouseUp={row.optionIndex !== undefined ? (event) => handleAskOptionClick(row.optionIndex!, event) : undefined}
            >
              {row.text}
            </text>
          ))}
        </box>
      ) : null}
      {showCockpitPanel ? (
        <box flexDirection="column" width={contentWidth} marginTop={1}>
          {cockpitPanelRows.map((row) => (
            <text key={row} width={contentWidth} fg={row.includes("approval") || row.includes("Controls") ? "#f9e2af" : "#a6adc8"}>
              {row}
            </text>
          ))}
        </box>
      ) : null}
      {traceProgressRows.length > 0 ? (
        <box flexDirection="column" width={contentWidth}>
          {traceProgressRows.map((row) => (
            <text
              key={row.key}
              width={contentWidth}
              fg={row.fg}
              onMouseUp={(event) => handleTraceProgressRowClick(row, event)}
            >{row.text}</text>
          ))}
        </box>
      ) : null}
      {activeTraceProgressRow ? (
        <box
          flexDirection="column"
          width={traceDetailPaletteWidth}
          height={traceDetailPaletteHeight}
          position="absolute"
          top={traceDetailPaletteTop}
          left={traceDetailPaletteLeft + 1}
          zIndex={95}
          padding={0}
          overflow="hidden"
          shouldFill
          backgroundColor="#000000"
          onMouse={(event) => handleTraceDetailPaletteMouse(event)}
          onMouseScroll={(event) => handleTraceDetailPaletteMouseScroll(event)}
        >
          {traceDetailPaletteRows.map((row) => (
            <text key={row.key} width={traceDetailPaletteWidth} fg={row.fg}>
              {row.text}
            </text>
          ))}
        </box>
      ) : null}
      <box
        flexDirection="column"
        width={contentWidth}
        height={transcriptViewportHeight + 1}
        marginTop={1}
        onMouse={(event) => handleTranscriptMouse(event)}
        onMouseScroll={(event) => handleTranscriptMouseScroll(event)}
      >
        <text width={contentWidth} fg="#f9e2af">{chatDividerLine(contentWidth, "top")}</text>
        {visibleTranscriptRows.map((row) => (
          <text
            key={row.key}
            width={contentWidth}
            selectable
            selectionBg="#8bd5ff"
            selectionFg="#000000"
            fg={row.fg}
            onMouseUp={(event) => handleTranscriptRowClick(row, event)}
          >
            {row.text}
          </text>
        ))}
        {transcriptFillerRows.map((key) => (
          <text key={key} width={contentWidth}> </text>
        ))}
      </box>
      {composer.overlayMode !== "none" ? (
        <box
          flexDirection="column"
          width={paletteWidth}
          height={paletteOverlayHeight}
          position="absolute"
          top={paletteTop}
          left={paletteMarginLeft + 1}
          zIndex={100}
          padding={0}
          overflow="hidden"
          shouldFill
          backgroundColor="#000000"
        >
          {palettePanelRows.map((row) => (
            <text
              key={row.key}
              width={paletteWidth}
              fg={row.fg}
              onMouseUp={row.value ? (event) => handlePaletteRowClick(row.value!, row.rowIndex, event) : undefined}
            >
              {row.text}
            </text>
          ))}
        </box>
      ) : null}
      <box
        flexDirection="column"
        width={contentWidth}
        height={STATUSLINE_RESERVED_ROWS}
        position="absolute"
        top={Math.max(1, terminalHeight - bottomReservedRows - STATUSLINE_RESERVED_ROWS)}
        left={1}
        zIndex={79}
        padding={0}
      >
        {statuslineRows.map((row) => (
          <text key={row.key} width={contentWidth} fg={row.fg}>{row.text}</text>
        ))}
      </box>
      {todoReservedRows > 0 ? (
        <box
          flexDirection="column"
          width={contentWidth}
          height={todoReservedRows}
          position="absolute"
          top={Math.max(1, terminalHeight - composerReservedRows - todoReservedRows)}
          left={1}
          zIndex={80}
          padding={0}
        >
          {todoStatusRows.map((row) => (
            <text key={row.key} width={contentWidth} fg={row.fg}>{row.text}</text>
          ))}
        </box>
      ) : null}
      <box
        flexDirection="column"
        width={contentWidth}
        height={composerReservedRows}
        position="absolute"
        top={Math.max(1, terminalHeight - composerReservedRows)}
        left={1}
        zIndex={80}
        padding={0}
      >
        {composerPanelRows.map((row) => (
          <text
            key={row.key}
            width={contentWidth}
            fg={row.fg}
            onMouseUp={row.key === "composer-attachment" && composer.attachment?.supported
              ? (event) => handleAttachmentClearClick(event)
              : undefined}
          >
            {row.text}
          </text>
        ))}
        <text width={contentWidth} fg="#ffffff">{fitLine(keyLine, contentWidth)}</text>
      </box>
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
      clearPendingAttachment();
      return;
    }
    if (result.intent.kind === "accept-selection") {
      setShellNotice("selection accepted");
      return;
    }
    submitPrompt(result.intent.prompt);
  }

  function handlePaletteRowClick(value: string, rowIndex: number | undefined, event: OpenTuiMouseLikeEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (typeof rowIndex === "number" && rowIndex >= 0) {
      setComposer((current) => ({ ...current, selectedIndex: rowIndex }));
    }
    applyComposerEvent({ kind: "accept-value", value });
  }

  function submitPrompt(prompt: string): void {
    if (skillPreview.status === "ambiguous") {
      setShellNotice("Select skill");
      setComposer((current) => ({ ...current, text: prompt, cursorIndex: prompt.length, overlayMode: "skill" }));
      return;
    }
    if (prompt === "/detach" || prompt === "/attach clear") {
      clearPendingAttachment();
      return;
    }
    if (prompt.startsWith("/attach")) {
      attachImagePath(prompt.replace(/^\/attach\s*/i, "").trim());
      return;
    }

    const nextHistory = history[history.length - 1] === prompt ? history : [...history, prompt].slice(-100);
    setHistory(nextHistory);
    onPromptHistoryChange?.(nextHistory);

    const intent = createRuntimeCommandIntent(prompt, skillPreview);
    if (intent.kind === "runtime-command" && session) {
      const normalizedInput = intent.input.trim().toLowerCase();
      if (normalizedInput === "/config") {
        setConfigExpanded(true);
        setShellNotice("config shown");
        return;
      }
      const extensionCommand = findRuntimeExtensionCommand(session, intent.input.trim().split(/\s+/)[0] ?? "");
      if (extensionCommand) {
        void runOpenTuiExtensionCommand(intent.input, extensionCommand);
        return;
      }
      const result = runRuntimeCommand(session, intent.input);
      const autoInvokeAfterSkill = Boolean(result?.ok && result.autoInvokeAfterSkill);
      if (result && !autoInvokeAfterSkill) {
        recordCommandOutputEvent(intent.input, result);
      }
      setShellNotice(result ? result.activity : "command routed");
      if (autoInvokeAfterSkill) {
        const autoInvokeResult = result && result.ok ? result : null;
        void submitProviderPrompt(autoInvokeResult?.invokePrompt ?? buildActiveSkillExecutionPrompt(session, intent.input), {
          transcriptPrompt: autoInvokeResult?.transcriptPrompt ?? formatActiveSkillTranscriptPrompt(session),
          promptSummary: autoInvokeResult?.promptSummary ?? `active skill ${session.activeSkill?.name ?? "selected"} requested`,
        });
        return;
      }
      if (result?.ok && intent.input.trim() === "/quit") {
        onExit();
      }
      return;
    }
    if (!session) {
      setShellNotice(`prompt queued: ${intent.input}`);
      return;
    }
    void submitProviderPrompt(intent.input);
  }

  async function runOpenTuiExtensionCommand(input: string, extensionCommand: NonNullable<ReturnType<typeof findRuntimeExtensionCommand>>): Promise<void> {
    if (!session) {
      return;
    }
    const args = input.trim().split(/\s+/).slice(1);
    try {
      const output = await extensionCommand.handler(createRuntimeExtensionArgs(args), createRuntimeExtensionContext(session));
      const result: RuntimeCommandResult = {
        ok: true,
        output: formatOpenTuiExtensionCommandOutput(output),
        activity: `extension ${extensionCommand.name}`,
      };
      recordCommandOutputEvent(input, result);
      setShellNotice(result.activity);
      setExtensionWidgetRevision((current) => current + 1);
      refreshRuntimeView();
    } catch (error) {
      const result: RuntimeCommandResult = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
        activity: `command failed · ${extensionCommand.name}`,
      };
      recordCommandOutputEvent(input, result);
      setShellNotice(result.activity);
      refreshRuntimeView();
    }
  }

  function attachImagePath(rawPath: string): void {
    if (!session) {
      setShellNotice("attachment unavailable");
      return;
    }
    if (!rawPath.trim()) {
      void pasteImageFromClipboard();
      return;
    }
    try {
      const result = applyAttachmentMutationCommand(session, { kind: "attach", rawPath });
      addPendingAttachment(result.attachment);
      setShellNotice("image attached");
    } catch (error) {
      setShellNotice("image attach failed");
    }
  }

  async function pasteImageFromClipboard(): Promise<void> {
    if (!session) {
      setShellNotice("paste-image unavailable");
      return;
    }
    try {
      const extracted = extractClipboardImageToTempFile();
      const result = applyAttachmentMutationCommand(session, { kind: "attach", rawPath: extracted.path });
      addPendingAttachment(result.attachment);
      setShellNotice(`image pasted · ${extracted.source}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setShellNotice(message || ALT_V_UNSUPPORTED_MESSAGE);
    }
  }

  function pasteTextFromClipboard(): void {
    const text = readClipboardText();
    if (!text.trim()) {
      setShellNotice(CTRL_V_UNSUPPORTED_MESSAGE);
      return;
    }
    applyComposerEvent({ kind: "paste", value: text });
    setShellNotice(`pasted ${String(text.length)} chars`);
  }

  function scheduleTextPasteFromClipboard(): void {
    if (clipboardPasteTimerRef.current) {
      clearTimeout(clipboardPasteTimerRef.current);
    }
    clipboardPasteTimerRef.current = setTimeout(() => {
      clipboardPasteTimerRef.current = null;
      pasteTextFromClipboard();
    }, 35);
  }

  function clearPendingAttachment(silent = false): void {
    setPendingImageAttachments([]);
    setComposer((current) => setComposerAttachment(current, null));
    setShellNotice(silent ? "attachment cleared" : "image attachment cleared");
  }

  function addPendingAttachment(attachment: ImageAttachment | null): void {
    if (!attachment) {
      setPendingImageAttachments([]);
      setComposer((current) => setComposerAttachment(current, null));
      return;
    }
    setPendingImageAttachments((current) => {
      const next = [...current, attachment];
      setComposer((composerState) => setComposerAttachment(composerState, {
        label: formatAttachmentListLabel(next),
        supported: true,
      }));
      return next;
    });
  }

  async function submitProviderPrompt(
    prompt: string,
    display: { transcriptPrompt?: string; promptSummary?: string } = {},
  ): Promise<void> {
    if (!session) {
      return;
    }
    if (providerRunningRef.current || session.action.pending) {
      setShellNotice("turn already running");
      return;
    }

    providerRunningRef.current = true;
    recordRuntimeEvent(session, {
      kind: "prompt",
      status: "queued",
      summary: display.promptSummary ?? "user prompt accepted",
      detail: formatPromptEventDetail(display.transcriptPrompt ?? prompt),
    });
    recordRuntimeEvent(session, {
      kind: "control",
      status: "started",
      summary: "turn intent",
      detail: formatTurnStartIntent(display.transcriptPrompt ?? prompt),
    });
    setRuntimeAction(session, "running", "provider request");
    refreshRuntimeView();
    setShellNotice("provider request started");

    let goalContinuation: GoalContinuation | null = null;
    try {
      const autoCompact = maybeCompactConversation(session, prompt);
      if (autoCompact.compacted) {
        setRuntimeAction(session, "running", `auto compact · ${autoCompact.beforeTokens} -> ${autoCompact.afterTokens}`);
        refreshRuntimeView();
      }

      const attachmentsForTurn = pendingImageAttachments;
      beginGoalTurn(session);
      const result = await executeProviderRequest({
        session,
        prompt,
        ...(attachmentsForTurn.length > 0 ? { attachments: attachmentsForTurn } : {}),
      });
      if (result.ok) {
        const btwExchange = completeBtwTurn(session, result.output);
        if (btwExchange) {
          savePersistedRuntimeState(session);
          recordRuntimeEvent(session, {
            kind: "assistant",
            status: "completed",
            summary: "btw response captured",
            detail: btwExchange.saved ? `saved note: ${btwExchange.question}` : btwExchange.question,
          });
        } else {
          recordConversationTurn(session, "user", display.transcriptPrompt ?? prompt);
          recordConversationTurn(session, "assistant", result.output);
        }
        recordTurnTelemetry(session, prompt, result.output);
        goalContinuation = completeGoalTurn(session, prompt, result.output);
        checkpointNexsightSession(session, "turn");
        const boomerangSummary = completeBoomerang(session, result.output);
        if (boomerangSummary) {
          recordRuntimeEvent(session, {
            kind: "compact",
            status: "completed",
            summary: "boomerang summary captured",
            detail: summarizeBoomerangEvent(boomerangSummary),
          });
        }
        setRuntimeAction(session, "ready", `response received · ${result.provider}`);
        setShellNotice(`response received · ${result.provider}`);
        if (attachmentsForTurn.length > 0) {
          clearPendingAttachment(true);
        }
        return;
      }

      setRuntimeAction(session, "error", result.message);
      cancelBoomerang(session);
      cancelBtwTurn(session);
      recordRuntimeEvent(session, {
        kind: "provider",
        status: "failed",
        summary: `${result.provider} response failed`,
        detail: result.detail,
      });
      recordRuntimeEvent(session, {
        kind: "assistant",
        status: "failed",
        summary: result.message,
        detail: `${result.message}\n${result.detail}`,
      });
      setShellNotice(result.message);
      if (attachmentsForTurn.length > 0) {
        clearPendingAttachment(true);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRuntimeAction(session, "error", message);
      cancelBoomerang(session);
      cancelBtwTurn(session);
      recordRuntimeEvent(session, {
        kind: "provider",
        status: "failed",
        summary: "provider request failed",
        detail: message,
      });
      recordRuntimeEvent(session, {
        kind: "assistant",
        status: "failed",
        summary: "provider request failed",
        detail: message,
      });
      setShellNotice("provider request failed");
    } finally {
      providerRunningRef.current = false;
      refreshRuntimeView();
      const nextGoalTurn = goalContinuation;
      if (nextGoalTurn && mountedRef.current) {
        setTimeout(() => {
          void submitProviderPrompt(nextGoalTurn.prompt, {
            transcriptPrompt: nextGoalTurn.transcriptPrompt,
            promptSummary: nextGoalTurn.promptSummary,
          });
        }, 0);
      }
    }
  }

  function refreshRuntimeView(): void {
    if (!session || !mountedRef.current) {
      return;
    }
    setRuntimeView(createOpenTuiRuntimeView(session));
  }

  function scheduleRuntimeViewRefresh(delayMs: number): void {
    if (!session || !mountedRef.current || refreshTimerRef.current) {
      return;
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      refreshRuntimeView();
    }, delayMs);
  }

  function recordCommandOutputEvent(input: string, result: RuntimeCommandResult): void {
    if (!session) {
      return;
    }
    const detail = result.ok ? result.output : result.message;
    recordRuntimeEvent(session, {
      kind: "command",
      status: result.ok ? "completed" : "failed",
      summary: result.activity,
      detail: detail.trim() || result.activity || input.trim(),
    });
    refreshRuntimeView();
  }

  function handleAskKeyboardKey(key: OpenTuiKeyEvent): boolean {
    const request = session?.operationControls.pendingQuestionnaire ?? null;
    const question = currentAskQuestion(request);
    if (!request || !question) {
      return false;
    }
    if (key.name === "up") {
      setAskSelectedIndex((current) => (current - 1 + question.options.length) % question.options.length);
      setShellNotice("ask select");
      return true;
    }
    if (key.name === "down" || key.name === "tab") {
      setAskSelectedIndex((current) => (current + 1) % question.options.length);
      setShellNotice("ask select");
      return true;
    }
    if (key.name === "enter" || key.name === "return") {
      submitAskOption(askSelectedIndex);
      return true;
    }
    if (key.name === "escape") {
      submitPrompt("/ask cancel");
      return true;
    }
    const digit = key.sequence.match(/^[1-4]$/)?.[0] ?? key.name.match(/^[1-4]$/)?.[0];
    if (digit) {
      submitAskOption(Number.parseInt(digit, 10) - 1);
      return true;
    }
    return false;
  }

  function submitAskOption(optionIndex: number): void {
    const request = session?.operationControls.pendingQuestionnaire ?? null;
    const question = currentAskQuestion(request);
    if (!request || !question) {
      setShellNotice("ask unavailable");
      return;
    }
    const clamped = Math.max(0, Math.min(question.options.length - 1, optionIndex));
    submitPrompt(`/ask ${String(clamped + 1)}`);
    setAskSelectedIndex(0);
  }

  function handleAskOptionClick(optionIndex: number, event: OpenTuiMouseLikeEvent): void {
    setAskSelectedIndex(optionIndex);
    submitAskOption(optionIndex);
    event.stopPropagation();
    event.preventDefault();
  }

  function moveConfigSelection(delta: number): void {
    const selectableIndexes = configPanelRows
      .map((row, index) => row.selectable ? index : -1)
      .filter((index) => index >= 0);
    if (selectableIndexes.length === 0) {
      return;
    }
    setConfigSelectedIndex((current) => {
      const currentPosition = selectableIndexes.includes(current)
        ? selectableIndexes.indexOf(current)
        : 0;
      const nextPosition = (currentPosition + delta + selectableIndexes.length) % selectableIndexes.length;
      return selectableIndexes[nextPosition] ?? selectableIndexes[0] ?? 0;
    });
    setShellNotice("config select");
  }

  function applyConfigSelection(): void {
    const row = configPanelRows[configSelectedIndex];
    if (!row?.action || !session) {
      setShellNotice("config action unavailable");
      return;
    }
    const result = runRuntimeCommand(session, row.action);
    if (result) {
      recordCommandOutputEvent(row.action, result);
      setShellNotice(result.activity);
    }
  }

  function handleConfigRowClick(row: ConfigPanelRow, event: OpenTuiMouseLikeEvent): void {
    const rowIndex = configPanelRows.findIndex((candidate) => candidate.key === row.key);
    if (rowIndex >= 0) {
      const wasSelected = rowIndex === configSelectedIndex;
      setConfigSelectedIndex(rowIndex);
      if (wasSelected && row.action && session) {
        const result = runRuntimeCommand(session, row.action);
        if (result) {
          recordCommandOutputEvent(row.action, result);
          setShellNotice(result.activity);
        }
      } else {
        setShellNotice(row.action ? `config action · ${row.action}` : "config selected");
      }
    }
    event.stopPropagation();
    event.preventDefault();
  }

  function formatActiveSkillTranscriptPrompt(currentSession: RuntimeSession): string {
    const skill = currentSession.activeSkill;
    if (!skill) {
      return "skill -> selected";
    }
    return `skill -> ${skill.name}${skill.args && skill.args !== "(none)" ? ` ${skill.args}` : ""}`;
  }

  function updateTranscriptState(event: Parameters<typeof handleOpenTuiTranscriptEvent>[1]): void {
    setTranscriptState((current) => handleOpenTuiTranscriptEvent(current, event));
  }

  function handleTranscriptMouse(event: OpenTuiMouseLikeEvent): void {
    if (event.type === "scroll") {
      handleTranscriptMouseScroll(event);
    }
  }

  function handleTranscriptMouseScroll(event: OpenTuiMouseLikeEvent): void {
    const direction = event.scroll?.direction;
    const legacyButton = event.button;
    const delta = direction === "up" || legacyButton === 4 ? -MOUSE_SCROLL_LINES : MOUSE_SCROLL_LINES;
    updateTranscriptState({ kind: "scroll-lines", delta, metrics: transcriptMetrics });
    event.stopPropagation();
    event.preventDefault();
  }

  function handleTranscriptRowClick(row: TranscriptRenderRow, event: OpenTuiMouseLikeEvent): void {
    updateTranscriptState({ kind: "set-selected-block", index: row.blockIndex, metrics: transcriptMetrics });
    if (row.canToggle) {
      updateTranscriptState({ kind: "toggle-block", blockId: row.blockId });
    }
    event.stopPropagation();
    event.preventDefault();
  }

  function handleTraceProgressRowClick(row: TraceProgressRow, event: OpenTuiMouseLikeEvent): void {
    if (row.canToggle) {
      setTraceProgressPaletteKey((current) => current === row.toggleKey ? null : row.toggleKey);
      setTraceDetailScrollOffset(0);
      setShellNotice(row.canToggle ? "trace detail palette" : "trace row selected");
    }
    event.stopPropagation();
    event.preventDefault();
  }

  function handleAttachmentClearClick(event: OpenTuiMouseLikeEvent): void {
    clearPendingAttachment();
    event.stopPropagation();
    event.preventDefault();
  }

  function handleTraceDetailPaletteMouse(event: OpenTuiMouseLikeEvent): void {
    if (event.type === "scroll") {
      handleTraceDetailPaletteMouseScroll(event);
    }
  }

  function handleTraceDetailPaletteMouseScroll(event: OpenTuiMouseLikeEvent): void {
    const direction = event.scroll?.direction;
    const legacyButton = event.button;
    const delta = direction === "up" || legacyButton === 4 ? -MOUSE_SCROLL_LINES : MOUSE_SCROLL_LINES;
    scrollTraceDetailPalette(delta);
    event.stopPropagation();
    event.preventDefault();
  }

  function closeTraceDetailPalette(): void {
    setTraceProgressPaletteKey(null);
    setTraceDetailScrollOffset(0);
    setShellNotice("trace detail closed");
  }

  function scrollTraceDetailPalette(delta: number): void {
    const lineCount = activeTraceProgressRow ? traceDetailContentLines(activeTraceProgressRow).length : 0;
    const maxOffset = Math.max(0, lineCount - traceDetailVisibleRows);
    setTraceDetailScrollOffset((current) => Math.max(0, Math.min(maxOffset, current + delta)));
    setShellNotice("trace detail scroll");
  }

  function copySelectedText(): void {
    const text = renderer.getSelection()?.getSelectedText() ?? "";
    if (!text.trim()) {
      setShellNotice("no text selection");
      return;
    }
    const copied = copyTextToClipboard(text);
    setShellNotice(copied ? copyNotice(text) : "copy unavailable");
  }

  function copyLatestResultBlock(): void {
    const selectedBlock = [...transcriptBlocks]
      .reverse()
      .find((block) => block.kind === "assistant" || block.kind === "result");
    const text = selectedBlock ? blockTextForFullCopy(selectedBlock) : "";
    if (!text.trim()) {
      setShellNotice("nothing selected to copy");
      return;
    }
    const copied = copyTextToClipboard(text);
    setShellNotice(copied ? copyNotice(text) : "copy unavailable");
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

interface TraceProgressRow {
  key: string;
  text: string;
  fg: string;
  toggleKey: string;
  canToggle: boolean;
  detailLines: string[];
}

interface ConfigPanelRow {
  key: string;
  text: string;
  fg: string;
  selectable?: boolean;
  action?: string;
}

function flattenTranscriptBlocks(blocks: OpenTuiTranscriptBlock[], state: OpenTuiTranscriptState, width: number): TranscriptRenderRow[] {
  return blocks.flatMap((block, blockIndex) => {
    const selected = blockIndex === state.selectedBlockIndex;
    const expanded = isBlockExpanded(state, block.id, block.collapsedByDefault);
    const detailAvailable = block.detailLines.length > block.summaryLines.length || block.collapsedByDefault;
    const rawLines = expanded ? block.detailLines : block.summaryLines;
    const lines = block.kind === "assistant" || block.kind === "result"
      ? renderMarkdownDisplayLines(rawLines)
      : rawLines;
    if (!expanded && isCompactTranscriptBlock(block.kind)) {
      const compactLabel = compactTranscriptBlockLabel(block);
      const compactIcon = compactTranscriptBlockIcon(block);
      const compactPrefix = compactIcon ? `${compactIcon} ` : "";
      return [createTranscriptRenderRow({
        key: `${block.id}-compact`,
        text: fitLine(`${selected ? "> " : "  "}${compactPrefix}${compactLabel}${detailAvailable ? " [+]" : ""}`, width),
        fg: selected ? "#8bd5ff" : transcriptBlockAccent(block.kind),
        block,
        blockIndex,
        isLabel: true,
        canToggle: detailAvailable,
      })];
    }
    const frameTitle = `${transcriptBlockDisplayLabel(block)}${detailAvailable ? (expanded ? " [-]" : " [+]") : ""}`;
    const fg = transcriptBlockAccent(block.kind);
    const bodyFg = transcriptBlockBodyColor(block.kind);
    const innerWidth = Math.max(12, width - 6);
    const top = `${selected ? "> " : "  "}${frameTop(` ${frameTitle} `, innerWidth)}`;
    const bottom = `  ${frameBottom(innerWidth)}`;
    return [
      createTranscriptRenderRow({
        key: `${block.id}-label`,
        text: fitFrameLine(top, width),
        fg: selected ? "#8bd5ff" : fg,
        block,
        blockIndex,
        isLabel: true,
        canToggle: detailAvailable,
      }),
      ...lines.flatMap((line, lineIndex) => wrapOpenFrameBodyRows(line, innerWidth).map((wrappedLine, wrapIndex) => createTranscriptRenderRow({
        key: `${block.id}-${String(lineIndex)}-${String(wrapIndex)}`,
        text: fitFrameLine(`    ${wrappedLine}`, width),
        fg: transcriptLineColor(line, bodyFg),
        block,
        blockIndex,
        isLabel: false,
        canToggle: detailAvailable,
      }))),
      createTranscriptRenderRow({
        key: `${block.id}-bottom`,
        text: fitFrameLine(bottom, width),
        fg,
        block,
        blockIndex,
        isLabel: false,
        canToggle: detailAvailable,
      }),
    ];
  });
}

function renderTraceProgressRows(blocks: OpenTuiTranscriptBlock[], width: number): TraceProgressRow[] {
  return renderTraceProgressEventRows(blocks.flatMap((block) => block.detailLines), width);
}

function markActiveTraceProgressRow(rows: TraceProgressRow[], activeKey: string | null, width: number): TraceProgressRow[] {
  if (!activeKey) {
    return rows;
  }
  return rows.map((row) => {
    if (row.key !== activeKey || !row.canToggle) {
      return row;
    }
    return {
      ...row,
      text: fitLine(row.text.replace(/ \[\+\]$/, " [-]"), width),
    };
  });
}

function limitTraceProgressRows(rows: TraceProgressRow[], width: number, maxRows: number): TraceProgressRow[] {
  if (rows.length <= maxRows) {
    return rows;
  }
  const headCount = Math.min(3, Math.max(1, Math.floor(maxRows / 4)));
  const tailCount = Math.max(1, maxRows - headCount - 1);
  return [
    ...rows.slice(0, headCount),
    {
      key: "trace-progress-overflow",
      text: fitLine(`  ... ${String(rows.length - headCount - tailCount)} older progress events`, width),
      fg: "#6c7086",
      toggleKey: "trace-progress-overflow",
      canToggle: false,
      detailLines: [],
    },
    ...rows.slice(rows.length - tailCount),
  ];
}

function renderTraceProgressEventRows(lines: string[], width: number): TraceProgressRow[] {
  const rows: TraceProgressRow[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const detailLines: string[] = [];
    while (lines[index + 1]?.startsWith("  ")) {
      detailLines.push(lines[index + 1] ?? "");
      index += 1;
    }
    const row = parseTraceProgressLine(line, detailLines, width);
    if (!row) {
      continue;
    }
    rows.push(row);
  }
  return rows;
}

function parseTraceProgressLine(line: string, detailLines: string[], width: number): TraceProgressRow | null {
  const parsed = parseTraceProgressEvent(line, detailLines);
  if (!parsed) {
    return null;
  }
  const { kind, status, summary } = parsed;
  const statusMark = status === "completed" ? "ok"
    : status === "failed" || status === "blocked" ? "!"
      : status === "started" ? ">"
        : "-";
  const compactSummary = formatTraceProgressSummary(kind, status, summary, line);
  const metrics = formatTraceProgressMetricBadge(detailLines);
  const key = `trace-progress-${parsed.at ?? line}-${kind}-${status}-${summary}`;
  const hasDetail = detailLines.length > 0;
  const suffix = hasDetail ? " [+]" : "";
  const fg = status === "failed" || status === "blocked" ? "#f38ba8"
    : kind === "tool" ? "#89b4fa"
      : kind === "assistant" || kind === "provider" ? "#cba6f7"
        : "#a6adc8";
  return {
    key,
    text: fitLine(`${statusMark} ${compactSummary}${metrics ? ` · ${metrics}` : ""}${suffix}`, width),
    fg,
    toggleKey: key,
    canToggle: hasDetail,
    detailLines,
  };
}

function parseTraceProgressEvent(
  line: string,
  detailLines: string[],
): { at: string | null; kind: string; status: string; summary: string } | null {
  const parts = line.split(" | ");
  if (parts.length >= 4 && /^\d{4}-\d{2}-\d{2}T/.test(parts[0] ?? "")) {
    return {
      at: parts[0] ?? null,
      kind: parts[1] ?? "event",
      status: parts[2] ?? "queued",
      summary: parts.slice(3).join(" | "),
    };
  }
  const metadata = detailLines.find((detailLine) => /\bat\s+\d{4}-\d{2}-\d{2}T.*\bkind\s+\w+.*\bstatus\s+\w+/.test(detailLine));
  const metaMatch = metadata?.match(/\bat\s+(\S+)\s+·\s+kind\s+(\w+)\s+·\s+status\s+(\w+)/);
  if (!metaMatch) {
    return null;
  }
  return {
    at: metaMatch[1] ?? null,
    kind: metaMatch[2] ?? "event",
    status: metaMatch[3] ?? "queued",
    summary: line.replace(/^[^\p{L}\p{N}]+/u, "").trim(),
  };
}

function formatTraceProgressMetricBadge(detailLines: string[]): string {
  const detail = detailLines.map((line) => line.trim()).join("; ");
  const duration = readTraceProgressMetric(detail, "duration");
  const inputTokens = readTraceProgressMetric(detail, "turn_in") ?? readTraceProgressMetric(detail, "in");
  const outputTokens = readTraceProgressMetric(detail, "turn_out") ?? readTraceProgressMetric(detail, "out");
  return [
    duration,
    inputTokens ? `↓ ${inputTokens}` : null,
    outputTokens ? `↑ ${outputTokens}` : null,
  ].filter((value): value is string => Boolean(value)).join(" ");
}

function readTraceProgressMetric(detail: string, key: "duration" | "in" | "out" | "turn_in" | "turn_out"): string | null {
  const separator = key === "duration" ? "=" : "~";
  const match = new RegExp(`(?:^|[;\\s])${key}${separator}([^;\\s]+)`).exec(detail);
  return match?.[1] ?? null;
}

function traceDetailContentLines(row: TraceProgressRow): string[] {
  const title = row.text.replace(/ \[[+-]\]$/, "").replace(/^[!>ok -]+\s*/, "").trim();
  const metadata = readTraceMetadata(row.detailLines);
  const bodyLines = row.detailLines
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isTraceMetadataLine(line));
  const reason = bodyLines.find((line) => !/^(duration|class|severity|turn_in|turn_out|in|out)=/.test(line));
  const metricLine = formatTraceDetailMetrics(row.detailLines);
  const impact = metadata.status === "failed" || metadata.status === "blocked"
    ? "Turn needs attention before result can be trusted"
    : metadata.status === "completed"
      ? "Event completed"
      : "Event still in progress";
  const next = metadata.status === "failed" || metadata.status === "blocked"
    ? "Open related transcript block, then rerun focused command after fix"
    : "No action needed unless output looks wrong";
  const lines = [
    `Issue   ${title || "runtime event"}`,
    metadata.when ? `When    ${metadata.when}` : null,
    metadata.kind || metadata.status ? `Type    ${[metadata.kind, metadata.status].filter(Boolean).join(" · ")}` : null,
    metricLine ? `Stats   ${metricLine}` : null,
    `Impact  ${impact}`,
    reason ? `Reason  ${reason}` : null,
    `Next    ${next}`,
  ].filter((line): line is string => Boolean(line));
  const extra = bodyLines.filter((line) => line !== reason).slice(0, 8);
  if (extra.length > 0) {
    lines.push("Details");
    lines.push(...extra.map((line) => `  ${line}`));
  }
  return lines;
}

function readTraceMetadata(detailLines: string[]): { when: string | null; kind: string | null; status: string | null } {
  const metadata = detailLines.find((line) => isTraceMetadataLine(line));
  const match = metadata?.match(/\bat\s+(\S+)\s+·\s+kind\s+(\w+)\s+·\s+status\s+(\w+)/);
  return {
    when: match?.[1] ? formatTraceTimestamp(match[1]) : null,
    kind: match?.[2] ?? null,
    status: match?.[3] ?? null,
  };
}

function isTraceMetadataLine(line: string): boolean {
  return /\bat\s+\d{4}-\d{2}-\d{2}T.*\bkind\s+\w+.*\bstatus\s+\w+/.test(line);
}

function formatTraceTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatTraceDetailMetrics(detailLines: string[]): string | null {
  const detail = detailLines.map((line) => line.trim()).join("; ");
  const parts = [
    readTraceProgressMetric(detail, "duration") ? `duration ${readTraceProgressMetric(detail, "duration")}` : null,
    readTraceProgressMetric(detail, "turn_in") ?? readTraceProgressMetric(detail, "in")
      ? `in ${readTraceProgressMetric(detail, "turn_in") ?? readTraceProgressMetric(detail, "in")}`
      : null,
    readTraceProgressMetric(detail, "turn_out") ?? readTraceProgressMetric(detail, "out")
      ? `out ${readTraceProgressMetric(detail, "turn_out") ?? readTraceProgressMetric(detail, "out")}`
      : null,
  ];
  return parts.filter((part): part is string => Boolean(part)).join(" · ") || null;
}

function renderTraceDetailPaletteRows(options: {
  width: number;
  row: TraceProgressRow;
  scrollOffset: number;
  visibleRows: number;
}): Array<{ key: string; text: string; fg: string }> {
  const innerWidth = Math.max(12, options.width - 4);
  const contentLines = traceDetailContentLines(options.row);
  const maxOffset = Math.max(0, contentLines.length - options.visibleRows);
  const scrollOffset = Math.max(0, Math.min(maxOffset, options.scrollOffset));
  const visibleLines = contentLines.slice(scrollOffset, scrollOffset + options.visibleRows);
  const paddedLines = Array.from({ length: options.visibleRows }, (_, index) => visibleLines[index] ?? "");
  const footer = contentLines.length > options.visibleRows
    ? `${String(scrollOffset + 1)}-${String(Math.min(contentLines.length, scrollOffset + options.visibleRows))}/${String(contentLines.length)} · wheel/PageUp/PageDown · Esc close`
    : "Esc close";
  return [
    { key: "trace-detail-top", text: frameTop(" Event detail ", innerWidth), fg: "#89b4fa" },
    ...paddedLines.map((line, index) => ({
      key: `trace-detail-row-${String(scrollOffset)}-${String(index)}`,
      text: frameBody(line, innerWidth),
      fg: index === 0 && scrollOffset === 0 ? options.row.fg : "#cdd6f4",
    })),
    { key: "trace-detail-footer", text: frameBody(footer, innerWidth), fg: "#a6adc8" },
    { key: "trace-detail-bottom", text: frameBottom(innerWidth), fg: "#89b4fa" },
  ].map((row) => ({ ...row, text: fitFrameLine(row.text, options.width) }));
}

function formatTraceProgressSummary(kind: string, status: string, summary: string, sourceLine?: string): string {
  if (sourceLine && !sourceLine.includes(" | ")) {
    return summary;
  }
  if (kind === "tool") {
    const toolName = summary
      .replace(/^tool\s+/, "")
      .replace(/\s+(started|completed|failed|blocked)$/i, "");
    return `tool ${toolName} ${status}`;
  }
  if (kind === "prompt") {
    return `prompt ${status} · ${summary}`;
  }
  return `${kind} ${status} · ${summary}`;
}

function createTranscriptRenderRow(options: {
  key: string;
  text: string;
  fg?: string;
  block: OpenTuiTranscriptBlock;
  blockIndex: number;
  isLabel: boolean;
  canToggle: boolean;
}): TranscriptRenderRow {
  return {
    key: options.key,
    text: options.text,
    fg: options.fg,
    blockId: options.block.id,
    blockIndex: options.blockIndex,
    isLabel: options.isLabel,
    canToggle: options.canToggle,
  };
}

function blockTextForFullCopy(block: OpenTuiTranscriptBlock): string {
  return [`${block.label}:`, ...block.detailLines].join("\n");
}

function copyNotice(text: string): string {
  return `${COPIED_RESULTS_NOTICE} (${String(text.length)} chars)`;
}

function copyTextToClipboard(text: string): boolean {
  const nativeCommands: ReadonlyArray<{ cmd: string; args: string[] }> = [
    { cmd: "pbcopy", args: [] },
    { cmd: "wl-copy", args: [] },
    { cmd: "xclip", args: ["-selection", "clipboard"] },
    { cmd: "xsel", args: ["--clipboard", "--input"] },
    { cmd: "clip.exe", args: [] },
  ];
  const windowsCommands = createWindowsClipboardCommands([
    "[Console]::InputEncoding=[System.Text.UTF8Encoding]::new($false)",
    "$ErrorActionPreference='SilentlyContinue'",
    "$value = [Console]::In.ReadToEnd()",
    "for ($i = 0; $i -lt 6; $i++) {",
    "  try { Set-Clipboard -Value $value; exit 0 } catch {}",
    "  try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetText($value, [System.Windows.Forms.TextDataFormat]::UnicodeText); exit 0 } catch {}",
    "  Start-Sleep -Milliseconds 80",
    "}",
    "exit 1",
  ].join("\n"), { sta: true });
  const clipboardCommands = isProbablyWsl()
    ? [...windowsCommands, ...nativeCommands]
    : [...nativeCommands, ...windowsCommands];

  for (const candidate of clipboardCommands) {
    try {
      execFileSync(candidate.cmd, candidate.args, {
        input: text,
        encoding: "utf8",
        stdio: ["pipe", "ignore", "ignore"],
        timeout: 1000,
      });
      return true;
    } catch {
      // Try next clipboard transport.
    }
  }

  return copyTextToClipboardOsc52(text);
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

function readClipboardText(): string {
  const nativeCommands: ReadonlyArray<{ cmd: string; args: string[] }> = [
    { cmd: "pbpaste", args: [] },
    { cmd: "wl-paste", args: ["--no-newline"] },
    { cmd: "xclip", args: ["-selection", "clipboard", "-o"] },
    { cmd: "xsel", args: ["--clipboard", "--output"] },
  ];
  const windowsCommands = createWindowsClipboardCommands([
    "[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)",
    "$ErrorActionPreference='SilentlyContinue'",
    "function Write-ClipboardValue($value) {",
    "  if ($null -ne $value -and [string]$value -ne '') { [Console]::Out.Write([string]$value); exit 0 }",
    "}",
    "for ($i = 0; $i -lt 6; $i++) {",
    "  try { Write-ClipboardValue (Get-Clipboard -Raw -Format Text) } catch {}",
    "  try { Write-ClipboardValue (Get-Clipboard -Raw) } catch {}",
    "  try { Add-Type -AssemblyName System.Windows.Forms; if ([System.Windows.Forms.Clipboard]::ContainsText()) { Write-ClipboardValue ([System.Windows.Forms.Clipboard]::GetText([System.Windows.Forms.TextDataFormat]::UnicodeText)) } } catch {}",
    "  Start-Sleep -Milliseconds 80",
    "}",
    "exit 0",
  ].join("\n"), { sta: true });
  const clipboardCommands = isProbablyWsl()
    ? [...windowsCommands, ...nativeCommands]
    : [...nativeCommands, ...windowsCommands];

  for (const candidate of clipboardCommands) {
    try {
      const text = execFileSync(candidate.cmd, candidate.args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 256 * 1024,
        timeout: 1500,
      });
      if (text.trim().length > 0) {
        return text.length > 24_000 ? text.slice(0, 24_000) : text;
      }
    } catch {
      // Try next clipboard transport.
    }
  }

  return "";
}

function createWindowsClipboardCommands(
  script: string,
  options: { sta?: boolean } = {},
): ReadonlyArray<{ cmd: string; args: string[] }> {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const args = ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded];
  const staArgs = options.sta
    ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-Sta", "-EncodedCommand", encoded]
    : args;
  return [
    { cmd: "powershell.exe", args: staArgs },
    { cmd: "pwsh.exe", args },
    { cmd: "pwsh", args },
    { cmd: "/mnt/c/WINDOWS/System32/WindowsPowerShell/v1.0/powershell.exe", args: staArgs },
    { cmd: "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe", args: staArgs },
  ];
}

function isProbablyWsl(): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  if (process.env.WSL_DISTRO_NAME || process.env.WSL_INTEROP) {
    return true;
  }
  try {
    return readFileSync("/proc/version", "utf8").toLowerCase().includes("microsoft");
  } catch {
    return false;
  }
}

function formatAttachmentListLabel(attachments: readonly ImageAttachment[]): string {
  return attachments
    .map((attachment, index) => `${formatAttachmentChip(index + 1, attachment)}`)
    .join(" ");
}

function formatAttachmentChip(index: number, attachment: ImageAttachment): string {
  return `[Image #${String(index)}] (${formatAttachmentSize(attachment.bytes)})`;
}

function formatAttachmentSize(value: number): string {
  if (value < 1024) {
    return `${String(value)}B`;
  }
  const kib = value / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)}KB`;
  }
  return `${(kib / 1024).toFixed(1)}MB`;
}

function formatOpenTuiExtensionCommandOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (output === undefined || output === null) {
    return "ok";
  }
  if (typeof output === "object" && "message" in output && typeof (output as { message?: unknown }).message === "string") {
    return (output as { message: string }).message;
  }
  return JSON.stringify(output, null, 2);
}

function renderComposerPromptRows(composer: OpenTuiComposerState, width: number): string[] {
  const attachmentPrefix = composer.attachment?.supported ? `${composer.attachment.label} ` : "";
  if (composer.text.length === 0) {
    return [fitLine(`> ${attachmentPrefix}${COMPOSER_CURSOR}`, width)];
  }
  const rendered = renderComposerLine(composer, width, attachmentPrefix);
  return rendered.split("\n").slice(-COMPOSER_VISIBLE_PROMPT_ROWS);
}

function currentAskQuestion(
  request: RuntimeSession["operationControls"]["pendingQuestionnaire"],
): NonNullable<RuntimeSession["operationControls"]["pendingQuestionnaire"]>["questions"][number] | null {
  if (!request) {
    return null;
  }
  const nextIndex = request.questions.findIndex((_, index) =>
    !request.answers.some((answer) => answer.questionIndex === index)
  );
  const questionIndex = nextIndex >= 0 ? nextIndex : 0;
  return request.questions[questionIndex] ?? null;
}

function createAskPanel(
  request: RuntimeSession["operationControls"]["pendingQuestionnaire"],
  selectedIndex: number,
  width: number,
): { width: number; rows: Array<{ key: string; text: string; fg: string; optionIndex?: number }> } | null {
  if (!request) {
    return null;
  }
  const nextIndex = request.questions.findIndex((_, index) =>
    !request.answers.some((answer) => answer.questionIndex === index)
  );
  const questionIndex = nextIndex >= 0 ? nextIndex : 0;
  const question = request.questions[questionIndex];
  if (!question) {
    return { width, rows: [{
      key: "ask-pending",
      text: "ask: pending question - /ask status",
      fg: "#f9e2af",
    }] };
  }

  const answered = request.answers.length > 0 ? ` · answered ${String(request.answers.length)}/${String(request.questions.length)}` : "";
  const safeSelected = Math.max(0, Math.min(question.options.length - 1, selectedIndex));
  const rows: Array<{ key: string; text: string; fg: string; optionIndex?: number }> = [
    {
      key: "ask-title",
      text: frameTop(` ask ${String(questionIndex + 1)}/${String(request.questions.length)} ${question.header}${answered} `, Math.max(12, width - 4)),
      fg: "#f9e2af",
    },
    {
      key: "ask-question",
      text: frameBody(question.question, Math.max(12, width - 4)),
      fg: "#ffffff",
    },
  ];
  for (const [index, option] of question.options.entries()) {
    const selected = index === safeSelected;
    rows.push({
      key: `ask-option-${String(index)}`,
      text: frameBody(`${selected ? ">" : " "} ${String(index + 1)}. ${option.label} - ${option.description}`, Math.max(12, width - 4)),
      fg: selected ? "#a6e3a1" : "#cdd6f4",
      optionIndex: index,
    });
  }
  rows.push({
    key: "ask-help",
    text: frameBody("Up/Down select · Enter choose · 1-4 quick · Esc cancel · type custom if needed", Math.max(12, width - 4)),
    fg: "#a6adc8",
  });
  rows.push({
    key: "ask-bottom",
    text: frameBottom(Math.max(12, width - 4)),
    fg: "#f9e2af",
  });
  return { width, rows: rows.map((row) => ({ ...row, text: fitFrameLine(row.text, width) })) };
}

function composerPanelHeight(promptRowCount: number, hasAttachment: boolean): number {
  return 5 + promptRowCount + (hasAttachment ? 1 : 0);
}

function renderTodoStatusRows(
  todoRows: Array<{ key: string; text: string; fg: string }>,
  width: number,
): Array<{ key: string; text: string; fg: string }> {
  if (todoRows.length === 0) {
    return [];
  }
  return [
    { key: "todo-status-divider", text: fitLine("─".repeat(Math.max(0, width)), width), fg: "#6c7086" },
    ...todoRows.map((row) => ({
      key: `todo-status-${row.key}`,
      text: fitLine(row.text, width),
      fg: row.fg,
    })),
  ];
}

function renderComposerLine(composer: OpenTuiComposerState, width: number, attachmentPrefix = ""): string {
  const cursorIndex = Math.max(0, Math.min(composer.text.length, composer.cursorIndex));
  const withCursor = `${composer.text.slice(0, cursorIndex)}${COMPOSER_CURSOR}${composer.text.slice(cursorIndex)}`;
  return withCursor
    .split("\n")
    .map((line, index) => fitLine(`${index === 0 ? `> ${attachmentPrefix}` : "  "}${line}`, width))
    .join("\n");
}

function renderComposerPanelRows(options: {
  width: number;
  attachmentLine: string | null;
  attachmentSupported: boolean;
  extensionRows?: Array<{ key: string; text: string; fg?: string }>;
  promptLines: string[];
  previewLine: string;
  statusLine: string;
}): Array<{ key: string; text: string; fg: string }> {
  const innerWidth = Math.max(12, options.width - 4);
  const rows: Array<{ key: string; text: string; fg: string }> = [
    { key: "composer-top", text: frameTop(" composer ", innerWidth), fg: "#ffffff" },
  ];
  if (options.attachmentLine) {
    rows.push({
      key: "composer-attachment",
      text: frameBody(options.attachmentLine, innerWidth),
      fg: options.attachmentSupported ? "#f9e2af" : "#f38ba8",
    });
  }
  for (const row of options.extensionRows ?? []) {
    rows.push({
      key: row.key,
      text: frameBody(row.text, innerWidth),
      fg: row.fg ?? "#f9e2af",
    });
  }
  rows.push(
    ...options.promptLines.map((line, index) => ({
      key: `composer-prompt-${String(index)}`,
      text: frameBody(line, innerWidth),
      fg: "#ffffff",
    })),
    { key: "composer-preview", text: frameBody(options.previewLine, innerWidth), fg: "#a6adc8" },
    { key: "composer-status", text: frameBody(options.statusLine, innerWidth), fg: "#a6adc8" },
    { key: "composer-bottom", text: frameBottom(innerWidth), fg: "#ffffff" },
  );
  return rows.map((row) => ({ ...row, text: fitFrameLine(row.text, options.width) }));
}

function frameTop(title: string, innerWidth: number): string {
  const safeTitle = title.length > innerWidth ? title.slice(0, innerWidth) : title;
  return `╭${safeTitle}${"─".repeat(Math.max(0, innerWidth - safeTitle.length + 2))}╮`;
}

function frameBottom(innerWidth: number): string {
  return `╰${"─".repeat(innerWidth + 2)}╯`;
}

function frameBody(line: string, innerWidth: number): string {
  return `│ ${fitLine(line, innerWidth).padEnd(innerWidth)} │`;
}

function wrapOpenFrameBodyRows(line: string, innerWidth: number): string[] {
  return wrapPlainLine(line, innerWidth + 2).map((part) => part);
}

function transcriptBlockDisplayLabel(block: OpenTuiTranscriptBlock): string {
  if (block.kind === "user") {
    return "user";
  }
  if (block.kind === "assistant") {
    return "agent";
  }
  return block.label;
}

function isCompactTranscriptBlock(kind: OpenTuiTranscriptBlock["kind"]): boolean {
  return kind === "tool" || kind === "skill" || kind === "trace" || kind === "system";
}

function compactTranscriptBlockIcon(block: OpenTuiTranscriptBlock): string {
  if (block.kind === "tool") {
    return "";
  }
  if (block.kind === "skill") {
    return "✦";
  }
  if (block.kind === "command") {
    return "⌘";
  }
  if (block.kind === "trace") {
    return "🔎";
  }
  if (block.kind === "system") {
    if (/failed|blocked|error/i.test(block.label)) {
      return "⚠";
    }
    if (/turn complete|completed/i.test(block.label)) {
      return "✓";
    }
    if (/compact|memory/i.test(block.label)) {
      return "🧠";
    }
    return "•";
  }
  return "•";
}

function compactToolIcon(label: string): string {
  const normalized = label.toLowerCase();
  if (/read file/.test(normalized)) {
    return "📖";
  }
  if (/write file|apply patch|batch edit|preview patch/.test(normalized)) {
    return "✎";
  }
  if (/search|find|glob|rg/.test(normalized)) {
    return "🔎";
  }
  if (/run shell|shell|command/.test(normalized)) {
    return "⚙";
  }
  if (/git/.test(normalized)) {
    return "⑂";
  }
  if (/nexsight|context|index/.test(normalized)) {
    return "◇";
  }
  if (/memory|checkpoint|archivist/.test(normalized)) {
    return "🧠";
  }
  if (/lsp/.test(normalized)) {
    return "λ";
  }
  return "🔧";
}

function compactTranscriptBlockLabel(block: OpenTuiTranscriptBlock): string {
  if (block.kind === "tool") {
    return block.label;
  }
  const first = block.summaryLines[0] ?? block.detailLines[0] ?? "";
  return first ? `${block.label} · ${first}` : block.label;
}

function transcriptBlockAccent(kind: OpenTuiTranscriptBlock["kind"]): string {
  if (kind === "user") {
    return "#ffffff";
  }
  if (kind === "skill") {
    return "#8bd5ff";
  }
  if (kind === "tool" || kind === "trace") {
    return "#89b4fa";
  }
  if (kind === "command" || kind === "system") {
    return "#a6adc8";
  }
  return "#f9e2af";
}

function transcriptBlockBodyColor(kind: OpenTuiTranscriptBlock["kind"]): string | undefined {
  if (kind === "tool" || kind === "trace") {
    return "#89b4fa";
  }
  if (kind === "user" || kind === "skill" || kind === "command" || kind === "system") {
    return "#a6adc8";
  }
  return undefined;
}

function transcriptLineColor(line: string, fallback: string | undefined): string | undefined {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "#a6e3a1";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "#f38ba8";
  }
  if (/^Edited .+ \(\+\d+ -\d+\)$/.test(line)) {
    return "#f9e2af";
  }
  if (line.startsWith("@@")) {
    return "#89b4fa";
  }
  if (line.startsWith("Index: ") || line.startsWith("===") || line.startsWith("---") || line.startsWith("+++")) {
    return "#a6adc8";
  }
  return fallback;
}

function fitFrameLine(line: string, width: number): string {
  if (line.length <= width) {
    return line;
  }
  return line.slice(0, Math.max(0, width));
}

function chatDividerLine(width: number, edge: "top" | "bottom"): string {
  const rule = "─".repeat(Math.max(0, width - 2));
  return edge === "top" ? `╭${rule}╮` : `╰${rule}╯`;
}

function wrapPlainLine(line: string, width: number): string[] {
  const maxLength = Math.max(1, width);
  const normalized = line.replace(/\t/g, "  ").trimEnd();
  if (normalized.length <= maxLength) {
    return [normalized];
  }
  const rows: string[] = [];
  let remaining = normalized;
  while (remaining.length > maxLength) {
    const slice = remaining.slice(0, maxLength + 1);
    const breakAt = Math.max(slice.lastIndexOf(" "), slice.lastIndexOf("/"), slice.lastIndexOf("-"));
    const cut = breakAt > Math.floor(maxLength * 0.45) ? breakAt + 1 : maxLength;
    rows.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) {
    rows.push(remaining);
  }
  return rows.length > 0 ? rows : [""];
}

function renderMarkdownDisplayLines(lines: string[]): string[] {
  const rendered: string[] = [];
  let inFence = false;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const fence = line.match(/^```\s*([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      inFence = !inFence;
      const language = fence[1];
      if (inFence && language) {
        rendered.push(`${language}:`);
      }
      continue;
    }
    if (inFence) {
      rendered.push(`  ${line}`);
      continue;
    }
    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading?.[1]) {
      rendered.push(heading[1]);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/);
    if (bullet?.[1]) {
      rendered.push(`• ${bullet[1]}`);
      continue;
    }
    const numbered = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (numbered?.[1] && numbered[2]) {
      rendered.push(`${numbered[1]}. ${numbered[2]}`);
      continue;
    }
    rendered.push(line.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1"));
  }
  return rendered.length > 0 ? rendered : lines;
}

function fitLine(line: string, width: number): string {
  const maxLength = Math.max(1, width);
  const singleLine = line.replace(/\s+/g, " ");
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  if (maxLength <= 3) {
    return singleLine.slice(0, maxLength);
  }
  return `${singleLine.slice(0, maxLength - 3)}...`;
}

function formatOpenTuiStatuslineProgress(spinnerTick: number, view: OpenTuiRuntimeView): string {
  if (view.status === "running") {
    return formatProgressChrome(spinnerTick, { status: view.status as RuntimeSession["action"]["status"], detail: view.detail });
  }
  const tokensTotal = view.statusline.lastInputTokens + view.statusline.lastOutputTokens;
  if (tokensTotal <= 0) {
    return "";
  }
  return formatProgressChrome(spinnerTick, { status: "running", detail: view.detail })
    .replace(" · running · ", ` · ${view.status} · `);
}

function renderLogoRows(view: OpenTuiRuntimeView, spinnerTick: number, width: number): Array<{ key: string; text: string; fg: string }> {
  if (view.logo.mode === "off") {
    return [{ key: "logo-off", text: fitLine(view.headerTitle, width), fg: "#f9e2af" }];
  }
  const frames = view.logo.frames.length > 0 ? view.logo.frames : [view.headerTitle];
  const frame = frames[Math.abs(spinnerTick) % frames.length] ?? view.headerTitle;
  const rows = [
    { key: "logo-frame", text: frame, fg: "#f9e2af" },
    { key: "logo-meta", text: view.logo.metadata, fg: "#a6adc8" },
  ];
  return rows.map((row) => ({ ...row, text: fitLine(row.text, width) }));
}

function renderConfigPanelRows(view: OpenTuiRuntimeView, width: number, selectedIndex: number): ConfigPanelRow[] {
  const innerWidth = Math.max(20, width - 4);
  const rows: ConfigPanelRow[] = [
    { key: "config-top", text: frameTop(" config ", innerWidth), fg: "#f9e2af" },
    { key: "config-subtitle", text: frameBody("↑/↓ select · Enter run · click select · Esc close", innerWidth), fg: "#a6adc8" },
  ];
  for (const section of view.configSections) {
    rows.push({
      key: `config-section-${section.title}`,
      text: frameBody(section.title.toUpperCase(), innerWidth),
      fg: "#8bd5ff",
    });
    section.rows.forEach((line, index) => {
      const action = configActionForRow(section.title, line);
      const selected = selectedIndex === rows.length;
      const prefix = action ? selected ? "> " : "  " : "  ";
      const actionHint = action ? `  (${action})` : "";
      rows.push({
        key: `config-${section.title}-${String(index)}`,
        text: frameBody(`${prefix}${line}${actionHint}`, innerWidth),
        fg: selected ? "#f9e2af" : "#cdd6f4",
        selectable: Boolean(action),
        action: action ?? undefined,
      });
    });
  }
  rows.push({ key: "config-bottom", text: frameBottom(innerWidth), fg: "#f9e2af" });
  return rows.map((row) => ({ ...row, text: fitFrameLine(row.text, width) }));
}

function renderLspProblemsPanelRows(view: OpenTuiRuntimeView, width: number): Array<{ key: string; text: string; fg: string }> {
  if (!view.lspProblems.visible) {
    return [];
  }
  const [title = "Problems", count = "", last = "", action = ""] = view.lspProblems.rows;
  return [
    { key: "lsp-problems-title", text: fitLine(`! ${title}`, width), fg: "#f9e2af" },
    { key: "lsp-problems-count", text: fitLine(count, width), fg: "#f38ba8" },
    { key: "lsp-problems-last", text: fitLine(last, width), fg: "#cdd6f4" },
    { key: "lsp-problems-action", text: fitLine(action, width), fg: "#89b4fa" },
  ];
}

function configActionForRow(section: string, line: string): string | null {
  const normalized = line.toLowerCase();
  if (section === "provider") {
    return "/provider status";
  }
  if (section === "ui") {
    if (normalized.startsWith("logo ")) {
      const current = normalized.replace(/^logo\s+/, "").trim();
      const next = current === "full" ? "condensed" : current === "condensed" ? "off" : "full";
      return `/config logo ${next}`;
    }
    if (normalized.startsWith("mouse ")) {
      return "/mouse status";
    }
    if (normalized.startsWith("statusline ")) {
      return normalized.endsWith("on") ? "/statusline off" : "/statusline on";
    }
  }
  if (section === "memory") {
    return "/memory status";
  }
  if (section === "mcp") {
    return "/tools";
  }
  if (section === "lsp") {
    if (normalized.startsWith("enabled ")) {
      return normalized.endsWith("on") ? "/config lsp off" : "/config lsp on";
    }
    if (normalized.startsWith("indexarchivist ")) {
      return normalized.endsWith("on") ? "/config lsp-index off" : "/config lsp-index on";
    }
    return "/lsp status";
  }
  if (section === "diagnostics") {
    return "/status --sentry";
  }
  return null;
}

function renderStatuslineRows(options: {
  width: number;
  progress: string;
  statusline: OpenTuiRuntimeView["statusline"];
  traceLabel: string;
  shellNotice: string;
  transcriptPosition: string;
  attachmentLabel: string | null;
}): Array<{ key: string; text: string; fg: string }> {
  const tokensTotal = options.statusline.lastInputTokens + options.statusline.lastOutputTokens;
  const memLabel = `${formatMemoryBytes(options.statusline.memoryUsedBytes)}/${formatMemoryBytes(options.statusline.memoryTotalBytes)}`;
  const gitLabel = `${options.statusline.branch}/${options.statusline.repoName}`;
  const contextBar = formatContextUsageBar(options.statusline.contextPercent, 12);
  const contextLabel = `${formatContextTokenNumber(options.statusline.contextUsed)}/${formatContextTokenNumber(options.statusline.contextWindow)}`;
  const clockLabel = formatStatuslineClock(new Date());
  const progressPrefix = options.progress ? `${options.progress} ` : "";
  const row1 = `${progressPrefix}${formatModelLabel(options.statusline.model)} · mem ${memLabel} · git ${gitLabel} · session ${options.statusline.sessionAge} · ${clockLabel}`;
  const attachmentPart = options.attachmentLabel ? ` · ${options.attachmentLabel}` : "";
  const row2 = `ctx ${contextBar} ${contextLabel} ${String(options.statusline.contextPercent)}% · tok ${formatCompactNumber(tokensTotal)} (${formatCompactNumber(options.statusline.lastInputTokens)}↓/${formatCompactNumber(options.statusline.lastOutputTokens)}↑) · ${options.transcriptPosition} · ${options.shellNotice}${attachmentPart}`;
  return [
    { key: "status-divider", text: chatDividerLine(options.width, "bottom"), fg: "#cba6f7" },
    { key: "status-row-1", text: fitLine(row1, options.width), fg: "#f9e2af" },
    { key: "status-row-2", text: fitLine(row2, options.width), fg: "#cdd6f4" },
  ];
}

function formatContextUsageBar(percent: number, width: number): string {
  const barWidth = Math.max(4, width);
  const clampedPercent = Math.max(0, Math.min(100, Math.round(percent)));
  const filled = Math.round((clampedPercent / 100) * barWidth);
  return `[${"=".repeat(filled)}${"-".repeat(barWidth - filled)}]`;
}

function formatMemoryBytes(bytes: number): string {
  const gib = bytes / (1024 ** 3);
  if (gib >= 1) {
    return `${gib.toFixed(1)}G`;
  }
  const mib = bytes / (1024 ** 2);
  if (mib >= 1) {
    return `${mib.toFixed(0)}M`;
  }
  return `${Math.max(0, bytes).toFixed(0)}B`;
}

function formatModelLabel(model: string): string {
  return model.replace(/^gpt-/i, "GPT ").replace(/-/g, " ").toUpperCase();
}

function formatCompactNumber(value: number): string {
  if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return String(value);
}

function formatContextTokenNumber(value: number): string {
  return formatCompactNumber(value);
}

function formatStatuslineClock(date: Date): string {
  let hour = date.getHours();
  const minute = date.getMinutes().toString().padStart(2, "0");
  const suffix = hour >= 12 ? "PM" : "AM";
  hour %= 12;
  if (hour === 0) {
    hour = 12;
  }
  return `${String(hour)}:${minute}${suffix}`;
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

function createPaletteDisplayRows(
  composer: OpenTuiComposerState,
  paletteRows: CommandPaletteRow[],
  visibleRows: CommandPaletteRow[],
  width: number,
): Array<{ key: string; text: string; fg: string; value?: string; rowIndex?: number }> {
  const rows = paletteRows.length > 0
    ? visibleRows.map((row, index) => ({
      key: `palette-${String(index)}-${row.selected ? "selected" : "row"}-${row.value}`,
      text: fitLine(`${row.selected ? "> " : "  "}${row.label} ${row.hint}`, width),
      fg: row.selected ? "#8bd5ff" : "#cdd6f4",
      value: row.value,
      rowIndex: paletteRows.findIndex((candidate) => candidate.value === row.value),
    }))
    : [{
      key: "palette-empty",
      text: composer.overlayMode === "history-search" ? "No history matches" : "No matches",
      fg: "#a6adc8",
    }];

  return Array.from({ length: PALETTE_VISIBLE_ROWS }, (_, index) => rows[index] ?? {
    key: `palette-blank-${String(index)}`,
    text: "",
    fg: "#a6adc8",
  });
}

function renderPalettePanelRows(options: {
  width: number;
  title: string;
  query: string;
  displayRows: Array<{ key: string; text: string; fg: string; value?: string; rowIndex?: number }>;
  footerLine: string;
}): Array<{ key: string; text: string; fg: string; value?: string; rowIndex?: number }> {
  const innerWidth = Math.max(12, options.width - 4);
  return [
    { key: "palette-top", text: frameTop(` ${options.title} `, innerWidth), fg: "#f9e2af" },
    { key: "palette-query", text: frameBody(options.query, innerWidth), fg: "#a6adc8" },
    ...options.displayRows.map((row) => ({
      key: row.key,
      text: frameBody(row.text, innerWidth),
      fg: row.fg,
      value: row.value,
      rowIndex: row.rowIndex,
    })),
    { key: "palette-footer", text: frameBody(options.footerLine, innerWidth), fg: "#a6adc8" },
    { key: "palette-bottom", text: frameBottom(innerWidth), fg: "#f9e2af" },
  ].map((row) => ({ ...row, text: fitFrameLine(row.text, options.width) }));
}

function paletteTitleForOverlay(composer: OpenTuiComposerState, commandSurfaceTitle: string): string {
  if (composer.overlayMode === "history-search") {
    return "History";
  }
  if (composer.overlayMode === "skill") {
    return "$ Skills";
  }
  return commandSurfaceTitle;
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

function renderCockpitPanelRows(options: {
  width: number;
  warningRows: OpenTuiRuntimeView["cockpit"]["warnings"];
  warningOverflow: number;
  ladder: OpenTuiRuntimeView["cockpit"]["ladder"];
  memoryRows: string[];
  overrideHints: string[];
  risk: string;
  compact: boolean;
}): string[] {
  const innerWidth = Math.max(20, options.width - 4);
  const title = " status ";
  const top = `╭${title}${"─".repeat(Math.max(0, innerWidth - title.length))}╮`;
  const bottom = `╰${"─".repeat(innerWidth + 2)}╯`;
  const warningLine = options.warningRows.length > 0
    ? options.warningRows.map((warning) => `${warning.type} ${warning.message}`).join(" | ")
    : "clear";
  const overflow = options.warningOverflow > 0 ? ` (+${String(options.warningOverflow)})` : "";
  const body = [
    `Turn      ${options.ladder.intent}`,
    `Progress  ${options.ladder.plan} -> ${options.ladder.act} -> ${options.ladder.result}`,
    `Signals   ${warningLine}${overflow}`,
    ...(options.compact ? options.memoryRows.slice(0, 1) : options.memoryRows),
    `Controls  ${options.overrideHints.join(" | ")}`,
    `State     ${options.risk}`,
  ];
  return [
    fitLine(top, options.width),
    ...body.map((line) => fitLine(`│ ${line.padEnd(innerWidth)} │`, options.width)),
    fitLine(bottom, options.width),
  ];
}
