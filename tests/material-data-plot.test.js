"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { describe, it, assert } = require("./harness");

const root = path.join(__dirname, "..");
const bridge = fs.readFileSync(path.join(root, "agent-canvas-demo", "bridge", "server.js"), "utf8");
const skill = fs.readFileSync(path.join(root, "agent-canvas-demo", "skills", "sch-data-plot", "SKILL.md"), "utf8");
const plotter = path.join(root, "agent-canvas-demo", "skills", "sch-data-plot", "scripts", "generate_plot.py");
const profiler = path.join(root, "agent-canvas-demo", "skills", "sch-data-profile-audit", "scripts", "profile_audit.py");

function runPlot(payload, writeSource) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sch-data-plot-"));
  fs.mkdirSync(path.join(tmp, "Materials"));
  if (writeSource) writeSource(tmp);
  else fs.writeFileSync(path.join(tmp, "Materials", "rates.csv"), "time_min,co_rate,ch4_rate\n0,0,0\n10,2.1,0.4\n20,4.5,1.1\n", "utf8");
  const python = process.platform === "win32" ? "python.exe" : "python3";
  const result = spawnSync(python, [plotter, tmp, JSON.stringify(payload)], { encoding: "utf8" });
  return { tmp, result, manifest: result.status === 0 ? JSON.parse(result.stdout) : null };
}

describe("Material Library deterministic plotting", () => {
  it("registers an explicit, bounded plotting Skill", () => {
    assert.match(bridge, /'sch-data-plot':\s*\{\s*script:\s*'generate_plot\.py'/);
    assert.match(skill, /Materials\/_analysis/);
    assert.match(skill, /never rewrites the source dataset/i);
    assert.noMatch(skill, /execute AI-authored code/i);
    assert.match(bridge, /path\.join\(profile, '\.codex', 'skills'\)/);
    assert.match(bridge, /path\.join\(profile, '\.claude', 'skills'\)/);
    assert.match(bridge, /path\.join\(profile, '\.agents', 'skills'\)/);
  });

  it("creates a source-provenanced SVG/report without changing the raw CSV", () => {
    const output = runPlot({ data_path: "Materials/rates.csv", x_column: "time_min", y_columns: ["co_rate", "ch4_rate"], plot_kind: "line", title: "Rates" });
    assert.eq(output.result.status, 0, output.result.stderr);
    assert.eq(output.manifest.skill, "sch-data-plot");
    assert.match(output.manifest.source.sha256, /^[a-f0-9]{64}$/);
    assert.deepEq(output.manifest.writes, output.manifest.outputs);
    assert.eq(fs.readFileSync(path.join(output.tmp, "Materials", "rates.csv"), "utf8"), "time_min,co_rate,ch4_rate\n0,0,0\n10,2.1,0.4\n20,4.5,1.1\n");
    const svg = path.join(output.tmp, output.manifest.outputs.find((item) => item.endsWith("plot.svg")));
    const report = path.join(output.tmp, output.manifest.outputs.find((item) => item.endsWith("plot-report.md")));
    assert.match(fs.readFileSync(svg, "utf8"), /<svg/);
    assert.match(fs.readFileSync(report, "utf8"), /SHA-256/);
  });

  it("keeps distinct chart requests in distinct output directories", () => {
    const first = runPlot({ data_path: "Materials/rates.csv", x_column: "time_min", y_columns: ["co_rate"], plot_kind: "line" });
    const second = spawnSync(process.platform === "win32" ? "python.exe" : "python3", [plotter, first.tmp, JSON.stringify({ data_path: "Materials/rates.csv", x_column: "time_min", y_columns: ["ch4_rate"], plot_kind: "scatter" })], { encoding: "utf8" });
    assert.eq(second.status, 0, second.stderr);
    const next = JSON.parse(second.stdout);
    assert.notOk(first.manifest.outputs[0].split("/").slice(0, -1).join("/") === next.outputs[0].split("/").slice(0, -1).join("/"), "different chart choices must not overwrite an earlier plot");
  });

  it("persists a bounded visual recipe and versions a chart revision without touching measurements", () => {
    const first = runPlot({
      data_path: "Materials/rates.csv", x_column: "time_min", y_columns: ["co_rate"], plot_kind: "line", title: "Rates",
      chart_style: { theme: "soft", markers: "none", show_grid: false, line_width: 4 },
    });
    assert.eq(first.result.status, 0, first.result.stderr);
    assert.eq(first.manifest.plot.chart_style.theme, "soft");
    assert.eq(first.manifest.plot.chart_style.markers, "none");
    assert.eq(first.manifest.plot.chart_style.show_grid, false);
    assert.eq(first.manifest.plot.chart_style.line_width, 4);
    assert.deepEq(first.manifest.plot.chart_style.x_range, null);
    assert.deepEq(first.manifest.plot.chart_style.annotations, []);
    assert.deepEq(first.manifest.plot.chart_style.series_colors, {});
    const svg = fs.readFileSync(path.join(first.tmp, first.manifest.outputs.find((item) => item.endsWith("plot.svg"))), "utf8");
    assert.match(svg, /fill="#f8fafc"/);
    assert.match(svg, /stroke-width="4"/);
    assert.noMatch(svg, /class="grid"/);
    const raw = fs.readFileSync(path.join(first.tmp, "Materials", "rates.csv"), "utf8");
    const revised = spawnSync(process.platform === "win32" ? "python.exe" : "python3", [plotter, first.tmp, JSON.stringify({
      data_path: "Materials/rates.csv", x_column: "time_min", y_columns: ["co_rate"], plot_kind: "line", title: "Rates",
      chart_style: { theme: "publication", markers: "all", show_grid: true, line_width: 2.6 },
    })], { encoding: "utf8" });
    assert.eq(revised.status, 0, revised.stderr);
    const next = JSON.parse(revised.stdout);
    assert.notOk(first.manifest.outputs[0].split("/").slice(0, -1).join("/") === next.outputs[0].split("/").slice(0, -1).join("/"), "a visual revision must create a new chart version");
    assert.eq(fs.readFileSync(path.join(first.tmp, "Materials", "rates.csv"), "utf8"), raw);
  });

  it("overwrites only the selected plot version without creating another image directory", () => {
    const first = runPlot({
      data_path: "Materials/rates.csv", x_column: "time_min", y_columns: ["co_rate"], plot_kind: "line", title: "Initial",
      chart_style: { line_width: 2, show_grid: false },
    });
    assert.eq(first.result.status, 0, first.result.stderr);
    const analysis = path.join(first.tmp, "Materials", "_analysis");
    const beforeDirectories = fs.readdirSync(analysis).sort();
    const manifestRelative = first.manifest.outputs.find((item) => item.endsWith("plot-manifest.json"));
    const svgRelative = first.manifest.outputs.find((item) => item.endsWith("plot.svg"));
    const raw = fs.readFileSync(path.join(first.tmp, "Materials", "rates.csv"), "utf8");
    const revised = spawnSync(process.platform === "win32" ? "python.exe" : "python3", [plotter, first.tmp, JSON.stringify({
      data_path: "Materials/rates.csv", x_column: "time_min", y_columns: ["co_rate"], plot_kind: "scatter", title: "Overwritten",
      chart_style: { markers: "all", line_width: 5 }, save_mode: "overwrite", target_manifest_path: manifestRelative,
    })], { encoding: "utf8" });
    assert.eq(revised.status, 0, revised.stderr);
    const next = JSON.parse(revised.stdout);
    assert.deepEq(fs.readdirSync(analysis).sort(), beforeDirectories);
    assert.deepEq(next.outputs, first.manifest.outputs);
    assert.eq(next.revision.mode, "overwrite");
    assert.eq(next.plot.title, "Overwritten");
    assert.eq(next.plot.kind, "scatter");
    assert.match(fs.readFileSync(path.join(first.tmp, svgRelative), "utf8"), /Overwritten/);
    assert.eq(fs.readFileSync(path.join(first.tmp, "Materials", "rates.csv"), "utf8"), raw);
  });

  it("rejects overwrite targets outside analysis or belonging to another dataset", () => {
    const first = runPlot({ data_path: "Materials/rates.csv", x_column: "time_min", y_columns: ["co_rate"], plot_kind: "line" });
    assert.eq(first.result.status, 0, first.result.stderr);
    fs.writeFileSync(path.join(first.tmp, "plot-manifest.json"), JSON.stringify(first.manifest), "utf8");
    const rejected = spawnSync(process.platform === "win32" ? "python.exe" : "python3", [plotter, first.tmp, JSON.stringify({
      data_path: "Materials/rates.csv", x_column: "time_min", y_columns: ["co_rate"], plot_kind: "line",
      save_mode: "overwrite", target_manifest_path: "plot-manifest.json",
    })], { encoding: "utf8" });
    assert.ok(rejected.status !== 0, "unsafe overwrite target must fail");
    assert.match(rejected.stderr || "", /Materials\/_analysis/);
  });

  it("preserves Chinese GB18030 column names instead of replacing them with mojibake", () => {
    const output = runPlot({ data_path: "Materials/gb18030.csv", x_column: "时间(min)", y_columns: ["信号值(uAU)"], plot_kind: "line" }, (tmp) => {
      const header = Buffer.from([0xca, 0xb1, 0xbc, 0xe4, 0x28, 0x6d, 0x69, 0x6e, 0x29, 0x2c, 0xd0, 0xc5, 0xba, 0xc5, 0xd6, 0xb5, 0x28, 0x75, 0x41, 0x55, 0x29]);
      fs.writeFileSync(path.join(tmp, "Materials", "gb18030.csv"), Buffer.concat([header, Buffer.from("\r\n0,1.2\r\n5,2.4\r\n10,3.6\r\n", "ascii")]));
    });
    assert.eq(output.result.status, 0, output.result.stderr);
    assert.eq(output.manifest.source.encoding, "GB18030");
    const svg = path.join(output.tmp, output.manifest.outputs.find((item) => item.endsWith("plot.svg")));
    assert.match(fs.readFileSync(svg, "utf8"), /时间\(min\)/);
    assert.match(fs.readFileSync(svg, "utf8"), /信号值\(uAU\)/);
    const profile = spawnSync(process.platform === "win32" ? "python.exe" : "python3", [profiler, output.tmp, JSON.stringify({ data_path: "Materials/gb18030.csv" })], { encoding: "utf8" });
    assert.eq(profile.status, 0, profile.stderr);
    const profileManifest = JSON.parse(profile.stdout);
    assert.eq(profileManifest.input.encoding, "GB18030");
    assert.deepEq(profileManifest.columns.map((column) => column.name), ["时间(min)", "信号值(uAU)"]);
  });

  it("clips the view window and draws visual annotations without touching measurements", () => {
    const output = runPlot({
      data_path: "Materials/rates.csv", x_column: "time_min", y_columns: ["co_rate"], plot_kind: "line", title: "Zoomed",
      chart_style: {
        theme: "publication", markers: "all", show_grid: true, line_width: 2.6,
        x_range: [10, 20],
        annotations: [{ type: "hline", value: 0, label: "baseline" }, { type: "vline", value: 15, label: "peak" }],
        series_colors: { co_rate: "#C57300" },
      },
    });
    assert.eq(output.result.status, 0, output.result.stderr);
    assert.deepEq(output.manifest.plot.chart_style.x_range, [10, 20]);
    assert.eq(output.manifest.plot.chart_style.annotations.length, 2);
    assert.eq(output.manifest.plot.chart_style.series_colors.co_rate, "#c57300");
    // View zoom: the manifest x_range summary reflects the clipped window.
    assert.deepEq(output.manifest.plot.x_range, [10, 20]);
    const svg = fs.readFileSync(path.join(output.tmp, output.manifest.outputs.find((item) => item.endsWith("plot.svg"))), "utf8");
    assert.match(svg, /stroke-dasharray="7 5"/);
    assert.match(svg, />baseline</);
    assert.match(svg, /stroke="#c57300"/);
    // The raw CSV is byte-identical: a zoom/annotation is a view, not an edit.
    assert.eq(fs.readFileSync(path.join(output.tmp, "Materials", "rates.csv"), "utf8"), "time_min,co_rate,ch4_rate\n0,0,0\n10,2.1,0.4\n20,4.5,1.1\n");
  });

  it("rejects an x_range window containing fewer than two points", () => {
    const output = runPlot({
      data_path: "Materials/rates.csv", x_column: "time_min", y_columns: ["co_rate"], plot_kind: "line",
      chart_style: { x_range: [11, 12] },
    });
    assert.notEq ? assert.notEq(output.result.status, 0) : assert.ok(output.result.status !== 0, "should fail");
    assert.match(output.result.stderr || "", /x_range/);
  });

  it("bounds annotations and ignores malformed color entries", () => {
    const many = Array.from({ length: 12 }, (_, index) => ({ type: "hline", value: index, label: `L${index}` }));
    const output = runPlot({
      data_path: "Materials/rates.csv", x_column: "time_min", y_columns: ["co_rate"], plot_kind: "line",
      chart_style: { annotations: many, series_colors: { co_rate: "red", ch4_rate: "#12AB34" } },
    });
    assert.eq(output.result.status, 0, output.result.stderr);
    assert.eq(output.manifest.plot.chart_style.annotations.length, 8);
    assert.deepEq(output.manifest.plot.chart_style.series_colors, { ch4_rate: "#12ab34" });
  });

  it("auto-wraps long titles and legends and reduces dense ticks before they overlap", () => {
    const output = runPlot({
      data_path: "Materials/dense.csv", x_column: "time_min", y_columns: ["very_long_signal_alpha", "very_long_signal_beta", "very_long_signal_gamma"], plot_kind: "line",
      title: "一个很长的科研图表标题用于验证标题不会与右侧图例或者绘图区发生不可控重叠",
      chart_style: { fig_size: [500, 550], title_size: 28, label_size: 16, tick_size: 14, tick_count: 10, legend: "bottom" },
    }, (tmp) => {
      fs.writeFileSync(path.join(tmp, "Materials", "dense.csv"), "time_min,very_long_signal_alpha,very_long_signal_beta,very_long_signal_gamma\n0,1,2,3\n10,2,4,6\n20,3,6,9\n", "utf8");
    });
    assert.eq(output.result.status, 0, output.result.stderr);
    assert.ok(output.manifest.plot.layout.title_lines > 1, "long title should be wrapped");
    assert.ok(output.manifest.plot.layout.legend_rows > 1, "long legend should be wrapped");
    assert.ok(output.manifest.plot.layout.rendered_tick_count < output.manifest.plot.layout.requested_tick_count, "dense ticks should be reduced");
    assert.eq(output.manifest.plot.layout.collision_avoidance, true);
    const svg = fs.readFileSync(path.join(output.tmp, output.manifest.outputs.find((item) => item.endsWith("plot.svg"))), "utf8");
    assert.match(svg, /<tspan/);
  });

  it("exposes the Material Library and Weaver command hooks in the shipping bundle", () => {
    const source = fs.readFileSync(path.join(root, "main.js"), "utf8");
    assert.match(source, /id:\s*"plot-material-library-data"/);
    assert.match(source, /name:\s*"织研者：从素材库数据绘图"/);
    assert.match(source, /sch-material-plot-action/);
    assert.match(source, /sch-data-profile-audit/);
    assert.match(source, /sch-data-plot/);
    assert.match(source, /schMaterialReadDelimitedText/);
    assert.match(source, /schMaterialPlotVersions/);
    assert.match(source, /打开所选版本修改/);
    assert.match(source, /materialAgentSkillAllowlist/);
    assert.match(source, /schMaterialRunAllowedSkill/);
    assert.match(source, /target_manifest_path/);
    assert.match(source, /library\.render\(root\)/);
    assert.match(source, /chart_style/);
    assert.match(source, /gb18030/);
    assert.match(source, /runGuidanceSkill/);
    assert.match(source, /Agent 指导/);
    assert.match(source, /plt-pane-resizer/);
    assert.match(source, /const asksQuestion =/);
    assert.match(source, /action === "answer"/);
    assert.match(source, /可对话的科研绘图 Agent/);
    assert.match(source, /conversationHistory/);
  });

  it("groups generated plots beneath their dataset and supports safe version deletion", () => {
    const source = fs.readFileSync(path.join(root, "main.js"), "utf8");
    const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
    assert.match(source, /async loadGeneratedImages\(\)/);
    assert.match(source, /manifest\.outputs \|\| \[\]/);
    assert.match(source, /getResourcePath\(previewFile\)/);
    assert.match(source, /copyFileAddress\(path\)/);
    assert.match(source, /allItems\(\) \{\s*return this\.data\.items\.slice\(\)/);
    assert.match(source, /plotsFor\(item\)/);
    assert.match(source, /renderDataPlotPanel\(\)/);
    assert.match(source, /async deleteGeneratedVersion\(item, plot\)/);
    assert.match(source, /this\.app\.vault\.trash\(target, true\)/);
    assert.match(source, /plot\.manifest\?\.source\?\.path !== item\.path/);
    assert.match(source, /async deletePaths\(paths\)/);
    assert.match(source, /Materials\/_analysis\//);
    assert.match(source, /async ensureVaultFolder\(path\)/);
    assert.match(source, /async moveItemToFolder\(item, folder\)/);
    assert.match(source, /application\/x-scholarium-material/);
    assert.match(source, /async ensureFolder\(t\)/);
    assert.match(source, /async moveFile\(t, e\)/);
    assert.match(source, /await this\.syncManager\.ensureFolder/);
    assert.match(css, /\.mat-folder-drop-target/);
    assert.match(css, /\.mat-card-path/);
    assert.match(css, /\.mat-data-detail\.mat-data-detail-open/);
    assert.match(css, /\.mat-data-plot-delete/);
    assert.match(css, /\.mat-lightbox-dialog\.modal/);
    assert.match(css, /\.plt-pane-resizer/);
    assert.match(css, /--plt-config-width/);
    assert.match(css, /background-color:\s*#2563EB\s*!important/);
    assert.match(css, /object-fit:\s*contain/);
    const createCard = source.slice(source.indexOf("    createCard(t, e) {", source.indexOf("var Vs = class")), source.indexOf("    setupDragDrop(t) {", source.indexOf("var Vs = class")));
    assert.noMatch(createCard, /openFile\(/);
    assert.eq((createCard.match(/copyFileAddress\(e\.path\)/g) || []).length, 1, "each dataset card should expose one path-copy action");
    assert.noMatch(createCard, /generated:\s*!0/);
    assert.noMatch(source.slice(source.indexOf("async ensureFolder(t)"), source.indexOf("async moveFile(t, e)")), /webdavPath/);
  });
});
