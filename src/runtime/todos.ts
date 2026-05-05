import type { RuntimeSession } from "./session.js";

export type RuntimeTodoStatus = "pending" | "in_progress" | "completed" | "deleted";
export type RuntimeTodoAction = "create" | "update" | "list" | "get" | "delete" | "clear";

export interface RuntimeTodoTask {
  id: string;
  subject: string;
  description?: string;
  activeForm?: string;
  status: RuntimeTodoStatus;
  blockedBy: string[];
  owner?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeTodoState {
  tasks: RuntimeTodoTask[];
  nextId: number;
  updatedAt: string | null;
}

export interface RuntimeTodoToolArgs {
  action?: RuntimeTodoAction;
  id?: string;
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: RuntimeTodoStatus;
  blockedBy?: string[];
  addBlockedBy?: string[];
  removeBlockedBy?: string[];
  owner?: string;
  metadata?: Record<string, unknown>;
  includeDeleted?: boolean;
  items?: RuntimeTodoItem[];
  todos?: RuntimeTodoItem[];
}

interface RuntimeTodoItem {
  content?: string;
  text?: string;
  subject?: string;
  title?: string;
  task?: string;
  status?: RuntimeTodoStatus;
  activeForm?: string;
  active?: string;
  doing?: string;
  description?: string;
  detail?: string;
  blockedBy?: string[];
  owner?: string;
  metadata?: Record<string, unknown>;
}

const STATUS_ORDER: RuntimeTodoStatus[] = ["in_progress", "pending", "completed", "deleted"];
const VALID_STATUSES = new Set<RuntimeTodoStatus>(STATUS_ORDER);

export function createRuntimeTodoState(value?: Partial<RuntimeTodoState> | null): RuntimeTodoState {
  const tasks = Array.isArray(value?.tasks) ? value.tasks.map(normalizeTask).filter((task): task is RuntimeTodoTask => Boolean(task)) : [];
  const maxNumericId = tasks.reduce((max, task) => {
    const match = /^todo-(\d+)$/.exec(task.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  const nextId = typeof value?.nextId === "number" && Number.isFinite(value.nextId)
    ? Math.max(1, Math.floor(value.nextId))
    : maxNumericId + 1;
  return {
    tasks,
    nextId: Math.max(nextId, maxNumericId + 1),
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : null,
  };
}

export function executeTodoTool(session: RuntimeSession, args: Record<string, unknown>): { ok: boolean; tool: "todo"; output: string } {
  const listAlias = Array.isArray(args.items) ? args.items : Array.isArray(args.todos) ? args.todos : null;
  if (listAlias && args.action === undefined) {
    const result = replaceTodosFromItems(session.todos, listAlias);
    if (!result.ok) {
      return { ok: false, tool: "todo", output: result.output };
    }
    return { ok: true, tool: "todo", output: result.output };
  }

  const parsed = parseTodoArgs(args);
  const action = parsed.action ?? "list";
  const result = mutateTodos(session.todos, parsed, action);
  if (!result.ok) {
    return { ok: false, tool: "todo", output: result.output };
  }
  return { ok: true, tool: "todo", output: result.output };
}

export function formatTodosCommandOutput(state: RuntimeTodoState, mode = "active"): string {
  const includeDeleted = mode === "all" || mode === "deleted";
  const status = VALID_STATUSES.has(mode as RuntimeTodoStatus) ? mode as RuntimeTodoStatus : null;
  const tasks = sortedTodos(state.tasks)
    .filter((task) => includeDeleted || task.status !== "deleted")
    .filter((task) => status ? task.status === status : true);
  if (tasks.length === 0) {
    return "todos\nnone";
  }
  return [
    "todos",
    ...tasks.map((task) => formatTodoLine(task, true)),
  ].join("\n");
}

export function formatTodoOverlayRows(state: RuntimeTodoState, width: number): Array<{ key: string; text: string; fg: string }> {
  const active = sortedTodos(state.tasks).filter((task) => task.status === "in_progress" || task.status === "pending" || task.status === "completed");
  if (active.length === 0) {
    return [];
  }
  const visible = collapseOverlayTasks(active);
  return visible.map((task, index) => {
    if (task.id === "__more__") {
      return {
        key: `todo-more-${String(index)}`,
        text: fitTodoLine(task.subject, width),
        fg: "#a6adc8",
      };
    }
    return {
      key: `todo-${task.id}`,
      text: fitTodoLine(formatTodoLine(task, false), width),
      fg: task.status === "in_progress" ? "#f9e2af" : task.status === "completed" ? "#6c7086" : "#a6e3a1",
    };
  });
}

export function formatTodoPromptSummary(state?: RuntimeTodoState | null): string | null {
  if (!state) {
    return null;
  }
  const tasks = sortedTodos(state.tasks).filter((task) => task.status === "in_progress" || task.status === "pending");
  if (tasks.length === 0) {
    return null;
  }
  return tasks.slice(0, 12).map((task) => `${task.id} [${task.status}] ${task.activeForm || task.subject}`).join(" | ");
}

export function pruneFinishedTurnTodos(state: RuntimeTodoState): boolean {
  const active = state.tasks.filter((task) => task.status === "in_progress" || task.status === "pending");
  if (active.length === state.tasks.length) {
    return false;
  }
  state.tasks = active;
  state.updatedAt = new Date().toISOString();
  return true;
}

export function clearRuntimeTodos(state: RuntimeTodoState): boolean {
  if (state.tasks.length === 0) {
    return false;
  }
  state.tasks = [];
  state.updatedAt = new Date().toISOString();
  return true;
}

function mutateTodos(
  state: RuntimeTodoState,
  args: RuntimeTodoToolArgs,
  action: RuntimeTodoAction,
): { ok: boolean; output: string } {
  if (action === "clear") {
    state.tasks = [];
    state.updatedAt = new Date().toISOString();
    return { ok: true, output: "todos cleared" };
  }

  if (action === "list") {
    return { ok: true, output: formatTodosCommandOutput(state, args.includeDeleted ? "all" : "active") };
  }

  if (action === "create") {
    const subject = args.subject?.trim();
    if (!subject) {
      return { ok: false, output: "todo create requires subject" };
    }
    const now = new Date().toISOString();
    const task: RuntimeTodoTask = {
      id: nextTodoId(state),
      subject,
      description: cleanOptional(args.description),
      activeForm: cleanOptional(args.activeForm),
      status: args.status && args.status !== "deleted" ? args.status : "pending",
      blockedBy: uniqueIds(args.blockedBy ?? []),
      owner: cleanOptional(args.owner),
      metadata: sanitizeMetadata(args.metadata),
      createdAt: now,
      updatedAt: now,
    };
    const validation = validateTodoGraph([...state.tasks, task]);
    if (!validation.ok) {
      return validation;
    }
    state.tasks.push(task);
    state.updatedAt = now;
    return { ok: true, output: formatTodoLine(task, true) };
  }

  const task = findTodo(state, args.id);
  if (!task) {
    return { ok: false, output: `${action} requires valid id` };
  }

  if (action === "get") {
    return { ok: true, output: formatTodoDetail(task) };
  }

  const next = { ...task, blockedBy: [...task.blockedBy] };
  if (action === "delete") {
    next.status = "deleted";
  } else {
    if (args.subject !== undefined) {
      const subject = args.subject.trim();
      if (!subject) {
        return { ok: false, output: "todo subject cannot be empty" };
      }
      next.subject = subject;
    }
    if (args.description !== undefined) next.description = cleanOptional(args.description);
    if (args.activeForm !== undefined) next.activeForm = cleanOptional(args.activeForm);
    if (args.owner !== undefined) next.owner = cleanOptional(args.owner);
    if (args.metadata !== undefined) next.metadata = sanitizeMetadata(args.metadata);
    if (args.status && args.status !== task.status) {
      const transition = validateStatusTransition(task.status, args.status);
      if (!transition.ok) {
        return transition;
      }
      next.status = args.status;
    }
    if (args.blockedBy) next.blockedBy = uniqueIds(args.blockedBy);
    if (args.addBlockedBy) next.blockedBy = uniqueIds([...next.blockedBy, ...args.addBlockedBy]);
    if (args.removeBlockedBy) {
      const remove = new Set(uniqueIds(args.removeBlockedBy));
      next.blockedBy = next.blockedBy.filter((id) => !remove.has(id));
    }
  }

  next.updatedAt = new Date().toISOString();
  const tasks = state.tasks.map((candidate) => candidate.id === next.id ? next : candidate);
  const validation = validateTodoGraph(tasks);
  if (!validation.ok) {
    return validation;
  }
  Object.assign(task, next);
  state.updatedAt = next.updatedAt;
  return { ok: true, output: formatTodoLine(task, true) };
}

function parseTodoArgs(args: Record<string, unknown>): RuntimeTodoToolArgs {
  const action = typeof args.action === "string" ? args.action : undefined;
  const status = typeof args.status === "string" ? args.status : undefined;
  return {
    action: isTodoAction(action) ? action : undefined,
    id: typeof args.id === "string" ? args.id.trim() : undefined,
    subject: typeof args.subject === "string" ? args.subject : undefined,
    description: typeof args.description === "string" ? args.description : undefined,
    activeForm: typeof args.activeForm === "string" ? args.activeForm : undefined,
    status: isTodoStatus(status) ? status : undefined,
    blockedBy: stringArray(args.blockedBy),
    addBlockedBy: stringArray(args.addBlockedBy),
    removeBlockedBy: stringArray(args.removeBlockedBy),
    owner: typeof args.owner === "string" ? args.owner : undefined,
    metadata: args.metadata && typeof args.metadata === "object" && !Array.isArray(args.metadata) ? args.metadata as Record<string, unknown> : undefined,
    includeDeleted: args.includeDeleted === true,
    items: todoItems(args.items),
    todos: todoItems(args.todos),
  };
}

function replaceTodosFromItems(state: RuntimeTodoState, rawItems: unknown[]): { ok: boolean; output: string } {
  if (rawItems.length === 0) {
    state.tasks = [];
    state.updatedAt = new Date().toISOString();
    return { ok: true, output: "todos cleared" };
  }

  const parsed = rawItems.map(parseTodoItem).filter((item): item is RuntimeTodoItem => Boolean(item));
  if (parsed.length === 0) {
    return { ok: false, output: "todo items require subject" };
  }

  const now = new Date().toISOString();
  const tasks: RuntimeTodoTask[] = parsed.map((item, index) => ({
    id: `todo-${String(index + 1)}`,
    subject: todoItemSubject(item),
    description: cleanOptional(item.description ?? item.detail),
    activeForm: cleanOptional(item.activeForm ?? item.active ?? item.doing),
    status: item.status && item.status !== "deleted" ? item.status : "pending",
    blockedBy: uniqueIds(item.blockedBy ?? []),
    owner: cleanOptional(item.owner),
    metadata: sanitizeMetadata(item.metadata),
    createdAt: now,
    updatedAt: now,
  }));
  if (tasks.some((task) => !task.subject)) {
    return { ok: false, output: "todo subject cannot be empty" };
  }
  const validation = validateTodoGraph(tasks);
  if (!validation.ok) {
    return validation;
  }
  state.tasks = tasks;
  state.nextId = tasks.length + 1;
  state.updatedAt = now;
  return { ok: true, output: formatTodosCommandOutput(state, "active") };
}

function validateStatusTransition(from: RuntimeTodoStatus, to: RuntimeTodoStatus): { ok: boolean; output: string } {
  if (from === "deleted") {
    return { ok: false, output: "deleted todo is terminal" };
  }
  if (from === "completed" && to !== "deleted") {
    return { ok: false, output: "completed todo can only move to deleted" };
  }
  if (to === "deleted" || to === "completed") {
    return { ok: true, output: "" };
  }
  if ((from === "pending" && to === "in_progress") || (from === "in_progress" && to === "pending")) {
    return { ok: true, output: "" };
  }
  return { ok: false, output: `invalid todo transition ${from} -> ${to}` };
}

function validateTodoGraph(tasks: RuntimeTodoTask[]): { ok: boolean; output: string } {
  const ids = new Set(tasks.map((task) => task.id));
  for (const task of tasks) {
    if (task.blockedBy.includes(task.id)) {
      return { ok: false, output: `todo ${task.id} cannot block itself` };
    }
    for (const dependency of task.blockedBy) {
      if (!ids.has(dependency)) {
        return { ok: false, output: `todo ${task.id} blockedBy unknown id ${dependency}` };
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dep of byId.get(id)?.blockedBy ?? []) {
      if (visit(dep)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  for (const task of tasks) {
    if (visit(task.id)) {
      return { ok: false, output: "todo dependency cycle detected" };
    }
  }
  return { ok: true, output: "" };
}

function normalizeTask(value: unknown): RuntimeTodoTask | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Record<string, unknown>;
  const id = typeof task.id === "string" && task.id.trim() ? task.id.trim() : null;
  const subject = typeof task.subject === "string" && task.subject.trim() ? task.subject.trim() : null;
  if (!id || !subject) return null;
  const status = isTodoStatus(task.status) ? task.status : "pending";
  return {
    id,
    subject,
    description: typeof task.description === "string" && task.description.trim() ? task.description.trim() : undefined,
    activeForm: typeof task.activeForm === "string" && task.activeForm.trim() ? task.activeForm.trim() : undefined,
    status,
    blockedBy: uniqueIds(stringArray(task.blockedBy)),
    owner: typeof task.owner === "string" && task.owner.trim() ? task.owner.trim() : undefined,
    metadata: task.metadata && typeof task.metadata === "object" && !Array.isArray(task.metadata) ? task.metadata as Record<string, unknown> : undefined,
    createdAt: typeof task.createdAt === "string" ? task.createdAt : new Date(0).toISOString(),
    updatedAt: typeof task.updatedAt === "string" ? task.updatedAt : new Date(0).toISOString(),
  };
}

function sortedTodos(tasks: RuntimeTodoTask[]): RuntimeTodoTask[] {
  return [...tasks].sort((a, b) => {
    const status = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (status !== 0) return status;
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
}

function collapseOverlayTasks(tasks: RuntimeTodoTask[]): RuntimeTodoTask[] {
  if (tasks.length <= 12) return tasks;
  const completed = tasks.filter((task) => task.status === "completed");
  const active = tasks.filter((task) => task.status !== "completed");
  const keep = [...active, ...completed.slice(-Math.max(0, 11 - active.length))].slice(0, 11);
  return [...keep, {
    id: "__more__",
    subject: `... ${String(tasks.length - keep.length)} more todos hidden`,
    status: "pending",
    blockedBy: [],
    createdAt: "",
    updatedAt: "",
  }];
}

function formatTodoLine(task: RuntimeTodoTask, includeId: boolean): string {
  const marker = task.status === "completed" ? "[x]" : task.status === "in_progress" ? "[>]" : task.status === "deleted" ? "[-]" : "[ ]";
  const label = task.activeForm || task.subject;
  const deps = task.blockedBy.length > 0 ? ` blockedBy:${task.blockedBy.join(",")}` : "";
  return `${marker}${includeId ? ` ${task.id}` : ""} ${label}${deps}`;
}

function formatTodoDetail(task: RuntimeTodoTask): string {
  return [
    formatTodoLine(task, true),
    task.description ? `description: ${task.description}` : null,
    task.owner ? `owner: ${task.owner}` : null,
    `status: ${task.status}`,
    task.blockedBy.length > 0 ? `blockedBy: ${task.blockedBy.join(", ")}` : null,
  ].filter((line): line is string => Boolean(line)).join("\n");
}

function nextTodoId(state: RuntimeTodoState): string {
  const id = `todo-${String(state.nextId)}`;
  state.nextId += 1;
  return id;
}

function findTodo(state: RuntimeTodoState, id?: string): RuntimeTodoTask | null {
  if (!id) return null;
  return state.tasks.find((task) => task.id === id) ?? null;
}

function fitTodoLine(value: string, width: number): string {
  const clean = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ");
  return clean.length <= width ? clean : `${clean.slice(0, Math.max(0, width - 1))}...`;
}

function isTodoAction(value: unknown): value is RuntimeTodoAction {
  return value === "create" || value === "update" || value === "list" || value === "get" || value === "delete" || value === "clear";
}

function isTodoStatus(value: unknown): value is RuntimeTodoStatus {
  return value === "pending" || value === "in_progress" || value === "completed" || value === "deleted";
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function todoItems(value: unknown): RuntimeTodoItem[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map(parseTodoItem).filter((item): item is RuntimeTodoItem => Boolean(item));
}

function parseTodoItem(value: unknown): RuntimeTodoItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const item = value as Record<string, unknown>;
  const status = typeof item.status === "string" && isTodoStatus(item.status) ? item.status : undefined;
  return {
    content: typeof item.content === "string" ? item.content : undefined,
    text: typeof item.text === "string" ? item.text : undefined,
    subject: typeof item.subject === "string" ? item.subject : undefined,
    title: typeof item.title === "string" ? item.title : undefined,
    task: typeof item.task === "string" ? item.task : undefined,
    status,
    activeForm: typeof item.activeForm === "string" ? item.activeForm : undefined,
    active: typeof item.active === "string" ? item.active : undefined,
    doing: typeof item.doing === "string" ? item.doing : undefined,
    description: typeof item.description === "string" ? item.description : undefined,
    detail: typeof item.detail === "string" ? item.detail : undefined,
    blockedBy: stringArray(item.blockedBy),
    owner: typeof item.owner === "string" ? item.owner : undefined,
    metadata: item.metadata && typeof item.metadata === "object" && !Array.isArray(item.metadata) ? item.metadata as Record<string, unknown> : undefined,
  };
}

function todoItemSubject(item: RuntimeTodoItem): string {
  return (item.subject ?? item.content ?? item.text ?? item.task ?? item.title ?? "").trim();
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function cleanOptional(value: string | undefined): string | undefined {
  const clean = value?.trim();
  return clean ? clean : undefined;
}

function sanitizeMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const entries = Object.entries(value).filter(([key]) => key.trim().length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}
