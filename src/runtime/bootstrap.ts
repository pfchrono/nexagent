import { loadHarnessConfig, type HarnessConfig } from "./config.js";
import { loadMcpRegistrySummary, type McpRegistrySummary } from "./mcp.js";

export interface RuntimeBootstrap {
  config: HarnessConfig;
  mcp: McpRegistrySummary;
}

export async function bootstrapRuntime(cwd: string): Promise<RuntimeBootstrap> {
  const config = await loadHarnessConfig(cwd);
  const mcp = await loadMcpRegistrySummary(config.mcpConfigPath);

  return {
    config,
    mcp,
  };
}
