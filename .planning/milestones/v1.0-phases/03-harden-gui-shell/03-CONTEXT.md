# Phase 3: Harden GUI shell - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Mode:** Auto-generated autonomous context

<domain>
## Phase Boundary

Phase 3 should keep GUI shell downstream of same runtime truth already proven in TUI. Current GUI renderer already consumes same row-based runtime view shape, but contract was implicit instead of explicit.

</domain>

<decisions>
## Implementation Decisions

### focus slice
Make shared GUI contract explicit instead of adding GUI-only behavior.

### target gaps
- GUI should have dedicated factory that derives from exact same session-to-view path as TUI.
- Tests should lock GUI/TUI view parity.
- No GUI-only state path should appear.

</decisions>

<code_context>
## Existing Code Insights

- `src/cli.ts` exposes `renderRuntimeGui()` and `createRuntimeTuiView()`.
- `RuntimeGuiView` was only a type alias, so parity existed by convention, not by explicit API.
- GUI renderer already shows runtime, routing, instructions, MCP, imports, and archivist sections.

</code_context>

<specifics>
## Specific Ideas

- Add `createRuntimeGuiView(session)` that reuses `createRuntimeTuiView(session)`.
- Add regression test for exact parity.

</specifics>

<deferred>
## Deferred Ideas

- Real interactive GUI workflow stays out of scope.
- Tooling, hooks, and memory remain later phases.

</deferred>
