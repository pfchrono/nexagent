import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

import { loadPersistedPromptHistory, savePersistedPromptHistory } from "../runtime/persistence.js";
import { emitRuntimeExtensionEvent } from "../runtime/extensions.js";
import { shutdownMcpRegistry } from "../runtime/mcp.js";
import type { RuntimeSession } from "../runtime/session.js";
import { OpenTuiApp } from "./App.js";
import { createOpenTuiKeyboardSource } from "./keyboard-source.js";
import { createOpenTuiRuntimeView } from "./runtime-view.js";

export async function runOpenTuiRuntime(session: RuntimeSession): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
    externalOutputMode: "passthrough",
    targetFps: 30,
    maxFps: 30,
    useMouse: true,
    enableMouseMovement: true,
    useKittyKeyboard: null,
  });
  const keyboardSource = createOpenTuiKeyboardSource(renderer.keyInput, renderer.stdin);

  let settled = false;
  await new Promise<void>((resolve) => {
    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      process.removeListener("SIGINT", forceCleanup);
      process.removeListener("SIGTERM", forceCleanup);
      void (async () => {
        try {
          await emitRuntimeExtensionEvent(session, "session_shutdown", { reason: "exit" });
        } catch {
          // Shutdown must continue even if extension cleanup fails.
        }
        try {
          keyboardSource.dispose();
          shutdownMcpRegistry(session.mcpRegistry);
          renderer.destroy();
        } finally {
          resolve();
        }
      })();
    };

    const forceCleanup = () => {
      cleanup();
      setTimeout(() => {
        if (settled) {
          process.exit(0);
        }
      }, 250).unref();
    };

    process.once("SIGINT", forceCleanup);
    process.once("SIGTERM", forceCleanup);
    createRoot(renderer).render(
      <OpenTuiApp
        session={session}
        keyboardSource={keyboardSource}
        view={createOpenTuiRuntimeView(session)}
        promptHistory={loadPersistedPromptHistory(session.cwd)}
        onPromptHistoryChange={(history) => savePersistedPromptHistory(session.cwd, history)}
        onExit={forceCleanup}
      />,
    );
  });
}
