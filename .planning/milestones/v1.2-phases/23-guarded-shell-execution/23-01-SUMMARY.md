# Phase 23 Summary

Status: complete

What changed:
- internal tool registry now includes `shell_command`
- shell runs via `bash -lc` from session cwd only
- destructive shell patterns are blocked before execution
- shell output now caps at 120 lines and 12000 chars
- shell runtime times out after 5000ms
- provider tool loops now update shared runtime action state with guarded tool activity
- `/status` and `/tools` now show explicit shell guard truth

Verification:
- `bun test test/tools.test.ts`
- `bun test test/provider.test.ts`
- `bun test test/cli.test.ts`
- `bun test test/instructions.test.ts`
- `bun test test/runtime-config.test.ts`
- `npm test`
- `npm run build`

Result:
- guarded shell execution now real for internal tool loop
- runtime surfaces show shell guard and last guarded activity

Truth boundary:
- no human approval gate yet
- no streaming shell output
- destructive blocking uses pattern guard, not full shell parser
- no delete tool and no arbitrary out-of-root shell writes promised
