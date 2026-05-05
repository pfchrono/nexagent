import type { RuntimeSession } from "./session.js";

export const ASK_USER_TOOL_NAME = "ask_user_question";
export const MAX_QUESTIONNAIRE_QUESTIONS = 4;
export const MIN_QUESTIONNAIRE_OPTIONS = 2;
export const MAX_QUESTIONNAIRE_OPTIONS = 4;
export const MAX_QUESTIONNAIRE_HEADER_LENGTH = 12;
export const MAX_QUESTIONNAIRE_LABEL_LENGTH = 60;
export const RESERVED_QUESTIONNAIRE_LABELS = new Set(["Other", "Type something.", "Chat about this", "Next ->", "Next →"]);

export interface RuntimeQuestionnaireOption {
  label: string;
  description: string;
  preview?: string;
}

export interface RuntimeQuestionnaireQuestion {
  question: string;
  header: string;
  options: RuntimeQuestionnaireOption[];
  multiSelect?: boolean;
}

export interface RuntimeQuestionnaireAnswer {
  questionIndex: number;
  question: string;
  kind: "option" | "custom" | "chat" | "multi";
  answer: string | null;
  selected?: string[];
  notes?: string;
  preview?: string;
}

export interface RuntimeQuestionnaireResult {
  answers: RuntimeQuestionnaireAnswer[];
  cancelled: boolean;
  error?: RuntimeQuestionnaireError;
}

export type RuntimeQuestionnaireError =
  | "no_ui"
  | "no_questions"
  | "empty_options"
  | "too_many_questions"
  | "duplicate_question"
  | "duplicate_option_label"
  | "reserved_label";

export interface RuntimeQuestionnaireRequest {
  id: string;
  questions: RuntimeQuestionnaireQuestion[];
  answers: RuntimeQuestionnaireAnswer[];
  createdAt: string;
  response: RuntimeQuestionnaireResult | null;
}

export type QuestionnaireValidationResult = { ok: true } | { ok: false; error: RuntimeQuestionnaireError; message: string };

export function parseQuestionnaireQuestions(value: unknown): RuntimeQuestionnaireQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((raw) => {
    const record = isRecord(raw) ? raw : {};
    const options = Array.isArray(record.options)
      ? record.options.map((option) => {
        const optionRecord = isRecord(option) ? option : {};
        return {
          label: asString(optionRecord.label),
          description: asString(optionRecord.description),
          ...(typeof optionRecord.preview === "string" && optionRecord.preview.length > 0 ? { preview: optionRecord.preview } : {}),
        };
      })
      : [];
    return {
      question: asString(record.question),
      header: asString(record.header),
      options,
      ...(record.multiSelect === true ? { multiSelect: true } : {}),
    };
  });
}

export function validateQuestionnaire(questions: RuntimeQuestionnaireQuestion[]): QuestionnaireValidationResult {
  if (questions.length === 0) {
    return { ok: false, error: "no_questions", message: "Error: At least one question is required" };
  }
  if (questions.length > MAX_QUESTIONNAIRE_QUESTIONS) {
    return { ok: false, error: "too_many_questions", message: `Error: At most ${String(MAX_QUESTIONNAIRE_QUESTIONS)} questions are allowed per invocation` };
  }

  const seenQuestions = new Set<string>();
  for (const question of questions) {
    if (seenQuestions.has(question.question)) {
      return { ok: false, error: "duplicate_question", message: "Error: Question text must be unique within an invocation" };
    }
    seenQuestions.add(question.question);
  }

  for (const question of questions) {
    if (question.options.length < MIN_QUESTIONNAIRE_OPTIONS) {
      return { ok: false, error: "empty_options", message: `Error: Each question requires at least ${String(MIN_QUESTIONNAIRE_OPTIONS)} options` };
    }
    if (question.options.length > MAX_QUESTIONNAIRE_OPTIONS) {
      return { ok: false, error: "empty_options", message: `Error: Each question allows at most ${String(MAX_QUESTIONNAIRE_OPTIONS)} options` };
    }
    const seenLabels = new Set<string>();
    for (const option of question.options) {
      if (RESERVED_QUESTIONNAIRE_LABELS.has(option.label)) {
        return { ok: false, error: "reserved_label", message: `Error: Option label is reserved (${[...RESERVED_QUESTIONNAIRE_LABELS].join(", ")})` };
      }
      if (seenLabels.has(option.label)) {
        return { ok: false, error: "duplicate_option_label", message: "Error: Option labels must be unique within a question" };
      }
      seenLabels.add(option.label);
    }
  }

  return { ok: true };
}

export function createQuestionnaireRequest(questions: RuntimeQuestionnaireQuestion[]): RuntimeQuestionnaireRequest {
  return {
    id: `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    questions,
    answers: [],
    createdAt: new Date().toISOString(),
    response: null,
  };
}

export function formatQuestionnaireStatus(session: RuntimeSession): string {
  const request = session.operationControls.pendingQuestionnaire;
  if (!request) {
    return "ask: no pending question";
  }
  return [
    `ask: pending ${request.id}`,
    ...request.questions.flatMap((question, index) => formatQuestionBlock(request, question, index)),
    "commands: /ask <option#|text> | /ask answer <question#> <option#|1,2|text> | /ask submit | /ask cancel",
  ].join("\n");
}

export function applyQuestionnaireCommand(session: RuntimeSession, args: string[]): { ok: true; output: string; submitted: boolean } | { ok: false; message: string } {
  const request = session.operationControls.pendingQuestionnaire;
  if (!request) {
    return { ok: false, message: "no pending ask_user_question request" };
  }
  const [rawCommand, ...rest] = args;
  const command = (rawCommand ?? "status").toLowerCase();
  if (command === "status") {
    return { ok: true, output: formatQuestionnaireStatus(session), submitted: false };
  }
  if (command === "cancel") {
    request.response = { answers: request.answers, cancelled: true };
    return { ok: true, output: "ask canceled", submitted: true };
  }
  if (command === "submit") {
    const missing = firstMissingQuestionIndex(request);
    if (missing !== null) {
      return { ok: false, message: `question ${String(missing + 1)} unanswered` };
    }
    request.response = { answers: request.answers, cancelled: false };
    return { ok: true, output: formatQuestionnaireResponseText(request.response), submitted: true };
  }
  if (command === "answer" || command === "text" || command === "chat") {
    const questionIndex = Number.parseInt(rest[0] ?? "", 10) - 1;
    if (!Number.isInteger(questionIndex) || questionIndex < 0 || questionIndex >= request.questions.length) {
      return { ok: false, message: "usage: /ask answer <question#> <option#|1,2|text>" };
    }
    const value = rest.slice(1).join(" ").trim();
    if (!value) {
      return { ok: false, message: "answer value required" };
    }
    const answer = command === "chat"
      ? makeChatAnswer(request.questions[questionIndex], questionIndex, value)
      : makeAnswer(request.questions[questionIndex], questionIndex, value, command === "text");
    request.answers = upsertAnswer(request.answers, answer);
    return maybeSubmitAfterAnswer(request);
  }

  const index = firstMissingQuestionIndex(request) ?? 0;
  const value = args.join(" ").trim();
  if (!value) {
    return { ok: true, output: formatQuestionnaireStatus(session), submitted: false };
  }
  const answer = makeAnswer(request.questions[index], index, value, false);
  request.answers = upsertAnswer(request.answers, answer);
  return maybeSubmitAfterAnswer(request);
}

export function formatQuestionnaireResponseText(result: RuntimeQuestionnaireResult): string {
  if (result.cancelled) {
    return "User cancelled ask_user_question.";
  }
  return [
    "User answered ask_user_question:",
    ...result.answers.map((answer) => {
      const value = answer.kind === "multi"
        ? (answer.selected ?? []).join(", ")
        : answer.answer ?? "";
      const notes = answer.notes ? ` notes=${answer.notes}` : "";
      const preview = answer.preview ? ` preview=${answer.preview}` : "";
      return `${String(answer.questionIndex + 1)}. ${answer.question} -> ${value}${notes}${preview}`;
    }),
  ].join("\n");
}

function formatQuestionBlock(request: RuntimeQuestionnaireRequest, question: RuntimeQuestionnaireQuestion, index: number): string[] {
  const current = request.answers.find((answer) => answer.questionIndex === index);
  return [
    `${String(index + 1)}. [${question.header}] ${question.question}`,
    ...question.options.map((option, optionIndex) => `   ${String(optionIndex + 1)}. ${option.label} - ${option.description}`),
    current ? `   answer: ${current.kind === "multi" ? (current.selected ?? []).join(", ") : current.answer ?? ""}` : "   answer: pending",
  ];
}

function makeAnswer(question: RuntimeQuestionnaireQuestion, questionIndex: number, rawValue: string, forceText: boolean): RuntimeQuestionnaireAnswer {
  const value = rawValue.trim();
  if (question.multiSelect) {
    const selected = parseSelectionIndexes(value)
      .map((index) => question.options[index]?.label)
      .filter((label): label is string => Boolean(label));
    return {
      questionIndex,
      question: question.question,
      kind: "multi",
      answer: null,
      selected: selected.length > 0 ? selected : [value],
    };
  }
  const optionIndex = Number.parseInt(value, 10) - 1;
  const option = !forceText && Number.isInteger(optionIndex) ? question.options[optionIndex] : undefined;
  if (option) {
    return {
      questionIndex,
      question: question.question,
      kind: "option",
      answer: option.label,
      ...(option.preview ? { preview: option.preview } : {}),
    };
  }
  return {
    questionIndex,
    question: question.question,
    kind: "custom",
    answer: value,
  };
}

function makeChatAnswer(question: RuntimeQuestionnaireQuestion, questionIndex: number, value: string): RuntimeQuestionnaireAnswer {
  return {
    questionIndex,
    question: question.question,
    kind: "chat",
    answer: value,
  };
}

function maybeSubmitAfterAnswer(request: RuntimeQuestionnaireRequest): { ok: true; output: string; submitted: boolean } {
  const missing = firstMissingQuestionIndex(request);
  if (missing !== null) {
    return { ok: true, output: formatQuestionnaireStatusFromRequest(request), submitted: false };
  }
  request.response = { answers: request.answers, cancelled: false };
  return { ok: true, output: formatQuestionnaireResponseText(request.response), submitted: true };
}

function firstMissingQuestionIndex(request: RuntimeQuestionnaireRequest): number | null {
  for (let index = 0; index < request.questions.length; index += 1) {
    if (!request.answers.some((answer) => answer.questionIndex === index)) {
      return index;
    }
  }
  return null;
}

function formatQuestionnaireStatusFromRequest(request: RuntimeQuestionnaireRequest): string {
  return [
    `ask: pending ${request.id}`,
    ...request.questions.flatMap((question, index) => formatQuestionBlock(request, question, index)),
    "answer saved; continue answering remaining questions or /ask submit",
  ].join("\n");
}

function upsertAnswer(answers: RuntimeQuestionnaireAnswer[], answer: RuntimeQuestionnaireAnswer): RuntimeQuestionnaireAnswer[] {
  return [
    ...answers.filter((candidate) => candidate.questionIndex !== answer.questionIndex),
    answer,
  ].sort((left, right) => left.questionIndex - right.questionIndex);
}

function parseSelectionIndexes(value: string): number[] {
  return value
    .split(/[,\s]+/)
    .map((part) => Number.parseInt(part, 10) - 1)
    .filter((index) => Number.isInteger(index) && index >= 0);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
