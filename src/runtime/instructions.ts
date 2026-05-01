import type { RepoInstructionSource } from "./config.js";
import { buildPromptLayers, serializePromptLayers, type PromptLayers } from "./prompt-legacy.js";
import { buildPromptV2, type PromptV2Result } from "./prompt-v2.js";
import { buildPromptV3 } from "./prompt-v3.js";

export interface InstructionContext {
  provider: string;
  prompt?: {
    assembly: "legacy" | "v2";
  };
  commandModes?: {
    cavemanMode: boolean;
    deadpoolMode: boolean;
  };
  conversation?: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  compaction?: {
    summary: string | null;
    snapshot: {
      styles: string[];
      provider: string;
      transport: string;
      turnCount: number;
      queuedUserMessage: string | null;
    } | null;
    compactCount: number;
  };
  providerRouting: {
    fallback: {
      policy: string;
    };
  };
  providerTransport?: {
    executor: string;
    adapter: string;
    mode: string;
    authSource: string;
    authGate: string;
    activeProvider: string;
    openaiBaseUrl: string | null;
    silentFallback: boolean;
  };
  cwd: string;
  toolPolicy?: {
    mode: string;
    readRoots?: string[];
    allowedRoots: string[];
    protectedRoots: string[];
  };
  mcpServers: string[];
  enabledMcpServers: string[];
  imports: {
    claude: {
      path: string;
      importedKeys: string[];
    } | null;
  };
  instructionSources: RepoInstructionSource[];
  archivist?: {
    enabled: boolean;
    retrieval: {
      used: boolean;
      sourceCategory: string | null;
      matchCount: number;
      preview: string | null;
    };
  };
  activeSkill?: {
    name: string;
    source: string;
    path: string;
    args: string;
    content: string;
  };
}

export interface AssembledPrompt {
  layers: PromptLayers | null;
  v2: PromptV2Result | null;
  prompt: string;
}

export async function assemblePrompt(request: { session: InstructionContext; prompt: string }): Promise<AssembledPrompt> {
  const useV2 = request.session.prompt?.assembly !== "legacy";
  if (useV2) {
    const v3 = buildPromptV3({ session: request.session, prompt: request.prompt });
    return {
      layers: null,
      v2: v3.v2,
      prompt: v3.prompt,
    };
  }

  const layers = buildPromptLayers(request.session, request.prompt);
  return {
    layers,
    v2: null,
    prompt: serializePromptLayers(layers),
  };
}
