# AGENTS.md

Canonical guidance for coding agents working in `nexagent`.

`nexagent` is a working local terminal-first AI coding harness. Treat repo code, config, tests, and `README.md` as current operating truth. Do not assume upstream Free-Code, Hermes, OpenCode, or Codex behavior exists unless matching implementation exists here.

## Current Runtime

- TypeScript CLI/runtime under `src/`
- default interactive OpenTUI shell in `src/opentui/`
- provider transports: `cli-exec`, `http-responses`, `codex-http`
- provider/model controls include per-provider model selection and reasoning effort selection
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
  - `lsp_status`
  - `lsp_symbols`
  - `lsp_diagnostics`
- slash commands including `/status`, `/status --sentry`, `/provider`, `/model`, `/effort`, `/tools`, `/memory`, `/memory --maintenance`, `/config`, `/lsp`, `/skill`, `/attach`, `/detach`, `/mouse`, `/approval`, `/compact`, `/diff`, `/rg`
- `$skill` shorthand routed into `/skill`
- guarded `!<command>` shell transcript command
- `--yolo` session mode that bypasses guarded approvals while preserving destructive shell/tool blocks
- provider-gated multi-image attachment flow for HTTP transports, with `Alt+V` clipboard image paste and `/attach` path attach
- startup MCP hydration from `.nexagent/mcp.json`, global `~/.nexagent/mcp.json`, and legacy `.mcp.json` with deduped server names and bounded startup timeouts
- tags-only Sentry diagnostics for command, provider, tool, compaction, OpenTUI, startup, and memory signal failures; raw prompts/output/tool/file/transcript content stays out of Sentry unless explicitly opted in for AI span content
- configurable compaction thresholds, Archivist recurrence/dedupe, failure recovery playbooks, and memory signal counters
- cockpit-style OpenTUI surfaces: paced assistant replies, turn metadata, warning/error lanes, turn blocks, token/duration badges, risk/outcome/action rows, navigation hints, capability panel
- default OpenTUI shell with multiline composer, command/skill/model/effort overlays, bounded transcript blocks, collapsible trace blocks, foreground approval panel, capped warning lane, action ladder, pilot override row, split memory summary, MCP/LSP panels, clipboard text paste, mouse wheel transcript scroll, and OSC52 selected-block copy feedback

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
- `bun run dev` — run TypeScript CLI via Bun
- `bun run start` — run built `dist/cli.js`
- `bun run compile` — build platform binaries

Do not invent commands. If command surface changes, update `package.json`, `README.md`, and this file.
If a new launch switch is added or removed in `parseCommand`, update `formatLaunchHelp()` and tests so `nexagent --help` stays complete.
If a slash command changes, update `src/cli/catalog.ts`, README command docs, and relevant command/autocomplete tests.

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

## Agent Workflow Guidelines

- Start non-trivial code changes with a short plan before broad file reading. Clarify intended behavior, likely files, and verification path first.
- Prefer focused codebase reads. Read the full target file before editing a frequently changed or high-churn file, then keep edits narrow.
- When a file shows repeated rework, write or update a spec, test, or concrete acceptance check before continuing implementation.
- Record recurring error patterns, rejected approaches, and project-specific constraints in durable guidance instead of rediscovering them each session.
- Use evidence labels for claims: observed, verified, inferred, assumption, or unknown. Do not present inference as verified. Evidence labels guide claim discipline only; they are not a reason to stop loop work while useful inspection or verification tools remain.
- Use context-preserving tools for large output: summarize logs, test output, search results, diffs, and API responses before bringing them into the conversation.
- Use parallel agents for independent research or exploration tasks when available. Keep implementation ownership clear and avoid overlapping edits.
- Commit incrementally when asked to commit or when work naturally reaches a reviewable checkpoint. Small commits make rollback and review easier.
- Break large work into deliverable chunks with verification after each chunk. Avoid long sessions that mix unrelated goals.

## Decision Precedence

When behavior is ambiguous:

1. direct user request
2. `AGENTS.md`
3. `README.md`
4. repo-local config (`.nexagent/`, `.claude/settings.json`, `.nexagent/mcp.json`, legacy `.mcp.json`)
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
