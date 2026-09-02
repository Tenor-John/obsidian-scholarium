"use strict";
// Handlers for the two agent-proposable Materials analysis actions
// (sch-data-plot / sch-data-profile-audit).
//
// These do NOT give the reasoning agent (codex/claude, running read-only
// via the Bridge /v1/tasks path) any write tool of its own. The agent can
// only put a request in action_requests (see protocol() in main.js); a
// human must have allowResearchWeaverActions on, and the request still has
// to survive the same queue -> whitelist -> runAsync -> audit path as the
// rss.* actions (see schPollScholariumQueue in main.js). All this file does
// is call the EXISTING skill-execution path the Materials panel's own
// "数据画像"/"绘图" buttons already use (schMaterialRunSkill ->
// POST /v1/skills/run on the local Bridge) — no new write surface, just a
// second caller of the same tested path. Each skill's own script is what
// actually writes files, always scoped to Materials/_analysis/<hash>/ and
// read-only on the source CSV/TSV (see each skill's SKILL.md); this module
// never touches the filesystem directly.
//
// `live.runSkill` is duck-typed on purpose so tests can pass a fake without
// loading Obsidian or a real Bridge process:
//
//   live = { runSkill: async (skillName, input) => ({ manifest: {...}, ... }) }
//
// In production `live.runSkill` is
// `(name, input) => schMaterialRunSkill(plugin, name, input)`, supplied by
// schPollScholariumQueue in main.js.

function requireLive(live, dryRun) {
  if (live && typeof live.runSkill === "function") return live;
  if (dryRun) return null; // dry-run without a live Bridge context: validate input only
  throw new Error("scholarium_live_context_required");
}

async function dataPlot(vault, input, options, live) {
  const dataPath = String(input.data_path || "");
  if (!dataPath) throw new Error("data_path_required");
  const ctx = requireLive(live, options.dryRun);
  if (!ctx) return { data_path: dataPath, mode: "dry_run_no_live_context" };
  const params = {
    data_path: dataPath,
    x_column: String(input.x_column || ""),
    y_columns: Array.isArray(input.y_columns) ? input.y_columns.map(String) : [],
    plot_kind: String(input.plot_kind || "line"),
    title: String(input.title || ""),
  };
  // Style is a bounded, visual-only chart recipe. It is passed through to the
  // renderer, which validates every field and persists the normalized result
  // in the immutable manifest. Omit it entirely for backwards-compatible
  // requests so older queued actions retain their exact payload shape.
  if (input.chart_style && typeof input.chart_style === "object" && !Array.isArray(input.chart_style)) {
    params.chart_style = input.chart_style;
  }
  const result = await ctx.runSkill("sch-data-plot", params);
  return { data_path: dataPath, ...result };
}

async function profileAudit(vault, input, options, live) {
  const dataPath = String(input.data_path || "");
  if (!dataPath) throw new Error("data_path_required");
  const ctx = requireLive(live, options.dryRun);
  if (!ctx) return { data_path: dataPath, mode: "dry_run_no_live_context" };
  const result = await ctx.runSkill("sch-data-profile-audit", { data_path: dataPath });
  return { data_path: dataPath, ...result };
}

module.exports = { dataPlot, profileAudit };
