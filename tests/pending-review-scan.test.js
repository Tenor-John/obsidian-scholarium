"use strict";
// Tests for tools/pending-review-scan.js — the M4 whole-vault rescan
// (2026-08-26): unscoped drift findings + active decisions carrying a
// trigger_condition, each with a stable marker for the chat's task-dedup
// logic (research-chat-core.js rule 16 / shell-ui.js rule 9).

const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const S = require("../tools/schema-objects");
const X = require("../tools/experiment-store");
const { scanPendingReview, timeblockMarker, decisionMarker, readCheckpoint, writeCheckpoint } = require("../tools/pending-review-scan");

const PRJ = "019fef48-5be0-786b-8da5-39a220613712";

function tmpVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-pending-review-"));
}

function writeTimeblocks(vault, timeblocks) {
  const dir = path.join(vault, ".obsidian", "plugins", "obsidian-scholarium");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({ workspace: { timeblocks } }), "utf8");
}

function makeExperiment(vault, fields) {
  return X.saveNew(vault, { title: "壳厚梯度预筛查", project_uid: PRJ, status: "designed", data_origin: "planned", result: "", conclusion: "", ...fields }).object;
}

function writeDecision(vault, filename, fields) {
  const dec = S.createObject("decision", { project_uid: PRJ, title: "测试决策", decision: "占位", rationale: "测试夹具", ...fields });
  const target = path.join(vault, "Research", "Decisions", filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, S.serializeObject(dec, "\n# " + filename + "\n"), "utf8");
  return dec;
}

describe("pending-review-scan: whole-vault rescan for M4", () => {
  it("reports nothing when there is no drift and no decisions", () => {
    const vault = tmpVault();
    writeTimeblocks(vault, []);
    const report = scanPendingReview(vault);
    assert.eq(report.timeblock_issues.length, 0);
    assert.eq(report.decision_triggers.length, 0);
    assert.eq(report.counts.timeblock_issues, 0);
    assert.eq(report.counts.decision_triggers, 0);
  });

  it("surfaces an unbackfilled timeblock with a stable RESCAN-TB marker", () => {
    const vault = tmpVault();
    const exp = makeExperiment(vault, { status: "designed" });
    writeTimeblocks(vault, [{ id: "t1", date: "2020-01-01", title: "早已过期，从未回填", experimentUid: exp.uid }]);
    const report = scanPendingReview(vault, { today: "2026-08-26" });
    assert.eq(report.timeblock_issues.length, 1);
    assert.eq(report.timeblock_issues[0].marker, timeblockMarker("t1"));
    assert.ok(report.timeblock_issues[0].flags.includes("unbackfilled"));
  });

  it("does not surface a clean linked timeblock", () => {
    const vault = tmpVault();
    const exp = makeExperiment(vault, { status: "running", review_status: "confirmed" });
    writeTimeblocks(vault, [{ id: "t1", date: "2099-01-01", title: "干净的", experimentUid: exp.uid }]);
    const report = scanPendingReview(vault);
    assert.eq(report.timeblock_issues.length, 0);
  });

  it("is not scoped to any single project — findings from every project are included", () => {
    const vault = tmpVault();
    const PRJ2 = "019fef48-5be0-786b-8da5-39a220613713";
    const expA = makeExperiment(vault, { project_uid: PRJ, status: "designed" });
    const expB = makeExperiment(vault, { project_uid: PRJ2, status: "designed" });
    writeTimeblocks(vault, [
      { id: "t1", date: "2020-01-01", title: "属于 PRJ", experimentUid: expA.uid },
      { id: "t2", date: "2020-01-01", title: "属于 PRJ2", experimentUid: expB.uid },
    ]);
    const report = scanPendingReview(vault, { today: "2026-08-26" });
    assert.eq(report.timeblock_issues.length, 2);
  });

  it("surfaces an active decision with a trigger_condition, with a stable RESCAN-DEC marker", () => {
    const vault = tmpVault();
    writeTimeblocks(vault, []);
    const dec = writeDecision(vault, "DEC-001.md", { status: "active", trigger_condition: "壳厚 XPS 数据到齐后重新评估" });
    const report = scanPendingReview(vault);
    assert.eq(report.decision_triggers.length, 1);
    assert.eq(report.decision_triggers[0].marker, decisionMarker(dec.uid));
    assert.eq(report.decision_triggers[0].trigger_condition, "壳厚 XPS 数据到齐后重新评估");
  });

  it("does not surface a decision with no trigger_condition", () => {
    const vault = tmpVault();
    writeTimeblocks(vault, []);
    writeDecision(vault, "DEC-001.md", { status: "active" });
    const report = scanPendingReview(vault);
    assert.eq(report.decision_triggers.length, 0);
  });

  it("does not surface a resolved decision even if it has a trigger_condition", () => {
    const vault = tmpVault();
    writeTimeblocks(vault, []);
    writeDecision(vault, "DEC-001.md", { status: "resolved", trigger_condition: "早已不适用" });
    const report = scanPendingReview(vault);
    assert.eq(report.decision_triggers.length, 0);
  });
});

// 2026-08-26 M4 第二步：把"每次会话第一条消息都提醒"升级成按天/周节流。
// due 的日期数学在这里（JS/服务端）算，不依赖模型口算；readCheckpoint/
// writeCheckpoint 是研究员明确批准的、豁免于"所有写入都要确认"原则的窄口
// 子——只记"什么时候查过"，落在 Research/_runs/rescan/，不碰 data.json、
// 不经 Obsidian 队列。
describe("pending-review-scan: due/checkpoint throttling (M4 第二步)", () => {
  it("is due when there is no checkpoint yet (never checked)", () => {
    const vault = tmpVault();
    writeTimeblocks(vault, []);
    const report = scanPendingReview(vault);
    assert.eq(report.due, true);
    assert.eq(report.last_checked_at, null);
    assert.eq(report.next_due_at, null);
  });

  it("is not due again immediately after a checkpoint was just written, with the default 1-day cadence", () => {
    const vault = tmpVault();
    writeTimeblocks(vault, []);
    const at = writeCheckpoint(vault, "2026-08-26T08:00:00.000Z");
    const report = scanPendingReview(vault, { now: "2026-08-26T09:00:00.000Z" });
    assert.eq(report.due, false);
    assert.eq(report.last_checked_at, at);
    assert.eq(report.cadence_days, 1);
    assert.eq(report.next_due_at, "2026-08-27T08:00:00.000Z");
  });

  it("becomes due again once the cadence window has fully elapsed", () => {
    const vault = tmpVault();
    writeTimeblocks(vault, []);
    writeCheckpoint(vault, "2026-08-25T08:00:00.000Z");
    const report = scanPendingReview(vault, { now: "2026-08-26T08:00:00.000Z" });
    assert.eq(report.due, true);
  });

  it("honors a custom cadence_days (e.g. weekly)", () => {
    const vault = tmpVault();
    writeTimeblocks(vault, []);
    writeCheckpoint(vault, "2026-08-25T00:00:00.000Z");
    const stillWithinWeek = scanPendingReview(vault, { now: "2026-08-27T00:00:00.000Z", cadence_days: 7 });
    assert.eq(stillWithinWeek.due, false);
    assert.eq(stillWithinWeek.cadence_days, 7);
    const pastAWeek = scanPendingReview(vault, { now: "2026-09-02T00:00:00.000Z", cadence_days: 7 });
    assert.eq(pastAWeek.due, true);
  });

  it("readCheckpoint returns null when nothing was ever written", () => {
    const vault = tmpVault();
    assert.eq(readCheckpoint(vault), null);
  });

  it("writeCheckpoint persists across separate reads and defaults to now when no timestamp is given", () => {
    const vault = tmpVault();
    const before = Date.now();
    const written = writeCheckpoint(vault);
    assert.ok(new Date(written).getTime() >= before);
    assert.eq(readCheckpoint(vault), written);
  });
});
