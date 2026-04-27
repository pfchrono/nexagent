# Phase 11 Context

Goal: give operator explicit Codex login and provider activation controls, with visible auth state across runtime surfaces.

Repo truth before this slice:
- provider transport already existed, but auth state was implicit
- no `/login` or `/codex` slash commands
- inspect and TUI could not show whether Codex credentials were present
- live provider turn path was also blocked by wrong Codex CLI cwd flag

Donor refs used:
- `/home/pfchrono/code/free-code/src/commands/login/*`
- `/home/pfchrono/code/free-code/src/commands/codex/*`
- `/home/pfchrono/code/free-code/src/constants/codex-oauth.ts`
- `/home/pfchrono/code/free-code/src/cli/handlers/auth.ts`

Scope:
- probe Codex auth status into shared runtime state
- add `/login` and `/codex`
- gate Codex provider activation on visible auth state
- surface auth state in inspect, GUI, and TUI

Out of scope:
- full Codex API adapter import
- richer provider model catalog
- long-lived token refresh logic
- broader transport refactor
