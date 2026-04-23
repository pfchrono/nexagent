## Why

`nexagent` currently has repository scaffolding, local assistant settings, MCP configuration, and baseline OpenSpec content, but it still lacks a stable product boundary for implementation. Without a written baseline, build work risks drifting between three incomplete identities:

- a direct fork of Free-Code,
- a thin wrapper around multiple model providers, or
- a fully featured hybrid harness that combines the strongest ideas from multiple coding-agent runtimes.

The repository and local reference checkouts now point clearly to the third path. We are explicitly comparing Free-Code, Hermes Agent, Codex, OpenClaude, OpenCode, and OpenClaw because no single one cleanly provides the whole runtime we want. Free-Code contains much of the provider and feature work already explored for this project. OpenClaude appears to have filled out more of the surrounding harness surface. Hermes Agent, OpenCode, and OpenClaw contribute useful patterns for workflow visibility, desktop/runtime ergonomics, local orchestration, and extensibility. `.claude/settings.json` sets `codex` as the default assistant provider; `.mcp.json` enables documentation, GitHub, filesystem, fetch, sequential thinking, code graph, Next.js devtools, and Archivist (`token-savior`) memory services; and the repository-level control artifacts (`AGENTS.md`, `CLAUDE.md` when present, and `.claude/`) already signal a local-first harness direction.

This change defines that hybrid baseline explicitly so future work can choose the best donor implementation for each subsystem instead of accidentally inheriting one project's limitations wholesale.

## What Changes

This proposal establishes `nexagent` as a from-scratch hybrid coding-agent harness that deliberately combines the strongest runtime, provider, orchestration, and extension patterns from Free-Code, Hermes Agent, Codex, OpenClaude, OpenCode, and OpenClaw.

### Baseline definition

`nexagent` SHALL:

- be defined as a hybrid harness assembled from the strongest donor implementations rather than by default inheritance from any single upstream project,
- preserve the current compatibility-critical CLI/runtime baseline while future implementation work selectively imports donor runtime pathways for tool execution, prompt assembly, transport, provider plumbing, and GUI integration where those become real, justified building blocks,
- adopt stronger control-plane, orchestration, and capability-surface patterns from OpenClaude where those exceed the current Free-Code baseline,
- reuse OpenCode patterns selectively for LSP-oriented and client/server architecture where those are stronger than the current donor baseline,
- treat MCP servers, local commands, ripgrep-powered search, and structured tool execution as first-class harness building blocks,
- support repo-local behavioral control through `AGENTS.md`, `CLAUDE.md` when present, `.claude/`, `.mcp.json`, OpenSpec artifacts, and future session/state plumbing,
- preserve the spinner-verb progress model used by Free-Code while allowing richer workflow visibility patterns inspired by Hermes Agent and OpenClaude,
- remain compatible with upstream-inspired flows only where that compatibility does not block better hybrid `nexagent` product decisions.

### In scope

- Document the baseline product intent and architecture direction.
- Define the primary capability for running as a coding-agent harness.
- Capture phased implementation tasks for initializing the repo from the chosen baseline.
- Make explicit which current signals in the repo are intentional versus incidental scaffolding.
- Name the hybrid harness features that are part of the baseline plan even if their detailed specs ship later.
- Anchor the build order around a shared runtime core, then the first TUI, with GUI parity only later and with transport, prompt assembly, tool-surface, hook, and memory work added as explicit follow-on layers rather than implied present-tense capabilities.

### Hybrid harness features included in this baseline plan

The baseline change treats the following feature families as intentional parts of `nexagent` direction:

- provider/tool separation, where the default assistant runtime can differ from the documentation, code graph, filesystem, browser, GitHub, or other MCP-backed tools used in the same session,
- repo-local control inputs from `AGENTS.md`, `CLAUDE.md` when present, `.claude/`, `.mcp.json`, and OpenSpec artifacts,
- the existing compatibility-critical CLI pathway preserved now, with transport and GUI pathways only carried forward from donor runtimes when those surfaces actually exist locally and are still the best fit,
- subsystem-by-subsystem donor selection rather than whole-repo inheritance,
- a TUI-first interface plan where the first real interactive surface validates the shared runtime before any GUI shell is built,
- GUI parity direction that blends Hermes Agent, OpenClaude, and OpenCode patterns only as a later implementation track after the shared runtime and first TUI exist locally,
- OpenCode as a selective donor for LSP-oriented and client/server architecture rather than as the primary plugin-compatibility model,
- Free-Code-style spinner verbs as part of the baseline interactive progress model,
- later plugin and marketplace compatibility goals aligned primarily with Claude and OpenClaude ecosystems,
- later hook support aligned with Claude and OpenClaude-style repo and session automation,
- Archivist (`token-savior`) as the intended persistent memory and code-recall system for `nexagent` after core runtime layers are real,
- future command-surface and automation-hook expansion for repo-specific agent workflows after the shared runtime, TUI, provider transport, and prompt assembly are in place,
- local reference checkouts of Free-Code, Hermes Agent, Codex, OpenClaude, OpenCode, and OpenClaw as intentional implementation inputs for comparative review during actual build work,
- superior internal editing, search, and system-tool workflows including ripgrep-class repo search as a baseline harness capability.

### Out of scope

- Rebranding every upstream naming artifact immediately.
- Claiming that donor transport, prompt, tool, or GUI subsystems are already implemented locally when this repo still only exposes a narrow CLI/runtime baseline.
- Locking in a final provider matrix beyond the current default of `codex` plus MCP-based augmentation.
- Defining every slash command, GUI workflow, or transport protocol in this change.
- Shipping code changes outside the documentation/spec baseline required to guide implementation.

## Impact

### Benefits

- Gives contributors a stable answer to “what is `nexagent`?”
- Reduces churn by treating Free-Code compatibility as a constraint, not the product definition.
- Creates a reviewable contract for future work on providers, orchestration, GUI parity, repo-local automation, and advanced internal tooling.
- Lets subsequent OpenSpec changes build on a named capability instead of undocumented assumptions.

### Costs and follow-up

- Future implementation changes must now justify deviations from the harness baseline.
- Additional specs will still be needed for concrete subsystems such as provider routing, session persistence, GUI parity, plugin and hook behavior, and command surfaces.
- Some existing upstream text may temporarily remain until follow-up changes replace or sanitize it deliberately.
