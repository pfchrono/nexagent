# OpenRouter Agent Donor Findings for `nexagent`

Date: 2026-04-26
Donor skill: `openrouter-create-agent`
Primary references:
- `/home/pfchrono/.codex/skills/openrouter-create-agent/SKILL.md`
- `/home/pfchrono/.codex/skills/openrouter-create-agent/references/agent.md`

## Donor shape worth importing

Best donor rules:
- keep agent core separate from UI
- make headless path canonical smoke path
- let TUI subscribe to runtime events instead of owning model logic
- treat streaming/tool/thinking/error state as structured events, not plain transcript strings
- keep event vocabulary small and explicit

Good donor event set:
- user message accepted
- assistant message started/updated/completed
- provider turn started/completed/failed
- tool call requested
- tool call completed
- reasoning/progress update
- approval requested
- approval resolved
- cancel requested/applied
- steer queued/applied

## Current `nexagent` gap

Current runtime split only partial:
- headless path exists and useful
- provider loop exists
- tool loop exists
- TUI still owns too much presentation-state assembly
- transcript mostly string list, not structured turn items
- activity log mostly ad-hoc text lines
- progress chrome derived from coarse action detail string
- section dashboard dominates UI instead of thin workspace over agent events

Current code seams showing gap:
- `src/provider.ts`
  provider loop returns final result, but not stream/event timeline
- `src/cli.ts`
  TUI builds own transcript/activity buffers and section switching shell
- `src/runtime/session.ts`
  has shared action/control state, but not full event log model

## Architecture recommendation

Target shape:

```text
src/
  runtime/
    agent.ts         # canonical turn runner and event emitter
    events.ts        # small typed event vocabulary
    tools.ts         # internal tool registry and execution
    session.ts       # durable state and operator controls
  provider/
    *.ts             # transport adapters only
  cli.ts             # headless commands + thin TTY shell
```

Rules:
- `agent.ts` owns send loop, tool loop, provider loop, approval/control checkpoints
- transport adapters return structured updates where possible
- TUI consumes event log plus current snapshot
- transcript rendered from structured turn items, not manual string append only
- statusline/progress chrome read same shared snapshot, not separate heuristics

## Near-term `v1.3` implications

Best fit changes:

1. Phase 30 dogfood intake
- explicitly classify issues as:
  - workspace-layout issue
  - event-model issue
  - transport issue
  - operator-control issue

2. Phase 31/32 control work
- add explicit control events for cancel, steer, approval
- surface whether control applied, deferred, or ignored

3. Phase 33 provider parity
- capability matrix should attach to runtime event/control model
- not only static `/provider` text

4. Phase 36 TUI polish
- do not only restyle current dashboard
- shrink always-on sections panel
- render workspace-first turn view over shared agent snapshot
- move deep diagnostics behind slash commands

## Concrete build advice

Smallest useful next architecture step:
- add typed runtime event log
- write events from provider/tool/control boundaries
- make TUI render that log first
- keep old transcript strings only as fallback compatibility layer

Bad next step:
- large visual rewrite before event/source-of-truth cleanup

## Acceptance idea

`nexagent` TTY should be able to show, for one turn:
- user prompt accepted
- provider turn started
- tool requested
- tool result returned
- assistant response completed
- or bounded failure

All from shared event/state model. No TUI-only truth.
