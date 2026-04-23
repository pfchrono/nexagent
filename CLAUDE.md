# CLAUDE.md

This file provides compatibility guidance for assistants that automatically look for `CLAUDE.md` in a repository.

`nexagent` is currently a baseline repo scaffold. It is not yet the full imported Free-Code runtime. Keep instructions grounded in the files that actually exist.

## Current repository shape

Today this repo primarily contains:

- OpenSpec artifacts under `openspec/`
- local assistant configuration under `.claude/`
- MCP server configuration in `.mcp.json`
- local harness state under `.omc/`
- repo guidance files like `AGENTS.md` and this file

Do not assume there is already a runnable CLI, GUI, transport server, or application source tree unless those files have been added.

## Primary source of truth

For baseline architecture and migration intent, read these files first:

- `openspec/changes/define-nexagent-baseline/proposal.md`
- `openspec/changes/define-nexagent-baseline/specs/nexagent-harness/spec.md`
- `openspec/changes/define-nexagent-baseline/design.md`
- `openspec/changes/define-nexagent-baseline/tasks.md`

## Working expectations

- Keep edits small and accurate.
- Do not preserve inherited instructions that describe nonexistent code or commands.
- Prefer updating repo-local config and OpenSpec artifacts over inventing undocumented behavior.
- Preserve compatibility files only when they still add real value for local workflows.

## Practical guidance

- Use MCP/repo analysis tools when they help you orient faster.
- Use direct file reads and edits for narrow, explicit changes.
- Only add build/test/run instructions after the corresponding runtime files exist.
- If you bootstrap the actual runtime later, update both `AGENTS.md` and `CLAUDE.md` so future agents stop receiving stale guidance.

## Safety

Before removing inherited documentation, confirm whether it contains the last useful record of local intent. Prefer replacing fiction with concise truth, not deleting context blindly.
