# Phase 22 Context

Goal: add guarded writable coding tools under same repo-local policy layer as existing readonly tools.

Truth before work:
- internal tool registry was readonly only
- provider-native tool calling existed on `http-responses`
- policy still claimed readonly even though next milestone needed writable actions

Smallest honest slice:
- add `write_file`
- add exact-text `apply_patch`
- rename visible policy from readonly to guarded
- keep deletes blocked

Out of scope:
- delete tool
- shell tool
- slash wrappers for writable tools
- complex diff/merge engines
