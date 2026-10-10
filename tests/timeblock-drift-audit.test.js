"use strict";

const { describe, it, assert } = require("./harness");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { auditTimeblocks } = require("../tools/timeblock-drift-audit");
const X = require("../tools/experiment-store");

const PRJ = "019fef48-5be0-786b-8da5-39a220613712";

function tmpVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-drift-audit-"));
}

function writeTimeblocks(vault, timeblocks) {
  const dir = path.join(vault, ".obsidian", "plugins", "obsidian-scholarium");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({ workspace: { timeblocks } }), "utf8");
}

function makeExperiment(vault, fields) {
  return X.saveNew(vault, { title: "壳厚梯度预筛查", project_uid: PRJ, status: "designed", data_origin: "planned", result: "", conclusion: "", ...fields }).object;
}

describe("timeblock-drift-audit: workspace.timeblocks ↔ Experiment cross-check", () => {
  it("reports nothing when there are no timeblocks", () => {
    const vault = tmpVault();
    writeTimeblocks(vault, []);
    const report = auditTimeblocks(vault);
    assert.eq(report.total_timeblocks, 0);
    assert.eq(report.linked_timeblocks, 0);
    assert.eq(report.drift_count, 0);
    assert.eq(report.findings.length, 0);
  });

  it("does not flag an unlinked timeblock", () => {
    const vault = tmpVault();
    writeTimeblocks(vault, [{ id: "t1", date: "2026-08-01", title: "午饭", experimentUid: null }]);
    const report = auditTimeblocks(vault);
    assert.eq(report.total_timeblocks, 1);
    assert.eq(report.linked_timeblocks, 0);
    assert.eq(report.unlinked_timeblocks, 1);
    assert.eq(report.drift_count, 0);
  });

  it("a linked timeblock pointing at a running, confirmed, unblocked experiment is clean", () => {
    const vault = tmpVault();
    const exp = makeExperiment(vault, { status: "running", review_status: "confirmed" });
    writeTimeblocks(vault, [{ id: "t1", date: "2099-01-01", title: "HER 测试", experimentUid: exp.uid }]);
    const report = auditTimeblocks(vault);
    assert.eq(report.linked_timeblocks, 1);
    assert.eq(report.drift_count, 0);
    assert.eq(report.findings[0].clean, true);
  });

  it("flags blocked + unreviewed for a designed experiment with open blockers", () => {
    const vault = tmpVault();
    // EXP-007-shaped record: status designed, review_status pending, non-empty blocked_by.
    const S = require("../tools/schema-objects");
    const object = S.createObject("experiment", {
      title: "壳厚梯度样品的形貌与组成预筛查草案", project_uid: PRJ, status: "designed",
      data_origin: "planned", data_recorded_by: "user", data_recorded_at: "2026-08-26T00:00:00.000Z", result: "", conclusion: "",
    });
    object.blocked_by = ["路线 C 原始操作与投料定义未核对"];
    object.review_status = "pending";
    const dir = path.join(vault, "Research", "Experiments");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${object.display_id} 测试.md`), S.serializeObject(object, "# body\n"), "utf8");
    writeTimeblocks(vault, [{ id: "t1", date: "2099-01-01", title: "壳厚制样", experimentUid: object.uid }]);
    const report = auditTimeblocks(vault);
    assert.eq(report.findings[0].clean, false);
    assert.ok(report.findings[0].flags.includes("blocked"));
    assert.ok(report.findings[0].flags.includes("unreviewed"));
    assert.ok(!report.findings[0].flags.includes("stale"), "future-dated block must not be stale");
  });

  // 2026-08-26 执行回填：stale 的语义收窄了——现在只在"已经回填过执行状态、
  // 但实验记录没跟上"时才成立。日期过了但压根没人回填，是更基础的
  // unbackfilled，不是 stale。两者互斥（stale 要求 executionStatus 已存在）。
  it("flags unbackfilled when the date has passed and nobody recorded what happened", () => {
    const vault = tmpVault();
    const exp = makeExperiment(vault, { status: "designed" });
    writeTimeblocks(vault, [{ id: "t1", date: "2020-01-01", title: "早已过期，从未回填", experimentUid: exp.uid }]);
    const report = auditTimeblocks(vault, { today: "2026-08-26" });
    assert.ok(report.findings[0].flags.includes("unbackfilled"));
    assert.ok(!report.findings[0].flags.includes("stale"), "unbackfilled and stale are mutually exclusive");
  });

  it("flags stale when execution was backfilled but the experiment record never advanced past designed", () => {
    const vault = tmpVault();
    const exp = makeExperiment(vault, { status: "designed" });
    writeTimeblocks(vault, [{ id: "t1", date: "2020-01-01", title: "已回填但实验记录没跟上", experimentUid: exp.uid, executionStatus: "completed", executionNote: "做完了，见记录" }]);
    const report = auditTimeblocks(vault, { today: "2026-08-26" });
    assert.ok(report.findings[0].flags.includes("stale"));
    assert.ok(!report.findings[0].flags.includes("unbackfilled"));
    assert.eq(report.findings[0].execution_status, "completed");
    assert.eq(report.findings[0].execution_note, "做完了，见记录");
  });

  it("does not flag stale once the experiment has advanced, but still flags an unbackfilled timeblock", () => {
    const vault = tmpVault();
    const exp = makeExperiment(vault, { status: "running", review_status: "confirmed" });
    writeTimeblocks(vault, [{ id: "t1", date: "2020-01-01", title: "早已过期但已推进", experimentUid: exp.uid }]);
    const report = auditTimeblocks(vault, { today: "2026-08-26" });
    assert.ok(!report.findings[0].flags.includes("stale"));
    // Backfill still matters independent of the experiment's own status — an
    // agent scanning "what needs a human answer" should still see this one
    // until someone says what happened with this specific slot.
    assert.ok(report.findings[0].flags.includes("unbackfilled"));
  });

  it("a future-dated linked timeblock with no backfill is not flagged at all", () => {
    const vault = tmpVault();
    const exp = makeExperiment(vault, { status: "designed" });
    writeTimeblocks(vault, [{ id: "t1", date: "2099-01-01", title: "还没到", experimentUid: exp.uid }]);
    const report = auditTimeblocks(vault, { today: "2026-08-26" });
    assert.ok(!report.findings[0].flags.includes("unbackfilled"), "the future is not yet due for backfill");
    assert.ok(!report.findings[0].flags.includes("stale"));
  });

  it("flags orphaned when experimentUid does not resolve to any experiment", () => {
    const vault = tmpVault();
    writeTimeblocks(vault, [{ id: "t1", date: "2026-08-01", title: "指向已删除的实验", experimentUid: "00000000-0000-7000-8000-000000000000" }]);
    const report = auditTimeblocks(vault);
    assert.eq(report.findings[0].flags[0], "orphaned");
    assert.eq(report.findings[0].clean, false);
  });

  it("project_uid scope keeps only findings whose experiment belongs to that project", () => {
    const vault = tmpVault();
    const PRJ2 = "019fef48-5be0-786b-8da5-39a220613713";
    const expA = makeExperiment(vault, { project_uid: PRJ, status: "designed" });
    const expB = makeExperiment(vault, { project_uid: PRJ2, status: "designed" });
    writeTimeblocks(vault, [
      { id: "t1", date: "2099-01-01", title: "属于 PRJ", experimentUid: expA.uid },
      { id: "t2", date: "2099-01-01", title: "属于 PRJ2", experimentUid: expB.uid },
    ]);
    const scoped = auditTimeblocks(vault, { project_uid: PRJ });
    assert.eq(scoped.linked_timeblocks, 1);
    assert.eq(scoped.findings[0].id, "t1");
    assert.eq(scoped.unlinked_timeblocks, null);
  });

  it("an orphaned reference is excluded from a project-scoped audit but present unscoped", () => {
    const vault = tmpVault();
    writeTimeblocks(vault, [{ id: "t1", date: "2026-08-01", title: "已删除的实验", experimentUid: "00000000-0000-7000-8000-000000000000" }]);
    const scoped = auditTimeblocks(vault, { project_uid: PRJ });
    assert.eq(scoped.findings.length, 0);
    const unscoped = auditTimeblocks(vault);
    assert.eq(unscoped.findings.length, 1);
  });

  it("throws when data.json is missing entirely", () => {
    const vault = tmpVault();
    let threw = false;
    try { auditTimeblocks(vault); }
    catch (e) { threw = true; assert.match(e.message, /workspace_state_unreadable/); }
    assert.ok(threw);
  });
});
