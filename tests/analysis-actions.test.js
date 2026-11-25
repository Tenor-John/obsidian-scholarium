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

  it("prefers unified plot tools while retaining confirmed host context", async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-analysis-action-"));
    const calls = [];
    const live = {
      runSkill: async () => { throw new Error("legacy runner must not be used for a complete recipe"); },
      plotTools: {
        render_plot: async (input, options) => {
          calls.push({ tool: "render_plot", input, options });
          return { status: "success", manifest_path: "Materials/_analysis/demo/plot-manifest.json", svg_path: "Materials/_analysis/demo/plot.svg" };
        },
        inspect_dataset: async (input) => {
          calls.push({ tool: "inspect_dataset", input });
          return { status: "success", dataset: { path: input.dataset_path }, columns: [] };
        },
      },
    };
    const plot = await registry.runAsync(vault, "sch-data-plot", {
      data_path: "Materials\\data.csv", x_column: "time", y_columns: ["signal"], plot_kind: "line", title: "Run 2",
      chart_style: { show_grid: false },
    }, { dryRun: false, confirmed: true, live });
    const audit = await registry.runAsync(vault, "sch-data-profile-audit", { data_path: "Materials/data.csv" }, { dryRun: false, confirmed: true, live });
    assert.eq(plot.result.status, "success");
    assert.eq(audit.result.status, "success");
    assert.deepEq(calls[0], {
      tool: "render_plot",
      input: {
        dataset_path: "Materials\\data.csv",
        recipe: { plot_kind: "line", x_column: "time", y_columns: ["signal"], chart_style: { show_grid: false }, title: "Run 2" },
      },
      options: { output_root: "Materials", researcher_confirmed: true },
    });
    assert.deepEq(calls[1], { tool: "inspect_dataset", input: { dataset_path: "Materials/data.csv", sample_rows: 0 } });
  });

  it("turns an Observation error into queue failure without a legacy write fallback", async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-analysis-action-"));
    let legacyWrites = 0;
    const live = {
      runSkill: async () => { legacyWrites += 1; return {}; },
      plotTools: {
        render_plot: async () => ({ status: "error", error: { code: "INVALID_PATCH", message: "bad recipe", retryable: false } }),
      },
    };
    let failure = null;
    try {
      await registry.runAsync(vault, "sch-data-plot", {
        data_path: "Materials/data.csv", x_column: "time", y_columns: ["signal"], plot_kind: "line",
      }, { dryRun: false, confirmed: true, live });
    } catch (error) { failure = error; }
    assert.ok(failure, "Observation error must reject the queue action");
    assert.match(failure.message, /bad recipe/);
    assert.eq(legacyWrites, 0);
  });
});
