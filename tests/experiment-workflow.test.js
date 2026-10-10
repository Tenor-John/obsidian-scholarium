"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const S = require("../tools/schema-objects");
const H = require("../tools/hypothesis-store");
const X = require("../tools/experiment-store");
const W = require("../tools/experiment-workflow");
const A = require("../tools/action-registry");

const NOW = "2026-08-13T00:00:00.000Z";
const PRJ = "019fef48-5be0-786b-8da5-39a220613712";
function setup() {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), "sch-workflow-"));
  const made = X.saveNew(v, { title: "机制验证", project_uid: PRJ, status: "designed", result: "结果", conclusion: "结论" }, { now: NOW });
  return { v, made };
}
describe("experiment lifecycle", () => {
  it("plans a no-write transition and records a confirmed execution", () => {
    const { v, made } = setup();
    const dry = W.transition(v, made.object.uid, "ready", "样品和对照已就绪", { dryRun: true, now: NOW });
    assert.eq(dry.from, "designed"); assert.eq(dry.to, "ready");
    assert.eq(X.loadAll(v)[0].object.status, "designed");
    const done = W.transition(v, made.object.uid, "ready", "样品和对照已就绪", { now: NOW, by: "user" });
    assert.eq(done.object.status, "ready");
    assert.eq(done.object.status_history.length, 1);
    assert.eq(done.object.status_history[0].reason, "样品和对照已就绪");
  });
  it("rejects skips and requires a reason", () => {
    const { v, made } = setup(); let message = "";
    try { W.transition(v, made.object.uid, "running", "跳过准备", { dryRun: true }); } catch (e) { message = e.message; }
    assert.match(message, /invalid_experiment_transition/);
    message = "";
    try { W.transition(v, made.object.uid, "ready", "", { dryRun: true }); } catch (e) { message = e.message; }
    assert.match(message, /transition_reason_required/);
  });
  it("requires substantive conclusion and evidence for terminal states", () => {
    const { v, made } = setup(); const entry = X.loadAll(v)[0];
    const running = { ...entry.object, status: "analyzing", conclusion: "|" };
    // Refresh the projection too: otherwise the recovery path correctly finds
    // the earlier substantive conclusion still present in the Markdown body.
    X.saveExisting(v, entry.path, running, { refreshBody: true });
    let message = "";
    try { W.transition(v, running.uid, "concluded", "完成分析", { dryRun: true }); } catch (e) { message = e.message; }
    assert.match(message, /conclusion_required/);
  });
  it("rejects a terminal transition while data remain only planned", () => {
    const { v, made } = setup();
    const entry = X.loadAll(v)[0];
    const analyzing = { ...entry.object, status: "analyzing", data_origin: "planned" };
    X.saveExisting(v, made.path, analyzing);
    let message = "";
    try { W.transition(v, analyzing.uid, "concluded", "未登记数据来源", { dryRun: true }); } catch (e) { message = e.message; }
    assert.match(message, /data_required_before_concluded/);
  });
  it("recovers early placeholder fields from the readable Markdown body on an explicit transition", () => {
    const { v, made } = setup();
    const placeholder = {
      ...made.object, status: "analyzing", result: "|", conclusion: "|",
      data_origin: "measured", raw_data_refs: ["Experiments/raw/recovered-run.csv"],
      data_provenance_note: "已取得原始导出，随后修复早期 frontmatter 占位符。",
    };
    X.saveExisting(v, made.path, placeholder);
    const before = X.readRecord(v, { path: made.path, object: placeholder });
    assert.eq(before.object.result, "结果");
    assert.eq(before.object.conclusion, "结论");
    W.transition(v, made.object.uid, "concluded", "已从实验记录正文完成分析", { now: NOW, by: "user" });
    const after = X.loadAll(v)[0].object;
    assert.eq(after.status, "concluded");
    assert.eq(after.result, "结果");
    assert.eq(after.conclusion, "结论");
  });
  it("registry enforces dry-run or explicit human confirmation and writes a manifest", () => {
    const { v, made } = setup();
    const plan = A.run(v, "experiment.transition", { experiment_uid: made.object.uid, to_status: "ready", reason: "就绪" });
    assert.eq(plan.dry_run, true); assert.eq(X.loadAll(v)[0].object.status, "designed");
    let message = "";
    try { A.run(v, "experiment.transition", { experiment_uid: made.object.uid, to_status: "ready", reason: "就绪" }, { dryRun: false }); } catch (e) { message = e.message; }
    assert.match(message, /explicit_confirmation_required/);
    const done = A.run(v, "experiment.transition", { experiment_uid: made.object.uid, to_status: "ready", reason: "就绪" }, { dryRun: false, confirmed: true, now: NOW });
    assert.eq(done.dry_run, false); assert.eq(X.loadAll(v)[0].object.status, "ready");
    assert.ok(fs.existsSync(path.join(v, "Research", "_runs", "actions")));
  });
  it("defines L0-L3 policy but does not release consequential autonomy", () => {
    assert.ok(A.LEVELS.L0 && A.LEVELS.L1 && A.LEVELS.L2 && A.LEVELS.L3);
    assert.eq(A.LEVELS.L2.released, false); assert.eq(A.LEVELS.L3.released, false);
    assert.eq(A.describe("vault.validate").policy.description, "read-only");
  });
});
