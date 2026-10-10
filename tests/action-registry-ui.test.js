"use strict";
const fs = require("fs");
const path = require("path");
const { describe, it, assert } = require("./harness");
const bundle = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

describe("action and Radar UI wiring", () => {
  it("exposes an explicit, one-step Experiment transition command", () => {
    assert.match(bundle, /function schOpenExperimentTransition/);
    assert.match(bundle, /"experiment\.transition"/);
    assert.match(bundle, /dryRun: true/);
    assert.match(bundle, /confirmed: true/);
    assert.match(bundle, /id: "advance-research-experiment-state"/);
  });
  it("exports only Radar index data and gives feedback calibration a visible command", () => {
    assert.match(bundle, /function schOpenRadarVaultSync/);
    assert.match(bundle, /radarIndex\.sync/);
    assert.match(bundle, /id: "sync-radar-scores-to-research"/);
    assert.match(bundle, /write\.setText\("同步完成"\)/);
    assert.match(bundle, /id: "show-radar-feedback-benchmark"/);
    assert.match(bundle, /不会写出 API Key/);
  });
  it("does not register an action which automatically confirms evidence", () => {
    const registry = fs.readFileSync(path.join(__dirname, "..", "tools", "action-registry.js"), "utf8");
    assert.noMatch(registry, /evidence\.confirm|confirmEvidence|review_status:\s*["']confirmed/);
  });
});
