# Requirements: nexagent

**Defined:** 2026-04-27
**Core Value:** Give operator confidence that every turn is truthful, actionable, and visibly progressing until finished, blocked, or explicitly rerouted.

## v1 Requirements

### Runtime Truth and Continuity

- [ ] **RUNT-01**: Agent continues execution after user request until task completion, explicit block, or approval/cancel gate.
- [ ] **RUNT-02**: System does not claim implementation/testing completion unless corresponding actions and outputs occurred.
- [ ] **RUNT-03**: Turn progress states distinguish running, waiting on approval/permission, blocked, and finished.
- [ ] **RUNT-04**: Recovery behavior after interruption is explicit and visible in transcript/status output.

### TUI and Workspace

- [ ] **TU-01**: `/status`, `/provider`, `/tools`, and `/memory` default outputs are compact and operator-first.
- [ ] **TU-02**: Transcript has persistent scroll behavior with latest-reply anchoring and optional collapsed verbose blocks.
- [ ] **TU-03**: Picker/traces/history views support practical navigation and clear interaction states.
- [ ] **TU-04**: Autocomplete preview and command input feedback become readable on small terminals.

### Skill and Command System

- [ ] **CMD-01**: `/skill` command supports discover, show, and activate workflows for model instruction sets.
- [ ] **CMD-02**: `$skill` entry form lets model call and persist skill metadata for instruction precedence.
- [ ] **CMD-03**: Autocomplete includes command and skill candidates with safe disambiguation.

### Comparative UX and Architecture

- [ ] **ARC-01**: Run one donor-parity audit pass against `hermes-agent`, `free-code`, and `codex-fresh` for progress display and shell UX.
- [ ] **ARC-02**: Decide on TTY rewrite stack path (`native`, `ink`, or `opencode`) with minimum-risk migration plan.
- [ ] **ARC-03**: Add session/command state artifacts used by TUI to avoid duplicated state logic.

### v2 Requirements

Deferred to future milestone.

### Out of Scope

| Feature | Reason |
|---------|--------|
| Full plugin marketplace | Scope too wide for current v1.4 usability goal |
| Native GUI layer | Not terminal-focused milestone objective |
| Full web auth and account system | Not needed for local agent workflow in current phase |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| RUNT-01 | 40.1 | Pending |
| RUNT-02 | 40.1 | Pending |
| RUNT-03 | 40.1 | Pending |
| RUNT-04 | 40.1 | Pending |
| TU-01 | 40 | Pending |
| TU-02 | 41 | Pending |
| TU-03 | 41.1 | Pending |
| TU-04 | 43 | Pending |
| CMD-01 | 45 | Pending |
| CMD-02 | 45 | Pending |
| CMD-03 | 45 | Pending |
| ARC-01 | 43.1 | Pending |
| ARC-02 | 44 | Pending |
| ARC-03 | 44 | Pending |

## Phase Map

### Phase 40
- TU-01

### Phase 40.1
- RUNT-01
- RUNT-02
- RUNT-03
- RUNT-04

### Phase 41
- TU-02

### Phase 41.1
- TU-03

### Phase 42
- (No dedicated v1 requirements yet; inherits RUNT/TU completion quality rules)

### Phase 43
- TU-04

### Phase 43.1
- ARC-01

### Phase 44
- ARC-02
- ARC-03

### Phase 45
- CMD-01
- CMD-02
- CMD-03
- RUNT-04

**Coverage:**
- v1 requirements: 13 total
- Mapped to phases: 13
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-27*
*Last updated: 2026-04-27 after parity planning pass*
