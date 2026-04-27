# Phase 31 Context

Goal: restore dependable live turn behavior and strengthen operator control state around active work.

Why first:
- current dogfood blocked on broken live reply path
- `/cancel` and `/steer` cannot be judged until a real turn completes
- event truth already started landing, so transport/default-path reliability is next blocker

Observed issues:
- `codex exec` path hangs in this environment and leaks noisy JSON/thread output on timeout
- `codex-http` path existed but request contract was incomplete
- default bootstrap transport still preferred broken CLI path

Scope:
- make primary live path succeed or fail clearly in bounded time
- keep control/provider/runtime state more inspectable
- preserve honest non-silent transport truth

Out of scope:
- full provider parity
- full TTY redesign
- hard mid-token interruption for every transport
