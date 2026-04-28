# Phase 49: cockpit-operator-ux-pack - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md; this log preserves alternatives considered.

**Date:** 2026-04-27
**Phase:** 49-cockpit-operator-ux-pack
**Areas discussed:** Flight strip density, Action ladder source, Warning lane thresholds, Override execution model, Memory split behavior, Auto-save cadence

---

## Flight strip density

| Option | Description | Selected |
|--------|-------------|----------|
| Always full fields | Keep all flight strip fields visible at all widths | |
| Compact when narrow (<120 cols), full when wide | Responsive density based on terminal width | ✓ |
| Minimal always | Mode + risk + approval only | |

**User's choice:** Compact when narrow (<120 cols), full when wide  
**Notes:** Preserve full awareness on normal terminals, reduce clutter on narrow sessions.

---

## Action ladder source of truth

| Option | Description | Selected |
|--------|-------------|----------|
| Runtime events only | Strict event-backed ladder, no inferred fallback | |
| Hybrid runtime events + heuristic fallback | Prefer runtime truth, fill gaps safely when missing | ✓ |
| Heuristic UI-state mapping | Mostly inferred from UI state | |

**User's choice:** Hybrid runtime events + heuristic fallback  
**Notes:** Ladder must remain readable even when runtime signal granularity is incomplete.

---

## Warning lane thresholds

| Option | Description | Selected |
|--------|-------------|----------|
| Blocking/high-risk only | Show only severe hard stops | |
| Warning + blocking | Include elevated warnings and blockers | ✓ |
| All notices | Include low/noise informational notices | |

**User's choice:** Warning + blocking  
**Notes:** Failures should be visible without flooding cockpit with low-value noise.

---

## Pilot override execution model

| Option | Description | Selected |
|--------|-------------|----------|
| Commands only | Slash commands only (`/abort` etc.) | |
| Hotkeys + commands | Hotkeys plus slash aliases | ✓ |
| Hotkeys only | No slash fallback | |

**User's choice:** Hotkeys + commands  
**Notes:** Keep fast cockpit control and explicit command fallback path.

---

## Memory split behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Read-only buckets | Display split only | |
| Buckets + manual save actions | Split plus explicit user-triggered saves | |
| Buckets + auto-save + pre-compaction checkpoint | Automated persistence with compaction safety | ✓ |

**User's choice:** Buckets + auto-save + pre-compaction checkpoint  
**Notes:** Long-session continuity prioritized over manual-only save model.

---

## Auto-save cadence

| Option | Description | Selected |
|--------|-------------|----------|
| Every 10 min + pre-compaction | Frequent timed save + compaction checkpoint | ✓ |
| Every 20 min + pre-compaction | Lower write frequency | |
| Adaptive (15 min or context >80%) | Dynamic trigger | |

**User's choice:** Every 10 min + pre-compaction  
**Notes:** Prefer aggressive capture to reduce loss risk in long sessions.

---

## the agent's Discretion

- Exact risk scoring thresholds and escalation mapping.
- Exact compact string formatting for narrow flight strip render.

## Deferred Ideas

- Full Hermes-like non-animated status strip parity polish.
- Interactive mouse-driven override buttons.
- Persistent cockpit layout profiles.
