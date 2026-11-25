"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const contract = require("../plot-tool-contract.js");
const { createPlotToolRuntime } = require("../bridge/plot-tool-runtime.js");

function baseManifest(overrides = {}) {
  const path = "Materials/_analysis/rates-v1/plot-manifest.json";
  return {
    skill: "sch-data-plot",
    created_at: "2026-11-10T00:00:00.000Z",
    source: { path: "Materials/rates.csv", sha256: "a".repeat(64) },
    plot: {
      kind: "line", title: "Rates", x_column: "time", y_columns: ["CO", "CH4"],
      chart_style: {
        theme: "publication", show_grid: true, legend: "bottom", x_range: null, y_range: null,
        series_colors: {}, annotations: [], spines: { top: false, right: false },
      },
      layout: { requested_tick_count: 10, rendered_tick_count: 6, title_lines: 1, legend_rows: 1 },
    },
    revision: { mode: "new" },
    outputs: [
      "Materials/_analysis/rates-v1/plot.svg",
      "Materials/_analysis/rates-v1/plot-report.md",
      path,
    ],
    ...overrides,
  };
}
function runtimeHarness() {
  const calls = [];
  let current = baseManifest();
  const runtime = createPlotToolRuntime({
    async runSkill(name, input) {
      calls.push({ name, input });
      if (name === "sch-data-profile-audit") return { manifest: {
        skill: name,
        input: { path: input.data_path, rows: 3, columns: 3, encoding: "UTF-8", delimiter: "," },
        columns: [
          { name: "time", inferred_type: "numeric" },
          { name: "CO", inferred_type: "numeric" },
          { name: "CH4", inferred_type: "numeric" },
        ],
      } };
      const isRevision = Boolean(input.target_manifest_path);
      const version = input.plot_contract.version;
      const directory = `Materials/_analysis/rates-v${version}`;
      const manifestPath = `${directory}/plot-manifest.json`;
      current = baseManifest({
        created_at: `2026-11-10T00:00:0${version}.000Z`,
        source: { path: input.data_path, sha256: "a".repeat(64) },
        plot: {
          ...current.plot,
          kind: input.plot_kind,
          title: input.title || "Rates",
          x_column: input.x_column,
          y_columns: input.y_columns,
          chart_style: input.chart_style,
          layout: { requested_tick_count: 10, rendered_tick_count: 6, title_lines: 2, legend_rows: 1 },
        },
        plot_contract: {
          ...input.plot_contract,
          plot_id: input.plot_contract.plot_id || manifestPath,
          manifest_id: manifestPath,
        },
        revision: { mode: input.save_mode, target_manifest_path: input.target_manifest_path || null },
        outputs: [`${directory}/plot.svg`, `${directory}/plot-report.md`, manifestPath],
      });
      // Simulate a Windows runner returning backslashes. Observation must still
      // expose only normalized Vault IDs.
      current.outputs = current.outputs.map((entry) => entry.replace(/\//g, "\\"));
      return { manifest: current };
    },
    async readManifest() { return current; },
    async listManifests() { return [{ manifest: current, manifest_id: "Materials/_analysis/rates-v1/plot-manifest.json" }]; },
  });
  return { runtime, calls, getCurrent: () => current };
}

test("Vault IDs normalize Windows separators and series IDs round-trip without loss", () => {
  const id = "Materials\\_analysis\\demo\\plot-manifest.json";
  assert.equal(contract.normalizeManifestId(id), "Materials/_analysis/demo/plot-manifest.json");
  for (const column of ["CO", "CH4 mmol", "信号:A/B", "series:already"]) {
    assert.equal(contract.columnForSeriesId(contract.seriesIdForColumn(column)), column);
  }
});

test("render_plot returns a compact Observation with exact series mapping and warnings", async () => {
  const { runtime, calls } = runtimeHarness();
  const observation = await runtime.execute({
    name: "render_plot",
    arguments: {
      dataset_path: "Materials\\rates.csv",
      recipe: { plot_kind: "line", x_column: "time", y_columns: ["CO", "CH4"], chart_style: { show_grid: false } },
    },
  }, { researcher_confirmed: true });
  assert.equal(observation.status, "success", observation.error && observation.error.message);
  assert.equal(observation.current_version, 1);
  assert.equal(observation.manifest_path, "Materials/_analysis/rates-v1/plot-manifest.json");
  assert.equal(observation.audit.dataset_readonly, true);
  assert.deepEqual(observation.manifest_summary.series_list.map((entry) => entry.id), ["series:CO", "series:CH4"]);
  assert.equal(observation.column_mapping.status, "verified");
  assert.ok(observation.warnings.some((entry) => entry.code === "TICK_CROWDED"));
  assert.ok(observation.warnings.some((entry) => entry.code === "TITLE_WRAPPED"));
  assert.equal("plot" in observation.manifest_summary, false, "Observation must not contain the full Manifest");
  assert.equal(calls[0].name, "sch-data-profile-audit");
  assert.equal(calls[1].input.data_path, "Materials/rates.csv");
});

test("revise_plot applies only a bounded incremental patch and generates v2", async () => {
  const { runtime, calls } = runtimeHarness();
  const observation = await runtime.execute({
    name: "revise_plot",
    arguments: {
      target_manifest_id: "Materials\\_analysis\\rates-v1\\plot-manifest.json",
      base_version: 1,
      revision_reason: "Hide grid and recolor CO",
      patch: {
        chart_style: { spines: { top: true } },
        series_updates: [{ id: "series:CO", color: "#E67E22" }],
        annotations_upsert: [{ id: "peak", type: "vline", value: 12.4, label: "Peak" }],
      },
    },
  }, { researcher_confirmed: true });
  assert.equal(observation.status, "success", observation.error && observation.error.message);
  assert.equal(observation.current_version, 2);
  assert.equal(observation.plot_id, "Materials/_analysis/rates-v1/plot-manifest.json", "plot_id stays pinned to the lineage root");
  assert.equal(observation.audit.parent_version, 1);
  const input = calls.at(-1).input;
  assert.equal(input.chart_style.show_grid, true, "unmentioned style fields survive");
  assert.deepEqual(input.chart_style.spines, { top: true, right: false });
  assert.equal(input.chart_style.series_colors.CO, "#e67e22");
  assert.equal(input.chart_style.annotations[0].id, "peak");
  assert.equal(input.target_manifest_path, "Materials/_analysis/rates-v1/plot-manifest.json");
  assert.equal(observation.manifest_summary.series_list.find((entry) => entry.id === "series:CO").color, "#e67e22");
});

test("version conflicts fail before the renderer and cannot overwrite", async () => {
  const { runtime, calls } = runtimeHarness();
  const observation = await runtime.execute({
    name: "revise_plot",
    arguments: {
      target_manifest_id: "Materials/_analysis/rates-v1/plot-manifest.json",
      base_version: 2,
      revision_reason: "Stale edit",
      patch: { chart_style: { show_grid: false } },
    },
  }, { researcher_confirmed: true, researcher_save_mode: "overwrite" });
  assert.equal(observation.status, "error");
  assert.equal(observation.error.code, "VERSION_CONFLICT");
  assert.equal(observation.current_version, 1);
  assert.equal(calls.length, 0);
});

test("LLM overwrite and full-Manifest/data-mapping patches are rejected", async () => {
  const { runtime, calls } = runtimeHarness();
  const base = {
    target_manifest_id: "Materials/_analysis/rates-v1/plot-manifest.json",
    base_version: 1,
    revision_reason: "Unsafe edit",
    patch: { chart_style: { show_grid: false } },
  };
  const overwrite = await runtime.execute({ name: "revise_plot", arguments: { ...base, save_mode: "overwrite" } }, { researcher_confirmed: true });
  assert.equal(overwrite.error.code, "OVERWRITE_REQUIRES_RESEARCHER");
  const mapping = await runtime.execute({ name: "revise_plot", arguments: { ...base, patch: { y_columns: ["CH4"] } } }, { researcher_confirmed: true });
  assert.equal(mapping.error.code, "INVALID_INPUT");
  assert.equal(calls.length, 0);
});

test("writes require host confirmation and legacy adapters preserve old result fields", async () => {
  const { runtime, calls } = runtimeHarness();
  const pending = await runtime.execute({
    name: "render_plot",
    arguments: { dataset_path: "Materials/rates.csv", recipe: { plot_kind: "line", x_column: "time", y_columns: ["CO"] } },
  }, {});
  assert.equal(pending.status, "needs_user_confirmation");
  assert.equal(calls.length, 0);
  const legacy = contract.legacyRenderToolCall({ data_path: "Materials/rates.csv", plot_kind: "line", x_column: "time", y_columns: ["CO"], chart_style: {} });
  const rendered = await runtime.execute(legacy, { researcher_confirmed: true });
  const result = contract.toLegacyResult(rendered);
  assert.equal(result.svg_path, rendered.svg_path);
  assert.equal(result.manifest_path, rendered.manifest_path);
  assert.equal(result.observation, rendered);
});
