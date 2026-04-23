import { readFile } from "node:fs/promises";

export interface McpServerDefinition {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfigFile {
  mcpServers?: Record<string, McpServerDefinition>;
}

export interface McpRegistrySummary {
  serverNames: string[];
  servers: Record<string, McpServerDefinition>;
}

export async function loadMcpRegistrySummary(filePath: string): Promise<McpRegistrySummary> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as McpConfigFile;
  const servers = parsed.mcpServers ?? {};

  return {
    serverNames: Object.keys(servers).sort(),
    servers,
  };
}
