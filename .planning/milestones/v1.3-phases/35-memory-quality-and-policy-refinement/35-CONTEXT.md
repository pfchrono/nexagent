# Phase 35 Context

Goal: improve usefulness of saved and retrieved memory without making memory noisy or unbounded.

Why now:
- live turn, control, and tool truth are stronger
- memory surfaces exist, but quality/policy still shallow
- next value should come from better relevance, not bigger storage

Observed needs:
- retrieval should favor actually useful context over generic matches
- save/checkpoint behavior should avoid low-signal spam
- read/write lineage must stay visible

Scope:
- improve retrieval usefulness heuristics
- tighten save/checkpoint policy if needed
- preserve inspectable memory lineage

Out of scope:
- unbounded memory growth
- hidden autonomous memory writes with no operator trace
- major TTY redesign
