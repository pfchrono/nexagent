# Phase 10 Context

Goal: turn thin instruction layering into real system-prompt foundation without pretending full donor parity already exists.

Current repo truth:
- `src/runtime/instructions.ts` assembles prompt text from repo sources, tool visibility, and provider fallback.
- Prompt assembly existed, but no explicit system identity, execution guidance, or cache-stable section model.
- Inspect and TUI already surface instruction summaries through shared runtime state.

Donor guidance chosen:
- `free-code` for modular system-prompt sections and explicit dynamic-boundary concept.
- `hermes-agent` for stable session prompt assembly and separation between stable system prompt and dynamic turn content.

Scope for this slice:
- add explicit system identity and execution-guidance sections
- add stable/dynamic section model
- add dynamic boundary marker
- keep provider transport and auth behavior unchanged

Out of scope:
- OAuth or `/login`
- Codex adapter transport rewrite
- new slash commands beyond inspection of prompt state
- prompt caching backend or persisted prompt snapshots
