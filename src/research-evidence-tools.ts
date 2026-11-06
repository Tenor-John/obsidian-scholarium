// @ts-nocheck
/* Thin desktop-only boundary to the verified Scholarium runtime.  Evidence
 * validation and writes remain in the runtime's reviewed tool modules. */
import {
  SCH_RUNTIME_RELEASE,
  schRuntimeRoot,
  schRuntimeExplain,
} from "./runtime-manager";

export function schEvidenceTools(plugin) {
  // Use this plugin module's Node loader, not window.require. Obsidian may
  // replace window.require while a webview is active.
  const req = require;
  const path = req("node:path");
  const vault = plugin.app.vault.adapter.getBasePath?.();
  if (!vault) throw new Error("证据操作需要桌面端本地 Vault");
  const runtimeRoot = schRuntimeRoot();
  const runtimeState = schRuntimeBootstrap.status(runtimeRoot);
  if (runtimeState.state !== "ready" || runtimeState.activeVersion !== SCH_RUNTIME_RELEASE.version) {
    throw new Error(schRuntimeExplain(new Error(`Scholarium 本机运行时 ${SCH_RUNTIME_RELEASE.version} 没有就绪`)));
  }
  const root = path.join(runtimeRoot, "versions", runtimeState.activeVersion, "core");
  const toolsRoot = path.join(root, "tools");
  const actionRegistryPath = path.join(toolsRoot, "action-registry.js");
  const cachedRegistry = req.cache && req.cache[actionRegistryPath];
  if (cachedRegistry && req("node:fs").existsSync(path.join(toolsRoot, "literature-matrix-actions.js"))) {
    try { cachedRegistry.exports.describe("literature.matrix_process"); }
    catch (_) { delete req.cache[actionRegistryPath]; }
  }
  return {
    path,
    vault,
    root,
    schema: req(path.join(toolsRoot, "schema-objects.js")),
    locator: req(path.join(toolsRoot, "evidence-locator.js")),
    hypotheses: req(path.join(toolsRoot, "hypothesis-store.js")),
    experiments: req(path.join(toolsRoot, "experiment-store.js")),
    legacyExperiments: req(path.join(toolsRoot, "legacy-experiment-adapter.js")),
    proposer: req(path.join(toolsRoot, "evidence-proposer.js")),
    expansion: req(path.join(toolsRoot, "evidence-query-expansion.js")),
    reviewer: req(path.join(toolsRoot, "evidence-agent-review.js")),
    workflow: req(path.join(toolsRoot, "experiment-workflow.js")),
    actions: req(path.join(toolsRoot, "action-registry.js")),
    radarIndex: req(path.join(toolsRoot, "radar-vault-index.js")),
    radarPrune: req(path.join(toolsRoot, "radar-cache-prune.js")),
    queue: req(path.join(toolsRoot, "bridge-action-queue.js")),
  };
}
