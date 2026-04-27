# `gsd-explore` Question Set for `v1.3`

Date: 2026-04-26
Purpose: focused explore prompts for `nexagent` runtime/TUI redesign using dogfood findings plus OpenRouter donor skills.

Inputs:
- `.planning/DOGFOOD-FINDINGS.md`
- `.planning/notes/openrouter-agent-donor-findings.md`
- `.planning/notes/openrouter-agent-tui-donor-findings.md`

## Explore objective

Refine `v1.3` around real operator pain:
- workspace-first TTY
- thinner TUI over runtime
- clearer live turn/control behavior
- cleaner module boundaries for future polish

## Best top-level `gsd-explore` prompts

### 1. Runtime/TUI boundary

How should `nexagent` split headless agent runtime from TTY shell so:
- runtime owns turn/tool/control truth
- TUI only renders shared event/state
- headless and TTY paths expose same operational story

### 2. Event model

What smallest typed runtime event vocabulary should `nexagent` adopt for:
- user prompt accepted
- provider turn started/completed/failed
- assistant output updated/completed
- tool requested/completed/failed
- approval requested/resolved
- cancel requested/applied
- steer queued/applied/deferred
- compaction started/completed

### 3. Workspace-first TTY

What should always be visible in default `nexagent` TTY workspace, and what should move behind slash commands like:
- `/status`
- `/provider`
- `/tools`
- `/memory`
- `/config`

### 4. Renderer split

What smallest file/module split should break `src/cli.ts` into safer boundaries without large rewrite?

Target choices to evaluate:
- `runtime/agent.ts`
- `tui/renderer.ts`
- `tui/input.ts`
- `tui/config.ts`
- keep command shell in `cli.ts`

### 5. Tool trace display

What tool trace mode should default `nexagent` TTY use:
- grouped
- minimal
- hidden except failures

What information should each tool trace show:
- tool name
- argument summary
- duration
- risk label
- result state

### 6. Input mode fallback

What input modes should `nexagent` support so raw-mode failures or terminal quirks do not break prompt entry?

Likely options:
- plain fallback first
- bordered/workspace mode later

### 7. Control semantics

How should cancel, steer, and approval states display so operator knows exactly whether action is:
- queued
- pending
- applied
- deferred
- rejected
- canceled

### 8. Provider parity UX

How should transport-specific capability gaps show in runtime surfaces so operator is not surprised by:
- hangs
- unsupported tool behavior
- different cancel/interrupt limits
- different streaming/tool semantics

### 9. Statusline design

What hybrid statusline best combines:
- free-code token/session signal
- Hermes turn-progress discipline
- `nexagent` provider/approval/context truth

Question:
- what is minimal persistent footer that stays high-signal without eating workspace?

### 10. Plain dogfood loop

What operator tasks should become canonical dogfood scripts for every UI/runtime iteration?

Must include:
- simple inspect task
- writable task
- shell-assisted task
- memory save/retrieval task
- approval/cancel/steer task

## Suggested routing of answers

- architecture decisions:
  `.planning/notes/`
- unresolved tradeoffs:
  `.planning/research/questions.md`
- milestone scope changes:
  `.planning/NEXT-MILESTONE.md`
- concrete fix candidates:
  `.planning/DOGFOOD-FINDINGS.md`

## Recommended first explore run

Best first `gsd-explore` prompt:

`Use openrouter-create-agent and openrouter-create-agent-tui as donor patterns for nexagent. Decide runtime/TUI boundary, minimal event model, workspace-first TTY layout, and smallest safe breakup of src/cli.ts.`
