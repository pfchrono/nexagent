import { getToolContract, getToolContracts, type ToolContract } from "./tool-contracts.js";
import { classifyInternalToolRisk } from "./tool-risk.js";
import {
  executeInternalToolAsync,
  formatInternalToolPromptGuidance,
  getInternalToolDefinitions,
  getInternalToolFunctionDefinitions,
  validateInternalToolArguments,
  type InternalToolCall,
  type InternalToolDefinition,
  type InternalToolName,
  type InternalToolResult,
} from "./tools.js";
import type { RuntimeSession } from "./session.js";

export interface InternalToolHost {
  list(): readonly InternalToolDefinition[];
  describe(name: InternalToolName): ToolContract;
  contracts(): readonly ToolContract[];
  promptGuidance(): string[];
  functionDefinitions(): ReadonlyArray<Record<string, unknown>>;
  validate(call: InternalToolCall): InternalToolResult | null;
  authorize(call: InternalToolCall): ReturnType<typeof classifyInternalToolRisk>;
  execute(call: InternalToolCall): Promise<InternalToolResult>;
}

export function createInternalToolHost(session: RuntimeSession): InternalToolHost {
  return {
    list: getInternalToolDefinitions,
    describe: getToolContract,
    contracts: getToolContracts,
    promptGuidance: formatInternalToolPromptGuidance,
    functionDefinitions: getInternalToolFunctionDefinitions,
    validate: validateInternalToolArguments,
    authorize: classifyInternalToolRisk,
    execute: (call) => executeInternalToolAsync(session, call),
  };
}

export function getInternalToolHostPromptGuidance(): string[] {
  return formatInternalToolPromptGuidance();
}

export function getInternalToolHostFunctionDefinitions(): ReadonlyArray<Record<string, unknown>> {
  return getInternalToolFunctionDefinitions();
}
