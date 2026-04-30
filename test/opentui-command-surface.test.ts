import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "bun:test";

import { createCommandSurface, createRuntimeCommandIntent, resolveSkillPreview } from "../src/opentui/command-surface.js";

test("OpenTUI command surface lists slash command palette rows", () => {
  const surface = createCommandSurface(process.cwd(), "/st");

  assert.equal(surface.title, "Command palette");
  assert.ok(surface.rows.some((row) => row.label === "/status"));
});

test("OpenTUI command surface exposes first-match completion for Tab", () => {
  const surface = createCommandSurface(process.cwd(), "/sta");

  assert.equal(surface.completion.suggestions[0]?.value, "/status ");
});

test("OpenTUI command surface resolves skill preview", () => {
  const cwd = makeSkillWorkspace(["alpha"]);
  const preview = resolveSkillPreview(cwd, "$alp");

  assert.equal(preview.status, "resolved");
  assert.equal(preview.label, "skill: alpha");
  assert.equal(preview.command, "/skill alpha");
});

test("OpenTUI command surface reports ambiguous skills", () => {
  const cwd = makeSkillWorkspace(["alpha", "alpine"]);
  const preview = resolveSkillPreview(cwd, "$al");

  assert.equal(preview.status, "ambiguous");
  assert.equal(preview.label, "Select skill");
  assert.equal(preview.command, null);
  assert.equal(preview.rows.length, 2);
});

test("OpenTUI command surface keeps all rows selectable beyond visible palette window", () => {
  const cwd = makeSkillWorkspace(Array.from({ length: 10 }, (_, index) => `alpha-${String(index)}`));
  const preview = resolveSkillPreview(cwd, "$alpha", 9);
  const commandSurface = createCommandSurface(process.cwd(), "/", 9);

  assert.equal(preview.status, "ambiguous");
  assert.equal(preview.rows.length, 10);
  assert.equal(preview.rows[9]?.selected, true);
  assert.ok(commandSurface.rows.length > 5);
  assert.equal(commandSurface.rows[9]?.selected, true);
});

test("OpenTUI command surface lists path rows for relative and home tokens", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "nexagent-path-surface-"));
  const home = mkdtempSync(path.join(tmpdir(), "nexagent-path-home-"));
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = home;
    mkdirSync(path.join(cwd, "docs"));
    mkdirSync(path.join(home, "code"));

    const relative = createCommandSurface(cwd, "look at ./");
    const homeRows = createCommandSurface(cwd, "look at ~/");

    assert.ok(relative.rows.some((row) => row.label === "./docs/"));
    assert.ok(homeRows.rows.some((row) => row.label === "~/code/"));
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("OpenTUI command surface converts skill shorthand to runtime command intent", () => {
  const intent = createRuntimeCommandIntent("$alpha args");

  assert.deepEqual(intent, { kind: "runtime-command", input: "/skill alpha args" });
});

function makeSkillWorkspace(names: string[]): string {
  const cwd = mkdtempSync(path.join(tmpdir(), "nexagent-skill-test-"));
  for (const name of names) {
    const dir = path.join(cwd, ".codex", "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "SKILL.md"),
      `---\nname: "${name}"\ndescription: "${name} skill"\n---\n`,
      "utf8",
    );
  }
  return cwd;
}
