import assert from "node:assert/strict";
import test from "node:test";

import { formatTurnStartIntent } from "../src/runtime/turn-intent.js";

test("formatTurnStartIntent summarizes questions instead of echoing them", () => {
  assert.equal(
    formatTurnStartIntent("What files have not been added for a commit and a commit message done?"),
    "Attempting: Checking git status and summarizing commit-ready changes",
  );
  assert.equal(
    formatTurnStartIntent("check memory for last action we did and resume"),
    "Attempting: Checking memory and recent handoff context before resuming work",
  );
  assert.equal(
    formatTurnStartIntent("Need to inspect new sentry logs and fix"),
    "Attempting: Checking Sentry for current errors and matching them to code fixes",
  );
});
