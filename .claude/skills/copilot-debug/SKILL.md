---
name: copilot-debug
description: Dump live Copilot provider state — token validity, discovered models, capability cache, active aliases, and recent errors. Run this first when diagnosing Copilot connection or model issues.
disable-model-invocation: true
---

# Copilot Debug

Diagnose the live GitHub Copilot provider state by running the following steps in sequence. Report each result clearly.

## Step 1: Provider Status

Run `/copilot status` (or equivalent) to check:
- Is Copilot mode active? (`apiProvider === 'copilot'`)
- Is a valid OAuth token present and not expired?
- What enterprise URL is configured (if any)?

Use: `Bash(cat ~/.claude/config.json | grep -E '"copilot|apiProvider|enterpriseUrl"' 2>/dev/null || echo "No global config found")`

## Step 2: Discovered Models

Run `/copilot models` to list all models currently returned by the Copilot `/models` API.

For each model, show:
- `id` — the model identifier
- `label` — display name
- `supportedEndpoints` — which API surfaces this model supports
- `preferredTokenParameter` — `max_tokens` or `max_completion_tokens`
- `isProbed` — has capability probing been run?

If the API is unreachable, confirm which fallback models are active from `COPILOT_FALLBACK_MODELS` in `src/services/api/copilot-constants.ts`.

## Step 3: Capability Cache

Inspect `copilotCapabilityCache` from global config:

```bash
Bash(cat ~/.claude/config.json | python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('copilotCapabilityCache',{}), indent=2))" 2>/dev/null || echo "No capability cache found")
```

For each cached capability entry, show:
- Model ID
- `hasVision` — does this model support image inputs?
- `probeTime` — when was this cached?
- Whether cache has expired (TTL = 30 minutes)

## Step 4: Model Aliases

Print the active `MODEL_ALIASES` map from `src/services/api/copilot-fetch-adapter.ts`:

```
claude-sonnet  → claude-sonnet-4.6
claude-haiku   → claude-haiku-4.5
claude-opus    → claude-opus-4.6
gpt-latest     → gpt-5.4
fast           → claude-haiku-4.5
coding         → claude-sonnet-4.6
```

Confirm the currently selected model (`/model`) resolves correctly through this map.

## Step 5: Token Parameter Check

For the currently active model, confirm which token parameter will be used:
- Models in `MODELS_USING_MAX_COMPLETION_TOKENS`: use `max_completion_tokens`
- All other models: use `max_tokens`

Check if the active model is in that set and report the result.

## Step 6: Known Issue Checklist

Run through these known failure modes:

| Check | Status |
|-------|--------|
| `COPILOT_FALLBACK_MODELS` does NOT include `gpt-5.3-codex` | ✓/✗ |
| `copilot-fetch-adapter.ts` does NOT import from `copilot-client.ts` | ✓/✗ |
| `copilot-client.ts` does NOT import from `copilot-fetch-adapter.ts` | ✓/✗ |
| `coding` alias maps to `claude-sonnet-4.6` (not a codex model) | ✓/✗ |
| Models with empty `supportedEndpoints` are filtered from model list | ✓/✗ |

## Output Format

```
=== COPILOT DEBUG REPORT ===

Provider active: YES/NO
Token: valid/expired/missing
Enterprise URL: none / <url>

Models (N discovered, N fallback):
  - claude-sonnet-4.6 [/chat/completions] max_tokens
  - gpt-5.4 [/chat/completions] max_completion_tokens
  ...

Capability cache: N entries, N expired

Active model: <model-id>
  → resolves to: <canonical-id>
  → token param: max_tokens / max_completion_tokens

Known issues: NONE / <list>
```
