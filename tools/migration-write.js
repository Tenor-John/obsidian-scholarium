"use strict";

/*
 * Schema-v1 migration writer. This intentionally has no "best effort" mode:
 * it writes only preflight-approved Paper/Project files, only with a matching
 * external backup, and only after --execute. The journal records only actions
 * that have completed; a separate inflight marker makes an interrupted step
 * auditable without pretending that it happened.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { validatePreflight } = require("./migration-conservation");
const { safeVaultPath } = require("./migration-transaction");

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const fileHash = (file) => sha256(fs.readFileSync(file));
const slash = (p) => String(p || "").replace(/\\/g, "/").replace(/^\.\//, "");
const quote = (value) => JSON.stringify(String(value || ""));

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new Error("无法读取" + label + "：" + error.message); }
}
function splitFrontmatter(text) {
  const hit = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  return hit ? { frontmatter: hit[1], body: text.slice(hit[0].length) } : { frontmatter: "", body: text };
}
function parseFrontmatter(text) {
  const result = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!match) continue;
    const key = match[1], value = match[2].trim();
    if (value === "") {
      const values = [];
      while (i + 1 < lines.length && /^\s+-\s+/.test(lines[i + 1])) values.push(lines[++i].replace(/^\s+-\s+/, "").replace(/^["']|["']$/g, ""));
      result[key] = values;
    } else result[key] = value.replace(/^["']|["']$/g, "");
  }
  return result;
}
function omitKeys(frontmatter, keys) {
  const kept = [], lines = frontmatter.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z0-9_-]+):/.exec(lines[i]);
    if (!match || !keys.has(match[1])) { kept.push(lines[i]); continue; }
    while (i + 1 < lines.length && /^\s+/.test(lines[i + 1])) i++;
  }
  return kept.join("\n").replace(/^\s*\n|\n\s*$/g, "");
}
function htmlText(value) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&quot;/gi, '"').replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ").trim();
}
function projectThesis(body) {
  const section = /<section\b[^>]*\brp-thesis\b[^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(body);
  return htmlText(section && section[1]);
}
function uuidV7() {
  const bytes = crypto.randomBytes(16), time = BigInt(Date.now());
  for (let i = 5; i >= 0; i--) bytes[i] = Number((time >> BigInt((5 - i) * 8)) & 255n);
  bytes[6] = 112 | (bytes[6] & 15); bytes[8] = 128 | (bytes[8] & 63);
  const hex = bytes.toString("hex");
  return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
}
function readSnapshot(backupDir, vault, preflightPath) {
  const snapshot = readJson(path.join(backupDir, "snapshot.json"), "备份快照");
  if (snapshot.kind !== "scholarium-migration-backup" || snapshot.schema_version !== 1) throw new Error("不是受支持的迁移备份快照");
  if (path.resolve(snapshot.vault) !== path.resolve(vault)) throw new Error("备份不属于当前 Vault");
  if (snapshot.preflight_sha256 !== fileHash(preflightPath)) throw new Error("备份对应的 preflight 与当前文件不一致");
  return snapshot;
}
function verifiedSourceMeta(vault, sourcePath) {
  const folder = path.dirname(safeVaultPath(vault, sourcePath));
  const file = path.join(folder, "source.meta.json");
  const meta = readJson(file, "来源元数据");
  if (meta.capture_state !== "verified") throw new Error("来源不是 verified，拒绝迁移：" + sourcePath);
  if (!meta.raw || !meta.clean || !/^[0-9a-f]{64}$/i.test(meta.raw.sha256 || "") || !/^[0-9a-f]{64}$/i.test(meta.clean.sha256 || ""))
    throw new Error("verified 来源缺少可审计哈希：" + sourcePath);
  return { folder, meta };
}
function transform(source, type, metadata, uid, displayId, now, sourcePath) {
  const split = splitFrontmatter(source), old = parseFrontmatter(split.frontmatter);
  const remove = new Set(["uid", "display_id", "schema_version", "type", "created_at", "updated_at", "source_raw_sha256", "source_clean_sha256", "markdown_source", "source_archive_path", "source_preservation", "thesis", "active_hypothesis_uids", "legacy_hypothesis_summaries", "current_problems", "methods_needed", "excluded_topics"]);
  const schema = [
    "uid: " + uid,
    "display_id: " + displayId,
    "schema_version: 1",
    "type: " + type,
    "created_at: " + quote(now),
    "updated_at: " + quote(now),
    "migration_source_path: " + quote(sourcePath),
  ];
  if (type === "paper") {
    if (!old.title || !old.source) throw new Error("Paper 缺少 title 或 source：" + sourcePath);
    schema.push(
      "source_raw_sha256: " + metadata.raw.sha256,
      "source_clean_sha256: " + metadata.clean.sha256,
      "markdown_source: " + (metadata.markdown_source || "rendered_dom"),
      "source_archive_path: " + quote(path.dirname(sourcePath)),
      "source_preservation: verified",
    );
  } else if (type === "project") {
    if (!old.title) schema.push("title: " + quote(path.basename(sourcePath, ".md")));
    const thesis = old.thesis || projectThesis(split.body);
    if (!thesis) throw new Error("Project 缺少可迁移的 thesis：" + sourcePath);
    schema.push(
      "thesis: " + quote(thesis),
      "active_hypothesis_uids: []",
      "legacy_hypothesis_summaries: []",
      "current_problems: []",
      "methods_needed: []",
      "excluded_topics: []",
    );
  } else throw new Error("写入器尚不支持的对象类型：" + type);
  const preserved = omitKeys(split.frontmatter, remove);
  return "---\n" + schema.join("\n") + (preserved ? "\n" + preserved : "") + "\n---\n" + split.body;
}
function displayIds(vault, types) {
  const used = { paper: new Set(), project: new Set() };
  const roots = [path.join(vault, "Research", "Papers"), path.join(vault, "Research", "Projects")];
  for (const root of roots) if (fs.existsSync(root)) for (const name of fs.readdirSync(root)) {
    if (!name.endsWith(".md")) continue;
    const text = fs.readFileSync(path.join(root, name), "utf8"), id = /^display_id:\s*([^\s]+)/m.exec(text);
    if (id) { if (/^PAPER-\d+$/i.test(id[1])) used.paper.add(id[1]); if (/^PRJ-\d+$/i.test(id[1])) used.project.add(id[1]); }
  }
  const next = (type) => {
    const prefix = type === "paper" ? "PAPER" : "PRJ";
    let n = 1, id;
    do { id = prefix + "-" + String(n++).padStart(3, "0"); } while (used[type].has(id));
    used[type].add(id); return id;
  };
  return next;
}
function buildPlan(vault, preflight, preflightPath, backupDir, options = {}) {
  const report = validatePreflight(preflight);
  if (!report.valid) throw new Error("preflight 未通过守恒校验：" + report.errors.join("；"));
  const snapshot = readSnapshot(backupDir, vault, preflightPath);
  const backedUp = new Map((snapshot.files || []).map((item) => [slash(item.path), item]));
  const allowedTypes = new Set(options.includeProjects ? ["paper", "project"] : ["paper"]);
  const nextDisplayId = displayIds(vault), knownUids = new Set(), operations = [], deferred = [], now = new Date().toISOString();
  for (const item of preflight.sources.filter((source) => source.disposition === "migrate").sort((a, b) => a.target.target_path.localeCompare(b.target.target_path))) {
    if (!allowedTypes.has(item.target.type)) {
      deferred.push({ source_path: slash(item.source_path), type: item.target.type, reason: "project_path_compatibility_not_migrated" });
      continue;
    }
    const sourcePath = slash(item.source_path), targetPath = slash(item.target.target_path), source = safeVaultPath(vault, sourcePath), target = safeVaultPath(vault, targetPath);
    if (!backedUp.has(sourcePath)) throw new Error("备份未覆盖迁移来源：" + sourcePath);
    if (!fs.existsSync(source) || fileHash(source) !== item.source_sha256) throw new Error("来源在 preflight 后已变化：" + sourcePath);
    if (fs.existsSync(target)) throw new Error("目标已存在，写入器拒绝覆盖：" + targetPath);
    let uid; do { uid = uuidV7(); } while (knownUids.has(uid)); knownUids.add(uid);
    const meta = item.target.type === "paper" ? verifiedSourceMeta(vault, sourcePath).meta : null;
    const output = transform(fs.readFileSync(source, "utf8"), item.target.type, meta, uid, nextDisplayId(item.target.type), now, sourcePath);
    const attachments = (item.target.attachments || []).map((a) => {
      const from = slash(a.from), to = slash(a.to), fromAbs = safeVaultPath(vault, from);
      if (!backedUp.has(from)) throw new Error("备份未覆盖随行附件：" + from);
      if (!fs.existsSync(fromAbs) || fileHash(fromAbs) !== a.sha256) throw new Error("附件在 preflight 后已变化：" + from);
      if (fs.existsSync(safeVaultPath(vault, to))) throw new Error("附件目标已存在，写入器拒绝覆盖：" + to);
      return { from, to, sha256: a.sha256 };
    });
    operations.push({ source_path: sourcePath, target_path: targetPath, type: item.target.type, uid, after_sha256: sha256(output), output, attachments });
  }
  return { kind: "scholarium-migration-write-plan", vault: path.resolve(vault), backup_id: snapshot.backup_id, preflight_sha256: snapshot.preflight_sha256, created_at: now, operations, deferred };
}
function writeJournal(backupDir, journal) {
  const file = path.join(backupDir, "migration-run-" + journal.run_id + ".json"), temporary = file + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(journal, null, 2) + "\n", "utf8"); fs.renameSync(temporary, file); return file;
}
function executePlan(plan, backupDir) {
  const run = { kind: "scholarium-migration-run", schema_version: 1, run_id: crypto.randomBytes(8).toString("hex"), backup_id: plan.backup_id, preflight_sha256: plan.preflight_sha256, started_at: new Date().toISOString(), state: "prepared",
    created_paths: [], modified_paths: [], deleted_paths: [], inflight: null };
  const journal = writeJournal(backupDir, run);
  try {
    for (const op of plan.operations) {
      const target = safeVaultPath(plan.vault, op.target_path), source = safeVaultPath(plan.vault, op.source_path), temporary = target + ".scholarium-migration-tmp";
      if (fs.existsSync(target) || fs.existsSync(temporary)) throw new Error("目标在执行期间出现，拒绝覆盖：" + op.target_path);
      run.inflight = { source_path: op.source_path, target_path: op.target_path, phase: "creating_target" };
      writeJournal(backupDir, run);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(temporary, op.output, "utf8");
      if (fileHash(temporary) !== op.after_sha256) throw new Error("写入后哈希不一致：" + op.target_path);
      fs.renameSync(temporary, target); // target first: an interruption never loses the source
      run.created_paths.push({ path: op.target_path, after_sha256: op.after_sha256 });

      /* Every attachment is copied and journalled before anything is deleted,
         for the same reason the note is: an interruption may leave duplicates,
         never a gap. A journal that omitted these would let rollback report
         success while the paper's images stayed moved. */
      for (const a of op.attachments || []) {
        const to = safeVaultPath(plan.vault, a.to), from = safeVaultPath(plan.vault, a.from);
        const tmp = to + ".scholarium-migration-tmp";
        if (fs.existsSync(to) || fs.existsSync(tmp)) throw new Error("附件目标在执行期间出现，拒绝覆盖：" + a.to);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, tmp);
        if (fileHash(tmp) !== a.sha256) throw new Error("附件写入后哈希不一致：" + a.to);
        fs.renameSync(tmp, to);
        run.created_paths.push({ path: a.to, after_sha256: a.sha256 });
        writeJournal(backupDir, run);
      }

      run.inflight = { source_path: op.source_path, target_path: op.target_path, phase: "deleting_source" };
      writeJournal(backupDir, run);
      fs.rmSync(source, { force: false });
      run.deleted_paths.push({ path: op.source_path });
      writeJournal(backupDir, run);
      for (const a of op.attachments || []) {
        fs.rmSync(safeVaultPath(plan.vault, a.from), { force: false });
        run.deleted_paths.push({ path: a.from });
        writeJournal(backupDir, run);
      }
      // The now-empty `assets/` directory stays: removing it would be a deletion
      // rollback has no way to undo, and an empty folder costs nothing.
      run.inflight = null;
      writeJournal(backupDir, run);
    }
    run.state = "completed"; run.completed_at = new Date().toISOString(); writeJournal(backupDir, run);
    return { journal, run };
  } catch (error) { run.state = "failed"; run.failed_at = new Date().toISOString(); run.error = error.message; writeJournal(backupDir, run); throw error; }
}
function parseArgs(argv) {
  const out = { execute: false, includeProjects: false };
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--execute") out.execute = true;
    else if (key === "--include-projects") out.includeProjects = true;
    else if (key === "--vault") out.vault = argv[++i];
    else if (key === "--preflight") out.preflight = argv[++i];
    else if (key === "--backup") out.backup = argv[++i];
  }
  return out;
}
const USAGE = "Usage: node tools/migration-write.js --vault <vault> --preflight <file> --backup <backup-dir> [--execute] [--include-projects]";
function main(argv) {
  const args = parseArgs(argv); if (!args.vault || !args.preflight || !args.backup) { console.error(USAGE); return 64; }
  try {
    const preflight = readJson(args.preflight, "preflight"), plan = buildPlan(args.vault, preflight, args.preflight, args.backup, args);
    process.stdout.write(JSON.stringify(args.execute ? executePlan(plan, args.backup) : { ...plan, operations: plan.operations.map(({ output, ...op }) => op) }, null, 2) + "\n"); return 0;
  } catch (error) { process.stderr.write(error.message + "\n"); return 1; }
}
if (require.main === module) process.exitCode = main(process.argv);
module.exports = { buildPlan, executePlan, transform, uuidV7, splitFrontmatter, parseFrontmatter, projectThesis };
