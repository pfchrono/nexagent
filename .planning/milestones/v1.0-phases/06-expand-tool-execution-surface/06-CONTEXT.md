# Phase 6: Expand tool execution surface - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Mode:** Auto-generated autonomous context

<domain>
## Phase Boundary

Phase 6 should make harness feel less like a provider wrapper by exposing first-class local tool commands. Current runtime already has provider control and inspection, but non-provider command surface was limited to `/provider`.

</domain>

<decisions>
## Implementation Decisions

### focus slice
Land first useful local tool commands through existing CLI/TUI command path.

### target gaps
- Add repo-aware local commands for filesystem inspection and text search.
- Keep command surface usable from both prompt mode and TUI because both already call `runRuntimeCommand`.
- Avoid broader tool framework or MCP execution in this slice.

</decisions>

<code_context>
## Existing Code Insights

- `src/cli.ts` routes slash commands through `runRuntimeCommand`.
- `runPromptCommand` and TUI input already share this path, so new commands become cross-interface automatically.
- Repo and cwd truth already live in shared runtime session state.

</code_context>

<specifics>
## Specific Ideas

- Add `/pwd`, `/ls [path]`, `/read <path>`, and `/find <text> [path]`.
- Resolve relative paths from session cwd.
- Keep output plain text and deterministic for tests.

</specifics>

<deferred>
## Deferred Ideas

- MCP-backed command execution stays for later work.
- Editing and write-capable tools stay out of this slice.
- Hook/plugin automation belongs to phase 7.

</deferred>
