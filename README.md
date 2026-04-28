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
- Exposes guarded internal tools for repo reads, writes, diffs, searches, shell commands, and Archivist memory.
- Provides slash commands for status, provider/model control, tools, memory, skill routing, mouse behavior, approvals, compaction, file reads/searches, diffs, and image attachments.
- Supports `$skill` shorthand for skill routing.
- Supports `!<command>` for guarded shell command transcript output.
- Supports `--yolo` session mode for guarded approval bypass while preserving destructive shell/tool blocks.
- Shows cockpit-style TUI panels for turn metadata, warnings, structured actions/results, risk/outcome state, recovery actions, navigation hints, and terminal capabilities.

## Repository Layout

- `src/cli.ts` — CLI entrypoint, commands, TUI rendering, GUI rendering
- `src/runtime/` — config, session state, instructions, tools, persistence, memory
- `src/provider*.ts` — provider request routing and transports
- `src/tui/` — terminal primitives
- `test/` — CLI, provider, runtime config, instructions, and tool tests
- `.planning/` — project roadmap, state, requirements, phase artifacts, audits
- `.nexagent/`, `.claude/`, `.mcp.json` — local runtime and assistant configuration

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

## Common Runtime Commands

Inside TUI:

- `/help` — command list
- `/status` — compact runtime status
- `/provider` — provider status or provider switch
- `/provider transport ...` — transport mode switch
- `/model` — model status or switch
- `/tools` — internal tool policy and availability
- `/memory` — Archivist memory status and commands
- `/skill` — list or route skills
- `/attach <image-path>` — queue image attachment for HTTP transports
- `/mouse` — mouse mode status/config
- `/approval` — approval gate controls
- `/compact` — compaction status/manual compaction
- `/diff`, `/rg`, `/find`, `/read`, `/ls`, `/pwd` — repo-local utility commands
- `!<command>` — guarded shell command transcript output

## Safety Model

Internal tools are repo-local and guarded. Shell output is bounded. Destructive shell patterns remain blocked, including in `--yolo` mode.

Do not treat `--yolo` as permission to run destructive commands.

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
