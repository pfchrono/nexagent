# Phase 49: cockpit-operator-ux-pack - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Add cockpit-style operator surfaces to current TTY shell: pinned flight strip, action ladder, warning lane, pilot override row, and split memory panel semantics. Scope is operator UX/state visibility only; no transport/protocol rewrite.

</domain>

<decisions>
## Implementation Decisions

### Flight strip density and width behavior
- **D-01:** Flight strip defaults to full fields on normal widths and auto-compacts under narrow terminals (`<120` columns).
- **D-02:** Compact behavior is responsive, not manually toggled for this phase.

### Action ladder source of truth
- **D-03:** Use hybrid ladder derivation: runtime events first, with bounded heuristic fallback when events are missing.
- **D-04:** Ladder remains separate from raw trace; trace stays technical ground truth.

### Warning lane policy
- **D-05:** Show warning + blocking severity in warning lane (not only blocking, not low-noise notices).
- **D-06:** Warning cards include actionable next step text.

### Pilot override controls
- **D-07:** Provide both hotkeys and slash command paths for override actions.
- **D-08:** Initial control set stays `ABORT`, `HOLD`, `REPLAN`, `REQ-APPROVAL`.

### Memory split and persistence behavior
- **D-09:** Memory panel stays split into session context, retrieved memory, and saved checkpoints.
- **D-10:** Enable automatic session-save behavior with cadence `every 10 minutes` plus pre-compaction checkpoint save.

### the agent's Discretion
- Exact risk-state scoring formula as long as it maps clearly into warning/blocking presentation.
- Exact compact rendering string format for each cockpit block, preserving chosen behavior above.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone and phase scope
- `.planning/ROADMAP.md` — Phase 49 goal, success criteria, and dependency boundary.
- `.planning/phases/49-cockpit-operator-ux-pack/49-01-PLAN.md` — Existing execution contract and file touchpoints for cockpit blocks.

### Product constraints
- `.planning/PROJECT.md` — Core value: truthful, actionable operator progress visibility.
- `.planning/REQUIREMENTS.md` — TU-01/TU-02/TU-04 operator UX and transcript/status constraints.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli.ts`: current TTY render orchestration and status/footer composition; primary cockpit integration point.
- `src/runtime/session.ts`: runtime turn state/events source for ladder and warning signals.
- `src/tui/primitives.ts`: existing visual block primitives and border/layout helpers for additive cockpit cards.

### Established Patterns
- Additive, incremental TTY changes preferred over renderer rewrite.
- Raw trace remains available even when higher-level summary surfaces exist.

### Integration Points
- Flight strip and override row attach to persistent status shell in `src/cli.ts`.
- Ladder/warning derive from runtime events and transport status updates from `src/runtime/session.ts`.
- Memory split rendering reuses existing command/status memory signal pathways in `src/cli.ts`.

</code_context>

<specifics>
## Specific Ideas

- Cockpit metaphor is intentional: operator/pilot needs immediate mode/risk/control awareness.
- Spinner emblem + verb should stay anchored in bottom status line and only animate during active turn.
- Trace should stay available but secondary to explicit action ladder and warning lane.

</specifics>

<deferred>
## Deferred Ideas

- Full Hermes-like non-animated status strip parity polish.
- Interactive mouse-driven override buttons.
- Persistent user-custom cockpit layout profiles.

</deferred>

---

*Phase: 49-cockpit-operator-ux-pack*
*Context gathered: 2026-04-27*
