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
