# Dogfood Checklist

Purpose:
Use `nexagent` like real operator would. Find pain before planning `v1.3`.

## What dogfood means

Dogfood = use own product for real work.

Here:
- run real coding tasks through `nexagent`
- avoid toy prompts when possible
- record friction, confusion, failures, and missing powers

## Session setup

- start from real repo root
- confirm `npm test` and `npm run build` already green
- choose 3 to 5 realistic tasks
- keep short notes after each run

## Suggested task mix

### 1. Simple inspect task

Try:
- ask model to inspect file or explain bug source

Watch:
- did it use internal tools well?
- did output stay grounded in repo truth?

### 2. Writable fix task

Try:
- ask for small code change with targeted verification

Watch:
- did write/patch flow work cleanly?
- were approvals clear if enabled?
- did resulting diff stay surgical?

### 3. Shell-needed task

Try:
- ask for task that benefits from `rg`, `git`, or build/test command

Watch:
- did shell guard block needed work?
- was shell output readable and sufficient?
- did risk surface make sense?

### 4. Memory task

Try:
- save one useful lesson
- checkpoint one session
- ask later prompt that should retrieve it

Watch:
- was saved memory high-value?
- did retrieval help or distract?
- was read vs write lineage clear?

### 5. Control task

Try:
- enable approval mode
- queue steer
- cancel one guarded flow

Watch:
- were pending states obvious?
- did steer apply when expected?
- did cancel do what operator thought it would do?

## Questions to answer after each task

- What worked?
- What felt confusing?
- What felt slow?
- What felt unsafe?
- What capability was missing?
- Was runtime status enough to explain behavior?

## Severity labels

- `P0` blocked task or caused unsafe action
- `P1` major friction or confusing control behavior
- `P2` annoying but workable
- `P3` polish or wording issue

## Capture format

Use one flat note per issue:

- `Task:`
- `Expected:`
- `Actual:`
- `Severity:`
- `Likely area:`
- `Suggested fix:`

Active findings file:
- `.planning/DOGFOOD-FINDINGS.md`

Recommended workflow:
- append each finding there during testing
- group related findings before locking `v1.3`

## Exit criteria

Dogfood pass good enough when:
- at least 3 realistic tasks completed
- at least 1 writable task completed
- at least 1 shell-assisted task completed
- at least 1 memory save/retrieval path exercised
- approval/cancel/steer path exercised once
- top issues grouped into candidate `v1.3` phases
