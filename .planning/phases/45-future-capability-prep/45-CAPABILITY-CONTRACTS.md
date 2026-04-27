# Phase 45 Capability Contracts

Date: 2026-04-27  
Scope: convert parked future ideas into explicit, staged, low-risk contracts.

## 1) `--yolo` mode contract

Status: staged, not default.

Contract:
- CLI flag: `--yolo` at process start only.
- Behavior: disable interactive approval gate for guarded tools in current session.
- Safety floor still active:
  - destructive shell denylist remains enforced
  - repo path allowlist remains enforced
  - explicit action logging still required
- UI signal: persistent footer badge `YOLO ON`.
- Session boundary: does not persist unless explicitly saved in runtime config.

Smallest safe slice:
- Parse flag + set `operationControls.requireApprovalForGuarded=false` for session.
- Add statusline/footer badge + `/status` exposure.

## 2) Image paste / attachment contract

Status: provider-gated staged contract.

Contract:
- Input path:
  - pasted image from terminal integration OR explicit local file path
- Transport:
  - enabled only when active provider+mode supports image input
  - otherwise show explicit rejection with supported providers list
- Validation:
  - max file size bound
  - allowed mime types: png, jpg, webp
- UX:
  - composer shows attachment chip with filename + size
  - remove attachment shortcut before send

Smallest safe slice:
- Add attachment state to composer model.
- Add provider capability check + reject path.
- Include attachment metadata in provider request payload when supported.

## 3) `/skill` + `$skill` baseline contract

Status: minimal usable baseline required.

Contract:
- `/skill` command:
  - `/skill` list known installed skills
  - `/skill <name>` run selected skill with current prompt buffer as args
- `$skill` inline shorthand:
  - user prompt starting with `$name` maps to `/skill name ...`
- Error handling:
  - unknown skill => deterministic error + closest matches
- UI:
  - command response includes resolved skill path and execution mode

Smallest safe slice:
- Add skill registry read from local skill roots.
- Add command parser routing for `/skill` and `$name`.
- Add deterministic list/lookup output first (execution hook can remain thin).

## 4) Out-of-scope routing contract

Objective: avoid buried ideas.

Contract:
- Any deferred capability discovered during phase work must be routed into:
  - backlog (`999.x`) for exploratory ideas
  - next milestone candidate list for delivery-scoped work
- No hidden TODO-only parking for milestone-impacting items.
- Promotion commands:
  - `$gsd-add-backlog`
  - `$gsd-review-backlog`

Current routed item:
- `999.1` token-savior memory integration investigation.

## 5) Framework path note (`ink` / `opencode`)

Current decision:
- keep current TTY implementation path for this milestone.
- revisit framework migration only after contracts above have minimum runtime hooks.
