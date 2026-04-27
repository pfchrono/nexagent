# Phase 33 Summary

Status: complete

What changed:
- `src/cli.ts`
  - provider/runtime status now includes compact transport `capabilities` line
  - provider/runtime status now includes compact transport `caveats` line
  - TUI routing view now exposes same transport truth
- tests:
  - `test/cli.test.ts`

Verification:
- `bun test test/cli.test.ts`
- `bun test test/provider.test.ts`
- `npm run build`

Result:
- transport differences are now visible in operator-facing surfaces
- `cli-exec`, `http-responses`, and `codex-http` no longer look deceptively equivalent
- operator gets practical truth about tool loop type, steer model, approval model, and model-scope limits

Truth boundary:
- this phase improves honesty more than feature parity
- `cli-exec` still depends on local Codex CLI behavior
- `codex-http` still uses harness XML tool loop, not native function calling
