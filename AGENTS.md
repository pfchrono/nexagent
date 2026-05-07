# AGENTS.md

Canonical guidance for coding agents working in `nexagent`.

`nexagent` is a working local terminal-first AI coding harness. Treat repo code, config, tests, and `README.md` as current operating truth. Do not assume upstream Free-Code, Hermes, OpenCode, or Codex behavior exists unless matching implementation exists here.

## Current Runtime

- TypeScript CLI/runtime under `src/`
- default interactive OpenTUI shell in `src/opentui/`
- provider transports: `cli-exec`, `http-responses`, `codex-http`
- provider/model controls include per-provider model selection and reasoning effort selection
- loopback-only gRPC automation server for external harnesses: `nexagent grpc --host 127.0.0.1 --port 0`
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
  - `ask_user_question`
  - `nexsight_execute`
  - `nexsight_read`
  - `nexsight_gather`
  - `nexsight_index`
  - `nexsight_batch`
  - `nexsight_search`
  - `get_goal`
  - `update_goal`
  - `lsp_status`
  - `lsp_symbols`
  - `lsp_diagnostics`
- slash commands including `/status`, `/status --sentry`, `/usage`, `/keys`, `/todos`, `/goal`, `/btw`, `/agents`, `/notify`, `/emoji`, `/color`, `/safegit`, `/scip`, `/extensions`, `/nexsight`, `/provider`, `/model`, `/effort`, `/tools`, `/memory`, `/memory --maintenance`, `/config`, `/lsp`, `/skill`, `/boomerang`, `/attach`, `/detach`, `/mouse`, `/approval`, `/compact`, `/diff`, `/rg`
- `$skill` shorthand routed into `/skill`
- guarded `!<command>` shell transcript command
- Pi-like runtime extension lifecycle shim with startup discovery from `.nexagent/extensions`, `.pi/extensions`, global `~/.nexagent/extensions`, and `~/.pi/agent/extensions`; supports `on(...)`, sync slash command registration, tool registration metadata, visible lifecycle activity, and lifecycle events
- `--yolo` session mode that bypasses guarded approvals while preserving protected OS-root shell/tool blocks
- provider-gated multi-image attachment flow for HTTP transports, with `Alt+V` clipboard image paste and `/attach` path attach
- startup MCP hydration from `.nexagent/mcp.json` and global `~/.nexagent/mcp.json`, with legacy `.mcp.json` migration compatibility, deduped server names, and bounded startup timeouts
- tags-only Sentry diagnostics for command, provider, tool, compaction, OpenTUI, startup, and memory signal failures; raw prompts/output/tool/file/transcript content stays out of Sentry unless explicitly opted in for AI span content
- configurable compaction thresholds, Archivist recurrence/dedupe, failure recovery playbooks, and memory signal counters
- Tool-Capable Turn seam in `src/runtime/tool-capable-turn.ts` for provider/tool/evidence/turn-completion ownership; `src/runtime/turn-run.ts` remains compatibility surface
- Recovery Policy seam in `src/provider/recovery-policy.ts` for typed retry/block/correct/accept decisions around malformed tool output, unsupported write claims, missing evidence, and deferrals
- Tool Host seam in `src/runtime/tool-host.ts` for shared internal tool list/describe/validate/authorize/execute/function-definition/prompt-guidance contracts
- Turn Completion envelope in `src/runtime/turn-completion.ts` for typed stop reasons, missing evidence, partial status, and automation/UI diagnostics
- Provider Readiness and error journal in `src/provider/readiness.ts` for pre-turn diagnostics and bounded provider failure history
- cockpit-style OpenTUI surfaces: paced assistant replies, turn metadata, warning/error lanes, turn blocks, token/duration badges, risk/outcome/action rows, navigation hints, capability panel
- default OpenTUI shell with multiline composer, command/skill/model/effort overlays, bounded transcript blocks, collapsible trace blocks, foreground approval panel, capped warning lane, action ladder, pilot override row, split memory summary, MCP/LSP panels, interactive config side window, clipboard text paste, rich edit review blocks, mouse wheel transcript scroll, and OSC52 selected-block copy feedback

## Canonical Docs

- `AGENTS.md` is canonical agent guidance.
- `CLAUDE.md` exists only as compatibility shim and should point here.
- `README.md` is canonical user-facing project overview.
- Historical planning, dogfood notes, and generated context docs are not tracked in this repo.

Do not split durable agent instructions between `AGENTS.md` and `CLAUDE.md`.

## Commands

Use existing package scripts only:

- `bun run build` — TypeScript compile
- `bun run test` or `bun test ./test/*.test.ts` — test suite
- `bun run test:opentui-visual` — deterministic OpenTUI visual smoke harness for palette, config, approval, trace, attach, and small terminal states
- `bun run dev` — run TypeScript CLI via Bun
- `bun run start` — run built `dist/cli.js`
- `bun run compile` — build platform binaries

Use the gRPC route for live harness checks:

- `nexagent grpc --host 127.0.0.1 --port 0` starts the trusted-local automation server and prints `nexagent grpc listening <host:port>`.
- External clients should use `proto/nexagent.proto` and call `Health`, `Inspect`, `RunCommand`, `RunPrompt`, and `Stop`.
- Use gRPC smoke checks for provider/model/skill regressions that only appear in the real harness, especially Codex Spark (`gpt-5.3-codex-spark`) and `$skill`/`/skill` routing.
- Keep gRPC loopback-only unless an authenticated transport is added. `RunCommand` can execute guarded shell commands and `Stop` terminates the server.
- When testing skills through gRPC, `/skill <name> ...` must be proven to auto-invoke the provider path, not only resolve the active skill.

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
- Do not mass-add local state directories or generated planning/context files such as `.bun/`, `.nexagent/`, `.codex/`, `.npm/`, `.opencode/`, `.rtk/`, `.planning/`, `dogfood-memory.md`, `CONTEXT.md`, or `docs/`.
- Preserve protected OS-root safety. `--yolo` is not permission to mutate critical system roots.
- Treat uncommitted changes as user work unless you made them.

## Agent Workflow Guidelines

- Start non-trivial code changes with a short plan before broad file reading. Clarify intended behavior, likely files, and verification path first.
- Prefer focused codebase reads. Read the full target file before editing a frequently changed or high-churn file, then keep edits narrow.
- Prefer Nexsight for broad repo inspection, audits, phase artifacts, and multi-file evidence. Use one `nexsight_gather` call for related files before making repeated `nexsight_read` or `nexsight_execute` calls.
- Use `nexsight_execute` for custom counting/parsing/filtering only when one script can process all relevant targets and print a compact table or summary. Do not burn tool budget on many small one-file scripts.
- Use `nexsight_read` for one known file with `map`, `signatures`, `outline`, or `lines:N-M`; use `read_file` when exact content is needed for editing.
- Use `todo` near the start for GSD workflows, phases, milestones, next-slice/full-loop work, or any task with three or more meaningful steps. Keep exactly one current task `in_progress` when possible and mark tasks complete only after evidence or verification.
- For GSD full-loop work, route visible stages through `todo`, broad phase/artifact evidence through `nexsight_gather`, exact edit context through `read_file`, artifact changes through `apply_patch`/`batch_edit`, and verification through focused tests or `shell_command`.
- Tool loops have a hard budget. If evidence remains broad after two related tool calls, batch the next inspection or stop with a named blocker instead of continuing narrow probes.
- If a tool fails, parse exact error, retry once with a smaller/safe equivalent, retry once with an alternate tool/path if available, preserve useful state in `todo` or memory, then hard-stop only when no safe path remains.
- Hard-stop reports must include exact blocker, evidence gathered, recovery attempts tried, why no further safe action can continue, and what user access/input/dependency would unblock it.
- Questions that ask why/how/what happened are diagnostic unless they explicitly request edits. Do not require write-tool evidence for explanation-only turns.
- Use `ask_user_question` for genuine user intent gaps: GSD discussion/spec choices, design tradeoffs, framework selection, destructive or high-risk decisions, or implementation choices that cannot be inferred from repo evidence. Group related questions in one call with short options.
- Do not use `ask_user_question` as an approval loop, progress update, or substitute for repo inspection. If tools can safely discover answer or continue work, use tools instead.
- When a file shows repeated rework, write or update a spec, test, or concrete acceptance check before continuing implementation.
- Record recurring error patterns, rejected approaches, and project-specific constraints in durable guidance instead of rediscovering them each session.
- Use evidence labels for claims: observed, verified, inferred, assumption, or unknown. Do not present inference as verified. Evidence labels guide claim discipline only; they are not a reason to stop loop work while useful inspection or verification tools remain.
- Use context-preserving tools for large output: summarize logs, test output, search results, diffs, and API responses before bringing them into the conversation.
- Use parallel agents for independent research or exploration tasks when available. Keep implementation ownership clear and avoid overlapping edits.
- When delegating, hand off the current goal, issue number or task slice, relevant decisions, files already touched, verification already run, and intended output. Tell subagents they are not alone in the codebase, must avoid reverting others' changes, and must return changed files plus evidence.
- When a subagent's task is complete, obsolete, or no longer needed, close it after consuming its result. Do this before starting the next issue or spawning another subagent so agent slots stay available.
- Commit incrementally when asked to commit or when work naturally reaches a reviewable checkpoint. Small commits make rollback and review easier.
- Break large work into deliverable chunks with verification after each chunk. Avoid long sessions that mix unrelated goals.

## Architecture Review Workflow

Use `$improve-codebase-architecture` when the user asks for architecture cleanup, refactoring opportunities, deeper modules, better testability, or AI-navigability.

- Explore first. Read `AGENTS.md`, `README.md`, relevant code, tests, and issue/PR context before proposing changes. Historical planning, dogfood notes, generated `CONTEXT*.md`, and `docs/` are not tracked truth in this repo.
- Use subagents when possible for independent exploration. Give each subagent a bounded question, current goal, relevant files, decisions already made, and expected evidence. Prefer separate ownership areas so subagents do not overlap edits.
- Use architecture vocabulary consistently: Module, Interface, Implementation, Depth, Seam, Adapter, Leverage, and Locality.
- Apply the deletion test before proposing a refactor: if deleting a module only moves complexity into callers, it is earning its keep; if complexity vanishes, it may be shallow.
- Present numbered deepening opportunities before implementation. For each candidate, state files, problem, solution, locality/leverage benefit, and test impact.
- Do not propose new Interfaces before the user chooses a candidate. After selection, grill constraints and intended behavior, then create or triage GitHub issues if work should be delegated.
- When architecture review identifies useful out-of-scope follow-up work, do not leave it implicit. If the user wants to continue, convert each bounded follow-up into a GitHub issue, rank the starting order by benefit and dependency, and triage it through the Issue Triage Workflow before implementation.
- Keep durable architecture decisions in `AGENTS.md`, `README.md`, tests, issue briefs, or PR text. Do not reintroduce tracked planning docs unless the user explicitly asks.

## Issue Triage Workflow

Use `$triage` for GitHub issue intake, state changes, bug reproduction, ready-for-agent briefs, and issue closeout.

- Every GitHub issue comment posted during triage must start with:
  `> *This was generated by AI during triage.*`
- Use repo labels as role mappings: `bug:triage` for `needs-triage`, `needs-repro` for `needs-info`, `agent-ready` for `ready-for-agent`, `ready-for-human` for `ready-for-human`, and `wontfix` for `wontfix`. Category labels are `bug` or `enhancement`.
- Each triaged issue should have exactly one category role and one state role. If state labels conflict, stop and ask before changing labels.
- For a specific issue, read the full issue body, labels, comments, and any prior AI triage notes. Do not re-ask resolved questions.
- For out-of-scope work discovered while closing or triaging an issue, create a new linked issue instead of expanding the current workload. Include source issue/context, non-goals, recommended order, and acceptance checks, then label it with one category and one state.
- For bugs, attempt reproduction before grilling. Trace the relevant code path and run focused tests or commands where practical.
- For `ready-for-agent`, post an agent brief with desired outcome, scope, acceptance, codebase evidence, likely files, and verification command. Use a subagent for the work when the implementation slice can be bounded.
- For implementation work from an issue, keep issue context in the handoff: issue number, current labels/state, user intent, non-goals, touched files, latest commit, and verification evidence. Close only after code is committed and acceptance is met.

## Decision Precedence

When behavior is ambiguous:

1. direct user request
2. `AGENTS.md`
3. `README.md`
4. repo-local config (`.nexagent/`, `.claude/settings.json`, `.nexagent/mcp.json`)
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
- Keep `.planning/`, `dogfood-memory.md`, generated `CONTEXT*.md`, and stale planning docs out of Git.
