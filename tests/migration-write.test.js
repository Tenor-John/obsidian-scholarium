"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const tx = require("../tools/migration-transaction");
const writer = require("../tools/migration-write");

const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
function fixture(state = "verified", count = 1) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sch-write-"));
  const vault = path.join(base, "vault"), backups = path.join(base, "backups");
  const relative = "Experiments/WebClips/paper/paper.md", source = path.join(vault, ...relative.split("/"));
  fs.mkdirSync(path.dirname(source), { recursive: true }); fs.mkdirSync(backups, { recursive: true });
  const original = "---\ntype: literature_fulltext\ntitle: \"Paper title\"\nsource: \"https://example.org/paper\"\nauthors:\n  - \"A Author\"\n---\n# Paper title\n\nBody\n";
  fs.writeFileSync(source, original, "utf8");
  fs.writeFileSync(path.join(path.dirname(source), "source.meta.json"), JSON.stringify({ capture_state: state, markdown_source: "rendered_dom", raw: { sha256: "a".repeat(64) }, clean: { sha256: "b".repeat(64) } }), "utf8");
  const sources = [{ source_path: relative, source_sha256: hash(original), disposition: "migrate", target: { type: "paper", target_path: "Research/Papers/paper.md", source_sha256: hash(original) } }];
  const sourceFiles = [source];
  for (let i = 2; i <= count; i++) {
    const nextRelative = `Experiments/WebClips/paper-${i}/paper-${i}.md`, nextSource = path.join(vault, ...nextRelative.split("/"));
    const nextOriginal = original.replace(/Paper title/g, "Paper title " + i).replace(/example\.org\/paper/g, "example.org/paper-" + i);
    fs.mkdirSync(path.dirname(nextSource), { recursive: true });
    fs.writeFileSync(nextSource, nextOriginal, "utf8");
    fs.writeFileSync(path.join(path.dirname(nextSource), "source.meta.json"), JSON.stringify({ capture_state: state, markdown_source: "rendered_dom", raw: { sha256: "a".repeat(64) }, clean: { sha256: "b".repeat(64) } }), "utf8");
    sourceFiles.push(nextSource);
    sources.push({ source_path: nextRelative, source_sha256: hash(nextOriginal), disposition: "migrate", target: { type: "paper", target_path: `Research/Papers/paper-${i}.md`, source_sha256: hash(nextOriginal) } });
  }
  const preflight = { schema_version: 1, kind: "scholarium-migration-preflight", declared_counts: { scanned: count, migrate: count, candidate: 0, exclude: 0, retained_settings: 0 }, sources };
  const preflightPath = path.join(base, "preflight.json"); fs.writeFileSync(preflightPath, JSON.stringify(preflight), "utf8");
  const backupPlan = tx.backupPlan(vault, preflight, preflightPath), backup = tx.executeBackup(backupPlan, backups, preflight);
  return { vault, backups, source, sourceFiles, relative, original, preflight, preflightPath, backup };
}

describe("migration writer", () => {
  it("plans a schema-v1 Paper without writing source or target files", () => {
    const f = fixture(), plan = writer.buildPlan(f.vault, f.preflight, f.preflightPath, f.backup.destination);
    assert.eq(plan.operations.length, 1);
    const op = plan.operations[0];
    assert.eq(op.target_path, "Research/Papers/paper.md");
    assert.match(op.uid, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.ok(fs.existsSync(f.source));
    assert.notOk(fs.existsSync(path.join(f.vault, "Research", "Papers", "paper.md")));
  });

  it("writes target first, journals the deletion, and rolls back the relocation", () => {
    const f = fixture(), plan = writer.buildPlan(f.vault, f.preflight, f.preflightPath, f.backup.destination);
    const result = writer.executePlan(plan, f.backup.destination);
    const target = path.join(f.vault, "Research", "Papers", "paper.md");
    assert.notOk(fs.existsSync(f.source));
    assert.ok(fs.existsSync(target));
    const migrated = fs.readFileSync(target, "utf8");
    assert.match(migrated, /^uid: [0-9a-f-]+/m);
    assert.match(migrated, /^display_id: PAPER-001/m);
    assert.match(migrated, /^type: paper/m);
    assert.match(migrated, /^source_preservation: verified/m);
    assert.match(migrated, /^source_raw_sha256: a{64}/m);
    assert.match(migrated, /# Paper title/);
    assert.eq(result.run.inflight, null);
    const rollback = tx.rollbackPlan(f.vault, f.backup.destination, result.run);
    assert.ok(rollback.valid, rollback.errors.join("; "));
    tx.executeRollback(rollback, f.backup.destination);
    assert.eq(fs.readFileSync(f.source, "utf8"), f.original);
    assert.notOk(fs.existsSync(target));
  });

  it("journals only operations that actually completed, so a partial run can roll back", () => {
    const f = fixture("verified", 2), plan = writer.buildPlan(f.vault, f.preflight, f.preflightPath, f.backup.destination);
    const blockedSource = path.join(f.vault, ...plan.operations[1].source_path.split("/"));
    const realRemove = fs.rmSync;
    fs.rmSync = (target, options) => {
      if (path.resolve(target) === path.resolve(blockedSource)) throw new Error("injected second deletion failure");
      return realRemove(target, options);
    };
    try { writer.executePlan(plan, f.backup.destination); } catch (error) { assert.match(error.message, /injected second deletion failure/); }
    finally { fs.rmSync = realRemove; }
    const runFile = fs.readdirSync(f.backup.destination).find((name) => name.startsWith("migration-run-"));
    const run = JSON.parse(fs.readFileSync(path.join(f.backup.destination, runFile), "utf8"));
    assert.eq(run.state, "failed");
    assert.eq(run.created_paths.length, 2);
    assert.eq(run.deleted_paths.length, 1);
    assert.deepEq(run.inflight, { source_path: plan.operations[1].source_path, target_path: plan.operations[1].target_path, phase: "deleting_source" });
    const rollback = tx.rollbackPlan(f.vault, f.backup.destination, run);
    assert.ok(rollback.valid, rollback.errors.join("; "));
    tx.executeRollback(rollback, f.backup.destination);
    for (const source of f.sourceFiles) assert.ok(fs.existsSync(source));
    assert.notOk(fs.existsSync(path.join(f.vault, "Research", "Papers", "paper.md")));
    assert.notOk(fs.existsSync(path.join(f.vault, "Research", "Papers", "paper-2.md")));
  });

  it("refuses an unverified archive even if a malformed preflight says migrate", () => {
    const f = fixture("suspect");
    let refused = false;
    try { writer.buildPlan(f.vault, f.preflight, f.preflightPath, f.backup.destination); } catch (e) { refused = /不是 verified/.test(e.message); }
    assert.ok(refused);
  });

  it("defers Project relocation unless the operator explicitly includes projects", () => {
    const f = fixture();
    f.preflight.sources[0].target = { type: "project", target_path: "Research/Projects/PRJ-001.md", source_sha256: hash(f.original) };
    fs.writeFileSync(f.preflightPath, JSON.stringify(f.preflight), "utf8");
    const backup = tx.executeBackup(tx.backupPlan(f.vault, f.preflight, f.preflightPath), f.backups, f.preflight);
    const plan = writer.buildPlan(f.vault, f.preflight, f.preflightPath, backup.destination);
    assert.eq(plan.operations.length, 0);
    assert.deepEq(plan.deferred, [{ source_path: f.relative, type: "project", reason: "project_path_compatibility_not_migrated" }]);
  });

  it("refuses a backup that belongs to an older preflight", () => {
    const f = fixture();
    fs.writeFileSync(f.preflightPath, JSON.stringify({ ...f.preflight, generated_at: "changed" }), "utf8");
    let refused = false;
    try { writer.buildPlan(f.vault, f.preflight, f.preflightPath, f.backup.destination); } catch (e) { refused = /不一致/.test(e.message); }
    assert.ok(refused);
  });

  it("extracts a Project thesis from the legacy profile body instead of dropping it", () => {
    const source = "---\ntype: research-project\ntitle: \"Legacy project\"\n---\n<section class=\"rp-thesis\"><p>Mechanism <strong>controls</strong> selectivity.</p></section>";
    const output = writer.transform(source, "project", null, "01927d3f-8a41-7c62-b5e0-9f3a2c1d4e5b", "PRJ-001", "2026-08-10T00:00:00.000Z", "Experiments/Projects/PRJ-001/00_课题画像.md");
    assert.match(output, /^type: project/m);
    assert.match(output, /^thesis: "Mechanism controls selectivity\."/m);
    assert.match(output, /^active_hypothesis_uids: \[\]/m);
    assert.match(output, /^current_problems: \[\]/m);
  });
});
