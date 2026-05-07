export type CodexReasoningEffort = "low" | "medium" | "high" | "xhigh";
export type CodexThinkingLevel = "minimal" | "low" | "medium" | "high";
export type CodexModelFamily = "codex" | "gpt";

export interface CodexThinkingLevelControl {
  provider: "codex" | "openai" | "codex-cli";
  transportModes: readonly string[];
  parameter: string;
}

export interface CodexThinkingLevelMetadata {
  defaultThinkingLevel: CodexThinkingLevel;
  supportedThinkingLevels: readonly CodexThinkingLevel[];
  providerControls: readonly CodexThinkingLevelControl[];
}

export interface CodexModelDefinition {
  id: string;
  label: string;
  description: string;
  family: CodexModelFamily;
  supportedInApi: boolean;
  defaultReasoningEffort: CodexReasoningEffort;
  supportedReasoningEfforts: readonly CodexReasoningEffort[];
  thinkingLevelMetadata: CodexThinkingLevelMetadata;
  contextWindow: number;
  maxContextWindow: number;
  additionalSpeedTiers?: readonly string[];
  upgrade?: string;
}

const GPT_5_REASONING_EFFORTS = ["low", "medium", "high", "xhigh"] as const;
const GPT_5_THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
const GPT_5_THINKING_LEVEL_CONTROLS = [
  { provider: "codex", transportModes: ["codex-http"], parameter: "thinkingLevel" },
  { provider: "openai", transportModes: ["http-responses"], parameter: "reasoning.effort" },
  { provider: "codex-cli", transportModes: ["cli-exec"], parameter: "model_reasoning_effort" },
] as const;

function createThinkingLevelMetadata(defaultThinkingLevel: CodexThinkingLevel): CodexThinkingLevelMetadata {
  return {
    defaultThinkingLevel,
    supportedThinkingLevels: GPT_5_THINKING_LEVELS,
    providerControls: GPT_5_THINKING_LEVEL_CONTROLS,
  };
}

export const CODEX_MODEL_CATALOG: readonly CodexModelDefinition[] = [
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    description: "Strong model for everyday coding",
    family: "gpt",
    supportedInApi: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: GPT_5_REASONING_EFFORTS,
    thinkingLevelMetadata: createThinkingLevelMetadata("medium"),
    contextWindow: 272000,
    maxContextWindow: 1000000,
    additionalSpeedTiers: ["fast"],
  },
  {
    id: "gpt-5.5",
    label: "GPT-5.5",
    description: "Frontier model for complex coding, research, and real-world work",
    family: "gpt",
    supportedInApi: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: GPT_5_REASONING_EFFORTS,
    thinkingLevelMetadata: createThinkingLevelMetadata("medium"),
    contextWindow: 272000,
    maxContextWindow: 272000,
    additionalSpeedTiers: ["fast"],
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    description: "Small, fast, and cost-efficient model for simpler coding tasks",
    family: "gpt",
    supportedInApi: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: GPT_5_REASONING_EFFORTS,
    thinkingLevelMetadata: createThinkingLevelMetadata("medium"),
    contextWindow: 272000,
    maxContextWindow: 272000,
  },
  {
    id: "gpt-5.3-codex",
    label: "GPT-5.3 Codex",
    description: "Coding-optimized model",
    family: "codex",
    supportedInApi: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: GPT_5_REASONING_EFFORTS,
    thinkingLevelMetadata: createThinkingLevelMetadata("medium"),
    contextWindow: 272000,
    maxContextWindow: 272000,
    upgrade: "gpt-5.4",
  },
  {
    id: "gpt-5.3-codex-spark",
    label: "GPT-5.3 Codex Spark",
    description: "Ultra-fast coding model",
    family: "codex",
    supportedInApi: false,
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: GPT_5_REASONING_EFFORTS,
    thinkingLevelMetadata: createThinkingLevelMetadata("high"),
    contextWindow: 128000,
    maxContextWindow: 128000,
  },
  {
    id: "gpt-5.2",
    label: "GPT-5.2",
    description: "Optimized for professional work and long-running agents",
    family: "gpt",
    supportedInApi: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: GPT_5_REASONING_EFFORTS,
    thinkingLevelMetadata: createThinkingLevelMetadata("medium"),
    contextWindow: 272000,
    maxContextWindow: 272000,
    upgrade: "gpt-5.4",
  },
] as const;

export const DEFAULT_CODEX_MODEL = "gpt-5.4";
export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = "medium";

export function normalizeCodexModel(model: string | null): string | null {
  if (!model) {
    return null;
  }

  const normalized = model.trim().toLowerCase();
  if (
    normalized === "codexspark" ||
    normalized === "chatgpt-5.3-codex-spark" ||
    normalized === "gtp-5.3-codex-spark"
  ) {
    return "gpt-5.3-codex-spark";
  }
  if (normalized === "codexplan") {
    return DEFAULT_CODEX_MODEL;
  }
  if (normalized === "gpt-5.2-codex" || normalized === "gpt-5.1-codex-max" || normalized === "gpt-5.1-codex") {
    return "gpt-5.3-codex";
  }
  if (normalized === "gpt-5.1-codex-mini") {
    return "gpt-5.4-mini";
  }

  return normalized;
}

export function getCodexModelDefinition(model: string | null): CodexModelDefinition | null {
  const normalized = normalizeCodexModel(model);
  if (!normalized) {
    return null;
  }
  return CODEX_MODEL_CATALOG.find((entry) => entry.id === normalized) ?? null;
}

export function normalizeCodexReasoningEffort(value: string | null | undefined): CodexReasoningEffort | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "extra-high" || normalized === "extra_high" || normalized === "x-high" || normalized === "x_high") {
    return "xhigh";
  }
  return normalized === "low" || normalized === "medium" || normalized === "high" || normalized === "xhigh"
    ? normalized
    : null;
}

export function normalizeCodexThinkingLevel(value: string | null | undefined): CodexThinkingLevel | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "min" || normalized === "none") {
    return "minimal";
  }
  return normalized === "minimal" || normalized === "low" || normalized === "medium" || normalized === "high"
    ? normalized
    : null;
}

export function getCodexThinkingLevelMetadata(model: string | null): CodexThinkingLevelMetadata | null {
  return getCodexModelDefinition(model)?.thinkingLevelMetadata ?? null;
}

export function isCodexApiSupportedModel(model: string | null): boolean {
  const definition = getCodexModelDefinition(model);
  return definition ? definition.supportedInApi : true;
}
