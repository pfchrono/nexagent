# OpenRouter Agent TUI Donor Findings for `nexagent`

Date: 2026-04-26
Donor skill: `openrouter-create-agent-tui`
Primary references:
- `/home/pfchrono/.codex/skills/openrouter-create-agent-tui/SKILL.md`
- `/home/pfchrono/.codex/skills/openrouter-create-agent-tui/references/tui.md`

## Donor shape worth importing

Best donor TUI rules:
- keep agent loop in runtime layer
- TUI wraps runtime, not reimplements loop
- split concerns:
  - `config`
  - `agent`
  - `cli`
  - `renderer`
  - `session`
  - `tools`
- treat tool visibility, token counts, loader state as first-class UI surfaces
- prefer config-driven display variants over hardcoded one-off layout logic
- keep plain fallback input mode before fancy shell behavior

## Current `nexagent` gap

Current `src/cli.ts` still too monolithic:
- input handling
- prompt submission
- transcript accumulation
- activity accumulation
- section navigation
- progress chrome
- renderer layout
- command dispatch

All live in one file and one local TUI state shape.

Current TUI issues donor helps explain:
- dashboard-first layout instead of workspace-first
- no renderer boundary for future display modes
- transcript and activity are string buffers, not display-ready structured items
- sidebar sections always visible even when operator needs workspace focus
- no explicit tool display mode choices like grouped/minimal/hidden
- no input mode layering like plain/bordered/block

## Best donor imports for `nexagent`

Good near-term imports:

1. renderer split
- move screen layout/render helpers into `src/tui/renderer.ts`
- keep runtime/event state outside renderer

2. display mode config
- add TUI display config for:
  - tool trace mode: `grouped | minimal | hidden`
  - input mode: `plain | bordered`
  - statusline mode: `compact | detailed`

3. workspace-first default
- transcript/tool work/composer should dominate center area
- diagnostics only on demand through slash commands

4. tool display as first-class surface
- grouped tool traces likely best default
- show tool name, summary, result state, maybe duration

5. plain fallback first
- if raw-mode or terminal quirks hit, plain input mode should still work

## Suggested `gsd-explore` questions

Best TUI-focused questions to feed `gsd-explore`:
- what renderer boundary should `nexagent` create before more UI polish?
- which TUI surfaces should be persistent vs slash-command only?
- should tool traces use grouped or minimal mode by default?
- what config precedence should TUI display modes use?
- what plain fallback input mode should exist when raw-mode TTY misbehaves?
- what module split should break `src/cli.ts` apart with least churn?

## `v1.3` implication

Phase 36 should not be only cosmetic polish.

Need structural TUI split:
- runtime loop stays headless
- renderer extracted
- input behavior simplified
- display modes configurable
- workspace-first view becomes default operator surface
