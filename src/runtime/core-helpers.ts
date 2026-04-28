import { readFileSync } from "node:fs";
import path from "node:path";

import { createTwoFilesPatch } from "diff";
import fg from "fast-glob";
import ignore from "ignore";

export interface IgnoreAwareFileSearchOptions {
  cwd: string;
  pattern: string;
  includeIgnored?: boolean;
  limit?: number;
}

export function searchFilesWithIgnore(options: IgnoreAwareFileSearchOptions): string[] {
  const cwd = path.resolve(options.cwd);
  const limit = Math.max(1, options.limit ?? 100);
  const ig = options.includeIgnored ? null : loadIgnore(cwd);
  const matches = fg.sync(options.pattern, {
    cwd,
    absolute: false,
    dot: false,
    onlyFiles: true,
    unique: true,
    followSymbolicLinks: false,
  });

  return matches
    .map((entry) => normalizeRelativePath(entry))
    .filter((entry) => !ig || !ig.ignores(entry))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, limit);
}

export function buildPatchPreview(filePath: string, current: string, next: string): string {
  return createTwoFilesPatch(filePath, filePath, current, next, "before", "after", { context: 3 }).trimEnd();
}

function loadIgnore(cwd: string): ReturnType<typeof ignore> | null {
  const ig = ignore();
  try {
    ig.add(readFileSync(path.join(cwd, ".gitignore"), "utf8"));
  } catch {
    return ig;
  }
  return ig;
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}
