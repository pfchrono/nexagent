import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "bun:test";

import { createUnifiedSuggestions } from "../src/cli/suggestions.js";

test("unified suggestions engine merges typed sources with labels scoring and truncation", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "nexagent-suggestions-"));
  try {
    mkdirSync(path.join(cwd, ".codex", "skills", "alpha"), { recursive: true });
    writeFileSync(path.join(cwd, ".codex", "skills", "alpha", "SKILL.md"), "---\nname: alpha\ndescription: alpha skill\n---\n", "utf8");
    writeFileSync(path.join(cwd, "README.md"), "# test\n", "utf8");
    execFileSync("git", ["init"], { cwd, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "Test User"], { cwd, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "Track issue #123"], { cwd, stdio: "ignore" });

    const all = createUnifiedSuggestions(cwd, "", 99, { limit: 12 });
    assert.equal(all.suggestions.length, 12);
    assert.equal(all.selectedIndex, 11);
    assert.ok(all.suggestions.every((row) => row.sourceLabel.length > 0));
    assert.ok(all.suggestions.every((row, index, rows) => index === 0 || rows[index - 1]!.score <= row.score));

    assert.ok(createUnifiedSuggestions(cwd, "alpha", 0, { limit: 80 }).suggestions.some((row) => row.source === "skill" && row.label === "$alpha"));
    assert.ok(createUnifiedSuggestions(cwd, "readme", 0, { limit: 80 }).suggestions.some((row) => row.source === "path" && row.label === "./README.md"));
    assert.ok(createUnifiedSuggestions(cwd, "55", 0, { limit: 80 }).suggestions.some((row) => row.source === "model" && row.value === "/model gpt-5.5 "));
    assert.ok(createUnifiedSuggestions(cwd, "xhigh", 0, { limit: 80 }).suggestions.some((row) => row.source === "effort" && row.value === "/effort xhigh"));
    assert.ok(createUnifiedSuggestions(cwd, "#123", 0, { limit: 80 }).suggestions.some((row) => row.source === "issue" && row.label === "#123"));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
