# Phase 32 Context

Goal: make steer timing, persistence, and operator feedback less ambiguous.

Why now:
- live turn path works again, so control-path ambiguity is next blocker
- current steer support is only one hidden string with little history
- dogfood needs clear answer to "queued, deferred, or applied?"

Observed issues:
- `/steer` only exposed pending message, not explicit steer state
- runtime surfaces still said normal-turn steering was `unsupported`
- no preserved steer history explained when active work actually changed
- approval dogfood showed operator replies like `approved` could be misread as normal prompts

Scope:
- expose explicit steer state in runtime surfaces
- preserve bounded steer history with application timing
- mark normal steer truth as boundary-based, not unsupported
- keep approval-path plain-text aliases honest while pending approval exists

Out of scope:
- full TTY rebuild
- clickable approve/deny UI
- hard mid-token steer for all transports
