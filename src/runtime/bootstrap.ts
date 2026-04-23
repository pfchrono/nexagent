import { loadHarnessConfig, type HarnessConfig } from "./config.js";
import { loadMcpRegistrySummary, type McpRegistrySummary } from "./mcp.js";

export interface RuntimeBootstrap {
  config: HarnessConfig;
  mcp: McpRegistrySummary;
}

export interface RuntimeState {
  product: string;
  provider: string;
  cwd: string;
  mcpServers: string[];
  enabledMcpServers: string[];
  imports: HarnessConfig["imports"];
}

export async function bootstrapRuntime(cwd: string): Promise<RuntimeBootstrap> {
  const config = await loadHarnessConfig(cwd);
  const mcp = await loadMcpRegistrySummary(config.mcpConfigPath, config.enabledMcpServers);

  return {
    config,
    mcp,
  };
}

export function createRuntimeState(runtime: RuntimeBootstrap): RuntimeState {
  return {
    product: runtime.config.productName,
    provider: runtime.config.provider,
    cwd: runtime.config.cwd,
    mcpServers: runtime.mcp.serverNames,
    enabledMcpServers: runtime.config.enabledMcpServers,
    imports: runtime.config.imports,
  };
}
