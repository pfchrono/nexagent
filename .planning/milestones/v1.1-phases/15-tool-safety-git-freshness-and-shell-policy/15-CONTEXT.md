# Phase 15 Context

Goal: make repo-local tools safer and make repo inspection honest about branch freshness.

Repo truth before this phase:
- `/pwd`, `/ls`, `/read`, and `/find` existed
- commands had no explicit repo-local path guardrails
- runtime status showed branch name only, not freshness vs tracked head
- tool safety policy was implicit, not inspectable

Source refs used:
- `.planning/ROADMAP.md`
- `src/cli.ts`
- `src/runtime/config.ts`
- `test/cli.test.ts`
- `test/runtime-config.test.ts`

Scope for `15-01`:
- add visible tool policy to runtime state
- block repo-local slash tools from leaving allowed roots
- surface git freshness in runtime status and views
- add explicit `/tools` command for safety inspection

Truth boundary:
- freshness compares against tracked upstream ref already present locally
- phase does not run `git fetch`
- slash tools remain read-only; no shell execution surface added here
