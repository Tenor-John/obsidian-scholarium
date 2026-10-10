"use strict";

const fs = require("fs");
const path = require("path");
const { describe, it, assert } = require("./harness");

const bridge = fs.readFileSync(
  path.join(__dirname, "..", "agent-canvas-demo", "bridge", "server.js"),
  "utf8",
);

describe("local Agent Bridge safety", () => {
  it("defaults a newly generated config to non-executing mode", () => {
    const start = bridge.indexOf("const value = {");
    const end = bridge.indexOf("};", start);
    const generatedConfig = bridge.slice(start, end);
    assert.match(generatedConfig, /allowExecution:\s*false/);
    assert.noMatch(generatedConfig, /allowExecution:\s*true/);
  });

  it("runs Research Weaver as a Node planner with an explicit rebuildable-view request", () => {
    assert.match(bridge, /'research-weaver':\s*\{\s*script:\s*'merge_and_build_graph\.js'/);
    assert.noMatch(bridge, /'research-weaver':[\s\S]{0,300}merge_and_build_graph\.py/);
    assert.match(bridge, /research-weaver[\s\S]{0,500}ordinary agent prose remains read-only/);
  });

  it("registers rss-refresh-and-score as real execution, and does not give it its own bypass of the shared execution gate", () => {
    assert.match(
      bridge,
      /'rss-refresh-and-score':\s*\{\s*script:\s*path\.join\([^\n]+request_and_wait\.js/,
    );
    assert.match(bridge, /rss-refresh-and-score[\s\S]{0,400}REAL execution/);
    // Every skill call flows through executableSkill(), which is only ever
    // invoked from the one route gated on `config.allowExecution &&
    // input.execute === true`. Assert that gate text still exists exactly
    // once and mentions nothing skill-specific, so a future edit can't carve
    // an exception for this (or any) skill without this test noticing.
    const gateMatches = bridge.match(
      /if \(!config\.allowExecution \|\| input\.execute !== true\) return send\(res, 409,/g,
    );
    assert.eq(gateMatches ? gateMatches.length : 0, 1, "expected exactly one shared execution gate");
  });
});
