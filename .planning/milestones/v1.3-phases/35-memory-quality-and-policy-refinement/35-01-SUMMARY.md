# Summary 35-01

Phase 35 tightened Archivist retrieval quality without increasing memory sprawl.

What changed:
- weighted retrieval scoring now favors summary, tags, and type matches over generic content hits
- project-path bonus now only helps already-matching entries instead of reviving irrelevant memory
- checkpoint entries get mild penalty so generic handoff snapshots do not outrank explicit memory notes
- recent matching entries break ties and get small freshness bonus

Files changed:
- `src/runtime/archivist.ts`
- `test/provider.test.ts`

Verification:
- `bun test test/provider.test.ts`
- `npm run build`

Result:
- explicit memory beats generic checkpoint recall
- newer matching memory wins tie cases
- bounded write/read lineage unchanged
