"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, it } = require("./harness");
const { scanProductionWrites } = require("../tools/write-surface-audit");

// Updating this digest is a review action, not a mechanical test repair. Run
// `node tools/write-surface-audit.js`, identify every changed site in the
// write-path matrix, then replace the digest and counts together. The review
// authorizing this candidate fingerprint is:
// docs/audits/write-path-matrix-2026-11-05-market-candidate.md
const APPROVED = Object.freeze({
  digest: "cfa0a8e15d4be4705461fcf3b59e818d78e571c1d91a00a9c21880d74c5ba1ba",
  count: 610,
  by_surface: {
    "agent-ui-state": 40,
    "bridge-runtime": 94,
    "skill-runtime": 46,
    "generated-main": 166,
    "domain-and-maintenance-tools": 128,
    "native-weaver-vendor": 15,
    "gated-build-source": 118,
    "build-tooling": 3,
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
