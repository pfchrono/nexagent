import type { RuntimeBootstrap } from "./bootstrap.js";

export interface RuntimeSession {
  id: string;
  provider: string;
  cwd: string;
  startedAt: string;
  mcpServers: string[];
}

export function createRuntimeSession(runtime: RuntimeBootstrap): RuntimeSession {
  return {
    id: createSessionId(),
    provider: runtime.config.defaultProvider,
    cwd: runtime.config.cwd,
    startedAt: new Date().toISOString(),
    mcpServers: runtime.mcp.serverNames,
  };
}

function createSessionId(): string {
  return `session_${Date.now().toString(36)}`;
}
