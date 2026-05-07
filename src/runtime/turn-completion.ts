import type { MissingTurnEvidence } from "./tool-capable-turn.js";

export type TurnCompletionStopReason =
  | "completed"
  | "recovered_response_lane_blocker"
  | "tool_budget_exhausted"
  | "empty_output"
  | "missing_evidence"
  | "provider_error"
  | "auth_unavailable"
  | "unsupported_model"
  | "operation_canceled";

export interface TurnCompletion {
  ok: boolean;
  stopReason: TurnCompletionStopReason;
  stepCount?: number;
  toolCallCount?: number;
  missingEvidence?: MissingTurnEvidence[];
  permissionDenials?: string[];
  errors?: string[];
  partial?: boolean;
}

export function createTurnCompletion(input: TurnCompletion): TurnCompletion {
  return {
    ok: input.ok,
    stopReason: input.stopReason,
    ...(input.stepCount !== undefined ? { stepCount: input.stepCount } : {}),
    ...(input.toolCallCount !== undefined ? { toolCallCount: input.toolCallCount } : {}),
    ...(input.missingEvidence && input.missingEvidence.length > 0 ? { missingEvidence: [...input.missingEvidence] } : {}),
    ...(input.permissionDenials && input.permissionDenials.length > 0 ? { permissionDenials: [...input.permissionDenials] } : {}),
    ...(input.errors && input.errors.length > 0 ? { errors: [...input.errors] } : {}),
    ...(input.partial !== undefined ? { partial: input.partial } : {}),
  };
}
