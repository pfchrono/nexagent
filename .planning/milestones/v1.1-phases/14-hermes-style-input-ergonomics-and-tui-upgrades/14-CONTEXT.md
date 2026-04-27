# Phase 14 Context

Goal: import Hermes-style input ergonomics and stronger TUI progress behavior without creating a second runtime state model.

Repo truth before this phase:
- runtime had first real TUI shell
- no command autocomplete in TUI
- no file/path autocomplete in TUI
- spinner/progress line was thin and local
- no turn token display, even as lightweight estimate

Source refs used:
- `/home/pfchrono/code/hermes-agent/ui-tui/src/app/useInputHandlers.ts`
- `/home/pfchrono/code/hermes-agent/ui-tui/src/app/slash/registry.ts`
- `/home/pfchrono/code/free-code/src/constants/spinnerVerbs.ts`

Scope for `14-01`:
- add slash-command Tab completion
- add repo path Tab completion for local file commands
- improve composer hints and progress line
- reuse shared runtime/session state instead of TUI-only forks
- add lightweight per-turn token estimates from shared session telemetry

Truth boundary:
- this is terminal ergonomics, not full Hermes TUI parity
- token display here is lightweight estimate, not provider-reported billing truth
- unique spinner emblem remains deferred to Phase 14.1
