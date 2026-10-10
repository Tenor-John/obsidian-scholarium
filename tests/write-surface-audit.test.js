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
  digest: "7988e80632f3f38f907b8f9f497b77a6571d324b47fcab8bbd4008208b384546",
  count: 544,
  by_surface: {
    "agent-ui-state": 40,
    "bridge-runtime": 94,
    "skill-runtime": 46,
    "third-party-generated-bundle": 14,
    "generated-main": 150,
    "domain-and-maintenance-tools": 128,
    "native-weaver-vendor": 15,
    "gated-build-source": 55,
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
