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
- Provides slash commands for status, provider/model control, tools, memory, skill routing, mouse behavior, approvals, compaction, file reads/searches, diffs, and image attachments.
- Supports `$skill` shorthand for skill routing.
- Supports `!<command>` for guarded shell command transcript output.
- Supports `--yolo` session mode for guarded approval bypass while preserving destructive shell/tool blocks.
- Supports `/cavemanmode` and `/deadpoolmode` instruction overlays for concise/operator-style model replies.
- Shows cockpit-style TUI panels for turn metadata, warnings, structured actions/results, risk/outcome state, recovery actions, navigation hints, and terminal capabilities.
- Includes an opt-in OpenTUI shell baseline via `--opentui` for the ongoing v1.5 terminal UI rewrite.

## Repository Layout

- `src/cli.ts` — CLI entrypoint, commands, TUI rendering, GUI rendering
- `src/runtime/` — config, session state, instructions, tools, persistence, memory
- `src/provider*.ts` — provider request routing and transports
- `src/tui/` — terminal primitives
- `src/opentui/` — opt-in OpenTUI shell baseline and runtime view adapter
- `test/` — CLI, provider, runtime config, instructions, and tool tests
- `.planning/` — project roadmap, state, requirements, phase artifacts, audits
- `.nexagent/`, `.claude/`, `.mcp.json` — repo-local runtime and assistant configuration
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

Run the opt-in OpenTUI shell baseline:

```bash
bun run dev -- --opentui
```

OpenTUI is not the default path yet. Current shell work is focused on boot/render/input safety before the composer, command surface, transcript scroll, and cockpit controls are moved over.

## Configuration

Nexagent now has a Codex-style global home. By default this is `~/.nexagent/`; set `NEXAGENT_HOME` to use a different location for tests or portable installs.

Settings merge in this order:

1. built-in defaults
2. `~/.nexagent/settings.json`
3. `~/.nexagent/settings.local.json`
4. imported assistant settings such as repo `.claude/settings*.json`
5. repo `.nexagent/settings.json`
6. repo `.nexagent/settings.local.json`

Repo settings win over global settings. Relative paths inside global settings resolve from `~/.nexagent/`; relative paths inside repo settings resolve from the repo root.

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

## Common Runtime Commands

Inside TUI:

- `/help` — command list
- `/status` — compact runtime status
- `/provider` — provider status or provider switch
- `/provider transport ...` — transport mode switch
- `/model` — model status or switch
- `/tools` — internal tool policy and availability
- `/tools nexsight` — Nexsight store/status helpers
- `/memory` — Archivist memory status and commands
- `/skill` — list or route skills
- `/attach <image-path>` — queue image attachment for HTTP transports
- `/mouse` — mouse mode status/config
- `/approval` — approval gate controls
- `/compact` — compaction status/manual compaction
- `/diff`, `/rg`, `/find`, `/read`, `/ls`, `/pwd` — repo-local utility commands
- `!<command>` — guarded shell command transcript output

## Nexsight

Nexsight is the built-in context/code intelligence helper inspired by `context-mode`.
It is meant for tasks that would otherwise dump large raw files or command output into chat.

Current tool surface:

- `nexsight_execute` — run bounded `shell`, `javascript`, or `python` snippets from the session cwd.
- `nexsight_index` — index a file or text payload into the local search store.
- `nexsight_batch` — index a bounded set of repo text files with ignore rules.
- `nexsight_search` — query indexed excerpts.

Storage lives under `.nexagent/` for local runtime state. When `better-sqlite3` is available, Nexsight uses SQLite FTS; otherwise it falls back to a JSON chunk store.

Use Nexsight for broad repo exploration, counting, parsing, filtering, summarizing, and context search. Use direct file tools for small known files or exact edits.

## Dogfood Guardrails

Recent dogfood work tightened the provider loop:

- malformed tool-call markup is nudged back into valid internal tool calls instead of leaking raw tags to chat
- file-change claims require write evidence from `write_file`, `apply_patch`, `batch_edit`, or shell edits
- non-actionable "say apply now" replies are nudged to continue when the task is already authorized
- explicit Nexsight tasks are routed back toward Nexsight tools
- tool events include duration and bounded output token estimates for the trace

These guardrails are not a replacement for review. They reduce common harness failure modes while keeping operator-visible trace evidence.

## Safety Model

Internal tools are repo-local and guarded. Shell output is bounded. Destructive shell patterns remain blocked, including in `--yolo` mode.

Do not treat `--yolo` as permission to run destructive commands.

Readable reference paths may be broader than writable roots so the model can inspect nearby repositories for context. Writes remain guarded to configured write roots unless explicit yolo/session policy allows a broader write, and protected/system paths stay blocked.

## Planning State

Current planning truth lives under `.planning/`.

Read these before major changes:

- `.planning/PROJECT.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `.planning/REQUIREMENTS.md`

## Development Notes

- Keep docs aligned with implemented code.
- Add or update tests with behavior changes.
- Avoid mass-adding generated local state directories.
- Treat donor projects as references only.
