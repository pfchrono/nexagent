# Roadmap: nexagent v1.4

Source: promoted from `.planning/NEXT-MILESTONE.md`.

## Overview

`v1.4` turns current improved-but-still-rough TTY into intentionally designed operator console with redesign-first iteration, cleaner diagnostics, better transcript flow, stronger approval UX, and thinner runtime/UI boundaries.
Parities are explicit: don’t ship blindly, compare UX and turn-flow behaviors against Hermes, free-code, and codex-fresh where practical.

## Phases

- [x] **Phase 43.1: TTY redesign pass** - Push transcript/tool/result styling and overall terminal identity closer to donor quality bar without cloning donor look. (completed 2026-04-27)
- [x] **Phase 40: Diagnostics surface redesign** - Replace flat dumps with compact operator-facing summaries and explicit detail layers. (completed 2026-04-27)
- [x] **Phase 40.1: Turn workflow and truthful execution hardening** - Make continue-until-done behavior, verification honesty, and long-turn state reliable. (completed 2026-04-27)
- [x] **Phase 41: Transcript pane scrollback and collapsed trace blocks** - Keep newest answer visible while letting long transcript/tool output stay navigable. (completed 2026-04-27)
- [x] **Phase 41.1: Picker and trace interaction polish** - Make history/model pickers and trace interaction feel like real console controls instead of thin utilities. (completed 2026-04-27)
- [x] **Phase 42: Approval and control card UX** - Make approval, cancel, and steer states obvious and action-driven inside workspace. (completed 2026-04-27)
- [x] **Phase 43: Composer and statusline polish** - Improve input container, footer signal density, autocomplete preview, and focus mode. (completed 2026-04-27)
- [x] **Phase 44: TUI/runtime module split** - Break `src/cli.ts` into safer renderer/input/runtime boundaries. (completed 2026-04-27)
- [x] **Phase 45: Future capability prep** - Lock staged contracts for `--yolo`, image paste, and remaining parked runtime UX work. (completed 2026-04-27)
- [x] **Phase 46: YOLO guarded-mode implementation** - Implement runtime `--yolo` session behavior with explicit safety floor and persistent UI signal. (completed 2026-04-28)
- [x] **Phase 47: Image attachment pipeline baseline** - Implement provider-gated image attachment flow for local files/paste-ready payload path. (completed 2026-04-27)
- [x] **Phase 48: Skill command baseline (`/skill` + `$skill`)** - Implement minimal usable skill listing/lookup/dispatch routing in TTY. (completed 2026-04-28)
- [x] **Phase 48.1: Dual mouse interaction mode** - Restore wheel scroll while preserving drag-highlight copy workflow in terminal sessions. (completed 2026-04-28)
- [x] **Phase 49: Cockpit operator UX pack** - Add pinned flight strip, intent ladder, pilot overrides, and split memory panel semantics. (completed 2026-04-28)

## Phase Details

### Phase 43.1: TTY redesign pass
**Goal**: raise overall TTY quality bar toward donor-level clarity while keeping `nexagent` identity distinct.
**Depends on**: Nothing
**Success Criteria** (what must be TRUE):
  1. Transcript/result/tool blocks have stronger hierarchy.
  2. Response emphasis and spacing materially improve scanability.
  3. TTY looks intentionally designed, not partially repaired.
  4. New styles map to one donor reference style chosen for phase.
**Plans**: `43.1-01`

### Phase 40: Diagnostics surface redesign
**Goal**: make runtime diagnostics answer operator questions quickly instead of dumping raw state.
**Depends on**: Phase 43.1
**Success Criteria** (what must be TRUE):
  1. `/status`, `/provider`, `/tools`, and `/memory` have compact default output.
  2. Deeper internals remain reachable through explicit detail/verbose modes.
  3. Transcript rendering makes command-result boundaries clearer than current flat blob.
**Plans**: `40-01`

### Phase 40.1: Turn workflow and truthful execution hardening
**Goal**: make agent continue, verify, and report like working harness instead of motivational chatbot.
**Depends on**: Phase 40
**Success Criteria** (what must be TRUE):
  1. When user says continue/start/finish, harness keeps running until done, blocked, or approval gate.
  2. Agent stops claiming implementation/testing happened when it did not.
  3. Long-turn progress states distinguish running, pending, blocked, and finished more clearly.
  4. Task completion claims require explicit completion signal from runtime, not only response tone.
**Plans**: `40.1-01`

### Phase 41: Transcript pane scrollback and collapsed trace blocks
**Goal**: let workspace carry long-running work without burying latest useful reply.
**Depends on**: Phase 40.1
**Success Criteria** (what must be TRUE):
  1. Transcript pane has bounded scroll state.
  2. Verbose tool/command blocks collapse by default.
  3. Latest assistant answer stays visually anchored.
  4. Operator can highlight transcript text and copy it back out, with visible copied character count feedback on `Ctrl+C`.
  5. Mouse-wheel and keyboard scroll both work against real transcript bounds.
**Plans**: `41-01`

### Phase 41.1: Picker and trace interaction polish
**Goal**: turn history/model/trace controls into polished console interactions.
**Depends on**: Phase 41
**Success Criteria** (what must be TRUE):
  1. History popup is easy to browse and preview from persisted repo-local history.
  2. `/model` chooser is usable without falling back to raw slash output.
  3. Trace blocks have clear expand/collapse interaction and state.
**Plans**: `41.1-01`

### Phase 42: Approval and control card UX
**Goal**: make risky-action decisions obvious and less blob-like.
**Depends on**: Phase 41.1
**Success Criteria** (what must be TRUE):
  1. Pending approval shows as dedicated card/block.
  2. Approve/reject paths are obvious in workspace.
  3. Cancel/steer state presentation is clearer during active work.
**Plans**: `42-01`

### Phase 43: Composer and statusline polish
**Goal**: make input and footer feel deliberate instead of merely functional.
**Depends on**: Phase 42
**Success Criteria** (what must be TRUE):
  1. Composer has stronger visual ownership.
  2. Statusline is more legible and higher-signal.
  3. Autocomplete preview and focus-mode behavior feel intentional.
**Plans**: `43-01`

### Phase 44: TUI/runtime module split
**Goal**: reduce UI iteration risk by shrinking `src/cli.ts` responsibilities.
**Depends on**: Phase 43
**Success Criteria** (what must be TRUE):
  1. Renderer/input/runtime shell concerns are split cleanly.
  2. Headless/runtime truth remains unchanged.
  3. Future TTY changes no longer require editing one giant file.
  4. Framework path decision for larger TTY rewrite (`ink`/`opencode`) is documented.
**Plans**: `44-01`

### Phase 45: Future capability prep
**Goal**: convert parked future ideas into real staged contracts and smallest safe slices.
**Depends on**: Phase 44
**Success Criteria** (what must be TRUE):
  1. `--yolo` guarded-no-approval mode has explicit contract.
  2. Image-paste / attachment flow has explicit provider-gated contract.
  3. Remaining compaction/runtime UX follow-through is staged honestly.
  4. `/skill` and `$skill` command/selection workflows have minimal usable baseline.
  5. Promoted old out-of-scope systems are explicitly routed into next-milestone planning instead of left as buried notes.
**Plans**: `45-01`

### Phase 46: YOLO guarded-mode implementation
**Goal**: implement `--yolo` mode from contract with non-destructive safety floor preserved.
**Depends on**: Phase 45
**Success Criteria** (what must be TRUE):
  1. `--yolo` flag sets session approval gate off for guarded tools.
  2. Destructive shell/tool deny rules remain enforced.
  3. Footer/status output visibly indicates YOLO session state.
  4. Session-scoped behavior is explicit and auditable.
**Plans**: `46-01`

### Phase 47: Image attachment pipeline baseline
**Goal**: deliver first provider-gated attachment flow for image input.
**Depends on**: Phase 46
**Success Criteria** (what must be TRUE):
  1. Operator can attach image path into composer workflow.
  2. Unsupported provider/mode paths fail with explicit reason.
  3. Attachment metadata surfaces in composer before send.
  4. Request payload includes image metadata for supported transports.
**Plans**: `47-01`

### Phase 48: Skill command baseline (`/skill` + `$skill`)
**Goal**: add minimal usable skill discovery and command routing in terminal workflow.
**Depends on**: Phase 47
**Success Criteria** (what must be TRUE):
  1. `/skill` lists available skills.
  2. `/skill <name>` resolves deterministic lookup and route path.
  3. `$skill` shorthand maps into skill routing with args preserved.
  4. Unknown skill errors include deterministic closest-match guidance.
**Plans**: `48-01`

### Phase 48.1: Dual mouse interaction mode
**Goal**: support both mouse-wheel transcript scrolling and native terminal drag-selection copy in the same TTY workflow.
**Depends on**: Phase 48
**Success Criteria** (what must be TRUE):
  1. Mouse-wheel scroll works in transcript pane again.
  2. Drag highlight + clipboard copy still works without disabling scroll.
  3. Behavior is deterministic across startup/reload and clearly surfaced in status/help text.
  4. If terminal capability conflicts, runtime offers explicit mode toggle/fallback with user-visible notice.
**Plans**: `48.1-01`

### Phase 49: Cockpit operator UX pack
**Goal**: shift TUI from generic chat shell to cockpit-style operator console with explicit control/situational-awareness surfaces.
**Depends on**: Phase 48.1
**Success Criteria** (what must be TRUE):
  1. Top pinned flight strip always shows mode, provider/model, context left, approval gate, memory status, and risk state.
  2. Per-turn action ladder renders `intent -> plan -> act -> result` separately from raw trace.
  3. Warning card lane elevates runtime failures/blocks with actionable next step text.
  4. Pilot override row exposes explicit controls for `ABORT`, `HOLD`, `REPLAN`, and `REQ-APPROVAL`.
  5. Memory panel split clearly distinguishes session context, retrieved memory, and saved checkpoints.
**Plans**: `49-01`

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 43.1. TTY redesign pass | 1/1 | Complete | `43.1-01` |
| 40. Diagnostics surface redesign | 1/1 | Complete    | 2026-04-27 |
| 40.1. Turn workflow and truthful execution hardening | 1/1 | Complete    | 2026-04-27 |
| 41. Transcript pane scrollback and collapsed trace blocks | 1/1 | Complete | `41-01` |
| 41.1. Picker and trace interaction polish | 1/1 | Complete | `41.1-01` |
| 42. Approval and control card UX | 1/1 | Complete | `42-01` |
| 43. Composer and statusline polish | 1/1 | Complete | `43-01` |
| 44. TUI/runtime module split | 1/1 | Complete | `44-01` |
| 45. Future capability prep | 1/1 | Complete | `45-01` |
| 46. YOLO guarded-mode implementation | 1/1 | Complete    | 2026-04-28 |
| 47. Image attachment pipeline baseline | 1/1 | Complete | `47-01` |
| 48. Skill command baseline (`/skill` + `$skill`) | 1/1 | Complete | `48-01` |
| 48.1. Dual mouse interaction mode | 1/1 | Complete | `48.1-01` |
| 49. Cockpit operator UX pack | 1/1 | Complete | `49-01` |

## Phase-to-Requirement Map

### 43.1 TTY redesign pass
- ARC-01

### 40 Diagnostics surface redesign
- TU-01

### 40.1 Turn workflow hardening
- RUNT-01
- RUNT-02
- RUNT-03
- RUNT-04

### 41 Transcript scrollback
- TU-02

### 41.1 Picker and trace polish
- TU-03

### 42 Approval and control card UX
- RUNT-01

### 43 Composer and statusline polish
- TU-04

### 44 TUI/runtime module split
- ARC-02
- ARC-03

### 45 Future capability prep
- CMD-01
- CMD-02
- CMD-03

### 46 YOLO guarded-mode implementation
- CMD-01

### 47 Image attachment pipeline baseline
- CMD-02

### 48 Skill command baseline
- CMD-03

### 48.1 Dual mouse interaction mode
- TU-02

### 49 Cockpit operator UX pack
- TU-01
- TU-02
- TU-04

## Backlog

### Phase 999.1: Investigate token-savior memory integration for nexagent (BACKLOG)

**Goal:** Captured for future planning
**Requirements:** TBD
**Plans:** 1/1 plans complete

Plans:
- [ ] TBD (promote with `$gsd-review-backlog` when ready)

### Phase 50: Live turn streaming render (paced reply)

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 49
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 50 to break down)

### Phase 51: Turn header metadata badges (timestamp/mode/provider/tools/duration/tokens)

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 50
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 51 to break down)

### Phase 52: Structured turn blocks (intent/actions/result/next-step)

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 51
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 52 to break down)

### Phase 53: Collapsible execution trace with evidence chips

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 52
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 53 to break down)

### Phase 54: Diff-style change summary card per turn

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 53
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 54 to break down)

### Phase 55: Confidence and risk badge semantics per turn

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 54
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 55 to break down)

### Phase 56: Explicit per-turn outcome footer (completed/blocked/failed/waiting)

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 55
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 56 to break down)

### Phase 57: User intent echo line at turn start

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 56
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 57 to break down)

### Phase 58: Pinned warning and error lane above transcript

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 57
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 58 to break down)

### Phase 59: Scroll and selection UX polish

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 58
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 59 to break down)

### Phase 60: Turn card density controls

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 59
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 60 to break down)

### Phase 61: Inline action chips for recovery

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 60
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 61 to break down)

### Phase 62: Keyboard-first cockpit navigation

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 61
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 62 to break down)

### Phase 63: Terminal capability diagnostics panel

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 62
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 63 to break down)
