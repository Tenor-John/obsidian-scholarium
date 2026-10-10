"use strict";

/**
 * Normalize legacy schema-v1 Experiment bodies to the canonical readable
 * projection without inventing provenance or invalidating Evidence anchors.
 *
 * Default mode is read-only.  --write requires an external backup directory;
 * every touched file is hash-verified before and after the atomic replacement.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const S = require("./schema-objects");
const X = require("./experiment-store");

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const rel = (root, target) => path.relative(root, target).split(path.sep).join("/");
// Invalidated records may still have historical Evidence locators. Treat their
// result blocks as frozen just like concluded/integrated records; invalidation
// withdraws scientific use, it does not rewrite the historical observation.
const terminal = new Set(["concluded", "integrated", "invalidated"]);
const substantive = (value) => String(value || "").replace(/[|>+\-\s]/g, "").length > 0;

function inside(root, target) {
  const a = path.resolve(root), b = path.resolve(target);
  if (path.parse(a).root.toLowerCase() !== path.parse(b).root.toLowerCase()) return false;
  const relative = path.relative(a, b);
  return relative === "" || (!path.isAbsolute(relative) && !relative.split(path.sep).includes(".."));
}

function sameBlocks(a, b) {
  const compact = (blocks) => blocks.map((block) => ({ id: block.id, text: block.text, quote_hash: block.quote_hash }));
  return JSON.stringify(compact(a)) === JSON.stringify(compact(b));
}

function frontmatterPrefix(text) {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  if (!match) throw new Error("Experiment 缺少 frontmatter");
  return match[0];
}

function buildPlan(vault) {
  const root = path.resolve(vault);
  const objects = S.readVaultObjects(root);
  const evidenceSources = new Set(objects
    .filter((entry) => entry.object.type === "evidence" && entry.object.source_type === "experiment")
    .map((entry) => entry.object.source_uid));
  const items = [];
  for (const entry of objects.filter((item) => item.object.type === "experiment")) {
    const file = path.join(root, ...entry.path.split("/"));
    const before = fs.readFileSync(file, "utf8");
    const parsed = S.parseObject(before);
    if (parsed.body.includes(`scholarium-experiment-template:v${X.CANONICAL_BODY_VERSION}`)) {
      items.push({ path: entry.path, display_id: entry.object.display_id, action: "unchanged", reason: "already_canonical" });
      continue;
    }
    const body = X.canonicalizeBody(parsed.object, parsed.body);
    const oldBlocks = X.resultBlocks(parsed.body);
    const newBlocks = X.resultBlocks(body);
    const linked = evidenceSources.has(entry.object.uid) || (entry.object.produced_evidence || []).length > 0;
    const blocksPreserved = sameBlocks(oldBlocks, newBlocks);
    // Old planned notes without a real structured result were previously
    // interpreted wholesale as Evidence candidates.  Replacing those false
    // blocks with an empty canonical Result section is safe only while no
    // Evidence points at the object.
    const removesFalsePlannedBlocks = !terminal.has(entry.object.status)
      && !substantive(entry.object.result) && !linked && newBlocks.length === 0;
    const safe = blocksPreserved || removesFalsePlannedBlocks;
    const after = frontmatterPrefix(before) + body;
    items.push({
      path: entry.path,
      display_id: entry.object.display_id,
      action: safe ? "normalize" : "blocked",
      reason: safe ? (blocksPreserved ? "result_blocks_preserved" : "remove_false_planned_result_blocks") : "result_blocks_would_change",
      linked_evidence: linked,
      before_sha256: sha256(before),
      after_sha256: sha256(after),
      old_result_blocks: oldBlocks.map((block) => ({ id: block.id, quote_hash: block.quote_hash })),
      new_result_blocks: newBlocks.map((block) => ({ id: block.id, quote_hash: block.quote_hash })),
      content: after,
    });
  }
  return { kind: "scholarium-experiment-body-normalization", schema_version: 1, vault: root, items };
}

function execute(plan, backupRoot) {
  const vault = path.resolve(plan.vault);
  const backup = path.resolve(backupRoot);
  if (inside(vault, backup)) throw new Error("备份目录必须位于 Vault 外部");
  fs.mkdirSync(backup, { recursive: true });
  const changed = [];
  for (const item of plan.items.filter((entry) => entry.action === "normalize")) {
    const target = path.join(vault, ...item.path.split("/"));
    const current = fs.readFileSync(target, "utf8");
    if (sha256(current) !== item.before_sha256) throw new Error("源文件在预览后已变化：" + item.path);
    const backupFile = path.join(backup, ...item.path.split("/"));
    if (fs.existsSync(backupFile)) throw new Error("备份目标已存在，拒绝覆盖：" + backupFile);
    fs.mkdirSync(path.dirname(backupFile), { recursive: true });
    fs.copyFileSync(target, backupFile);
    if (sha256(fs.readFileSync(backupFile)) !== item.before_sha256) throw new Error("备份哈希不一致：" + item.path);
    const temp = target + ".normalize.tmp";
    fs.writeFileSync(temp, item.content, "utf8");
    fs.renameSync(temp, target);
    if (sha256(fs.readFileSync(target)) !== item.after_sha256) throw new Error("写入后哈希不一致：" + item.path);
    changed.push(item.path);
  }
  const manifest = {
    kind: plan.kind,
    schema_version: 1,
    executed_at: new Date().toISOString(),
    vault,
    changed_paths: changed,
    blocked_paths: plan.items.filter((item) => item.action === "blocked").map((item) => ({ path: item.path, reason: item.reason })),
    hashes: plan.items.filter((item) => item.action === "normalize").map((item) => ({ path: item.path, before_sha256: item.before_sha256, after_sha256: item.after_sha256 })),
  };
  fs.writeFileSync(path.join(backup, "normalization-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifest;
}

function main(argv = process.argv.slice(2)) {
  let vault = null, backup = null, write = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--vault") vault = argv[++i];
    else if (argv[i] === "--backup") backup = argv[++i];
    else if (argv[i] === "--write") write = true;
  }
  vault = path.resolve(vault || path.join(__dirname, "..", "..", "..", ".."));
  const plan = buildPlan(vault);
  if (!write) {
    process.stdout.write(JSON.stringify({ ...plan, items: plan.items.map(({ content, ...item }) => item) }, null, 2) + "\n");
    return;
  }
  if (!backup) throw new Error("--write 必须同时提供 Vault 外部的 --backup 目录");
  process.stdout.write(JSON.stringify(execute(plan, backup), null, 2) + "\n");
}

if (require.main === module) main();
module.exports = { inside, sameBlocks, buildPlan, execute };
