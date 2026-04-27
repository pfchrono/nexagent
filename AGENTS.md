# AGENTS.md

This file provides guidance for coding agents working in the `nexagent` repository.

This repo is currently an early `nexagent` runtime baseline, not the full planned hybrid harness. Current source of truth lives in repo-local docs, config, and code that actually exists here. Do not assume upstream Free-Code transport, GUI, or broader compatibility surfaces already exist here just because a local runtime now does.

## What exists today

The repo currently centers on:

- `openspec/` for current OpenSpec config and future spec material when present
- `AGENTS.md` for repo-local operating instructions
- `CLAUDE.md` for assistant compatibility
- `.claude/settings.json` for local assistant defaults
- `.mcp.json` for MCP server configuration
- `.omc/` for local harness state and agent artifacts
- `.codesight/` for optional repo analysis/cache data
- `src/` for the current TypeScript CLI/runtime baseline
- `package.json`, `tsconfig.json`, and lockfiles for local build/run commands

Assume the current baseline includes a runnable CLI and local runtime modules when those files are present. Do not assume provider transport, GUI, or upstream-complete compatibility paths exist unless you can point to the files implementing them.

## Current objective

The immediate objective is to turn this repository into a working local `nexagent` AI harness while staying aligned with current repo-local planning truth.

Read these first before changing repo shape, runtime boundaries, or product behavior:

- `Plan.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `AGENTS.md`
- `CLAUDE.md`

## Repo rules

- Prefer minimal, reversible changes.
- Keep repository instructions aligned with files that actually exist.
- Remove inherited upstream guidance when it describes code, commands, or architecture that is not present in this repo.
- Do not invent build or test commands before the corresponding toolchain files exist.
- Keep compatibility filenames like `CLAUDE.md` when they still help local assistant workflows.
- Treat repo-local configuration as the current control plane.

## Decision precedence

When behavior is ambiguous, use this order:

1. direct user request
2. repo-local instructions (`AGENTS.md`, `CLAUDE.md`)
3. repo-local configuration (`.claude/settings.json`, `.mcp.json`)
4. current OpenSpec files when present
5. inherited assumptions from upstream projects or tools

## Tooling guidance

- Use read/search/edit tools for direct file work.
- Use MCP tools when they provide better context than manual file scanning.
- Use shell only for actions that genuinely require shell execution.
- Do not install packages or bootstrap a runtime unless the task actually requires it.

## Documentation hygiene

When adapting inherited files for `nexagent`:

- keep what is compatibility-critical,
- rewrite what is misleading,
- delete references to nonexistent source trees, providers, binaries, or transports,
- prefer short accurate instructions over speculative architecture prose.

## OpenSpec discipline

If intent or scope changes, update matching repo-local planning file instead of leaving it implicit.

Typical mapping:

- product direction and build order → `Plan.md`
- milestone and phase truth → `.planning/ROADMAP.md`
- active handoff state → `.planning/STATE.md`
- future OpenSpec requirements or specs → `openspec/` files that actually exist

## Safety and scope

- Keep edits tightly scoped to the request.
- Avoid carrying over upstream branding or product claims unless they are still true for `nexagent`.
- Before deleting or rewriting repo instructions, confirm they are not the last remaining record of important local behavior.
- If you introduce a real runtime, add only the smallest accurate set of commands and paths needed for future agents to operate it.
