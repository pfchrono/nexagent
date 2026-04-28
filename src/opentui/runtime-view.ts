import type { RuntimeSession } from "../runtime/session.js";

export interface OpenTuiRuntimeView {
  product: string;
  sessionId: string;
  provider: string;
  model: string;
  cwd: string;
  status: string;
  detail: string;
  turnCount: number;
  approval: string;
  toolPolicy: string;
}

export function createOpenTuiRuntimeView(session: RuntimeSession): OpenTuiRuntimeView {
  const configuredModels = session.providerRouting.modelSelection.configuredModels as Record<string, string | undefined>;
  return {
    product: session.product,
    sessionId: session.id,
    provider: session.providerTransport.activeProvider,
    model: configuredModels[session.providerTransport.activeProvider] ?? "unknown",
    cwd: session.cwd,
    status: session.action.status,
    detail: session.action.detail,
    turnCount: session.telemetry.turnCount,
    approval: session.operationControls.yoloMode
      ? "yolo"
      : session.operationControls.requireApprovalForGuarded
        ? "guarded"
        : "open",
    toolPolicy: session.toolPolicy.mode,
  };
}
