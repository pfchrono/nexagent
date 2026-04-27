# Phase 21 Context

Goal: replace harness XML shim with provider-native structured tool calling where current transports support it.

Truth before work:
- internal tools already existed
- provider loop already worked through XML envelope
- `http-responses` transport could support native function calling
- `cli-exec` and `codex-http` still needed compatibility fallback

Smallest honest slice:
- add provider-native function definitions on OpenAI Responses transport
- execute tool loop natively on `http-responses`
- keep XML fallback on other transports

Out of scope:
- full parity on every transport
- writable tools
- shell tool
