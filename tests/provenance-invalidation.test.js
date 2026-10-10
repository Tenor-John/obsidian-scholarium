"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const S = require("../tools/schema-objects");
const H = require("../tools/hypothesis-store");
const A = require("../tools/action-registry");
const RS = require("../tools/research-state");

const NOW = "2026-09-09T10:00:00.000Z";
const LATER = "2026-09-09T11:00:00.000Z";
const PRJ = "019fef48-5be0-786b-8da5-39a220613712";
const HYP = "019fef48-5be1-79a0-82ad-2770965f8be4";
const EXP = "019fef48-5be2-7e08-90af-b24d6d796866";
const EVD = "019fef48-5be3-7163-96ef-e4c61a51dbe5";
const REJECTED_EVD = "019fef48-5be4-7ec1-b539-57058590597f";

function fixture() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "sch-provenance-invalidation-"));
  const project = S.createObject("project", { title: "来源隔离测试", status: "active" },
    { now: NOW, uid: PRJ, display_id: "PRJ-001" });
  const hypothesis = S.createObject("hypothesis", {
    project_uid: PRJ,
    statement: "模拟数值不能支持正式假设",
    supporting_evidence: [EVD],
  }, { now: NOW, uid: HYP, display_id: "HYP-001" });
  const experiment = S.createObject("experiment", {
    project_uid: PRJ,
    title: "历史上被整合的实验",
    status: "integrated",
    result: "记录中的结果。",
    conclusion: "历史结论。",
    produced_evidence: [EVD],
    data_origin: "measured",
    raw_data_refs: ["raw/run.csv"],
    data_provenance_note: "原声明，稍后经审计推翻。",
    data_recorded_by: "user",
    data_recorded_at: NOW,
  }, { now: NOW, uid: EXP, display_id: "EXP-001" });
  const evidence = S.createObject("evidence", {
    claim: "历史结果支持该假设",
    source_type: "experiment",
    source_uid: EXP,
    target_uid: HYP,
    relation: "SUPPORTS",
    created_by: "user",
    verified_by_user: true,
    review_status: "confirmed",
    verified_at: NOW,
    quote: "记录中的结果。",
    anchor_region: "experiment_result",
    locator: {
      source_sha256: "a".repeat(64),
      anchor: "r0001",
      quote_hash: "b".repeat(32),
      original_url: "scholarium://experiment/" + EXP,
    },
  }, { now: NOW, uid: EVD, display_id: "EVD-001" });
  H.saveObject(vault, project);
  H.saveObject(vault, hypothesis, "# 假设\n");
  H.saveObject(vault, experiment, "# 实验\n\n## 结果\n\n记录中的结果。\n\n## 结论\n\n历史结论。\n");
  H.saveObject(vault, evidence, "# 证据\n");
  assert.deepEq(S.validateVault(vault).problems, []);
  return vault;
}

function object(vault, uid) {
  return S.readVaultObjects(vault).find((entry) => entry.object.uid === uid).object;
}

const input = (origin = "simulated") => ({
  experiment_uid: EXP,
  data_origin: origin,
  reason: "取证确认数值由模拟常量注入",
  data_provenance_note: "检查脚本哈希与输入依赖后，未发现独立原始数据。",
});

describe("provenance invalidation transaction", () => {
  it("keeps dry-run pure and reports the whole affected graph", () => {
    const vault = fixture();
    const before = fs.readFileSync(path.join(vault, "Research", "Experiments",
      fs.readdirSync(path.join(vault, "Research", "Experiments"))[0]), "utf8");
    const manifest = A.run(vault, "experiment.invalidate_provenance", input(), { now: LATER });
    assert.eq(manifest.result.mode, "dry_run");
    assert.deepEq(manifest.result.evidence_uids, [EVD]);
    assert.deepEq(manifest.result.hypothesis_uids, [HYP]);
    const after = fs.readFileSync(path.join(vault, "Research", "Experiments",
      fs.readdirSync(path.join(vault, "Research", "Experiments"))[0]), "utf8");
    assert.eq(after, before);
    assert.eq(fs.existsSync(path.join(vault, "Research", "_runs")), false);
  });

  it("requires explicit confirmation before writing", () => {
    const vault = fixture();
    let message = "";
    try {
      A.run(vault, "experiment.invalidate_provenance", input(), { dryRun: false, now: LATER });
    } catch (error) { message = error.message; }
    assert.match(message, /explicit_confirmation_required/);
    assert.eq(object(vault, EXP).status, "integrated");
  });

  it("invalidates the Experiment, demotes Evidence, unlinks Hypothesis, and writes recovery", () => {
    const vault = fixture();
    const manifest = A.run(vault, "experiment.invalidate_provenance", input(), {
      dryRun: false, confirmed: true, by: "user", now: LATER,
    });
    assert.eq(manifest.result.mode, "committed");
    const experiment = object(vault, EXP);
    assert.eq(experiment.status, "invalidated");
    assert.eq(experiment.data_origin, "simulated");
    assert.eq(experiment.invalidated_by, "user");
    assert.deepEq(experiment.produced_evidence, []);
    assert.eq(experiment.status_history.at(-1).to, "invalidated");
    const evidence = object(vault, EVD);
    assert.eq(evidence.review_status, "demonstration");
    assert.eq(evidence.verified_by_user, false);
    assert.eq(evidence.demonstrated_by, "user");
    const hypothesis = object(vault, HYP);
    assert.deepEq(hypothesis.supporting_evidence, []);
    assert.eq(hypothesis.evidence_history.at(-1).evidence_uid, EVD);
    assert.deepEq(S.validateVault(vault).problems, []);
    assert.eq(RS.scanExperimentOutcomes(vault).counts.invalidated, 1);
    assert.eq(RS.scanExperimentOutcomes(vault).counts.planned, 0);
    assert.ok(fs.existsSync(path.join(vault, ...manifest.result.recovery_path.split("/"))));
  });

  it("uses unverifiable only as a human-recorded invalidated terminal state", () => {
    const vault = fixture();
    A.run(vault, "experiment.invalidate_provenance", input("unverifiable"), {
      dryRun: false, confirmed: true, by: "user", now: LATER,
    });
    assert.eq(object(vault, EXP).data_origin, "unverifiable");
    assert.eq(object(vault, EVD).review_status, "rejected");
    assert.deepEq(S.validateVault(vault).problems, []);

    const bad = { ...object(vault, EXP), status: "concluded" };
    assert.ok(S.validateObject(bad).some((message) => /必须进入 invalidated/.test(message)));
  });

  it("does not upgrade an already rejected Evidence to demonstration", () => {
    const vault = fixture();
    const rejected = S.createObject("evidence", {
      claim: "重复记录，不进入正式证据链",
      source_type: "experiment",
      source_uid: EXP,
      target_uid: HYP,
      relation: "SUPPORTS",
      created_by: "user",
      verified_by_user: false,
      review_status: "rejected",
      rejection_reason: "与既有 Evidence 重复",
      rejected_at: NOW,
      rejected_by: "user",
      quote: "记录中的结果。",
      anchor_region: "experiment_result",
      locator: {
        source_sha256: "c".repeat(64),
        anchor: "r0001",
        quote_hash: "d".repeat(32),
        original_url: "scholarium://experiment/" + EXP,
      },
    }, { now: NOW, uid: REJECTED_EVD, display_id: "EVD-002" });
    H.saveObject(vault, rejected, "# 已拒绝证据\n");

    A.run(vault, "experiment.invalidate_provenance", input(), {
      dryRun: false, confirmed: true, by: "user", now: LATER,
    });
    const after = object(vault, REJECTED_EVD);
    assert.eq(after.review_status, "rejected");
    assert.eq(after.rejection_reason, "与既有 Evidence 重复");
    assert.eq(after.rejected_by, "user");
    assert.eq(after.provenance_history.at(-1).from_review_status, "rejected");
    assert.eq(after.provenance_history.at(-1).data_origin, "simulated");
    assert.deepEq(S.validateVault(vault).problems, []);
  });
});
