# Phase 16 Context

Goal: turn visible Archivist boundary stub into real runtime retrieval path without pretending full donor memory stack exists here.

Why now:
- earlier phases already established prompt assembly, provider loop, readonly tool safety, and compaction
- Archivist state existed only as config/display truth, not active runtime influence

Donor direction:
- `free-code/src/services/memory/persistentMemorySystem.ts`
- `free-code/src/services/memory/sessionContinuityManager.ts`

Smallest real slice:
- read persisted Archivist store from configured storage path
- recall relevant entries for current prompt
- inject recalled preview into system prompt
- surface retrieval influence in runtime views

Out of scope:
- durable memory writes
- session continuity manager parity
- provider-native memory tool calling
- team memory / multi-scope memory management
