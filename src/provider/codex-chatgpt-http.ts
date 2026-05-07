import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import { getCodexModelDefinition, normalizeCodexModel, type CodexReasoningEffort } from "../models.js";
import type { RuntimeSession } from "../runtime/session.js";
import { fetchWithProviderExecutionPolicy, resolveProviderExecutionPolicy } from "./execution-policy.js";

export interface CodexChatGptHttpInvocation {
  exitCode: number;
  stdout: string;
  stderr: string;
  output: string;
}

export interface CodexChatGptHttpAdapter {
  id: "codex-chatgpt-http";
  transport: "codex";
  mode: "codex-http";
  authSource: "codex-auth-json";
  command: "fetch";
  supportsProviders: readonly ["codex", "openai"];
}

interface CodexAuthJson {
  auth_mode?: string;
  last_refresh?: string;
  OPENAI_API_KEY?: string;
  agent_identity?: unknown;
  tokens?: {
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
}

const DEFAULT_CODEX_BACKEND_BASE_URL = "https://chatgpt.com/backend-api/codex";
const AUTH_JSON_PATH = path.join(process.env.HOME ?? os.homedir(), ".codex", "auth.json");
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_JWT_AUTH_CLAIM = "https://api.openai.com/auth";
const CODEX_TOKEN_REFRESH_SKEW_MS = 60_000;

export const CODEX_CHATGPT_HTTP_ADAPTER: CodexChatGptHttpAdapter = {
  id: "codex-chatgpt-http",
  transport: "codex",
  mode: "codex-http",
  authSource: "codex-auth-json",
  command: "fetch",
  supportsProviders: ["codex", "openai"],
};

export async function invokeCodexChatGptHttpTransport(
  request: {
    session: RuntimeSession;
    prompt: string;
    instructions?: string;
    nativeInput?: unknown;
    previousResponseId?: string;
    abortSignal?: AbortSignal;
  },
  model: string | null,
  io: CodexAuthIo = createDefaultCodexAuthIo(),
): Promise<CodexChatGptHttpInvocation> {
  const auth = await resolveCodexAuthJson(io);
  if (!auth.accessToken || !auth.accountId) {
    throw new Error("codex auth.json missing access token or account id for codex-http transport");
  }

  const baseUrl = (request.session.providerTransport.openaiBaseUrl ?? DEFAULT_CODEX_BACKEND_BASE_URL).replace(/\/+$/, "");
  const resolvedModel = normalizeCodexModel(model) ?? "gpt-5.4";
  const reasoningEffort = resolveCodexChatGptReasoningEffort(request.session, resolvedModel);
  const requestBody = createCodexChatGptRequestBody(request, resolvedModel, reasoningEffort);
  const response = await fetchWithProviderExecutionPolicy(
    `${baseUrl}/responses`,
    {
      method: "POST",
      signal: request.abortSignal,
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${auth.accessToken}`,
        "chatgpt-account-id": auth.accountId,
        originator: "pi",
        "OpenAI-Beta": "responses=experimental",
      },
      body: JSON.stringify(requestBody),
    },
    resolveProviderExecutionPolicy(request.session),
    io.fetchImpl,
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

  const output = extractResponseText(bodyText);
  if (output.trim().length > 0 || request.abortSignal?.aborted) {
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      output,
    };
  }

  const retryOutput = await retryCodexChatGptEmptyText({
    baseUrl,
    auth: {
      accessToken: auth.accessToken,
      accountId: auth.accountId,
    },
    request,
    requestBody,
    io,
  });
  if (retryOutput.trim().length > 0) {
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      output: retryOutput,
    };
  }

  return {
    exitCode: 1,
    stdout: "",
    stderr: `codex-http returned empty assistant text\n${summarizeCodexChatGptResponseShape(bodyText)}`.trim(),
    output: "",
  };
}

function resolveCodexChatGptReasoningEffort(session: RuntimeSession, model: string): CodexReasoningEffort {
  const configured = session.providerRouting.modelSelection.configuredReasoningEfforts?.[session.providerTransport.activeProvider];
  const defaultEffort = getCodexModelDefinition(model)?.defaultReasoningEffort ?? "medium";
  if (model === "gpt-5.3-codex-spark" && (configured === "low" || configured === "medium")) {
    return "high";
  }
  return (configured as CodexReasoningEffort | undefined) ?? defaultEffort;
}

function createCodexChatGptRequestBody(
  request: {
    session: RuntimeSession;
    prompt: string;
    instructions?: string;
    nativeInput?: unknown;
    previousResponseId?: string;
  },
  resolvedModel: string,
  reasoningEffort: CodexReasoningEffort,
): Record<string, unknown> {
  return {
    model: resolvedModel,
    reasoning: { effort: reasoningEffort },
    ...(request.nativeInput !== undefined
      ? { input: request.nativeInput }
      : { input: [{ role: "user", content: request.prompt }] }),
    instructions: request.instructions ?? request.prompt,
    tools: [],
    tool_choice: "auto",
    parallel_tool_calls: false,
    include: ["reasoning.encrypted_content"],
    prompt_cache_key: request.session.id,
    client_metadata: {
      "x-codex-installation-id": request.session.id,
    },
    ...(request.previousResponseId ? { previous_response_id: request.previousResponseId } : {}),
    stream: true,
    store: false,
  };
}

async function retryCodexChatGptEmptyText(options: {
  baseUrl: string;
  auth: { accessToken: string; accountId: string };
  request: {
    session: RuntimeSession;
    abortSignal?: AbortSignal;
  };
  requestBody: Record<string, unknown>;
  io: CodexAuthIo;
}): Promise<string> {
  if (options.request.abortSignal?.aborted) {
    return "";
  }

  const response = await fetchWithProviderExecutionPolicy(
    `${options.baseUrl}/responses`,
    {
      method: "POST",
      signal: options.request.abortSignal,
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${options.auth.accessToken}`,
        "chatgpt-account-id": options.auth.accountId,
        originator: "pi",
        "OpenAI-Beta": "responses=experimental",
      },
      body: JSON.stringify({
        ...options.requestBody,
        instructions: `${String(options.requestBody.instructions ?? "")}\n\nReturn a non-empty assistant message. If blocked, answer with a concise blocker sentence.`,
        previous_response_id: undefined,
      }),
    },
    resolveProviderExecutionPolicy(options.request.session),
    options.io.fetchImpl,
  );
  if (!response.ok) {
    return "";
  }
  return extractResponseText(await response.text());
}

export async function hasCodexAuthJsonCredentials(): Promise<boolean> {
  const auth = await readCodexAuthJson(createDefaultCodexAuthIo());
  return auth.raw ? hasUsableCodexAuth(auth.raw) : false;
}

export function hasCodexAuthJsonCredentialsSync(): boolean {
  try {
    const raw = readFileSync(AUTH_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw) as CodexAuthJson;
    return hasUsableCodexAuth(parsed);
  } catch {
    return false;
  }
}

export interface CodexAuthIo {
  authJsonPath: string;
  readText(path: string): Promise<string>;
  writeText(path: string, value: string): Promise<void>;
  fetchImpl(input: string, init: RequestInit): Promise<Response>;
  now(): number;
}

interface ResolvedCodexAuth {
  accessToken: string | null;
  refreshToken: string | null;
  accountId: string | null;
  raw: CodexAuthJson | null;
}

function createDefaultCodexAuthIo(): CodexAuthIo {
  return {
    authJsonPath: AUTH_JSON_PATH,
    readText: (target) => readFile(target, "utf8"),
    writeText: (target, value) => writeFile(target, value, "utf8"),
    fetchImpl: (input, init) => fetch(input, init),
    now: () => Date.now(),
  };
}

async function readCodexAuthJson(io: CodexAuthIo): Promise<ResolvedCodexAuth> {
  try {
    const raw = await io.readText(io.authJsonPath);
    const parsed = JSON.parse(raw) as CodexAuthJson;
    return {
      raw: parsed,
      accessToken: parsed.tokens?.access_token?.trim() || null,
      refreshToken: parsed.tokens?.refresh_token?.trim() || null,
      accountId: parsed.tokens?.account_id?.trim() || null,
    };
  } catch {
    return {
      raw: null,
      accessToken: null,
      refreshToken: null,
      accountId: null,
    };
  }
}

export async function resolveCodexAuthJson(io: CodexAuthIo): Promise<ResolvedCodexAuth> {
  const auth = await readCodexAuthJson(io);
  if (auth.accessToken && auth.accountId && !isJwtExpired(auth.accessToken, io.now())) {
    return auth;
  }

  if (!auth.refreshToken) {
    return auth;
  }

  const refreshed = await refreshCodexAuthJson(auth, io);
  return refreshed ?? auth;
}

async function refreshCodexAuthJson(auth: ResolvedCodexAuth, io: CodexAuthIo): Promise<ResolvedCodexAuth | null> {
  const response = await io.fetchImpl(CODEX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: auth.refreshToken ?? "",
      client_id: CODEX_CLIENT_ID,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`codex token refresh failed: ${response.status} ${response.statusText}`.trim());
  }

  const payload = await response.json() as {
    access_token?: string;
    refresh_token?: string;
  };
  const accessToken = payload.access_token?.trim() || null;
  const refreshToken = payload.refresh_token?.trim() || auth.refreshToken;
  const accountId = accessToken ? extractCodexAccountId(accessToken) : null;
  if (!accessToken || !refreshToken || !accountId) {
    throw new Error("codex token refresh returned incomplete credentials");
  }

  const nextRaw: CodexAuthJson = {
    ...(auth.raw ?? {}),
    auth_mode: auth.raw?.auth_mode ?? "chatgpt",
    last_refresh: new Date(io.now()).toISOString(),
    tokens: {
      ...(auth.raw?.tokens ?? {}),
      access_token: accessToken,
      refresh_token: refreshToken,
      account_id: accountId,
    },
  };
  await io.writeText(io.authJsonPath, `${JSON.stringify(nextRaw, null, 2)}\n`);

  return {
    raw: nextRaw,
    accessToken,
    refreshToken,
    accountId,
  };
}

function hasUsableCodexAuth(auth: CodexAuthJson): boolean {
  const accessToken = auth.tokens?.access_token?.trim();
  const refreshToken = auth.tokens?.refresh_token?.trim();
  const accountId = auth.tokens?.account_id?.trim();
  if (!accountId) {
    return false;
  }
  if (accessToken && !isJwtExpired(accessToken, Date.now())) {
    return true;
  }
  return Boolean(refreshToken);
}

function isJwtExpired(token: string, now: number): boolean {
  const expMs = decodeJwtExpMs(token);
  if (!expMs) {
    return false;
  }
  return expMs <= now + CODEX_TOKEN_REFRESH_SKEW_MS;
}

function decodeJwtExpMs(token: string): number | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) {
      return null;
    }
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof parsed.exp === "number" ? parsed.exp * 1000 : null;
  } catch {
    return null;
  }
}

function extractCodexAccountId(token: string): string | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) {
      return null;
    }
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const authClaim = parsed[CODEX_JWT_AUTH_CLAIM];
    if (!authClaim || typeof authClaim !== "object") {
      return null;
    }
    const accountId = (authClaim as Record<string, unknown>).chatgpt_account_id;
    return typeof accountId === "string" && accountId.length > 0 ? accountId : null;
  } catch {
    return null;
  }
}

function extractResponseText(bodyText: string): string {
  const streamed = extractStreamedResponseText(bodyText);
  if (streamed !== null) {
    return streamed;
  }

  try {
    return extractResponsePayloadText(JSON.parse(bodyText) as Record<string, unknown>);
  } catch {
    return bodyText;
  }
}

function summarizeCodexChatGptResponseShape(bodyText: string): string {
  if (!bodyText.includes("event:")) {
    return `body=${bodyText.trim().slice(0, 240) || "empty"}`;
  }

  const rows: string[] = [];
  for (const block of bodyText.split(/\n\n+/)) {
    const eventName = block.match(/^event:\s*([^\n]+)$/m)?.[1]?.trim();
    const dataLine = block.match(/^data:\s*(.+)$/m)?.[1];
    if (!eventName || !dataLine) {
      continue;
    }
    try {
      const payload = JSON.parse(dataLine) as Record<string, unknown>;
      const effectiveEventName = typeof payload.type === "string" ? payload.type : eventName;
      const details = summarizeCodexChatGptPayload(payload);
      rows.push(details ? `${effectiveEventName} ${details}` : effectiveEventName);
    } catch {
      rows.push(eventName);
    }
  }

  return rows.length > 0 ? `events=${rows.slice(0, 16).join(" | ")}` : "events=none";
}

function summarizeCodexChatGptPayload(payload: Record<string, unknown>): string {
  const response = isRecord(payload.response) ? payload.response : null;
  const item = isRecord(payload.item) ? payload.item : null;
  const part = isRecord(payload.part) ? payload.part : null;
  const bits = [
    response && typeof response.status === "string" ? `status:${response.status}` : null,
    item && typeof item.type === "string" ? `item:${item.type}` : null,
    part && typeof part.type === "string" ? `part:${part.type}` : null,
    typeof payload.delta === "string" ? `delta:${String(payload.delta.length)}` : null,
    typeof payload.text === "string" ? `text:${String(payload.text.length)}` : null,
  ].filter((bit): bit is string => Boolean(bit));
  return bits.length > 0 ? `[${bits.join(",")}]` : "";
}

function extractStreamedResponseText(bodyText: string): string | null {
  if (!bodyText.includes("event:")) {
    return null;
  }

  const chunks: string[] = [];
  let finalText = "";
  for (const block of bodyText.split(/\n\n+/)) {
    const eventMatch = block.match(/^event:\s*([^\n]+)$/m);
    if (!eventMatch) {
      continue;
    }

    const eventName = eventMatch[1]?.trim();
    const dataLine = block.match(/^data:\s*(.+)$/m)?.[1];
    if (!dataLine) {
      continue;
    }

    try {
      const payload = JSON.parse(dataLine) as Record<string, unknown>;
      const effectiveEventName = typeof payload.type === "string" ? payload.type : eventName;
      if (effectiveEventName === "response.output_text.delta") {
        const delta = payload.delta;
        if (typeof delta === "string") {
          chunks.push(delta);
        }
      } else if (effectiveEventName === "response.output_text.done" && chunks.length === 0) {
        const text = payload.text;
        if (typeof text === "string") {
          chunks.push(text);
        }
      } else if (
        effectiveEventName === "response.output_item.done"
        || effectiveEventName === "response.content_part.done"
        || effectiveEventName === "response.completed"
        || effectiveEventName === "response.done"
      ) {
        const text = extractResponsePayloadText(payload);
        if (text) {
          finalText = text;
        }
      }
    } catch {
      continue;
    }
  }

  return chunks.length > 0 ? chunks.join("") : finalText;
}

function extractResponsePayloadText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const directItem = isRecord(payload.item) ? extractResponseItemText(payload.item) : "";
  if (directItem) {
    return directItem;
  }

  const directPart = isRecord(payload.part) ? extractResponseContentPartText(payload.part) : "";
  if (directPart) {
    return directPart;
  }

  const response = isRecord(payload.response) ? payload.response : payload;
  const output = Array.isArray(response.output) ? response.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) {
      continue;
    }
    const text = extractResponseItemText(item);
    if (text) {
      chunks.push(text);
    }
  }
  return chunks.join("");
}

function extractResponseItemText(item: Record<string, unknown>): string {
  if (typeof item.text === "string") {
    return item.text;
  }
  if (typeof item.content === "string") {
    return item.content;
  }

  const content = Array.isArray(item.content) ? item.content : [];
  const chunks: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) {
      continue;
    }
    const text = extractResponseContentPartText(part);
    if (text) {
      chunks.push(text);
    }
  }
  return chunks.join("");
}

function extractResponseContentPartText(part: Record<string, unknown>): string {
  if (typeof part.text === "string") {
    return part.text;
  }
  if (typeof part.output_text === "string") {
    return part.output_text;
  }
  if (typeof part.content === "string") {
    return part.content;
  }
  return "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
