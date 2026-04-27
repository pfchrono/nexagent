# Phase 13 Context

Goal: import practical free-code command behaviors and a compact statusline without faking full free-code command parity.

Repo truth before this slice:
- runtime had `/help`, `/provider`, `/login`, local file commands, hooks, and memory inspection
- no `/status`
- no built-in style toggle commands for caveman/deadpool behavior
- no statusline footer in TUI
- command state did not persist across harness restarts

Source refs used:
- `/home/pfchrono/code/free-code/src/commands/status/index.ts`
- `/home/pfchrono/code/free-code/src/commands/caveman-mode/cavemanMode.ts`
- `/home/pfchrono/code/free-code/src/commands/deadpoolmode/deadpoolMode.ts`
- `/home/pfchrono/code/free-code/src/commands/statusline.tsx`

Scope for `13-01`:
- add explicit `/status` runtime snapshot command
- add `/caveman-mode`, `/deadpoolmode`, and `/statusline`
- persist command-mode toggles in `.nexagent/session.json`
- surface statusline footer in TUI from real runtime state
- feed style toggles into prompt assembly so provider turns honor them

Truth boundary:
- donor commands here are adapted, not cloned wholesale
- no full free-code settings system imported
- no token telemetry or advanced status widgets yet
