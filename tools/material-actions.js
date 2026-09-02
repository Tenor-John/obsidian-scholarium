"use strict";
// Scholarium 素材库 (materialLibrary.* in data.json) action handlers.
// Real shapes (verified against the owner's data.json):
//   items:      [{id, path, name, category, addedAt}]
//   categories: ["HPLC", ...]
// Reads are L0 from disk; writes are L1 through the queue consumer with
// live.plugin (loadData/saveData), same contract as workspace-actions.js.

const fs = require("fs");
const path = require("path");

function dataJsonPath(vault) {
  const candidates = [
    path.join(vault, ".obsidian", "plugins", "obsidian-scholarium", "data.json"),
    path.join(vault, ".obsidian", "plugins", "scholarium", "data.json"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function list(vault) {
  try {
    const data = JSON.parse(fs.readFileSync(dataJsonPath(vault), "utf8"));
    const library = data && typeof data.materialLibrary === "object" && data.materialLibrary ? data.materialLibrary : {};
    return {
      items: (Array.isArray(library.items) ? library.items : []).map((item) => ({ id: item.id, path: item.path, name: item.name, category: item.category, addedAt: item.addedAt })),
      categories: Array.isArray(library.categories) ? library.categories : [],
    };
  } catch (_) {
    throw new Error("material_library_unreadable: data.json not found or invalid");
  }
}

function requirePlugin(live, dryRun) {
  if (live && live.plugin && typeof live.plugin.loadData === "function") return live.plugin;
  if (dryRun) return null;
  throw new Error("scholarium_live_context_required");
}

async function mutateLibrary(plugin, fn) {
  const data = (await plugin.loadData()) || {};
  if (!data.materialLibrary || typeof data.materialLibrary !== "object") data.materialLibrary = { items: [], categories: [] };
  const library = data.materialLibrary;
  if (!Array.isArray(library.items)) library.items = [];
  if (!Array.isArray(library.categories)) library.categories = [];
  const result = await fn(library);
  await plugin.saveData(data);
  return result;
}

async function add(vault, input, options, live) {
  const relPath = String(input.path || "").trim();
  if (!relPath) throw new Error("path_required");
  if (relPath.startsWith("/") || relPath.includes("..")) throw new Error("path_must_be_vault_relative");
  const abs = path.join(vault, ...relPath.split("/"));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error("file_not_in_vault:" + relPath);
  const name = String(input.name || path.basename(relPath).replace(/\.[^.]+$/, "")).trim();
  const category = String(input.category || "").trim();
  const entry = { id: Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6), path: relPath, name, category, addedAt: new Date().toISOString() };
  if (options.dryRun) return { mode: "dry_run", would_add: entry };
  const plugin = requirePlugin(live, false);
  return mutateLibrary(plugin, async (library) => {
    if (library.items.some((item) => item.path === relPath)) throw new Error("material_already_registered:" + relPath);
    library.items.push(entry);
    if (category && !library.categories.includes(category)) library.categories.push(category);
    return { added: entry, total: library.items.length };
  });
}

async function update(vault, input, options, live) {
  const id = String(input.id || "");
  if (!id) throw new Error("id_required");
  const patch = {};
  for (const key of ["name", "category"]) {
    if (input[key] !== undefined) patch[key] = String(input[key]).trim();
  }
  if (!Object.keys(patch).length) throw new Error("no_fields_to_update");
  if (options.dryRun) return { mode: "dry_run", id, patch };
  const plugin = requirePlugin(live, false);
  return mutateLibrary(plugin, async (library) => {
    const entry = library.items.find((item) => item.id === id);
    if (!entry) throw new Error("material_not_found:" + id);
    Object.assign(entry, patch);
    if (patch.category && !library.categories.includes(patch.category)) library.categories.push(patch.category);
    return { updated: entry };
  });
}

async function remove(vault, input, options, live) {
  const id = String(input.id || "");
  if (!id) throw new Error("id_required");
  if (options.dryRun) return { mode: "dry_run", id, note: "only removes the library registration; the file itself is never deleted" };
  const plugin = requirePlugin(live, false);
  return mutateLibrary(plugin, async (library) => {
    const index = library.items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("material_not_found:" + id);
    const [removed] = library.items.splice(index, 1);
    return { removed, file_kept: removed.path };
  });
}

async function categoryAdd(vault, input, options, live) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("name_required");
  if (options.dryRun) return { mode: "dry_run", name };
  const plugin = requirePlugin(live, false);
  return mutateLibrary(plugin, async (library) => {
    if (!library.categories.includes(name)) library.categories.push(name);
    return { categories: library.categories };
  });
}

async function categoryRemove(vault, input, options, live) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("category_name_required");
  if (options.dryRun) return { mode: "dry_run", would_remove: name };
  const plugin = requirePlugin(live, false);
  return mutateLibrary(plugin, async (library) => {
    if (!library.categories.includes(name)) throw new Error("material_category_not_found:" + name);
    if (library.items.some((item) => item.category === name)) {
      throw new Error("material_category_in_use:" + name);
    }
    library.categories = library.categories.filter((category) => category !== name);
    return { removed: name, categories: library.categories };
  });
}

module.exports = { list, add, update, remove, categoryAdd, categoryRemove };
