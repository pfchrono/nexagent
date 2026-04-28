# Phase 48: skill-command-baseline-skill-skill - Research

**Researched:** 2026-04-27  
**Domain:** terminal command routing for `/skill` and `$skill` in current `nexagent` CLI/runtime.  
**Confidence:** MEDIUM

<user_constraints>
## User Constraints (from 48-CONTEXT.md)

- `/skill` default output must be compact table.
- `/skill <name>` resolver order is locked: exact -> alias -> prefix -> fuzzy.
- Unknown skill must return error with top 3 closest matches and `/skill` hint.
- `$skill` must preserve raw trailing arguments (no normalization/rewrite).
- Baseline activation persistence is session-only.
- No confirmation prompt for normal skill route/switch in this phase.

</user_constraints>

<phase_requirements>
## Phase Requirements (from ROADMAP.md)

1. `/skill` lists available skills.
2. `/skill <name>` resolves deterministic lookup and route path.
3. `$skill` shorthand maps into skill routing with args preserved.
4. Unknown skill errors include deterministic closest-match guidance.

</phase_requirements>

## Existing Code Surface

### Likely integration points
- `src/cli.ts` — command parsing, slash command dispatch, prompt send pipeline.
- `src/runtime/persistence.ts` — candidate location for session-scope state.
- `src/runtime/session.ts` — session lifecycle/state model (if persistence wiring needed).
- `src/models.ts` — data types for command/skill entries if formalized.

### Design implications
- Phase is additive command-surface work; no provider transport changes needed.
- Resolver and autocomplete should share one canonical index function to keep deterministic behavior.
- Closest-match guidance should be bounded and deterministic (top 3, stable sort).

## Recommended Implementation Shape

1. Build centralized in-memory skill index for this session.
2. Add resolver function with locked ordered matching pipeline.
3. Add `/skill` slash handler:
   - no arg -> compact table list
   - with arg -> resolve and route or return closest-match error
4. Add `$skill` shorthand parser in prompt pre-dispatch path:
   - extract skill token + raw tail
   - resolve via same resolver
   - pass raw args unchanged to route layer
5. Keep session-only activation state (no global config write).
6. Add deterministic unknown-skill error formatter with top 3 suggestions.

## Risks / Pitfalls

- Divergent lookup logic between `/skill` and `$skill` (must share resolver).
- Non-deterministic fuzzy scoring on equal scores (must tie-break by stable key).
- Accidental argument normalization for `$skill` if command parser tokenizes too aggressively.

## Validation Strategy

- Manual command flow checks:
  - `/skill`
  - `/skill <exact>`
  - `/skill <alias/prefix>`
  - `/skill <miss>`
  - `$skill <name> <raw args>`
- Confirm unknown output always contains exactly top 3 suggestions when available.
- Confirm session restart clears activation state (session-only contract).
