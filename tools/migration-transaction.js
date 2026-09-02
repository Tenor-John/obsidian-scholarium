"use strict";

/* Transaction guard for a future migration writer. Both modes are dry-run
   unless --execute is explicit. Backups must live outside the Vault. */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { validatePreflight } = require("./migration-conservation");

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");
const fileHash = (file) => sha256(fs.readFileSync(file));
const slash = (p) => String(p || "").replace(/\\/g, "/").replace(/^\.\//, "");

function isInside(root, target) {
  const a = path.resolve(root), b = path.resolve(target);
  if (path.parse(a).root.toLowerCase() !== path.parse(b).root.toLowerCase()) return false;
  const relative = path.relative(a, b);
  return relative === "" || (!path.isAbsolute(relative) && !relative.split(path.sep).includes(".."));
}
function safeVaultPath(vault, relative) {
  const normalized = slash(relative);
  if (!normalized || path.isAbsolute(normalized) || /^[a-z]:\//i.test(normalized) || normalized.split("/").includes(".."))
    throw new Error("非法 Vault 相对路径：" + relative);
  const absolute = path.resolve(vault, normalized);
  if (!isInside(vault, absolute)) throw new Error("路径越出 Vault：" + relative);
  return absolute;
}
function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { throw new Error("无法读取" + label + "：" + error.message); }
}

function backupPlan(vault, preflight, preflightPath) {
  const report = validatePreflight(preflight);
  if (!report.valid) throw new Error("preflight 未通过守恒校验：" + report.errors.join("；"));
  const entries = new Map();
  for (const source of preflight.sources.filter((item) => item.disposition === "migrate")) {
    entries.set(slash(source.source_path), { path: slash(source.source_path), role: "source", expected_sha256: source.source_sha256 });
    const target = slash(source.target.target_path), targetAbsolute = safeVaultPath(vault, target);
    if (fs.existsSync(targetAbsolute) && !entries.has(target)) entries.set(target, { path: target, role: "preexisting_target" });
    /* Attachments move too, so they need the same protection as the note. A
       backup that covers only the markdown would restore a paper whose images
       are gone — the note would come back intact and look fine. */
    for (const item of source.target.attachments || []) {
      const from = slash(item.from);
      if (!entries.has(from)) entries.set(from, { path: from, role: "attachment", expected_sha256: item.sha256 });
      const to = slash(item.to), toAbsolute = safeVaultPath(vault, to);
      if (fs.existsSync(toAbsolute) && !entries.has(to)) entries.set(to, { path: to, role: "preexisting_target" });
    }
  }
  const files = [];
  for (const entry of entries.values()) {
    const absolute = safeVaultPath(vault, entry.path);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new Error("要备份的文件不存在或不是文件：" + entry.path);
    const actual = fileHash(absolute);
    if (entry.expected_sha256 && actual !== entry.expected_sha256) throw new Error("来源在 preflight 后已变化，拒绝备份：" + entry.path);
    files.push({ path: entry.path, role: entry.role, sha256: actual, bytes: fs.statSync(absolute).size });
  }
  return { kind: "scholarium-migration-backup-plan", vault: path.resolve(vault), preflight_path: path.resolve(preflightPath), preflight_sha256: fileHash(preflightPath), files };
}

function executeBackup(plan, backupRoot, preflight) {
  const root = path.resolve(backupRoot);
  if (isInside(plan.vault, root)) throw new Error("备份目录必须在 Vault 外：" + root);
  const id = new Date().toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomBytes(4).toString("hex");
  const destination = path.join(root, "scholarium-migration-" + id);
  if (fs.existsSync(destination)) throw new Error("备份目录已存在：" + destination);
  fs.mkdirSync(destination, { recursive: true });
  try {
    for (const entry of plan.files) {
      const from = safeVaultPath(plan.vault, entry.path), to = path.join(destination, "files", ...entry.path.split("/"));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      if (fileHash(to) !== entry.sha256) throw new Error("备份哈希校验失败：" + entry.path);
    }
    const snapshot = { kind: "scholarium-migration-backup", schema_version: 1, backup_id: id, created_at: new Date().toISOString(), vault: plan.vault, preflight_sha256: plan.preflight_sha256, files: plan.files };
    fs.writeFileSync(path.join(destination, "snapshot.json"), JSON.stringify(snapshot, null, 2) + "\n", "utf8");
    fs.writeFileSync(path.join(destination, "preflight.json"), JSON.stringify(preflight, null, 2) + "\n", "utf8");
    return { destination, snapshot };
  } catch (error) { fs.rmSync(destination, { recursive: true, force: true }); throw error; }
}

function rollbackPlan(vault, backupDir, run) {
  const snapshot = readJson(path.join(backupDir, "snapshot.json"), "备份快照");
  if (snapshot.kind !== "scholarium-migration-backup" || snapshot.schema_version !== 1) throw new Error("不是受支持的迁移备份快照");
  if (!run || run.kind !== "scholarium-migration-run" || run.schema_version !== 1) throw new Error("不是受支持的迁移运行日志");
  if (run.backup_id !== snapshot.backup_id) throw new Error("运行日志不属于这个备份");
  if (path.resolve(snapshot.vault) !== path.resolve(vault)) throw new Error("备份不属于当前 Vault");
  const backedUp = new Map((snapshot.files || []).map((item) => [slash(item.path), item]));
  const errors = [], remove = [], restore = [], missing = [];

  /* Restore one backed-up file, whether it was overwritten or deleted.
     `expectAfter` is null for a deletion: there is nothing left to compare. */
  const planRestore = (item, expectAfter) => {
    const relative = slash(item.path), original = backedUp.get(relative);
    if (!original) { errors.push("备份中找不到待恢复文件：" + relative); return; }
    try {
      const absolute = safeVaultPath(vault, relative);
      if (expectAfter === null) {
        // A power loss can happen after the target was written but before the
        // source was removed. If the original bytes are still present, they
        // are already restored; any different bytes remain unsafe to touch.
        if (fs.existsSync(absolute)) {
          if (fileHash(absolute) !== original.sha256)
            errors.push("运行日志称此路径已删除，但现在有不同文件，拒绝覆盖：" + relative);
          return;
        }
      } else if (!fs.existsSync(absolute) || fileHash(absolute) !== expectAfter) {
        errors.push("已修改文件不再是本次迁移版本，拒绝覆盖：" + relative);
        return;
      }
      const backupFile = path.join(backupDir, "files", ...relative.split("/"));
      if (!fs.existsSync(backupFile) || fileHash(backupFile) !== original.sha256)
        errors.push("备份文件缺失或损坏：" + relative);
      else restore.push({ path: relative, absolute, original });
    } catch (error) { errors.push(error.message); }
  };

  for (const item of run.created_paths || []) {
    const relative = slash(item.path);
    try {
      const absolute = safeVaultPath(vault, relative);
      // Already gone is not an error — but stay quiet about it and the operator
      // cannot tell a clean rollback from a Vault that drifted underneath.
      if (!fs.existsSync(absolute)) { missing.push(relative); continue; }
      if (fileHash(absolute) !== item.after_sha256) errors.push("新建文件已被用户修改，拒绝删除：" + relative);
      else remove.push({ path: relative, absolute });
    } catch (error) { errors.push(error.message); }
  }
  for (const item of run.modified_paths || []) planRestore(item, item.after_sha256);
  for (const item of run.deleted_paths || []) planRestore(item, null);

  /* A migration that relocates a note deletes the original. If the run log does
     not declare that deletion, nothing above would ever restore the file — and
     the rollback would report success while the note stayed gone. Conservation
     applies here exactly as it does to the preflight: every backed-up source
     must be accounted for. */
  const journalled = new Set([
    ...(run.created_paths || []), ...(run.modified_paths || []), ...(run.deleted_paths || []),
  ].map((item) => slash(item.path)));
  for (const file of snapshot.files || []) {
    // Attachments are moved exactly like the note, so a vanished attachment
    // that the log does not explain is the same failure as a vanished note.
    if (file.role !== "source" && file.role !== "attachment") continue;
    const relative = slash(file.path);
    if (journalled.has(relative)) continue;
    try {
      if (!fs.existsSync(safeVaultPath(vault, relative)))
        errors.push("备份来源已从 Vault 消失，但运行日志未记录删除：" + relative);
    } catch (error) { errors.push(error.message); }
  }

  /* A process can die after writing an inflight marker but before it records
     the completed action.  `creating_target` is the one ambiguous phase: an
     unjournalled target may exist, and automatic rollback must not silently
     leave it behind.  The later deletion phase is covered by the completed
     target record plus the source-conservation check above. */
  if (run.inflight && run.inflight.phase === "creating_target") {
    try {
      const target = safeVaultPath(vault, run.inflight.target_path);
      if (fs.existsSync(target)) errors.push("运行中断于创建目标；目标尚未记入完成日志，拒绝自动回滚：" + run.inflight.target_path);
    } catch (error) { errors.push(error.message); }
  }

  return { valid: errors.length === 0, errors, snapshot, remove, restore, missing };
}

function executeRollback(plan, backupDir) {
  if (!plan.valid) throw new Error("回滚前置校验失败：" + plan.errors.join("；"));
  /* Restore before removing. Validation makes a rollback safe to start, not
     safe to interrupt: power loss or a full disk can still stop it halfway.
     Restoring first means an interrupted run leaves the originals back with
     some migration output still lying around — recoverable. Removing first
     would leave the originals deleted and not yet restored. */
  for (const item of plan.restore) {
    const from = path.join(backupDir, "files", ...item.path.split("/"));
    const temporary = item.absolute + ".scholarium-rollback-tmp";
    fs.mkdirSync(path.dirname(item.absolute), { recursive: true }); // the deleted case
    fs.copyFileSync(from, temporary); fs.renameSync(temporary, item.absolute);
  }
  for (const item of plan.remove) fs.rmSync(item.absolute, { force: false });
  return { removed: plan.remove.map((item) => item.path), restored: plan.restore.map((item) => item.path) };
}

function parseArgs(argv) {
  const out = { execute: false };
  for (let i = 3; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--execute") out.execute = true;
    else if (key === "--vault") out.vault = argv[++i];
    else if (key === "--preflight") out.preflight = argv[++i];
    else if (key === "--backup-root") out.backupRoot = argv[++i];
    else if (key === "--backup") out.backup = argv[++i];
    else if (key === "--run") out.run = argv[++i];
  }
  return out;
}
const USAGE = `Usage:
  node tools/migration-transaction.js backup --vault <vault> --preflight <file> --backup-root <outside-vault> [--execute]
  node tools/migration-transaction.js rollback --vault <vault> --backup <backup-dir> --run <migration-run.json> [--execute]

Without --execute the command emits a plan and writes nothing. Backups must be outside the Vault.

The migration run log must declare every path it touched under created_paths,
modified_paths or deleted_paths. A relocation deletes its source; leave that out
and rollback has nothing to restore from.`;
function main(argv) {
  const mode = argv[2], args = parseArgs(argv);
  if (!mode || mode === "--help" || mode === "-h") { console.log(USAGE); return 0; }
  try {
    if (mode === "backup") {
      if (!args.vault || !args.preflight || !args.backupRoot) throw new Error("backup 缺少必要参数");
      const preflight = readJson(args.preflight, "preflight"), plan = backupPlan(args.vault, preflight, args.preflight);
      process.stdout.write(JSON.stringify(args.execute ? executeBackup(plan, args.backupRoot, preflight) : plan, null, 2) + "\n"); return 0;
    }
    if (mode === "rollback") {
      if (!args.vault || !args.backup || !args.run) throw new Error("rollback 缺少必要参数");
      const plan = rollbackPlan(args.vault, args.backup, readJson(args.run, "运行日志"));
      process.stdout.write(JSON.stringify(args.execute ? executeRollback(plan, args.backup) : plan, null, 2) + "\n"); return plan.valid ? 0 : 1;
    }
    throw new Error("未知模式：" + mode);
  } catch (error) { process.stderr.write(error.message + "\n"); return 1; }
}
if (require.main === module) process.exitCode = main(process.argv);
module.exports = { backupPlan, executeBackup, rollbackPlan, executeRollback, isInside, safeVaultPath };
