## 1. Specification baseline

- [x] 1.1 Inspect current repository scaffolding, local assistant settings, MCP configuration, and OpenSpec layout.
- [x] 1.2 Write a proposal defining `nexagent` as a hybrid coding-agent harness built from the Free-Code baseline.
- [x] 1.3 Add a capability spec describing the required behavior and constraints for the harness baseline.
- [x] 1.4 Add a design document defining the baseline architecture, boundaries, and migration strategy.

## 2. Repo initialization follow-up

- [x] 2.1 Complete the current runtime baseline by verifying the local CLI and runtime modules are coherent, documented, and aligned with the harness baseline as the acceptance contract for the current repo truth.
- [x] 2.2 Preserve the compatibility-critical CLI pathway that already exists, and treat transport or GUI compatibility paths as later implementation work until those surfaces are actually present.
- [x] 2.3 Wire the repo defaults so local configuration prefers the `codex` provider with MCP augmentation from `.mcp.json`.
- [x] 2.4 Audit current repo naming, prompts, and docs; replace only the pieces that misstate `nexagent` product intent within the scaffolded baseline.

## 3. Interface and runtime build order

- [ ] 3.1 Define and stabilize the shared runtime core contracts that future interfaces will consume.
- [ ] 3.2 Build the first real TUI on top of that shared runtime core, initially focused on truthful runtime visibility rather than feature parity.
- [ ] 3.3 Add a GUI shell only after the shared runtime core and first TUI are real and using the same state model.

## 4. Subsequent spec work

- [ ] 4.1 Add a provider-routing spec covering provider defaults, fallback rules, and model selection.
- [ ] 4.2 Add an instruction-assembly spec covering system behavior, repo-local instructions, precedence, and provider-ready prompt construction.
- [ ] 4.3 Add an Archivist (`token-savior`) memory spec covering persistence boundaries, retrieval behavior, and other persisted local agent context.
- [ ] 4.4 Add specs for command surface and repo-local automation hooks as they become implementation priorities.
