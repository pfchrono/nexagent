import { spawnSync } from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";

test("emitTerminalNotification tolerates missing platform notification helper", () => {
  const code = [
    "import { emitTerminalNotification } from './src/runtime/pi-compat.ts';",
    "emitTerminalNotification('nexagent', 'test notification');",
    "setTimeout(() => process.exit(0), 20);",
  ].join("\n");

  const result = spawnSync(process.execPath, ["--eval", code], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DISPLAY: ":1",
      WAYLAND_DISPLAY: "",
      DBUS_SESSION_BUS_ADDRESS: "",
      PATH: "",
    },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.error, undefined);
});
