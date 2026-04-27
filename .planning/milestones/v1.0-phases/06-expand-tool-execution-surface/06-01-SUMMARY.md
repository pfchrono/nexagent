# 06-01 Summary

- Expanded slash-command surface with repo-aware local tool commands: `/pwd`, `/ls`, `/read`, and `/find`.
- Kept tool commands cross-interface by reusing shared `runRuntimeCommand` path already used by prompt mode and TUI.
- Added regression coverage for filesystem inspection and search commands against temporary repo content.

## Verification

- `npm test -- test/cli.test.ts`
- `npm run build`
