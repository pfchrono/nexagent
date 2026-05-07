import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
      ["task_tool_guidance", "dynamic", "runtime"],
      ["current_invocation", "dynamic", "conversation"],
    ],
  );
  assert.match(prompt.prompt, /Transport: Codex CLI \(codex-cli-exec\); auth=ready\./);
  assert.match(prompt.prompt, /Text tool-call transport: there is no separate function-call UI/);
  assert.match(prompt.prompt, /<nexagent_tool_call>\{"name":"read_file","arguments":\{"path":"README\.md"\}\}<\/nexagent_tool_call>/);
});

test("buildPromptV2 adds task-specific tool guidance for broad repo work and verification", () => {
  const prompt = buildPromptV2({
    session: createInstructionContext(),
    prompt: "Investigate provider failure across the codebase and verify with tests.",
  });

  assert.match(prompt.prompt, /## Task Tool Guidance/);
  assert.match(prompt.prompt, /Broad repo\/codebase work/);
  assert.match(prompt.prompt, /one nexsight_gather or nexsight_execute/);
  assert.match(prompt.prompt, /Runtime\/provider debugging/);
  assert.match(prompt.prompt, /Verification claims require shell_command evidence/);
  assert.match(prompt.prompt, /Recovery: if a tool is rejected or noisy/);
});

test("buildPromptV2 adds exact file guidance for source and markdown reads", () => {
  const prompt = buildPromptV2({
    session: createInstructionContext(),
    prompt: "Read AGENTS.md and src/runtime/tools.ts, then summarize what tools to use.",
  });

  assert.match(prompt.prompt, /Exact file work: use read_file/);
  assert.match(prompt.prompt, /Instruction\/source reading/);
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

test("buildPromptV2 tells final answers not to replay rendered edit diffs", () => {
  const prompt = buildPromptV2({
    session: createInstructionContext(),
    prompt: "Patch a file and report the result.",
  });

  assert.match(prompt.prompt, /Edited-file block or bounded diff preview/);
  assert.match(prompt.prompt, /should not repeat the full diff/);
  assert.match(prompt.prompt, /summarize changed paths, line counts, verification, and blockers only/);
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
  const reminder = prompt.sections.find((section) => section.id === "style_active_reminder");

  assert.equal(execution?.cache, "stable");
  assert.equal(caveman?.cache, "dynamic");
  assert.equal(deadpool?.cache, "dynamic");
  assert.equal(reminder?.cache, "dynamic");
  assert.ok((execution?.priority ?? 999) < (caveman?.priority ?? 0));
  assert.ok((reminder?.priority ?? 0) > (deadpool?.priority ?? 999));
  assert.match(caveman?.content.join("\n") ?? "", /Pattern: \[thing\] \[action\] \[reason\]\. \[next step\]\./);
  assert.match(caveman?.content.join("\n") ?? "", /Every normal sentence to the user should be ultra-compressed caveman style/);
  assert.match(caveman?.content.join("\n") ?? "", /Structured and machine-readable content stays exact/);
  assert.match(deadpool?.content.join("\n") ?? "", /Deadpool mode is a hard user-visible prose style/);
  assert.match(deadpool?.content.join("\n") ?? "", /must sound recognizably Deadpool-flavored/);
  assert.match(deadpool?.content.join("\n") ?? "", /Default normal explanatory prose, progress updates, and final summaries to this voice/);
  assert.match(deadpool?.content.join("\n") ?? "", /Do not apply Deadpool voice to tool calls/);
  assert.match(deadpool?.content.join("\n") ?? "", /LSP diagnostics/);
  assert.match(deadpool?.content.join("\n") ?? "", /Do not copy copyrighted quotes or signature catchphrases/);
  assert.match(reminder?.content.join("\n") ?? "", /Active style stack: deadpool \+ caveman/);
  assert.match(reminder?.content.join("\n") ?? "", /Never alter tool calls, JSON\/XML, code blocks/);
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

test("buildPromptV2 hydrates active skill absolute file references", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "nexagent-prompt-skill-ref-"));
  try {
    const workflowPath = path.join(cwd, "workflow.md");
    writeFileSync(workflowPath, "Read project stats and report them.", "utf8");
    const session = createInstructionContext();
    session.activeSkill = {
      name: "stats",
      source: "repo",
      path: path.join(cwd, "SKILL.md"),
      args: "",
      content: `<execution_context>\n@${workflowPath}\n</execution_context>`,
    };

    const prompt = buildPromptV2({ session, prompt: "execute active skill stats now" });

    assert.match(prompt.prompt, /Required: make at least one valid nexagent tool call/);
    assert.match(prompt.prompt, /Referenced skill files:/);
    assert.match(prompt.prompt, /Read project stats and report them\./);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
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

test("buildPromptV2 tells codex-http to use text tool envelope, not nonexistent native functions", () => {
  const session = createInstructionContext();
  session.providerTransport = {
    executor: "fetch",
    adapter: "codex-chatgpt-http",
    mode: "codex-http",
    authSource: "codex-auth-json",
    authGate: "ready",
    activeProvider: "codex",
    openaiBaseUrl: "https://chatgpt.com/backend-api/codex",
    silentFallback: false,
  };

  const prompt = buildPromptV2({
    session,
    prompt: "write a file",
  });

  assert.match(prompt.prompt, /Transport: Codex ChatGPT HTTP \(codex-chatgpt-http\); auth=ready\./);
  assert.match(prompt.prompt, /This transport still uses Nexagent text tool-call markup/);
  assert.match(prompt.prompt, /do not wait for native callable functions/);
  assert.match(prompt.prompt, /<nexagent_tool_call>\{"name":"read_file","arguments":\{"path":"README\.md"\}\}<\/nexagent_tool_call>/);
});
