"use strict";

/**
 * Read-only migration preflight validator.
 *
 * Usage:
 *   node tools/migration-conservation.js path/to/migration-preflight.json
 *
 * The input is an inventory manifest, never the Vault itself. This command
 * neither creates nor changes files; it only writes a JSON report to stdout.
 */
const fs = require("fs");
const path = require("path");

const TERMINAL_DISPOSITIONS = new Set([
  "migrate",
  "candidate",
  "exclude",
  "retained_settings",
]);
const OBJECT_TYPES = new Set([
  "project",
  "question",
  "hypothesis",
  "paper",
  "evidence",
  "experiment",
]);
const SHA256 = /^[0-9a-f]{64}$/i;
const SENSITIVE_KEY = /(?:api.?key|secret|token|password|passphrase|webdavpass)/i;
const ALLOWED_DATA_EXTRACTION = "rssBoard.articles[].radarScores";

function normalPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function isSafeRelativePath(value) {
  const p = normalPath(value);
  return !!p && !/^[a-z]:\//i.test(p) && !p.startsWith("/") && !p.split("/").includes("..");
}

function hasSensitiveKey(value, at = "") {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    const childAt = at ? at + "." + key : key;
    if (SENSITIVE_KEY.test(key)) return childAt;
    const nested = hasSensitiveKey(child, childAt);
    if (nested) return nested;
  }
  return null;
}

function validatePreflight(manifest) {
  const errors = [];
  const warnings = [];
  const add = (message) => errors.push(message);
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { valid: false, errors: ["manifest 必须是 JSON 对象"], warnings, counts: {} };
  }
  if (manifest.schema_version !== 1) add("schema_version 必须为 1");
  if (manifest.kind !== "scholarium-migration-preflight")
    add("kind 必须为 scholarium-migration-preflight");
  if (!Array.isArray(manifest.sources)) add("sources 必须是数组");
  const sensitive = hasSensitiveKey(manifest);
  if (sensitive) add("清单不得携带凭据字段：" + sensitive);

  const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
  const counts = Object.fromEntries([...TERMINAL_DISPOSITIONS].map((key) => [key, 0]));
  counts.scanned = sources.length;
  const sourcePaths = new Set();
  const targetPaths = new Set();

  sources.forEach((source, index) => {
    const label = "sources[" + index + "]";
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      add(label + " 必须是对象");
      return;
    }
    const sourcePath = normalPath(source.source_path);
    if (!isSafeRelativePath(sourcePath)) add(label + ".source_path 必须是 Vault 相对路径");
    else if (sourcePaths.has(sourcePath)) add("同一来源不可重复记账：" + sourcePath);
    else sourcePaths.add(sourcePath);
    if (!SHA256.test(String(source.source_sha256 || "")))
      add(label + ".source_sha256 必须是 64 位 SHA-256");

    const disposition = source.disposition;
    if (!TERMINAL_DISPOSITIONS.has(disposition))
      add(label + ".disposition 必须是 migrate / candidate / exclude / retained_settings 之一");
    else counts[disposition]++;

    const isDataJson = path.posix.basename(sourcePath).toLowerCase() === "data.json";
    if (isDataJson) {
      if (disposition !== "retained_settings")
        add("data.json 只能作为 retained_settings 保留，禁止整体迁移");
      if (source.target) add("data.json 不得有迁移 target");
      const extraction = source.allowed_extractions || [];
      if (!Array.isArray(extraction) || extraction.some((item) => item !== ALLOWED_DATA_EXTRACTION))
        add("data.json 仅允许声明 " + ALLOWED_DATA_EXTRACTION + " 为提取范围");
    }

    if (disposition === "migrate") {
      const target = source.target;
      if (!target || typeof target !== "object") add(label + ".target 为 migrate 的必填项");
      else {
        if (!OBJECT_TYPES.has(target.type)) add(label + ".target.type 不是 Schema v1 对象类型");
        const targetPath = normalPath(target.target_path);
        if (!isSafeRelativePath(targetPath)) add(label + ".target.target_path 必须是 Vault 相对路径");
        else if (targetPaths.has(targetPath)) add("多个来源不能迁移到同一目标：" + targetPath);
        else targetPaths.add(targetPath);
        if (target.source_sha256 !== source.source_sha256)
          add(label + ".target.source_sha256 必须与来源正文哈希一致");

        /* Attachments travel inside their paper's package. They are not objects:
           schema-v1 §5 leaves Asset's fields unfrozen, so nothing here may carry
           a type. What must be proved instead is that no two of them land on the
           same path — `img-01.png` repeats across papers, and a shared pool
           would silently overwrite. */
        if (target.attachments !== undefined) {
          if (!Array.isArray(target.attachments)) add(label + ".target.attachments 必须是数组");
          else {
            const pkg = targetPath.replace(/\/[^/]+$/, "");
            target.attachments.forEach((item, n) => {
              const at = label + ".target.attachments[" + n + "]";
              if (!item || typeof item !== "object") { add(at + " 必须是对象"); return; }
              if (item.type) add(at + " 不得声明对象类型：Asset 字段尚未冻结");
              const from = normalPath(item.from), to = normalPath(item.to);
              if (!isSafeRelativePath(from)) add(at + ".from 必须是 Vault 相对路径");
              if (!isSafeRelativePath(to)) add(at + ".to 必须是 Vault 相对路径");
              else {
                if (targetPaths.has(to)) add("多个来源不能迁移到同一目标：" + to);
                else targetPaths.add(to);
                // Inside its own paper package, or the per-paper isolation that
                // makes duplicate filenames safe does not actually exist.
                if (!to.startsWith(pkg + "/")) add(at + ".to 必须位于论文包 " + pkg + " 内");
              }
              if (!SHA256.test(String(item.sha256 || ""))) add(at + ".sha256 必须是 64 位 SHA-256");
            });
          }
        }
      }
    } else if (source.target) add(label + " 只有 migrate 项允许 target");

    if (disposition === "candidate" && !String(source.classification || "").trim())
      add(label + ".classification 是 candidate 的必填项");
    if ((disposition === "exclude" || disposition === "retained_settings") && !String(source.reason || "").trim())
      add(label + ".reason 是非迁移项的必填项");
  });

  const declared = manifest.declared_counts || {};
  for (const key of ["scanned", ...TERMINAL_DISPOSITIONS]) {
    if (declared[key] !== counts[key])
      add("declared_counts." + key + " 与实际值不一致（期望 " + counts[key] + "）");
  }
  const terminalTotal = [...TERMINAL_DISPOSITIONS].reduce((sum, key) => sum + counts[key], 0);
  if (terminalTotal !== counts.scanned)
    add("守恒失败：终态 " + terminalTotal + " != 扫描数 " + counts.scanned);
  if (!sources.length) warnings.push("清单为空；这是有效的格式，但没有可验证的迁移范围");

  return { valid: errors.length === 0, errors, warnings, counts };
}

function main(argv) {
  const file = argv[2];
  if (!file) {
    process.stderr.write("用法：node tools/migration-conservation.js <migration-preflight.json>\n");
    return 64;
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    process.stderr.write("无法读取清单：" + error.message + "\n");
    return 65;
  }
  const report = validatePreflight(manifest);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  return report.valid ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv);

module.exports = { validatePreflight, TERMINAL_DISPOSITIONS, ALLOWED_DATA_EXTRACTION };
