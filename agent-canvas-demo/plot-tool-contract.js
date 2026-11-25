"use strict";
/* Shared, side-effect-free contract for Scholarium plot tools.
 * Browser: window.schPlotToolContract. Node: module.exports.
 * Vault path IDs always use forward slashes, including on Windows. Series IDs
 * are exactly `series:${y_column}` so series_colors needs no lossy translation.
 */
(function plotToolContractModule(root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.schPlotToolContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function plotToolContractFactory() {
  const SCHEMA_VERSION = 1;
  const TOOL_NAMES = new Set(["inspect_dataset", "get_plot_context", "render_plot", "revise_plot"]);
  const PLOT_KINDS = new Set(["line", "scatter", "bar"]);
  const DATA_SUFFIXES = new Set([".csv", ".tsv", ".txt", ".dat"]);
  const STYLE_KEYS = new Set([
    "theme", "markers", "show_grid", "line_width", "x_range", "y_range",
    "annotations", "series_colors", "fig_size", "spines", "border_width",
    "title_size", "label_size", "tick_size", "x_label", "y_label", "legend",
    "marker_size", "line_style", "tick_count",
  ]);
  const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

  function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
  function fail(code, message) {
    const error = new Error(message);
    error.code = code;
    error.retryable = code === "VERSION_CONFLICT" || code === "BRIDGE_UNAVAILABLE";
    throw error;
  }
  function assertKeys(value, allowed, label) {
    if (!isObject(value)) fail("INVALID_INPUT", `${label} must be an object`);
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) fail("INVALID_INPUT", `${label} contains unsupported field: ${key}`);
    }
  }
  function boundedText(value, max, label, optional = false) {
    if (optional && value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail("INVALID_INPUT", `${label} must be a non-empty string of at most ${max} characters`);
    return value.trim();
  }
  function finiteNumber(value, min, max, label, integer = false) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) fail("INVALID_INPUT", `${label} is outside its allowed range`);
    return number;
  }
  function normalizeVaultPath(value, label = "path") {
    const normalized = String(value || "").trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\.\//, "");
    if (!normalized || normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) fail("INVALID_PATH", `${label} must be a Vault-relative path`);
    const segments = normalized.split("/");
    if (segments.some((segment) => !segment || segment === "." || segment === "..")) fail("INVALID_PATH", `${label} contains an unsafe path segment`);
    return normalized;
  }
  function normalizeDatasetPath(value) {
    const normalized = normalizeVaultPath(value, "dataset_path");
    const suffix = normalized.slice(normalized.lastIndexOf(".")).toLowerCase();
    if (!DATA_SUFFIXES.has(suffix)) fail("INVALID_PATH", "dataset_path must be CSV, TSV, TXT or DAT");
    return normalized;
  }
  function normalizeManifestId(value) {
    const normalized = normalizeVaultPath(value, "target_manifest_id");
    if (!normalized.endsWith("/plot-manifest.json")) fail("INVALID_PATH", "target_manifest_id must name a plot-manifest.json file");
    return normalized;
  }
  function seriesIdForColumn(column) { return `series:${String(column)}`; }
  function columnForSeriesId(id) {
    const value = String(id || "");
    return value.startsWith("series:") && value.length > 7 ? value.slice(7) : null;
  }
  function normalizeColor(value) {
    const color = String(value || "").trim();
    if (!/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color)) fail("INVALID_PATCH", "series color must be #rgb or #rrggbb");
    return color.toLowerCase();
  }
  function normalizeRange(value, label) {
    if (value === null) return null;
    if (!Array.isArray(value) || value.length !== 2) fail("INVALID_PATCH", `${label} must be [min,max] or null`);
    const low = finiteNumber(value[0], -Number.MAX_VALUE, Number.MAX_VALUE, label);
    const high = finiteNumber(value[1], -Number.MAX_VALUE, Number.MAX_VALUE, label);
    if (low >= high) fail("INVALID_PATCH", `${label} min must be smaller than max`);
    return [low, high];
  }
  function normalizeAnnotation(value, index = 0) {
    assertKeys(value, new Set(["id", "type", "value", "label"]), "annotation");
    const type = String(value.type || "").toLowerCase();
    if (!new Set(["hline", "vline"]).has(type)) fail("INVALID_PATCH", "annotation type must be hline or vline");
    return {
      id: value.id === undefined ? `annotation:${index + 1}` : boundedText(value.id, 160, "annotation.id"),
      type,
      value: finiteNumber(value.value, -Number.MAX_VALUE, Number.MAX_VALUE, "annotation.value"),
      label: value.label === undefined ? "" : String(value.label).trim().slice(0, 60),
    };
  }
  function normalizeStyle(value) {
    if (value === undefined) return {};
    assertKeys(value, STYLE_KEYS, "chart_style");
    const style = {};
    if (value.theme !== undefined) {
      const theme = String(value.theme).toLowerCase();
      if (!new Set(["publication", "soft", "dark"]).has(theme)) fail("INVALID_PATCH", "unsupported theme");
      style.theme = theme;
    }
    if (value.markers !== undefined) {
      const markers = String(value.markers).toLowerCase();
      if (!new Set(["auto", "all", "none"]).has(markers)) fail("INVALID_PATCH", "unsupported markers");
      style.markers = markers;
    }
    if (value.show_grid !== undefined) {
      if (typeof value.show_grid !== "boolean") fail("INVALID_PATCH", "show_grid must be boolean");
      style.show_grid = value.show_grid;
    }
    for (const [key, min, max, integer] of [
      ["line_width", 1, 6, false], ["border_width", 0.5, 4, false],
      ["title_size", 10, 40, false], ["label_size", 8, 24, false],
      ["tick_size", 6, 20, false], ["marker_size", 1, 10, false],
      ["tick_count", 3, 10, true],
    ]) {
      if (value[key] !== undefined) style[key] = finiteNumber(value[key], min, max, key, integer);
    }
    for (const key of ["x_range", "y_range"]) if (value[key] !== undefined) style[key] = normalizeRange(value[key], key);
    if (value.fig_size !== undefined) {
      if (!Array.isArray(value.fig_size) || value.fig_size.length !== 2) fail("INVALID_PATCH", "fig_size must be [width,height]");
      style.fig_size = [
        finiteNumber(value.fig_size[0], 400, 2400, "fig_size.width", true),
        finiteNumber(value.fig_size[1], 300, 1800, "fig_size.height", true),
      ];
    }
    if (value.spines !== undefined) {
      assertKeys(value.spines, new Set(["top", "right", "left", "bottom"]), "spines");
      style.spines = {};
      for (const side of ["top", "right", "left", "bottom"]) {
        if (value.spines[side] === undefined) continue;
        if (typeof value.spines[side] !== "boolean") fail("INVALID_PATCH", `spines.${side} must be boolean`);
        style.spines[side] = value.spines[side];
      }
      if (!Object.keys(style.spines).length) fail("INVALID_PATCH", "spines patch cannot be empty");
    }
    if (value.legend !== undefined) {
      const legend = String(value.legend).toLowerCase();
      if (!new Set(["bottom", "right", "none"]).has(legend)) fail("INVALID_PATCH", "unsupported legend position");
      style.legend = legend;
    }
    if (value.line_style !== undefined) {
      const lineStyle = String(value.line_style).toLowerCase();
      if (!new Set(["solid", "dashed", "dotted"]).has(lineStyle)) fail("INVALID_PATCH", "unsupported line_style");
      style.line_style = lineStyle;
    }
    for (const key of ["x_label", "y_label"]) {
      if (value[key] === undefined) continue;
      style[key] = value[key] === null ? null : boundedText(value[key], 60, key);
    }
    if (value.annotations !== undefined) {
      if (!Array.isArray(value.annotations) || value.annotations.length > 8) fail("INVALID_PATCH", "annotations must be an array of at most 8 entries");
      style.annotations = value.annotations.map((entry, index) => normalizeAnnotation(entry, index));
      const ids = style.annotations.map((entry) => entry.id);
      if (new Set(ids).size !== ids.length) fail("INVALID_PATCH", "annotation IDs must be unique");
    }
    if (value.series_colors !== undefined) {
      assertKeys(value.series_colors, new Set(Object.keys(value.series_colors)), "series_colors");
      const entries = Object.entries(value.series_colors);
      if (entries.length > 12) fail("INVALID_PATCH", "series_colors is limited to 12 entries");
      style.series_colors = {};
      for (const [column, color] of entries) {
        const name = boundedText(column, 200, "series_colors column");
        style.series_colors[name] = normalizeColor(color);
      }
    }
    return style;
  }
  function mergeStyle(previous, patch) {
    const prior = normalizeStyle(previous || {});
    const nextPatch = normalizeStyle(patch || {});
    const merged = { ...prior, ...nextPatch };
    for (const key of ["spines", "series_colors"]) {
      if (prior[key] || nextPatch[key]) merged[key] = { ...(prior[key] || {}), ...(nextPatch[key] || {}) };
    }
    return normalizeStyle(merged);
  }
  function diffStyle(previous, next) {
    const prior = normalizeStyle(previous || {});
    const desired = normalizeStyle(next || {});
    const patch = {};
    const changed = (left, right) => JSON.stringify(left) !== JSON.stringify(right);
    for (const key of Object.keys(desired)) {
      if (key === "spines" || key === "series_colors") {
        const nested = {};
        const priorNested = prior[key] || {};
        for (const nestedKey of Object.keys(desired[key] || {})) {
          if (changed(priorNested[nestedKey], desired[key][nestedKey])) nested[nestedKey] = desired[key][nestedKey];
        }
        if (Object.keys(nested).length) patch[key] = nested;
      } else if (changed(prior[key], desired[key])) patch[key] = desired[key];
    }
    return patch;
  }
  function normalizeRenderInput(input) {
    assertKeys(input, new Set(["dataset_path", "recipe"]), "render_plot");
    const recipe = input.recipe;
    assertKeys(recipe, new Set(["plot_kind", "title", "x_column", "y_columns", "chart_style"]), "render_plot.recipe");
    const plotKind = String(recipe.plot_kind || "").toLowerCase();
    if (!PLOT_KINDS.has(plotKind)) fail("INVALID_INPUT", "plot_kind must be line, scatter or bar");
    const xColumn = boundedText(recipe.x_column, 200, "x_column");
    if (!Array.isArray(recipe.y_columns) || !recipe.y_columns.length || recipe.y_columns.length > 6) fail("INVALID_INPUT", "y_columns must contain 1–6 columns");
    const yColumns = recipe.y_columns.map((value) => boundedText(value, 200, "y_columns entry"));
    if (new Set(yColumns).size !== yColumns.length || yColumns.includes(xColumn)) fail("INVALID_INPUT", "y_columns must be unique and different from x_column");
    return {
      dataset_path: normalizeDatasetPath(input.dataset_path),
      recipe: {
        plot_kind: plotKind,
        x_column: xColumn,
        y_columns: yColumns,
        chart_style: normalizeStyle(recipe.chart_style),
        ...(recipe.title === undefined ? {} : { title: boundedText(recipe.title, 180, "title") }),
      },
    };
  }
  function normalizeReviseInput(input) {
    assertKeys(input, new Set(["target_manifest_id", "base_version", "revision_reason", "patch", "save_mode"]), "revise_plot");
    if (input.save_mode !== undefined && input.save_mode !== "new_version") fail("OVERWRITE_REQUIRES_RESEARCHER", "LLM revisions can only request new_version");
    if (!Number.isInteger(input.base_version) || input.base_version < 1) fail("INVALID_INPUT", "base_version must be a positive integer");
    return {
      target_manifest_id: normalizeManifestId(input.target_manifest_id),
      base_version: input.base_version,
      revision_reason: boundedText(input.revision_reason, 300, "revision_reason"),
      patch: input.patch,
      save_mode: "new_version",
    };
  }
  function applyPlotPatch(manifest, patch) {
    assertKeys(patch, new Set(["title", "chart_style", "series_updates", "annotations_upsert", "remove_ids"]), "revise_plot.patch");
    if (!Object.keys(patch).length) fail("INVALID_PATCH", "patch cannot be empty");
    const plot = manifest && manifest.plot;
    if (!isObject(plot)) fail("INVALID_MANIFEST", "target manifest has no plot recipe");
    let style = mergeStyle(plot.chart_style || {}, patch.chart_style || {});
    const yColumns = Array.isArray(plot.y_columns) ? plot.y_columns.map(String) : [];
    if (patch.series_updates !== undefined) {
      if (!Array.isArray(patch.series_updates)) fail("INVALID_PATCH", "series_updates must be an array");
      const colors = { ...(style.series_colors || {}) };
      for (const update of patch.series_updates) {
        assertKeys(update, new Set(["id", "color"]), "series_updates entry");
        const column = columnForSeriesId(update.id);
        if (!column || !yColumns.includes(column)) fail("UNKNOWN_SERIES", `unknown series ID: ${String(update.id || "")}`);
        if (update.color === undefined) fail("INVALID_PATCH", "series update only supports color in contract v1");
        colors[column] = normalizeColor(update.color);
      }
      style.series_colors = colors;
    }
    if (patch.annotations_upsert !== undefined) {
      if (!Array.isArray(patch.annotations_upsert)) fail("INVALID_PATCH", "annotations_upsert must be an array");
      const annotations = (style.annotations || []).map((entry, index) => normalizeAnnotation(entry, index));
      for (const update of patch.annotations_upsert) {
        assertKeys(update, new Set(["id", "type", "value", "label"]), "annotations_upsert entry");
        const id = boundedText(update.id, 160, "annotation.id");
        const index = annotations.findIndex((entry) => entry.id === id);
        const base = index >= 0 ? annotations[index] : { id };
        const merged = { ...base, ...update, id };
        const normalized = normalizeAnnotation(merged, index >= 0 ? index : annotations.length);
        if (index >= 0) annotations[index] = normalized;
        else annotations.push(normalized);
      }
      if (annotations.length > 8) fail("INVALID_PATCH", "annotations are limited to 8 entries");
      style.annotations = annotations;
    }
    if (patch.remove_ids !== undefined) {
      if (!Array.isArray(patch.remove_ids) || patch.remove_ids.some((id) => typeof id !== "string")) fail("INVALID_PATCH", "remove_ids must be a string array");
      const remove = new Set(patch.remove_ids);
      for (const id of remove) if (columnForSeriesId(id)) fail("DATA_MAPPING_CHANGE_FORBIDDEN", "series removal requires render_plot");
      style.annotations = (style.annotations || []).filter((entry) => !remove.has(entry.id));
    }
    return {
      title: patch.title === undefined ? String(plot.title || "") : boundedText(patch.title, 180, "title"),
      chart_style: normalizeStyle(style),
    };
  }
  function manifestIdentity(manifest, manifestPath) {
    const manifestId = normalizeManifestId(manifestPath);
    const contract = isObject(manifest && manifest.plot_contract) ? manifest.plot_contract : {};
    return {
      plot_id: contract.plot_id ? normalizeManifestId(contract.plot_id) : manifestId,
      target_manifest_id: manifestId,
      version: Number.isInteger(contract.version) && contract.version > 0 ? contract.version : 1,
      parent_manifest_id: contract.parent_manifest_id ? normalizeManifestId(contract.parent_manifest_id) : null,
      parent_version: Number.isInteger(contract.parent_version) ? contract.parent_version : null,
    };
  }
  function outputPath(manifest, name) {
    const outputs = Array.isArray(manifest && manifest.outputs) ? manifest.outputs : [];
    const found = outputs.find((entry) => normalizeVaultPath(entry).endsWith(`/${name}`));
    return found ? normalizeVaultPath(found) : "";
  }
  function summarizeManifest(manifest, manifestPath) {
    const identity = manifestIdentity(manifest, manifestPath);
    const plot = manifest.plot || {};
    const style = plot.chart_style || {};
    const annotations = Array.isArray(style.annotations) ? style.annotations.map((entry, index) => normalizeAnnotation(entry, index)) : [];
    return {
      ...identity,
      title: String(plot.title || ""),
      chart_type: String(plot.kind || "line"),
      x_column: String(plot.x_column || ""),
      series_list: (Array.isArray(plot.y_columns) ? plot.y_columns : []).map((column) => ({
        id: seriesIdForColumn(column),
        y_column: String(column),
        ...((style.series_colors || {})[column] ? { color: style.series_colors[column] } : {}),
      })),
      annotations_list: annotations,
      style: {
        theme: String(style.theme || "publication"),
        show_grid: style.show_grid !== false,
        legend: String(style.legend || "bottom"),
        x_range: style.x_range || null,
        y_range: style.y_range || null,
      },
    };
  }
  function mappingEntry(requested, resolved, id) {
    const status = resolved === null ? "dropped" : requested === resolved ? "matched" : "substituted";
    return { ...(id ? { id } : {}), requested: String(requested), resolved, status };
  }
  function buildColumnMapping(manifest, requestedRecipe) {
    const plot = manifest.plot || {};
    const actualX = String(plot.x_column || "");
    const actualY = Array.isArray(plot.y_columns) ? plot.y_columns.map(String) : [];
    const requestedX = String(requestedRecipe && requestedRecipe.x_column || actualX);
    const requestedY = requestedRecipe && Array.isArray(requestedRecipe.y_columns) ? requestedRecipe.y_columns.map(String) : actualY;
    const x = mappingEntry(requestedX, actualX || null);
    if (!actualX) x.status = "missing";
    const series = requestedY.map((column) => mappingEntry(column, actualY.includes(column) ? column : null, seriesIdForColumn(column)));
    for (const column of actualY) if (!requestedY.includes(column)) series.push(mappingEntry(column, column, seriesIdForColumn(column)));
    const entries = [x, ...series];
    return {
      status: !actualX || !actualY.length ? "invalid" : entries.every((entry) => entry.status === "matched") ? "verified" : "changed",
      x,
      series,
    };
  }
  function observationWarnings(manifest, mapping) {
    const warnings = [];
    for (const entry of [mapping.x, ...mapping.series]) {
      if (entry.status === "matched") continue;
      warnings.push({
        code: entry.status === "substituted" ? "COLUMN_SUBSTITUTED" : "COLUMN_DROPPED",
        severity: entry.status === "missing" || entry.status === "dropped" ? "warning" : "info",
        message: `Column mapping ${entry.status}: ${entry.requested} → ${entry.resolved || "none"}`,
        suggested_fix: "Call inspect_dataset and use exact returned column names.",
      });
    }
    const layout = manifest.plot && manifest.plot.layout || {};
    if (Number(layout.requested_tick_count) > Number(layout.rendered_tick_count)) warnings.push({
      code: "TICK_CROWDED", severity: "info",
      message: `Tick count was reduced from ${layout.requested_tick_count} to ${layout.rendered_tick_count} to limit crowding.`,
      suggested_fix: "Increase canvas width or reduce tick_count if more ticks are required.",
    });
    if (Number(layout.title_lines) > 1) warnings.push({ code: "TITLE_WRAPPED", severity: "info", message: `Title was wrapped to ${layout.title_lines} lines.` });
    if (Number(layout.legend_rows) > 1) warnings.push({ code: "LEGEND_WRAPPED", severity: "info", message: `Legend was wrapped to ${layout.legend_rows} rows.` });
    return warnings;
  }
  function makeObservation(tool, manifest, manifestPath, options = {}) {
    const manifestId = normalizeManifestId(manifestPath);
    const summary = summarizeManifest(manifest, manifestId);
    const mapping = buildColumnMapping(manifest, options.requested_recipe || {});
    const identity = manifestIdentity(manifest, manifestId);
    return {
      schema_version: SCHEMA_VERSION,
      status: "success",
      tool,
      plot_id: identity.plot_id,
      target_manifest_id: manifestId,
      current_version: identity.version,
      svg_path: outputPath(manifest, "plot.svg"),
      manifest_path: manifestId,
      manifest_summary: summary,
      column_mapping: mapping,
      warnings: observationWarnings(manifest, mapping),
      audit: {
        dataset_path: normalizeDatasetPath(manifest.source && manifest.source.path),
        dataset_hash: String(manifest.source && manifest.source.sha256 || ""),
        dataset_readonly: true,
        parent_manifest_id: identity.parent_manifest_id,
        parent_version: identity.parent_version,
        save_mode: options.save_mode || (manifest.revision && manifest.revision.mode === "overwrite" ? "overwrite" : "new_version"),
        ...(options.revision_reason ? { revision_reason: options.revision_reason } : {}),
      },
    };
  }
  function errorObservation(tool, error, target) {
    const manifestId = target && target.target_manifest_id ? String(target.target_manifest_id).replace(/\\/g, "/") : "";
    return {
      schema_version: SCHEMA_VERSION,
      status: "error",
      tool,
      plot_id: target && target.plot_id ? String(target.plot_id).replace(/\\/g, "/") : manifestId,
      target_manifest_id: manifestId,
      current_version: Number(target && target.base_version) || 0,
      svg_path: "",
      manifest_path: manifestId,
      manifest_summary: null,
      column_mapping: null,
      warnings: [],
      audit: null,
      error: { code: String(error && error.code || "PLOT_TOOL_ERROR"), message: String(error && error.message || error), retryable: Boolean(error && error.retryable) },
    };
  }
  function legacyRenderToolCall(request) {
    return {
      name: "render_plot",
      arguments: {
        dataset_path: normalizeDatasetPath(request.data_path),
        recipe: {
          plot_kind: request.plot_kind,
          title: request.title,
          x_column: request.x_column,
          y_columns: request.y_columns,
          chart_style: request.chart_style || {},
        },
      },
    };
  }
  function legacyReviseToolCall(request, baseVersion) {
    return {
      name: "revise_plot",
      arguments: {
        target_manifest_id: normalizeManifestId(request.target_manifest_path || request.target_manifest_id),
        base_version: baseVersion,
        revision_reason: request.reason || "Legacy chart style revision",
        patch: { chart_style: request.chart_style || {} },
        save_mode: "new_version",
      },
    };
  }
  function toLegacyResult(observation, extra = {}) {
    return {
      svg_path: observation.svg_path,
      manifest_path: observation.manifest_path,
      revision_mode: observation.audit && observation.audit.save_mode || "new_version",
      source_path: observation.audit && observation.audit.dataset_path || "",
      observation,
      ...extra,
    };
  }

  return {
    SCHEMA_VERSION, TOOL_NAMES, PLOT_KINDS, DATA_SUFFIXES, STYLE_KEYS,
    normalizeVaultPath, normalizeDatasetPath, normalizeManifestId,
    seriesIdForColumn, columnForSeriesId,
    normalizeStyle, mergeStyle, diffStyle, normalizeRenderInput, normalizeReviseInput, applyPlotPatch,
    manifestIdentity, summarizeManifest, buildColumnMapping, makeObservation, errorObservation,
    legacyRenderToolCall, legacyReviseToolCall, toLegacyResult, outputPath,
  };
});
