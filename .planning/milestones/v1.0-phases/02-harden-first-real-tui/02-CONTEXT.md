# Phase 2: Harden first real TUI - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Mode:** Auto-generated autonomous context

<domain>
## Phase Boundary

Phase 2 should make current terminal UI a dependable visibility surface for shared runtime state. Current TUI already shows provider, session, repo/cwd, MCP, imports, archivist, and instruction layers, but progress still came from local UI-only fields instead of shared runtime action state.

</domain>

<decisions>
## Implementation Decisions

### focus slice
Do smallest slice that makes TUI trust shared runtime state more than local UI state.

### target gaps
- TUI progress line should derive from shared runtime action state.
- Agent panel status should reflect shared runtime pending/detail state.
- `lastActivity` should be visible so operator can inspect recent runtime changes without guessing.

</decisions>

<code_context>
## Existing Code Insights

- `src/cli.ts` already renders TUI from `RuntimeTuiView`, but still kept local `progressVerb`, `progressDetail`, and `requestPending`.
- `src/runtime/session.ts` now owns shared action/progress helpers from phase 1.
- `createRuntimeTuiView` already exposes action status and detail, so extending that view for `lastActivity` is low risk.

</code_context>

<specifics>
## Specific Ideas

- Remove local progress fields from TUI state.
- Render spinner/status line from shared action state.
- Show `lastActivity` in TUI metadata and agent panel.

</specifics>

<deferred>
## Deferred Ideas

- Richer layout polish and more advanced navigation stay out of scope.
- GUI parity belongs to phase 3.

</deferred>
