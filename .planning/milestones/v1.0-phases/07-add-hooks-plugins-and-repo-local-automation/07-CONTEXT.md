# Phase 7: Add hooks, plugins, and repo-local automation - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Mode:** Auto-generated autonomous context

<domain>
## Phase Boundary

Phase 7 should open controlled repo-local workflow behavior without inventing broad automation parity. Current repo already contains Claude-style hook config in `.claude/settings.json`, but runtime treated it as generic imported settings instead of explicit automation policy.

</domain>

<decisions>
## Implementation Decisions

### focus slice
Make repo-local hook policy explicit and inspectable through shared runtime state before attempting hook execution engine work.

### target gaps
- Parse configured Claude hooks into shared runtime state.
- Surface hook policy through inspect/TUI/GUI and command surface.
- Preserve invalid hook entries as visible status instead of hidden generic config noise.

</decisions>

<code_context>
## Existing Code Insights

- `src/runtime/config.ts` already imports Claude provider, transport, MCP, and archivist settings.
- `.claude/settings.json` already contains `hooks.PreToolUse`.
- `src/cli.ts` already has inspect/TUI/GUI view surfaces and shared slash-command path, so hook visibility can be added with no new interface-specific state.

</code_context>

<specifics>
## Specific Ideas

- Add shared `hooks` config/state object with source path, event list, command count, and invalid entry tracking.
- Add `/hooks` command.
- Add hook rows to TUI and GUI sections.

</specifics>

<deferred>
## Deferred Ideas

- Actual hook execution engine stays out of scope for this slice.
- Plugin marketplace or install workflow stays out of scope.
- Persisted automation state belongs later.

</deferred>
