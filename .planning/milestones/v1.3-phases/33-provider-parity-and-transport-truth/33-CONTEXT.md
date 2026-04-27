# Phase 33 Context

Goal: reduce biggest transport surprises by exposing honest capability truth.

Why now:
- live turn path works again
- steer/control truth is stronger
- operator still cannot tell what each transport can actually do without reading raw internals

Observed issues:
- `/provider` only exposed adapter/mode/auth internals, not practical capability truth
- transport differences around tool calling and model scope stayed implicit
- operator had no compact clue why `cli-exec`, `http-responses`, and `codex-http` behave differently

Scope:
- add concise capability summary per transport
- add concise caveat line per transport
- surface both in provider/runtime views

Out of scope:
- making all transports feature-equal
- fixing every local Codex CLI behavior difference
- full diagnostics/UI redesign
