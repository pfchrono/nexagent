import type { InternalToolResult } from "../runtime/tools.js";

export interface RuntimeCommandSuccess {
  ok: true;
  output: string;
  activity: string;
  autoInvokeAfterSkill?: boolean;
  invokePrompt?: string;
  transcriptPrompt?: string;
  promptSummary?: string;
}

export interface RuntimeCommandFailure {
  ok: false;
  message: string;
  activity: string;
}

export type RuntimeCommandResult = RuntimeCommandSuccess | RuntimeCommandFailure;

export function toolResultToCommandResult(command: string, detail: string, result: InternalToolResult): RuntimeCommandResult {
  if (result.ok) {
    return {
      ok: true,
      output: result.output,
      activity: `${command} · ${detail}`,
    };
  }

  if (result.output.startsWith("tool policy blocked ")) {
    const blockedPath = result.output.replace(/^tool policy blocked\s+/, "").split(";")[0] ?? detail;
    return {
      ok: false,
      message: result.output,
      activity: `command blocked · ${blockedPath}`,
    };
  }

  if (result.output.startsWith("shell policy blocked command")) {
    return {
      ok: false,
      message: result.output,
      activity: "command blocked · shell policy",
    };
  }

  return {
    ok: false,
    message: result.output,
    activity: `command failed · /${command} ${detail}`,
  };
}
