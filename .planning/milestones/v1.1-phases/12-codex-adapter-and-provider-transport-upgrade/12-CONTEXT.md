# Phase 12 Context

Goal: make Codex transport boundary explicit, modular, and inspectable without pretending full upstream adapter parity exists.

Repo truth before this slice:
- Codex execution worked, but transport logic still lived inline in `src/provider.ts`
- runtime transport state did not expose adapter identity, mode, or auth gate
- inspect, GUI, and TUI could not distinguish transport type from adapter truth
- provider transport phase in roadmap was active but not materialized into artifacts

Donor refs used:
- `/home/pfchrono/code/free-code/src/providers/*`
- `/home/pfchrono/code/free-code/src/codex/*`
- `/home/pfchrono/code/free-code/src/commands/provider/*`

Scope:
- extract Codex CLI exec transport into dedicated module
- expose adapter, mode, auth source, and auth gate in shared runtime state
- surface transport truth consistently in inspect, GUI, TUI, and provider command output
- keep provider result metadata explicit on success and failure

Out of scope:
- full HTTP Codex API adapter
- multi-provider transport parity beyond current Codex-backed path
- token refresh/session persistence logic
- command catalog expansion beyond provider transport visibility
