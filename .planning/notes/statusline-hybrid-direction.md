# Statusline Hybrid Direction

Target:
- build operator-grade statusline hybrid from strongest donor patterns in `~/code/`
- do not clone one donor exactly

Desired shape:
- one compact always-visible line
- status first, not decoration first
- workspace-oriented, not dashboard-oriented
- readable during active typing
- useful during long tool/model turns

Best donor traits to blend:

## From free-code

- per-turn in/out token visibility
- compact runtime/cost/session metadata
- energetic but readable status presentation

## From hermes-agent

- clearer turn progress framing
- stronger focus on current work state
- less noisy operator-facing flow

## From current `nexagent`

- explicit provider/transport truth
- approval/cancel/steer visibility
- compaction/context-left visibility

## Candidate statusline fields

- provider + model
- transport mode
- current turn state
- guarded approval pending marker
- turn token estimate in/out
- context remaining
- maybe session elapsed
- maybe active tool / current activity

## Rules

- no rapidly changing verb noise
- no low-value constant motion
- fit on normal terminal width first
- degrade cleanly on narrow width
- most important state left-aligned
- secondary telemetry compresses or drops first

## Non-goals

- giant footer block
- donor look copy
- always-on verbose debug panel
