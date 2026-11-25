"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { describe, it } = require("./harness");
const { scanProductionWrites } = require("../tools/write-surface-audit");

// Updating this digest is a review action, not a mechanical test repair. Run
// `node tools/write-surface-audit.js`, identify every changed site in the
// write-path matrix, then replace the digest and counts together. The review
// authorizing this candidate fingerprint is:
// docs/audits/release-3.0.5-2026-11-25.md
const APPROVED = Object.freeze({
  digest: "7231e5ce40faccd8c6bd44d70352047cda155ab4e1db06b8c23c010dbb7815ad",
  count: 622,
  by_surface: {
    "agent-ui-state": 40,
    "bridge-runtime": 97,
    "skill-runtime": 46,
    "generated-main": 169,
    "domain-and-maintenance-tools": 128,
    "native-weaver-vendor": 15,
    "gated-build-source": 124,
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
