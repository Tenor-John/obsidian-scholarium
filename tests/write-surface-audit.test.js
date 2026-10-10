"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, it } = require("./harness");
const { scanProductionWrites } = require("../tools/write-surface-audit");

// Updating this digest is a review action, not a mechanical test repair. Run
// `node tools/write-surface-audit.js`, identify every changed site in the
// write-path matrix, then replace the digest and counts together. The review
// authorizing this fingerprint is:
// docs/audits/write-path-matrix-2026-09-23-chat-persistence.md
//
// That review also covers the scanner itself: this file's sibling
// `tools/write-surface-audit.js` gained the `node-fs-open-write` primitive on
// 2026-09-23, because a tool that copied user data with `cpSync` and wrote a
// manifest with `openSync`+`writeSync` was reported as writing nothing at all.
const APPROVED = Object.freeze({
  digest: "31100f38794934398af9a7830051956ee17bcb6f176d9cbe0270e91864a8f511",
  count: 431,
  by_surface: {
    "agent-ui-state": 40,
    "bridge-runtime": 102,
    "skill-runtime": 46,
    "third-party-generated-bundle": 14,
    "generated-main": 118,
    "domain-and-maintenance-tools": 111,
  },
});

describe("production persistence-surface inventory", () => {
  const root = path.resolve(__dirname, "..");
  const audit = scanProductionWrites(root);

  it("has no persistence primitive outside a classified production surface", () => {
    assert.deepEqual(audit.unknown, []);
  });

  it("matches the reviewed write-surface fingerprint", () => {
    assert.equal(audit.digest, APPROVED.digest);
    assert.equal(audit.count, APPROVED.count);
    assert.deepEqual(audit.by_surface, APPROVED.by_surface);
  });
});
