"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const tx = require("../tools/migration-transaction");

const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sch-transaction-"));
  const vault = path.join(base, "vault"), backups = path.join(base, "backups");
  fs.mkdirSync(path.join(vault, "Experiments", "WebClips", "paper"), { recursive: true });
  fs.mkdirSync(backups, { recursive: true });
  const relative = "Experiments/WebClips/paper/paper.md", source = path.join(vault, ...relative.split("/"));
  fs.writeFileSync(source, "original", "utf8");
  const preflight = {
    schema_version: 1, kind: "scholarium-migration-preflight",
    declared_counts: { scanned: 1, migrate: 1, candidate: 0, exclude: 0, retained_settings: 0 },
    sources: [{ source_path: relative, source_sha256: hash("original"), disposition: "migrate", target: {
      type: "paper", target_path: "Research/Papers/paper.md", source_sha256: hash("original"),
    }}],
  };
  const preflightPath = path.join(base, "preflight.json");
  fs.writeFileSync(preflightPath, JSON.stringify(preflight), "utf8");
  return { vault, backups, relative, source, preflight, preflightPath };
}

describe("migration transaction guard", () => {
  it("plans a read-only backup that covers the exact migrated source", () => {
    const f = fixture(), plan = tx.backupPlan(f.vault, f.preflight, f.preflightPath);
    assert.eq(plan.files.length, 1);
    assert.eq(plan.files[0].path, f.relative);
    assert.notOk(fs.existsSync(path.join(f.backups, "anything")));
  });

  it("refuses stale source bytes and a backup directory inside the vault", () => {
    const f = fixture();
    fs.writeFileSync(f.source, "edited-after-preflight", "utf8");
    let stale = false;
    try { tx.backupPlan(f.vault, f.preflight, f.preflightPath); } catch (e) { stale = /已变化/.test(e.message); }
    assert.ok(stale);
    const clean = fixture(), plan = tx.backupPlan(clean.vault, clean.preflight, clean.preflightPath);
    let inside = false;
    try { tx.executeBackup(plan, path.join(clean.vault, "backup"), clean.preflight); } catch (e) { inside = /Vault 外/.test(e.message); }
    assert.ok(inside);
  });

  it("creates a hash-verified external snapshot only when explicitly executed", () => {
    const f = fixture(), plan = tx.backupPlan(f.vault, f.preflight, f.preflightPath);
    const result = tx.executeBackup(plan, f.backups, f.preflight);
    assert.ok(fs.existsSync(path.join(result.destination, "snapshot.json")));
    assert.eq(fs.readFileSync(path.join(result.destination, "files", ...f.relative.split("/")), "utf8"), "original");
  });

  it("rolls back only journalled paths and refuses to overwrite later edits", () => {
    const f = fixture(), plan = tx.backupPlan(f.vault, f.preflight, f.preflightPath);
    const backup = tx.executeBackup(plan, f.backups, f.preflight);
    fs.writeFileSync(f.source, "migrated-source", "utf8");
    const created = path.join(f.vault, "Research", "Papers", "paper.md");
    fs.mkdirSync(path.dirname(created), { recursive: true });
    fs.writeFileSync(created, "migrated-target", "utf8");
    const run = { kind: "scholarium-migration-run", schema_version: 1, backup_id: backup.snapshot.backup_id,
      created_paths: [{ path: "Research/Papers/paper.md", after_sha256: hash("migrated-target") }],
      modified_paths: [{ path: f.relative, after_sha256: hash("migrated-source") }] };
    const rollback = tx.rollbackPlan(f.vault, backup.destination, run);
    assert.ok(rollback.valid, rollback.errors.join("; "));
    tx.executeRollback(rollback, backup.destination);
    assert.notOk(fs.existsSync(created));
    assert.eq(fs.readFileSync(f.source, "utf8"), "original");
    fs.writeFileSync(f.source, "user-edited-after-migration", "utf8");
    const unsafe = tx.rollbackPlan(f.vault, backup.destination, run);
    assert.notOk(unsafe.valid);
    assert.match(unsafe.errors.join("\n"), /拒绝覆盖/);
  });

  it("backs up attachments alongside the note", () => {
    const f = fixture();
    const assetRel = "Experiments/WebClips/paper/assets/img-01.png";
    fs.mkdirSync(path.join(f.vault, "Experiments", "WebClips", "paper", "assets"), { recursive: true });
    fs.writeFileSync(path.join(f.vault, ...assetRel.split("/")), "png-bytes", "utf8");
    f.preflight.sources[0].target.target_path = "Research/Papers/paper/paper.md";
    f.preflight.sources[0].target.attachments = [
      { from: assetRel, to: "Research/Papers/paper/assets/img-01.png", sha256: hash("png-bytes") },
    ];
    fs.writeFileSync(f.preflightPath, JSON.stringify(f.preflight), "utf8");

    const plan = tx.backupPlan(f.vault, f.preflight, f.preflightPath);
    const asset = plan.files.find((x) => x.path === assetRel);
    assert.ok(asset, "a backup covering only the markdown would restore a paper with no images");
    assert.eq(asset.role, "attachment");
    assert.eq(asset.sha256, hash("png-bytes"));
  });

  it("refuses a rollback when an attachment vanished unexplained", () => {
    const f = fixture();
    const assetRel = "Experiments/WebClips/paper/assets/img-01.png";
    fs.mkdirSync(path.join(f.vault, "Experiments", "WebClips", "paper", "assets"), { recursive: true });
    fs.writeFileSync(path.join(f.vault, ...assetRel.split("/")), "png-bytes", "utf8");
    f.preflight.sources[0].target.target_path = "Research/Papers/paper/paper.md";
    f.preflight.sources[0].target.attachments = [
      { from: assetRel, to: "Research/Papers/paper/assets/img-01.png", sha256: hash("png-bytes") },
    ];
    fs.writeFileSync(f.preflightPath, JSON.stringify(f.preflight), "utf8");
    const backup = tx.executeBackup(tx.backupPlan(f.vault, f.preflight, f.preflightPath), f.backups, f.preflight);

    // The image was moved but the run log only admits the note.
    fs.rmSync(path.join(f.vault, ...assetRel.split("/")));
    fs.rmSync(f.source);
    const run = { kind: "scholarium-migration-run", schema_version: 1, backup_id: backup.snapshot.backup_id,
      deleted_paths: [{ path: f.relative }] };
    const rollback = tx.rollbackPlan(f.vault, backup.destination, run);
    assert.notOk(rollback.valid, "a silently lost image is the same failure as a lost note");
    assert.match(rollback.errors.join("\n"), /运行日志未记录删除/);
  });

  it("restores a source the migration deleted when relocating it", () => {
    const f = fixture(), plan = tx.backupPlan(f.vault, f.preflight, f.preflightPath);
    const backup = tx.executeBackup(plan, f.backups, f.preflight);
    // A relocation creates the target and deletes the original.
    const created = path.join(f.vault, "Research", "Papers", "paper.md");
    fs.mkdirSync(path.dirname(created), { recursive: true });
    fs.writeFileSync(created, "original", "utf8");
    fs.rmSync(f.source);
    const run = { kind: "scholarium-migration-run", schema_version: 1, backup_id: backup.snapshot.backup_id,
      created_paths: [{ path: "Research/Papers/paper.md", after_sha256: hash("original") }],
      deleted_paths: [{ path: f.relative }] };

    const rollback = tx.rollbackPlan(f.vault, backup.destination, run);
    assert.ok(rollback.valid, rollback.errors.join("; "));
    tx.executeRollback(rollback, backup.destination);
    assert.eq(fs.readFileSync(f.source, "utf8"), "original", "the relocated note must come back");
    assert.notOk(fs.existsSync(created));
  });

  it("refuses a rollback whose run log does not admit deleting the source", () => {
    const f = fixture(), plan = tx.backupPlan(f.vault, f.preflight, f.preflightPath);
    const backup = tx.executeBackup(plan, f.backups, f.preflight);
    const created = path.join(f.vault, "Research", "Papers", "paper.md");
    fs.mkdirSync(path.dirname(created), { recursive: true });
    fs.writeFileSync(created, "original", "utf8");
    fs.rmSync(f.source);
    // Same relocation, but the log only mentions what it created. Nothing here
    // would ever restore the source, so a silent "success" would leave the note
    // deleted while reporting the Vault whole.
    const run = { kind: "scholarium-migration-run", schema_version: 1, backup_id: backup.snapshot.backup_id,
      created_paths: [{ path: "Research/Papers/paper.md", after_sha256: hash("original") }] };
    const rollback = tx.rollbackPlan(f.vault, backup.destination, run);
    assert.notOk(rollback.valid, "an unexplained missing source must not pass");
    assert.match(rollback.errors.join("\n"), /运行日志未记录删除/);
  });

  it("will not write over whatever now sits at a path it was told was deleted", () => {
    const f = fixture(), plan = tx.backupPlan(f.vault, f.preflight, f.preflightPath);
    const backup = tx.executeBackup(plan, f.backups, f.preflight);
    fs.writeFileSync(f.source, "something the user put back", "utf8");
    const run = { kind: "scholarium-migration-run", schema_version: 1, backup_id: backup.snapshot.backup_id,
      deleted_paths: [{ path: f.relative }] };
    const rollback = tx.rollbackPlan(f.vault, backup.destination, run);
    assert.notOk(rollback.valid);
    assert.match(rollback.errors.join("\n"), /拒绝覆盖/);
    assert.eq(fs.readFileSync(f.source, "utf8"), "something the user put back");
  });

  it("restores before removing, so an interrupted rollback still has the originals", () => {
    const f = fixture(), plan = tx.backupPlan(f.vault, f.preflight, f.preflightPath);
    const backup = tx.executeBackup(plan, f.backups, f.preflight);
    fs.writeFileSync(f.source, "migrated-source", "utf8");
    const created = path.join(f.vault, "Research", "Papers", "paper.md");
    fs.mkdirSync(path.dirname(created), { recursive: true });
    fs.writeFileSync(created, "migrated-target", "utf8");
    const run = { kind: "scholarium-migration-run", schema_version: 1, backup_id: backup.snapshot.backup_id,
      created_paths: [{ path: "Research/Papers/paper.md", after_sha256: hash("migrated-target") }],
      modified_paths: [{ path: f.relative, after_sha256: hash("migrated-source") }] };
    const rollback = tx.rollbackPlan(f.vault, backup.destination, run);

    // Validation makes a rollback safe to start, not safe to interrupt. Fail
    // the removal step and the original must already be back on disk.
    const realRm = fs.rmSync;
    fs.rmSync = () => { throw new Error("disk full"); };
    let threw = false;
    try { tx.executeRollback(rollback, backup.destination); } catch (e) { threw = true; }
    finally { fs.rmSync = realRm; }
    assert.ok(threw);
    assert.eq(fs.readFileSync(f.source, "utf8"), "original",
      "an interrupted rollback must not leave the original missing");
  });

  it("reports a created path that already vanished instead of staying silent", () => {
    const f = fixture(), plan = tx.backupPlan(f.vault, f.preflight, f.preflightPath);
    const backup = tx.executeBackup(plan, f.backups, f.preflight);
    const run = { kind: "scholarium-migration-run", schema_version: 1, backup_id: backup.snapshot.backup_id,
      created_paths: [{ path: "Research/Papers/paper.md", after_sha256: hash("migrated-target") }] };
    const rollback = tx.rollbackPlan(f.vault, backup.destination, run);
    assert.ok(rollback.valid);
    assert.deepEq(rollback.missing, ["Research/Papers/paper.md"],
      "the operator needs to tell a clean rollback from a Vault that drifted");
  });

  it("rejects a damaged backup before deleting any newly created target", () => {
    const f = fixture(), plan = tx.backupPlan(f.vault, f.preflight, f.preflightPath);
    const backup = tx.executeBackup(plan, f.backups, f.preflight);
    fs.writeFileSync(f.source, "migrated-source", "utf8");
    const created = path.join(f.vault, "Research", "Papers", "paper.md");
    fs.mkdirSync(path.dirname(created), { recursive: true });
    fs.writeFileSync(created, "migrated-target", "utf8");
    fs.writeFileSync(path.join(backup.destination, "files", ...f.relative.split("/")), "damaged", "utf8");
    const run = { kind: "scholarium-migration-run", schema_version: 1, backup_id: backup.snapshot.backup_id,
      created_paths: [{ path: "Research/Papers/paper.md", after_sha256: hash("migrated-target") }],
      modified_paths: [{ path: f.relative, after_sha256: hash("migrated-source") }] };
    const rollback = tx.rollbackPlan(f.vault, backup.destination, run);
    assert.notOk(rollback.valid);
    assert.match(rollback.errors.join("\n"), /备份文件缺失或损坏/);
    assert.ok(fs.existsSync(created), "dry validation must not delete the target");
  });

  it("can clean up a partial relocation when the original bytes never left", () => {
    const f = fixture(), plan = tx.backupPlan(f.vault, f.preflight, f.preflightPath);
    const backup = tx.executeBackup(plan, f.backups, f.preflight);
    const created = path.join(f.vault, "Research", "Papers", "paper.md");
    fs.mkdirSync(path.dirname(created), { recursive: true });
    fs.writeFileSync(created, "migrated-target", "utf8");
    const run = { kind: "scholarium-migration-run", schema_version: 1, backup_id: backup.snapshot.backup_id,
      created_paths: [{ path: "Research/Papers/paper.md", after_sha256: hash("migrated-target") }],
      deleted_paths: [{ path: f.relative }] };
    const rollback = tx.rollbackPlan(f.vault, backup.destination, run);
    assert.ok(rollback.valid, rollback.errors.join("; "));
    tx.executeRollback(rollback, backup.destination);
    assert.notOk(fs.existsSync(created));
    assert.eq(fs.readFileSync(f.source, "utf8"), "original");
  });

  it("refuses an unjournalled target left by an interrupted create step", () => {
    const f = fixture(), plan = tx.backupPlan(f.vault, f.preflight, f.preflightPath);
    const backup = tx.executeBackup(plan, f.backups, f.preflight);
    const created = path.join(f.vault, "Research", "Papers", "paper.md");
    fs.mkdirSync(path.dirname(created), { recursive: true });
    fs.writeFileSync(created, "unrecorded-target", "utf8");
    const run = { kind: "scholarium-migration-run", schema_version: 1, backup_id: backup.snapshot.backup_id,
      created_paths: [], deleted_paths: [], inflight: { source_path: f.relative, target_path: "Research/Papers/paper.md", phase: "creating_target" } };
    const rollback = tx.rollbackPlan(f.vault, backup.destination, run);
    assert.notOk(rollback.valid);
    assert.match(rollback.errors.join("\n"), /目标尚未记入完成日志/);
    assert.eq(fs.readFileSync(created, "utf8"), "unrecorded-target");
  });
});
