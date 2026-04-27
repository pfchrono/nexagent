---
phase: "49"
name: "cockpit-operator-ux-pack"
created: 2026-04-27
---

# Phase 49: cockpit-operator-ux-pack — Context

## Decisions

- Keep current renderer architecture (`src/cli.ts` + `src/tui/primitives.ts`) for this phase.
- Prefer additive cockpit blocks over large layout rewrite.
- Keep existing trace block as raw layer; add higher-level action ladder separately.
- Avoid transport behavior changes; this phase is TUI/operator-surface only.

## Discretion Areas

- Exact placement/order of flight strip, warning lane, action ladder, override row.
- Compact vs expanded rendering thresholds for small terminal widths.
- Risk-state scoring rubric from runtime signals.

## Deferred Ideas

- full Hermes-like non-animated status strip
- interactive mouse-driven override buttons
- persistent custom cockpit layout profiles
