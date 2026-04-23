#!/usr/bin/env node

import process from "node:process";
import { bootstrapRuntime, createRuntimeState } from "./runtime/bootstrap.js";
import { createRuntimeSession } from "./runtime/session.js";

async function main(): Promise<void> {
  const runtime = await bootstrapRuntime(process.cwd());
  const session = createRuntimeSession(runtime);
  const state = createRuntimeState(runtime);

  process.stdout.write(
    `${JSON.stringify(
      {
        ...state,
        sessionId: session.id,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
