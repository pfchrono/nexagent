import type { InstructionContext } from "./instructions.js";
import { buildPromptV2, type PromptV2Result } from "./prompt-v2.js";
import { deriveTurnObligations } from "./nexsight-router.js";
import { getToolContracts } from "./tool-contracts.js";

const V3_BOUNDARY = "__NEXAGENT_PROMPT_V3_DYNAMIC_BOUNDARY__";

export interface PromptV3Result {
  prompt: string;
  v2: PromptV2Result;
  contractSection: string;
}

export function buildPromptV3(request: { session: InstructionContext; prompt: string }): PromptV3Result {
  const v2 = buildPromptV2({
    session: request.session,
    prompt: request.prompt,
  });
  const obligations = deriveTurnObligations(request.prompt, request.session);
  const contractLines = [
    "Runtime contracts:",
    `- Required write evidence: ${obligations.requiresWriteEvidence ? "yes" : "no"}`,
    `- Required Nexsight evidence: ${obligations.requiresNexsightEvidence ? "yes" : "no"}`,
    `- Required active skill evidence: ${obligations.requiresActiveSkillEvidence ? "yes" : "no"}`,
    "- Evidence contract:",
    "  - Label user-facing claims as observed, verified, inferred, assumption, or unknown.",
    "  - observed = directly read code/log/test/source this turn.",
    "  - verified = reproduced by command/test/tool result this turn.",
    "  - inferred = likely from evidence but not proven; assumption = working guess; unknown = insufficient evidence.",
    "  - Before proposing code changes, inspect relevant implementation, existing tests/docs/config, and one counter-evidence path when practical.",
    "  - For candidate fixes, classify verdict as true bug, covered behavior, design gap, or unknown.",
    "  - If evidence contradicts hypothesis, update verdict and continue; do not force a fix.",
    "  - Loop safety: evidence labels guide claims, not loop termination. If claim is inferred/unknown and task remains actionable, use the smallest next inspection/verification tool instead of stopping.",
    "  - Hard stops only: verified completion, approval/safety gate, unavailable external dependency, exhausted runtime tool budget, or user-requested pause/stop.",
    "  - Chat presentation: keep final answers compact and readable; put detailed evidence in files or trace unless requested in chat.",
    "- Tool contracts:",
    ...getToolContracts().map((contract) => `  - ${contract.name}: ${contract.summary} (evidence=${contract.evidence})`),
  ];

  const prompt = [
    v2.prompt,
    V3_BOUNDARY,
    contractLines.join("\n"),
  ].join("\n\n");

  return {
    prompt,
    v2,
    contractSection: contractLines.join("\n"),
  };
}
