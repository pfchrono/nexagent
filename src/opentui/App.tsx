import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import type { OpenTuiRuntimeView } from "./runtime-view.js";

export interface OpenTuiAppProps {
  view: OpenTuiRuntimeView;
  onExit: () => void;
}

export function OpenTuiApp({ view, onExit }: OpenTuiAppProps) {
  const { width, height } = useTerminalDimensions();

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape" || (key.ctrl && key.name === "c")) {
      onExit();
    }
  });

  return (
    <box flexDirection="column" width="100%" height="100%" padding={1}>
      <text width="100%" fg="#8bd5ff" content={`${view.product} :: opentui sidecar`} />
      <text width="100%" fg="#a6adc8" content={`${view.provider}/${view.model} | session ${view.sessionId} | turns ${String(view.turnCount)}`} />
      <box flexDirection="column" width="100%" marginTop={1} padding={1} border>
        <text width="100%" fg="#f9e2af" content="status" />
        <text width="100%" content={`${view.status} - ${view.detail}`} />
        <text width="100%" content={`approval ${view.approval} | tools ${view.toolPolicy}`} />
      </box>
      <box flexDirection="column" width="100%" flexGrow={1} marginTop={1} padding={1} border>
        <text width="100%" fg="#f9e2af" content="transcript" />
        <text width="100%" content="OpenTUI sidecar proof. Full transcript port begins after migration contract." />
      </box>
      <box flexDirection="column" width="100%" marginTop={1} padding={1} border>
        <text width="100%" fg="#f9e2af" content="composer" />
        <text width="100%" content="Prompt input port deferred. Press q, Esc, or Ctrl+C to exit." />
      </box>
      <text width="100%" fg="#a6adc8" content={`${String(width)}x${String(height)} | cwd ${view.cwd}`} />
    </box>
  );
}
