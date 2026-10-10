"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  ensureSafeWorkRoot,
  runtimeBootstrapStatus,
  releaseHashes,
  sameHashes,
} = require("../tools/run-release-lifecycle-rehearsals.js");

test("[L1] lifecycle rehearsal refuses a work root inside the repository", () => {
  const repo = path.resolve(__dirname, "..");
  assert.throws(() => ensureSafeWorkRoot(path.join(repo, "scratch"), repo), /仓库外/);
  assert.doesNotThrow(() => ensureSafeWorkRoot(path.join(path.parse(repo).root, "scholarium-a4-safe"), repo));
});

test("[L1] runtime bootstrap marker cannot be confused with legacy sidecar references", () => {
  const legacy = runtimeBootstrapStatus(Buffer.from("agent-canvas-demo ketcher.js", "utf8"));
  assert.equal(legacy.integrated, false);
  assert.deepEqual(legacy.legacySidecarReferences, ["agent-canvas-demo", "ketcher.js"]);

  const wired = runtimeBootstrapStatus(Buffer.from("schema=scholarium-runtime-pack/1", "utf8"));
  assert.equal(wired.integrated, true);
});

test("[L1] lifecycle release hash comparison requires all three release files", () => {
  const release = {
    files: {
      "main.js": Buffer.from("main"),
      "manifest.json": Buffer.from("manifest"),
      "styles.css": Buffer.from("styles"),
    },
  };
  const hashes = releaseHashes(release);
  assert.equal(sameHashes({ ...hashes }, hashes), true);
  assert.equal(sameHashes({ ...hashes, "main.js": "drift" }, hashes), false);
});
