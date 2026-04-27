# Summary 36-01

Phase 36 moved TTY from dashboard-first toward workspace-first operator view.

What changed:
- default TTY now centers latest reply, current task, recent work, and composer instead of persistent section dashboard
- composer now has visible cursor, left/right cursor motion, and up/down prompt history recall
- autocomplete stays explicit-accept on `Tab`, with separate preview line instead of forced mutation while typing
- verbose multiline runtime events now collapse in TTY transcript to first line plus hidden-line count

Files changed:
- `src/cli.ts`
- `test/cli.test.ts`

Verification:
- `bun test test/cli.test.ts`
- `npm run build`

Result:
- latest answer easier to spot
- prompt entry feels more like real input surface
- slash command dumps stop flooding TTY transcript by default

Truth boundary:
- no scrollback pane yet
- no mouse expand/collapse yet
- approval UI still text-first, not dedicated approve/deny card
