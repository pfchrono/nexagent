# Phase 25 Context

Goal: improve operator control around risky and long-running guarded actions.

Truth before work:
- guarded tools existed, but no approval gate existed
- pending risky actions were not separately visible
- cancel and steer control around tool turns were weak

Smallest honest slice:
- add guarded approval mode
- add pending approval state
- add cancel and steer command surfaces
- allow slash control commands during pending turn in TUI

Out of scope:
- hard interruption of in-flight model generation
- streamed steer injection into already-running generation token stream
- multi-operator approval workflow
