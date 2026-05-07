import type { RuntimeSession } from "../runtime/session.js";
import { getInternalToolHostFunctionDefinitions } from "../runtime/tool-host.js";
import { fetchWithProviderExecutionPolicy, resolveProviderExecutionPolicy } from "./execution-policy.js";

export interface CodexHttpInvocation {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
  raw?: unknown;
}

export interface CodexHttpAdapter {
  id: "openai-http-responses";
  transport: "openai";
  mode: "http-responses";
  authSource: "openai-api-key";
  command: "fetch";
  supportsProviders: readonly ["codex", "openai"];
}

export const CODEX_HTTP_ADAPTER: CodexHttpAdapter = {
  id: "openai-http-responses",
  transport: "openai",
  mode: "http-responses",
  authSource: "openai-api-key",
  command: "fetch",
  supportsProviders: ["codex", "openai"],
};

export async function invokeCodexHttpTransport(
  request: {
    session: RuntimeSession;
    prompt: string;
    instructions?: string;
    nativeInput?: unknown;
    previousResponseId?: string;
    nativeTools?: boolean;
    abortSignal?: AbortSignal;
  },
  model: string | null,
): Promise<CodexHttpInvocation> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY missing for http transport");
  }

  const baseUrl = (request.session.providerTransport.openaiBaseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const response = await fetchWithProviderExecutionPolicy(
    `${baseUrl}/responses`,
    {
      method: "POST",
      signal: request.abortSignal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model ?? "gpt-5.4",
        ...(request.session.providerRouting.modelSelection.configuredReasoningEfforts?.[request.session.providerTransport.activeProvider]
          ? { reasoning: { effort: request.session.providerRouting.modelSelection.configuredReasoningEfforts[request.session.providerTransport.activeProvider] } }
          : {}),
        ...(request.nativeInput !== undefined ? { input: request.nativeInput } : { input: request.prompt }),
        ...(request.instructions ? { instructions: request.instructions } : {}),
        ...(request.previousResponseId ? { previous_response_id: request.previousResponseId } : {}),
        ...(request.nativeTools ? { tools: getInternalToolHostFunctionDefinitions(), parallel_tool_calls: false } : {}),
        store: false,
      }),
    },
    resolveProviderExecutionPolicy(request.session),
  );

  const bodyText = await response.text();
  if (!response.ok) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${response.status} ${response.statusText}\n${bodyText}`.trim(),
      output: "",
    };
  }

  let payload: unknown = null;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "http transport returned invalid JSON",
      output: "",
    };
  }

  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    output: extractResponseText(payload),
    raw: payload,
  };
}

function extractResponseText(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const value = payload as Record<string, unknown>;
  if (typeof value.output_text === "string") {
    return value.output_text;
  }

  const output = Array.isArray(value.output) ? value.output : [];
  const chunks: string[] = [];

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const message = item as Record<string, unknown>;
    const content = Array.isArray(message.content) ? message.content : [];
    for (const part of content) {
      if (!part || typeof part !== "object") {
        continue;
      }

      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") {
        chunks.push(record.text);
      }
    }
  }

  return chunks.join("");
}
