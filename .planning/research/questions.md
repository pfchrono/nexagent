# Research Questions

## 2026-04-25

- Free-code compaction core:
  exact `contextsnip` / microcompact preservation rules, invoked-skill carry-forward, and post-compaction cache behavior.
- Hermes compression config:
  exact threshold config shape, override semantics, and how threshold percent maps to actual model context windows.
- Codex-fresh compact UX:
  exact queueing behavior for messages submitted during compaction, and exact guardrails around steering active turns vs compact turns.

## 2026-04-26

- Runtime event model:
  what smallest typed event schema should cover provider, tool, approval, cancel, steer, and compaction flow without over-abstracting early?
- TTY rendering strategy:
  should `nexagent` adopt delta-stream rendering first or stable replace-by-item rendering first for assistant/tool progress surfaces?
- Narrow-terminal tool trace policy:
  what default should `nexagent` use on constrained terminals: grouped traces, minimal traces, or adaptive fallback?
- Continue-until-done runtime behavior:
  should `nexagent` enforce this in turn loop itself, not only by system prompt wording?
- Transcript interaction:
  should selection/copy land in current renderer, or wait for renderer split/framework spike?
- Skill system:
  should `/skill` and `$skill` share one persisted runtime concept, or should slash-command shell land first?
- Framework decision:
  should `nexagent` keep hand-rolled TTY through next milestone, or run explicit Ink/OpenTUI spike first?
- Donor progress model:
  which imports best: Hermes grouped stage display, Codex structured phase events, or free-code statusline discipline?
- Scope promotion:
  which old out-of-scope systems deserve promotion first after `v1.4`: hook execution, plugin workflow, `--yolo`, clipboard image paste, or command-family spec system?
- Command and skill system baseline:
  can `/skill` and `$skill` semantics be inferred from any donor without breaking current shell compatibility?
- TUI stack choice:
  which approach gives best progress for this milestone: incremental hand-rolled updates, ink, or opencode-style renderer migration?
