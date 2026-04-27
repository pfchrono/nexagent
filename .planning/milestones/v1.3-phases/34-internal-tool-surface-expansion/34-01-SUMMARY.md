# Phase 34 Summary

Status: complete

What changed:
- `src/runtime/tools.ts`
  - added bounded `git_diff` internal tool
  - tool uses repo root, respects repo-local path policy, and caps diff output
- `src/cli.ts`
  - added `/diff [path]` operator command
  - command catalog and tool visibility now include `git_diff`
- tests:
  - `test/tools.test.ts`
  - `test/cli.test.ts`
  - prompt/tool-catalog expectation updates in:
    - `test/instructions.test.ts`
    - `test/runtime-config.test.ts`

Verification:
- `bun test test/tools.test.ts`
- `bun test test/cli.test.ts`
- `bun test test/instructions.test.ts test/runtime-config.test.ts`
- `npm run build`

Result:
- harness now has bounded diff inspection without generic shell fallback
- internal tool catalog and runtime surfaces stay honest about new helper

Truth boundary:
- this adds one high-value inspection helper, not broad tool expansion
- diff output is capped by design
- no destructive git operations were added
