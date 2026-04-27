# Nexagent Plan

This file is the execution-truth anchor for `nexagent`.

If another planning document sounds more ambitious, more donor-defined, or more complete than the code actually is, this file wins until implementation proves otherwise.

## Implementation guidance

Use these rules when planning and implementing from this file.

1. **Think before coding**
   - State assumptions instead of smuggling them into implementation.
   - Surface multiple interpretations when they matter.
   - Prefer clarifying questions over silent guessing.
   - Name simpler approaches when they exist.

2. **Simplicity first**
   - Write minimum code that solves actual problem.
   - No speculative abstractions, configurability, or future-proofing.
   - No extra error handling for impossible internal scenarios.
   - If a change feels too big for its goal, cut it down.

3. **Surgical changes**
   - Touch only files and lines needed for requested outcome.
   - Do not refactor adjacent code just because it is nearby.
   - Match existing local style unless repo rules say otherwise.
   - Remove only dead code created by current change.

4. **Goal-driven execution**
   - Translate each task into verifiable outcomes.
   - Prefer tests or observable checks over vague confidence.
   - For multi-step work, define brief step/verification pairs before editing.
   - Do not mark work done until checks match requested result.

## Product identity

`nexagent` is a local-first hybrid coding-agent harness.

It is **not**:

- a blind fork of Free-Code,
- a thin wrapper around one model provider,
- a speculative future harness described as if already implemented.

It is supposed to be:

- hybrid by subsystem,
- repo-local-control first,
- harness-oriented rather than provider-chat-oriented,
- honest about current implementation state,
- built incrementally in buildable slices.

## Canonical product rules

These rules govern planning and implementation.

1. **Hybrid harness first**
   - Donors inform subsystems.
   - No donor defines the whole product by default.

2. **Repo-local control is first-class**
   - `AGENTS.md`, `CLAUDE.md` when present, `.claude/`, `.mcp.json`, `Plan.md`, OpenSpec artifacts, and future approved repo-local state are part of the product control plane.

3. **Present and planned must stay separate**
   - Planned is planned.
   - Implemented is implemented.
   - No fake parity claims for transport, prompt assembly, tools, TUI, GUI, hooks, plugins, commands, or memory.

4. **Shared runtime first**
   - CLI, TUI, and GUI all stay downstream of one shared runtime state model.
   - No interface-specific copies of provider, repo, MCP, memory, session, or progress truth unless explicitly justified later.

5. **Provider transport is subordinate**
   - Provider execution is one subsystem.
   - It must not redefine the product into provider-only chat.

6. **Strong tools remain core behavior**
   - Search, editing, local commands, MCP-backed tools, and structured tool execution are baseline harness behavior, not optional garnish.

7. **Late features stay late**
   - Hooks, plugins, repo automation, and persisted memory land only after core runtime, interface state, provider transport, and instruction assembly are real enough to support them.

## Current repo truth

Today this repo is an early but runnable baseline.

### Implemented baseline

Current local surface is centered on:

- CLI bootstrap and command execution,
- runtime bootstrap and shared session materialization,
- repo-local config loading and merge behavior,
- MCP registry summary loading,
- configured-provider runtime state,
- a narrow codex-compatible execution lane,
- baseline layered instruction/prompt assembly,
- a minimal interactive TUI loop,
- a renderer-level HTML GUI shell,
- a tiny command surface,
- repo-local control artifacts such as `AGENTS.md`, `CLAUDE.md`, `Plan.md`, `.claude/`, `.mcp.json`, and OpenSpec docs.

### Not yet real or not yet mature

These are still future work or immature baseline work:

- broad provider routing beyond the narrow current path,
- mature transport semantics across multiple assistant providers,
- prompt assembly as a fully inspectable subsystem with better source summaries and operator visibility,
- rich tool execution parity with donor runtimes,
- operator-grade TUI workflows,
- real GUI application-shell behavior,
- mature hooks/plugins/repo automation,
- Archivist-backed persisted memory,
- broad harness-native command surface.

Short honest description:

`nexagent` is currently a runnable runtime baseline and planning scaffold for a larger hybrid harness.

## Control-plane precedence

Until superseded by a better implemented rule, precedence is:

1. explicit user or runtime invocation parameters,
2. repo-local control artifacts,
3. imported upstream defaults,
4. provider or tool fallback behavior.

This applies to behavior, instruction assembly, and future memory/automation policy unless a later spec says otherwise.

## Donor stance by subsystem

Donors are advisory inputs, not product owners.

- **Free-Code**: strong donor for runtime flow, tool plumbing, progress UX, and compatibility-critical CLI patterns.
- **OpenClaude**: strong donor for control-plane completeness and broader capability surfaces.
- **Hermes Agent**: strong donor for workflow visibility and operator-facing interaction patterns.
- **OpenCode**: selective donor for LSP-oriented and client/server patterns.
- **OpenClaw**: selective donor for local orchestration and extensibility ideas.
- **Codex**: default assistant provider in this repo and an input for provider-facing workflow expectations, not the full product identity.

## Baseline architecture

Keep two layers distinct.

### 1. Shared runtime layer

This layer owns current truth for:

- config,
- session identity and session state,
- provider identity,
- MCP state,
- cwd/repo context,
- progress state,
- runtime-visible instruction sources,
- future command/tool/memory state.

This is canonical state for CLI, TUI, and GUI.

### 2. Harness behavior layer

This layer defines product behavior through:

- repo-local instructions and defaults,
- provider/tool composition choices,
- command and automation semantics,
- future hooks/plugins/memory policy,
- future richer editing/search/tooling workflows,
- donor selection rules,
- planning truth boundaries.

This is where `nexagent` should diverge from upstream when repo-local workflows require it.

## Current execution checkpoint

Current status, minus marketing cosplay:

- Done: baseline product identity and anti-drift stance are defined.
- Done: shared runtime baseline exists in early form.
- Done: configured-provider execution lane exists without silent provider switching.
- Done: provider/tool separation is part of the baseline contract.
- Started: instruction precedence and layered assembly are partially implemented.
- Next: harden instruction assembly into an explicit, inspectable subsystem before widening provider transport.
- Later: deepen provider transport, tool execution, TUI/GUI workflow quality, hooks, memory, and command surface.

## Build order

This is the default execution order unless a later decision clearly beats it and explains why.

### Phase 0: keep baseline honest

Goal:
Preserve a runnable minimal baseline without pretending the larger harness already exists.

Required outcomes:

- docs and UI stay truthful,
- current runtime surface remains runnable,
- missing subsystems stay labeled missing,
- compatibility language stays constrained.

### Phase 1: stabilize shared runtime core

Goal:
Harden one runtime truth model for every interface.

Core owns:

- repo-local config loading,
- session state,
- provider identity,
- MCP state,
- repo/cwd/runtime context,
- progress reporting,
- interface-consumable action/state contracts.

Rules:

- keep CLI as truthful bootstrap/debug surface,
- no fake abstraction layers,
- no forked interface state.

### Phase 2: harden first real TUI

Goal:
Turn current terminal prototype into dependable runtime visibility.

Initial scope:

- provider status,
- cwd/repo context,
- enabled MCP servers or summaries,
- session id and metadata,
- instruction/import/reference visibility,
- spinner-verb progress updates,
- read-only if needed.

Rules:

- TUI validates shared runtime,
- no fake chat parity,
- no giant command framework yet.

### Phase 3: harden GUI shell

Goal:
Make GUI consume same runtime contracts after TUI proves them.

Initial scope:

- same session/runtime truth as TUI,
- stronger workflow visibility,
- better control-plane visibility,
- no GUI-only state path.

### Phase 4: deepen prompt and instruction assembly

Status:
In progress.

Goal:
Turn layered prompt output into a real subsystem.

Must define:

- system behavior loading,
- repo-local instruction discovery,
- precedence and merge order,
- task/session context injection,
- provider-ready prompt construction.

Rules:

- explicit invocation overrides repo-local inputs,
- repo-local artifacts override imported defaults,
- provider fallback stays lowest precedence,
- system behavior, repo instructions, task context, and tool availability stay distinct before provider serialization,
- docs/UI must not overclaim what prompt assembly does.

Immediate next slice:

1. Improve instruction-source summaries so assembled prompt output names material inputs, not only file or directory presence.
   - Verify: `test/instructions.test.ts` asserts source summaries include meaningful content for repo files and structured summaries for directory-backed sources.
2. Surface assembled prompt layers through inspect and current TUI runtime views using shared runtime truth.
   - Verify: `test/cli.test.ts` covers inspect output and rendered TUI instruction view against the same assembled-layer data.
3. Keep prompt precedence boundaries explicit while serializing provider-ready output.
   - Verify: existing and new tests still prove explicit invocation, repo behavior, task context, imported defaults, tool availability, and provider fallback remain distinct before serialization.
4. Leave provider routing narrow while this lands.
   - Verify: no transport or provider-selection behavior changes in this slice.

Acceptance for this slice:

- operator can see which instruction sources materially influenced a request,
- prompt assembly remains layered before provider serialization,
- inspect output and TUI both surface the same instruction-assembly truth,
- tests lock precedence and serialization behavior.

### Phase 5: deepen provider transport

Goal:
Move from narrow provider execution into transport that is real enough to trust.

Must preserve:

- configured provider as runtime state,
- assistant-provider routing separate from tool-provider availability,
- explicit failure reporting,
- no silent fallback without an approved routing rule,
- MCP/tool state visible beside provider execution state.

Immediate acceptance:

- current configured provider is surfaced truthfully,
- provider errors are explicit,
- routing semantics for new providers require spec coverage before implementation.

### Phase 6: expand tool execution surface

Goal:
Make harness feel like harness, not provider wrapper.

Scope:

- local commands,
- filesystem actions,
- repo search,
- MCP-backed capabilities,
- structured tool contracts usable across interfaces.

Rule:
Strong search/edit/tool ergonomics are core behavior.

### Phase 7: add hooks, plugins, and repo-local automation

Goal:
Open controlled repo-specific workflow behavior.

Must preserve:

- explicit, inspectable hook execution,
- hook failures reported instead of hidden,
- repo-local policy boundaries,
- shared runtime visibility for command/automation effects,
- no claims of broader automation parity before implementation.

### Phase 8: add memory and persisted harness state

Goal:
Integrate memory only after runtime, transport, instruction assembly, and tools are stable enough.

Planned direction:

- Archivist (`token-savior`) backed memory,
- explicit persistence boundaries,
- retrieval transparency,
- repo-local memory controls overriding globals.

Rules:

- no accidental persistence of task context, code, secrets, or conversation summaries,
- no durable memory writes until explicitly implemented and approved,
- CLI/TUI/GUI must be able to inspect when persisted context influenced a session.

### Phase 9: evolve command surface and workflow affordances

Goal:
Expand from narrow baseline into harness-native operations.

Rules:

- command semantics need spec coverage before being treated as stable product behavior,
- command and automation effects must flow through shared runtime state,
- inherited compatibility wording must not be mistaken for broader implemented semantics.

## Non-negotiable review checklist

Use this when reviewing future plans, specs, or implementation slices.

- Does it describe `nexagent` as a hybrid harness?
- Does it separate current truth from planned direction?
- Does it keep repo-local control central?
- Does it use donors by subsystem rather than whole-project inheritance?
- Does it keep shared runtime canonical?
- Does it keep provider transport subordinate to harness behavior?
- Does it avoid false parity claims for TUI, GUI, tools, hooks, plugins, commands, or memory?
- Does it produce a buildable next slice instead of identity theater?
- Does it state its truth boundary: dependencies, new behavior, still-missing behavior, and untouched future phases?

If answer is no, doc is drifting.

## Success criteria

This plan is succeeding when:

- one shared runtime core stays canonical,
- CLI remains truthful bootstrap/debug surface,
- TUI and GUI consume same state model,
- provider transport becomes more real without taking over product identity,
- instruction assembly becomes explicit and provider-ready,
- tool execution expands before hooks and memory,
- hooks and memory arrive with explicit policy and visibility,
- `nexagent` feels like a repo-aware hybrid harness instead of renamed donor or provider wrapper.

## Short version

If somebody wants one brutal little summary:

1. keep baseline honest,
2. harden shared runtime,
3. harden TUI,
4. harden GUI,
5. deepen provider transport,
6. deepen instruction assembly,
7. expand tools,
8. add hooks/plugins/automation,
9. add memory,
10. evolve command surface.

That is plan. Anything else trying to cut line gets thrown back into queue.