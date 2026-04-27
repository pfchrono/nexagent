# Phase 24 Context

Goal: extend Archivist from retrieval-only into explicit bounded save and checkpoint flow.

Truth before work:
- Archivist retrieval already influenced prompts
- no explicit save or checkpoint action existed
- memory status showed retrieval only, not write lineage

Smallest honest slice:
- add `archivist_save`
- add `archivist_checkpoint`
- bound stored summaries and store size
- show retrieval and write lineage separately

Out of scope:
- automatic memory writes
- semantic memory ranking
- cross-project memory sync
- unbounded session dumps
