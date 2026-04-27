---
title: "Context compaction design"
date: "2026-04-25"
context: "GSD explore output"
---

# Context compaction design

Decision snapshot for future implementation:

- support both auto-compaction and manual `/compact`
- default trigger uses Hermes-style threshold as percentage of model context window
- TUI should display absolute tokens remaining/left even when threshold is percent-based
- allow per-model override when default percent is not enough
- while compacting:
  - queue normal next user message
  - allow steer message for active normal agent turn when safe
  - do not allow steer for compact turn itself
- compaction payload should preserve only compact forms of:
  - system prompt and repo instructions
  - active skills and style modes
  - brief goals/tasks/tool-state snapshot
  - queued next user message
- summary method should be hybrid:
  - deterministic local structured snapshot for facts/state
  - model-written compact summary for reasoning/narrative

Donor blend to prefer:

- free-code for compaction core and contextsnip/microcompact direction
- Hermes for threshold config shape and operator-facing threshold model
- codex-fresh for queueing and compact-turn UX constraints

Constraints:

- no naive full transcript replay after compaction
- no summary-only system that loses factual runtime state
- no hidden compaction trigger; threshold and remaining tokens must stay visible
