# Phase 21 Summary

Status: complete

What changed:
- exported provider-native function schemas from internal tool registry
- `openai-http-responses` transport now sends native function definitions
- provider loop now handles native `function_call` / `function_call_output` on `http-responses`
- `cli-exec` and `codex-http` keep existing XML fallback path

Verification:
- `bun test test/provider.test.ts`
- `npm test`
- `npm run build`

Result:
- native tool-calling path works on supported Responses transport
- unsupported transports degrade honestly via prior XML path

Truth boundary:
- phase closes with partial transport parity by design
- writable tools still absent
