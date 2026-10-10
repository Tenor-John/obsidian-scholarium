"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const R = require("../tools/dual-agent-review");

function vault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sch-dual-review-"));
}

function pass(claim) {
  return R.createDisputeRecord({ claim, verdict: "pass", reason: "证据与结论一致，无缺口。" });
}
function revise(claim, gaps) {
  return R.createDisputeRecord({ claim, verdict: "revise", gaps, reason: "结论超出了当前证据支持的范围。" });
}
function reject(claim, gaps) {
  return R.createDisputeRecord({ claim, verdict: "reject", gaps, reason: "核心证据不成立。" });
}

describe("dual-agent-review: dispute record shape", () => {
  it("accepts a well-formed record of each verdict", () => {
    assert.eq(pass("同步条件下信号更强").verdict, "pass");
    assert.eq(revise("同步条件下信号更强", ["缺少对照组数据"]).verdict, "revise");
    assert.eq(reject("同步条件下信号更强", ["核心测量未重复"]).verdict, "reject");
  });

  it("rejects a record with no claim", () => {
    let threw = false;
    try { R.createDisputeRecord({ verdict: "pass", reason: "ok" }); }
    catch (e) { threw = true; assert.match(e.message, /缺少 claim/); }
    assert.ok(threw);
  });

  it("rejects an unrecognised verdict", () => {
    let threw = false;
    try { R.createDisputeRecord({ claim: "x", verdict: "maybe", reason: "ok" }); }
    catch (e) { threw = true; assert.match(e.message, /verdict 必须是 pass \| revise \| reject/); }
    assert.ok(threw);
  });

  it("rejects a record with no reason — a verdict must be reproducible, not a bare opinion", () => {
    let threw = false;
    try { R.createDisputeRecord({ claim: "x", verdict: "pass" }); }
    catch (e) { threw = true; assert.match(e.message, /缺少 reason/); }
    assert.ok(threw);
  });

  it("requires gaps to be non-empty when verdict is revise or reject", () => {
    let threw = false;
    try { R.createDisputeRecord({ claim: "x", verdict: "revise", reason: "ok", gaps: [] }); }
    catch (e) { threw = true; assert.match(e.message, /revise 时 gaps 不能为空/); }
    assert.ok(threw);

    threw = false;
    try { R.createDisputeRecord({ claim: "x", verdict: "reject", reason: "ok" }); }
    catch (e) { threw = true; assert.match(e.message, /reject 时 gaps 不能为空/); }
    assert.ok(threw);
  });
});

describe("dual-agent-review: cycle termination (防死循环)", () => {
  it("stops immediately and passes when every claim in round 1 passes", () => {
    const outcome = R.evaluateCycle([[pass("A"), pass("B")]]);
    assert.eq(outcome.status, "passed");
    assert.eq(outcome.shouldContinue, false);
    assert.eq(outcome.round, 1);
  });

  it("stops immediately on any reject, even mid first round, without waiting for max rounds", () => {
    const outcome = R.evaluateCycle([[pass("A"), reject("B", ["核心测量未重复"])]]);
    assert.eq(outcome.status, "blocked_by_rejection");
    assert.eq(outcome.shouldContinue, false);
  });

  it("continues when some claims still need revision and rounds remain", () => {
    const outcome = R.evaluateCycle([[pass("A"), revise("B", ["缺少对照组"])]], { maxRounds: 3 });
    assert.eq(outcome.status, "revising");
    assert.eq(outcome.shouldContinue, true);
    assert.deepEq(outcome.openClaims, ["B"]);
  });

  it("stops as exhausted once maxRounds is reached, even though each round genuinely narrowed the gap", () => {
    // Different gap text each round — real progress, just never resolved —
    // so this must NOT be mistaken for a stall before the round cap hits.
    const rounds = [
      [revise("A", ["缺口 1：缺少对照组"])],
      [revise("A", ["缺口 2：对照组已补，仍缺重复实验"])],
      [revise("A", ["缺口 3：重复实验已补，统计方法仍存疑"])],
    ];
    const outcome = R.evaluateCycle(rounds, { maxRounds: 3 });
    assert.eq(outcome.status, "exhausted");
    assert.eq(outcome.shouldContinue, false);
    assert.eq(outcome.round, 3);
  });

  it("stops as stalled when the open claim AND its gaps are byte-for-byte identical to the previous round", () => {
    const rounds = [
      [revise("A", ["缺口 1"]), pass("B")],
      [revise("A", ["缺口 1"]), pass("B")],
    ];
    const outcome = R.evaluateCycle(rounds, { maxRounds: 5 });
    assert.eq(outcome.status, "stalled");
    assert.eq(outcome.shouldContinue, false);
    assert.eq(outcome.round, 2);
  });

  it("does not mistake newly-narrowed gaps on the same claim for a stall", () => {
    const rounds = [
      [revise("A", ["缺口 1"])],
      [revise("A", ["缺口 1 已部分修订，仍有一处遗漏"])],
    ];
    const outcome = R.evaluateCycle(rounds, { maxRounds: 5 });
    assert.eq(outcome.status, "revising");
    assert.eq(outcome.shouldContinue, true);
  });

  it("does not confuse a shrinking open-claim set with stalling", () => {
    const rounds = [
      [revise("A", ["缺口 1"]), revise("B", ["缺口 2"])],
      [pass("A"), revise("B", ["缺口 2 已缩小但仍未解决"])],
    ];
    const outcome = R.evaluateCycle(rounds, { maxRounds: 5 });
    assert.eq(outcome.status, "revising");
    assert.eq(outcome.shouldContinue, true);
    assert.deepEq(outcome.openClaims, ["B"]);
  });

  it("defaults maxRounds to 3 when unspecified, matching the design doc's suggested cap", () => {
    assert.eq(R.DEFAULT_MAX_ROUNDS, 3);
  });
});

describe("dual-agent-review: audit log", () => {
  it("writes a readable, atomic JSON log under Research/_runs/review/<skill>/", () => {
    const v = vault();
    const rounds = [[pass("A")]];
    const outcome = R.evaluateCycle(rounds);
    const relPath = R.writeCycleLog(v, {
      skill: "research-weaver", nodeId: "node-042", rounds, outcome,
      now: "2026-08-16T00:00:00.000Z",
    });
    assert.ok(relPath.startsWith("Research/_runs/review/research-weaver/"));
    const written = JSON.parse(fs.readFileSync(path.join(v, ...relPath.split("/")), "utf8"));
    assert.eq(written.skill, "research-weaver");
    assert.eq(written.node_id, "node-042");
    assert.eq(written.outcome.status, "passed");
    assert.eq(written.rounds.length, 1);
  });

  it("requires a skill name and a node id — an anonymous log can't be traced back to what was reviewed", () => {
    const v = vault();
    let threw = false;
    try { R.writeCycleLog(v, { nodeId: "x", rounds: [[pass("A")]], outcome: {} }); }
    catch (e) { threw = true; assert.match(e.message, /需要 skill 名称/); }
    assert.ok(threw);

    threw = false;
    try { R.writeCycleLog(v, { skill: "x", rounds: [[pass("A")]], outcome: {} }); }
    catch (e) { threw = true; assert.match(e.message, /需要 nodeId/); }
    assert.ok(threw);
  });
});
