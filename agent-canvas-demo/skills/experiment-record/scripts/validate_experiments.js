#!/usr/bin/env node
"use strict";

// One canonical Experiment index. Research/Experiments contains schema-v1
// objects and is the only machine-readable source. The old Experiments/
// folder remains visible as legacy notes, but its unrelated frontmatter shape
// can no longer make the canonical panel report schema errors.
const fs = require("node:fs");
const path = require("node:path");
const schema = require("../../../../tools/schema-objects.js");
const experimentStore = require("../../../../tools/experiment-store.js");

function markdownFiles(root) {
  const found = [];
  if (!fs.existsSync(root)) return found;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) found.push(target);
    }
  };
  visit(root);
  return found;
}

function buildIndex(vault) {
  const canonical = experimentStore.loadAll(vault);
  const vaultProblems = schema.validateVault(vault).problems;
  const byPath = new Map();
  for (const problem of vaultProblems) {
    if (!String(problem.path || "").startsWith("Research/Experiments/")) continue;
    const list = byPath.get(problem.path) || [];
    list.push(problem.message);
    byPath.set(problem.path, list);
  }
  const experiments = canonical.map((entry) => {
    const file = path.join(vault, ...entry.path.split("/"));
    const parsed = schema.parseObject(fs.readFileSync(file, "utf8"));
    const canonicalBody = parsed.body.includes(`scholarium-experiment-template:v${experimentStore.CANONICAL_BODY_VERSION}`);
    return {
      path: entry.path,
      uid: entry.object.uid,
      display_id: entry.object.display_id,
      title: entry.object.title,
      status: entry.object.status,
      project_uid: entry.object.project_uid,
      tests_hypotheses: entry.object.tests_hypotheses || [],
      data_origin: schema.experimentProvenance(entry.object),
      produced_evidence: entry.object.produced_evidence || [],
      raw_data_refs: entry.object.raw_data_refs || [],
      errors: byPath.get(entry.path) || [],
      warnings: canonicalBody ? [] : ["正文使用旧版/自由格式；仍可读取，下一次新建不会再产生这种差异"],
    };
  });
  const legacyRoot = path.join(vault, "Experiments");
  const legacy = markdownFiles(legacyRoot).map((file) => path.relative(vault, file).split(path.sep).join("/"));
  const byStatus = {};
  const byOrigin = {};
  for (const item of experiments) {
    byStatus[item.status || "?"] = (byStatus[item.status || "?"] || 0) + 1;
    byOrigin[item.data_origin || "unknown"] = (byOrigin[item.data_origin || "unknown"] || 0) + 1;
  }
  const errorCount = experiments.reduce((sum, item) => sum + item.errors.length, 0);
  return {
    skill: "experiment-record",
    schema: "scholarium-schema-v1",
    canonical_root: "Research/Experiments",
    run_at: new Date().toISOString(),
    count: experiments.length,
    valid: errorCount === 0,
    error_count: errorCount,
    by_status: byStatus,
    by_data_origin: byOrigin,
    experiments,
    legacy: {
      root: fs.existsSync(legacyRoot) ? "Experiments" : null,
      count: legacy.length,
      files: legacy,
      policy: "read-only legacy notes; excluded from schema-v1 validation and formal project state",
    },
  };
}

function main() {
  const vault = path.resolve(process.argv[2] || process.cwd());
  const report = buildIndex(vault);
  const target = path.join(vault, "Research", "experiment-index.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(report, null, 2), "utf8");
  fs.renameSync(temp, target);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  process.exitCode = report.valid ? 0 : 1;
}

if (require.main === module) main();
module.exports = { buildIndex };
