---
title: "Context compaction runtime spec"
date: "2026-04-25"
priority: "high"
---

# Context compaction runtime spec

Define implementation-ready contract for:

- persisted config keys for auto/manual compaction
- default percent threshold and per-model overrides
- compact payload schema:
  - structured runtime snapshot
  - model summary
  - queued user message
  - active skills/modes
- `/compact` command semantics
- steer-vs-queue behavior while compacting
- TUI warning states and remaining-token display
- failure behavior when compaction summary cannot complete

Acceptance bar:

- operator can inspect threshold and remaining tokens
- compaction never silently drops queued user intent
- compact turn cannot be steered like normal turn
- compact payload stays materially smaller than pre-compact transcript
