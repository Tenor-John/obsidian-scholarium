"use strict";
/**
 * A de-duplication audit that deletes nothing.
 *
 * 226 MB is not worth 50 dangling references, so this reports rather than acts.
 * Each duplicate group is presented with the copy proposed for retention, the
 * links that constrain the choice, and an explicit verdict on whether the group
 * could be reduced safely at all.
 *
 *   node tools/pdf-dedupe-audit.js --inventory pdf-inventory.json [--out audit.md]
 *
 * `safe_to_reduce` means only this: every non-keeper in the group is byte
 * identical to the keeper, has no inbound link of its own, shares no referenced
 * basename, and is not a scan or an encrypted file. Anything short of that is
 * reported as blocked, with the reason, because a copy a note points at is not
 * interchangeable with one nothing references.
 */
const fs = require("fs");
const path = require("path");

const mb = (bytes) => (bytes / 1048576).toFixed(1);

function buildGroups(inventory) {
  const files = inventory.files || [];
  const referenced = new Set();
  for (const f of files)
    if (f.linked_from.length || f.ambiguous_links.length)
      referenced.add(path.posix.basename(f.path).toLowerCase());

  const byHash = new Map();
  for (const f of files) {
    if (!byHash.has(f.sha256)) byHash.set(f.sha256, []);
    byHash.get(f.sha256).push(f);
  }

  const groups = [];
  for (const [sha256, members] of byHash) {
    if (members.length < 2) continue;
    const keeper = members.find((f) => f.classification !== "pdf_exact_duplicate") || members[0];
    const keeperBase = path.posix.basename(keeper.path).toLowerCase();

    const others = members.filter((f) => f !== keeper).map((f) => {
      const base = path.posix.basename(f.path).toLowerCase();
      const blockers = [];
      if (f.linked_from.length) blockers.push("被 " + f.linked_from.length + " 条笔记直接引用");
      if (base !== keeperBase && referenced.has(base)) blockers.push("basename 被引用，删除会断链");
      if (f.ambiguous_links.length) blockers.push("存在歧义引用，无法判定归属");
      if (f.classification === "pdf_scanned_or_encrypted") blockers.push("扫描件或加密件，另行处理");
      return { path: f.path, bytes: f.bytes, blockers };
    });

    const removable = others.filter((o) => !o.blockers.length);
    groups.push({
      sha256,
      doi: keeper.doi || "",
      size: members.length,
      keeper: keeper.path,
      keeper_reason: keeper.linked_from.length
        ? "被 " + keeper.linked_from.length + " 条笔记引用"
        : (/-\d+\.pdf$/.test(keeperBase) ? "组内排序结果" : "未带重复下载后缀"),
      others,
      safe_to_reduce: removable.length,
      blocked: others.length - removable.length,
      reclaimable_bytes: removable.reduce((a, o) => a + o.bytes, 0),
    });
  }
  return groups.sort((a, b) => b.reclaimable_bytes - a.reclaimable_bytes || b.size - a.size);
}

function report(inventory) {
  const groups = buildGroups(inventory);
  const files = inventory.files || [];
  const totals = {
    files: files.length,
    duplicate_groups: groups.length,
    duplicate_copies: groups.reduce((a, g) => a + g.size - 1, 0),
    safely_reducible: groups.reduce((a, g) => a + g.safe_to_reduce, 0),
    blocked: groups.reduce((a, g) => a + g.blocked, 0),
    reclaimable_bytes: groups.reduce((a, g) => a + g.reclaimable_bytes, 0),
    duplicate_bytes: groups.reduce((a, g) => a + g.others.reduce((x, o) => x + o.bytes, 0), 0),
  };
  return { kind: "scholarium-pdf-dedupe-audit", schema_version: 1, action: "none", totals, groups };
}

function toMarkdown(audit) {
  const t = audit.totals;
  const out = [
    "# PDF 去重审计",
    "",
    "> 本清单**不删除、不移动任何文件**。它只说明每一组重复的情况与约束。",
    "",
    "| 指标 | 值 |",
    "|---|---|",
    "| 扫描文件 | " + t.files + " |",
    "| 重复组 | " + t.duplicate_groups + " |",
    "| 重复副本 | " + t.duplicate_copies + " |",
    "| 可安全处理 | **" + t.safely_reducible + "**（" + mb(t.reclaimable_bytes) + " MB） |",
    "| 受约束不可动 | **" + t.blocked + "** |",
    "| 重复占用合计 | " + mb(t.duplicate_bytes) + " MB |",
    "",
    "「可安全处理」= 与保留副本字节完全相同、自身无引用、basename 未被引用、非扫描/加密件。",
    "",
  ];
  for (const g of audit.groups) {
    out.push("## " + (g.doi || g.sha256.slice(0, 12)) + "　×" + g.size);
    out.push("");
    out.push("- 建议保留：`" + g.keeper + "`（" + g.keeper_reason + "）");
    if (g.safe_to_reduce) out.push("- 可安全处理 " + g.safe_to_reduce + " 份，约 " + mb(g.reclaimable_bytes) + " MB");
    if (g.blocked) out.push("- **受约束 " + g.blocked + " 份，不可自动处理**");
    out.push("");
    for (const o of g.others) {
      out.push("  - " + (o.blockers.length ? "🔒 " : "○ ") + "`" + o.path + "`　" + mb(o.bytes) + " MB");
      for (const b of o.blockers) out.push("    - " + b);
    }
    out.push("");
  }
  return out.join("\n");
}

function main() {
  const argv = process.argv;
  let inventoryPath = null, out = null;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--inventory") inventoryPath = argv[++i];
    else if (argv[i] === "--out") out = argv[++i];
    else if (!inventoryPath) inventoryPath = argv[i];
  }
  if (!inventoryPath) {
    console.error("用法：node tools/pdf-dedupe-audit.js --inventory <pdf-inventory.json> [--out <audit.md>]");
    process.exitCode = 64;
    return;
  }
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8"));
  if (inventory.kind !== "scholarium-pdf-inventory") {
    console.error("不是 PDF 盘点清单：" + inventoryPath);
    process.exitCode = 65;
    return;
  }
  const audit = report(inventory);
  if (!out) { process.stdout.write(JSON.stringify(audit, null, 2) + "\n"); return; }
  fs.writeFileSync(path.resolve(out), toMarkdown(audit), "utf8");
  console.error("wrote " + path.resolve(out) + "  " + JSON.stringify(audit.totals));
}
if (require.main === module) main();

module.exports = { report, buildGroups, toMarkdown };
