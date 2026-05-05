import { execFileSync, spawn, spawnSync } from "node:child_process";
import { lookup } from "node:dns/promises";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import path from "node:path";

import { checkpointArchivistSession, saveArchivistMemory } from "./archivist.js";
import { buildPatchPreview, searchFilesWithIgnore } from "./core-helpers.js";
import { formatLspStatus, summarizeLspDiagnostics, summarizeLspNavigation, summarizeLspSymbols, touchLspFileSync } from "./lsp.js";
import { callMcpTool, listMcpTools } from "./mcp.js";
import { batchIndexNexsight, executeNexsight, executeNexsightAsync, gatherNexsight, indexNexsight, indexNexsightFile, readNexsight, searchNexsight } from "./nexsight.js";
import {
  analyzeBlockedShellCommand,
  analyzeSafeGitCommand,
  findBlockedShellPattern,
  validateReadToolPath as validateReadPathPolicy,
  validateRepoToolPath as validateRepoPathPolicy,
  validateWriteToolPath as validateWritePathPolicy,
} from "./policy.js";
import {
  ASK_USER_TOOL_NAME,
  MAX_QUESTIONNAIRE_HEADER_LENGTH,
  MAX_QUESTIONNAIRE_LABEL_LENGTH,
  MAX_QUESTIONNAIRE_OPTIONS,
  MAX_QUESTIONNAIRE_QUESTIONS,
  MIN_QUESTIONNAIRE_OPTIONS,
  createQuestionnaireRequest,
  formatQuestionnaireResponseText,
  parseQuestionnaireQuestions,
  validateQuestionnaire,
} from "./questionnaire.js";
import { savePersistedRuntimeState } from "./persistence.js";
import type { RuntimeSession } from "./session.js";
import { executeTodoTool } from "./todos.js";
import { executeAgentTool, executeGetSubagentResultTool, executeSteerSubagentTool } from "./subagents.js";
import { executeGetGoalTool, executeUpdateGoalTool } from "./goal.js";

export type InternalToolName =
  | "read_file"
  | "write_file"
  | "apply_patch"
  | "batch_edit"
  | "preview_patch"
  | "list_dir"
  | "search_content"
  | "search_files"
  | "web_fetch"
  | "web_search"
  | "git_status"
  | "git_diff"
  | "shell_command"
  | "nexsight_execute"
  | "nexsight_read"
  | "nexsight_gather"
  | "nexsight_index"
  | "nexsight_batch"
  | "nexsight_search"
  | "archivist_save"
  | "archivist_checkpoint"
  | "mcp_list_tools"
  | "mcp_call"
  | "ask_user_question"
  | "todo"
  | "get_goal"
  | "update_goal"
  | "Agent"
  | "get_subagent_result"
  | "steer_subagent"
  | "lsp_status"
  | "lsp_symbols"
  | "lsp_diagnostics"
  | "lsp_navigation";

export interface InternalToolCall {
  name: InternalToolName;
  arguments?: Record<string, unknown>;
}

export interface InternalToolDefinition {
  name: InternalToolName;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface InternalToolResult {
  ok: boolean;
  tool: InternalToolName;
  output: string;
}

const DEFAULT_SHELL_TIMEOUT_MS = 30_000;
const MAX_SHELL_TIMEOUT_MS = 30_000;
const MIN_SHELL_TIMEOUT_MS = 500;
const SHELL_MAX_LINES = 120;
const SHELL_MAX_CHARS = 12_000;
const DIFF_MAX_LINES = 400;
const DIFF_MAX_CHARS = 20_000;
const WEB_TIMEOUT_MS = 8_000;
const WEB_MAX_CHARS = 12_000;
const READ_FILE_COMPACT_LINE_LIMIT = 160;
const READ_FILE_COMPACT_CHAR_LIMIT = 24_000;
const readGuardState = new WeakMap<RuntimeSession, Map<string, { mtimeMs: number; size: number }>>();
export function getInternalToolDefinitions(): readonly InternalToolDefinition[] {
  return [
    {
      name: "read_file",
      description: "Read UTF-8 text file from workspace/reference paths unless protected by safety policy.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to current working directory." },
          startLine: { type: "number", description: "Optional 1-based first line to render." },
          start_line: { type: "number", description: "Legacy alias for startLine." },
          endLine: { type: "number", description: "Optional 1-based last line to render." },
          end_line: { type: "number", description: "Legacy alias for endLine." },
          maxLines: { type: "number", description: "Optional maximum lines to render in compact mode." },
          limit: { type: "number", description: "Legacy alias for maxLines." },
          compact: { type: "boolean", description: "Render a bounded numbered preview instead of raw full content." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "write_file",
      description: "Write UTF-8 text file inside repo-local write roots.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to current working directory." },
          content: { type: "string", description: "Full UTF-8 file contents to write." },
        },
        required: ["path", "content"],
        additionalProperties: false,
      },
    },
    {
      name: "apply_patch",
      description: "Apply exact text replacement inside existing UTF-8 file inside repo-local write roots.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to current working directory." },
          find: { type: "string", description: "Exact text to replace." },
          replace: { type: "string", description: "Replacement text." },
          replaceAll: { type: "boolean", description: "Replace every exact match when true." },
        },
        required: ["path", "find", "replace"],
        additionalProperties: false,
      },
    },
    {
      name: "batch_edit",
      description: "Apply multiple guarded file edits in one atomic batch. Supports write, replace, insert_before, insert_after, prepend, and append; validates every path and anchor before writing anything.",
      inputSchema: {
        type: "object",
        properties: {
          edits: {
            type: "array",
            description: "Edit operations. Each item needs type and path. replace uses find/replace. insert_before/insert_after uses anchor/content. write uses content.",
            items: { type: "object" },
          },
          operations: {
            type: "array",
            description: "Legacy alias for edits.",
            items: { type: "object" },
          },
          changes: {
            type: "array",
            description: "Legacy alias for edits.",
            items: { type: "object" },
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "preview_patch",
      description: "Preview exact text replacement as unified diff without writing file.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path relative to current working directory." },
          find: { type: "string", description: "Exact text to replace." },
          replace: { type: "string", description: "Replacement text." },
          replaceAll: { type: "boolean", description: "Replace every exact match when true." },
        },
        required: ["path", "find", "replace"],
        additionalProperties: false,
      },
    },
    {
      name: "list_dir",
      description: "List directory contents from workspace/reference paths unless protected by safety policy.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional directory path relative to current working directory." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "search_content",
      description: "Search file contents with ripgrep when available.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Text or regex pattern to search for." },
          query: { type: "string", description: "Legacy alias for pattern." },
          path: { type: "string", description: "Optional root path relative to current working directory." },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "search_files",
      description: "Search file paths by glob-style pattern with ripgrep when available.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Glob-style file pattern like *.ts or src/*.md." },
          query: { type: "string", description: "Legacy alias for pattern." },
          path: { type: "string", description: "Optional root path relative to current working directory." },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "web_fetch",
      description: "Fetch a public HTTP(S) page and return capped text content for research.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Public http(s) URL to fetch." },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
    {
      name: "web_search",
      description: "Search the public web and return capped result titles, URLs, and snippets.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          limit: { type: "number", description: "Maximum result count, capped at 8." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "git_status",
      description: "Show repo branch and freshness status for current working tree.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Legacy ignored path alias." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "git_diff",
      description: "Show bounded git diff for current repo or one repo-local path.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Optional repo-local path to diff." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "shell_command",
      description: "Run guarded shell command inside repo cwd with protected OS root mutations blocked and capped output.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run from current working directory." },
          cwd: { type: "string", description: "Optional working directory under allowed roots." },
          workdir: { type: "string", description: "Legacy alias for cwd." },
          timeoutMs: { type: "number", description: "Optional timeout in milliseconds, capped at 30000ms." },
          timeout: { type: "number", description: "Legacy alias for timeoutMs." },
          timeout_ms: { type: "number", description: "Legacy alias for timeoutMs." },
          maxOutputChars: { type: "number", description: "Accepted compatibility output cap hint; runtime still applies built-in caps." },
          max_output_chars: { type: "number", description: "Accepted compatibility output cap hint; runtime still applies built-in caps." },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
    {
      name: "nexsight_execute",
      description: "Run sandboxed analysis code and return only bounded stdout/stderr. Use for counts, parsing, filtering, and data processing; print distilled findings, not raw dumps.",
      inputSchema: {
        type: "object",
        properties: {
          language: { type: "string", enum: ["shell", "javascript", "python"], description: "Execution language. Defaults to shell when command is provided; otherwise inferred from code or javascript." },
          lang: { type: "string", enum: ["shell", "javascript", "python", "js", "node", "py", "sh", "bash"], description: "Legacy alias for language." },
          code: { type: "string", description: "Script to run from current working directory." },
          command: { type: "string", description: "Shell command alias for code; implies language=shell when language is omitted." },
          cmd: { type: "string", description: "Short shell command alias for command." },
          script: { type: "string", description: "Script alias for code." },
          task: { type: "string", description: "Natural-language task context. Not executable by itself; provide code or command too." },
          reason: { type: "string", description: "Short reason for using Nexsight." },
          timeoutMs: { type: "number", description: "Optional timeout, capped at 30000ms." },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "nexsight_read",
      description: "Lean-ctx style compressed file read. Use modes auto, full, map, signatures, outline, or lines:N-M to avoid dumping large files.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Readable repo-local file path." },
          mode: { type: "string", description: "Read mode: auto, full, map, signatures, outline, or lines:N-M." },
          maxChars: { type: "number", description: "Maximum source chars to inspect, capped at 120000." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "nexsight_gather",
      description: "Batch gather compact maps/signatures from many readable files in one call. Prefer this over many nexsight_read calls for audits, phase docs, repo mapping, or broad evidence collection.",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string", description: "Repo-local root or file path. Defaults to cwd." },
          paths: { type: "array", items: { type: "string" }, description: "Legacy alias. First path is used as root." },
          pattern: { type: "string", description: "Optional glob suffix, such as *.ts or *.md." },
          query: { type: "string", description: "Optional terms; only files containing matching terms are included." },
          reason: { type: "string", description: "Short reason for using Nexsight." },
          mode: { type: "string", description: "Read mode per file: map, signatures, outline, lines:N-M, full, or auto." },
          limit: { type: "number", description: "Maximum matching files, capped at 80." },
          maxCharsPerFile: { type: "number", description: "Maximum source chars per file, capped at 120000." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "nexsight_index",
      description: "Index bounded file or text content into the local nexsight search store.",
      inputSchema: {
        type: "object",
        properties: {
          source: { type: "string", description: "Stable source label for later search." },
          path: { type: "string", description: "Optional readable file path to index." },
          content: { type: "string", description: "Optional text content to index when path is omitted." },
        },
        required: ["source"],
        additionalProperties: false,
      },
    },
    {
      name: "nexsight_batch",
      description: "Index text files under a readable repo root into nexsight with ignore rules, source labels, and bounded file count for later focused search.",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string", description: "Optional root path relative to current working directory." },
          pattern: { type: "string", description: "Optional glob suffix, such as *.ts or *.md." },
          limit: { type: "number", description: "Maximum files to index, capped at 400." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "nexsight_search",
      description: "Search the local nexsight index and return small ranked excerpts. Use after indexing to retrieve focused evidence instead of rescanning raw files.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          limit: { type: "number", description: "Maximum result count, capped at 12." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    {
      name: "archivist_save",
      description: "Persist bounded memory note into Archivist store.",
      inputSchema: {
        type: "object",
        properties: {
          summary: { type: "string", description: "Short memory summary." },
          content: { type: "string", description: "Optional fuller memory content." },
          tags: { type: "array", items: { type: "string" }, description: "Optional memory tags." },
          type: { type: "string", description: "Optional memory type label." },
        },
        required: ["summary"],
        additionalProperties: false,
      },
    },
    {
      name: "archivist_checkpoint",
      description: "Persist bounded checkpoint summary from current session state into Archivist store.",
      inputSchema: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Optional checkpoint reason." },
        },
        additionalProperties: false,
      },
    },
    {
      name: "mcp_list_tools",
      description: "List hydrated MCP tools from configured MCP servers.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "mcp_call",
      description: "Call a hydrated MCP tool by server and tool name.",
      inputSchema: {
        type: "object",
        properties: {
          server: { type: "string", description: "MCP server name." },
          tool: { type: "string", description: "MCP tool name on that server." },
          arguments: { type: "object", description: "Tool arguments matching the MCP tool schema." },
        },
        required: ["server", "tool"],
        additionalProperties: false,
      },
    },
    {
      name: "ask_user_question",
      description: `Ask the user up to ${MAX_QUESTIONNAIRE_QUESTIONS} structured clarifying questions during execution. Use for GSD discussions, specs, design choices, or blocked implementation decisions when you need user intent. Group questions in one call. Each question needs ${MIN_QUESTIONNAIRE_OPTIONS}-${MAX_QUESTIONNAIRE_OPTIONS} options. First option should be recommended when one path is best. The user may answer with an option number or free text.`,
      inputSchema: {
        type: "object",
        properties: {
          questions: {
            type: "array",
            minItems: 1,
            maxItems: MAX_QUESTIONNAIRE_QUESTIONS,
            items: {
              type: "object",
              properties: {
                question: { type: "string", description: "Complete question to ask the user. Should be clear and specific." },
                header: { type: "string", maxLength: MAX_QUESTIONNAIRE_HEADER_LENGTH, description: "Short chip label, max 12 characters." },
                options: {
                  type: "array",
                  minItems: MIN_QUESTIONNAIRE_OPTIONS,
                  maxItems: MAX_QUESTIONNAIRE_OPTIONS,
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string", maxLength: MAX_QUESTIONNAIRE_LABEL_LENGTH, description: "Concise option label, 1-5 words." },
                      description: { type: "string", description: "What this option means or trade-off." },
                      preview: { type: "string", description: "Optional markdown/code/ASCII preview for concrete alternatives." },
                    },
                    required: ["label", "description"],
                    additionalProperties: false,
                  },
                },
                multiSelect: { type: "boolean", description: "True when multiple options may be selected." },
              },
              required: ["question", "header", "options"],
              additionalProperties: false,
            },
          },
        },
        required: ["questions"],
        additionalProperties: false,
      },
    },
    {
      name: "todo",
      description: "Manage visual task checklist for current model work. Use near the start of GSD workflows, next-slice/full-loop requests, and multi-step work; not trivial one-shot replies.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", description: "create, update, list, get, delete, or clear." },
          id: { type: "string", description: "Todo id for update/get/delete." },
          subject: { type: "string", description: "Short task subject." },
          description: { type: "string", description: "Optional detail." },
          activeForm: { type: "string", description: "Short present-tense label shown while active." },
          status: { type: "string", description: "pending, in_progress, completed, or deleted." },
          blockedBy: { type: "array", items: { type: "string" }, description: "Complete dependency id list." },
          addBlockedBy: { type: "array", items: { type: "string" }, description: "Dependency ids to add." },
          removeBlockedBy: { type: "array", items: { type: "string" }, description: "Dependency ids to remove." },
          owner: { type: "string", description: "Optional owner label." },
          metadata: { type: "object", description: "Optional structured metadata." },
          includeDeleted: { type: "boolean", description: "Include deleted tombstones in list output." },
          items: {
            type: "array",
            description: "Legacy create-list alias. Replaces the visible todo list with these items.",
            items: {
              type: "object",
              properties: {
                content: { type: "string" },
                text: { type: "string" },
                subject: { type: "string" },
                title: { type: "string" },
                task: { type: "string" },
                status: { type: "string" },
                activeForm: { type: "string" },
                active: { type: "string" },
                doing: { type: "string" },
                description: { type: "string" },
                detail: { type: "string" },
                blockedBy: { type: "array", items: { type: "string" } },
                owner: { type: "string" },
                metadata: { type: "object" },
              },
              additionalProperties: false,
            },
          },
          todos: {
            type: "array",
            description: "Legacy create-list alias. Replaces the visible todo list with these items.",
            items: {
              type: "object",
              properties: {
                content: { type: "string" },
                text: { type: "string" },
                subject: { type: "string" },
                title: { type: "string" },
                task: { type: "string" },
                status: { type: "string" },
                activeForm: { type: "string" },
                active: { type: "string" },
                doing: { type: "string" },
                description: { type: "string" },
                detail: { type: "string" },
                blockedBy: { type: "array", items: { type: "string" } },
                owner: { type: "string" },
                metadata: { type: "object" },
              },
              additionalProperties: false,
            },
          },
        },
        required: [],
        additionalProperties: false,
      },
    },
    {
      name: "get_goal",
      description: "Read current persistent /goal objective, status, token budget, and usage.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "update_goal",
      description: "Mark current /goal complete after strict evidence audit. Only accepts status=complete.",
      inputSchema: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["complete"], description: "Only complete is accepted." },
        },
        required: ["status"],
        additionalProperties: false,
      },
    },
    {
      name: "Agent",
      description: "Launch a Claude-style subagent in a child Nexagent session. Foreground waits for result; background returns an id for get_subagent_result.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Task for subagent." },
          description: { type: "string", description: "Short 3-5 word UI summary." },
          subagent_type: { type: "string", description: "general-purpose, Explore, Plan, or custom .pi/agents type." },
          model: { type: "string", description: "Optional model hint recorded for compatibility." },
          thinking: { type: "string", description: "Optional thinking level hint recorded for compatibility." },
          max_turns: { type: "number", description: "Optional turn limit hint." },
          run_in_background: { type: "boolean", description: "Return immediately and let agent finish in background." },
          resume: { type: "string", description: "Reserved compatibility field." },
          isolated: { type: "boolean", description: "Reserved compatibility field." },
          isolation: { type: "string", description: "Reserved compatibility field." },
          inherit_context: { type: "boolean", description: "Fork recent parent conversation into subagent." },
          fork_context: { type: "boolean", description: "Alias for inherit_context." },
        },
        required: ["prompt", "description", "subagent_type"],
        additionalProperties: false,
      },
    },
    {
      name: "get_subagent_result",
      description: "Check status and retrieve a background subagent result.",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Subagent id." },
          wait: { type: "boolean", description: "Wait for completion if still running." },
          verbose: { type: "boolean", description: "Return full result instead of preview." },
        },
        required: ["agent_id"],
        additionalProperties: false,
      },
    },
    {
      name: "steer_subagent",
      description: "Queue steering text for a running/background subagent.",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Subagent id." },
          message: { type: "string", description: "Steering message." },
        },
        required: ["agent_id", "message"],
        additionalProperties: false,
      },
    },
    {
      name: "lsp_status",
      description: "Report safe local LSP status. Enabled by default with bounded fallback; never auto-downloads language servers.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: "lsp_symbols",
      description: "Return bounded symbol summaries for a project file and optionally index summaries into Archivist.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project file path to summarize." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "lsp_diagnostics",
      description: "Return bounded diagnostics summaries for a project file and optionally index summaries into Archivist.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Project file path to inspect." },
        },
        required: ["path"],
        additionalProperties: false,
      },
    },
    {
      name: "lsp_navigation",
      description: "Pi Lens-inspired bounded code navigation: definition, references, hover, documentSymbol, workspaceSymbol, implementation, workspaceDiagnostics.",
      inputSchema: {
        type: "object",
        properties: {
          operation: { type: "string", description: "Operation: definition, references, hover, documentSymbol, workspaceSymbol, implementation, workspaceDiagnostics." },
          filePath: { type: "string", description: "Project file path for file/position operations." },
          path: { type: "string", description: "Legacy alias for filePath." },
          line: { type: "number", description: "1-based line for position operations." },
          character: { type: "number", description: "1-based character for position operations." },
          char: { type: "number", description: "Legacy alias for character." },
          query: { type: "string", description: "Workspace symbol query." },
        },
        required: ["operation"],
        additionalProperties: false,
      },
    },
  ] as const;
}

export function formatInternalToolPromptGuidance(): string[] {
  const tools = getInternalToolDefinitions();
  return [
    "Internal tool protocol: when tool use is required, respond with only one XML block:",
    '<nexagent_tool_call>{"name":"read_file","arguments":{"path":"src/cli.ts"}}</nexagent_tool_call>',
    `Available internal tools: ${tools.map((tool) => tool.name).join(", ")}`,
    "Use tools for repo inspection instead of narrating intended actions.",
    "Use ask_user_question when user intent is truly ambiguous, especially GSD discussion/spec/design choices, framework selection, or implementation trade-offs that cannot be safely inferred.",
    "Group all needed clarifying questions into one ask_user_question call; do not ask serial free-form questions when structured choices fit.",
    "Use todo near the start for GSD workflows, phases, milestones, next-slice/full-loop requests, or any task with three or more meaningful steps. Keep it current, prefer one in_progress task, and mark completed only after evidence or verification.",
    "When a multi-stage turn blocks, update the current todo with blocker detail before final response when the todo tool is available.",
    "Do not create todos for trivial one-step answers unless user asks for task tracking.",
    "Use Agent for genuinely parallel or specialist work. Prefer concrete descriptions, bounded prompts, and get_subagent_result for background results.",
  ];
}

export function getInternalToolFunctionDefinitions(): ReadonlyArray<Record<string, unknown>> {
  return getInternalToolDefinitions().map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: true,
  }));
}

const TOOL_ARGUMENT_COMPAT_ALIASES: Partial<Record<InternalToolName, ReadonlyArray<string>>> = {
  batch_edit: ["operations", "changes"],
  git_status: ["path"],
  read_file: ["start_line", "end_line", "limit"],
  search_content: ["query"],
  search_files: ["query"],
  shell_command: ["cwd", "workdir", "timeout", "timeout_ms", "timeoutMs", "maxOutputChars", "max_output_chars"],
  todo: ["items", "todos"],
  nexsight_execute: ["lang"],
  nexsight_gather: ["paths", "reason"],
  lsp_navigation: ["path", "char"],
};

export function validateInternalToolArguments(call: InternalToolCall): InternalToolResult | null {
  const sanitized = sanitizeToolArguments(call);
  return sanitized.ok ? null : sanitized.failure;
}

export function sanitizeToolArguments(call: InternalToolCall): { ok: true } | { ok: false; failure: InternalToolResult } {
  const definition = getInternalToolDefinitions().find((tool) => tool.name === call.name);
  if (!definition) {
    return { ok: false, failure: fail(call.name, "unknown tool") };
  }
  const args = call.arguments ?? {};
  const allowedAliases = new Set(TOOL_ARGUMENT_COMPAT_ALIASES[call.name] ?? []);
  const unexpected = findUnexpectedToolArgumentPaths(definition.inputSchema, args, [], allowedAliases);
  if (unexpected.length > 0) {
    return { ok: false, failure: fail(call.name, `unexpected arguments for tool ${call.name}: ${unexpected.join(", ")}`) };
  }
  return { ok: true };
}

function findUnexpectedToolArgumentPaths(
  schema: Record<string, unknown>,
  value: unknown,
  pathParts: string[],
  allowedTopLevelAliases: ReadonlySet<string>,
): string[] {
  if (schema.additionalProperties !== false || !isRecord(value)) {
    return [];
  }

  const properties = isRecord(schema.properties) ? schema.properties : {};
  const unexpected: string[] = [];
  for (const key of Object.keys(value)) {
    if (!(key in properties) && !(pathParts.length === 0 && allowedTopLevelAliases.has(key))) {
      unexpected.push([...pathParts, key].join("."));
    }
  }

  for (const [key, childSchema] of Object.entries(properties)) {
    if (!(key in value) || !isRecord(childSchema)) {
      continue;
    }
    const childValue = value[key];
    if (Array.isArray(childValue) && isRecord(childSchema.items)) {
      childValue.forEach((item, index) => {
        unexpected.push(...findUnexpectedToolArgumentPaths(childSchema.items as Record<string, unknown>, item, [...pathParts, key, String(index)], allowedTopLevelAliases));
      });
      continue;
    }
    unexpected.push(...findUnexpectedToolArgumentPaths(childSchema, childValue, [...pathParts, key], allowedTopLevelAliases));
  }

  return unexpected;
}

export function executeInternalTool(session: RuntimeSession, call: InternalToolCall): InternalToolResult {
  const argumentFailure = validateInternalToolArguments(call);
  if (argumentFailure) {
    return argumentFailure;
  }

  switch (call.name) {
    case "read_file":
      return executeReadFileToolSync(session, call.arguments ?? {});
    case "write_file":
      return executeWriteFileTool(session, asString(call.arguments?.path, "."), asString(call.arguments?.content, ""));
    case "apply_patch":
      return executeApplyPatchTool(
        session,
        asString(call.arguments?.path, "."),
        asString(call.arguments?.find, ""),
        asString(call.arguments?.replace, ""),
        asBoolean(call.arguments?.replaceAll),
      );
    case "batch_edit":
      return executeBatchEditTool(session, call.arguments ?? {});
    case "preview_patch":
      return executePreviewPatchTool(
        session,
        asString(call.arguments?.path, "."),
        asString(call.arguments?.find, ""),
        asString(call.arguments?.replace, ""),
        asBoolean(call.arguments?.replaceAll),
      );
    case "list_dir":
      return executeListDirTool(session, asOptionalString(call.arguments?.path));
    case "search_content":
      return executeSearchContentTool(session, asString(call.arguments?.pattern ?? call.arguments?.query, ""), asOptionalString(call.arguments?.path));
    case "search_files":
      return executeSearchFilesTool(session, asString(call.arguments?.pattern ?? call.arguments?.query, ""), asOptionalString(call.arguments?.path));
    case "web_fetch":
    case "web_search":
      return pending(call.name, "async");
    case "git_status":
      return executeGitStatusTool(session);
    case "git_diff":
      return executeGitDiffTool(session, asOptionalString(call.arguments?.path));
    case "shell_command":
      return executeShellCommandTool(session, asString(call.arguments?.command, ""), normalizeShellCommandArguments(call.arguments ?? {}));
    case "nexsight_execute":
      return executeNexsightExecuteTool(session, call.arguments ?? {});
    case "nexsight_read":
      return executeNexsightReadTool(session, call.arguments ?? {});
    case "nexsight_gather":
      return executeNexsightGatherTool(session, call.arguments ?? {});
    case "nexsight_index":
      return executeNexsightIndexTool(session, call.arguments ?? {});
    case "nexsight_batch":
      return executeNexsightBatchTool(session, call.arguments ?? {});
    case "nexsight_search":
      return toToolResult("nexsight_search", searchNexsight(session, {
        query: asString(call.arguments?.query, ""),
        limit: asNumber(call.arguments?.limit, 5),
      }));
    case "archivist_save":
      return pending("archivist_save", "async");
    case "archivist_checkpoint":
      return pending("archivist_checkpoint", "async");
    case "mcp_list_tools":
    case "mcp_call":
    case "ask_user_question":
      return pending(call.name, "async");
    case "todo": {
      const result = executeTodoTool(session, normalizeTodoToolArguments(call.arguments ?? {}));
      if (result.ok) {
        savePersistedRuntimeState(session);
      }
      return result;
    }
    case "get_goal":
      return toToolResult("get_goal", executeGetGoalTool(session));
    case "update_goal":
      return toToolResult("update_goal", executeUpdateGoalTool(session, call.arguments ?? {}));
    case "Agent":
    case "get_subagent_result":
      return pending(call.name, "async");
    case "steer_subagent":
      return toToolResult("steer_subagent", executeSteerSubagentTool(session, call.arguments ?? {}));
    case "lsp_status":
      return ok("lsp_status", formatLspStatus(session));
    case "lsp_symbols":
    case "lsp_diagnostics":
    case "lsp_navigation":
      return pending(call.name, "async");
  }
}

export async function executeInternalToolAsync(session: RuntimeSession, call: InternalToolCall): Promise<InternalToolResult> {
  const argumentFailure = validateInternalToolArguments(call);
  if (argumentFailure) {
    return argumentFailure;
  }

  switch (call.name) {
    case "read_file":
      return await executeReadFileTool(session, call.arguments ?? {});
    case "shell_command":
      return executeShellCommandToolResult(session, asString(call.arguments?.command, ""), normalizeShellCommandArguments(call.arguments ?? {}), runShellCommandWithOutputAccumulatorAsync);
    case "nexsight_execute":
      return executeNexsightExecuteToolAsync(session, call.arguments ?? {});
    case "web_fetch":
      return await executeWebFetchTool(asString(call.arguments?.url, ""));
    case "web_search":
      return await executeWebSearchTool(asString(call.arguments?.query, ""), asNumber(call.arguments?.limit, 5));
    case "archivist_save":
      return await executeArchivistSaveTool(
        session,
        asString(call.arguments?.summary, ""),
        asOptionalString(call.arguments?.content),
        asStringArray(call.arguments?.tags),
        asOptionalString(call.arguments?.type),
      );
    case "archivist_checkpoint":
      return await executeArchivistCheckpointTool(session, asOptionalString(call.arguments?.reason));
    case "mcp_list_tools":
      return ok("mcp_list_tools", listMcpTools(session.mcpRegistry));
    case "mcp_call":
      return await executeMcpCallTool(session, call.arguments ?? {});
    case "ask_user_question":
      return await executeAskUserQuestionTool(session, call.arguments ?? {});
    case "lsp_symbols":
      return await executeLspSymbolsTool(session, asString(call.arguments?.path, ""));
    case "lsp_diagnostics":
      return await executeLspDiagnosticsTool(session, asString(call.arguments?.path, ""));
    case "lsp_navigation":
      return executeLspNavigationTool(session, call.arguments ?? {});
    case "Agent":
      return toToolResult("Agent", await executeAgentTool(session, call.arguments ?? {}));
    case "get_subagent_result":
      return toToolResult("get_subagent_result", await executeGetSubagentResultTool(session, call.arguments ?? {}));
    default:
      return executeInternalTool(session, call);
  }
}

export function classifyInternalToolRisk(call: InternalToolCall): "low" | "guarded" {
  if (call.name === "nexsight_execute") {
    return isNexsightShellCall(call.arguments ?? {}) ? "guarded" : "low";
  }

  return call.name === "shell_command"
    || call.name === "write_file"
    || call.name === "apply_patch"
    || call.name === "batch_edit"
    || call.name === "preview_patch"
    || call.name === "web_fetch"
    || call.name === "web_search"
    || call.name === "mcp_call"
    || call.name === "nexsight_index"
    || call.name === "nexsight_batch"
    || call.name === "archivist_save"
    || call.name === "archivist_checkpoint"
    || call.name === "lsp_symbols"
    || call.name === "lsp_diagnostics"
    || call.name === "lsp_navigation"
    ? "guarded"
    : "low";
}

async function executeAskUserQuestionTool(session: RuntimeSession, args: Record<string, unknown>): Promise<InternalToolResult> {
  if (session.operationControls.pendingQuestionnaire) {
    return fail(ASK_USER_TOOL_NAME, "ask_user_question already pending; wait for user answer");
  }
  const questions = normalizeQuestionnaireForUi(parseQuestionnaireQuestions(args.questions));
  const validation = validateQuestionnaire(questions);
  if (!validation.ok) {
    return fail(ASK_USER_TOOL_NAME, validation.message);
  }
  const request = createQuestionnaireRequest(questions);
  session.operationControls.pendingQuestionnaire = request;
  while (session.operationControls.pendingQuestionnaire === request && !request.response) {
    await sleep(50);
  }
  const response = request.response ?? { answers: request.answers, cancelled: true };
  if (session.operationControls.pendingQuestionnaire === request) {
    session.operationControls.pendingQuestionnaire = null;
  }
  return ok(ASK_USER_TOOL_NAME, formatQuestionnaireResponseText(response));
}

function normalizeQuestionnaireForUi(questions: ReturnType<typeof parseQuestionnaireQuestions>): ReturnType<typeof parseQuestionnaireQuestions> {
  return questions.slice(0, MAX_QUESTIONNAIRE_QUESTIONS).map((question) => ({
    ...question,
    header: question.header.slice(0, MAX_QUESTIONNAIRE_HEADER_LENGTH),
    options: question.options.slice(0, MAX_QUESTIONNAIRE_OPTIONS).map((option) => ({
      ...option,
      label: option.label.slice(0, MAX_QUESTIONNAIRE_LABEL_LENGTH),
    })),
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function executeMcpCallTool(session: RuntimeSession, args: Record<string, unknown>): Promise<InternalToolResult> {
  const server = asString(args.server, "");
  const tool = asString(args.tool, "");
  const toolArgs = isRecord(args.arguments) ? args.arguments : {};

  if (!server || !tool) {
    return fail("mcp_call", "server and tool are required");
  }

  try {
    return ok("mcp_call", await callMcpTool(session.mcpRegistry, server, tool, toolArgs));
  } catch (error) {
    return fail("mcp_call", error instanceof Error ? error.message : String(error));
  }
}

export function resolveRepoPath(session: RuntimeSession, inputPath?: string): string {
  if (!inputPath || inputPath === ".") {
    return session.cwd;
  }
  return path.resolve(session.cwd, expandHomePath(inputPath));
}

function expandHomePath(inputPath: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!home) {
    return inputPath;
  }
  if (inputPath === "~") {
    return home;
  }
  if (inputPath.startsWith("~/")) {
    return path.join(home, inputPath.slice(2));
  }
  return inputPath;
}

export function validateRepoToolPath(session: RuntimeSession, targetPath: string): string | null {
  return validateRepoPathPolicy(session, targetPath);
}

export function validateReadToolPath(session: RuntimeSession, targetPath: string): string | null {
  return validateReadPathPolicy(session, targetPath);
}

export function validateWriteToolPath(session: RuntimeSession, targetPath: string): string | null {
  return validateWritePathPolicy(session, targetPath);
}

function executeReadFileToolSync(session: RuntimeSession, args: Record<string, unknown>): InternalToolResult {
  const inputPath = asString(args.path, ".");
  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateReadToolPath(session, targetPath);
  if (policyFailure) {
    return fail("read_file", policyFailure);
  }

  try {
    const stats = statSync(targetPath);
    if (!stats.isFile()) {
      return fail("read_file", `${formatToolPath(session, targetPath)} is not a file`);
    }

    const content = readFileSync(targetPath, "utf8");
    markReadGuardCoverage(session, targetPath);
    touchLspFileSync(session, targetPath);
    return ok("read_file", formatReadFileOutput(session, targetPath, content, args));
  } catch (error) {
    return fail("read_file", formatToolError(targetPath, error));
  }
}

async function executeReadFileTool(session: RuntimeSession, args: Record<string, unknown>): Promise<InternalToolResult> {
  const lineRangeAwareResult = executeReadFileToolSync(session, args);
  return lineRangeAwareResult;
}

function formatReadFileOutput(session: RuntimeSession, targetPath: string, content: string, args: Record<string, unknown>): string {
  const lineRange = resolveReadFileLineRange(args);
  const maxLines = clampPositiveInteger(asNumber(args.maxLines ?? args.limit, READ_FILE_COMPACT_LINE_LIMIT), 1, READ_FILE_COMPACT_LINE_LIMIT);
  const lines = content.split(/\r?\n/);
  if (lineRange) {
    return renderReadFileLines(session, targetPath, lines, lineRange.startLine, lineRange.endLine, "range");
  }
  if (asBoolean(args.compact) || content.length > READ_FILE_COMPACT_CHAR_LIMIT || lines.length > READ_FILE_COMPACT_LINE_LIMIT) {
    return renderReadFileLines(session, targetPath, lines, 1, Math.min(lines.length, maxLines), "compact");
  }
  return content;
}

function resolveReadFileLineRange(args: Record<string, unknown>): { startLine: number; endLine: number } | null {
  const rawStart = asNumber(args.startLine ?? args.start_line, NaN);
  const rawEnd = asNumber(args.endLine ?? args.end_line, NaN);
  if (!Number.isFinite(rawStart) && !Number.isFinite(rawEnd)) {
    return null;
  }
  const startLine = Number.isFinite(rawStart) ? Math.max(1, Math.floor(rawStart)) : 1;
  const endLine = Number.isFinite(rawEnd) ? Math.max(startLine, Math.floor(rawEnd)) : startLine + READ_FILE_COMPACT_LINE_LIMIT - 1;
  return { startLine, endLine };
}

function renderReadFileLines(
  session: RuntimeSession,
  targetPath: string,
  lines: string[],
  startLine: number,
  endLine: number,
  mode: "compact" | "range",
): string {
  const totalLines = lines.length;
  const boundedStart = clampPositiveInteger(startLine, 1, Math.max(totalLines, 1));
  const boundedEnd = clampPositiveInteger(endLine, boundedStart, Math.max(totalLines, boundedStart));
  const width = String(boundedEnd).length;
  const renderedLines = lines
    .slice(boundedStart - 1, boundedEnd)
    .map((line, index) => `${String(boundedStart + index).padStart(width, " ")} | ${line}`);
  const truncated = boundedEnd < totalLines ? [`... ${String(totalLines - boundedEnd)} more line${totalLines - boundedEnd === 1 ? "" : "s"} ...`] : [];
  return [
    `[read_file ${mode}: ${formatToolPath(session, targetPath)} lines ${String(boundedStart)}-${String(boundedEnd)} of ${String(totalLines)}]`,
    ...renderedLines,
    ...truncated,
  ].join("\n");
}

function clampPositiveInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function executeListDirTool(session: RuntimeSession, inputPath?: string): InternalToolResult {
  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateReadToolPath(session, targetPath);
  if (policyFailure) {
    return fail("list_dir", policyFailure);
  }

  try {
    const entries = readdirSync(targetPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => `${entry.isDirectory() ? "dir" : "file"} ${entry.name}`);
    return ok("list_dir", entries.length > 0 ? entries.join("\n") : "(empty directory)");
  } catch (error) {
    return fail("list_dir", formatToolError(targetPath, error));
  }
}

function executeWriteFileTool(session: RuntimeSession, inputPath: string, content: string): InternalToolResult {
  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateWriteToolPath(session, targetPath);
  if (policyFailure) {
    return fail("write_file", policyFailure);
  }

  try {
    const guardFailure = validateReadBeforeEdit(session, targetPath);
    if (guardFailure) {
      return fail("write_file", guardFailure);
    }
    const secretFailure = scanWriteSecrets(content);
    if (secretFailure) {
      return fail("write_file", secretFailure);
    }
    const formattedContent = formatContentForWrite(targetPath, content);
    const current = readExistingFileForDiff(targetPath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, formattedContent, "utf8");
    markReadGuardCoverage(session, targetPath);
    touchLspFileSync(session, targetPath);
    return ok("write_file", formatEditToolOutput(session, targetPath, current, formattedContent, `wrote ${formatToolPath(session, targetPath)} (${String(formattedContent.length)} chars)`));
  } catch (error) {
    return fail("write_file", formatToolError(targetPath, error));
  }
}

function executeApplyPatchTool(
  session: RuntimeSession,
  inputPath: string,
  find: string,
  replace: string,
  replaceAll: boolean,
): InternalToolResult {
  if (!find.length) {
    return fail("apply_patch", "find required");
  }

  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateWriteToolPath(session, targetPath);
  if (policyFailure) {
    return fail("apply_patch", policyFailure);
  }

  try {
    const stats = statSync(targetPath);
    if (!stats.isFile()) {
      return fail("apply_patch", `${formatToolPath(session, targetPath)} is not a file`);
    }

    const current = readFileSync(targetPath, "utf8");
    const occurrences = current.split(find).length - 1;
    if (occurrences === 0) {
      return fail("apply_patch", `patch target not found in ${formatToolPath(session, targetPath)}`);
    }
    if (!replaceAll && occurrences > 1) {
      return fail("apply_patch", `patch target ambiguous in ${formatToolPath(session, targetPath)}; ${String(occurrences)} matches`);
    }
    const guardFailure = validateReadBeforeEdit(session, targetPath);
    if (guardFailure) {
      return fail("apply_patch", guardFailure);
    }

    const next = formatContentForWrite(targetPath, replaceAll ? current.split(find).join(replace) : current.replace(find, replace));
    const secretFailure = scanWriteSecrets(next);
    if (secretFailure) {
      return fail("apply_patch", secretFailure);
    }
    writeFileSync(targetPath, next, "utf8");
    markReadGuardCoverage(session, targetPath);
    touchLspFileSync(session, targetPath);
    return ok("apply_patch", formatEditToolOutput(session, targetPath, current, next, `patched ${formatToolPath(session, targetPath)} (${String(occurrences)} match${occurrences === 1 ? "" : "es"})`));
  } catch (error) {
    return fail("apply_patch", formatToolError(targetPath, error));
  }
}

type BatchEditOperation = {
  type: "write" | "replace" | "insert_before" | "insert_after" | "prepend" | "append";
  path: string;
  content?: string;
  find?: string;
  replace?: string;
  anchor?: string;
  replaceAll?: boolean;
};

function executeBatchEditTool(session: RuntimeSession, args: Record<string, unknown>): InternalToolResult {
  const edits = parseBatchEditOperations(args.edits ?? args.operations ?? args.changes);
  if (!edits.ok) {
    return fail("batch_edit", edits.error);
  }
  if (edits.value.length === 0) {
    return fail("batch_edit", "edits required");
  }
  if (edits.value.length > 40) {
    return fail("batch_edit", "too many edits; maximum is 40");
  }

  const currentByPath = new Map<string, string>();
  const nextByPath = new Map<string, string>();
  const summaries: string[] = [];

  for (let index = 0; index < edits.value.length; index += 1) {
    const edit = edits.value[index];
    const targetPath = resolveRepoPath(session, edit.path);
    const policyFailure = validateWriteToolPath(session, targetPath);
    if (policyFailure) {
      return fail("batch_edit", `edit ${String(index + 1)} blocked: ${policyFailure}`);
    }

    try {
      const current = nextByPath.get(targetPath) ?? readBatchEditCurrent(targetPath, currentByPath);
      const next = applyBatchEditOperation(session, targetPath, current, edit, index + 1);
      if (!next.ok) {
        return fail("batch_edit", next.error);
      }
      nextByPath.set(targetPath, next.value);
      summaries.push(next.summary);
    } catch (error) {
      return fail("batch_edit", `edit ${String(index + 1)} failed: ${formatToolError(targetPath, error)}`);
    }
  }

  for (const [targetPath, next] of nextByPath) {
    const guardFailure = validateReadBeforeEdit(session, targetPath);
    if (guardFailure) {
      return fail("batch_edit", guardFailure);
    }
    const formattedNext = formatContentForWrite(targetPath, next);
    const secretFailure = scanWriteSecrets(formattedNext);
    if (secretFailure) {
      return fail("batch_edit", secretFailure);
    }
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, formattedNext, "utf8");
    nextByPath.set(targetPath, formattedNext);
    markReadGuardCoverage(session, targetPath);
    touchLspFileSync(session, targetPath);
  }

  return ok("batch_edit", [
    `batch edited ${String(nextByPath.size)} file${nextByPath.size === 1 ? "" : "s"} with ${String(edits.value.length)} operation${edits.value.length === 1 ? "" : "s"}`,
    ...summaries.slice(0, 20),
    summaries.length > 20 ? `... ${String(summaries.length - 20)} more operations` : "",
    formatBatchEditDiff(session, currentByPath, nextByPath),
  ].filter(Boolean).join("\n"));
}

function parseBatchEditOperations(value: unknown): { ok: true; value: BatchEditOperation[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) {
    return { ok: false, error: "edits array required" };
  }

  const edits: BatchEditOperation[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `edit ${String(index + 1)} must be an object` };
    }
    const record = raw as Record<string, unknown>;
    const type = asString(record.type ?? record.op, "") as BatchEditOperation["type"];
    const inputPath = asString(record.path, "");
    if (!["write", "replace", "insert_before", "insert_after", "prepend", "append"].includes(type)) {
      return { ok: false, error: `edit ${String(index + 1)} has unsupported type` };
    }
    if (!inputPath) {
      return { ok: false, error: `edit ${String(index + 1)} path required` };
    }
    edits.push({
      type,
      path: inputPath,
      content: asOptionalString(record.content),
      find: asOptionalString(record.find),
      replace: asOptionalString(record.replace),
      anchor: asOptionalString(record.anchor ?? record.after ?? record.before),
      replaceAll: asBoolean(record.replaceAll),
    });
  }

  return { ok: true, value: edits };
}

function readBatchEditCurrent(targetPath: string, currentByPath: Map<string, string>): string {
  if (currentByPath.has(targetPath)) {
    return currentByPath.get(targetPath) ?? "";
  }
  let current = "";
  try {
    current = readFileSync(targetPath, "utf8");
  } catch {
    current = "";
  }
  currentByPath.set(targetPath, current);
  return current;
}

function markReadGuardCoverage(session: RuntimeSession, targetPath: string): void {
  try {
    const stats = statSync(targetPath);
    if (!stats.isFile()) return;
    const state = readGuardState.get(session) ?? new Map<string, { mtimeMs: number; size: number }>();
    state.set(targetPath, { mtimeMs: stats.mtimeMs, size: stats.size });
    readGuardState.set(session, state);
  } catch {
    // Best effort only.
  }
}

function validateReadBeforeEdit(session: RuntimeSession, targetPath: string): string | null {
  let stats;
  try {
    stats = statSync(targetPath);
  } catch {
    return null;
  }
  if (!stats.isFile()) {
    return null;
  }
  const covered = readGuardState.get(session)?.get(targetPath);
  if (!covered) {
    return `read guard blocked ${formatToolPath(session, targetPath)}; read file first or create via new path`;
  }
  if (covered.mtimeMs !== stats.mtimeMs || covered.size !== stats.size) {
    return `read guard blocked ${formatToolPath(session, targetPath)}; file changed since last read`;
  }
  return null;
}

function scanWriteSecrets(content: string): string | null {
  const patterns: Array<[RegExp, string]> = [
    [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, "private key"],
    [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
    [/\bghp_[A-Za-z0-9_]{30,}\b/, "GitHub token"],
    [/\bsk-[A-Za-z0-9]{32,}\b/, "OpenAI-style API key"],
  ];
  for (const [pattern, label] of patterns) {
    if (pattern.test(content)) {
      return `secrets guard blocked write; detected ${label}`;
    }
  }
  return null;
}

function formatContentForWrite(targetPath: string, content: string): string {
  if (path.extname(targetPath) !== ".json") {
    return content;
  }
  try {
    return `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
  } catch {
    return content;
  }
}

function applyBatchEditOperation(
  session: RuntimeSession,
  targetPath: string,
  current: string,
  edit: BatchEditOperation,
  index: number,
): { ok: true; value: string; summary: string } | { ok: false; error: string } {
  const label = `${String(index)} ${formatToolPath(session, targetPath)} ${edit.type}`;
  if (edit.type === "write") {
    if (edit.content === undefined) {
      return { ok: false, error: `edit ${label}: content required` };
    }
    return { ok: true, value: edit.content, summary: `${label} (${String(edit.content.length)} chars)` };
  }
  if (edit.type === "prepend") {
    if (edit.content === undefined) {
      return { ok: false, error: `edit ${label}: content required` };
    }
    return { ok: true, value: `${edit.content}${current}`, summary: `${label} (${String(edit.content.length)} chars)` };
  }
  if (edit.type === "append") {
    if (edit.content === undefined) {
      return { ok: false, error: `edit ${label}: content required` };
    }
    return { ok: true, value: `${current}${edit.content}`, summary: `${label} (${String(edit.content.length)} chars)` };
  }
  if (edit.type === "replace") {
    if (!edit.find) {
      return { ok: false, error: `edit ${label}: find required` };
    }
    const replacement = edit.replace ?? "";
    const occurrences = current.split(edit.find).length - 1;
    if (occurrences === 0) {
      return { ok: false, error: `edit ${label}: find text not found` };
    }
    if (!edit.replaceAll && occurrences > 1) {
      return { ok: false, error: `edit ${label}: find text ambiguous (${String(occurrences)} matches)` };
    }
    const value = edit.replaceAll ? current.split(edit.find).join(replacement) : current.replace(edit.find, replacement);
    return { ok: true, value, summary: `${label} (${String(occurrences)} match${occurrences === 1 ? "" : "es"})` };
  }

  if (!edit.anchor) {
    return { ok: false, error: `edit ${label}: anchor required` };
  }
  if (edit.content === undefined) {
    return { ok: false, error: `edit ${label}: content required` };
  }
  const occurrences = current.split(edit.anchor).length - 1;
  if (occurrences === 0) {
    return { ok: false, error: `edit ${label}: anchor not found` };
  }
  if (occurrences > 1) {
    return { ok: false, error: `edit ${label}: anchor ambiguous (${String(occurrences)} matches)` };
  }
  const value = edit.type === "insert_before"
    ? current.replace(edit.anchor, `${edit.content}${edit.anchor}`)
    : current.replace(edit.anchor, `${edit.anchor}${edit.content}`);
  return { ok: true, value, summary: `${label} (anchor matched)` };
}

function executePreviewPatchTool(
  session: RuntimeSession,
  inputPath: string,
  find: string,
  replace: string,
  replaceAll: boolean,
): InternalToolResult {
  if (!find.length) {
    return fail("preview_patch", "find required");
  }

  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateWriteToolPath(session, targetPath);
  if (policyFailure) {
    return fail("preview_patch", policyFailure);
  }

  try {
    const stats = statSync(targetPath);
    if (!stats.isFile()) {
      return fail("preview_patch", `${formatToolPath(session, targetPath)} is not a file`);
    }

    const current = readFileSync(targetPath, "utf8");
    const occurrences = current.split(find).length - 1;
    if (occurrences === 0) {
      return fail("preview_patch", `patch target not found in ${formatToolPath(session, targetPath)}`);
    }
    if (!replaceAll && occurrences > 1) {
      return fail("preview_patch", `patch target ambiguous in ${formatToolPath(session, targetPath)}; ${String(occurrences)} matches`);
    }

    const next = replaceAll ? current.split(find).join(replace) : current.replace(find, replace);
    return ok("preview_patch", buildPatchPreview(formatToolPath(session, targetPath), current, next));
  } catch (error) {
    return fail("preview_patch", formatToolError(targetPath, error));
  }
}

function executeSearchContentTool(session: RuntimeSession, pattern: string, inputPath?: string): InternalToolResult {
  if (!pattern.trim()) {
    return fail("search_content", "pattern required");
  }

  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateReadToolPath(session, targetPath);
  if (policyFailure) {
    return fail("search_content", policyFailure);
  }

  try {
    if (hasRipgrep()) {
      const output = execFileSync("rg", ["-n", "--color", "never", "--max-count", "100", pattern, targetPath], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }).trim();
      return ok("search_content", output.length > 0 ? normalizeContentMatchLines(output, targetPath) : "(no matches)");
    }
  } catch (error) {
    const result = error as NodeJS.ErrnoException & { status?: number; stderr?: string | Buffer };
    if (result.status === 1) {
      return ok("search_content", "(no matches)");
    }
    return fail("search_content", formatToolError(targetPath, result.stderr ? String(result.stderr) : error));
  }

  try {
    const matches = findContentMatches(targetPath, pattern).slice(0, 100);
    return ok("search_content", matches.length > 0 ? matches.join("\n") : "(no matches)");
  } catch (error) {
    return fail("search_content", formatToolError(targetPath, error));
  }
}

function executeSearchFilesTool(session: RuntimeSession, pattern: string, inputPath?: string): InternalToolResult {
  if (!pattern.trim()) {
    return fail("search_files", "pattern required");
  }

  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateReadToolPath(session, targetPath);
  if (policyFailure) {
    return fail("search_files", policyFailure);
  }

  try {
    const matches = searchFilesWithIgnore({ cwd: targetPath, pattern, limit: 100 });
    return ok("search_files", matches.length > 0 ? matches.join("\n") : "(no matches)");
  } catch (error) {
    try {
      const matches = findPathMatches(targetPath, pattern).slice(0, 100);
      return ok("search_files", matches.length > 0 ? matches.join("\n") : "(no matches)");
    } catch {
      return fail("search_files", formatToolError(targetPath, error));
    }
  }
}

function executeGitStatusTool(session: RuntimeSession): InternalToolResult {
  const freshness = session.repo.freshness;
  return ok(
    "git_status",
    [
      `repo: ${session.repo.name}`,
      `branch: ${session.repo.branch ?? "detached"}`,
      `tracking: ${freshness.tracking ?? "none"}`,
      `status: ${freshness.status}`,
      `ahead: ${String(freshness.ahead ?? 0)}`,
      `behind: ${String(freshness.behind ?? 0)}`,
      `dirty: ${String(freshness.dirty)}`,
      `needsPull: ${String(freshness.needsPull)}`,
    ].join("\n"),
  );
}

function executeGitDiffTool(session: RuntimeSession, inputPath?: string): InternalToolResult {
  if (session.repo.vcs !== "git") {
    return fail("git_diff", "git diff unavailable; session repo is not git-backed");
  }

  const repoRoot = session.repo.root || session.cwd;
  if (inputPath) {
    const targetPath = resolveRepoPath(session, inputPath);
    const policyFailure = validateRepoToolPath(session, targetPath);
    if (policyFailure) {
      return fail("git_diff", policyFailure);
    }
  }

  try {
    const output = execFileSync(
      "git",
      inputPath
        ? ["diff", "--no-ext-diff", "--", path.relative(repoRoot, resolveRepoPath(session, inputPath))]
        : ["diff", "--no-ext-diff"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trimEnd();
    return ok("git_diff", output.length > 0 ? capDiffOutput(output) : "(no diff)");
  } catch (error) {
    const result = error as NodeJS.ErrnoException & { status?: number; stderr?: string | Buffer; stdout?: string | Buffer };
    const stdout = result.stdout ? String(result.stdout).trimEnd() : "";
    if (result.status === 0 || stdout.length > 0) {
      return ok("git_diff", stdout.length > 0 ? capDiffOutput(stdout) : "(no diff)");
    }
    return fail("git_diff", formatToolError(repoRoot, result.stderr ? String(result.stderr) : error));
  }
}

function executeShellCommandTool(session: RuntimeSession, command: string, args: Record<string, unknown> = {}): InternalToolResult {
  return executeShellCommandToolResult(session, command, args, runShellCommandWithOutputAccumulator) as InternalToolResult;
}

function executeShellCommandToolResult(
  session: RuntimeSession,
  command: string,
  args: Record<string, unknown> = {},
  runner: (command: string, cwd: string, timeoutMs: number) => ShellCommandRunResult | Promise<ShellCommandRunResult>,
): InternalToolResult | Promise<InternalToolResult> {
  const normalized = command.trim();
  if (!normalized) {
    return fail("shell_command", "command required");
  }
  const timeoutMs = Math.max(MIN_SHELL_TIMEOUT_MS, Math.min(asNumber(args.timeoutMs, DEFAULT_SHELL_TIMEOUT_MS), MAX_SHELL_TIMEOUT_MS));
  const cwd = resolveShellCommandCwd(session, args);
  if (!cwd.ok) {
    return fail("shell_command", cwd.message);
  }

  const blockedPattern = findBlockedShellPattern(normalized);
  if (blockedPattern) {
    const analysis = analyzeBlockedShellCommand(normalized);
    const report = {
      command: normalized,
      pattern: blockedPattern.source,
      reason: analysis?.reason ?? "protected system path mutation matched",
      matchedText: analysis?.matchedText ?? null,
      source: session.activeSkill ? `skill ${session.activeSkill.name}` : "shell_command",
      advice: analysis?.advice ?? "Avoid mutating protected OS roots.",
    };
    session.operationControls.lastShellBlocker = report;
    return fail("shell_command", formatShellPolicyBlockReport(report));
  }

  const safeGitBlock = analyzeSafeGitCommand(normalized);
  if (safeGitBlock) {
    const report = {
      command: normalized,
      pattern: safeGitBlock.pattern.source,
      reason: safeGitBlock.reason,
      matchedText: safeGitBlock.matchedText,
      source: session.activeSkill ? `skill ${session.activeSkill.name}` : "safe-git",
      advice: safeGitBlock.advice,
    };
    session.operationControls.lastShellBlocker = report;
    return fail("shell_command", formatShellPolicyBlockReport(report));
  }

  try {
    const result = runner(normalized, cwd.path, timeoutMs);
    if (result instanceof Promise) {
      return result.then((asyncResult) => formatShellCommandRunResult(asyncResult, timeoutMs))
        .catch((error) => fail("shell_command", `shell failed: ${error instanceof Error ? error.message : String(error)}`));
    }

    return formatShellCommandRunResult(result, timeoutMs);
  } catch (error) {
    return fail("shell_command", `shell failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function formatShellCommandRunResult(result: ShellCommandRunResult, timeoutMs: number): InternalToolResult {
  if (result.timedOut) {
    return fail("shell_command", `shell timed out after ${String(timeoutMs)}ms\n${result.output}`);
  }

  if (result.error && result.status === null) {
    return fail("shell_command", `shell failed: ${result.error.message}`);
  }

  if ((result.status ?? 0) !== 0) {
    return fail("shell_command", `shell exit ${String(result.status ?? 1)}\n${result.output}`);
  }

  return ok("shell_command", withNexsightRouteHint(result.output));
}

function normalizeShellCommandArguments(args: Record<string, unknown>): Record<string, unknown> {
  const normalized = args.cwd === undefined && args.workdir !== undefined
    ? { ...args, cwd: args.workdir }
    : args;
  if (normalized.timeoutMs !== undefined) {
    return normalized;
  }
  if (normalized.timeout !== undefined) {
    return { ...normalized, timeoutMs: normalized.timeout };
  }
  if (normalized.timeout_ms !== undefined) {
    return { ...normalized, timeoutMs: normalized.timeout_ms };
  }
  return normalized;
}

function resolveShellCommandCwd(session: RuntimeSession, args: Record<string, unknown>): { ok: true; path: string } | { ok: false; message: string } {
  const requested = asOptionalString(args.cwd);
  if (!requested) {
    return { ok: true, path: session.cwd };
  }
  const targetPath = resolveRepoPath(session, requested);
  const policyFailure = validateRepoToolPath(session, targetPath);
  if (policyFailure) {
    return { ok: false, message: policyFailure };
  }
  try {
    const stats = statSync(targetPath);
    if (!stats.isDirectory()) {
      return { ok: false, message: `${formatToolPath(session, targetPath)} is not a directory` };
    }
  } catch (error) {
    return { ok: false, message: formatToolError(targetPath, error) };
  }
  return { ok: true, path: targetPath };
}

function normalizeTodoToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  const items = Array.isArray(args.items) ? args.items : Array.isArray(args.todos) ? args.todos : null;
  if (!items || args.action !== undefined) {
    return args;
  }

  if (items.length === 0) {
    return { ...args, action: "clear" };
  }

  return args;
}

interface ShellCommandRunResult {
  status: number | null;
  timedOut: boolean;
  output: string;
  error: Error | null;
}

class ShellOutputAccumulator {
  private readonly chunks: string[] = [];

  append(chunk: unknown): void {
    if (chunk === null || chunk === undefined) {
      return;
    }
    const text = String(chunk).trimEnd();
    if (text.length > 0) {
      this.chunks.push(text);
    }
  }

  toCappedOutput(): string {
    const transcript = this.chunks.join("\n");
    return capShellOutput(transcript.length > 0 ? transcript : "(no output)");
  }
}

function runShellCommandWithOutputAccumulator(command: string, cwd: string, timeoutMs: number): ShellCommandRunResult {
  const outputAccumulator = new ShellOutputAccumulator();

  try {
    const stdout = execFileSync("bash", ["-lc", command], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
      },
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
    });
    outputAccumulator.append(stdout);
    return {
      status: 0,
      timedOut: false,
      output: outputAccumulator.toCappedOutput(),
      error: null,
    };
  } catch (error) {
    const result = error as NodeJS.ErrnoException & { status?: number | null; signal?: NodeJS.Signals | null; stdout?: string | Buffer; stderr?: string | Buffer };
    outputAccumulator.append(result.stdout);
    outputAccumulator.append(result.stderr);
    const timedOut = result.code === "ETIMEDOUT" || result.signal === "SIGTERM";
    return {
      status: typeof result.status === "number" ? result.status : null,
      timedOut,
      output: outputAccumulator.toCappedOutput(),
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

function runShellCommandWithOutputAccumulatorAsync(command: string, cwd: string, timeoutMs: number): Promise<ShellCommandRunResult> {
  const outputAccumulator = new ShellOutputAccumulator();
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], {
      cwd,
      env: {
        ...process.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => outputAccumulator.append(chunk));
    child.stderr?.on("data", (chunk) => outputAccumulator.append(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        status: null,
        timedOut,
        output: outputAccumulator.toCappedOutput(),
        error,
      });
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      resolve({
        status,
        timedOut: timedOut || signal === "SIGTERM",
        output: outputAccumulator.toCappedOutput(),
        error: null,
      });
    });
  });
}

function formatShellPolicyBlockReport(report: RuntimeSession["operationControls"]["lastShellBlocker"]): string {
  if (!report) {
    return "shell policy blocked command";
  }
  return [
    "shell policy blocked command",
    `reason: ${report.reason}`,
    `source: ${report.source}`,
    `pattern: ${report.pattern}`,
    report.matchedText ? `matched: ${report.matchedText}` : null,
    `command: ${report.command}`,
    `safer: ${report.advice}`,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function withNexsightRouteHint(output: string): string {
  const lines = output.split(/\r?\n/);
  return output.length > SHELL_MAX_CHARS / 2 || lines.length > SHELL_MAX_LINES / 2
    ? `${output}\n\nnexsight: large output; use nexsight_execute to summarize or nexsight_index to store/search it.`
    : output;
}

async function executeWebFetchTool(inputUrl: string): Promise<InternalToolResult> {
  const url = inputUrl.trim();
  if (!url) {
    return fail("web_fetch", "url required");
  }

  const safetyFailure = await validatePublicHttpUrl(url);
  if (safetyFailure) {
    return fail("web_fetch", safetyFailure);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEB_TIMEOUT_MS);
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html,text/plain,application/json;q=0.9,*/*;q=0.1",
        "user-agent": "nexagent/0.1 web_fetch",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return fail("web_fetch", `fetch failed ${String(response.status)} ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type") ?? "unknown";
    const text = await response.text();
    return ok("web_fetch", withNexsightRouteHint(capWebOutput(`url: ${response.url}\ncontent-type: ${contentType}\n\n${htmlToText(text)}`)));
  } catch (error) {
    return fail("web_fetch", `fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function executeWebSearchTool(query: string, limit: number): Promise<InternalToolResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    return fail("web_search", "query required");
  }

  const resultLimit = Math.max(1, Math.min(8, Math.floor(limit)));
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(trimmed)}`;
  const safetyFailure = await validatePublicHttpUrl(searchUrl);
  if (safetyFailure) {
    return fail("web_search", safetyFailure);
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WEB_TIMEOUT_MS);
    const response = await fetch(searchUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "accept": "text/html",
        "user-agent": "nexagent/0.1 web_search",
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return fail("web_search", `search failed ${String(response.status)} ${response.statusText}`);
    }

    const html = await response.text();
    const results = parseDuckDuckGoResults(html).slice(0, resultLimit);
    if (results.length === 0) {
      return ok("web_search", "(no results)");
    }
    return ok("web_search", results.map((result, index) => [
      `${String(index + 1)}. ${result.title}`,
      `   ${result.url}`,
      result.snippet ? `   ${result.snippet}` : "",
    ].filter(Boolean).join("\n")).join("\n\n"));
  } catch (error) {
    return fail("web_search", `search failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function executeArchivistSaveTool(
  session: RuntimeSession,
  summary: string,
  content?: string,
  tags?: string[],
  type?: string,
): Promise<InternalToolResult> {
  try {
    const result = await saveArchivistMemory(session, { summary, content, tags, type });
    return ok("archivist_save", `saved memory; entries=${String(result.entryCount)}\n${result.preview}`);
  } catch (error) {
    return fail("archivist_save", error instanceof Error ? error.message : String(error));
  }
}

function executeNexsightIndexTool(session: RuntimeSession, args: Record<string, unknown>): InternalToolResult {
  const source = asString(args.source, "");
  const content = asOptionalString(args.content);
  const inputPath = asOptionalString(args.path);
  if (inputPath) {
    const targetPath = resolveRepoPath(session, inputPath);
    const policyFailure = validateReadToolPath(session, targetPath);
    if (policyFailure) {
      return fail("nexsight_index", policyFailure);
    }
    return toToolResult("nexsight_index", indexNexsightFile(session, source || inputPath, targetPath));
  }
  return toToolResult("nexsight_index", indexNexsight(session, { source, content: content ?? "" }));
}

function executeNexsightExecuteTool(session: RuntimeSession, args: Record<string, unknown>): InternalToolResult {
  const command = asOptionalString(args.command ?? args.cmd);
  const code = asString(args.code ?? command ?? args.script, "");
  const requestedLanguage = normalizeNexsightLanguage(asOptionalString(args.language ?? args.lang));
  const language = requestedLanguage ?? inferNexsightLanguage(code, Boolean(command));
  return toToolResult("nexsight_execute", executeNexsight(session, {
    language,
    code,
    timeoutMs: asNumber(args.timeoutMs, 30_000),
  }));
}

async function executeNexsightExecuteToolAsync(session: RuntimeSession, args: Record<string, unknown>): Promise<InternalToolResult> {
  const command = asOptionalString(args.command ?? args.cmd);
  const code = asString(args.code ?? command ?? args.script, "");
  const requestedLanguage = normalizeNexsightLanguage(asOptionalString(args.language ?? args.lang));
  const language = requestedLanguage ?? inferNexsightLanguage(code, Boolean(command));
  return toToolResult("nexsight_execute", await executeNexsightAsync(session, {
    language,
    code,
    timeoutMs: asNumber(args.timeoutMs, 30_000),
  }));
}

function executeNexsightReadTool(session: RuntimeSession, args: Record<string, unknown>): InternalToolResult {
  const inputPath = asString(args.path, "");
  if (!inputPath.trim()) {
    return fail("nexsight_read", "path required");
  }
  const targetPath = resolveRepoPath(session, inputPath);
  const policyFailure = validateReadToolPath(session, targetPath);
  if (policyFailure) {
    return fail("nexsight_read", policyFailure);
  }
  return toToolResult("nexsight_read", readNexsight(session, {
    path: targetPath,
    mode: asOptionalString(args.mode),
    maxChars: asNumber(args.maxChars, 120_000),
  }));
}

function executeNexsightGatherTool(session: RuntimeSession, args: Record<string, unknown>): InternalToolResult {
  const inputPath = asOptionalString(args.root) ?? firstString(args.paths);
  if (inputPath) {
    const targetPath = resolveRepoPath(session, inputPath);
    const policyFailure = validateReadToolPath(session, targetPath);
    if (policyFailure) {
      return fail("nexsight_gather", policyFailure);
    }
  }
  return toToolResult("nexsight_gather", gatherNexsight(session, {
    root: inputPath,
    pattern: asOptionalString(args.pattern),
    query: asOptionalString(args.query),
    mode: asOptionalString(args.mode),
    limit: asNumber(args.limit, 24),
    maxCharsPerFile: asNumber(args.maxCharsPerFile, 40_000),
  }));
}

function isNexsightShellCall(args: Record<string, unknown>): boolean {
  const language = normalizeNexsightLanguage(asOptionalString(args.language ?? args.lang));
  return language === "shell" || Boolean(asOptionalString(args.command ?? args.cmd));
}

function normalizeNexsightLanguage(value?: string): string | undefined {
  const language = value?.trim().toLowerCase();
  if (!language) {
    return undefined;
  }
  if (language === "js" || language === "node") {
    return "javascript";
  }
  if (language === "py") {
    return "python";
  }
  if (language === "sh" || language === "bash") {
    return "shell";
  }
  return language;
}

function inferNexsightLanguage(code: string, hasCommand: boolean): string {
  if (hasCommand) {
    return "shell";
  }
  const trimmed = code.trim();
  if (/^(from\s+\S+\s+import\s+|import\s+(os|sys|json|pathlib|subprocess|re)\b|print\s*\(|for\s+\w+\s+in\s+|def\s+\w+\s*\()/m.test(trimmed)) {
    return "python";
  }
  if (/^(find|rg|grep|ls|cat|sed|awk|printf|git|python3?)\b/m.test(trimmed)) {
    return "shell";
  }
  return "javascript";
}

function executeNexsightBatchTool(session: RuntimeSession, args: Record<string, unknown>): InternalToolResult {
  const inputPath = asOptionalString(args.root);
  if (inputPath) {
    const targetPath = resolveRepoPath(session, inputPath);
    const policyFailure = validateReadToolPath(session, targetPath);
    if (policyFailure) {
      return fail("nexsight_batch", policyFailure);
    }
  }
  return toToolResult("nexsight_batch", batchIndexNexsight(session, {
    root: inputPath,
    pattern: asOptionalString(args.pattern),
    limit: asNumber(args.limit, 100),
  }));
}

async function executeArchivistCheckpointTool(session: RuntimeSession, reason?: string): Promise<InternalToolResult> {
  try {
    const result = await checkpointArchivistSession(session, reason);
    return ok("archivist_checkpoint", `saved checkpoint; entries=${String(result.entryCount)}\n${result.preview}`);
  } catch (error) {
    return fail("archivist_checkpoint", error instanceof Error ? error.message : String(error));
  }
}

async function executeLspSymbolsTool(session: RuntimeSession, inputPath: string): Promise<InternalToolResult> {
  try {
    const result = await summarizeLspSymbols(session, inputPath);
    return ok("lsp_symbols", result.output);
  } catch (error) {
    return fail("lsp_symbols", error instanceof Error ? error.message : String(error));
  }
}

async function executeLspDiagnosticsTool(session: RuntimeSession, inputPath: string): Promise<InternalToolResult> {
  try {
    const result = await summarizeLspDiagnostics(session, inputPath);
    return ok("lsp_diagnostics", result.output);
  } catch (error) {
    return fail("lsp_diagnostics", error instanceof Error ? error.message : String(error));
  }
}

async function executeLspNavigationTool(session: RuntimeSession, args: Record<string, unknown>): Promise<InternalToolResult> {
  try {
    const result = await summarizeLspNavigation(session, {
      operation: asString(args.operation, ""),
      filePath: asOptionalString(args.filePath ?? args.path),
      line: asNumber(args.line, 0),
      character: asNumber(args.character ?? args.char, 0),
      query: asOptionalString(args.query),
    });
    return ok("lsp_navigation", result.output);
  } catch (error) {
    return fail("lsp_navigation", error instanceof Error ? error.message : String(error));
  }
}

function findContentMatches(rootPath: string, pattern: string): string[] {
  const matches: string[] = [];
  const queue = [rootPath];
  const normalizedPattern = pattern.toLowerCase();

  while (queue.length > 0 && matches.length < 100) {
    const currentPath = queue.shift();
    if (!currentPath) {
      continue;
    }

    const stats = statSync(currentPath);
    if (stats.isDirectory()) {
      const entries = readdirSync(currentPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") {
          continue;
        }
        queue.push(path.join(currentPath, entry.name));
      }
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    const content = readFileSync(currentPath, "utf8");
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length && matches.length < 100; index += 1) {
      if (lines[index].toLowerCase().includes(normalizedPattern)) {
        matches.push(`${formatMatchPath(rootPath, currentPath)}:${index + 1}:${lines[index]}`);
      }
    }
  }

  return matches;
}

function findPathMatches(rootPath: string, pattern: string): string[] {
  const matches: string[] = [];
  const queue = [rootPath];
  const matcher = globToRegExp(pattern);

  while (queue.length > 0 && matches.length < 100) {
    const currentPath = queue.shift();
    if (!currentPath) {
      continue;
    }

    const stats = statSync(currentPath);
    if (stats.isDirectory()) {
      const entries = readdirSync(currentPath, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") {
          continue;
        }
        queue.push(path.join(currentPath, entry.name));
      }
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }

    const relativePath = path.relative(rootPath, currentPath).split(path.sep).join("/");
    if (matcher.test(relativePath)) {
      matches.push(relativePath);
    }
  }

  return matches;
}

function globToRegExp(globPattern: string): RegExp {
  const normalized = globPattern.trim().split(path.sep).join("/");
  let source = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const current = normalized[index];
    const next = normalized[index + 1];

    if (current === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (current === "*") {
      source += "[^/]*";
      continue;
    }
    if (current === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(current ?? "");
  }

  source += "$";
  return new RegExp(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
}

function hasRipgrep(): boolean {
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}

function firstString(value: unknown): string | undefined {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === "string" && item.trim().length > 0) : undefined;
}

function capShellOutput(output: string): string {
  const lines = output.split(/\r?\n/);
  const cappedLines = lines.slice(0, SHELL_MAX_LINES);
  let capped = cappedLines.join("\n");
  if (capped.length > SHELL_MAX_CHARS) {
    capped = `${capped.slice(0, SHELL_MAX_CHARS)}\n... output truncated ...`;
  } else if (lines.length > SHELL_MAX_LINES) {
    capped = `${capped}\n... output truncated ...`;
  }
  return capped;
}

function capDiffOutput(output: string): string {
  const lines = output.split(/\r?\n/);
  const cappedLines = lines.slice(0, DIFF_MAX_LINES);
  let capped = cappedLines.join("\n");
  if (capped.length > DIFF_MAX_CHARS) {
    capped = `${capped.slice(0, DIFF_MAX_CHARS)}\n... diff truncated ...`;
  } else if (lines.length > DIFF_MAX_LINES) {
    capped = `${capped}\n... diff truncated ...`;
  }
  return capped;
}

function readExistingFileForDiff(targetPath: string): string {
  try {
    const stats = statSync(targetPath);
    return stats.isFile() ? readFileSync(targetPath, "utf8") : "";
  } catch {
    return "";
  }
}

function formatEditToolOutput(session: RuntimeSession, targetPath: string, current: string, next: string, summary: string): string {
  const preview = buildPatchPreview(formatToolPath(session, targetPath), current, next);
  if (preview.trim().length === 0) {
    return summary;
  }
  const stats = countDiffLines(preview);
  return `${summary}\nEdited ${formatToolPath(session, targetPath)} (+${String(stats.added)} -${String(stats.removed)})\n${capDiffOutput(preview)}`;
}

function formatBatchEditDiff(session: RuntimeSession, currentByPath: Map<string, string>, nextByPath: Map<string, string>): string {
  const previews: string[] = [];
  for (const [targetPath, next] of nextByPath) {
    const current = currentByPath.get(targetPath) ?? "";
    const preview = buildPatchPreview(formatToolPath(session, targetPath), current, next);
    if (preview.trim().length > 0) {
      const stats = countDiffLines(preview);
      previews.push(`Edited ${formatToolPath(session, targetPath)} (+${String(stats.added)} -${String(stats.removed)})\n${preview}`);
    }
  }
  return previews.length > 0 ? capDiffOutput(previews.join("\n")) : "";
}

function countDiffLines(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      added += 1;
    } else if (line.startsWith("-")) {
      removed += 1;
    }
  }
  return { added, removed };
}

function capWebOutput(output: string): string {
  const normalized = output.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return normalized.length > WEB_MAX_CHARS ? `${normalized.slice(0, WEB_MAX_CHARS)}\n... web output truncated ...` : normalized;
}

async function validatePublicHttpUrl(inputUrl: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    return "invalid URL";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "only http and https URLs are allowed";
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    return "local host URLs are blocked";
  }

  if (isPrivateAddress(hostname)) {
    return "private network URLs are blocked";
  }

  try {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.some((address) => isPrivateAddress(address.address))) {
      return "private network URLs are blocked";
    }
  } catch {
    return `unable to resolve host: ${hostname}`;
  }

  return null;
}

function isPrivateAddress(value: string): boolean {
  const version = isIP(value);
  if (version === 4) {
    const parts = value.split(".").map((part) => Number.parseInt(part, 10));
    const [a = 0, b = 0] = parts;
    return a === 0
      || a === 10
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }
  if (version === 6) {
    return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:");
  }
  return false;
}

function htmlToText(value: string): string {
  return decodeHtmlEntities(value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " "));
}

function parseDuckDuckGoResults(html: string): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const resultRegex = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(html)) && results.length < 8) {
    results.push({
      title: htmlToText(match[2] ?? ""),
      url: normalizeDuckDuckGoUrl(decodeHtmlEntities(match[1] ?? "")),
      snippet: htmlToText(match[3] ?? ""),
    });
  }
  return results;
}

function normalizeDuckDuckGoUrl(value: string): string {
  try {
    const parsed = new URL(value, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : parsed.toString();
  } catch {
    return value;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/");
}

function ok(tool: InternalToolName, output: string): InternalToolResult {
  return { ok: true, tool, output };
}

function fail(tool: InternalToolName, output: string): InternalToolResult {
  return { ok: false, tool, output };
}

function toToolResult(tool: InternalToolName, result: { ok: boolean; output: string }): InternalToolResult {
  return { ok: result.ok, tool, output: result.output };
}

function pending(tool: InternalToolName, detail: string): InternalToolResult {
  return { ok: false, tool, output: `${tool} requires ${detail} execution path` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatToolError(targetPath: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `${targetPath}: ${message}`;
}

function formatToolPath(session: RuntimeSession, targetPath: string): string {
  const relativePath = path.relative(session.cwd, targetPath);
  if (relativePath.length === 0) {
    return ".";
  }
  return relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : targetPath;
}

function normalizeContentMatchLines(output: string, rootPath: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => normalizeContentMatchLine(line, rootPath))
    .join("\n");
}

function normalizePathMatchLines(output: string, rootPath: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => formatMatchPath(rootPath, line))
    .join("\n");
}

function normalizeContentMatchLine(line: string, rootPath: string): string {
  const match = line.match(/^(.+?):(\d+):(.*)$/);
  if (!match) {
    return line;
  }

  return `${formatMatchPath(rootPath, match[1] ?? "")}:${match[2]}:${match[3] ?? ""}`;
}

function formatMatchPath(rootPath: string, filePath: string): string {
  const relativePath = path.relative(rootPath, filePath);
  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return filePath;
  }
  return relativePath.split(path.sep).join("/");
}
