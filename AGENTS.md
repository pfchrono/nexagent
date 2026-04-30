# AGENTS.md

Canonical guidance for coding agents working in `nexagent`.

`nexagent` is a working local terminal-first AI coding harness. Treat repo code, config, tests, and `README.md` as current operating truth. Do not assume upstream Free-Code, Hermes, OpenCode, or Codex behavior exists unless matching implementation exists here.

## Current Runtime

- TypeScript CLI/runtime under `src/`
- terminal TUI in `src/cli.ts`
- provider transports: `cli-exec`, `http-responses`, `codex-http`
- layered prompt/instruction assembly in `src/runtime/instructions.ts`
- guarded repo-local internal tools:
  - `read_file`
  - `write_file`
  - `apply_patch`
  - `list_dir`
  - `search_content`
  - `search_files`
  - `git_status`
  - `git_diff`
  - `shell_command`
  - `archivist_save`
  - `archivist_checkpoint`
- slash commands including `/status`, `/provider`, `/model`, `/tools`, `/memory`, `/skill`, `/attach`, `/mouse`, `/approval`, `/compact`, `/diff`, `/rg`
- `$skill` shorthand routed into `/skill`
- guarded `!<command>` shell transcript command
- `--yolo` session mode that bypasses guarded approvals while preserving destructive shell/tool blocks
- provider-gated image attachment flow for HTTP transports
- cockpit-style TUI surfaces: paced assistant replies, turn metadata, warning lane, turn blocks, risk/outcome/action rows, navigation hints, capability panel
- opt-in OpenTUI sidecar via `--opentui` with multiline composer, command/skill overlays, bounded transcript blocks, collapsible trace blocks, mouse wheel transcript scroll, and OSC52 selected-block copy feedback

## Canonical Docs

- `AGENTS.md` is canonical agent guidance.
- `CLAUDE.md` exists only as compatibility shim and should point here.
- `README.md` is canonical user-facing project overview.
- Archived historical docs live under `archive/`.

Do not split durable agent instructions between `AGENTS.md` and `CLAUDE.md`.

## Commands

Use existing package scripts only:

- `bun run build` — TypeScript compile
- `bun run test` or `bun test ./test/*.test.ts` — test suite
- `bun run dev` — run TypeScript CLI via loader
- `bun run start` — run built `dist/cli.js`
- `bun run compile` — build platform binaries

Do not invent commands. If command surface changes, update `package.json`, `README.md`, and this file.
If a new launch switch is added or removed in `parseCommand`, update `formatLaunchHelp()` and tests so `nexagent --help` stays complete.

## Debugging Runtime

- Use `--debug` to create a diagnostic log at `/tmp/nexagent-debug-<timestamp>.log`.
- Use `--debugfile <name>.log` or a `.log` path under the user home or `/tmp` for a specific diagnostic file. Do not allow debug logs in protected system paths such as `/etc`, `/usr`, `/bin`, or `/var`.
- Use `--verbose` with debug logging when internal core prompt/input/output is needed for diagnosis. Treat verbose debug logs as sensitive because they can contain prompts, tool traces, provider payloads, and model output.

## Repo Rules

- Prefer small, reversible changes.
- Match existing TypeScript style.
- Keep runtime behavior grounded in tests.
- Do not refactor unrelated systems during feature work.
- Do not mass-add local state directories such as `.bun/`, `.nexagent/`, `.codex/`, `.npm/`, `.opencode/`, `.rtk/`, or generated scratch files.
- Preserve destructive-command safety. `--yolo` is not permission to bypass destructive shell/tool blocks.
- Treat uncommitted changes as user work unless you made them.

## Decision Precedence

When behavior is ambiguous:

1. direct user request
2. `AGENTS.md`
3. `README.md`
4. repo-local config (`.nexagent/`, `.claude/settings.json`, `.mcp.json`)
5. current code and tests
6. donor/upstream references

## Donor Boundary

Free-Code, Hermes, OpenCode, Codex-fresh, and other donor repos are reference material only. Never describe donor behavior as implemented unless matching `nexagent` code exists in this repo.

## Documentation Hygiene

- Keep implemented-feature claims tied to code.
- Replace stale inherited text instead of preserving fiction.
- Update `README.md` for user-facing behavior changes.
- Update `AGENTS.md` for durable agent behavior changes.
- Keep `CLAUDE.md` as pointer-only compatibility file.
