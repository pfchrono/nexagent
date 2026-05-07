import type { InternalToolCall } from "../runtime/tools.js";

const JSON_BODY_TOOL_CALL_PATTERN = /<(?:nexagent_)?tool_call>([\s\S]+?)<\/(?:nexagent_)?tool_call>/i;
const MODEL_INTENT_PATTERN = /<nexagent_intent>([\s\S]*?)<\/nexagent_intent>/i;
const MODEL_INTENT_STRIP_PATTERN = /<nexagent_intent>[\s\S]*?<\/nexagent_intent>\s*/gi;
const UNCLOSED_MODEL_INTENT_LINE_PATTERN = /^\s*<nexagent_intent>[^\n\r]*(?:\r?\n|$)/i;
const INTERNAL_TOOL_TAG_NAMES = [
  "read_file",
  "write_file",
  "apply_patch",
  "batch_edit",
  "preview_patch",
  "list_dir",
  "search_content",
  "search_files",
  "web_fetch",
  "web_search",
  "git_status",
  "git_diff",
  "shell_command",
  "nexsight_execute",
  "nexsight_read",
  "nexsight_gather",
  "nexsight_index",
  "nexsight_batch",
  "nexsight_search",
  "archivist_save",
  "archivist_checkpoint",
  "ask_user_question",
] as const satisfies readonly InternalToolCall["name"][];
const INTERNAL_TOOL_TAG_PATTERN = INTERNAL_TOOL_TAG_NAMES.join("|");
const TOOL_CALL_MARKUP_PATTERN = new RegExp(`<\\s*\\/?\\s*(?:(?:nexagent_)?tool_call|${INTERNAL_TOOL_TAG_PATTERN})\\b`, "i");

export function parseInternalToolCall(output: string): InternalToolCall | null {
  const match = output.match(JSON_BODY_TOOL_CALL_PATTERN);
  if (match) {
    const parsed = parseToolCallJson(match[1] ?? "");
    if (parsed && typeof parsed.name === "string") {
      return parsed;
    }
  }

  return parseAttributeStyleToolCall(output) ?? parseBareInternalToolTag(output);
}

export function extractModelIntent(output: string): string | null {
  const match = output.match(MODEL_INTENT_PATTERN);
  const intent = match?.[1]?.replace(/\s+/g, " ").trim();
  if (!intent) {
    return null;
  }
  return intent.length > 140 ? `${intent.slice(0, 137)}...` : intent;
}

export function stripModelIntent(output: string): string {
  return output
    .replace(MODEL_INTENT_STRIP_PATTERN, "")
    .replace(UNCLOSED_MODEL_INTENT_LINE_PATTERN, "")
    .trimStart();
}

function parseToolCallJson(value: string): InternalToolCall | null {
  const trimmed = value.trim();
  for (const candidate of [trimmed, escapeControlCharsInJsonStrings(trimmed)]) {
    try {
      const parsed = JSON.parse(candidate) as InternalToolCall;
      if (!parsed || typeof parsed !== "object") {
        return null;
      }
      return parsed;
    } catch {
      // Try repaired candidate next.
    }
  }
  return null;
}

function escapeControlCharsInJsonStrings(value: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
      output += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      output += char;
      escaped = true;
      continue;
    }
    if (char === '"') {
      output += char;
      inString = !inString;
      continue;
    }
    if (inString && char === "\n") {
      output += "\\n";
      continue;
    }
    if (inString && char === "\r") {
      output += "\\r";
      continue;
    }
    if (inString && char === "\t") {
      output += "\\t";
      continue;
    }
    output += char;
  }

  return output;
}

export function containsToolCallMarkup(output: string): boolean {
  return TOOL_CALL_MARKUP_PATTERN.test(output);
}

export function classifyToolCallMarkup(output: string): Record<string, string | number | boolean> {
  const toolCallMatches = output.match(/<\s*(?:nexagent_)?tool_call\b/gi) ?? [];
  const firstBlock = output.match(/<\s*(nexagent_)?tool_call\b([^>]*)>([\s\S]*?)<\/\s*(?:nexagent_)?tool_call\s*>/i);
  const attributes = firstBlock?.[2] ?? "";
  const body = firstBlock?.[3]?.trim() ?? "";
  const generic = firstBlock ? !firstBlock[1] : /<\s*tool_call\b/i.test(output);
  const hasNameAttribute = Boolean(readXmlAttribute(attributes, "name"));
  const hasArgumentsAttribute = Boolean(readXmlAttribute(attributes, "arguments"));
  const bodyLooksJson = body.startsWith("{") || body.startsWith("[");
  const bodyHasName = /"name"\s*:/.test(body);
  const hasArgumentChildren = /<\s*arg\b/i.test(body);
  const parsedJson = bodyLooksJson ? parseToolCallJson(body) : null;
  const parseFailure = parsedJson && typeof parsedJson.name === "string"
    ? "none"
    : bodyLooksJson
      ? bodyHasName ? "json_body_invalid" : "json_body_missing_name"
      : hasNameAttribute
        ? "attribute_body_invalid"
        : "missing_tool_name";

  return {
    markup_family: generic ? "generic_tool_call" : "nexagent_tool_call",
    block_count: toolCallMatches.length,
    adjacent_blocks: toolCallMatches.length > 1,
    has_name_attribute: hasNameAttribute,
    has_arguments_attribute: hasArgumentsAttribute,
    has_argument_children: hasArgumentChildren,
    body_kind: bodyLooksJson ? "json" : body.length > 0 ? "text" : "empty",
    body_has_name: bodyHasName,
    parse_failure: parseFailure,
  };
}

function parseAttributeStyleToolCall(output: string): InternalToolCall | null {
  const match = output.match(/<(?:nexagent_)?tool_call\b([^>]*)>([\s\S]*?)<\/(?:nexagent_)?tool_call>/i);
  if (!match) {
    return null;
  }

  const attributes = match[1] ?? "";
  const body = match[2] ?? "";
  const name = readXmlAttribute(attributes, "name");
  if (!name) {
    return null;
  }

  const childArguments = parseArgumentChildren(body);
  const rawArguments = readXmlAttribute(attributes, "arguments") ?? extractJsonAfterToken(output, "arguments");
  const parsedArguments = rawArguments ? parseToolArguments(rawArguments) : childArguments ?? {};
  if (!parsedArguments) {
    return null;
  }

  return {
    name: name as InternalToolCall["name"],
    arguments: parsedArguments,
  };
}

function parseBareInternalToolTag(output: string): InternalToolCall | null {
  const paired = output.match(new RegExp(`<(${INTERNAL_TOOL_TAG_PATTERN})\\b([^>]*)>([\\s\\S]*?)<\\/\\1>`, "i"));
  const selfClosing = output.match(new RegExp(`<(${INTERNAL_TOOL_TAG_PATTERN})\\b([^>]*)\\/>`, "i"));
  const match = paired ?? selfClosing;
  if (!match) {
    return null;
  }
  const name = match[1] as InternalToolCall["name"] | undefined;
  if (!name) {
    return null;
  }
  const attributes = parseXmlAttributes(match[2] ?? "");
  const body = (match[3] ?? "").trim();
  if (body.length > 0 && attributes.content === undefined && attributes.code === undefined) {
    attributes.content = decodeXmlAttribute(body);
  }
  return {
    name,
    arguments: attributes,
  };
}

function parseArgumentChildren(body: string): Record<string, unknown> | null {
  const args: Record<string, unknown> = {};
  const pattern = /<(?:argument|arg)\b([^>]*)>([\s\S]*?)<\/(?:argument|arg)>/gi;
  let matched = false;
  for (const match of body.matchAll(pattern)) {
    const name = readXmlAttribute(match[1] ?? "", "name");
    if (!name) {
      continue;
    }
    matched = true;
    args[name] = decodeXmlAttribute((match[2] ?? "").trim());
  }
  return matched ? args : null;
}

function parseXmlAttributes(attributes: string): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  const pattern = /\b([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of attributes.matchAll(pattern)) {
    const key = match[1];
    if (!key || key === "name") {
      continue;
    }
    parsed[key] = decodeXmlAttribute(match[2] ?? match[3] ?? "");
  }
  return parsed;
}

function readXmlAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  const value = match?.[1] ?? match?.[2] ?? null;
  return value ? decodeXmlAttribute(value) : null;
}

function decodeXmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractJsonAfterToken(value: string, token: string): string | null {
  const tokenIndex = value.toLowerCase().indexOf(token.toLowerCase());
  if (tokenIndex < 0) {
    return null;
  }
  const objectStart = value.indexOf("{", tokenIndex);
  if (objectStart < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = objectStart; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(objectStart, index + 1);
      }
    }
  }
  return null;
}

export function parseNativeToolCall(payload: unknown): { responseId: string | undefined; callId: string; name: InternalToolCall["name"]; arguments: Record<string, unknown> } | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const responseId = typeof record.id === "string" ? record.id : undefined;
  const output = Array.isArray(record.output) ? record.output : [];

  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as Record<string, unknown>;
    if (candidate.type !== "function_call" || typeof candidate.name !== "string" || typeof candidate.call_id !== "string") {
      continue;
    }

    const parsedArguments = parseToolArguments(candidate.arguments);
    if (!parsedArguments) {
      return null;
    }

    return {
      responseId,
      callId: candidate.call_id,
      name: candidate.name as InternalToolCall["name"],
      arguments: parsedArguments,
    };
  }

  return null;
}

function parseToolArguments(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return null;
  }
}
