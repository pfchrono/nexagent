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

**Provider Readiness Journal**:
A bounded provider health and error history used to explain whether a provider is ready before or during a **Tool-Capable Turn**.
_Avoid_: status text, random provider error log

**Transport Adapter Contract**:
The shared behavioral contract that every **Provider Adapter** should satisfy for execution, recovery, completion mapping, and readiness reporting.
_Avoid_: one-off provider glue, special transport path

## Relationships

- A **Tool-Capable Turn** may execute zero or more tool requests before completion.
- A **Tool-Capable Turn** must complete with either grounded evidence or a valid stop reason.
- A **Tool-Capable Turn** uses exactly one active **Provider Adapter** at a time.
- A **Tool-Capable Turn** uses one **Tool Host** for all tool discovery and execution.
- A **Recovery Policy** belongs inside a **Tool-Capable Turn** and produces either another provider step, a tool step, or **Turn Completion**.
- **Turn Completion** belongs to exactly one **Tool-Capable Turn**.
- A **Provider Readiness Journal** belongs near provider selection and diagnostics, not inside UI presentation code.
- A **Transport Adapter Contract** should let different provider transports behave consistently without hiding provider-specific capabilities.

## Current workload

Open follow-up architecture issues are ranked by dependency and expected leverage:

1. #24 — Consolidate provider transport adapters around a shared **Transport Adapter Contract**.
2. #25 — Surface **Turn Completion** and **Provider Readiness Journal** state in OpenTUI.
3. #26 — Route MCP tools through the shared **Tool Host** contract where practical.
4. #27 — Add provider registry schema versioning and migration diagnostics.
5. #28 — Add opt-in provider readiness network probes.

When new architecture or triage work creates useful out-of-scope follow-up, create linked GitHub issues and update this workload summary if it changes the active direction.

## Example dialogue

> **Dev:** "Why did this **Tool-Capable Turn** end without inspecting the repo?"
> **Domain expert:** "It accepted a model-written blocker as final output instead of recovering into a real tool request."

## Flagged ambiguities

- "tool loop", "provider loop", "response lane", and "agent turn" were used for overlapping failure reports — resolved: use **Tool-Capable Turn** for the end-to-end runtime concept.
