# Nexagent

Nexagent is a terminal-first AI coding harness. This context names the runtime concepts used to reason about model turns, tools, evidence, and completion.

## Language

**Tool-Capable Turn**:
One model turn where Nexagent must make tools available, parse tool requests, execute them, feed results back, recover from malformed or deferring output, and only complete when evidence or a stop reason is valid.
_Avoid_: tool loop, provider loop, response lane, agent turn

**Provider Adapter**:
A runtime part that talks to one configured model transport during a **Tool-Capable Turn**.
_Avoid_: provider loop, transport logic

**Tool Host**:
A runtime part that owns tool discovery, validation, authorization, execution, and result normalization for a **Tool-Capable Turn**.
_Avoid_: tool list, tool registry, tool executor

**Recovery Policy**:
A runtime part that decides how a **Tool-Capable Turn** responds to malformed, empty, deferring, or ungrounded model output.
_Avoid_: nudge strings, retry prompts, blocker classifier

**Turn Completion**:
The final outcome of a **Tool-Capable Turn**, including grounded evidence or a valid stop reason.
_Avoid_: final answer, provider result, done state

## Relationships

- A **Tool-Capable Turn** may execute zero or more tool requests before completion.
- A **Tool-Capable Turn** must complete with either grounded evidence or a valid stop reason.
- A **Tool-Capable Turn** uses exactly one active **Provider Adapter** at a time.
- A **Tool-Capable Turn** uses one **Tool Host** for all tool discovery and execution.
- A **Recovery Policy** belongs inside a **Tool-Capable Turn** and produces either another provider step, a tool step, or **Turn Completion**.
- **Turn Completion** belongs to exactly one **Tool-Capable Turn**.

## Example dialogue

> **Dev:** "Why did this **Tool-Capable Turn** end without inspecting the repo?"
> **Domain expert:** "It accepted a model-written blocker as final output instead of recovering into a real tool request."

## Flagged ambiguities

- "tool loop", "provider loop", "response lane", and "agent turn" were used for overlapping failure reports — resolved: use **Tool-Capable Turn** for the end-to-end runtime concept.
