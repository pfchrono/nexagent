# Phase 48: skill-command-baseline-skill-skill - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md; this log preserves alternatives considered.

**Date:** 2026-04-27
**Phase:** 48-skill-command-baseline-skill-skill
**Areas discussed:** `/skill` list layout, lookup sequence, unknown behavior, `$skill` args, persistence, safety confirmations

---

## `/skill` default list layout

| Option | Description | Selected |
|--------|-------------|----------|
| Compact table | Name, short description, source | ✓ |
| Grouped sections | Project/user/system grouped display | |
| Minimal names only | One-column name list | |

**User's choice:** compact table

---

## `/skill <name>` lookup policy

| Option | Description | Selected |
|--------|-------------|----------|
| Exact only | Strict lookup | |
| Exact -> alias -> prefix -> fuzzy | Deterministic staged resolver | ✓ |
| Fuzzy first | Convenience-first, less deterministic | |

**User's choice:** exact -> alias -> prefix -> fuzzy

---

## Unknown skill behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Hard error only | No recovery hints | |
| Error + top 3 closest + `/skill` hint | Guided recovery | ✓ |
| Auto-run closest | Implicit action | |

**User's choice:** error + top 3 closest + `/skill` hint

---

## `$skill` argument handling

| Option | Description | Selected |
|--------|-------------|----------|
| Pass raw tail args unchanged | No normalization | ✓ |
| Parse/normalize args | Rewrite before route | |
| Require quoted args | Strict quoting policy | |

**User's choice:** pass raw tail args unchanged

---

## Activation persistence

| Option | Description | Selected |
|--------|-------------|----------|
| Session only baseline | No cross-session persistence | ✓ |
| Session + optional save flag | Optional persistence | |
| Always persist globally | Cross-session by default | |

**User's choice:** session only baseline

---

## Safety confirmations

| Option | Description | Selected |
|--------|-------------|----------|
| No confirmation in baseline | Fast route | ✓ |
| Confirm every switch | Maximum guardrails | |
| Confirm only high-risk | Hybrid policy | |

**User's choice:** no confirmation in baseline

---

## the agent's Discretion

- Compact table width/truncation details.
- Fuzzy scoring internals with deterministic output.

## Deferred Ideas

- Persistent/global skill profiles.
- Risk-scoped confirmation policies.
- Rich interactive skill browser UX.
