import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeConfigurationError } from "../src/runtime/debug.js";

test("Sentry integration filter removes Node system error integration", async () => {
  const { filterSentryDefaultIntegrations } = await import("../src/instrument.js");
  const integrations = [
    { name: "InboundFilters" },
    { name: "NodeSystemError" },
    { name: "ContextLines" },
  ];

  assert.deepEqual(filterSentryDefaultIntegrations(integrations).map((integration) => integration.name), [
    "InboundFilters",
    "ContextLines",
  ]);
});

test("expected CLI usage and configuration errors are not reported to Sentry", async () => {
  const { shouldCaptureCliException } = await import("../src/instrument.js");

  assert.equal(shouldCaptureCliException(new RuntimeConfigurationError("debug file must end with .log")), false);
  assert.equal(shouldCaptureCliException(new Error('usage: nexagent run "prompt" or pipe stdin')), false);
  assert.equal(shouldCaptureCliException(new Error("provider failed")), true);
});

test("Sentry diagnostic attributes are redacted and primitive-only", async () => {
  const { buildSentryDiagnosticAttributes, runSentryDiagnosticsSelfTest } = await import("../src/instrument.js");

  const attrs = buildSentryDiagnosticAttributes({
    class: "provider.missing_evidence",
    attributes: {
      provider: "codex",
      output: "raw tool output",
      prompt: "raw prompt",
      duration_ms: 12,
    },
  });

  assert.equal(attrs["nexagent.diagnostic.class"], "provider.missing_evidence");
  assert.equal(attrs["nexagent.diagnostic.provider"], "codex");
  assert.equal(attrs["nexagent.diagnostic.duration_ms"], 12);
  assert.equal("nexagent.diagnostic.output" in attrs, false);
  assert.equal("nexagent.diagnostic.prompt" in attrs, false);
  for (const value of Object.values(attrs)) {
    assert.ok(["string", "number", "boolean"].includes(typeof value));
  }

  const selfTest = await runSentryDiagnosticsSelfTest();
  assert.equal(selfTest.sent, false);
  assert.equal(selfTest.event.class, "sentry.status");
});
