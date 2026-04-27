# nexagent

## What This Is

nexagent is a terminal-first AI coding harness that lets operator steer long-running work from one console with typed commands and explicit turn control.
The product emphasizes trust and usability over feature breadth: stable execution loop first, then progressive terminal UX polish.
It is currently focused on local coding workflows, especially command/task sequencing, tool transparency, and readable runtime state.

## Core Value

Give operator confidence that every turn is truthful, actionable, and visibly progressing until finished, blocked, or explicitly rerouted.

## Requirements

### Validated

- ✓ Continue/approval loop runs with local Codex/HTTP providers (v1.3)
- ✓ Command surface includes `/status`, `/provider`, `/tools`, `/memory` and command persistence scaffolding
- ✓ Basic workspace and trace outputs avoid hard crashes during normal agent runs
- ✓ **TU-01** compact operator-first diagnostics output validated in Phase 40
- ✓ **RUNT-01** continue/start/finish flow stays active until done or blocked (Phase 40.1)
- ✓ **RUNT-02** completion claims gated by runtime evidence instead of response tone (Phase 40.1)
- ✓ **RUNT-03** running/pending/blocked/finished state clarity implemented (Phase 40.1)
- ✓ **RUNT-04** interruption recovery surfaced in status/transcript output (Phase 40.1)

### Active

- [ ] **TU-01**: Refresh terminal operator experience via donor-informed TTY polish, scroll/completion behavior, and clearer stage feedback.
- [ ] **CMD-01**: Deliver usable `/skill` and `$skill` command behavior for model-instructions and tool set selection.
- [ ] **SYS-01**: Tune instructions and state model so long turns show real execution stages instead of static standby text.

### Out of Scope

- Broad GUI desktop client — local terminal and headless parity first.
- New provider ecosystem overhaul during v1.4; keep routing contract stable unless required for current work.
- Full end-user multi-user collaboration features.

## Context

- `nexagent` should track current operator expectations from Hermes agent (`hermes-agent`), free-code, and codex-fresh.
- Existing donor repos (`~/code/hermes-agent`, `~/code/free-code`, `~/code/codex-fresh/`) provide concrete UX/transport patterns for turn display and TUI ergonomics.
- Current priority is parity with existing working local runtime behavior, not speculative new provider surface.

## Constraints

- **Terminal UX**: maintain operator control under plain terminal constraints and short-width sessions.
- **Compatibility**: keep existing command model stable unless explicitly versioned.
- **Quality**: avoid blind feature adds; every turn UX change needs clear behavior contract.
- **Dependency budget**: prefer incremental architecture changes over broad dependency churn.

## Current State

- Phase 40 and 40.1 are complete in roadmap and requirements traceability.
- Next roadmap target after completion update is Phase 43.1.
- Runtime truth gates for `/continue` and `/finish` now rely on session/provider completion proof.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Keep runtime core headless-first | Avoid reworking model/tool loop while improving UI | ✓ Good |
| Compare against Hermes/free-code/codex-fresh before TUI rewrite | Prevent speculative UI direction | ✓ Good |
| Add explicit truthfulness gates instead of prompt-only discipline | Reduce false completion claims | ⚠️ Revisit |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-27 after Phase 40.1 execution completion*
