# Phase 1: Stabilize shared runtime core - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Mode:** Auto-generated autonomous context

<domain>
## Phase Boundary

Phase 1 should harden one shared runtime truth model for every interface. Current repo already has shared runtime bootstrap, config loading, session state, provider routing, MCP summary loading, repo metadata, and instruction layers. Smallest real remaining gap is consistency: runtime reload and command execution can still bypass or desync shared session truth.

</domain>

<decisions>
## Implementation Decisions

### focus slice
Do smallest real slice that improves shared runtime truth without jumping ahead into phase 2 TUI polish or phase 6 tool expansion.

### target gaps
- Selected provider must survive runtime reload in both provider-routing state and provider-transport state.
- Shared action/progress state must update through one runtime helper for both CLI command mode and TUI flows.
- CLI should use shared session helpers instead of mutating runtime state in multiple places.

</decisions>

<code_context>
## Existing Code Insights

- `src/runtime/bootstrap.ts` already builds canonical runtime state.
- `src/runtime/session.ts` owns session creation and runtime sync, but lacks helper APIs for provider selection and action updates.
- `src/cli.ts` still mutates provider selection and action state directly.
- Current tests cover runtime config, provider transport, inspect output, and TUI rendering, but not reload preservation for `providerTransport.activeProvider`.

</code_context>

<specifics>
## Specific Ideas

- Add session helpers for provider selection and action updates.
- Use those helpers from CLI paths.
- Add regression tests for reload preservation and command-mode action updates.

</specifics>

<deferred>
## Deferred Ideas

- Richer TUI progress UX and panel state belong to phase 2.
- Broader command surface belongs to phase 9.
- Tool execution belongs to phase 6.

</deferred>
