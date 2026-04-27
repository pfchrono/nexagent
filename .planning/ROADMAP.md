# Roadmap: nexagent v1.4

Source: promoted from `.planning/NEXT-MILESTONE.md`.

## Overview

`v1.4` turns current improved-but-still-rough TTY into intentionally designed operator console with redesign-first iteration, cleaner diagnostics, better transcript flow, stronger approval UX, and thinner runtime/UI boundaries.
Parities are explicit: don’t ship blindly, compare UX and turn-flow behaviors against Hermes, free-code, and codex-fresh where practical.

## Phases

- [ ] **Phase 43.1: TTY redesign pass** - Push transcript/tool/result styling and overall terminal identity closer to donor quality bar without cloning donor look.
- [x] **Phase 40: Diagnostics surface redesign** - Replace flat dumps with compact operator-facing summaries and explicit detail layers. (completed 2026-04-27)
- [x] **Phase 40.1: Turn workflow and truthful execution hardening** - Make continue-until-done behavior, verification honesty, and long-turn state reliable. (completed 2026-04-27)
- [ ] **Phase 41: Transcript pane scrollback and collapsed trace blocks** - Keep newest answer visible while letting long transcript/tool output stay navigable.
- [ ] **Phase 41.1: Picker and trace interaction polish** - Make history/model pickers and trace interaction feel like real console controls instead of thin utilities.
- [ ] **Phase 42: Approval and control card UX** - Make approval, cancel, and steer states obvious and action-driven inside workspace.
- [ ] **Phase 43: Composer and statusline polish** - Improve input container, footer signal density, autocomplete preview, and focus mode.
- [ ] **Phase 44: TUI/runtime module split** - Break `src/cli.ts` into safer renderer/input/runtime boundaries.
- [ ] **Phase 45: Future capability prep** - Lock staged contracts for `--yolo`, image paste, and remaining parked runtime UX work.

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

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 43.1. TTY redesign pass | 1/1 | Complete | `43.1-01` |
| 40. Diagnostics surface redesign | 1/1 | Complete    | 2026-04-27 |
| 40.1. Turn workflow and truthful execution hardening | 1/1 | Complete    | 2026-04-27 |
| 41. Transcript pane scrollback and collapsed trace blocks | 0/1 | Pending | `—` |
| 41.1. Picker and trace interaction polish | 0/1 | Pending | `—` |
| 42. Approval and control card UX | 0/1 | Pending | `—` |
| 43. Composer and statusline polish | 0/1 | Pending | `—` |
| 44. TUI/runtime module split | 0/1 | Pending | `—` |
| 45. Future capability prep | 0/1 | Pending | `—` |

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
