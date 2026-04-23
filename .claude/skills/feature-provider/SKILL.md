---
name: feature-provider
description: Upstream provider onboarding checklist template retained for future runtime import work. Use only after the nexagent runtime source tree exists and provider files have been adapted into this repo.
---

# New Provider Onboarding Checklist

Use this skill when adding a new API provider or making significant changes to an existing one. Work through each phase in order. Check off each item as you complete it.

## Context

This codebase supports multiple API providers (Anthropic, Copilot, Bedrock, Vertex, Codex). Each provider requires consistent treatment across several layers. Missing any layer causes hard-to-diagnose bugs.

## Phase 1: Constants & Types

**File: `src/services/api/copilot-constants.ts`** (or equivalent constants file for provider)

- [ ] Provider-specific version/user-agent strings defined
- [ ] Cache TTL constants defined (`MODEL_CACHE_TTL_MS`, `CAPABILITY_CACHE_TTL_MS`)
- [ ] Fallback model list defined (models that work when API discovery fails)
- [ ] `MODELS_USING_MAX_COMPLETION_TOKENS` set updated if provider has non-standard token params
- [ ] Header builder function (`buildProviderHeaders()`) implemented
- [ ] Base URL builder function supports enterprise/custom URLs

## Phase 2: Fetch Adapter

**File: `src/services/api/<provider>-fetch-adapter.ts`**

- [ ] **No circular imports** — adapter must NOT import from `<provider>-client.ts`
- [ ] All shared constants imported from `<provider>-constants.ts` only
- [ ] `MODEL_ALIASES` map is synchronous (no async network calls at startup)
- [ ] Token parameter selection uses `MODELS_USING_MAX_COMPLETION_TOKENS` Set
- [ ] Request translation (Anthropic → provider format) handles:
  - [ ] `messages` array translation
  - [ ] `system` prompt
  - [ ] `max_tokens` vs `max_completion_tokens`
  - [ ] `stream` and `stream_options`
  - [ ] Image/vision content (`hasVisionContent()` check → request header)
- [ ] Response translation (provider format → Anthropic format) handles:
  - [ ] Streaming SSE chunks
  - [ ] `usage` (prompt_tokens, completion_tokens)
  - [ ] Error responses → `APIError`

## Phase 3: Client (Discovery & Auth)

**File: `src/services/api/<provider>-client.ts`**

- [ ] OAuth token refresh logic with buffer time
- [ ] Dynamic model discovery from `/models` endpoint
- [ ] `supportedEndpoints` filtering — only show models supporting `/chat/completions`
- [ ] Models cache with TTL in `GlobalConfig`
- [ ] Capability probing (vision, etc.) with per-model caching
- [ ] Semaphore for concurrent probe requests (max concurrency = 3)
- [ ] Fallback to `FALLBACK_MODELS` when API unreachable
- [ ] Enterprise URL support (custom base URL)

## Phase 4: Config Schema

**File: `src/utils/config.ts`**

- [ ] Provider token type added to `GlobalConfig`
- [ ] Models cache type added (`<provider>ModelsCache`)
- [ ] Capability cache type added (`<provider>CapabilityCache`)
- [ ] Enterprise URL field added if applicable
- [ ] Default values defined for all new fields

## Phase 5: Command Registration

**File: `src/commands/<provider>/` or `src/commands/<provider>.ts`**

- [ ] `/provider status` — shows token validity, active model, enterprise URL
- [ ] `/provider models` — lists discovered models with endpoints and token params
- [ ] `/provider login` / `/provider logout` — OAuth flow
- [ ] Command registered in `src/commands.ts`

## Phase 6: Integration Points

- [ ] `src/services/api/client.ts` — provider selection logic updated
- [ ] `src/utils/auth.ts` — enterprise hostname detection updated (if needed)
- [ ] QueryEngine picks up new provider correctly
- [ ] `/model` command shows provider models in selector

## Phase 7: Tests

- [ ] Unit test for `translateMessages()` / request translation
- [ ] Unit test for `translateResponse()` / stream parsing
- [ ] Unit test for token parameter selection (max_tokens vs max_completion_tokens)
- [ ] Unit test for model alias resolution
- [ ] Integration test: end-to-end fetch with mock server response
- [ ] Test file: `src/services/api/<provider>-fetch-adapter.test.ts`

## Phase 8: Circular Import Verification

Run before committing:

```bash
# Check for circular imports between adapter and client
grep -n "import.*from.*<provider>-client" src/services/api/<provider>-fetch-adapter.ts
grep -n "import.*from.*<provider>-fetch-adapter" src/services/api/<provider>-client.ts
# Both should return NO results
```

## Phase 9: Build & Type Check

```bash
bun run build:dev
bunx tsc --noEmit -p tsconfig.json
```

Both must pass with zero errors before marking implementation complete.

## Known Pitfalls (from Copilot implementation history)

| Pitfall | Prevention |
|---------|-----------|
| Circular ESM imports cause `undefined` at runtime | Adapter never imports client; both import from constants only |
| `gpt-5.3-codex` type models return 400 on `/chat/completions` | Filter by `supportedEndpoints.includes('/chat/completions')` |
| GPT-5.x/o-series models need `max_completion_tokens` | Use `MODELS_USING_MAX_COMPLETION_TOKENS` Set in constants |
| Static fallback list includes unsupported models | Test each fallback model manually before adding to list |
| Enterprise URL not propagated to token exchange | Pass `enterpriseUrl` through all token refresh code paths |
| Duplicate imports from same module | Search for duplicate import lines before finalizing |
