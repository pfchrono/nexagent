import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPromptV2,
  createPromptV2Section,
  NEXAGENT_PROMPT_DYNAMIC_BOUNDARY,
} from "../src/runtime/prompt-v2.js";
import type { InstructionContext } from "../src/runtime/instructions.js";

function createInstructionContext(): InstructionContext {
  return {
    provider: "codex",
    commandModes: {
      cavemanMode: false,
      deadpoolMode: false,
    },
    providerRouting: {
      fallback: {
        policy: "require-open-spec",
      },
    },
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
      mode: "repo-local-guarded",
      readRoots: ["/repo", "/home/user/code"],
      allowedRoots: ["/repo"],
      protectedRoots: ["/etc", "/usr"],
    },
    mcpServers: ["context7"],
    enabledMcpServers: ["context7"],
    imports: {
      claude: null,
    },
    instructionSources: [
      {
        kind: "AGENTS.md",
        path: "/repo/AGENTS.md",
        layer: "repoBehavior",
        summary: "Repo rules",
        detail: "Use repo tests before completion.",
      },
    ],
  };
}

test("buildPromptV2 separates stable core from dynamic runtime context", () => {
  const prompt = buildPromptV2({
    session: createInstructionContext(),
    prompt: "Fix prompt loop",
  });

  assert.match(prompt.prompt, /## Identity/);
  assert.match(prompt.prompt, /## Execution Contract/);
  assert.match(prompt.prompt, /## Tool Routing/);
  assert.match(prompt.prompt, /## Provider Guidance/);
  assert.match(prompt.prompt, new RegExp(NEXAGENT_PROMPT_DYNAMIC_BOUNDARY));
  assert.match(prompt.prompt, /## Repo Context/);
  assert.match(prompt.prompt, /## Runtime State/);
  assert.match(prompt.prompt, /## Current Invocation/);

  const boundaryIndex = prompt.prompt.indexOf(NEXAGENT_PROMPT_DYNAMIC_BOUNDARY);
  assert.ok(prompt.prompt.indexOf("## Execution Contract") < boundaryIndex);
  assert.ok(prompt.prompt.indexOf("## Runtime State") > boundaryIndex);
});

test("buildPromptV2 emits stable section snapshot for default codex cli prompt", () => {
  const prompt = buildPromptV2({
    session: createInstructionContext(),
    prompt: "Fix prompt loop",
  });

  assert.deepEqual(
    prompt.sections.map((section) => [section.id, section.cache, section.source]),
    [
      ["identity", "stable", "core"],
      ["execution_contract", "stable", "core"],
      ["tool_routing", "stable", "core"],
      ["editing_safety", "stable", "core"],
      ["provider_guidance", "stable", "provider"],
      ["repo_context", "dynamic", "repo"],
      ["runtime_state", "dynamic", "runtime"],
      ["current_invocation", "dynamic", "conversation"],
    ],
  );
  assert.match(prompt.prompt, /Transport: Codex CLI \(codex-cli-exec\); auth=ready\./);
});

test("buildPromptV2 tells models to infer test targets from repo evidence", () => {
  const prompt = buildPromptV2({
    session: createInstructionContext(),
    prompt: "Run a real no-hand-holding harness test: simple, advanced, and export.",
  });

  assert.match(prompt.prompt, /no-hand-holding run/);
  assert.match(prompt.prompt, /Do not ask user to say proceed/);
  assert.match(prompt.prompt, /choose the nearest representative target/);
  assert.match(prompt.prompt, /A missing user-selected target is not a blocker/);
});

test("buildPromptV2 includes recent turns so short acknowledgments resolve prior proposal", () => {
  const session = createInstructionContext();
  session.conversation = [
    {
      role: "user",
      content: "Diagnose why the model only talks instead of using tools.",
    },
    {
      role: "assistant",
      content: "If you want, next I can do the same style scan on /home/pfchrono/code/openclaw and give directory map, language breakdown, likely entrypoints, and tests.",
    },
  ];

  const prompt = buildPromptV2({
    session,
    prompt: "ok",
  });

  assert.match(prompt.prompt, /## Conversation State/);
  assert.match(prompt.prompt, /Short confirmations like ok, yes, do that, same, or continue/);
  assert.match(prompt.prompt, /Recent assistant:/);
  assert.match(prompt.prompt, /openclaw/);
  assert.match(prompt.prompt, /## Current Invocation/);
  assert.match(prompt.prompt, /- ok/);
});

test("buildPromptV2 explains Nexsight processed-output workflow", () => {
  const prompt = buildPromptV2({
    session: createInstructionContext(),
    prompt: "Use Nexsight to inspect the repo and summarize findings.",
  });

  assert.match(prompt.prompt, /Use Nexsight like context-mode/);
  assert.match(prompt.prompt, /prints distilled findings/);
  assert.ok(prompt.prompt.includes("parse stdout/stderr"));
  assert.match(prompt.prompt, /run a narrower follow-up query/);
});

test("buildPromptV2 applies provider section overrides", () => {
  const prompt = buildPromptV2({
    session: createInstructionContext(),
    prompt: "Run tests",
    contribution: {
      sectionOverrides: {
        execution_contract: createPromptV2Section({
          id: "execution_contract",
          title: "Execution Contract",
          priority: 20,
          cache: "stable",
          source: "provider",
          content: ["Provider override rule."],
        }),
      },
    },
  });

  assert.match(prompt.prompt, /Provider override rule\./);
  assert.doesNotMatch(prompt.prompt, /Actionable request means act in this turn\./);
});

test("buildPromptV2 keeps style modes dynamic and subordinate", () => {
  const session = createInstructionContext();
  session.commandModes = {
    cavemanMode: true,
    deadpoolMode: true,
  };

  const prompt = buildPromptV2({
    session,
    prompt: "Explain failure",
  });

  const execution = prompt.sections.find((section) => section.id === "execution_contract");
  const caveman = prompt.sections.find((section) => section.id === "style_caveman");
  const deadpool = prompt.sections.find((section) => section.id === "style_deadpool");

  assert.equal(execution?.cache, "stable");
  assert.equal(caveman?.cache, "dynamic");
  assert.equal(deadpool?.cache, "dynamic");
  assert.ok((execution?.priority ?? 999) < (caveman?.priority ?? 0));
});

test("buildPromptV2 snapshots archivist and active skill conversation context", () => {
  const session = createInstructionContext();
  session.archivist = {
    enabled: true,
    retrieval: {
      used: true,
      sourceCategory: "project-memory",
      matchCount: 1,
      preview: "- [memory] use codex-http for image attachments",
    },
  };
  session.activeSkill = {
    name: "gsd-next",
    source: "repo",
    path: "/repo/.codex/skills/gsd-next/SKILL.md",
    args: "",
    content: "Advance to next GSD step.",
  };

  const prompt = buildPromptV2({
    session,
    prompt: "continue",
  });

  assert.match(prompt.prompt, /## Conversation State/);
  assert.match(prompt.prompt, /Archivist: enabled; retrieval matches=1/);
  assert.match(prompt.prompt, /Archivist retrieval: project-memory/);
  assert.match(prompt.prompt, /use codex-http for image attachments/);
  assert.match(prompt.prompt, /## Active Skill/);
  assert.match(prompt.prompt, /Active skill: gsd-next/);
  assert.match(prompt.prompt, /Args: \(none\)/);
  assert.match(prompt.prompt, /Do not only say activated, started, ready/);
  assert.match(prompt.prompt, /Advance to next GSD step\./);
});

test("buildPromptV2 switches provider guidance by transport", () => {
  const session = createInstructionContext();
  session.provider = "openai";
  session.providerTransport = {
    executor: "fetch",
    adapter: "openai-http-responses",
    mode: "http-responses",
    authSource: "openai-api-key",
    authGate: "ready",
    activeProvider: "openai",
    openaiBaseUrl: "https://api.openai.test/v1",
    silentFallback: false,
  };

  const prompt = buildPromptV2({
    session,
    prompt: "use native tools",
  });

  assert.match(prompt.prompt, /Transport: OpenAI Responses HTTP \(openai-http-responses\); auth=ready\./);
  assert.match(prompt.prompt, /Prefer native tool calling/);
  assert.match(prompt.prompt, /Do not emit XML tool markup when native tool calling is active/);
});
