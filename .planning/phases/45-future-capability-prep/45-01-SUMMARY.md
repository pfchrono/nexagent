---
phase: 45-future-capability-prep
plan: 01
subsystem: "planning"
tags: [contracts, future-capabilities, roadmap]
provides: [yolo-contract, image-attachment-contract, skill-command-contract, out-of-scope-routing-contract]
affects: [.planning/phases/45-future-capability-prep]
tech-stack:
  added: []
  patterns: [contract-first-staging]
key-files:
  created: [45-CAPABILITY-CONTRACTS.md]
  modified: []
key-decisions:
  - "Ship explicit capability contracts before enabling risky runtime behavior."
  - "Keep framework migration (`ink`/`opencode`) deferred until minimum hooks exist."
patterns-established:
  - "Future capability ideas must route to backlog or next milestone, not buried notes."
duration: "11min"
completed: 2026-04-27
---

# Phase 45: future-capability-prep Summary

Defined explicit staged contracts for parked future capabilities so next milestone work has clear, safe implementation boundaries.

## Performance

- **Duration:** 11min
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `45-CAPABILITY-CONTRACTS.md` covering:
  - `--yolo` guarded behavior contract
  - image paste/attachment provider-gated contract
  - `/skill` + `$skill` baseline contract
  - out-of-scope routing contract
- Routed prior exploratory memory idea as backlog reference (`999.1`) inside contract doc.

## Task Commits

1. **Task 1: Future capability contracts** - `n/a (working tree changes only)`

## Files Created/Modified

- `45-CAPABILITY-CONTRACTS.md` - staged capability contracts and smallest safe slices.
- `45-01-SUMMARY.md` - execution summary for phase tracking.

## Decisions & Deviations

- No runtime behavior enabled in this phase; contract-first prep only.

## Next Phase Readiness

Next milestone can execute minimum slices for `--yolo`, image attachments, and `/skill` routing using these contracts as implementation truth.
