# Phase 20 Context

Goal: stabilize `v1.1` runtime before writable agent powers land.

Why first:
- `v1.1` added many surfaces fast
- writable powers should not stack on top of misleading verification paths

Observed hardening target:
- `npm test` was too loose and picked up compiled `dist/test/*.js` after build artifacts existed
- this made counts look better than source truth

Scope:
- verification sweep
- smallest direct fix for honesty gap
- build and compile smoke

Out of scope:
- new writable tools
- transport redesign
- broader refactors
