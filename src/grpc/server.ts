import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildActiveSkillExecutionPrompt, createRuntimeInspectPayload, formatPromptEventDetail, runRuntimeCommand } from "../cli.js";
import { executeProviderRequest, type ProviderRequest, type ProviderResult } from "../provider.js";
import { recordConversationTurn, recordRuntimeEvent, recordTurnTelemetry, setRuntimeAction, type RuntimeSession } from "../runtime/session.js";

const PROTO_PACKAGE = "nexagent.v1";
const PROTO_SERVICE = "NexagentService";

export interface NexagentGrpcServerOptions {
  session: RuntimeSession;
  host?: string;
  port?: number;
  protoPath?: string;
  onStop?: () => void;
  providerExecutor?: (request: ProviderRequest) => Promise<ProviderResult>;
}

export interface NexagentGrpcServerHandle {
  address: string;
  port: number;
  server: grpc.Server;
  stop(): Promise<void>;
}

type GrpcCallback<T> = (error: grpc.ServiceError | null, response?: T) => void;

export async function startNexagentGrpcServer(options: NexagentGrpcServerOptions): Promise<NexagentGrpcServerHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const server = new grpc.Server();
  const service = loadNexagentGrpcService(options.protoPath);

  server.addService(service.service, createNexagentGrpcHandlers(options.session, options.providerExecutor ?? executeProviderRequest, () => {
    setImmediate(() => {
      void stopGrpcServer(server).finally(() => options.onStop?.());
    });
  }) as grpc.UntypedServiceImplementation);

  const boundPort = await new Promise<number>((resolve, reject) => {
    server.bindAsync(`${host}:${String(port)}`, grpc.ServerCredentials.createInsecure(), (error, actualPort) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(actualPort);
    });
  });

  return {
    address: `${host}:${String(boundPort)}`,
    port: boundPort,
    server,
    stop: () => stopGrpcServer(server),
  };
}

function createNexagentGrpcHandlers(
  session: RuntimeSession,
  providerExecutor: (request: ProviderRequest) => Promise<ProviderResult>,
  stop: () => void,
): Record<string, unknown> {
  let promptQueue = Promise.resolve();

  return {
    Health: (_call: grpc.ServerUnaryCall<Record<string, never>, unknown>, callback: GrpcCallback<Record<string, unknown>>) => {
      callback(null, {
        ok: true,
        product: session.product,
        sessionId: session.id,
        status: session.action.status,
        detail: session.action.detail,
      });
    },
    Inspect: (_call: grpc.ServerUnaryCall<Record<string, never>, unknown>, callback: GrpcCallback<Record<string, unknown>>) => {
      callback(null, {
        ok: true,
        sessionJson: JSON.stringify(createRuntimeInspectPayload(session)),
      });
    },
    RunCommand: (call: grpc.ServerUnaryCall<{ input?: string }, unknown>, callback: GrpcCallback<Record<string, unknown>>) => {
      const input = call.request.input?.trim() ?? "";
      if (!input) {
        callback(null, { ok: false, output: "", error: "input required", activity: "grpc command rejected" });
        return;
      }

      try {
        const result = runRuntimeCommand(session, input);
        if (!result) {
          callback(null, { ok: false, output: "", error: "input is not a runtime command", activity: "grpc command rejected" });
          return;
        }
        if (result.ok) {
          if (result.autoInvokeAfterSkill) {
            recordRuntimeEvent(session, {
              kind: "command",
              status: "completed",
              summary: `grpc command ${input.split(/\s+/)[0]} completed`,
              detail: result.output,
            });
            const prompt = result.invokePrompt ?? buildActiveSkillExecutionPrompt(session, input);
            const transcriptPrompt = result.transcriptPrompt ?? input;
            promptQueue = promptQueue
              .catch(() => undefined)
              .then(() => runQueuedPrompt(session, providerExecutor, prompt, callback, () => false, {
                prefixOutput: result.output,
                promptSummary: result.promptSummary,
                transcriptPrompt,
              }));
            void promptQueue;
            return;
          }

          recordRuntimeEvent(session, {
            kind: "command",
            status: "completed",
            summary: `grpc command ${input.split(/\s+/)[0]} completed`,
            detail: result.output,
          });
          callback(null, { ok: true, output: result.output, error: "", activity: result.activity });
          return;
        }

        recordRuntimeEvent(session, {
          kind: "command",
          status: "failed",
          summary: `grpc command ${input.split(/\s+/)[0]} failed`,
          detail: result.message,
        });
        callback(null, { ok: false, output: "", error: result.message, activity: result.activity });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordRuntimeEvent(session, {
          kind: "command",
          status: "failed",
          summary: `grpc command ${input.split(/\s+/)[0]} failed`,
          detail: message,
        });
        callback(null, { ok: false, output: "", error: message, activity: "grpc command failed" });
      }
    },
    RunPrompt: async (call: grpc.ServerUnaryCall<{ prompt?: string }, unknown>, callback: GrpcCallback<Record<string, unknown>>) => {
      const prompt = call.request.prompt?.trim() ?? "";
      if (!prompt) {
        callback(null, { ok: false, output: "", error: "prompt required", provider: session.provider, model: "", adapter: session.providerTransport.adapter });
        return;
      }

      let cancelled = false;
      call.on("cancelled", () => {
        cancelled = true;
        session.operationControls.activeAbortController?.abort();
      });
      promptQueue = promptQueue
        .catch(() => undefined)
        .then(() => cancelled ? undefined : runQueuedPrompt(session, providerExecutor, prompt, callback, () => cancelled));
      await promptQueue;
    },
    Stop: (_call: grpc.ServerUnaryCall<Record<string, never>, unknown>, callback: GrpcCallback<Record<string, unknown>>) => {
      callback(null, { ok: true, message: "stopping nexagent grpc server" });
      stop();
    },
  };
}

async function runQueuedPrompt(
  session: RuntimeSession,
  providerExecutor: (request: ProviderRequest) => Promise<ProviderResult>,
  prompt: string,
  callback: GrpcCallback<Record<string, unknown>>,
  isCancelled: () => boolean,
  options: {
    prefixOutput?: string;
    promptSummary?: string;
    transcriptPrompt?: string;
  } = {},
): Promise<void> {
  const transcriptPrompt = options.transcriptPrompt ?? prompt;
  recordRuntimeEvent(session, {
    kind: "prompt",
    status: "queued",
    summary: options.promptSummary ?? "grpc prompt accepted",
    detail: formatPromptEventDetail(transcriptPrompt),
  });
  setRuntimeAction(session, "running", "grpc provider request");
  try {
    const result = await providerExecutor({ session, prompt });
    if (isCancelled()) {
      return;
    }
    if (result.ok) {
      recordConversationTurn(session, "user", transcriptPrompt);
      recordConversationTurn(session, "assistant", result.output);
      recordTurnTelemetry(session, prompt, result.output);
      setRuntimeAction(session, "ready", "grpc prompt complete");
      callback(null, {
        ok: true,
        output: options.prefixOutput ? `${options.prefixOutput}\n${result.output}` : result.output,
        error: "",
        provider: result.provider,
        model: result.model ?? "",
        adapter: result.adapter,
        completionJson: JSON.stringify(result.completion ?? null),
      });
      return;
    }

    setRuntimeAction(session, "error", result.message);
    callback(null, {
      ok: false,
      output: "",
      error: `${result.message}\n${result.detail}`.trim(),
      provider: result.provider,
      model: result.model ?? "",
      adapter: result.adapter,
      completionJson: JSON.stringify(result.completion ?? null),
    });
  } catch (error) {
    if (isCancelled()) {
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    setRuntimeAction(session, "error", message);
    callback(null, { ok: false, output: "", error: message, provider: session.provider, model: "", adapter: session.providerTransport.adapter });
  }
}

function loadNexagentGrpcService(protoPath?: string): grpc.ServiceClientConstructor {
  const packageDefinition = protoLoader.loadSync(protoPath ?? resolveDefaultProtoPath(), {
    keepCase: false,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const loaded = grpc.loadPackageDefinition(packageDefinition) as Record<string, unknown>;
  const packageRoot = PROTO_PACKAGE.split(".").reduce<unknown>((current, key) =>
    current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined,
  loaded);
  const service = packageRoot && typeof packageRoot === "object" ? (packageRoot as Record<string, unknown>)[PROTO_SERVICE] : undefined;
  if (!service || typeof service !== "function" || !("service" in service)) {
    throw new Error(`failed to load ${PROTO_PACKAGE}.${PROTO_SERVICE} from proto`);
  }
  return service as grpc.ServiceClientConstructor;
}

function resolveDefaultProtoPath(): string {
  const cwdProto = path.join(process.cwd(), "proto", "nexagent.proto");
  const sourceProto = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "proto", "nexagent.proto");
  return existsSync(cwdProto) ? cwdProto : sourceProto;
}

function stopGrpcServer(server: grpc.Server): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve();
    };
    const forceTimer = setTimeout(() => {
      server.forceShutdown();
      finish();
    }, 1_000);
    forceTimer.unref?.();
    server.tryShutdown((error) => {
      clearTimeout(forceTimer);
      if (error) {
        server.forceShutdown();
      }
      finish();
    });
  });
}
