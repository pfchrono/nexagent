import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
