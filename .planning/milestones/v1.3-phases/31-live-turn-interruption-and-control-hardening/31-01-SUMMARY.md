# Phase 31 Summary

Status: complete

What changed:
- `src/provider/codex-chatgpt-http.ts`
  - now uses injected fetch I/O for actual request path
  - sends required `instructions`
  - sends list-shaped `input`
  - sends `stream: true`
  - parses SSE output into final text
- `src/provider.ts`
  - `codex-http` now receives assembled instructions separately from raw user input
- `src/runtime/bootstrap.ts`
  - when no persisted transport is set and Codex auth JSON is available, default primary transport now prefers `codex-http`

Verification:
- `bun test test/provider.test.ts test/runtime-config.test.ts`
- `npm run build`
- `node dist/cli.js run "reply with one word ok"`

Result:
- targeted tests pass
- build pass
- default live prompt returns `ok`

Truth boundary:
- `codex-cli-exec` path still times out in this environment
- this phase restores dependable primary live path by promoting working `codex-http`, not by fully fixing `codex exec`
- broader TTY/workspace polish still belongs to later phases
