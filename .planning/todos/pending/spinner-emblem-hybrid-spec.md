---
title: "Spinner emblem hybrid spec"
date: "2026-04-26"
priority: "medium"
---

# Spinner emblem hybrid spec

Define implementation-ready contract for:

- custom `nexagent` emblem frames and animation cadence
- how emblem pairs with spinner verbs and progress text
- compact/narrow-terminal fallback behavior
- reduced-motion or low-fidelity fallback
- how shared runtime action state feeds spinner chrome
- separation between:
  - verb source/config
  - emblem renderer
  - progress/status formatter

Acceptance bar:

- emblem is visibly unique to `nexagent`
- donor influence present, donor appearance absent
- progress line stays readable under truncation
- no duplicate or divergent runtime state
