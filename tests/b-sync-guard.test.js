"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const guard = require("../tools/check-b-sync.js");

test("[L1] B-sync guard rejects a main.js hot patch without a handoff trailer", () => {
  const missing = guard.auditCommits([
    { hash: "abc", touchesMain: true, message: "fix: patch generated bundle" },
  ]);
  assert.deepEqual(missing.map((entry) => entry.hash), ["abc"]);
});

test("[L1] B-sync guard accepts an explicit symbol-level handoff", () => {
  const missing = guard.auditCommits([
    { hash: "abc", touchesMain: true, message: "fix: patch generated bundle\n\nB-sync: schEvidenceTools, createExperimentFromAgent\n" },
    { hash: "def", touchesMain: false, message: "docs: no bundle change" },
  ]);
  assert.deepEqual(missing, []);
});

test("[L1] the live branch has no unannounced main.js commit after adoption", () => {
  const commits = guard.readMainCommits();
  assert.deepEqual(guard.auditCommits(commits), []);
});
