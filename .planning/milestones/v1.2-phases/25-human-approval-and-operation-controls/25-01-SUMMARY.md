# Phase 25 Summary

Status: complete

What changed:
- runtime now tracks operator control state:
  - approval mode
  - pending approval
  - cancel request
  - queued steer note
- guarded tools can now wait for explicit approval when mode is enabled
- new commands landed:
  - `/approval`
  - `/cancel`
  - `/steer`
- TUI now accepts slash control commands even while turn is pending
- `/status` and runtime metadata now show risky-operation state clearly

Verification:
- `bun test test/provider.test.ts`
- `bun test test/cli.test.ts`
- `bun test test/runtime-config.test.ts`
- `npm test`
- `npm run build`

Result:
- risky tool turns now have human approval and control path
- operator can cancel or steer between guarded tool steps

Truth boundary:
- no hard interrupt of already-running provider generation
- steer applies at next tool/model step boundary, not mid-token
