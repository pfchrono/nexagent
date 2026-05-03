# Dogfood Memory Improvements (Deduplication + Signal Quality)

## Current status
Archivist memory is enabled (`bounded-write`). The first dedupe/recovery pass is implemented:

- exact and near-duplicate entries are merged into recurrence records where possible
- `/memory --maintenance` reports entry counts, duplicate suspects, stale signals, and persistence status
- failed tool calls can be saved as failure recovery playbooks
- later turns can retrieve failure playbooks when similar tool/provider failures appear

Remaining tuning area: improve signal quality for long-running dogfood sessions so repeated low-value observations do not crowd out high-value constraints and recovery hints.

## Goal
Preserve useful recurrence signal without creating duplicate memory clutter.

---

## Proposed improvement plan

### 1) Content fingerprinting on write (exact/normalized dedupe)
- Normalize memory text before save:
  - trim
  - collapse whitespace
  - lowercase/normalize case
  - strip volatile fields (timestamps, transient IDs, run-specific counters)
- Hash normalized content (fingerprint).
- On write, compare against recent entries in same scope/topic.
- If exact fingerprint match:
  - skip insert, or
  - update existing record (`lastSeen`, `seenCount`).

### 2) Near-duplicate detection (semantic/text similarity)
- Add near-duplicate check for non-exact matches.
- Candidate methods:
  - token overlap (Jaccard)
  - embedding similarity (cosine)
- If similarity exceeds threshold:
  - merge/update canonical memory instead of inserting a new row.

### 3) Canonical record model (store recurrence without spam)
Represent repeated observations as one canonical entry:
- `summary`
- `firstSeen`
- `lastSeen`
- `seenCount`
- `sources[]` (optional)
- `fingerprint`
- `mergedFromIds[]` (optional for compaction lineage)

### 4) Autosave debounce/windowing
- Add guardrails to periodic autosave writes.
- Example policy:
  - do not write if similar memory exists within last `N` turns or `M` minutes,
  - unless content changed materially (delta above threshold).

### 5) Periodic compaction job (retroactive cleanup)
- Add a compaction pass (manual command and/or background maintenance):
  - cluster similar memories,
  - merge duplicates,
  - keep canonical entry,
  - track provenance in `mergedFromIds`.
- Maintain auditability and reversibility where feasible.

### 6) Retrieval-side dedupe guard (quick UX win)
- At read-time, group highly similar memory hits.
- Present as:
  - primary canonical memory
  - plus indicator like `(+2 similar)`
- This improves output quality even before write-path dedupe is complete.

### 7) Staleness and priority policy
- Decay/archive low-value repeated memories over time.
- Boost recurring high-value constraints/instructions.
- Keep memory set bounded by utility, not just recency.

---

## Suggested phased implementation

### Phase 1 (fastest value) — implemented
1. Retrieval-side dedupe grouping.
2. Autosave debounce window.

### Phase 2 — implemented
3. Write-path normalized fingerprint dedupe.
4. `seenCount/lastSeen` updates for exact matches.

### Phase 3 — partial
5. Near-duplicate text matching and merge behavior.
6. Canonical schema expansion with recurrence metadata.
7. Failure recovery playbooks for failed tool/provider usage.

### Phase 4 — remaining tuning
8. More aggressive compaction tooling.
9. Staleness/priority tuning.

---

## Acceptance criteria (practical)
- Repeated periodic-autosave entries no longer appear as separate near-identical retrieval hits.
- Exact duplicate writes within dedupe window are suppressed or merged.
- Canonical entries reflect recurrence via `seenCount` and `lastSeen`.
- Tool failure recovery entries are searchable without exposing raw prompts, file contents, or tool output.
- Retrieval output reduces duplicate clutter while preserving important repeated constraints.
- Existing memory corpus can be compacted with traceable merge lineage.

---

## Notes for Codex execution context
- Start with retrieval dedupe + autosave debounce for immediate dogfood impact.
- Keep thresholds configurable to tune false-positive/false-negative merge behavior.
- Prefer conservative merge defaults initially; allow explicit compaction for aggressive cleanup.
- Ensure logs/telemetry record dedupe decisions for debugging and trust.
