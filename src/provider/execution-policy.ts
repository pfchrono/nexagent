import type { RuntimeSession } from "../runtime/session.js";

export interface ProviderExecutionPolicy {
  requestTimeoutMs: number | null;
  maxRetries: number;
}

export function resolveProviderExecutionPolicy(session: RuntimeSession): ProviderExecutionPolicy {
  return {
    requestTimeoutMs: normalizePositiveInteger(session.providerTransport.requestTimeoutMs),
    maxRetries: normalizeNonNegativeInteger(session.providerTransport.maxRetries),
  };
}

export async function fetchWithProviderExecutionPolicy(
  input: string,
  init: RequestInit,
  policy: ProviderExecutionPolicy,
  fetchImpl: (input: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<Response> {
  let attempt = 0;
  for (;;) {
    try {
      const response = await fetchImpl(input, withTimeoutSignal(init, policy.requestTimeoutMs));
      if (!shouldRetryResponse(response) || attempt >= policy.maxRetries || isAbortSignalAborted(init.signal)) {
        return response;
      }
    } catch (error) {
      if (attempt >= policy.maxRetries || isAbortSignalAborted(init.signal)) {
        throw error;
      }
    }
    attempt += 1;
  }
}

function withTimeoutSignal(init: RequestInit, timeoutMs: number | null): RequestInit {
  if (!timeoutMs) {
    return init;
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  return { ...init, signal };
}

function shouldRetryResponse(response: Response): boolean {
  return response.status === 429 || response.status >= 500;
}

function isAbortSignalAborted(signal: RequestInit["signal"]): boolean {
  return Boolean(signal?.aborted);
}

function normalizePositiveInteger(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function normalizeNonNegativeInteger(value: number | null | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}
