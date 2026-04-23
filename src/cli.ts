#!/usr/bin/env node

import process from "node:process";
import { bootstrapRuntime } from "./runtime/bootstrap.js";
import { createRuntimeSession } from "./runtime/session.js";

async function main(): Promise<void> {
  const runtime = await bootstrapRuntime(process.cwd());
  const session = createRuntimeSession(runtime);

  process.stdout.write(
    `${JSON.stringify(
      {
        product: runtime.config.productName,
        provider: session.provider,
        cwd: session.cwd,
        mcpServers: session.mcpServers,
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
