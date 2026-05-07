import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "bun:test";

import { createCommandSurface, createRuntimeCommandIntent, resolveSkillPreview } from "../src/opentui/command-surface.js";

test("OpenTUI command surface lists slash command palette rows", () => {
  const surface = createCommandSurface(process.cwd(), "/st");
  const notifyTestSurface = createCommandSurface(process.cwd(), "/notify-t");
  const emojiTestSurface = createCommandSurface(process.cwd(), "/emoji-t");

  assert.equal(surface.title, "/ Commands");
  assert.ok(surface.rows.some((row) => row.label === "/status"));
  assert.ok(surface.rows.some((row) => row.hint.startsWith("session · ")));
  assert.equal(notifyTestSurface.rows[0]?.value, "/notify-test ");
  assert.equal(emojiTestSurface.rows[0]?.value, "/emoji-test ");
});

test("OpenTUI command surface lists global command palette rows", () => {
  const cwd = makeSkillWorkspace(["alpha"]);
  const surface = createCommandSurface(cwd, "", 0, { global: true });

  assert.equal(surface.title, "Command Palette");
  assert.ok(surface.rows.some((row) => row.label === "Config dashboard" && row.value === "/config "));
  assert.ok(surface.rows.some((row) => row.label === "LSP status" && row.value === "/lsp status"));
  assert.ok(surface.rows.some((row) => row.label === "$alpha" && row.value === "/skill alpha"));
  assert.ok(surface.rows.some((row) => row.label === "/status"));
});

test("OpenTUI global command palette searches actions commands models and efforts", () => {
  const status = createCommandSurface(process.cwd(), "status", 0, { global: true });
  const model = createCommandSurface(process.cwd(), "55", 0, { global: true });
  const effort = createCommandSurface(process.cwd(), "xhigh", 0, { global: true });

  assert.ok(status.rows.some((row) => row.value === "/status dashboard"));
  assert.equal(model.rows[0]?.value, "/model gpt-5.5 ");
  assert.equal(effort.rows[0]?.value, "/effort xhigh");
});

test("OpenTUI global command palette includes common file actions and cwd rows", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "nexagent-global-file-palette-"));
  try {
    mkdirSync(path.join(cwd, "src"));
    writeFileSync(path.join(cwd, "README.md"), "# test\n", "utf8");

    const list = createCommandSurface(cwd, "list", 0, { global: true });
    const src = createCommandSurface(cwd, "src", 0, { global: true });
    const readme = createCommandSurface(cwd, "readme", 0, { global: true });

    assert.ok(list.rows.some((row) => row.value === "/ls "));
    assert.ok(src.rows.some((row) => row.label === "./src/" && row.value === "/ls ./src/"));
    assert.ok(readme.rows.some((row) => row.label === "./README.md" && row.value === "/read ./README.md"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("OpenTUI command surface fuzzy-ranks commands, models, effort, and skills", () => {
  const cwd = makeSkillWorkspace(["apricot-plan", "beta-review"]);
  const commandSurface = createCommandSurface(process.cwd(), "/sf");
  const modelSurface = createCommandSurface(process.cwd(), "/model 55");
  const effortSurface = createCommandSurface(process.cwd(), "/effort xh");
  const skillSurface = createCommandSurface(cwd, "$apr");

  assert.equal(commandSurface.rows[0]?.label, "/safegit");
  assert.match(commandSurface.rows[0]?.hint ?? "", /^safety · /);
  assert.equal(modelSurface.rows[0]?.value, "/model gpt-5.5 ");
  assert.equal(effortSurface.rows[0]?.value, "/effort xhigh");
  assert.equal(skillSurface.rows[0]?.value, "/skill apricot-plan");
});

test("OpenTUI command surface exposes first-match completion for Tab", () => {
  const surface = createCommandSurface(process.cwd(), "/sta");

  assert.equal(surface.completion.suggestions[0]?.value, "/status ");
});

test("OpenTUI command surface offers model and effort picker rows", () => {
  const bareModelSurface = createCommandSurface(process.cwd(), "/model");
  const modelListSurface = createCommandSurface(process.cwd(), "/model list");
  const modelSurface = createCommandSurface(process.cwd(), "/model gpt-5.5");
  const bareEffortSurface = createCommandSurface(process.cwd(), "/effort");
  const effortSurface = createCommandSurface(process.cwd(), "/model gpt-5.5 h");
  const directEffortSurface = createCommandSurface(process.cwd(), "/effort x");

  assert.equal(bareModelSurface.title, "Models");
  assert.equal(modelListSurface.title, "Models");
  assert.equal(bareEffortSurface.title, "Effort");
  assert.ok(bareModelSurface.rows.some((row) => row.value === "/model gpt-5.5 "));
  assert.ok(modelListSurface.rows.some((row) => row.value === "/model gpt-5.4 "));
  assert.ok(bareEffortSurface.rows.some((row) => row.value === "/effort high"));
  assert.ok(modelSurface.rows.some((row) => row.value === "/model gpt-5.5 "));
  assert.ok(effortSurface.rows.some((row) => row.value === "/model gpt-5.5 high"));
  assert.ok(directEffortSurface.rows.some((row) => row.value === "/effort xhigh"));
});

test("OpenTUI command surface offers provider control rows", () => {
  const bareProviderSurface = createCommandSurface(process.cwd(), "/provider ");
  const transportSurface = createCommandSurface(process.cwd(), "/provider http");

  assert.equal(bareProviderSurface.title, "Provider");
  assert.ok(bareProviderSurface.rows.some((row) => row.value === "/provider status"));
  assert.ok(bareProviderSurface.rows.some((row) => row.value === "/provider transport cli-exec"));
  assert.ok(bareProviderSurface.rows.some((row) => row.value === "/provider transport http-responses"));
  assert.equal(transportSurface.rows[0]?.value, "/provider transport http-responses");
});

test("OpenTUI command surface resolves skill preview", () => {
  const cwd = makeSkillWorkspace(["alpha"]);
  const preview = resolveSkillPreview(cwd, "$alp");

  assert.equal(preview.status, "resolved");
  assert.equal(preview.label, "skill: alpha");
  assert.equal(preview.command, "/skill alpha");
  assert.equal(preview.rows[0]?.hint, "alpha skill (project)");
});

test("OpenTUI command surface reports ambiguous skills", () => {
  const cwd = makeSkillWorkspace(["alpha", "alpine"]);
  const preview = resolveSkillPreview(cwd, "$al");

  assert.equal(preview.status, "ambiguous");
  assert.equal(preview.label, "Select skill");
  assert.equal(preview.command, null);
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.rows[0]?.hint, "alpha skill (project)");
});

test("OpenTUI command surface lists bare skill shorthand with descriptions", () => {
  const cwd = makeSkillWorkspace(["alpha", "alpine"]);
  const surface = createCommandSurface(cwd, "$");
  const alpha = surface.rows.find((row) => row.label === "alpha");
  const alpine = surface.rows.find((row) => row.label === "alpine");

  assert.equal(surface.title, "$ Skills");
  assert.equal(alpha?.hint, "alpha skill (project)");
  assert.equal(alpine?.hint, "alpine skill (project)");
});

test("OpenTUI command surface lists trailing skill shorthand inside command args", () => {
  const cwd = makeSkillWorkspace(["alpha", "alpine"]);
  const surface = createCommandSurface(cwd, "/boomerang $");

  assert.ok(surface.rows.some((row) => row.label === "$alpha"));
  assert.ok(surface.rows.some((row) => row.value === "/boomerang $alpine "));
});

test("OpenTUI command surface renders folded and body-derived skill descriptions", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "nexagent-skill-description-test-"));
  try {
    writeSkillFile(
      cwd,
      "domore",
      `---\nname: domore\ndescription: >-\n  Execute a concrete task end-to-end with stricter validation.\n---\n\n# DOMORE\n`,
    );
    writeSkillFile(cwd, "fallback", "# Fallback\n\nUse this skill when frontmatter lacks a description.\n");

    const folded = resolveSkillPreview(cwd, "$domore");
    const fallback = resolveSkillPreview(cwd, "$fallback");

    assert.equal(folded.rows[0]?.hint, "Execute a concrete task end-to-end with stricter validation. (project)");
    assert.equal(fallback.rows[0]?.hint, "Use this skill when frontmatter lacks a description. (project)");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
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

    assert.equal(relative.title, "Files");
    assert.equal(homeRows.title, "Files");
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

test("OpenTUI command surface lists file rows for LSP path subcommands", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "nexagent-lsp-path-surface-"));
  const home = mkdtempSync(path.join(tmpdir(), "nexagent-lsp-path-home-"));
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = home;
    mkdirSync(path.join(cwd, "src"));
    writeFileSync(path.join(cwd, "src", "lsp.ts"), "export function alpha() {}\n", "utf8");
    mkdirSync(path.join(home, "code"));

    const relative = createCommandSurface(cwd, "/lsp symbols src/l");
    const homeRows = createCommandSurface(cwd, "/lsp diagnostics ~/");

    assert.equal(relative.title, "Files");
    assert.equal(homeRows.title, "Files");
    assert.ok(relative.rows.some((row) => row.label === "src/lsp.ts"));
    assert.ok(homeRows.rows.some((row) => row.label === "~/code/"));
    assert.equal(relative.completion.suggestions[0]?.value, "/lsp symbols src/lsp.ts");
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
    writeSkillFile(cwd, name, `---\nname: "${name}"\ndescription: "${name} skill"\n---\n`);
  }
  return cwd;
}

function writeSkillFile(cwd: string, name: string, content: string): void {
  const dir = path.join(cwd, ".codex", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "SKILL.md"), content, "utf8");
}
