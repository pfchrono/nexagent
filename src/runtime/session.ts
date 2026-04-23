import { createRuntimeState, type RuntimeBootstrap, type RuntimeState } from "./bootstrap.js";

export interface RuntimeSession extends RuntimeState {
  id: string;
  startedAt: string;
}

export function createRuntimeSession(runtime: RuntimeBootstrap): RuntimeSession {
  return {
    id: createSessionId(),
    startedAt: new Date().toISOString(),
    ...createRuntimeState(runtime),
  };
}

function createSessionId(): string {
  return `session_${Date.now().toString(36)}`;
}
