# Phase 9: Evolve command surface and workflow affordances - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Mode:** Auto-generated autonomous context

<domain>
## Phase Boundary

Phase 9 should make current command surface explicit and inspectable so implemented behavior is not confused with broader inherited compatibility claims. Current runtime already has useful commands, but no built-in command catalog or guidance path.

</domain>

<decisions>
## Implementation Decisions

### focus slice
Add explicit command catalog and guidance path, not broader new command semantics.

### target gaps
- Runtime should expose current supported commands directly.
- Unknown-command errors should route operator toward supported surface.
- Command surface should stay grounded in implemented behavior only.

</decisions>

<code_context>
## Existing Code Insights

- `src/cli.ts` already has a growing slash-command surface.
- Tests already cover most command behaviors.
- Final gap is discoverability and explicit command contract.

</code_context>

<specifics>
## Specific Ideas

- Add central command catalog constant.
- Add `/help`.
- Improve unknown-command guidance to point at `/help`.

</specifics>

<deferred>
## Deferred Ideas

- Broader workflow shortcuts stay out of scope.
- Spec system for command families stays future work.

</deferred>
