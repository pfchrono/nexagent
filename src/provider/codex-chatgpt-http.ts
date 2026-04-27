import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

import type { RuntimeSession } from "../runtime/session.js";

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
  const response = await io.fetchImpl(`${baseUrl}/responses`, {
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
    body: JSON.stringify({
      model: model ?? "gpt-5.4",
      ...(request.nativeInput !== undefined
        ? { input: request.nativeInput }
        : { input: [{ role: "user", content: request.prompt }] }),
      instructions: request.instructions ?? request.prompt,
      ...(request.previousResponseId ? { previous_response_id: request.previousResponseId } : {}),
      stream: true,
      store: false,
    }),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: `${response.status} ${response.statusText}\n${bodyText}`.trim(),
      output: "",
    };
  }

  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    output: extractResponseText(bodyText),
  };
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
    const payload = JSON.parse(bodyText) as Record<string, unknown>;
    if (typeof payload.output_text === "string") {
      return payload.output_text;
    }

    const output = Array.isArray(payload.output) ? payload.output : [];
    const chunks: string[] = [];
    for (const item of output) {
      if (!item || typeof item !== "object") continue;
      const content = Array.isArray((item as Record<string, unknown>).content)
        ? ((item as Record<string, unknown>).content as unknown[])
        : [];
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const text = (part as Record<string, unknown>).text;
        if (typeof text === "string") chunks.push(text);
      }
    }
    return chunks.join("");
  } catch {
    return bodyText;
  }
}

function extractStreamedResponseText(bodyText: string): string | null {
  if (!bodyText.includes("event:")) {
    return null;
  }

  const chunks: string[] = [];
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
      if (eventName === "response.output_text.delta") {
        const delta = payload.delta;
        if (typeof delta === "string") {
          chunks.push(delta);
        }
      } else if (eventName === "response.output_text.done" && chunks.length === 0) {
        const text = payload.text;
        if (typeof text === "string") {
          chunks.push(text);
        }
      }
    } catch {
      continue;
    }
  }

  return chunks.length > 0 ? chunks.join("") : "";
}
