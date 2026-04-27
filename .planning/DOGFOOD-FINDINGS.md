# Dogfood Findings

Use this file to capture real operator pain during `v1.3` dogfood pass.

## Open findings

### DF-001 - Main TUI information architecture wrong

- Task:
  launch interactive `nexagent` TTY and inspect main workspace
- Expected:
  main view should behave like working console
  live prompt/composer, transcript, tool activity, and current task context should dominate
  config/diagnostic panels should be on-demand only
- Actual:
  main view is dominated by static config/state panels
  workspace feels like dashboard, not agent console
  useful live work area is too small and low-signal
- Severity:
  `P1`
- Likely area:
  TUI layout and information hierarchy
- Suggested fix:
  make default view workspace-first
  keep persistent chrome minimal
  move broad config/state surfaces behind `/status`, `/provider`, `/tools`, `/memory`, maybe `/config`
  reserve center area for:
  transcript
  current tool work
  prompt/composer
  current task/turn state

## Candidate design rules from findings

- default TUI = workspace, not dashboard
- persistent status should be compact and high-signal
- diagnostics should be pull-based, not always-on
- tool and model activity should read like live work log
- side panels should exist only if they help current task, not because data exists

### DF-002 - Statusline needs proper hybrid redesign

- Task:
  compare current status/footer behavior against stronger harnesses in `~/code/`
- Expected:
  one compact high-signal statusline with useful turn/runtime telemetry
  should feel closer to operator console footer, not debug leftovers
- Actual:
  current statusline works, but feels thin and underdesigned
  not enough polish, hierarchy, or signal density
  donor harnesses likely have stronger patterns to borrow
- Severity:
  `P2`
- Likely area:
  statusline and operator chrome
- Suggested fix:
  build hybrid from best donor traits
  combine free-code token/session surfaces with hermes-style turn progress discipline
  preserve `nexagent`-specific provider/approval/context truth

See:
- `.planning/notes/statusline-hybrid-direction.md`

### DF-003 - Live prompt can hang with no visible reply

- Task:
  send simple live prompt in interactive TTY
- Expected:
  short prompt should either return answer or fail clearly in bounded time
- Actual:
  TTY showed running provider request with no visible reply
  local repro also showed `codex exec` path stalling until external timeout
- Severity:
  `P0`
- Likely area:
  codex exec transport and live turn timeout/error handling
- Suggested fix:
  add harness-level timeout around `codex exec`
  surface timeout/error clearly in transcript and activity
  later investigate whether Codex CLI invocation shape or environment causes stall

Repro note:
- `timeout 15s node dist/cli.js run "reply with one word ok"` -> `EXIT:124`
- `timeout 15s codex exec --json --output-last-message ...` also timed out

### DF-004 - TUI not thin over runtime; too much local display truth

- Task:
  compare current `nexagent` TTY shape against donor `openrouter-create-agent`
- Expected:
  headless runtime should own turn/tool/control truth
  TUI should mainly render shared event/state snapshot
- Actual:
  TUI maintains local transcript/activity strings and section-oriented display shell
  provider/tool progress mostly reduced to coarse text lines
  no typed runtime event log for workspace to render
- Severity:
  `P1`
- Likely area:
  runtime/TUI boundary and event model
- Suggested fix:
  add typed runtime event stream/log
  emit events from provider/tool/control boundaries
  render workspace from shared event snapshot
  keep deep diagnostics behind slash commands instead of dashboard-first layout

See:
- `.planning/notes/openrouter-agent-donor-findings.md`

### DF-005 - TUI module boundary too monolithic for safe polish

- Task:
  compare current TUI shell against donor `openrouter-create-agent-tui`
- Expected:
  TUI should have cleaner split between renderer, input handling, config/display modes, and runtime wiring
- Actual:
  `src/cli.ts` carries renderer, raw input loop, prompt submission, transcript/activity state, statusline, and command shell together
  makes UI polish risky and slows iteration on display modes
- Severity:
  `P2`
- Likely area:
  TUI module structure
- Suggested fix:
  split renderer/input/config concerns
  add config-driven display variants
  keep plain fallback input mode

See:
- `.planning/notes/openrouter-agent-tui-donor-findings.md`

### DF-006 - Headless provider timeout still surfaces ugly raw transport noise

- Task:
  run simple headless prompt through `node dist/cli.js run "reply with one word ok"`
- Expected:
  bounded failure should read cleanly and explain what operator should do next
- Actual:
  timeout now fails instead of hanging forever, but output still includes raw Codex stderr/noise:
  `Reading prompt from stdin...`
  JSON thread events
  transport failure mixed with low-level noise
- Severity:
  `P1`
- Likely area:
  transport error presentation and stderr filtering
- Suggested fix:
  keep bounded timeout behavior
  suppress or normalize raw Codex CLI noise
  present one clean operator-facing timeout/error block

Repro note:
- `NEXAGENT_CODEX_TIMEOUT_MS=3000 node dist/cli.js run "reply with one word ok"`

### DF-007 - Composer placement and workspace framing feel clunky

- Task:
  use live TTY as main workspace
- Expected:
  prompt area should feel like intentional working surface
  composer should sit in clear, designed place with strong visual ownership
- Actual:
  prompt sits in generic `composer:` text block
  workspace framing feels cluttered and awkward
  main work area does not feel like real operator console
- Severity:
  `P1`
- Likely area:
  TTY workspace layout and composer presentation
- Suggested fix:
  redesign workspace around transcript/tool flow first
  give composer its own clear input region instead of inline label block

### DF-008 - Typing surface lacks designed editbox feel

- Task:
  type prompts in live TTY
- Expected:
  input should feel personal, deliberate, and visually distinct
  operator should know exactly where typing lives
- Actual:
  typing feels ugly and underdesigned
  input area does not feel like proper edit box or focused prompt region
- Severity:
  `P1`
- Likely area:
  input rendering and TTY composer design
- Suggested fix:
  add real composer container
  support at least one stronger styled input mode plus plain fallback

### DF-009 - Control-path dogfood blocked by broken live model turn

- Task:
  attempt `/steer` and `/cancel` evaluation during active turn
- Expected:
  live turn should run well enough to test operator controls
- Actual:
  live reply path still not healthy enough to exercise `/steer` and `/cancel` meaningfully
  control-path dogfood blocked behind transport/runtime issue
- Severity:
  `P0`
- Likely area:
  live provider execution reliability
- Suggested fix:
  restore reliable live turn first
  then resume control-path dogfood for steer/cancel/approval

### DF-010 - Statusline visibility and presence too weak

- Task:
  use TTY during real work and monitor footer/status
- Expected:
  statusline should be obvious, readable, and feel like core operator surface
  should compete with stronger donor harnesses like Hermes and free-code
- Actual:
  current statusline too low-visibility and underpowered
  does not feel central to operating runtime
- Severity:
  `P1`
- Likely area:
  statusline visual hierarchy and signal density
- Suggested fix:
  stronger hybrid footer
  better contrast/placement/hierarchy
  keep high-signal runtime truth visible without stealing workspace

### DF-011 - Minimal focus mode likely needed

- Task:
  consider narrower task-focused TTY mode during real use
- Expected:
  operator should have option for reduced-clutter workspace focused on active task
- Actual:
  current one-size layout leaves little path to focused minimal mode
- Severity:
  `P2`
- Likely area:
  TTY display modes and renderer configuration
- Suggested fix:
  add minimal/focus mode
  keep transcript, current tool flow, compact statusline, and composer
  push diagnostics and extra chrome out of primary view

### DF-012 - Autocomplete should preview before mutating prompt buffer

- Task:
  use prompt/file-path autocomplete during typing
- Expected:
  autocomplete should not force replacement unless operator explicitly accepts it
  suggestion should be previewed first in separate UI surface
- Actual:
  current model suggests more aggressive injection path than ideal
  better behavior would keep prompt text stable until explicit accept action like `Tab`
- Severity:
  `P1`
- Likely area:
  composer/autocomplete interaction design
- Suggested fix:
  show autocomplete suggestion in separate suggestion box or ghost-preview area
  only inject suggestion into prompt buffer on explicit accept
  keep raw typing path untouched otherwise

### DF-013 - Successful reply still too hard to see inside current TTY layout

- Task:
  run simple live prompt in TTY after Phase 31 live-turn fix
- Expected:
  once reply succeeds, operator should immediately see where answer landed
  transcript/workspace should make success obvious
- Actual:
  live turn did work, but TTY layout is clunky and disorganized enough that reply is hard to spot
  success is present, but not visually obvious
- Severity:
  `P1`
- Likely area:
  workspace layout, transcript hierarchy, and response emphasis
- Suggested fix:
  make successful assistant reply visually dominant in workspace
  reduce surrounding chrome
  separate transcript/work result area more clearly from diagnostics/sidebar

### DF-014 - Transcript mixes command output and assistant reply into hard-to-scan blob

- Task:
  ask model for current repo shape after running `/status`
- Expected:
  assistant reply should read as clear result block with obvious boundaries
  prior command output should not visually contaminate next assistant answer
- Actual:
  transcript now shows more content, but command output and assistant reply still blend together
  answer feels clipped, weakly wrapped, and hard to scan as one coherent response
- Severity:
  `P1`
- Likely area:
  transcript rendering, message boundaries, and workspace hierarchy
- Suggested fix:
  render assistant replies as distinct blocks
  separate command results from assistant messages
  improve multiline wrapping and spacing
  make latest answer visually dominant over older transcript lines

### DF-015 - `/status` visible now, but payload reads like raw state dump

- Task:
  run `/status` in TTY after reply-path and command-output visibility fixes
- Expected:
  status view should group high-signal fields, hide internals by default, and read like operator dashboard
- Actual:
  status output now appears, but it is long, flat, and chaotic
  transport internals, auth details, compaction fields, approval fields, and tool policy all dump into one block
  operator must parse too much low-level text to find simple state
- Severity:
  `P1`
- Likely area:
  status formatter, grouping, verbosity tiers, and workspace-first diagnostics model
- Suggested fix:
  split `/status` into compact default plus expanded detail modes
  group output into sections like repo, provider, context, controls, tools
  show operator-facing summary first
  move deep transport/auth internals behind optional expanded view

### DF-016 - `/provider` and `/tools` repeat raw-dump problem instead of focused diagnostics

- Task:
  run `/provider` and `/tools` inside TTY after `/status` recon
- Expected:
  each command should answer one question clearly
  `/provider` should summarize active model/transport/auth state
  `/tools` should summarize allowed tools, guard mode, and risky-operation policy
- Actual:
  both commands dump long flat text into transcript
  `/provider` mixes model, fallback, endpoint, adapter, auth, and mode in one blob
  `/tools` mixes roots, protected paths, shell guard internals, and tool list in one blob
  command boundaries also bleed together when run back-to-back
- Severity:
  `P1`
- Likely area:
  command formatter design, transcript block rendering, and compact-vs-verbose diagnostics policy
- Suggested fix:
  make each diagnostics command answer single operator question first
  add compact default summaries with optional expanded detail
  render command results as separate titled blocks
  avoid mixing consecutive command payloads into one undifferentiated transcript mass

### DF-017 - Workspace needs bounded scrollback and collapsible trace blocks

- Task:
  run `/memory` and `/compact` after prior diagnostics commands in TTY
- Expected:
  workspace should keep recent answer visible
  older output should remain reachable through scrollback
  verbose tool or command output should collapse by default instead of pushing reply area off-screen
- Actual:
  reply area keeps filling until latest useful content disappears above visible region
  operator cannot comfortably inspect older context inside workspace pane
  verbose command and compact output stays expanded, causing transcript sprawl
  current TTY offers no clear mouse-wheel or click-driven pane interaction for browsing long output
- Severity:
  `P1`
- Likely area:
  workspace pane model, scroll handling, transcript virtualization, and collapsible block rendering
- Suggested fix:
  make main workspace pane independently scrollable
  support keyboard and mouse-wheel scroll in transcript/work area
  render tool calls, command dumps, and long reasoning/progress traces as collapsed blocks by default
  allow explicit expand/collapse interaction for verbose entries
  keep newest assistant answer anchored and easy to spot even when history grows

### DF-018 - Approval state works, but pending action still reads like raw state blob

- Task:
  enable approval mode and request temp-file write in TTY
- Expected:
  pending approval should stand out as single obvious decision block
  operator should immediately see what action waits and what command to use next
- Actual:
  approval request does appear, but it is mixed into transcript/state text
  payload includes raw JSON-ish action detail and repeated state fields instead of clear approval card
  next-step affordance is implied, not visually obvious
- Severity:
  `P1`
- Likely area:
  control-state rendering, approval card design, and workspace action affordances
- Suggested fix:
  render pending approval as dedicated highlighted block
  show action summary first, raw payload only on expand
  display explicit approve/reject instructions in-place
  keep pending action sticky until resolved

### DF-019 - Approved write does not resume original write action correctly

- Task:
  approve pending temp-file write after approval request appears
- Expected:
  approving should execute original `write_file` action and create pending target file
- Actual:
  after approval, transcript reports `Done`, but pending file was not created
  follow-up trace shows `search_files`, not resumed `write_file`
  operator gets false-success signal for approved action
- Severity:
  `P0`
- Likely area:
  approval resume path, pending-action replay, and post-approval result reporting
- Suggested fix:
  on approve, resume exact blocked tool invocation instead of restarting loose model flow
  verify side effect before reporting success
  show explicit `approved -> write executed` or `approved -> write failed` outcome
- Resolution:
  fixed in active `v1.3` work slice by intercepting plain pending-approval replies like `approve`/`approved` and routing them to `/approval approve`
  verified by resuming exact pending `write_file` action and creating target file

### DF-020 - Input loop lacks core terminal affordances for mode switch, cursoring, and prompt history

- Task:
  continue operator dogfood after diagnostics, approval, and prompt-entry testing
- Expected:
  composer should feel like real terminal input surface
  operator should have fast mode switch, visible cursor, left/right movement, and prompt history navigation
- Actual:
  current TTY input area feels static and weak
  no dedicated quick mode switch for planning vs agent-work posture
  no obvious permission-mode toggle shortcut
  cursor visibility is too weak
  prompt editing/history expectations like left/right and up/down recall are either missing or not strong enough to trust
- Severity:
  `P1`
- Likely area:
  input controller, composer rendering, and operator control hotkey design
- Suggested fix:
  add explicit mode-switch shortcut, likely `Shift+Tab`, with clear visible state
  add permission toggle shortcut for ask-vs-dont-ask mode
  render stronger cursor indicator inside composer
  support left/right cursor motion and prompt-history traversal with up/down
