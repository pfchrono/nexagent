---
phase: 41-transcript-pane-scrollback-and-collapsed-trace-blocks
plan: 01
subsystem: "[primary category]"
tags: [tui, transcript, trace, clipboard]
provides: [bounded-transcript-scroll, collapsed-trace-default, copy-feedback]
affects: [runtime-tui-interaction, workspace-footer]
tech-stack:
  added: []
  patterns: [double-ctrl-c-exit-guard, clipboard-fallback-chain]
key-files:
  created: []
  modified: [src/cli.ts]
key-decisions:
  - "Ctrl+C now copies latest useful transcript payload; double Ctrl+C exits."
  - "Trace panel remains collapsed by default even after turn completion."
patterns-established:
  - "Copy status surfaces in footer/activity with short TTL."
duration: "22min"
completed: 2026-04-27
---

# Phase 41: transcript-pane-scrollback-and-collapsed-trace-blocks Summary

Implemented transcript UX upgrades for phase 41: bounded scroll navigation stays stable, trace defaults collapsed, and Ctrl+C now gives explicit copy-count feedback while preserving fast exit via double press.

## Performance

- **Duration:** 22min
- **Tasks:** 3
- **Files modified:** 1

## Accomplishments

- Added copy workflow in TTY: first `Ctrl+C` copies latest assistant/user/transcript payload and shows copied character count; second quick `Ctrl+C` exits.
- Kept trace content collapsible by default outside pending state so verbose trace/tool details do not flood transcript.
- Preserved bounded transcript scroll behavior with keyboard/mouse controls and explicit footer scroll status.

## Task Commits

1. **Task 1: Transcript + trace + copy interaction pass** - `n/a (working tree changes only)`

## Files Created/Modified

- `src/cli.ts` - Adds copy feedback UX, clipboard fallback chain, persistent collapsed-trace behavior, and footer/status hint updates.

## Decisions & Deviations

- Kept exit ergonomics by using double-press `Ctrl+C` instead of removing quick exit path.
- Preferred safe clipboard fallback chain (`pbcopy`/`wl-copy`/`xclip`/`clip.exe`/OSC52) to avoid platform lock-in.

## Next Phase Readiness

Phase 41 interaction baseline now ready for phase 41.1 picker/trace polish and phase 42 approval/control card UX.
