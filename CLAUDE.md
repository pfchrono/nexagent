# CLAUDE.md

This file provides compatibility guidance for assistants that automatically look for `CLAUDE.md` in a repository.

`nexagent` is currently an early runtime baseline, not the full planned hybrid harness. Keep instructions grounded in the files that actually exist.

## Current repository shape

Today this repo contains:

- OpenSpec artifacts under `openspec/`
- local assistant configuration under `.claude/`
- repo-local harness settings under `.nexagent/`
- MCP server configuration in `.mcp.json`
- repo guidance files like `AGENTS.md`, `CLAUDE.md`, and `Plan.md`
- a minimal TypeScript runtime under `src/`
- package/build metadata in `package.json`, `tsconfig.json`, and lockfiles

A runnable CLI entrypoint exists at `src/cli.ts` and builds to `dist/cli.js` or platform binaries via the package scripts. Current runtime reality also includes a narrow codex-compatible provider execution path in `src/provider.ts`, baseline layered prompt assembly in `src/runtime/instructions.ts`, and minimal TUI/GUI renderers in `src/cli.ts`. Do not describe those surfaces as mature parity features yet.
## Primary source of truth

For current architecture, scope, and execution truth, read these files first:

- `Plan.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `AGENTS.md`
- `.mcp.json`

## Current goals

- Keep `nexagent` grounded as a spec-first runtime baseline.
- Make provider routing explicit instead of silently switching providers.
- Surface repo-local instructions, MCP config, runtime session state, and current interface surfaces truthfully.
- Treat current provider execution, prompt assembly, and TUI/GUI rendering as baseline implementations to harden, not finished parity claims.
- Add broader command automation and richer workflow behavior only when repo-local planning and code stay honest about what exists.
## Design plan references

Use these files when deciding what should exist next:

- `Plan.md`
- `.planning/ROADMAP.md`
- `.planning/STATE.md`
- `AGENTS.md`
- files under `openspec/` only when they actually exist

## Idea provenance

These references are inspiration for future design work, not proof that `nexagent` already implements the same behavior.

### free-code references

- `/home/pfchrono/code/free-code/src/commands.ts` — slash-command registry and skill discovery patterns.
- `/home/pfchrono/code/free-code/src/utils/processUserInput/processSlashCommand.tsx` — slash-command execution flow and command parsing references.
- `/home/pfchrono/code/free-code/src/utils/immediateCommand.ts` — immediate-command gating reference for inference/runtime configuration commands.
- `/home/pfchrono/code/free-code/src/commands/provider/index.ts` — provider-switch command behavior reference.
- `/home/pfchrono/code/free-code/src/commands/model/index.ts` — model-switch command behavior reference.
- `/home/pfchrono/code/free-code/src/commands/fast/index.ts` — fast-mode command behavior reference.
- `/home/pfchrono/code/free-code/src/commands/effort/index.ts` — effort-setting command behavior reference.
- `/home/pfchrono/code/free-code/src/commands/openai/index.ts` — provider alias command marked immediate.
- `/home/pfchrono/code/free-code/src/commands/openrouter/index.ts` — provider alias command marked immediate.
- `/home/pfchrono/code/free-code/src/commands/lmstudio/index.ts` — provider alias command marked immediate.
- `/home/pfchrono/code/free-code/src/commands/codex/index.ts` — provider alias command marked immediate.
- `/home/pfchrono/code/free-code/src/commands/copilot/index.ts` — provider alias command marked immediate.
- `/home/pfchrono/code/free-code/src/commands/minimax/index.ts` — provider alias command marked immediate.
- `/home/pfchrono/code/free-code/src/commands/zen/index.ts` — provider alias command marked immediate.
- `/home/pfchrono/code/free-code/src/screens/REPL.tsx` — REPL footer, status, and command-surface behavior references.
- `/home/pfchrono/code/free-code/src/bootstrap/state.ts` — token budget and turn output tracking references.
- `/home/pfchrono/code/free-code/src/services/api/codex-fetch-adapter.ts` — Codex provider integration references.

### Hermes references

- `/home/pfchrono/code/hermes-agent/ui-tui/src/app/uiStore.ts` — top-level TUI state, status bar mode, and usage-state references.
- `/home/pfchrono/code/hermes-agent/ui-tui/src/app/useInputHandlers.ts` — keyboard, history, queue, pager, and completion behavior references.
- `/home/pfchrono/code/hermes-agent/ui-tui/src/app/useSubmission.ts` — submission, queueing, multiline input, and shell/slash routing references.
- `/home/pfchrono/code/hermes-agent/ui-tui/src/app/useLongRunToolCharms.ts` — long-running tool progress and activity feed references.
- `/home/pfchrono/code/hermes-agent/cli.py` — CLI status bar and input-model parity references.

## Truth boundary

- Treat current `src/` files as baseline reality.
- Treat OpenSpec artifacts as approved direction.
- Treat free-code and Hermes paths as idea sources only.
- Immediate provider/model command breadth is still a design reference from free-code, but `nexagent` does already have a narrow `/provider` command surface in `src/cli.ts`.
- Do not describe slash-command parity, advanced prompt assembly, richer automation hooks, or Hermes-style TUI behaviors as implemented unless the corresponding `nexagent` files actually exist.

## Working expectations

- Keep edits small and accurate.
- Do not preserve inherited instructions that describe nonexistent code or commands.
- Prefer updating repo-local config and OpenSpec artifacts over inventing undocumented behavior.
- Preserve compatibility files only when they still add real value for local workflows.

## Practical guidance

- Use MCP/repo analysis tools when they help you orient faster.
- Use direct file reads and edits for narrow, explicit changes.
- Only add build/test/run instructions after the corresponding runtime files exist.
- If you bootstrap the actual runtime later, update both `AGENTS.md` and `CLAUDE.md` so future agents stop receiving stale guidance.

## Safety

Before removing inherited documentation, confirm whether it contains the last useful record of local intent. Prefer replacing fiction with concise truth, not deleting context blindly.

<!-- rtk-instructions v2 -->
# RTK (Rust Token Killer) - Token-Optimized Commands

## Golden Rule

**Always prefix commands with `rtk`**. If RTK has a dedicated filter, it uses it. If not, it passes through unchanged. This means RTK is always safe to use.

**Important**: Even in command chains with `&&`, use `rtk`:
```bash
# ❌ Wrong
git add . && git commit -m "msg" && git push

# ✅ Correct
rtk git add . && rtk git commit -m "msg" && rtk git push
```

## RTK Commands by Workflow

### Build & Compile (80-90% savings)
```bash
rtk cargo build         # Cargo build output
rtk cargo check         # Cargo check output
rtk cargo clippy        # Clippy warnings grouped by file (80%)
rtk tsc                 # TypeScript errors grouped by file/code (83%)
rtk lint                # ESLint/Biome violations grouped (84%)
rtk prettier --check    # Files needing format only (70%)
rtk next build          # Next.js build with route metrics (87%)
```

### Test (60-99% savings)
```bash
rtk cargo test          # Cargo test failures only (90%)
rtk go test             # Go test failures only (90%)
rtk jest                # Jest failures only (99.5%)
rtk vitest              # Vitest failures only (99.5%)
rtk playwright test     # Playwright failures only (94%)
rtk pytest              # Python test failures only (90%)
rtk rake test           # Ruby test failures only (90%)
rtk rspec               # RSpec test failures only (60%)
rtk test <cmd>          # Generic test wrapper - failures only
```

### Git (59-80% savings)
```bash
rtk git status          # Compact status
rtk git log             # Compact log (works with all git flags)
rtk git diff            # Compact diff (80%)
rtk git show            # Compact show (80%)
rtk git add             # Ultra-compact confirmations (59%)
rtk git commit          # Ultra-compact confirmations (59%)
rtk git push            # Ultra-compact confirmations
rtk git pull            # Ultra-compact confirmations
rtk git branch          # Compact branch list
rtk git fetch           # Compact fetch
rtk git stash           # Compact stash
rtk git worktree        # Compact worktree
```

Note: Git passthrough works for ALL subcommands, even those not explicitly listed.

### GitHub (26-87% savings)
```bash
rtk gh pr view <num>    # Compact PR view (87%)
rtk gh pr checks        # Compact PR checks (79%)
rtk gh run list         # Compact workflow runs (82%)
rtk gh issue list       # Compact issue list (80%)
rtk gh api              # Compact API responses (26%)
```

### JavaScript/TypeScript Tooling (70-90% savings)
```bash
rtk pnpm list           # Compact dependency tree (70%)
rtk pnpm outdated       # Compact outdated packages (80%)
rtk pnpm install        # Compact install output (90%)
rtk npm run <script>    # Compact npm script output
rtk npx <cmd>           # Compact npx command output
rtk prisma              # Prisma without ASCII art (88%)
```

### Files & Search (60-75% savings)
```bash
rtk ls <path>           # Tree format, compact (65%)
rtk read <file>         # Code reading with filtering (60%)
rtk grep <pattern>      # Search grouped by file (75%)
rtk find <pattern>      # Find grouped by directory (70%)
```

### Analysis & Debug (70-90% savings)
```bash
rtk err <cmd>           # Filter errors only from any command
rtk log <file>          # Deduplicated logs with counts
rtk json <file>         # JSON structure without values
rtk deps                # Dependency overview
rtk env                 # Environment variables compact
rtk summary <cmd>       # Smart summary of command output
rtk diff                # Ultra-compact diffs
```

### Infrastructure (85% savings)
```bash
rtk docker ps           # Compact container list
rtk docker images       # Compact image list
rtk docker logs <c>     # Deduplicated logs
rtk kubectl get         # Compact resource list
rtk kubectl logs        # Deduplicated pod logs
```

### Network (65-70% savings)
```bash
rtk curl <url>          # Compact HTTP responses (70%)
rtk wget <url>          # Compact download output (65%)
```

### Meta Commands
```bash
rtk gain                # View token savings statistics
rtk gain --history      # View command history with savings
rtk discover            # Analyze Claude Code sessions for missed RTK usage
rtk proxy <cmd>         # Run command without filtering (for debugging)
rtk init                # Add RTK instructions to CLAUDE.md
rtk init --global       # Add RTK to ~/.claude/CLAUDE.md
```

## Token Savings Overview

| Category | Commands | Typical Savings |
|----------|----------|-----------------|
| Tests | vitest, playwright, cargo test | 90-99% |
| Build | next, tsc, lint, prettier | 70-87% |
| Git | status, log, diff, add, commit | 59-80% |
| GitHub | gh pr, gh run, gh issue | 26-87% |
| Package Managers | pnpm, npm, npx | 70-90% |
| Files | ls, read, grep, find | 60-75% |
| Infrastructure | docker, kubectl | 85% |
| Network | curl, wget | 65-70% |

Overall average: **60-90% token reduction** on common development operations.
<!-- /rtk-instructions -->
