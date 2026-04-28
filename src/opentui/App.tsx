import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useState } from "react";

import type { OpenTuiRuntimeView } from "./runtime-view.js";

export interface OpenTuiAppProps {
  view: OpenTuiRuntimeView;
  onExit: () => void;
}

export function OpenTuiApp({ view, onExit }: OpenTuiAppProps) {
  const { width, height } = useTerminalDimensions();
  const terminalWidth = width > 0 ? width : process.stdout.columns || 80;
  const terminalHeight = height > 0 ? height : process.stdout.rows || 24;
  const contentWidth = Math.max(20, terminalWidth - 2);
  const [composer, setComposer] = useState("");
  const [traceExpanded, setTraceExpanded] = useState(false);
  const [shellNotice, setShellNotice] = useState("ready");

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) {
      onExit();
      return;
    }
    if (key.ctrl && key.name === "t") {
      setTraceExpanded((current) => !current);
      return;
    }
    if (key.ctrl && key.name === "r") {
      setShellNotice("model picker placeholder - Phase 66");
      return;
    }
    if (key.name === "up" || key.name === "down") {
      setShellNotice("history placeholder - Phase 66");
      return;
    }
    if (key.name === "escape") {
      if (composer.length > 0) {
        setComposer("");
      } else {
        setShellNotice("cancel requested");
      }
      return;
    }
    if (key.name === "enter" || key.name === "return") {
      const prompt = composer.trim();
      if (prompt.length > 0) {
        setShellNotice(`submitted shell intent: ${prompt}`);
        setComposer("");
      }
      return;
    }
    if (key.name === "backspace" || key.name === "delete") {
      setComposer((current) => current.slice(0, -1));
      return;
    }
    if (!key.ctrl && !key.meta && key.sequence.length === 1) {
      setComposer((current) => `${current}${key.sequence}`);
    }
  });

  const transcriptLines = view.transcriptLines.slice(-12);
  const traceLines = traceExpanded ? view.traceDetailLines : view.traceSummaryLines;
  const traceLabel = traceExpanded ? view.traceExpandedLabel : view.traceCollapsedLabel;
  const composerLine = composer.length > 0 ? `> ${composer}` : `> ${view.composerHint}`;

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
        {transcriptLines.map((line, index) => (
          <text key={`transcript-${String(index)}`} width={contentWidth}>{line}</text>
        ))}
        <text width={contentWidth} fg="#f9e2af">{traceLabel}</text>
        {traceLines.slice(0, traceExpanded ? 8 : 3).map((line, index) => (
          <text key={`trace-${String(index)}`} width={contentWidth} fg="#a6adc8">{line}</text>
        ))}
      </box>
      <box flexDirection="column" width={contentWidth} marginTop={1}>
        <text width={contentWidth} fg="#f9e2af">composer</text>
        <text width={contentWidth}>{composerLine}</text>
      </box>
      <text width={contentWidth} fg="#a6adc8">{`${String(terminalWidth)}x${String(terminalHeight)} | ${traceLabel} | ${shellNotice}`}</text>
    </box>
  );
}
