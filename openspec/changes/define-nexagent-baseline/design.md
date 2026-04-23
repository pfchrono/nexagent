## Overview

`nexagent` is a from-scratch hybrid coding-agent harness that should deliberately combine the strongest runtime, orchestration, and extension patterns found across local reference repos: Free-Code, Hermes Agent, Codex, OpenClaude, OpenCode, and OpenClaw.

This design is no longer centered on preserving one upstream runtime as the default architectural truth. Instead, it defines how to choose and fuse proven pieces from multiple harnesses into one coherent local-first system. Free-Code remains a major implementation donor because it already carries substantial provider work, tool plumbing, progress UX, and GUI pathways. OpenClaude is treated as the strongest reference for a more fully developed control plane and capability surface. Hermes Agent, OpenCode, and OpenClaw act as additional pattern libraries for workflow visibility, local orchestration, extensions, hooks, and desktop/runtime ergonomics. Codex remains important as both the configured default assistant provider in this repo and as a reference for practical provider-facing workflow expectations.

The goal of this design is to produce a best-of hybrid runtime for `nexagent`, not a lightly adapted fork. Compatibility with any single upstream project is useful only where it reduces cost or preserves proven behavior.

## Design goals

1. Define a best-of hybrid runtime for `nexagent` rather than treating any single upstream harness as the product boundary.
2. Reuse proven subsystems from Free-Code, OpenClaude, Hermes Agent, Codex, OpenCode, and OpenClaw where they are clearly better than rebuilding them immediately.
3. Make repo-local artifacts the primary source of behavioral control.
4. Support sessions that combine one default assistant provider with multiple complementary MCP services and future local harness capabilities without collapsing into provider-only chat.
5. Preserve strong interactive progress ergonomics, including Free-Code-style spinner verb updates, while making the first real interactive surface a TUI that validates shared runtime state before any GUI shell is built.
6. Keep the initialization path incremental so the repository can assemble the hybrid runtime in phases rather than attempting a one-shot rewrite.
7. Treat hooks, plugins, richer internal tools, and memory as planned follow-on capabilities that should be added after the shared runtime, TUI, provider transport, and prompt assembly layers are real.
8. Treat local reference checkouts of Free-Code, Hermes Agent, Codex, OpenClaude, OpenCode, and OpenClaw as comparative implementation inputs during actual build work.

## Non-goals

- Blindly preserving any single upstream architecture when a hybrid design would better fit `nexagent`.
- Defining the final provider-routing matrix, persistence format, or GUI feature set in full detail during this baseline change.
- Renaming every inherited donor artifact before the runtime is stable.
- Introducing speculative orchestration abstractions that are not yet justified by the hybrid runtime plan.

## Architectural stance

The current repository does not yet implement the full hybrid runtime described here. Today it exposes a narrow local baseline centered on the existing CLI entrypoint, local configuration loading, MCP summary reporting, and a lightweight session/runtime scaffold. This design document therefore describes both the real current baseline and the intended hybrid direction, without pretending that donor transport, prompt, or GUI subsystems are already integrated.

The system is intentionally split into two layers:

### 1. Runtime subsystem layer

At the current baseline, this layer is intentionally narrow and local. In this repo today it includes:

- the CLI entrypoint and command execution flow in `src/cli.ts`
- runtime bootstrap orchestration in `src/runtime/bootstrap.ts`
- configuration loading and merge behavior in `src/runtime/config.ts`
- MCP registry summary loading in `src/runtime/mcp.ts`
- lightweight session materialization in `src/runtime/session.ts`

Prompt assembly, tool invocation, provider transport, and GUI control-plane paths are not yet implemented here beyond this scaffold. Those remain donor-guided follow-up work.

The purpose of this layer is operational leverage. `nexagent` should not rewrite these pathways casually. Changes here should be driven by a concrete product requirement or a clearly superior donor pattern, not by a desire to rebrand internals.

### 2. Harness behavior layer

This layer defines `nexagent` product identity.

It includes:

- repo-local instruction sources such as `AGENTS.md` and `CLAUDE.md` when present
- local assistant defaults under `.claude/`
- MCP server configuration from `.mcp.json`
- OpenSpec artifacts that define intended behavior and future changes
- future persisted local state through Archivist-backed memory and related repo-local harness metadata only where explicitly adopted by `nexagent`
- provider and tool composition choices that make the runtime act like a harness
- plugin and hook surfaces that shape repo-local workflow behavior
- internal editing, system, and repo-search capabilities—including ripgrep-class search—as first-class harness tools
- local reference checkouts of Free-Code, Hermes Agent, Codex, OpenClaude, OpenCode, and OpenClaw used as comparative implementation inputs during build work

This layer is where `nexagent` should differ from upstream when local workflows, multi-provider usage, or repo-specific orchestration require it.

## Core decision: preserve flow, change defaults

The baseline decision is to preserve the current working CLI/runtime flow, change defaults and product-facing wording first, and only pull in broader donor execution pathways when the local implementation is ready to absorb them.

That means early implementation should prefer:

- keeping the existing local CLI entrypoint and runtime scaffold coherent,
- preserving the compatibility-critical invocation path that already works locally,
- adapting configuration so the default assistant provider is `codex`,
- retaining MCP support as a first-class part of normal sessions,
- updating only the text and defaults that misstate `nexagent` intent,
- deferring claims of imported prompt assembly, transport, tool-execution, or GUI parity until those subsystems are actually present in this repo.

This is the lowest-risk path to a working repository because it keeps the real local baseline honest while leaving room to reuse tested donor runtime shapes later.

## Configuration precedence

The harness should treat repo-local context as authoritative for session behavior.

Initial precedence should be:

1. explicit user/runtime invocation parameters,
2. repo-local behavioral artifacts (`AGENTS.md`, `.claude/`, `.mcp.json`, OpenSpec-defined defaults),
3. imported upstream defaults,
4. provider/tool fallback behavior.

This ordering reflects the product goal: `nexagent` is meant to adapt to the repository it is operating in, not force every repo into a static global assistant profile.

## Provider model

The baseline provider model is intentionally hybrid.

- One provider serves as the primary assistant runtime.
- Additional capabilities may come from MCP servers and other integrated tools in the same session.
- The default assistant provider in this repo is `codex`, as configured in `.claude/settings.json`.
- Documentation lookup, code graph analysis, filesystem access, GitHub operations, and other specialized capabilities can remain externalized through MCP.

This avoids treating model selection as the only control plane. In `nexagent`, useful work comes from combining provider inference with structured tools and local repo policy.

## Component boundaries

The baseline should preserve these boundaries:

### Prompt and instruction assembly

Responsible in the future for combining system behavior, repo-local instructions, and task context into the prompt seen by the active assistant provider.

Current baseline note: this repository does not yet implement prompt assembly beyond surfacing config-derived session metadata.

Constraint: defer detailed ordering rules until a later spec defines the local prompt pathway.

### Tool execution surface

Responsible in the future for exposing local commands, filesystem actions, MCP-backed tools, and future harness actions.

Current baseline note: the current implementation only reports configured and available MCP servers; it does not yet execute a broader harness tool surface.

Constraint: keep future tool execution generic and composable rather than hard-coding provider-specific assumptions.

### Provider transport

Responsible in the future for sending requests to the default assistant provider and receiving streamed or structured responses.

Current baseline note: this repository currently infers the configured provider and reports it, but does not yet implement provider transport.

Constraint: provider transport should be adaptable, but baseline work should avoid redesigning it before a real transport pathway exists.

### Repo-local control plane

Responsible for reading and applying local instructions, settings, specs, and future persisted state.

Constraint: this is the main place where `nexagent` behavior should evolve. New product decisions should prefer extending this control plane before rewriting lower runtime layers.

### TUI and GUI surfaces

Responsible for exposing shared runtime state through real interactive surfaces without forking the underlying truth model.

Constraint: the first interactive implementation beyond the debug CLI should be a TUI that shows provider status, repo context, MCP state, session identity, imports/references, and spinner-verb style progress updates. A later GUI shell may lean heavily toward Hermes-style visibility and operator flow, retain Free-Code's useful per-turn token usage and turn-info reporting, and preserve the same shared runtime contracts rather than inventing a GUI-only state path.

## Why this design fits the current repo

Current repository signals already point to this design:

- `AGENTS.md` defines repo-specific operating rules.
- `CLAUDE.md`, when present, is part of the repo-local control surface.
- `.claude/settings.json` selects `codex` as the default provider.
- `.mcp.json` enables a broad tool/documentation graph instead of a single-provider-only workflow.
- the harness direction assumes strong built-in repo search and editing ergonomics, including ripgrep-class search and better internal system-tool pathways.
- the OpenSpec change already frames the repo as a harness baseline rather than a fresh assistant implementation.

Because those signals already exist, the architecture should formalize them instead of treating them as temporary scaffolding.

## Migration strategy

Baseline implementation should happen in phases.

### Phase 1: assemble runtime baseline

Keep the current local baseline coherent while identifying the first donor subsystems worth importing, using Free-Code as a major donor rather than the sole architectural source of truth.

Acceptance focus:

- the existing CLI pathway runs coherently
- local configuration is loaded and surfaced correctly
- MCP summary loading works
- the lightweight session/runtime scaffold is explicit
- donor imports for tool execution, prompt assembly, transport, and GUI remain future implementation work rather than implied current capabilities

### Phase 2: stabilize shared runtime contracts

Define and harden the shared runtime state that future interfaces and transports will consume.

Acceptance focus:

- runtime state has a truthful shared model for provider identity, repo context, MCP status, session identifiers, and progress reporting
- repo-local instructions and config-derived defaults are surfaced through that model
- conflicting upstream product language is corrected without pretending missing subsystems already exist

### Phase 3: build the first TUI

Add the first real interactive surface on top of the shared runtime.

Acceptance focus:

- the TUI reflects shared runtime truth instead of duplicating state
- operators can inspect provider status, repo context, MCP state, session identity, and progress updates
- the TUI validates interface boundaries needed later by a GUI shell

### Phase 4: add harness-specific specs

Extend the product deliberately through new OpenSpec changes for:

- provider routing and fallback rules
- prompt and instruction assembly rules
- Archivist-backed memory behavior and storage boundaries
- command surface evolution
- GUI parity and repo-local automation hooks

This sequencing keeps baseline work tractable and avoids collapsing import, re-architecture, and product expansion into one step.

## Trade-offs

### Benefits

- Fastest path to a functioning repository with strong runtime coverage
- Lower maintenance risk than rewriting mature pathways immediately
- Clear separation between compatibility-preserving internals and product-facing harness behavior
- Easier review of future divergences because the baseline is explicit

### Costs

- Some upstream naming and structure may remain temporarily
- Product identity will initially rely more on config and docs than deep internal divergence
- Future specs will need to define where compatibility should end and `nexagent`-specific behavior should begin

## Planned hybrid feature track

This baseline intentionally leaves several hybrid harness features for follow-up specs, but they are not optional or accidental. They are the planned extension track that should shape later work:

- provider routing and fallback rules across the default assistant runtime and auxiliary tool providers,
- Archivist (`token-savior`) as the planned persistent memory and code-recall system for `nexagent`,
- command-surface evolution for harness-native operations rather than only upstream-compatible assistant commands,
- GUI parity rules that preserve upstream interaction coverage while allowing harness-specific affordances,
- repo-local automation hooks that let repos add controlled workflow behaviors without rewriting the runtime core,
- richer internal editing and system-tool capabilities, with ripgrep-class repository search treated as baseline harness ergonomics.

A later spec may change the ordering or content of this list, but baseline implementation work should avoid closing off these directions.

## Completion criteria for architecture baseline planning

The architecture and hybrid-harness planning for this change should be treated as complete when:

- the runtime compatibility layer and harness behavior layer are explicitly separated,
- repo-local control inputs and their precedence are documented,
- the baseline hybrid provider/tool model is named clearly,
- compatibility-preserving boundaries for CLI, prompt assembly, tool execution, transport, and GUI surfaces are documented,
- the planned follow-up feature families are listed so later specs have a defined handoff.

## Open questions deferred to later specs

- How provider routing should behave when multiple hosted providers are available
- How Archivist memory boundaries, retention, and retrieval should behave in `nexagent`
- Which slash commands or automation hooks become first-class harness features
- How much GUI behavior should remain identical to upstream versus becoming harness-specific

## Resulting guidance

Until superseded by later specs, maintainers should use this rule of thumb:

- preserve upstream runtime structure when it is already solving execution correctly,
- change repo-local defaults and product wording when they define harness behavior,
- add new abstractions only when a concrete `nexagent` workflow requires them.
