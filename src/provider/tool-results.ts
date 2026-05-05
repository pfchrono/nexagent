import { getMcpServerStatus } from "../runtime/mcp.js";
import type { RuntimeDiagnosticInput } from "../runtime/diagnostics.js";
import type { RuntimeSession } from "../runtime/session.js";
import type { InternalToolCall } from "../runtime/tools.js";

export type ToolRisk = "low" | "guarded";

export interface ToolFailureDiagnosticOptions {
  session: RuntimeSession;
  call: InternalToolCall;
  risk: ToolRisk;
  failureClass: string;
  output: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

export function createToolFailureDiagnosticInput(options: ToolFailureDiagnosticOptions): RuntimeDiagnosticInput {
  const { session, call, risk, failureClass, output, durationMs, inputTokens, outputTokens } = options;
  return {
    class: classifyToolDiagnostic(call, failureClass),
    attributes: {
      tool_name: call.name,
      risk,
      failure_class: failureClass,
      failure_hint: summarizeToolFailure(output),
      argument_count: Object.keys(call.arguments ?? {}).length,
      duration_ms: durationMs,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      ...mcpFailureDiagnosticAttributes(session, call),
    },
  };
}

export function classifyToolFailure(output: string): string {
  const normalized = output.toLowerCase();
  if (normalized.includes("mcp server not hydrated")) {
    return "mcp_server_not_hydrated";
  }
  if (normalized.includes("http mcp transport not bridged")) {
    return "mcp_transport_unavailable";
  }
  if (normalized.includes("server and tool are required")) {
    return "mcp_missing_target";
  }
  if (normalized.includes("required write evidence") || normalized.includes("missing evidence")) {
    return "missing_evidence";
  }
  if (normalized.includes("requires") && normalized.includes("execution path")) {
    return "async_tool_pending";
  }
  if (normalized.includes("timed out")) {
    return "timeout";
  }
  if (normalized.includes("protected path") || normalized.includes("policy blocked")) {
    return "policy_blocked";
  }
  if (normalized.includes("malformed") || normalized.includes("schema") || normalized.includes("arguments")) {
    return "malformed_tool_call";
  }
  if (normalized.includes("blocked") || normalized.includes("rejected")) {
    return "blocked_tool";
  }
  if (normalized.includes("is not a file")) {
    return "path_not_file";
  }
  if (normalized.includes("not found") || normalized.includes("no such file")) {
    return "path_not_found";
  }
  return "tool_failed";
}

export function formatToolDuration(durationMs: number): string {
  return `${(Math.max(0, durationMs) / 1000).toFixed(2)}s`;
}

export function formatToolArgumentsPreview(value: unknown): string {
  if (value === null || value === undefined) {
    return "none";
  }
  try {
    const raw = JSON.stringify(value);
    if (!raw) {
      return "none";
    }
    return raw.length > 220 ? `${raw.slice(0, 217)}...` : raw;
  } catch {
    return String(value);
  }
}

function summarizeToolFailure(output: string): string {
  const normalized = output.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "empty tool failure";
  }
  if (/code or command required/i.test(normalized)) {
    return "missing code or command argument";
  }
  if (/server and tool are required/i.test(normalized)) {
    return "missing MCP server or tool argument";
  }
  if (/MCP server not hydrated/i.test(normalized)) {
    return "MCP server not hydrated";
  }
  if (/timed out/i.test(normalized)) {
    return "tool timed out";
  }
  if (/protected path|policy blocked/i.test(normalized)) {
    return "policy blocked";
  }
  if (/not found|no such file/i.test(normalized)) {
    return "target not found";
  }
  return normalized.slice(0, 120);
}

function classifyToolDiagnostic(call: InternalToolCall, failureClass: string): RuntimeDiagnosticInput["class"] {
  if (isMcpUnavailableFailure(call, failureClass)) {
    return "tool.mcp_unavailable";
  }
  if (failureClass === "policy_blocked" || failureClass === "blocked_tool") {
    return "tool.blocked";
  }
  if (failureClass === "path_not_found" || failureClass === "path_not_file" || failureClass === "malformed_tool_call") {
    return "tool.blocked";
  }
  return "tool.failed";
}

function isMcpUnavailableFailure(call: InternalToolCall, failureClass: string): boolean {
  return call.name === "mcp_call" && failureClass.startsWith("mcp_");
}

function mcpFailureDiagnosticAttributes(session: RuntimeSession, call: InternalToolCall): Record<string, string | number> {
  if (call.name !== "mcp_call") {
    return {};
  }

  const server = typeof call.arguments?.server === "string" ? call.arguments.server.trim() : "";
  const tool = typeof call.arguments?.tool === "string" ? call.arguments.tool.trim() : "";
  const status = server ? getMcpServerStatus(session.mcpRegistry, server) : null;

  return {
    mcp_server: server || "missing",
    mcp_tool: tool || "missing",
    mcp_status: status?.status ?? "missing",
    mcp_transport: status?.transport ?? "unknown",
    mcp_tool_count: status?.toolCount ?? 0,
  };
}
