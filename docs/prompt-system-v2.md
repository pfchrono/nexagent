# Prompt System V2

## Problem

Nexagent has enough prompt guidance to say the right things, but not enough structure to reliably do the right thing. Current failures cluster around:

- Stopping with plans, promises, or "say apply it" instead of using tools.
- Wasting tool calls on repeated nudges or broad raw scans.
- Picking weaker tools when better task-specific tools exist.
- Claiming writes, reads, GSD state, or Nexsight results without current-turn evidence.
- Mixing style, repo instructions, runtime state, and provider guidance into one prompt blob.
- Letting long repo docs or mode text dilute core execution rules.

The fix should not be another appended instruction block. Prompt assembly needs first-class structure, ordering, cache boundaries, provider overlays, and tests.

## Reference Findings

### Free-Code

Reusable pattern:

- Prompt is assembled from named sections.
- Stable sections are separated from session-specific sections by a dynamic boundary.
- System prompt precedence is explicit: override prompt, coordinator/agent prompt, custom prompt, default prompt, appended prompt.
- Tool guidance is concrete and tied to available tools.
- Task behavior is direct: read before editing, modify code when asked, verify before reporting complete.
- Denied/failed tools trigger adjusted strategy, not blind retry.

Use from Free-Code:

- Section registry.
- Stable/dynamic cache split.
- Explicit prompt precedence.
- Bounded tool guidance.

Do not copy:

- Product branding.
- Large generic support/help sections.
- Free-Code-specific REPL and Ant paths.

### Codex

Reusable pattern:

- Concise base prompt with high-signal rules.
- Strong dirty-worktree rules.
- Clear plan/update/final-answer contracts.
- Editing constraints are direct and testable.

Use from Codex:

- Lean base identity.
- File edit and git safety rules.
- Verification and final-answer rules.
- Preference for `rg` and existing repo patterns.

### OpenClaw

Reusable pattern:

- Provider prompt contributions can add stable prefix, dynamic suffix, or replace selected sections.
- Project context files are sorted and split by dynamic behavior.
- Tool-use enforcement and execution discipline are explicit for GPT/Codex-family models.
- Runtime state is a separate section.
- Skills section is bounded: pick one relevant skill first, then read it.

Use from OpenClaw:

- Provider overlays.
- Context file ordering.
- Prompt section override API.
- Model-family execution overlays.
- Prompt injection scanning for context files.

### Hermes

Reusable pattern:

- Prompt builder is stateless.
- Memory guidance separates durable facts from task progress.
- Context files are scanned for prompt injection before injection.
- Prompt caching is explicit at message/prompt boundary.

Use from Hermes:

- Stateless prompt builder.
- Context sanitization.
- Memory vs session history split.
- Prompt cache control as first-class concern.

## Target Architecture

Prompt V2 should be a typed, sectioned pipeline:

```ts
type PromptCacheMode = "stable" | "dynamic";

type PromptSection = {
  id: string;
  title: string;
  priority: number;
  cache: PromptCacheMode;
  source: "core" | "provider" | "mode" | "repo" | "skill" | "runtime";
  content: string[];
};

type PromptContribution = {
  stablePrefix?: PromptSection[];
  dynamicSuffix?: PromptSection[];
  sectionOverrides?: Record<string, PromptSection>;
};
```

Assembly order:

1. Core identity.
2. Core execution contract.
3. Core tool-routing contract.
4. Core editing and safety contract.
5. Provider/model overlay.
6. Style overlays (`caveman`, `deadpool`, output style).
7. Repo instruction capsules.
8. Skills/MCP/tool availability.
9. Runtime state.
10. Conversation/compaction/memory context.
11. Current user invocation.

Cache boundary:

```text
stable sections
__NEXAGENT_PROMPT_DYNAMIC_BOUNDARY__
dynamic sections
```

Stable sections should include identity, base execution rules, edit safety, and static provider guidance. Dynamic sections should include cwd, readable/writable roots, enabled tools, active skill, repo snippets, recent conversation, memory retrieval, and current prompt.

## Core Contracts

### Execution Contract

Model must see a small, repeated contract in every prompt:

- Actionable request means act this turn.
- Use tools when tools improve grounding, correctness, or completion.
- Do not end with a promise when a tool can make progress.
- Continue until done, verified, or genuinely blocked.
- Failed tool result means vary strategy once or twice before stopping.
- Final answer needs evidence or named blocker.
- Never claim file/test/tool state without current-turn evidence.

### Tool Routing Contract

Tool rules should be short and table-like:

| Job | Preferred tool |
| --- | --- |
| broad repo map, counts, parse, compare, summarize | `nexsight_*` |
| exact file read for edit | `read_file` |
| exact symbol/text search | `search_content` or `nexsight_search` |
| precise edits | `apply_patch` |
| generated whole file | `write_file` |
| multi-file mechanical edit | `batch_edit` or `nexsight_execute` wrapper |
| tests/build/git | `shell_command` |
| web/current docs | web/MCP tool |
| durable user/project fact | archivist/memory |

Tool routing must also say:

- If stronger task-specific tool exists, use it before generic shell/listing.
- If tool schema mismatch happens, correct the call shape immediately.
- If a tool is unavailable, search local install paths first, then official docs, then tell user exact install step only if user/root action is required.

### Evidence Contract

Final claims should map to observed evidence:

- "created/updated file" requires write/apply-patch result or git diff.
- "tests pass" requires test output.
- "GSD agents installed/missing" requires file-backed or `--raw` workspace output, not `command -v gsd-planner`.
- "Nexsight used" requires `nexsight_*` result, not `list_dir`.
- "blocked" requires exact failed tool output or policy reason.

### Style Contract

Style modes must be overlays, not replacements for execution rules.

- `caveman`: compress final prose only; never corrupt code, commands, JSON, error text, commit messages, or PR text.
- `deadpool`: flavor allowed only around accurate technical substance; no hiding failures, no extra jokes inside tool contracts.

## Repo Context Handling

Repo docs should not be dumped wholesale into prompt. V2 should load repo context as bounded capsules:

- `AGENTS.md`: scoped rules summary plus raw excerpt only when short.
- `CLAUDE.md`: compatibility guidance summary, deduped against `AGENTS.md`.
- `README.md`: project capability summary.
- `.nexagent/` and global `~/.nexagent/`: settings/skills/hooks source summary.
- `.planning/`: only active phase/state when requested by GSD flow.

Context file loading should scan for prompt-injection patterns and invisible chars. Suspicious content should be summarized as blocked, not injected raw.

## Implementation Plan

### Slice 1: Prompt V2 Module

- Add `src/runtime/prompt-v2.ts`.
- Define section types, contribution types, section normalizer, stable/dynamic serializer.
- Add prompt snapshot tests that assert ordering and cache boundary.

Status: implemented.

### Slice 2: Core Prompt Sections

- Move identity, execution, tool routing, edit safety, verification, and final-answer rules into named sections.
- Keep current `assemblePrompt` API as compatibility wrapper.
- Add `buildPromptV2(session, invocation)` behind config flag.

Status: implemented. V2 core sections exist and `assemblePrompt` uses V2 unless `prompt.assembly` is explicitly `legacy`. Runtime inspect/status now displays V2 section summaries. Runtime state stores only the V2 summary; legacy layers are no longer built or stored during V2 turns.

### Slice 3: Provider Overlays

- Add provider contribution layer for Codex HTTP/exec.
- Encode Codex-specific tool persistence and final synthesis rules as provider overlay, not scattered fallback strings.
- Test provider overlay replacement and dynamic suffix behavior.

Status: implemented. V2 now emits stable provider guidance for Codex CLI, Codex ChatGPT HTTP, and OpenAI Responses HTTP transports. Tests cover transport-specific guidance and provider override behavior.

### Slice 4: Repo/Skill/Runtime Capsules

- Replace raw-ish repo instruction injection with bounded capsules.
- Deduplicate `AGENTS.md`/`CLAUDE.md`.
- Add global `~/.nexagent` and repo `.nexagent` source summaries as dynamic runtime section.
- Add active skill section that requires selecting one specific skill before reading.

### Slice 5: Tool Loop Tests

Add provider tests for these regressions:

- User says "apply it" after proposal -> tool call, not another ask.
- Broad repo task -> `nexsight_*` before generic file tools.
- Exact small file edit -> read then patch.
- Failed tool schema -> corrected call shape.
- Repeated guidance -> final synthesis with evidence.
- Write claim without write evidence -> correction or no claim.
- GSD agent check -> file-backed/raw workspace output, not command lookup.

### Slice 6: Remove Old Prompt Drift

- Delete obsolete appended guidance from `src/runtime/instructions.ts` once V2 passes snapshots.
- Keep only compatibility exports required by tests/callers.
- Add prompt dump/debug command so prompt sections are inspectable without flooding chat.

Status: partial. `src/runtime/instructions.ts` is now only the dispatcher and shared prompt context type. Legacy prompt assembly was moved to `src/runtime/prompt-legacy.ts` and is used only when `prompt.assembly` is `legacy`.

## Acceptance Criteria

- Prompt output is deterministic under stable inputs.
- Dynamic boundary cleanly separates cacheable and per-turn text.
- Core prompt remains readable under 6 KB before repo/runtime context.
- Style overlays cannot override execution/tool contracts.
- Provider overlays are testable units.
- Dogfood failures shown in recent screenshots have tests or documented blockers.
- `bun test ./test/*.test.ts`, `bun run build`, `npm run lint`, and `git diff --check` pass.

## Recommendation

Use Free-Code's section/cache architecture as the backbone, Codex's concise coding-agent rules as the base contract, OpenClaw's provider-overlay model for Codex/GPT behavior, and Hermes' context/memory hygiene for injected files. Build V2 behind a flag first, snapshot it, then switch the provider to V2 after regression tests pass.
