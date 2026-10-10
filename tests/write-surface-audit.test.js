"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, it } = require("./harness");
const { scanProductionWrites } = require("../tools/write-surface-audit");

// Updating this digest is a review action, not a mechanical test repair. Run
// `node tools/write-surface-audit.js`, identify every changed site in the
// write-path matrix, then replace the digest and counts together. The review
// authorizing this fingerprint is:
// docs/audits/write-path-matrix-2026-09-20-preview.md,
// docs/audits/write-path-matrix-2026-09-26-native-weaver.md and
// docs/audits/write-path-matrix-2026-10-10-preview4.md
const APPROVED = Object.freeze({
  digest: "1d57f88a8a96a4e1c51b453c96b9e9b0994afa242b14dabe8b35291a1d0c2c3f",
  count: 488,
  by_surface: {
    "agent-ui-state": 40,
    "bridge-runtime": 94,
    "skill-runtime": 47,
    "third-party-generated-bundle": 14,
    "generated-main": 150,
    "domain-and-maintenance-tools": 128,
    "native-weaver-vendor": 15,
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
