import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";

import type { RuntimeSession } from "../runtime/session.js";
import { OpenTuiApp } from "./App.js";
import { createOpenTuiRuntimeView } from "./runtime-view.js";

export async function runOpenTuiRuntime(session: RuntimeSession): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    screenMode: "alternate-screen",
    externalOutputMode: "passthrough",
    targetFps: 30,
    maxFps: 30,
  });

  let settled = false;
  await new Promise<void>((resolve) => {
    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      process.removeListener("SIGINT", cleanup);
      process.removeListener("SIGTERM", cleanup);
      try {
        renderer.destroy();
      } finally {
        resolve();
      }
    };

    process.once("SIGINT", cleanup);
    process.once("SIGTERM", cleanup);
    createRoot(renderer).render(<OpenTuiApp view={createOpenTuiRuntimeView(session)} onExit={cleanup} />);
  });
}
