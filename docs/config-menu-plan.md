# Config Menu Plan

Goal: make `/config` a full interactive settings surface instead of status text plus command snippets.

## Current State

- `/config status` renders config sections in transcript.
- OpenTUI already has a config panel model with selected row state and mouse row click hooks.
- Core toggles exist for logo, mouse mode, LSP, and LSP Archivist indexing.
- `Ctrl+G` is advertised as config shortcut and should always open same menu as `/config`.

## Target UX

- `/config` and `Ctrl+G` open same modal menu.
- Menu supports keyboard and mouse:
  - Up/Down or mouse hover moves row selection.
  - Enter or click toggles/selects current row.
  - Left/Right changes segmented values.
  - Esc closes without losing existing session state.
  - `/` or text input filters settings.
- Rows show current value, persistence scope, and effect:
  - `Logo` -> `full | condensed | off`
  - `Mouse` -> `auto | scroll | select | off`
  - `Model` -> provider/model picker handoff
  - `Effort` -> `low | medium | high | xhigh` when provider supports it
  - `Approval` -> current guarded tool mode
  - `Memory` -> Archivist on/off, maintenance, checkpoint
  - `MCP` -> server hydration status, retry, disable, timeout
  - `LSP` -> enabled, index Archivist, server profiles, restart
  - `Diagnostics` -> Sentry status, redaction mode, debug log path
- Every row has stable command equivalent shown in detail line.
- Transient session changes and persisted config writes are visually distinct.

## Implementation Phases

1. Menu model:
   - Add typed `ConfigMenuItem` and `ConfigMenuSection` in `src/opentui/`.
   - Generate menu from runtime config instead of rendering flat strings.
   - Include `id`, `label`, `value`, `choices`, `description`, `command`, `persisted`.

2. Input router:
   - Route `/config`, `/config status`, and `Ctrl+G` through same panel state.
   - Add keyboard handlers for selection, left/right choice cycling, Enter apply, Esc close.
   - Keep command-mode usage backwards compatible.

3. Persistence:
   - Persist durable settings to `.nexagent/config.json` first, then `~/.nexagent/config.json`.
   - Keep session-only switches marked as session-only.
   - Write through existing config save helpers or add atomic JSON write helper.

4. Feedback:
   - After apply, append concise command block: setting, old value, new value, scope.
   - Keep low-level config debug in trace only.
   - Emit diagnostic only on failed persistence or invalid setting.

5. Tests:
   - Unit test menu model rows and command mapping.
   - OpenTUI keyboard tests for `Ctrl+G`, arrow movement, Enter toggle, Esc close.
   - Command tests for `/config set ...` compatibility.
   - Snapshot-style runtime view test for visible values.

## Acceptance

- `Ctrl+G` opens config menu from normal composer state.
- `/config` opens interactive menu; `/config status` still prints status.
- Mouse click toggles boolean rows and cycles segmented rows.
- Keyboard can change every listed setting without typing command syntax.
- Invalid settings show user-facing error, with detailed diagnostic only in trace.
