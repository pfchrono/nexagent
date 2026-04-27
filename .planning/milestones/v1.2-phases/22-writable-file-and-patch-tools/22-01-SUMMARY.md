# Phase 22 Summary

Status: complete

What changed:
- tool policy now reports `repo-local-guarded`
- internal tool registry now includes:
  - `write_file`
  - `apply_patch`
- `write_file` writes UTF-8 files only inside allowed roots
- `apply_patch` performs exact-text replacement on existing files
- ambiguous patch targets fail instead of guessing
- protected paths and out-of-root writes still blocked

Verification:
- `bun test test/tools.test.ts`
- `bun test test/provider.test.ts`
- `bun test test/cli.test.ts`
- `npm test`
- `npm run build`

Result:
- writable internal tool path now real
- delete path still blocked

Truth boundary:
- no delete tool
- no shell tool yet
- no slash wrappers for writable actions
- patching is exact-text replacement, not full unified diff parser
