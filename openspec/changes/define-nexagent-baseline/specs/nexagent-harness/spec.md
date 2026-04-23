## ADDED Requirements

### Requirement: Nexagent harness baseline

`nexagent` SHALL operate as a hybrid coding-agent harness assembled from the strongest donor implementations rather than as either a single-project fork or a blank-slate assistant implementation.

#### Scenario: Runtime baseline is assembled from multiple donor implementations

- **GIVEN** maintainers initialize or update `nexagent` using proven runtime code and patterns from donor projects
- **WHEN** they adapt those inputs into a single harness
- **THEN** they preserve the best available pathways for CLI execution, tool invocation, prompt assembly, transport, provider plumbing, and GUI integration unless an approved spec intentionally changes them
- **AND** they treat donor compatibility as an implementation advantage, not as the final product identity.

#### Scenario: Local comparative harness references inform implementation work

- **GIVEN** maintainers begin concrete hybrid-baseline implementation work
- **WHEN** they compare architecture and workflow patterns before making local changes
- **THEN** they MAY consult local reference checkouts of Free-Code, Hermes Agent, Codex, OpenClaude, OpenCode, and OpenClaw as comparative implementation inputs
- **AND** those reference repositories MUST inform decisions without overriding this spec's stated `nexagent` requirements.

### Requirement: Repo-local orchestration is first-class

`nexagent` SHALL prioritize repo-local orchestration inputs and tools as part of normal operation.

#### Scenario: Local repo conventions shape agent behavior

- **GIVEN** a repo contains local instructions and configuration such as `AGENTS.md`, `CLAUDE.md` when present, `.claude/settings.json`, `.mcp.json`, OpenSpec artifacts, or other approved repo-local orchestration state
- **WHEN** `nexagent` runs inside that repo
- **THEN** those local artifacts are treated as primary configuration inputs for behavior, tooling, and workflow orchestration
- **AND** the harness is able to combine model providers, MCP servers, ripgrep-class repo search, and local command execution within one session.

### Requirement: Tooling remains harness-oriented

`nexagent` SHALL preserve a harness-oriented local tool model rather than narrowing into provider-only chat behavior.

#### Scenario: Tooling remains harness-oriented

- **GIVEN** `nexagent` is configured for local repository work
- **WHEN** an agent session starts
- **THEN** the harness MUST expose structured local tool use suitable for code navigation, editing, validation, and controlled automation
- **AND** the baseline toolset MUST include strong repository search ergonomics equivalent to ripgrep-class search
- **AND** these tools MUST remain composable with MCP-backed capabilities rather than assuming a provider-only interaction model.

### Requirement: Interactive workflow keeps upstream-inspired progress and extension surfaces

`nexagent` SHALL preserve the interactive progress and extension model that makes the runtime usable as a coding-agent harness.

#### Scenario: Spinner verbs and turn info remain part of the baseline workflow

- **GIVEN** maintainers adapt donor runtime behavior into `nexagent`
- **WHEN** they review interactive progress and turn-reporting expectations
- **THEN** they MUST preserve spinner-verb style progress updates drawn from both Free-Code and Hermes-inspired workflows unless a later approved spec replaces that model
- **AND** they MUST retain useful per-turn reporting such as token usage and related turn info as part of the baseline workflow
- **AND** they MUST treat progress visibility and turn info as product behavior, not incidental UI text.

#### Scenario: Plugin and hook surfaces remain available to repo-local workflows

- **GIVEN** `nexagent` runs in a repository that uses repo-local automation or extensions
- **WHEN** maintainers evaluate baseline harness capabilities
- **THEN** plugin compatibility, marketplace expectations, and hook execution surfaces aligned with Claude and OpenClaude-style workflows MUST remain part of the supported harness direction
- **AND** OpenCode-derived architecture MAY inform LSP and client/server implementation details without becoming the primary plugin-compatibility model
- **AND** those surfaces MUST be treated as first-class extension points rather than optional afterthoughts.

### Requirement: Default workflow supports multi-provider execution

`nexagent` SHALL support a provider model where the default assistant provider can differ from the tool and documentation providers used in the same session.

#### Scenario: Codex is configured as default provider

- **GIVEN** `.claude/settings.json` configures `apiProvider` as `codex`
- **WHEN** a user starts `nexagent` in this repository
- **THEN** the primary assistant runtime uses that configured provider by default
- **AND** enabled MCP services remain available for complementary capabilities such as documentation lookup, code graph analysis, filesystem access, and remote API operations.

#### Scenario: GUI parity direction is captured in the baseline

- **GIVEN** maintainers evaluate the baseline product surface for `nexagent`
- **WHEN** they define expected GUI behavior direction before implementation is complete
- **THEN** the documented baseline MUST treat GUI parity as a blend of Hermes Agent, OpenClaude, and OpenCode patterns with a stronger lean toward Hermes-style workflow visibility and OpenClaude-style control-plane completeness
- **AND** they MUST preserve the ability to implement that direction without discarding the best available compatibility-critical runtime pathways retained in the hybrid baseline.

#### Scenario: Hybrid harness planning preserves future feature tracks

- **GIVEN** the baseline architecture is being reviewed for completion
- **WHEN** maintainers evaluate whether hybrid harness planning is sufficiently captured
- **THEN** the documented baseline includes future spec handoffs for provider routing, Archivist (`token-savior`) memory integration, command-surface evolution, GUI parity, and repo-local automation hooks
- **AND** those follow-up areas are treated as planned extensions of the harness model rather than incidental ideas outside the baseline direction.

### Requirement: Product identity favors harness behavior over branding parity

`nexagent` SHALL allow selective divergence from upstream wording and defaults when required to reflect its harness-specific product intent.

#### Scenario: Upstream text conflicts with nexagent intent

- **GIVEN** imported upstream files, prompts, or docs still describe the product as generic Free-Code behavior
- **WHEN** that wording conflicts with the `nexagent` harness baseline defined by approved specs
- **THEN** maintainers update the conflicting text or defaults
- **AND** they avoid changing compatibility-preserving internals that do not materially affect product identity.
