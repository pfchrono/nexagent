---
phase: 47-image-attachment-pipeline-baseline
plan: 01
subsystem: "tty+provider"
tags: [attachments, multimodal, transport-gating, tui]
provides: [composer-attachment-queue, provider-image-payload, explicit-unsupported-errors]
affects: [src/cli.ts, src/provider.ts, src/tui/primitives.ts]
tech-stack:
  added: []
  patterns: [single-image-baseline, transport-gated-input, frame-diff-rendering]
key-files:
  created: []
  modified: [src/cli.ts, src/provider.ts, src/tui/primitives.ts]
key-decisions:
  - "Baseline supports one queued image attachment per prompt."
  - "Image attachments blocked on cli-exec with explicit remediation message."
  - "Native payload includes both image content and attachment metadata text."
  - "TUI render loop skips unchanged frames and avoids repeated full-screen clears."
duration: "implemented"
completed: 2026-04-27
---

# Phase 47 Summary

Implemented image attachment baseline from composer to provider payload with explicit transport gating.

## Accomplishments

- Added interactive commands:
  - `/attach <image-path>` queues one local image.
  - `/detach` clears queued image.
- Added image validation:
  - supported: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`
  - max size: `8MB`
- Added composer/footer metadata so operator sees queued image before send.
- Added provider request attachment typing and payload wiring:
  - `http-responses`: native input includes `input_image` + metadata text.
  - `codex-http`: native input includes `input_image` + metadata text.
- Added explicit failure for unsupported mode:
  - `cli-exec` returns actionable error to switch transport.

## Additional UX polish delivered in same pass

- Bottom key-hint line condensed to micro form.
- Reduced TUI flicker by:
  - entering alt screen only once per session render cycle,
  - removing per-frame full clear,
  - skipping terminal writes when frame is unchanged,
  - slowing spinner repaint interval slightly.

