# nexagent

Terminal-first AI coding harness for local operator-driven development.

`nexagent` runs a local CLI/TUI, keeps provider and tool execution explicit, and shows turn state so operator can see when work is running, waiting, blocked, or complete.

## What It Does

- Runs Codex-style local coding sessions from terminal.
- Supports provider transport modes:
  - `cli-exec`
  - `http-responses`
  - `codex-http`
- Assembles repo-local instructions, MCP context, runtime state, and memory context into provider prompts.
- Uses the Prompt V2 assembly path by default, with stable/dynamic prompt sections, provider-specific overlays, and bounded runtime context.
- Exposes guarded internal tools for repo reads, writes, diffs, searches, shell commands, and Archivist memory.
- Exposes Nexsight tools for bounded code/data execution, local indexing, and context search with SQLite FTS when available.
- Provides guarded web fetch/search and batch edit helpers for research and multi-file patch workflows.
- Provides slash commands for status, usage, keymap help, persistent goals, Lean-style Nexsight compressed reads/search, Pi-compatible notify/emoji/color/safe-git/SCIP helpers, provider/model/effort control, tools, memory, config, LSP, skill routing, boomerang autonomous task handoffs, mouse behavior, approvals, compaction, file reads/searches, diffs, and image attachments.
- Loads Pi-like extension modules from `.nexagent/extensions`, `.pi/extensions`, `~/.nexagent/extensions`, and `~/.pi/agent/extensions` with lifecycle events, sync slash-command registration, and tool metadata registration.
- Hydrates stdio MCP servers at startup from `.nexagent/mcp.json`, with per-server startup timeouts and deduped server selection.
- Supports `$skill` shorthand for skill routing.
- Supports `!<command>` for guarded shell command transcript output.
- Supports `--yolo` session mode for guarded approval bypass while preserving protected OS-root shell/tool blocks.
- Supports `--debug`, `--debugfile <path.log>`, and `--verbose` for diagnostic logs.
- Supports `/caveman-mode` and `/deadpoolmode` instruction overlays for precise user-facing prose style while preserving code, tool calls, JSON, commands, paths, stack traces, and quoted errors unchanged.
- Shows cockpit-style TUI panels for turn metadata, warning/error lanes, structured actions/results, risk/outcome state, recovery actions, navigation hints, terminal capabilities, MCP/LSP status, and compact key hints.
- Uses OpenTUI as the default interactive shell for the v1.5 terminal UI.

## Repository Layout

- `src/cli.ts` — CLI entrypoint, commands, runtime inspect payloads, GUI rendering
- `src/runtime/` — config, session state, instructions, tools, persistence, memory
- `src/provider*.ts` — provider request routing and transports
- `src/tui/` — terminal primitives
- `src/opentui/` — default interactive OpenTUI shell and runtime view adapter
- `test/` — CLI, provider, runtime config, instructions, and tool tests
- `.nexagent/mcp.json` — repo-local MCP configuration when needed
- `.nexagent/`, `.claude/`, `.planning/`, and other local assistant state directories are ignored unless a specific source file is intentionally tracked
- `~/.nexagent/` — global user settings, skills, and reusable Nexagent assets

## Commands

Install dependencies with Bun if needed:

```bash
bun install
```

Build:

```bash
bun run build
```

Test:

```bash
bun run test
```

Run TypeScript entrypoint in development:

```bash
bun run dev
```

Run built JavaScript after build:

```bash
bun run start
```

Compile platform binaries:

```bash
bun run compile
```

Compile one platform binary:

```bash
bun run compile:linux
bun run compile:macos
bun run compile:windows
```

Development target aliases are supported for Linux builds:

```bash
bun run compile:dev:linux
bun compile dev:linux
```

Runtime flags are passed when launching the built binary:

```bash
./dist/nexagent-linux-x64 --yolo
```

## CLI Usage

Inspect runtime:

```bash
bun run dev
```

Run prompt:

```bash
bun run dev -- run "inspect repo status"
```

Run with YOLO guarded approval bypass:

```bash
bun run dev -- --yolo run "continue current task"
```

Start the local gRPC automation server for external harnesses:

```bash
bun run dev -- grpc --host 127.0.0.1 --port 0
nexagent grpc --host 127.0.0.1 --port 0
```

The server prints `nexagent grpc listening <host:port>` on stdout. It exposes `Health`, `Inspect`, `RunCommand`, `RunPrompt`, and `Stop` from `proto/nexagent.proto`. Keep that proto file with packaged or compiled runtime artifacts so external clients can generate matching stubs. `RunCommand` accepts slash commands and guarded `!` shell commands; plain prompts should use `RunPrompt`.

The gRPC server is an unauthenticated trusted-local automation surface. It only supports loopback hosts (`127.0.0.1` or `localhost`) because `RunCommand` can execute guarded shell commands and `Stop` can terminate the server.

Run the default interactive OpenTUI shell:

```bash
bun run dev
```

OpenTUI is the default interactive path after the v1.5 migration acceptance checks. Current shell work includes the live runtime shell, multiline composer, searchable command palette, slash/skill/model/effort command surfaces, configurable keybinding registry, bounded transcript review, collapsible trace blocks, cockpit warning/action/approval/memory/MCP/LSP surfaces, mouse wheel scrolling, clipboard text paste, multi-image paste/attach chips, edit-tool diff previews, and OSC52 copy feedback. Transcript review uses `PageUp`/`PageDown`, `Ctrl+Up`/`Ctrl+Down`, mouse wheel, `Ctrl+End` for latest output, `Ctrl+T` for trace, and `Ctrl+Y` to copy the selected block. `Ctrl+P` opens the command palette, `Ctrl+O` toggles cockpit, `Ctrl+G` opens config, `Ctrl+V` pastes clipboard text, `Alt+V` pastes clipboard images, and `Ctrl+Q` or `/quit` exits OpenTUI. Use `/keys` to list registry action ids and `/config key <action> <key|clear>` to customize supported shortcuts with conflict checks.

Show launch help:

```bash
bun run dev -- --help
```

Debug a run:

```bash
bun run dev -- --debug --debugfile nexagent-debug.log --verbose run "inspect repo status"
```

`--debug` writes to `/tmp/nexagent-debug-<timestamp>.log`. `--debugfile` accepts `.log` paths under the user home or `/tmp`; bare filenames are stored under `~/.nexagent/debug/`. `--verbose` includes internal prompt/input/output details in debug logs and should be treated as sensitive.

## Configuration

Nexagent now has a Codex-style global home. By default this is `~/.nexagent/`; set `NEXAGENT_HOME` to use a different location for tests or portable installs.

Runtime settings merge in this order:

1. built-in defaults
2. `~/.nexagent/config.json`
3. `~/.nexagent/settings.json`
4. `~/.nexagent/settings.local.json`
5. imported assistant settings such as repo `.claude/settings*.json`
6. repo `.nexagent/settings.json`
7. repo `.nexagent/settings.local.json`
8. repo `.nexagent/config.json`

Repo settings win over global settings. Relative paths inside global settings resolve from `~/.nexagent/`; relative paths inside repo settings resolve from the repo root.

MCP configuration is discovered separately from runtime settings. Nexagent prefers repo `.nexagent/mcp.json`, then global `~/.nexagent/mcp.json`. Legacy repo `.mcp.json` is still recognized for migration compatibility, but it should stay untracked. Duplicate server names are not loaded twice. Stdio MCP servers hydrate during startup. Each server can set `startup_timeout_sec` or `startupTimeoutSec`; values are bounded to prevent a hung server from blocking the shell indefinitely. HTTP MCP definitions remain visible as configured status until an HTTP bridge is available.

Provider registry config lives in `config.json` and currently supports JSON-first provider definitions. Repo `.nexagent/config.json` overrides global `~/.nexagent/config.json`; invalid provider entries are disabled with warnings instead of crashing startup.

Example:

```json
{
  "modelProviders": {
    "codex": {
      "baseUrl": "https://chatgpt.com/backend-api/codex",
      "authSource": "codex-auth-json",
      "wireApi": "responses",
      "supportsWebsockets": true,
      "models": ["gpt-5.4", "gpt-5.5", "gpt-5.3-codex-spark"]
    },
    "openai": {
      "baseUrl": "https://api.openai.com/v1",
      "authSource": "openai-api-key",
      "wireApi": "responses",
      "models": ["gpt-5.4", "gpt-5.5", "gpt-5.2"]
    }
  }
}
```

`gpt-5.3-codex-spark` is available through the Codex ChatGPT backend route (`codex-http` using `/responses`). `codexspark` and `chatgpt-5.3-codex-spark` normalize to the same model slug.

Skills are discovered from repo roots first, then global user roots:

- repo `.nexagent/skills`
- repo `.codex/skills`
- repo `.agents/skills`
- `~/.nexagent/skills`
- `~/.codex/skills`
- `~/.agents/skills`

If two roots define the same skill name, repo-local skill wins.

Prompt assembly defaults to V2:

```json
{
  "prompt": {
    "assembly": "v2"
  }
}
```

Set `"assembly": "legacy"` in `~/.nexagent/settings.local.json` or repo `.nexagent/settings.local.json` only when debugging old prompt behavior. V2 separates stable execution rules, provider transport guidance, and dynamic repo/runtime context with a cache boundary, so provider prompts stay denser and less prone to tool-loop drift.

Sentry error monitoring uses the bundled project DSN by default; set `SENTRY_DSN` to override it for another project. `bun run start` preloads `dist/instrument.js` so Sentry initializes before the built CLI entrypoint.

Optional Sentry environment variables:

- `SENTRY_ENVIRONMENT` — deployment environment label
- `SENTRY_RELEASE` — release version
- `SENTRY_TRACES_SAMPLE_RATE` — tracing sample rate from `0` to `1`; defaults to `1.0` in development and `0.1` otherwise
- `SENTRY_SEND_DEFAULT_PII=false` — opt out of Sentry default PII capture
- `SENTRY_INCLUDE_LOCAL_VARIABLES=true` — opt in to local variable capture in stack frames
- `SENTRY_RECORD_AI_CONTENT=true` — opt in to capturing prompt/output text on AI spans; disabled by default because prompts and model responses can contain sensitive user content
- `SENTRY_ENABLED=false` — disable Sentry even when `SENTRY_DSN` is set

Sentry logs are enabled through `enableLogs: true`. Nexagent records concise provider lifecycle logs and manual AI monitoring spans:

- `gen_ai.invoke_agent` for provider turns
- `gen_ai.request` for model calls, with model/provider/transport metadata and token usage when returned by the provider
- `gen_ai.execute_tool` for internal tool calls

Diagnostic Sentry payloads are tags-only by default. Runtime diagnostics classify command failures, provider transport/auth failures, malformed tool calls, missing evidence gates, blocked/failed tools, compaction state, OpenTUI events, and memory signal counters without sending raw prompts, assistant output, tool output, file content, or transcript text. Use `/status --sentry` for local Sentry health and dry-run self-test details. Use `/status --sentry --send-test-event` only when an explicit test event is wanted.

Compaction can be configured in `.nexagent/settings.json` or `~/.nexagent/settings.json`:

```json
{
  "compaction": {
    "enabled": true,
    "thresholdPercent": 0.5,
    "preserveTurns": 4,
    "modelThresholdOverrides": {
      "gpt-5.4": 0.6
    }
  }
}
```

## Common Runtime Commands

Inside TUI:

- `/help` — command list
- `/keys` — OpenTUI keyboard shortcuts and interaction modes
- `/status` — compact runtime status
- `/status --sentry` — safe Sentry diagnostics and self-test status
- `/provider` — provider status or provider switch
- `/provider transport ...` — transport mode switch
- `/model` — model status or switch; accepts `/model <name> [effort]`
- `/effort` — show or set reasoning effort with `low`, `medium`, `high`, or `xhigh`
- `/tools` — internal tool policy and availability
- `/tools nexsight` — Nexsight store/status helpers
- `/nexsight gather <root> [pattern] [query]` — batch compact maps/signatures from many files in one tool call
- `/nexsight read <path> [auto|full|map|signatures|outline|lines:N-M]` — Lean-style compressed file reads without raw context dumps
- `/nexsight index <path> [pattern]`, `/nexsight search <query>`, `/nexsight stats`, `/nexsight purge`, and `/nexsight doctor` — manage local Nexsight context store
- `/memory` — Archivist memory status, safe signal counters, and commands
- `/memory --maintenance` — merge duplicate Archivist entries into recurrence records and refresh memory diagnostics
- `/usage` — current session provider/model usage table with token totals and cost availability note
- `/todos [pending|in_progress|completed|all|clear]` — show or clear model-managed visual task checklist; active rows also render above the prompt
- `/goal [--tokens 50k] <objective>` — start a persistent autonomous goal with optional token budget; active goal renders above the prompt and can continue across turns
- `/goal status`, `/goal pause`, `/goal resume`, `/goal clear`, and `/goal statusbar on|off` — inspect or manage persistent goal state
- `/btw [--save] <question>` — run hidden side conversation through the current provider without adding it to main conversation context
- `/btw:new [question]`, `/btw:tangent [--save] <question>`, `/btw:clear`, `/btw:inject [instructions]`, and `/btw:summarize [instructions]` — manage side thread lifecycle and handoff back to main agent
- `/agents` — show Claude-style subagent types, active agents, recent results, and background task ids
- `/notify [on|off|status|threshold <ms>]` and `/notify-test` — terminal bell plus OS notification when long turns complete
- `/emoji [status|emoji]` and `/emoji-test` — deterministic or configured session emoji marker
- `/color [status|index]`, `/color-next`, and `/color-set <index>` — deterministic or configured ANSI session color marker
- `/safegit [status|patterns]` — high-risk git mutation guard for force push, hard reset, forced clean, stash deletion, forced branch delete, and reflog expiry
- `/scip [status|symbols <path>|diagnostics <path>|check [path]]` — Pi SCIP compatibility aliases backed by local LSP/static analysis
- `/extensions` — Pi-like extension lifecycle shim status, loaded sources, registered events, commands, tools, and load errors
- `/config` — open the interactive OpenTUI config side window; `/config status` prints provider, UI, memory, LSP, and diagnostics status; `/config key <action> <key|clear>` customizes supported OpenTUI shortcuts
- `/config [set] logo <full|condensed|off>` — persist startup logo mode
- `/config [set] lsp <on|off>` and `/config [set] lsp-index <on|off>` — persist LSP/code-intel toggles
- `/statusline command <shell>` and `/statusline command clear` — configure a bounded custom statusline script; the script receives `NEXAGENT_PROVIDER`, `NEXAGENT_MODEL`, `NEXAGENT_TRANSPORT`, `NEXAGENT_APPROVAL`, `NEXAGENT_CONTEXT_LEFT`, `NEXAGENT_CONTEXT_WINDOW`, `NEXAGENT_TURN_COUNT`, and `NEXAGENT_CWD`
- `/lsp` — inspect local LSP status; enabled by default with no auto-downloads and bounded TypeScript/static fallback
- `/lsp setup` — show configured LSP command, resolved binary path, readiness, and install hint
- `/lsp symbols <path>` and `/lsp diagnostics <path>` — summarize local code intelligence for one project path
- `/lsp check [path]` — bounded workspace/file diagnostics scan that updates LSP problem cache shown in `/config`
- `/lsp health` and `/lsp warm` — inspect LSP cache/idle state and warm configured files from `.nexagent/lsp.json` or `.pi-lens/lsp.json`
- `/lsp nav <definition|references|hover|documentSymbol|workspaceSymbol|implementation|workspaceDiagnostics> [path] [line] [character]` — Pi Lens-inspired navigation; JSON-RPC backed when a language server is available, bounded static fallback otherwise
- `/skill` — list or route skills
- `/boomerang <task>` — run an autonomous task, compact the turn into a handoff summary, and seed Archivist when memory is enabled
- `/boomerang status` and `/boomerang cancel` — inspect or cancel active boomerang mode
- `/attach <image-path>` — queue image attachment for HTTP transports
- `/detach` — clear queued image attachments
- `/mouse` — mouse mode status/config
- `/approval` — approval gate controls
- `/compact` — compaction status/manual compaction
- `/diff`, `/rg`, `/find`, `/read`, `/ls`, `/pwd` — repo-local utility commands
- `!<command>` — guarded shell command transcript output

## Nexsight

Nexsight is the built-in context/code intelligence helper inspired by `context-mode`.
It is meant for tasks that would otherwise dump large raw files or command output into chat.

Current tool surface:

- `nexsight_execute` — run bounded `shell`, `javascript`, or `python` snippets from the session cwd; shell output gets Lean-style compression for noisy logs.
- `nexsight_gather` — batch compact maps/signatures from many files; preferred for audits and phase-doc evidence.
- `nexsight_read` — read files with compressed modes: `auto`, `full`, `map`, `signatures`, `outline`, or `lines:N-M`.
- `nexsight_index` — index a file or text payload into the local search store.
- `nexsight_batch` — index a bounded set of repo text files with ignore rules.
- `nexsight_search` — query indexed excerpts.

Storage lives under `.nexagent/` for local runtime state. When `better-sqlite3` is available, Nexsight uses SQLite FTS; otherwise it falls back to a JSON chunk store.

Use Nexsight for broad repo exploration, counting, parsing, filtering, summarizing, compressed file reads, and context search. Use direct file tools for small known files or exact edits.

## Dogfood Guardrails

Recent dogfood work tightened the provider loop:

- malformed tool-call markup is nudged back into valid internal tool calls instead of leaking raw tags to chat
- file-change claims require write evidence from `write_file`, `apply_patch`, `batch_edit`, or shell edits
- non-actionable "say apply now" replies are nudged to continue when the task is already authorized
- explicit Nexsight tasks are routed back toward Nexsight tools
- tool events include duration and bounded output token estimates for the trace
- Prompt V3 adds an evidence contract: claims are labeled as observed, verified, inferred, assumption, or unknown, and contradictions update verdicts without stopping loop work prematurely.
- Failed tool calls are classified, logged with redacted diagnostics, and stored as Archivist recovery playbooks so later turns can recall working argument shapes or fallback paths.
- Edit tools return bounded unified diff previews; OpenTUI renders changed-file summaries and colored add/remove lines for patch review.
- Command output goes to compact chat blocks, while debug lifecycle detail stays in trace. Turn and tool rows show duration plus input/output token badges.

These guardrails are not a replacement for review. They reduce common harness failure modes while keeping operator-visible trace evidence.

## Safety Model

Internal tools are repo-local and guarded. Shell output is bounded. Shell policy blocks protected OS-root mutations and obvious OS-level destructive commands, including in `--yolo` mode; normal repo/network commands such as `git push` are not blocked by shell policy.

Do not treat `--yolo` as permission to run destructive commands.

Readable reference paths may be broader than writable roots so the model can inspect nearby repositories for context. Writes remain guarded to configured write roots unless explicit yolo/session policy allows a broader write, and protected/system paths stay blocked.

## Development Notes

- Keep docs aligned with implemented code.
- Add or update tests with behavior changes.
- Avoid mass-adding generated local state directories.
- Treat donor projects as references only.
