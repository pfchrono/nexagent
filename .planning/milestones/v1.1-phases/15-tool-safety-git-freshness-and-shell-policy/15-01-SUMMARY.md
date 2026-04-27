# 15-01 Summary

- Added repo freshness discovery in [src/runtime/config.ts](/home/pfchrono/code/nexagent/src/runtime/config.ts:1):
  - tracked upstream branch
  - ahead/behind counts
  - dirty state
  - `pull needed` truth when behind tracked head
- Added explicit repo-local readonly tool policy in [src/runtime/config.ts](/home/pfchrono/code/nexagent/src/runtime/config.ts:1) and [src/runtime/bootstrap.ts](/home/pfchrono/code/nexagent/src/runtime/bootstrap.ts:1).
- Guarded slash tools in [src/cli.ts](/home/pfchrono/code/nexagent/src/cli.ts:1):
  - `/ls`
  - `/read`
  - `/find`
  - added `/tools` for visible policy inspection
- Surfaced git freshness and tool policy in runtime status and TUI metadata in [src/cli.ts](/home/pfchrono/code/nexagent/src/cli.ts:1).
- Added regression coverage in:
  - [test/cli.test.ts](/home/pfchrono/code/nexagent/test/cli.test.ts:1)
  - [test/runtime-config.test.ts](/home/pfchrono/code/nexagent/test/runtime-config.test.ts:1)
  - [test/provider.test.ts](/home/pfchrono/code/nexagent/test/provider.test.ts:1)
  - [test/instructions.test.ts](/home/pfchrono/code/nexagent/test/instructions.test.ts:1)

Truth boundary:
- freshness uses local tracked-upstream refs only
- no remote fetch/update step added
- shell remains limited and non-exposed in slash-tool surface

## Verification

- `bun test test/cli.test.ts`
- `bun test test/runtime-config.test.ts`
- `bun test test/provider.test.ts`
- `bun test test/instructions.test.ts`
- `npm run build`
