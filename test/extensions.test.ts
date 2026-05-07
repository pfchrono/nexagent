import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createRuntimeExtensionArgs, createRuntimeExtensionContext, emitRuntimeExtensionEvent, formatRuntimeExtensionsStatus, loadRuntimeExtensions } from "../src/runtime/extensions.js";
import type { RuntimeSession } from "../src/runtime/session.js";

test("loadRuntimeExtensions loads Pi-like local extension module", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-extension-"));

  try {
    await mkdir(path.join(cwd, ".nexagent", "extensions"), { recursive: true });
    await writeFile(
      path.join(cwd, ".nexagent", "extensions", "sample.js"),
      [
        "export default function(pi) {",
        "  pi.on('agent_start', (_event, ctx) => ctx.ui.notify('started', 'info'));",
        "  pi.registerShortcut('ctrl+x', { handler: (ctx) => ctx.ui.setEditorText('shortcut') });",
        "  pi.registerMysteryApi('ignored');",
        "  pi.registerCommand({ name: '/sample-ext', handler: (args) => `sample ${args.join(' ')}` });",
        "  pi.registerTool({ name: 'sample_tool', description: 'sample' });",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const host = await loadRuntimeExtensions(cwd);
    const session = {
      cwd,
      extensions: host,
    } as RuntimeSession;

    assert.equal(host.status, "configured");
    assert.equal(host.commands.has("/sample-ext"), true);
    assert.equal(host.shortcuts.has("ctrl+x"), true);
    assert.equal(host.tools.has("sample_tool"), true);
    assert.match(host.notifications.join("\n"), /ignored unsupported extension API pi\.registerMysteryApi/);
    assert.match(host.activity.map((entry) => `${entry.status} ${entry.event}: ${entry.summary}`).join("\n"), /registered agent_start: handler 1/);
    assert.match(host.activity.map((entry) => `${entry.status} ${entry.event}: ${entry.summary}`).join("\n"), /registered command: \/sample-ext/);

    await emitRuntimeExtensionEvent(session, "agent_start");
    assert.deepEqual(host.notifications.slice(-1), ["info: started"]);
    assert.match(formatRuntimeExtensionsStatus(session).replace(/\d{4}-[^ ]+/g, "<time>"), /recent:\n(?:  .+\n)*  <time> completed agent_start: handler completed/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("extension shim supports Pi args, getCommand, session branch, and shortcut remap", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-extension-shim-"));

  try {
    await mkdir(path.join(cwd, ".nexagent", "extensions"), { recursive: true });
    await writeFile(
      path.join(cwd, ".nexagent", "extensions", "shim.js"),
      [
        "export default function(pi) {",
        "  pi.registerCommand('speedread', {",
        "    handler: (args, ctx) => {",
        "      const last = ctx.sessionManager.getBranch().filter((entry) => entry.type === 'message' && entry.message.role === 'assistant').pop();",
        "      return `${args.trim()}|${args.join(',')}|${last.message.content}`;",
        "    }",
        "  });",
        "  pi.registerShortcut('ctrl+r', { handler: async (ctx) => pi.getCommand('speedread').handler(['-l'], ctx) });",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const host = await loadRuntimeExtensions(cwd);
    const session = {
      cwd,
      extensions: host,
      conversation: [
        { role: "user", content: "question", tokens: 1 },
        { role: "assistant", content: "answer text", tokens: 2 },
      ],
    } as RuntimeSession;

    assert.equal(host.commands.has("/speedread"), true);
    assert.equal(host.shortcuts.has("alt+r"), true);
    assert.match(host.notifications.join("\n"), /remapped extension shortcut ctrl\+r to alt\+r/);
    assert.match(host.activity.map((entry) => `${entry.status} ${entry.event}: ${entry.summary}`).join("\n"), /warning shortcut: remapped ctrl\+r to alt\+r/);
    const output = await host.commands.get("/speedread")?.handler(createRuntimeExtensionArgs(["hello", "world"]), createRuntimeExtensionContext(session));
    assert.equal(output, "hello world|hello,world|answer text");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("loadRuntimeExtensions adapts legacy hook object exports", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "nexagent-extension-legacy-"));

  try {
    await mkdir(path.join(cwd, ".nexagent", "extensions"), { recursive: true });
    await writeFile(
      path.join(cwd, ".nexagent", "extensions", "legacy.js"),
      [
        "export default {",
        "  on_agent_start(ctx) { ctx.ui.notify('legacy start', 'info'); },",
        "  registerSlashCommands(registry) { registry.register({ name: '/legacy-ext', handler: () => 'legacy ok' }); },",
        "  beforeToolExecution() { return false; },",
        "}",
        "",
      ].join("\n"),
      "utf8",
    );

    const host = await loadRuntimeExtensions(cwd);
    const session = {
      cwd,
      extensions: host,
    } as RuntimeSession;

    assert.equal(host.commands.has("/legacy-ext"), true);
    assert.equal(host.handlers.has("before_tool_execution"), true);
    const results = await emitRuntimeExtensionEvent(session, "before_tool_execution", { tool: "shell_command" });
    assert.deepEqual(results, [false]);
    assert.match(host.activity.map((entry) => `${entry.status} ${entry.event}: ${entry.summary}`).join("\n"), /completed before_tool_execution: handler completed/);
    await emitRuntimeExtensionEvent(session, "agent_start");
    assert.deepEqual(host.notifications.slice(-1), ["info: legacy start"]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
