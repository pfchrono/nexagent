import assert from "node:assert/strict";
import test from "node:test";

import {
  createRuntimeDiagnostic,
  getDiagnosticClasses,
  normalizeDiagnosticAttributes,
} from "../src/runtime/diagnostics.js";

test("diagnostic taxonomy has metadata for all classes", () => {
  const classes = getDiagnosticClasses();
  assert.ok(classes.length >= 16);
  for (const diagnosticClass of classes) {
    const event = createRuntimeDiagnostic({ class: diagnosticClass });
    assert.equal(event.class, diagnosticClass);
    assert.match(event.severity, /^(info|warning|error)$/);
    assert.ok(event.summary.length > 0);
  }
});

test("diagnostic attributes keep only safe primitive data", () => {
  const attrs = normalizeDiagnosticAttributes({
    provider: "codex",
    transport: "codex-http",
    duration_ms: 42,
    retried: true,
    output: "raw assistant output must not survive",
    assistant_output: "raw assistant output must not survive",
    tool_content: "raw tool content must not survive",
    transcript_text: "raw transcript text must not survive",
    file_content: "raw file content must not survive",
    raw_json: "{\"prompt\":\"secret\"}",
    payload_body: "raw body must not survive",
    error: "provider stack trace must not survive",
    message: "raw message must not survive",
    detail: "raw detail must not survive",
    prompt: "user prompt must not survive",
    file_path: "/repo/secret.ts",
    api_key: "sk-secretsecretsecret",
    nested: { nope: true },
  });

  assert.deepEqual(attrs, {
    provider: "codex",
    transport: "codex-http",
    duration_ms: 42,
    retried: true,
  });
});
