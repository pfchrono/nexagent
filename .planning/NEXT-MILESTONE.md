# Next Milestone: v1.4 - Workspace UX and Runtime Surface Cleanup

Status: draft proposal

`v1.3` completed on 2026-04-26.

## Milestone goal

Turn current improved-but-still-rough TTY into intentionally designed operator console with real transcript/workspace hierarchy, stronger diagnostics surfaces, and cleaner runtime/UI boundaries.

## Why this milestone

`v1.3` fixed big runtime truth:
- live Codex HTTP path works
- steer/approval semantics stronger
- internal tool surface broader
- memory ranking less noisy
- TTY now workspace-first

But real operator pain still left:
- whole TTY still not at free-code / Hermes quality bar yet
- `/status`, `/provider`, `/tools`, `/memory` still read like raw dumps
- transcript still lacks real pane scrollback and collapsible verbose blocks
- approval flow works, but UI still blob instead of decision card
- statusline still underpowered compared to donor refs
- `src/cli.ts` still too monolithic for safe UI iteration
- runtime workflow still weak:
  model can claim work done before verification
  model still pauses after partial progress when user intent says continue until done
- `/skill` or `$skill` system does not exist yet
- `ask/turn progress` display still weak versus Hermes grouped stage model and codex-fresh progress clarity
- model/system prompt still needs stronger execution and truthfulness guidance
- future items still parked:
  `--yolo` mode
  image paste / multimodal attachments
  fuller compaction spec follow-through

## User-facing outcome

After `v1.4`, operator should be able to:
- use TTY that feels intentionally designed, not partially repaired
- read diagnostics fast without parsing raw state walls
- browse long transcript output without losing latest answer
- handle approvals from obvious UI affordances
- trust TTY input/editing/history more like real terminal app
- trust agent to continue working until done or blocked instead of stalling after partial updates
- iterate UI surfaces on thinner renderer/runtime boundaries

## Proposed phases

### Phase 43.1: TTY redesign pass

Deliver:
- deliberate transcript/result block styling
- clearer tool trace grouping
- stronger response emphasis and spacing
- better visual hierarchy across workspace, composer, and footer
- donor-informed but distinct `nexagent` terminal identity

Reason:
TTY now functional enough to redesign honestly instead of guessing from broken baseline.

### Phase 40: Diagnostics surface redesign

Deliver:
- compact default `/status`
- focused `/provider`, `/tools`, `/memory`
- grouped sections instead of flat dumps
- optional verbose/detail mode for deeper internals
- clearer command result block boundaries in transcript

Reason:
current diagnostics answer too many questions at once.

### Phase 40.1: Turn workflow and truthful execution hardening

Deliver:
- stronger continue-until-done runtime behavior
- explicit no-fake-implementation/testing guardrails
- better long-turn progress reporting
- cleaner blocked vs pending vs finished turn semantics

Reason:
current harness still looks alive while workflow semantics are weak underneath.

### Phase 41: Transcript pane scrollback and collapsed trace blocks

Deliver:
- bounded transcript/workspace scroll state
- newest answer stays anchored
- verbose command/tool output collapsed by default
- keyboard scroll controls
- real mouse-wheel support
- transcript selection/copy with copied char count feedback

Reason:
current workspace still overflows and loses latest useful answer.

### Phase 41.1: Picker and trace interaction polish

Deliver:
- richer history popup from `.nexagent/history.json`
- better `/model` chooser UI
- trace expand/collapse interaction polish
- visible scroll position and picker state polish

Reason:
interaction shell exists, but still feels like thin utility layer instead of finished operator console.

### Phase 42: Approval and control card UX

Deliver:
- dedicated pending approval card
- approve/deny affordances in workspace
- raw payload hidden behind expand
- explicit approved/rejected result blocks
- clearer cancel/steer surface while work active

Reason:
control semantics better, control presentation still weak.

### Phase 43: Composer and statusline polish

Deliver:
- stronger composer container
- better visible cursor and prompt history rendering
- preview-first autocomplete box
- statusline hybrid polish from donor ideas
- optional focus/minimal mode
- stronger overall TTY visual language so console feels closer in quality to free-code / Hermes without copying donor look

Reason:
current input works better, but still feels rough and visually weak.

### Phase 44: TUI/runtime module split

Deliver:
- split `src/cli.ts` along renderer/input/runtime-shell boundaries
- preserve headless truth while shrinking UI risk
- make future display modes and controls safer to evolve
- evaluate `ink` and `opencode` interaction models for medium-term TUI rewrite path

Reason:
dogfood showed monolith slowing safe polish.

### Phase 45: Future capability prep

Deliver:
- lock implementation spec for pending parked items:
  - `--yolo` guarded-no-approval launch mode
  - clipboard image paste / attachment chips for multimodal providers
  - remaining compaction/runtime UX follow-through
- promote candidate old out-of-scope systems into explicit next-milestone inputs:
  - skill system
  - hook execution engine
  - plugin/install workflow
  - command-family spec system
  - TUI framework evaluation
  - slash command and `$skill` registry for instruction routing
- implement smallest safe slice if one emerges clearly from refactor fallout

Reason:
keep future work honest and staged, not scattered across notes.

## Non-goals

- broad new provider matrix
- major GUI app
- unbounded memory or shell autonomy
- full mouse-first interface before keyboard path solid

## Acceptance bar

- operator can read main state without drowning in raw text
- transcript can grow without burying latest useful reply
- approval flow feels obvious, not discovered
- TTY code structure cleaner than current single-file sprawl
- future multimodal/yolo work has real staged contract

## Recommended order

1. TTY redesign pass
2. diagnostics cleanup
3. turn workflow hardening
4. scrollback and collapsed blocks
5. picker/trace polish
6. approval/control card
7. composer/statusline polish
8. module split
9. future-capability prep
