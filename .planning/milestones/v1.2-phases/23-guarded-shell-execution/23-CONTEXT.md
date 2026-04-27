# Phase 23 Context

Goal: add model-callable shell execution with explicit safety boundaries.

Truth before work:
- writable file tools existed, but no shell tool existed
- internal tool loop could not run repo-local shell inspection or lightweight repo commands
- runtime surfaces did not show shell guard details or tool risk activity

Smallest honest slice:
- add `shell_command` internal tool
- pin shell cwd to session repo root
- block destructive shell patterns
- cap shell output and timeout runtime
- show shell guard truth in runtime status

Out of scope:
- approval workflow for risky shell
- write/delete shell parity
- streaming shell output
- provider-native shell risk policies
