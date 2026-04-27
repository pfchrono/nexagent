# Phase 36 Context

Goal: rebuild TTY into workspace-first operator surface over shared runtime truth.

Why now:
- live turn path works again
- steer/approval/control truth stronger
- dogfood now shows main blocker is information architecture, not missing runtime state

Observed needs:
- transcript/workspace must make latest answer obvious
- diagnostics commands need compact summary first, verbose detail second
- composer needs real input region, visible cursor, history, and preview-first autocomplete
- transcript/tool output needs scrollback and collapsed verbose blocks

Scope:
- workspace-first TTY layout
- thinner UI over shared event/runtime state
- better composer/statusline/tool trace rendering
- groundwork for focus mode and richer interaction

Out of scope:
- full mouse-heavy GUI parity
- clipboard image paste
- broad color/theme system
