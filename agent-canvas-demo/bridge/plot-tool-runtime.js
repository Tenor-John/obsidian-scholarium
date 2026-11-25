"use strict";
/* Unified host runtime for Scholarium plot tools. The host supplies only
 * reviewed Skill execution and bounded Vault reads; this module owns recipe
 * adaptation, optimistic version checks and Observation construction. */
const contract = require("../plot-tool-contract.js");

function isObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function manifestFrom(response) {
  const manifest = response && response.manifest || response;
  if (!isObject(manifest)) {
    const error = new Error("plot Skill returned no manifest");
    error.code = "INVALID_SKILL_RESPONSE";
    throw error;
  }
  return manifest;
}
function outputRoot(context) {
  return contract.normalizeVaultPath(context && context.output_root || "Materials", "output_root");
}
function validateManifest(manifest, manifestId) {
  if (manifest.skill !== "sch-data-plot" || !isObject(manifest.plot) || !isObject(manifest.source)) {
    const error = new Error("target is not a complete sch-data-plot manifest");
    error.code = "INVALID_MANIFEST";
    throw error;
  }
  const plot = manifest.plot;
  if (!plot.x_column || !Array.isArray(plot.y_columns) || !plot.y_columns.length || !contract.PLOT_KINDS.has(String(plot.kind))) {
    const error = new Error("target manifest has an incomplete column or chart mapping");
    error.code = "INVALID_MANIFEST";
    throw error;
  }
  return contract.manifestIdentity(manifest, manifestId);
}
function confirmationObservation(call) {
  const observation = contract.errorObservation(call.name, {
    code: "CONFIRMATION_REQUIRED",
    message: "Researcher confirmation is required before rendering or revising a chart.",
  }, call.arguments);
  observation.status = "needs_user_confirmation";
  return observation;
}

function createPlotToolRuntime(deps) {
  if (!deps || typeof deps.runSkill !== "function" || typeof deps.readManifest !== "function" || typeof deps.listManifests !== "function") {
    throw new Error("plot tool runtime requires runSkill, readManifest and listManifests host adapters");
  }
  async function inspect_dataset(input) {
    if (!isObject(input)) {
      const error = new Error("inspect_dataset arguments must be an object"); error.code = "INVALID_INPUT"; throw error;
    }
    const allowed = new Set(["dataset_path", "sample_rows"]);
    for (const key of Object.keys(input)) if (!allowed.has(key)) {
      const error = new Error(`inspect_dataset contains unsupported field: ${key}`); error.code = "INVALID_INPUT"; throw error;
    }
    const datasetPath = contract.normalizeDatasetPath(input.dataset_path);
    const sampleRows = input.sample_rows === undefined ? 5 : Number(input.sample_rows);
    if (!Number.isInteger(sampleRows) || sampleRows < 0 || sampleRows > 20) {
      const error = new Error("sample_rows must be an integer from 0 to 20"); error.code = "INVALID_INPUT"; throw error;
    }
    const manifest = manifestFrom(await deps.runSkill("sch-data-profile-audit", { data_path: datasetPath }));
    const columns = Array.isArray(manifest.columns) ? manifest.columns : [];
    let sample = [];
    const warnings = [];
    if (sampleRows && typeof deps.readDatasetSample === "function") {
      sample = await deps.readDatasetSample(datasetPath, sampleRows, manifest.input || {});
    } else if (sampleRows) {
      warnings.push({ code: "RENDER_METADATA_LIMITED", severity: "info", message: "This host does not expose dataset sample rows; field profiling is still complete." });
    }
    return {
      schema_version: contract.SCHEMA_VERSION,
      status: "success",
      tool: "inspect_dataset",
      dataset: {
        path: datasetPath,
        ...(manifest.input && manifest.input.sha256 ? { sha256: String(manifest.input.sha256) } : {}),
        rows: Number(manifest.input && manifest.input.rows) || 0,
        columns: Number(manifest.input && manifest.input.columns) || columns.length,
        ...(manifest.input && manifest.input.encoding ? { encoding: String(manifest.input.encoding) } : {}),
        ...(manifest.input && manifest.input.delimiter ? { delimiter: String(manifest.input.delimiter) } : {}),
        readonly: true,
      },
      columns: columns.map((column) => ({
        name: String(column.name || ""),
        inferred_type: column.inferred_type === "numeric" ? "numeric" : "text",
        missing_count: Number(column.missing_count) || 0,
        non_missing_count: Number(column.non_missing_count) || 0,
        numeric_count: Number(column.numeric_count) || 0,
        ...(column.numeric && Number.isFinite(column.numeric.min) && Number.isFinite(column.numeric.max)
          ? { numeric_range: [column.numeric.min, column.numeric.max] } : {}),
      })),
      sample,
      warnings,
    };
  }
  async function readTarget(manifestId) {
    const manifest = manifestFrom(await deps.readManifest(manifestId));
    const identity = validateManifest(manifest, manifestId);
    return { manifest, identity };
  }
  async function get_plot_context(input, context) {
    const value = isObject(input) ? input : {};
    const target = value.target_manifest_id || value.plot_id || context.active_target_manifest_id || "";
    if (!target) return { schema_version: 1, status: "success", tool: "get_plot_context", active: null, versions: [], warnings: [] };
    const normalized = contract.normalizeManifestId(target);
    // A concrete v2 manifest ID is not the lineage root. Resolve it first so
    // the version list includes v1 and every sibling sharing stable plot_id.
    const current = value.target_manifest_id || context.active_target_manifest_id === target
      ? await readTarget(normalized)
      : null;
    const lineageId = current ? current.identity.plot_id : normalized;
    const listed = await deps.listManifests();
    const matching = [];
    for (const entry of listed) {
      try {
        const manifest = manifestFrom(entry.manifest || entry);
        const manifestId = contract.normalizeManifestId(entry.manifest_id || entry.path);
        const identity = validateManifest(manifest, manifestId);
        if (identity.plot_id === lineageId || manifestId === normalized) matching.push({ manifest, manifest_id: manifestId, identity });
      } catch { /* Unreadable or unrelated artifacts are not editable versions. */ }
    }
    if (current && !matching.some((entry) => entry.manifest_id === current.identity.target_manifest_id)) {
      matching.push({ manifest: current.manifest, manifest_id: current.identity.target_manifest_id, identity: current.identity });
    }
    matching.sort((left, right) => String(right.manifest.created_at || "").localeCompare(String(left.manifest.created_at || "")));
    const versions = matching.map((entry) => ({
      target_manifest_id: entry.manifest_id,
      version: entry.identity.version,
      created_at: String(entry.manifest.created_at || ""),
      svg_path: contract.outputPath(entry.manifest, "plot.svg"),
      manifest_path: entry.manifest_id,
    }));
    const activeEntry = matching.find((entry) => entry.manifest_id === normalized) || matching[0];
    return {
      schema_version: 1,
      status: "success",
      tool: "get_plot_context",
      active: activeEntry ? contract.summarizeManifest(activeEntry.manifest, activeEntry.manifest_id) : null,
      versions,
      warnings: [],
    };
  }
  async function render_plot(input, context) {
    const normalized = contract.normalizeRenderInput(input);
    // Inspection is deliberately part of the render path. Its result is not
    // trusted as a substitute for renderer validation, but it makes exact column
    // metadata available before any artifact is written.
    await inspect_dataset({ dataset_path: normalized.dataset_path, sample_rows: 0 });
    const executorInput = {
      data_path: normalized.dataset_path,
      x_column: normalized.recipe.x_column,
      y_columns: normalized.recipe.y_columns,
      plot_kind: normalized.recipe.plot_kind,
      chart_style: normalized.recipe.chart_style,
      output_root: outputRoot(context),
      save_mode: "new",
      plot_contract: {
        schema_version: 1,
        version: 1,
        parent_manifest_id: null,
        parent_version: null,
        revision_reason: "Initial render",
      },
    };
    if (normalized.recipe.title !== undefined) executorInput.title = normalized.recipe.title;
    const manifest = manifestFrom(await deps.runSkill("sch-data-plot", executorInput));
    const manifestId = contract.outputPath(manifest, "plot-manifest.json");
    validateManifest(manifest, manifestId);
    return contract.makeObservation("render_plot", manifest, manifestId, {
      requested_recipe: normalized.recipe,
      save_mode: "new_version",
    });
  }
  async function revise_plot(input, context) {
    const normalized = contract.normalizeReviseInput(input);
    const { manifest: previous, identity } = await readTarget(normalized.target_manifest_id);
    if (identity.version !== normalized.base_version) {
      const error = new Error(`version conflict: target is v${identity.version}, request is based on v${normalized.base_version}`);
      error.code = "VERSION_CONFLICT";
      error.current_version = identity.version;
      throw error;
    }
    const patched = contract.applyPlotPatch(previous, normalized.patch);
    const overwrite = context.researcher_save_mode === "overwrite";
    const nextVersion = overwrite ? identity.version : identity.version + 1;
    const executorInput = {
      data_path: contract.normalizeDatasetPath(previous.source.path),
      x_column: String(previous.plot.x_column),
      y_columns: previous.plot.y_columns.map(String),
      plot_kind: String(previous.plot.kind),
      title: patched.title,
      chart_style: patched.chart_style,
      output_root: outputRoot(context),
      save_mode: overwrite ? "overwrite" : "new",
      target_manifest_path: identity.target_manifest_id,
      plot_contract: {
        schema_version: 1,
        plot_id: identity.plot_id,
        version: nextVersion,
        parent_manifest_id: identity.target_manifest_id,
        parent_version: identity.version,
        revision_reason: normalized.revision_reason,
      },
    };
    const manifest = manifestFrom(await deps.runSkill("sch-data-plot", executorInput));
    const manifestId = contract.outputPath(manifest, "plot-manifest.json");
    validateManifest(manifest, manifestId);
    return contract.makeObservation("revise_plot", manifest, manifestId, {
      requested_recipe: {
        x_column: previous.plot.x_column,
        y_columns: previous.plot.y_columns,
      },
      save_mode: overwrite ? "overwrite" : "new_version",
      revision_reason: normalized.revision_reason,
    });
  }
  async function execute(call, context = {}) {
    if (!call || !contract.TOOL_NAMES.has(call.name)) {
      const error = new Error("unknown plot tool"); error.code = "UNKNOWN_TOOL";
      return contract.errorObservation(call && call.name || "unknown", error, call && call.arguments);
    }
    if ((call.name === "render_plot" || call.name === "revise_plot") && context.researcher_confirmed !== true) return confirmationObservation(call);
    try {
      if (call.name === "inspect_dataset") return await inspect_dataset(call.arguments);
      if (call.name === "get_plot_context") return await get_plot_context(call.arguments, context);
      if (call.name === "render_plot") return await render_plot(call.arguments, context);
      return await revise_plot(call.arguments, context);
    } catch (error) {
      const observation = contract.errorObservation(call.name, error, call.arguments);
      if (Number.isInteger(error.current_version)) observation.current_version = error.current_version;
      return observation;
    }
  }
  return { inspect_dataset, get_plot_context, render_plot, revise_plot, execute };
}

module.exports = { createPlotToolRuntime };
