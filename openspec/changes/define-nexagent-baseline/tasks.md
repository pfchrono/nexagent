## 1. Specification baseline

- [x] 1.1 Inspect current repository scaffolding, local assistant settings, MCP configuration, and OpenSpec layout.
- [x] 1.2 Write a proposal defining `nexagent` as a hybrid coding-agent harness built from the Free-Code baseline.
- [x] 1.3 Add a capability spec describing the required behavior and constraints for the harness baseline.
- [x] 1.4 Add a design document defining the baseline architecture, boundaries, and migration strategy.

## 2. Repo initialization follow-up

- [ ] 2.1 Import or adapt the upstream Free-Code runtime into this repository using the harness baseline as the acceptance contract.
- [ ] 2.2 Preserve or reintroduce compatibility-critical CLI, transport, and GUI pathways before making `nexagent`-specific behavior changes.
- [x] 2.3 Wire the repo defaults so local configuration prefers the `codex` provider with MCP augmentation from `.mcp.json`.
- [x] 2.4 Audit current repo naming, prompts, and docs; replace only the pieces that misstate `nexagent` product intent within the scaffolded baseline.

## 3. Subsequent spec work

- [ ] 3.1 Add a provider-routing spec covering provider defaults, fallback rules, and model selection.
- [ ] 3.2 Add an Archivist (`token-savior`) memory spec covering persistence boundaries, retrieval behavior, and other persisted local agent context.
- [ ] 3.3 Add specs for command surface, GUI parity, and repo-local automation hooks as they become implementation priorities.
