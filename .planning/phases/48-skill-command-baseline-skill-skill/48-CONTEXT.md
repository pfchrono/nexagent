# Phase 48: skill-command-baseline-skill-skill - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement minimal usable `/skill` and `$skill` terminal routing baseline: discover, deterministic lookup, argument pass-through, and safe fallback errors. Scope is baseline command UX only.

</domain>

<decisions>
## Implementation Decisions

### `/skill` default output
- **D-01:** Use compact table layout for skill listing.
- **D-02:** Table includes at minimum: skill name, short description, source/category.

### `/skill <name>` lookup sequence
- **D-03:** Resolve in order: exact match -> alias -> prefix -> fuzzy.
- **D-04:** Lookup must remain deterministic and stable across runs.

### Unknown skill fallback
- **D-05:** Return error plus top 3 closest matches.
- **D-06:** Include explicit recovery hint: run `/skill` to inspect full list.

### `$skill` argument handling
- **D-07:** Pass raw trailing args unchanged to skill routing.
- **D-08:** Do not normalize/rewrite arguments in baseline.

### Persistence model
- **D-09:** Baseline activation persistence is session-only.
- **D-10:** No global auto-persist in this phase.

### Safety confirmations
- **D-11:** No confirmation gate on normal skill switch/route in baseline.
- **D-12:** Confirmation policy can be added in future high-risk phase if needed.

### the agent's Discretion
- Exact compact table column widths and truncation behavior.
- Exact fuzzy scoring algorithm as long as ordering remains deterministic.
- Exact shape of internal routing adapters provided decision contracts above are preserved.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone and scope
- `.planning/ROADMAP.md` — Phase 48 goal, success criteria, and dependency chain.

### Product and requirements
- `.planning/PROJECT.md` — operator trust/usability priorities for terminal command flow.
- `.planning/REQUIREMENTS.md` — CMD-01/CMD-02/CMD-03 requirement mapping.

### Prior staging contract
- `.planning/phases/45-future-capability-prep/45-01-PLAN.md` — staged contract reference that introduced `/skill` + `$skill` baseline as must-have.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli.ts` (or split successors from Phase 44): current slash-command dispatch and composer/send loop integration points.
- Existing provider/status/help command handlers: pattern reference for compact outputs and deterministic routing.

### Established Patterns
- Additive command-surface changes favored over broad runtime rewrites.
- Explicit operator-facing errors preferred over implicit/automatic behavior.

### Integration Points
- `/skill` hooks into slash command parser/dispatcher.
- `$skill` hooks into prompt pre-parser or command-entry shim before normal model send path.
- Autocomplete candidate source should share same lookup index as runtime resolver to avoid drift.

</code_context>

<specifics>
## Specific Ideas

- Keep baseline fast and predictable; no hidden smart behavior on unknown skills.
- Preserve raw args for `$skill` route to avoid mangling intent.
- Make recovery path obvious when lookup fails (closest matches + list hint).

</specifics>

<deferred>
## Deferred Ideas

- Global/persistent skill activation profiles.
- Confirmation gates for high-risk skill classes.
- Advanced grouped or rich interactive skill browser.

</deferred>

---

*Phase: 48-skill-command-baseline-skill-skill*
*Context gathered: 2026-04-27*
