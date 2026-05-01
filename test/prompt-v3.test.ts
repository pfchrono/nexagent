import assert from "node:assert/strict";
import test from "node:test";

import { buildPromptV3 } from "../src/runtime/prompt-v3.js";
import type { InstructionContext } from "../src/runtime/instructions.js";

function createInstructionContext(): InstructionContext {
  return {
    provider: "codex",
    prompt: { assembly: "v2" },
    commandModes: { cavemanMode: false, deadpoolMode: false },
    providerRouting: { fallback: { policy: "require-open-spec" } },
    providerTransport: {
      executor: "codex",
      adapter: "codex-cli-exec",
      mode: "cli-exec",
      authSource: "codex-login",
      authGate: "ready",
      activeProvider: "codex",
      openaiBaseUrl: null,
      silentFallback: false,
    },
    cwd: "/repo",
    toolPolicy: {
      mode: "workspace-guarded",
      readRoots: ["/repo"],
      allowedRoots: ["/repo"],
      protectedRoots: ["/etc", "/usr", "/bin", "/var"],
    },
    mcpServers: [],
    enabledMcpServers: [],
    imports: { claude: null },
    instructionSources: [],
    archivist: {
      enabled: false,
      retrieval: {
        used: false,
        sourceCategory: null,
        matchCount: 0,
        preview: null,
      },
    },
    conversation: [],
    compaction: {
      summary: null,
      snapshot: null,
      compactCount: 0,
    },
  };
}

test("prompt v3 appends runtime contract section and keeps v2 payload", () => {
  const result = buildPromptV3({
    session: createInstructionContext(),
    prompt: "edit README.md and use nexsight to inspect repo",
  });

  assert.match(result.prompt, /__NEXAGENT_PROMPT_V3_DYNAMIC_BOUNDARY__/);
  assert.match(result.contractSection, /Required write evidence: yes/);
  assert.match(result.contractSection, /Required Nexsight evidence: yes/);
  assert.match(result.contractSection, /Tool contracts:/);
  assert.ok(result.v2.sections.length > 0);
});
