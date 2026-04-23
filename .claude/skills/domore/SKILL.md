---
name: domore
description: >-
  Execute a concrete task end-to-end like the do skill, while explicitly applying
  Karpathy-style guardrails: surface assumptions, prefer simplest solution, make
  only surgical changes, define verifiable success criteria, and validate before
  stopping.
metadata:
  short-description: >-
    Action-oriented execution with stricter simplicity and verification
    guardrails.
---

# DOMORE

Use this skill when the user asks you to actually carry out a task and you should apply stronger execution discipline while doing it.

## Inputs

- A task goal (feature, fix, refactor, investigation, or cleanup).
- Optional constraints (file targets, timebox, risk limits, review/test requirements).
- Optional context, if not already present in the thread.

## Core Behavior

1. Restate goal in one sentence.
2. State scope and success criteria in verifiable terms.
3. Surface assumptions and tradeoffs before major edits.
4. Make smallest code change that satisfies request.
5. Validate with targeted checks.
6. Review diff for simplicity, regressions, and missing tests before stopping.
7. Summarize what changed, what was verified, and what remains.

If required context is missing and risk is unclear, ask one narrow clarification before major edits.

## Karpathy Guardrails

### 1. Think Before Coding

- Do not assume silently.
- If multiple interpretations exist, name them.
- If simpler path exists, say so and prefer it.
- If something important is unclear, stop and ask.

### 2. Simplicity First

- Minimum code that solves requested problem.
- No speculative abstractions.
- No configurability not requested.
- No extra features "while here".
- If solution feels too large, simplify before continuing.

### 3. Surgical Changes

- Touch only files and lines needed for request.
- Match local style.
- Do not refactor unrelated code.
- Remove only dead code created by your own changes.
- Mention unrelated problems; do not fix them unless asked.

Test: every changed line should trace directly to user request.

### 4. Goal-Driven Execution

Turn request into explicit success checks.

Examples:
- Bug fix -> reproduce bug, change code, verify bug gone
- Validation change -> add targeted check/test, make it pass
- Refactor -> confirm behavior unchanged before and after

For multi-step tasks, write brief plan:

1. [step] -> verify: [check]
2. [step] -> verify: [check]
3. [step] -> verify: [check]

### 5. Review and Test Bar

- Before finishing, inspect own diff with hostile eye.
- Ask: simplest possible? any regression risk? any missing targeted test?
- If tests exist for changed area, run smallest relevant subset.
- If no test run, say why.
- If change is risky and untested, say so directly.

## Execution Loop

1. Inspect relevant files, patterns, and constraints.
2. Identify all touchpoints needed to satisfy goal.
3. State assumptions, risks, and simplest viable path.
4. Implement in small steps.
5. Run targeted tests or checks aligned to changed area.
6. Fix regressions immediately; if blocker remains, stop and report exact blocker.
7. Re-read changed files and confirm each file is necessary.
8. Before handing back, include:
   - commands run
   - files changed
   - validation performed
   - review findings or residual risks
   - expected follow-up work, if any

## Guardrails

- Prefer local minimal diffs.
- Do not make unrelated refactors.
- Do not stop after initial edits if a safe check is still possible.
- Do not stop before reviewing your own diff.
- Ask before destructive commands (`rm -rf`, force resets, branch rewrites, history edits).
- If no safe validation is available, say validation is pending.
- If you cannot explain why each changed file is necessary, you are changing too much.

## Example Output

- `Goal: fix Windows launch path`
- `Assumptions: using current repo build and existing toolchain`
- `Changed X`
- `Validation: python -m pytest tests/foo.py`
- `Review: no extra files touched; residual risk is Y`
- `Remaining: wire output read path`
