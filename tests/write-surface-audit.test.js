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
  digest: "d61024fce3c77e3ea2177d30e55bfcec3a87a3ff5494239853c1347b71d0a010",
  count: 609,
  by_surface: {
    "agent-ui-state": 40,
    "bridge-runtime": 94,
    "skill-runtime": 46,
    "generated-main": 166,
    "domain-and-maintenance-tools": 128,
    "native-weaver-vendor": 15,
    "gated-build-source": 118,
    "build-tooling": 2,
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
