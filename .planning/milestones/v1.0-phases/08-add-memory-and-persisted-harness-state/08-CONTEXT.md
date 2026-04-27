# Phase 8: Add memory and persisted harness state - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning
**Mode:** Auto-generated autonomous context

<domain>
## Phase Boundary

Phase 8 should make persisted-memory boundaries explicit and inspectable without pretending durable write/retrieval behavior already exists. Current runtime already imports Archivist settings, but surfaces only enabled/storage/retrieval and does not clearly expose persistence boundary or whether storage exists.

</domain>

<decisions>
## Implementation Decisions

### focus slice
Land read-only persistence transparency first. Do not invent a write path or retrieval engine.

### target gaps
- Shared runtime should expose Archivist boundary mode.
- Interfaces should show whether configured storage file actually exists.
- Command surface should allow direct memory inspection.

</decisions>

<code_context>
## Existing Code Insights

- `src/runtime/config.ts` already resolves Archivist enablement and storage path.
- `src/cli.ts` already has archivist sections in inspect/TUI/GUI.
- Plan explicitly warns against accidental durable writes before they are truly implemented.

</code_context>

<specifics>
## Specific Ideas

- Add Archivist `boundary` and `storageExists` to shared runtime state.
- Add `/memory` command.
- Expand archivist rows in runtime views with boundary and persisted-file visibility.

</specifics>

<deferred>
## Deferred Ideas

- Actual memory writes stay out of scope.
- Retrieval influence tracking beyond current `used/sourceCategory` stays out of scope.
- Richer persisted context semantics can wait for later design work.

</deferred>
