# LSP Integration Plan

Goal: replace static symbol/TODO scanning with real language-server-backed code intelligence while preserving current lightweight fallback.

## Current State

- `src/runtime/lsp.ts` provides bounded static helpers for symbols and diagnostics.
- `/lsp status`, `/lsp symbols <path>`, and `/lsp diagnostics <path>` exist.
- Config has `session.lsp.enabled`, `command`, `args`, and `indexArchivist`.
- No JSON-RPC client, process lifecycle, file sync, workspace diagnostics, hover, definition, references, or code action support exists yet.

## OpenCode Reference Shape

Local reference files in `~/code/opencode/packages/opencode/src/lsp/` show useful architecture split:

- `config/lsp.ts` validates builtin and custom server definitions.
- `lsp/server.ts` lists server profiles.
- `lsp/launch.ts` starts language server processes.
- `lsp/client.ts` owns JSON-RPC client behavior.
- `lsp/diagnostic.ts` handles diagnostics.
- `tool/lsp.ts` exposes agent-facing LSP tools.
- TUI sidebar/status surfaces show LSP server state and activation.

Nexagent should copy architecture pattern, not code wholesale.

## Target Runtime

- LSP manager owns server registry, processes, JSON-RPC clients, and file-to-server routing.
- Servers activate lazily when a supported file is read or explicitly through `/lsp start`.
- Startup has timeout, cancellation, stderr capture, and clean shutdown.
- Each server records status: `disabled | configured | starting | ready | failed | stopped`.
- Static scanner remains fallback when no server is configured or startup fails.
- LSP state appears in `/config`, `/lsp status`, status dialogs, and trace diagnostics.

## Tool Surface

Internal tools:

- `lsp_status` -> server status, roots, file extensions, last error.
- `lsp_symbols` -> document symbols from server, fallback scanner if unavailable.
- `lsp_diagnostics` -> publishDiagnostics cache and fallback static diagnostics.
- `lsp_hover` -> hover at file/line/character.
- `lsp_definition` -> definition locations.
- `lsp_references` -> references with bounded count.
- Later: `lsp_code_actions`, `lsp_rename`, `lsp_format`.

Slash commands:

- `/lsp status`
- `/lsp start [server]`
- `/lsp stop [server]`
- `/lsp restart [server]`
- `/lsp symbols <path>`
- `/lsp diagnostics <path>`
- `/lsp hover <path>:<line>:<col>`

## Config

Config sources:

1. repo `.nexagent/config.json`
2. user `~/.nexagent/config.json`
3. runtime `/config` session overrides

Shape:

```json
{
  "lsp": {
    "enabled": true,
    "startupTimeoutMs": 10000,
    "servers": {
      "typescript": {
        "command": "typescript-language-server",
        "args": ["--stdio"],
        "extensions": [".ts", ".tsx", ".js", ".jsx"]
      }
    }
  }
}
```

Deduping:

- Merge by server id.
- Repo config overrides user config for same id.
- Runtime override wins for current session.
- Same command/extensions under different ids should warn, not double-start.

## Implementation Phases

1. Config schema and server profiles:
   - Add typed LSP config loader.
   - Seed TypeScript profile only.
   - Show missing binary as configured-but-not-running.

2. Process and JSON-RPC client:
   - Spawn stdio server with timeout.
   - Implement `initialize`, `initialized`, `shutdown`, `exit`.
   - Track stderr tail for diagnostics.

3. File lifecycle:
   - Root detection from repo root and nearest config markers.
   - `didOpen`, `didChange`, `didClose` for files touched by tools.
   - Debounced diagnostics cache.

4. Agent tools:
   - Wire current `/lsp symbols` and `/lsp diagnostics` through manager.
   - Add hover/definition/references after status/symbols are stable.
   - Keep fallback output explicit: `source=static-fallback`.

5. TUI:
   - Add LSP section to config menu.
   - Show active server count and latest diagnostic count.
   - Add compact trace rows for start/ready/fail/restart.

6. Verification:
   - Unit test JSON-RPC framing with fake server.
   - Integration test with fake LSP process script.
   - Runtime test: read TypeScript file -> lazy start -> symbols.
   - Failure test: startup timeout -> fallback scanner -> diagnostic row.

## Acceptance

- `/lsp status` explains disabled, missing command, starting, ready, failed, and fallback states.
- Reading supported file can lazy-start configured server when enabled.
- `/lsp symbols src/runtime/lsp.ts` returns server symbols when ready and fallback symbols otherwise.
- Failed server startup never blocks normal tool use.
- `/config` can enable/disable LSP, restart server, and toggle Archivist indexing.
