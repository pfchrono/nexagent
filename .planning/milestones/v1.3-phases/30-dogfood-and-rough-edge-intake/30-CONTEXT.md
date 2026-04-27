# Phase 30 Context

Goal: turn early `v1.3` dogfood into concrete scope instead of vague TUI complaints.

Why first:
- current TTY reached clear usability ceiling
- enough real friction surfaced to shape next implementation order
- more blind polishing would risk solving wrong layer first

Observed clusters:
- main TTY is dashboard-first instead of workspace-first
- live turn reliability still weak enough to block control-path dogfood
- runtime/TUI boundary too thick and local-state-driven
- composer, statusline, and autocomplete interaction all feel underdesigned

Scope:
- gather and classify current dogfood findings
- compare against donor runtime/TUI patterns
- lock first `v1.3` implementation direction

Out of scope:
- full TTY rewrite
- full provider parity work
- final statusline/composer visual design
