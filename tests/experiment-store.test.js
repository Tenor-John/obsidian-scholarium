"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const S = require("../tools/schema-objects");
const H = require("../tools/hypothesis-store");
const X = require("../tools/experiment-store");
const L = require("../tools/evidence-locator");
const A = require("../tools/evidence-agent-review");

const NOW = "2026-08-12T00:00:00.000Z";
const PRJ = "019fef48-5be0-786b-8da5-39a220613712";

function vault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sch-exp-"));
  H.saveObject(root, S.createObject("hypothesis", {
    project_uid: PRJ, statement: "暗态对照下 CO 产率不会上升",
  }, { now: NOW, uid: "019fef48-5be1-79a0-82ad-2770965f8be4", display_id: "HYP-001" }));
  return root;
}

function experiment(v, extra = {}) {
  return X.saveNew(v, {
    title: "暗态对照 CO 产率", project_uid: PRJ,
    status: "concluded",
    result: "暗态对照下 CO 产率未上升。\n\n365 nm 单光照下 CO 产率上升。",
    conclusion: "暗态本身不能解释活性提升。",
    data_origin: "measured",
    raw_data_refs: ["Experiments/raw/gc-ms-dark-control.csv"],
    data_provenance_note: "GC-MS 原始导出；样品批次 S24-0812。",
    ...extra,
  }, { now: NOW });
}

describe("experiment store: readable Experiment records", () => {
  it("writes a schema-valid Experiment with stable result blocks", () => {
    const v = vault();
    const made = experiment(v);
    const record = X.readRecord(v, { path: made.path, object: made.object });
    assert.deepEq(S.validateObject(made.object), []);
    assert.eq(record.blocks.length, 2);
    assert.eq(record.blocks[0].id, "r0001");
    assert.eq(record.blocks[0].text, "暗态对照下 CO 产率未上升。");
    assert.eq(record.source_sha256.length, 64);
    assert.match(fs.readFileSync(path.join(v, ...made.path.split("/")), "utf8"), /## 结果/);
    assert.match(fs.readFileSync(path.join(v, ...made.path.split("/")), "utf8"), /## 数据来源/);
    assert.match(fs.readFileSync(path.join(v, ...made.path.split("/")), "utf8"), /scholarium-experiment-template:v1/);
    assert.match(fs.readFileSync(path.join(v, ...made.path.split("/")), "utf8"), /# EXP-001 · 暗态对照 CO 产率/);
    assert.eq(made.object.data_origin, "measured");
  });

  it("does not allow an Experiment to be created without its frozen title", () => {
    const v = vault();
    let message = "";
    try { X.saveNew(v, { project_uid: PRJ, result: "x" }, { now: NOW }); } catch (error) { message = error.message; }
    assert.match(message, /title/);
  });

  it("writes an explicit planned provenance for a newly designed Experiment", () => {
    const v = vault();
    const made = X.saveNew(v, {
      title: "尚未开始的对照", project_uid: PRJ, status: "designed",
      result: "", conclusion: "",
    }, { now: NOW });
    assert.eq(made.object.data_origin, "planned");
    assert.deepEq(made.object.raw_data_refs, []);
    assert.eq(made.object.data_recorded_by, "user");
    assert.deepEq(S.validateObject(made.object), []);
  });

  it("prepares the exact canonical bytes for an Obsidian Vault API create", () => {
    const v = vault();
    const prepared = X.prepareNew(v, {
      title: "由图片转录的实验", project_uid: PRJ, status: "analyzing",
      result: "### 观察与现象\n\n出现团聚。", conclusion: "",
      data_origin: "unknown", raw_data_refs: ["Materials/tem.tif"],
      data_provenance_note: "尚待研究者确认来源类型。",
      plan: "### 实验步骤\n\n1. 获取 TEM 图像",
    }, { now: NOW });
    assert.eq(fs.existsSync(path.join(v, ...prepared.path.split("/"))), false, "prepareNew must not write");
    const parsed = S.parseObject(prepared.content);
    assert.deepEq(S.validateObject(parsed.object), []);
    assert.eq(parsed.object.data_origin, "unknown");
    assert.match(parsed.body, /## 实验方案与过程[\s\S]*### 实验步骤/);
    assert.match(parsed.body, /## 结果[\s\S]*出现团聚/);
  });

  it("never reuses an Experiment display id retired by a Decision", () => {
    const v = vault();
    const decision = S.createObject("decision", {
      project_uid: PRJ, title: "保留已删除验收对象的身份",
      decision: "EXP-011 不再作为活对象，但编号不得复用。",
      rationale: "运行审计仍引用该身份。", relates_to: [],
      retired_object_uids: ["01a07ed0-0000-7ace-9f21-b802c4d77e10"],
      retired_display_ids: ["EXP-011"],
    }, { now: NOW, display_id: "DEC-001" });
    const decisionDir = path.join(v, "Research", "Decisions");
    fs.mkdirSync(decisionDir, { recursive: true });
    fs.writeFileSync(path.join(decisionDir, "DEC-001 retired id.md"), S.serializeObject(decision, ""), "utf8");
    const made = X.saveNew(v, { title: "下一条实验", project_uid: PRJ }, { now: NOW });
    assert.eq(made.object.display_id, "EXP-012");
  });

  it("does not let a simulated record masquerade as integrated research", () => {
    const v = vault();
    let message = "";
    try {
      X.saveNew(v, {
        title: "流程演练", project_uid: PRJ, status: "integrated", result: "模拟结果", conclusion: "仅演练。",
        produced_evidence: ["019fef48-5be1-79a0-82ad-2770965f8be4"], data_origin: "simulated",
        data_provenance_note: "用于验证 UI 与证据流程，不是实验室测量。",
      }, { now: NOW });
    } catch (error) { message = error.message; }
    assert.match(message, /模拟数据可用于流程演练/);
  });

  it("groups headed result sections into compact, reviewable evidence blocks", () => {
    const body = [
      "# Structured experiment",
      "",
      "## \u7ed3\u679c",
      "### 1. Active species capture (400 nm)",
      "Signal A and signal B were both enhanced.",
      "",
      "Additional observation for the same result.",
      "",
      "### 2. Wavelength control (450 nm and 530 nm)",
      "Neither control reproduced the enhancement.",
      "",
      "### 3. Binary controls",
      "Both binary controls were lower than the ternary system.",
      "",
      "### 4. Product correlation",
      "Product selectivity followed the paired signals.",
      "",
      "## Conclusion",
      "The mechanisms remain distinguishable.",
    ].join("\n");
    const blocks = X.resultBlocks(body);
    assert.eq(blocks.length, 4);
    assert.eq(blocks[0].id, "r0001");
    assert.eq(blocks[0].label, "Active species capture (400 nm)");
    assert.match(blocks[0].text, /Additional observation/);
    assert.eq(blocks[3].label, "Product correlation");
  });

  it("keeps a planned protocol body separate from empty results", () => {
    const v = vault();
    const made = X.saveNew(v, {
      title: "Temporal-overlap control", project_uid: PRJ,
      status: "designed", tests_hypotheses: [], result: "", conclusion: "",
    }, { now: NOW });
    const body = [
      "# Temporal-overlap control", "", "## Design", "Compare simultaneous and alternating illumination.",
      "", "## \u7ed3\u679c", "", "## \u7ed3\u8bba", "",
    ].join("\n");
    X.saveExisting(v, made.path, made.object, { body });
    const file = path.join(v, ...made.path.split("/"));
    const record = X.readRecord(v, { path: made.path, object: made.object });
    assert.match(fs.readFileSync(file, "utf8"), /Compare simultaneous and alternating/);
    assert.eq(record.blocks.length, 0);
    assert.eq(record.object.status, "designed");
  });

  it("normalizes an AI plan into the canonical body without turning plan text into a result", () => {
    const object = S.createObject("experiment", {
      title: "壳厚梯度", project_uid: PRJ, status: "designed",
      result: "", conclusion: "", produced_evidence: [],
    }, { now: NOW, display_id: "EXP-009" });
    const body = X.canonicalizeBody(object, [
      "# 模型自拟标题", "", "## 操作草案", "", "1. 制备三档壳厚。",
      "", "## 结果", "", "尚未执行。", "", "## 结论", "", "尚无结论。",
    ].join("\n"));
    assert.match(body, /# EXP-009 · 壳厚梯度/);
    assert.match(body, /## 实验方案与过程\n\n### 操作草案/);
    assert.match(body, /1\. 制备三档壳厚/);
    assert.noMatch(body, /尚未执行/);
    assert.deepEq(X.resultBlocks(body), []);
    assert.eq(X.canonicalizeBody(object, body), body);
  });
});

describe("experiment store: Experiment → Evidence", () => {
  it("derives all four locator fields from a result block", () => {
    const v = vault();
    const made = experiment(v);
    const record = X.readRecord(v, { path: made.path, object: made.object });
    const built = X.buildLocator(record, "r0001", "CO 产率未上升");
    assert.eq(built.locator.anchor, "r0001");
    assert.eq(built.locator.source_sha256, record.source_sha256);
    assert.eq(built.locator.quote_hash, record.blocks[0].quote_hash);
    assert.eq(built.locator.original_url, "scholarium://experiment/" + made.object.uid);
  });

  it("refuses a quote outside the chosen result block", () => {
    const v = vault();
    const made = experiment(v);
    const record = X.readRecord(v, { path: made.path, object: made.object });
    let message = "";
    try { X.buildLocator(record, "r0001", "365 nm 单光照"); } catch (error) { message = error.message; }
    assert.match(message, /not_in_result_block/);
  });

  it("adds produced_evidence only after human confirmation", () => {
    const v = vault();
    const made = experiment(v);
    const record = X.readRecord(v, { path: made.path, object: made.object });
    const target = H.loadAll(v, "hypothesis")[0].object;
    const e = L.createEvidenceFromExperiment(record, {
      anchorId: "r0001", quote: "CO 产率未上升",
      claim: "暗态对照未提高 CO 产率，限定光照协同解释。",
      targetUid: target.uid, relation: "QUALIFIES", now: NOW,
    });
    H.saveObject(v, e);
    assert.deepEq(X.loadAll(v)[0].object.produced_evidence, []);
    const confirmed = H.confirmEvidence(v, e.uid, { now: NOW });
    assert.eq(confirmed.experiment.uid, made.object.uid);
    assert.deepEq(X.loadAll(v)[0].object.produced_evidence, [e.uid]);
    assert.deepEq(S.validateObject(H.loadAll(v, "evidence")[0].object), []);
  });

  it("keeps an AI experiment-review draft auditable but still pending", () => {
    const v = vault();
    const made = experiment(v);
    const record = X.readRecord(v, { path: made.path, object: made.object });
    const target = H.loadAll(v, "hypothesis")[0].object;
    const review = A.makeReview(A.parseReview(JSON.stringify({
      decision: "confirm", relation: "QUALIFIES",
      claim: "The dark control makes illumination a necessary condition.",
      reason: "The quoted result reports no reduction product in the dark control.",
    })), { targetUid: target.uid, model: "test", prompt: "experiment result", now: NOW });
    const e = L.createEvidenceFromExperiment(record, {
      anchorId: "r0001", quote: "CO 产率未上升", claim: review.claim,
      targetUid: target.uid, relation: review.relation, aiReview: review, now: NOW,
    });
    assert.eq(e.review_status, "pending");
    assert.eq(e.verified_by_user, false);
    assert.eq(e.ai_review.decision, "confirm");
    assert.deepEq(S.validateObject(e), []);
    assert.deepEq(X.loadAll(v)[0].object.produced_evidence, []);
  });

  it("preserves researcher notes while a confirmation appends produced_evidence", () => {
    const v = vault();
    const made = experiment(v);
    const file = path.join(v, ...made.path.split("/"));
    fs.appendFileSync(file, "\n研究者备注：第二次重复需测量气相色谱基线。\n", "utf8");
    const record = X.readRecord(v, { path: made.path, object: made.object });
    const target = H.loadAll(v, "hypothesis")[0].object;
    const e = L.createEvidenceFromExperiment(record, {
      anchorId: "r0001", quote: "CO 产率未上升", claim: "暗态对照没有提升 CO 产率。",
      targetUid: target.uid, relation: "QUALIFIES", now: NOW,
    });
    H.saveObject(v, e);
    H.confirmEvidence(v, e.uid, { now: NOW });
    assert.match(fs.readFileSync(file, "utf8"), /研究者备注：第二次重复需测量气相色谱基线/);
  });

  it("refuses confirmation when a result was edited after the evidence was drawn", () => {
    const v = vault();
    const made = experiment(v);
    const record = X.readRecord(v, { path: made.path, object: made.object });
    const target = H.loadAll(v, "hypothesis")[0].object;
    const e = L.createEvidenceFromExperiment(record, {
      anchorId: "r0001", quote: "CO 产率未上升", claim: "暗态对照不支持热效应解释。",
      targetUid: target.uid, relation: "CONTRADICTS", now: NOW,
    });
    H.saveObject(v, e);
    X.saveRecord(v, made.path, { ...made.object, result: "重测后，暗态对照的 CO 产率上升。", updated_at: NOW });
    let message = "";
    try { H.confirmEvidence(v, e.uid, { now: NOW }); } catch (error) { message = error.message; }
    assert.match(message, /实验来源已变化/);
    assert.deepEq(X.loadAll(v)[0].object.produced_evidence, []);
  });

  it("allows review after an unrelated experiment-record revision when the cited result block is unchanged", () => {
    const v = vault();
    const made = experiment(v);
    const record = X.readRecord(v, { path: made.path, object: made.object });
    const target = H.loadAll(v, "hypothesis")[0].object;
    const e = L.createEvidenceFromExperiment(record, {
      anchorId: "r0001", quote: "CO 产率未上升", claim: "The dark control constrains the interpretation.",
      targetUid: target.uid, relation: "QUALIFIES", now: NOW,
    });
    H.saveObject(v, e);
    const file = path.join(v, ...made.path.split("/"));
    fs.appendFileSync(file, "\n\nResearcher note: a later protocol clarification.\n", "utf8");

    const checked = X.verifyEvidenceSource(v, H.loadAll(v, "evidence")[0].object);
    assert.eq(checked.ok, true);
    assert.eq(checked.source_revised, true);
    assert.eq(checked.record.blocks.find((b) => b.id === "r0001").quote_hash, e.locator.quote_hash);

    H.confirmEvidence(v, e.uid, { now: NOW });
    assert.eq(H.loadAll(v, "evidence")[0].object.review_status, "confirmed");
    assert.deepEq(X.loadAll(v)[0].object.produced_evidence, [e.uid]);
  });

  it("identifies the same experiment block and hypothesis across source revisions", () => {
    const v = vault();
    const made = experiment(v);
    const record = X.readRecord(v, { path: made.path, object: made.object });
    const target = H.loadAll(v, "hypothesis")[0].object;
    const e = L.createEvidenceFromExperiment(record, {
      anchorId: "r0001", quote: "CO 产率未上升", claim: "The dark control constrains the interpretation.",
      targetUid: target.uid, relation: "QUALIFIES", now: NOW,
    });
    H.saveObject(v, e);
    fs.appendFileSync(path.join(v, ...made.path.split("/")), "\n\nLater note.\n", "utf8");
    const current = X.readRecord(v, { path: made.path, object: made.object });
    const duplicate = H.findEvidenceByLocator(v, {
      sourceUid: current.object.uid, anchor: "r0001", targetUid: target.uid,
    });
    assert.eq(duplicate.object.uid, e.uid);
  });
});
