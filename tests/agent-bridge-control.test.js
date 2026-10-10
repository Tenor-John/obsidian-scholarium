"use strict";

/**
 * RETIRED 2026-08-14. This file used to test the bespoke
 * agent-requests/ + schAgentRequestsDir/schRunAgentAction/schPollAgentRequests
 * mechanism (a single combined "refresh_and_score" action, its own
 * request/processing/result file protocol under the plugin's own folder).
 *
 * Per an explicit product decision, that mechanism has been unified onto the
 * Scholarium action control plane's single queue (Research/_runs/queue/,
 * tools/bridge-action-queue.js) and its single consumer (main.js's
 * schPollScholariumQueue). The old symbols this file used to assert the
 * presence of no longer exist in main.js by design — see
 * tests/scholarium-queue-consumer.test.js (which asserts they are ABSENT)
 * and docs/bridge-control-plane.md for the full history.
 *
 * This file is kept as a placeholder (rather than deleted, since deleting a
 * file on the vault this way isn't available to the tool that wrote this)
 * so that a future edit reusing this filename sees why it was emptied,
 * instead of silently reintroducing the retired mechanism.
 */

const { describe, it, assert } = require("./harness");

describe("Agent Bridge control surface (retired 2026-08-14, superseded by the unified queue)", () => {
  it("no longer asserts the old per-request file-queue mechanism; see scholarium-queue-consumer.test.js", () => {
    assert.ok(true);
  });
});
