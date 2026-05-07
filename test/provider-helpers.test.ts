import assert from "node:assert/strict";
import test from "node:test";

import {
  createEmptyOutputFailure,
  extractGenAiUsage,
} from "../src/provider/control-normalization.js";
import {
  createRequiredNexsightFallbackSuccess,
  createRequiredNexsightPreflightPrompt,
} from "../src/provider/nexsight-required.js";
import {
  getRequiredEvidenceNudge,
  incrementRequiredEvidenceNudge,
  recordRequiredEvidenceNudge,
  type RequiredEvidenceNudgeState,
} from "../src/provider/nudges.js";
import {
  classifyRecoveryPolicy,
  claimsUnsupportedWriteCompletion,
  isNonActionableDeferral,
} from "../src/provider/recovery-policy.js";
import {
  classifyToolFailure,
  createToolFailureDiagnosticInput,
  formatToolArgumentsPreview,
  formatToolDuration,
} from "../src/provider/tool-results.js";
import type { RuntimeSession } from "../src/runtime/session.js";

function createMinimalSession(): RuntimeSession {
  return {
    id: "session_provider_helpers",
    provider: "codex",
    providerTransport: {
      mode: "cli-exec",
    },
    mcpRegistry: {
      statuses: [
        {
          name: "context-mode",
          status: "failed",
          transport: "stdio",
          toolCount: 0,
          error: "not hydrated",
        },
      ],
    },
    events: [],
  } as unknown as RuntimeSession;
}

test("provider control helpers normalize usage and empty-output failures", () => {
  assert.deepEqual(extractGenAiUsage({
    usage: {
      prompt_tokens: 10,
      completion_tokens: 4,
      total_tokens: 14,
    },
  }), {
    "gen_ai.usage.input_tokens": 10,
    "gen_ai.usage.output_tokens": 4,
    "gen_ai.usage.total_tokens": 14,
  });

  assert.deepEqual(extractGenAiUsage({ usage: { input_tokens: "10" } }), {
    "gen_ai.usage.input_tokens": 0,
    "gen_ai.usage.output_tokens": 0,
    "gen_ai.usage.total_tokens": 0,
  });

  assert.deepEqual(createEmptyOutputFailure("openai", "gpt-test", "openai-http-responses"), {
    ok: false,
    provider: "openai",
    model: "gpt-test",
    transport: "openai",
    adapter: "openai-http-responses",
    fallbackApplied: false,
    code: "transport_error",
    message: "provider returned empty output",
    detail: "provider finished with exit code 0 but produced no assistant text.",
  });
});

test("provider nudge helpers keep required-evidence policy data-driven", () => {
  const counts: RequiredEvidenceNudgeState = {};

  assert.equal(incrementRequiredEvidenceNudge(counts, "write"), 1);
  assert.equal(incrementRequiredEvidenceNudge(counts, "write"), 2);
  assert.equal(counts.write, 2);

  assert.equal(getRequiredEvidenceNudge("ask user").summary, "required ask_user_question evidence nudge applied");
  assert.match(getRequiredEvidenceNudge("claim").content, /claimed test or Nexsight work/);

  const session = createMinimalSession();
  recordRequiredEvidenceNudge(session, "required write evidence nudge applied", "x".repeat(180));
  assert.equal(session.events.at(-1)?.summary, "required write evidence nudge applied");
  assert.equal(session.events.at(-1)?.detail?.endsWith("..."), true);
});

test("recovery policy classifies provider output without running provider loops", () => {
  const base = {
    step: 0,
    maxSteps: 8,
    hasWriteEvidence: false,
    priorWriteEvidenceNudges: 0,
    maxWriteEvidenceNudges: 2,
  };

  assert.deepEqual(classifyRecoveryPolicy({
    ...base,
    output: "<nexagent_tool_call>{bad json}</nexagent_tool_call>",
  }), {
    kind: "retry",
    reason: "malformed_tool_call",
  });

  assert.deepEqual(classifyRecoveryPolicy({
    ...base,
    output: "I updated README.md with the new workflow.",
  }), {
    kind: "retry",
    reason: "unsupported_write_completion",
  });

  assert.deepEqual(classifyRecoveryPolicy({
    ...base,
    output: "Tests pass.",
    missingClaimEvidence: "test",
    promptRequiresTestEvidence: false,
  }), {
    kind: "correct",
    reason: "unsupported_test_claim",
  });

  assert.deepEqual(classifyRecoveryPolicy({
    ...base,
    output: "Unblocker: run me in a tool-enabled turn and I can inspect current state.",
  }), {
    kind: "retry",
    reason: "non_actionable_deferral",
  });

  assert.deepEqual(classifyRecoveryPolicy({
    ...base,
    output: "Need write evidence.",
    missingRequiredEvidence: "write",
  }), {
    kind: "block",
    reason: "missing_required_evidence",
    missing: "write",
  });

  assert.deepEqual(classifyRecoveryPolicy({
    ...base,
    output: "Observed: README.md needs an update.",
  }), {
    kind: "accept",
  });
});

test("recovery phrase helpers avoid planning text false positives", () => {
  assert.equal(claimsUnsupportedWriteCompletion("I updated README.md with new commands.", 0), true);
  assert.equal(claimsUnsupportedWriteCompletion("Observed: README.md needs an update.", 0), false);
  assert.equal(isNonActionableDeferral("Unblocker: run me in a tool-enabled turn."), true);
  assert.equal(isNonActionableDeferral("Done - verification passed."), false);
});

test("required Nexsight helpers summarize bounded fallback evidence", () => {
  const prompt = createRequiredNexsightPreflightPrompt("Base prompt", [
    "one",
    "two",
    "three",
    "four",
  ]);
  assert.match(prompt, /Required Nexsight preflight evidence/);
  assert.match(prompt, /The harness already ran Nexsight/);

  const session = createMinimalSession();
  const result = createRequiredNexsightFallbackSuccess(
    { session },
    "gpt-test",
    "codex",
    "codex-cli-exec",
    {
      ok: true,
      output: JSON.stringify({
        requested: ".",
        root: "/repo",
        exists: true,
        kind: "directory",
        topLevel: [{ name: "src", type: "directory" }],
        keyFiles: ["package.json"],
        directories: ["src"],
        filesByExt: { ".ts": 3 },
        sampleFiles: ["src/provider.ts"],
      }),
    },
  );

  assert.equal(result.ok, true);
  assert.match(result.output, /Nexsight fallback completed/);
  assert.match(result.output, /package\.json/);
  assert.equal(session.events.at(-1)?.summary, "codex turn completed");
});

test("tool result helpers classify failures and diagnostics without over-escalating", () => {
  assert.equal(classifyToolFailure("MCP server not hydrated: context-mode"), "mcp_server_not_hydrated");
  assert.equal(classifyToolFailure("policy blocked protected path /etc/passwd"), "policy_blocked");
  assert.equal(classifyToolFailure("timed out after 30s"), "timeout");
  assert.equal(formatToolDuration(-200), "0.00s");
  assert.equal(formatToolArgumentsPreview(undefined), "none");
  assert.match(formatToolArgumentsPreview({ value: "x".repeat(300) }), /\.\.\.$/);

  const diagnostic = createToolFailureDiagnosticInput({
    session: createMinimalSession(),
    call: {
      id: "call_1",
      name: "mcp_call",
      arguments: {
        server: "context-mode",
        tool: "ctx_search",
      },
    },
    risk: "guarded",
    failureClass: "mcp_server_not_hydrated",
    output: "MCP server not hydrated: context-mode",
    durationMs: 123,
    inputTokens: 10,
    outputTokens: 2,
  });

  assert.equal(diagnostic.class, "tool.mcp_unavailable");
  assert.equal(diagnostic.attributes.mcp_server, "context-mode");
  assert.equal(diagnostic.attributes.mcp_status, "failed");
});
