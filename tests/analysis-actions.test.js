"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const registry = require("../tools/action-registry");

describe("agent-proposable Materials analysis actions", () => {
  it("are L1 async actions that preserve the registry confirmation gate", async () => {
    for (const name of ["sch-data-plot", "sch-data-profile-audit"]) {
      const policy = registry.describe(name);
      assert.eq(policy.level, "L1");
      assert.eq(policy.async, true);
      let threw = false;
      try { await registry.runAsync("/tmp", name, { data_path: "Materials/data.csv" }, { dryRun: false }); }
      catch (error) { threw = true; assert.match(error.message, /explicit_confirmation_required/); }
      assert.ok(threw, `${name} must require explicit confirmation`);
    }
  });

  it("only validates input during a no-live-context dry run", async () => {
    const manifest = await registry.runAsync("/tmp", "sch-data-plot", { data_path: "Materials/data.csv" }, { dryRun: true });
    assert.eq(manifest.result.mode, "dry_run_no_live_context");
  });

  it("forwards bounded, structured inputs to the existing Bridge Skill runner", async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-analysis-action-"));
    const calls = [];
    const live = { runSkill: async (name, input) => { calls.push({ name, input }); return { manifest: { skill: name } }; } };
    const plot = await registry.runAsync(vault, "sch-data-plot", {
      data_path: "Materials/data.csv", x_column: "time", y_columns: ["signal"], plot_kind: "line", title: "Run 1",
    }, { dryRun: false, confirmed: true, live, now: "2026-08-17T00:00:00.000Z" });
    const audit = await registry.runAsync(vault, "sch-data-profile-audit", { data_path: "Materials/data.csv" }, { dryRun: false, confirmed: true, live, now: "2026-08-17T00:00:01.000Z" });
    assert.deepEq(calls, [
      { name: "sch-data-plot", input: { data_path: "Materials/data.csv", x_column: "time", y_columns: ["signal"], plot_kind: "line", title: "Run 1" } },
      { name: "sch-data-profile-audit", input: { data_path: "Materials/data.csv" } },
    ]);
    assert.eq(plot.result.manifest.skill, "sch-data-plot");
    assert.eq(audit.result.manifest.skill, "sch-data-profile-audit");
  });
});
