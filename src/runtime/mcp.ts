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

export async function loadMcpRegistrySummary(
  filePath: string,
  enabledServers: string[] = [],
): Promise<McpRegistrySummary> {
  const parsed = await readMcpConfigFile(filePath);
  const allServers = parsed?.mcpServers ?? {};
  const servers =
    enabledServers.length === 0
      ? allServers
      : Object.fromEntries(
          Object.entries(allServers).filter(([name]) => enabledServers.includes(name)),
        );

  return {
    serverNames: Object.keys(servers).sort(),
    servers,
  };
}

async function readMcpConfigFile(filePath: string): Promise<McpConfigFile | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as McpConfigFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}
