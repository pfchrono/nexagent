# 11-01 Summary

- Added shared Codex auth probing and login launch helpers in [src/runtime/auth.ts](/home/pfchrono/code/nexagent/src/runtime/auth.ts:1).
- Extended runtime bootstrap and UI surfaces to carry visible auth truth in [src/runtime/bootstrap.ts](/home/pfchrono/code/nexagent/src/runtime/bootstrap.ts:1) and [src/cli.ts](/home/pfchrono/code/nexagent/src/cli.ts:1).
- Added `/login` and `/codex` command surface with auth-gated activation.
- Fixed live Codex exec cwd flag in [src/provider.ts](/home/pfchrono/code/nexagent/src/provider.ts:1), unblocking real prompt execution.
- Updated regression fixtures in:
  - [test/cli.test.ts](/home/pfchrono/code/nexagent/test/cli.test.ts:1)
  - [test/runtime-config.test.ts](/home/pfchrono/code/nexagent/test/runtime-config.test.ts:1)
  - [test/provider.test.ts](/home/pfchrono/code/nexagent/test/provider.test.ts:1)
  - [test/instructions.test.ts](/home/pfchrono/code/nexagent/test/instructions.test.ts:1)

## Verification

- `npm test -- test/cli.test.ts`
- `npm test -- test/provider.test.ts`
- `npm run build`
- `node dist/cli.js run "/login status"`
- `node dist/cli.js run "/codex status"`
- `node dist/cli.js run "Say ok only"`
