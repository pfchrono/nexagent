---
title: "Spinner emblem direction"
date: "2026-04-26"
context: "UI direction follow-up"
---

# Spinner emblem direction

Decision:

- do not clone Hermes-Agent spinner chrome
- do not clone free-code spinner chrome
- use donor ideas only as ingredients
- final spinner/emblem should feel unique to `nexagent`

Desired blend:

- Hermes-Agent:
  - disciplined progress/status surfacing
  - clean operator feedback
  - good compact terminal behavior
- free-code:
  - rich spinner verb rotation
  - lively motion and attitude
  - more expressive wait-state presence

Target `nexagent` outcome:

- custom animated emblem paired with spinner verbs
- same shared runtime action state drives emblem, verb, and progress line
- emblem degrades cleanly on narrow terminals
- no state fork between TUI chrome and runtime state
- motion should feel intentional, not noisy

Constraint:

- emblem belongs to later TUI polish slice, not small verb-import patch
