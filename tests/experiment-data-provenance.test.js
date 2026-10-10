"use strict";
// Experiment data-provenance (`data_origin`) coverage.
//
// This feature was independently implemented directly against the vault
// while a parallel draft (`data_source` / structured raw_data_refs with
// sha256 hashing / recorded_by+instrument) was being built in this worktree.
// The two designs collided on main.js, tools/schema-objects.js and
// tools/experiment-store.js; the version below documents and locks in the
// implementation that actually shipped (`data_origin`, plain-string
// raw_data_refs, `data_provenance_note`, `data_recorded_by`/`data_recorded_at`),
// not the abandoned draft.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert, source } = require("./harness");
const S = require("../tools/schema-objects");
const X = require("../tools/experiment-store");

const NOW = "2026-08-14T00:00:00.000Z";
const PRJ = "019fef48-5be0-786b-8da5-39a220613712";

function vault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sch-exp-prov-"));
}

function experiment(v, extra = {}) {
  return X.saveNew(v, {
    title: "同步/交替双通道光照时序对照", project_uid: PRJ,
    status: "designed",
    result: "", conclusion: "",
    ...extra,
  }, { now: NOW });
}

describe("Experiment data provenance (data_origin): schema layer", () => {
  it("accepts a measured Experiment with raw_data_refs, a note, and data_recorded_by: user", () => {
    const v = vault();
    const made = experiment(v, {
      data_origin: "measured",
      raw_data_refs: ["Experiments/raw/2026-08-14/GC-MS-run-01.csv"],
      data_provenance_note: "GC-MS 原始导出；样品批次 S24-0814。",
    });
    assert.deepEq(S.validateObject(made.object), []);
    assert.eq(made.object.data_origin, "measured");
    assert.eq(made.object.data_recorded_by, "user");
    assert.eq(made.object.raw_data_refs.length, 1);
  });

  it("saveNew defaults an unspecified data_origin to planned, recorded_by to user", () => {
    const v = vault();
    const made = experiment(v);
    assert.eq(made.object.data_origin, "planned");
    assert.eq(made.object.data_recorded_by, "user");
    assert.ok(!!made.object.data_recorded_at);
    assert.deepEq(S.validateObject(made.object), []);
  });

  it("leaves data_origin absent on a legacy object without invalidating it, below the terminal statuses", () => {
    // Superseded 2026-09-05. The original version of this test asserted that a
    // legacy record could sit at `concluded` with no data_origin and still be
    // valid. EXP-001 is what that permission looked like in production: it
    // reached `concluded`, produced EVD-024, and no check ever ran because the
    // whole provenance block was guarded by `data_origin !== undefined`.
    // What remains true — and is what this test now pins — is the narrower and
    // still-important guarantee: absence alone does not invalidate a record.
    // It only blocks the terminal statuses and evidence production, which is
    // the next test.
    const object = S.createObject("experiment", {
      title: "旧实验", project_uid: PRJ, status: "designed", produced_evidence: [],
    }, { now: NOW });
    assert.eq(object.data_origin, undefined);
    assert.deepEq(S.validateObject(object), []);
  });

  // These two build the frontmatter literally rather than through createObject,
  // because createObject now throws on exactly the shape under test — which is
  // itself the point: the gate refuses to mint such a record in the first
  // place. What is being pinned here is that a record already ON DISK in this
  // shape (EXP-001) is reported rather than silently accepted.
  const legacy = (over) => ({
    uid: S.uuidV7(Date.parse(NOW)), display_id: "EXP-900", schema_version: 1,
    type: "experiment", created_at: NOW, updated_at: NOW, project_uid: PRJ,
    title: "遗留实验", produced_evidence: [], ...over,
  });

  it("treats an absent data_origin as unknown and blocks it from concluded (EXP-001's hole)", () => {
    const object = legacy({ status: "concluded", result: "结果文本", conclusion: "结论文本" });
    assert.eq(object.data_origin, undefined);
    const errors = S.validateObject(object);
    assert.ok(errors.some((e) => /data_origin 为 unknown[\s\S]*不得进入 concluded/.test(e)),
      "缺失 data_origin 必须被当作 unknown 显式阻断，而不是默认放行：" + JSON.stringify(errors));
  });

  it("blocks an unknown-provenance experiment from producing Evidence", () => {
    const object = legacy({
      status: "analyzing", produced_evidence: [S.uuidV7(Date.parse(NOW) + 1)],
    });
    assert.eq(object.data_origin, undefined);
    assert.ok(S.validateObject(object).some((e) => /不得产出 Evidence/.test(e)));
  });

  it("distinguishes unknown from the audited unverifiable terminal state", () => {
    assert.ok(S.ENUMS.experiment.data_origin.includes("demonstration"));
    assert.ok(S.ENUMS.experiment.data_origin.includes("unknown"));
    assert.ok(S.ENUMS.experiment.data_origin.includes("unverifiable"));
    assert.ok(S.ENUMS.experiment.status.includes("invalidated"));
    assert.eq(S.experimentProvenance({}), "unknown");
    assert.eq(S.experimentProvenance({ data_origin: "measured" }), "measured");
    assert.eq(S.isEvidenceGrade({ data_origin: "measured" }), true);
    assert.eq(S.isEvidenceGrade({ data_origin: "demonstration" }), false);
    assert.eq(S.isEvidenceGrade({}), false);
    assert.eq(S.isEvidenceGrade({ data_origin: "measured", status: "invalidated" }), false);
  });

  it("accepts unverifiable only when a researcher invalidated the record with an audit note", () => {
    const object = legacy({
      status: "invalidated", data_origin: "unverifiable",
      data_recorded_by: "user", data_recorded_at: NOW,
      data_provenance_note: "已检查仪器目录、实验本与计算表，均未找到可复算来源。",
      invalidation_reason: "来源追溯完成但无法核实", invalidated_at: NOW,
      invalidated_by: "user", produced_evidence: [],
    });
    assert.deepEq(S.validateObject(object), []);
    assert.ok(S.validateObject({ ...object, status: "concluded" })
      .some((message) => /必须进入 invalidated/.test(message)));
    assert.ok(S.validateObject({ ...object, data_provenance_note: "" })
      .some((message) => /无法核实的数据必须说明/.test(message)));
  });

  it("rejects an unrecognised data_origin value", () => {
    const v = vault();
    let threw = false;
    try { experiment(v, { data_origin: "guessed" }); }
    catch (e) { threw = true; assert.match(e.message, /data_origin 必须是 planned \| measured \| simulated \| imported \| demonstration \| unknown \| unverifiable/); }
    assert.ok(threw);
  });

  it("rejects data_recorded_by set to anything other than user", () => {
    const v = vault();
    let threw = false;
    try {
      experiment(v, {
        data_origin: "measured", raw_data_refs: ["x.csv"],
        data_provenance_note: "note", data_recorded_by: "ai",
      });
    } catch (e) { threw = true; assert.match(e.message, /data_recorded_by 必须为 user/); }
    assert.ok(threw);
  });

  it("requires at least one raw_data_refs entry and a note for measured/imported data", () => {
    const v = vault();
    let threw = false;
    try { experiment(v, { data_origin: "measured", raw_data_refs: [], data_provenance_note: "" }); }
    catch (e) {
      threw = true;
      assert.match(e.message, /实测或导入数据必须至少提供一条 raw_data_refs/);
      assert.match(e.message, /实测或导入数据必须说明 data_provenance_note/);
    }
    assert.ok(threw);
  });

  it("requires a note for simulated data even without raw_data_refs", () => {
    const v = vault();
    let threw = false;
    try { experiment(v, { data_origin: "simulated", data_provenance_note: "" }); }
    catch (e) { threw = true; assert.match(e.message, /模拟数据必须说明 data_provenance_note/); }
    assert.ok(threw);
  });

  it("blocks planned (no data yet) from reaching concluded or integrated", () => {
    const v = vault();
    let threw = false;
    try { experiment(v, { data_origin: "planned", status: "concluded", conclusion: "结论" }); }
    catch (e) { threw = true; assert.match(e.message, /尚未产生数据（planned）的 Experiment 不能进入 concluded 或 integrated/); }
    assert.ok(threw);
  });

  it("blocks simulated data from reaching integrated, but allows concluded", () => {
    const v = vault();
    const concluded = experiment(v, {
      data_origin: "simulated", data_provenance_note: "流程演练；模型 X。",
      status: "concluded", conclusion: "结论",
    });
    assert.deepEq(S.validateObject(concluded.object), []);
    let threw = false;
    try {
      X.saveExisting(v, concluded.path, {
        ...concluded.object, status: "integrated",
        produced_evidence: ["019fef48-5be1-79a0-82ad-2770965f8be4"],
      });
    } catch (e) { threw = true; assert.match(e.message, /模拟数据可用于流程演练，但 Experiment 不能进入 integrated/); }
    assert.ok(threw);
  });
});

describe("Experiment data provenance: main.js wiring", () => {
  it("registers the backfill command against schOpenExperimentDataProvenanceEditor", () => {
    const src = source();
    assert.match(src, /function schOpenExperimentDataProvenanceEditor\(plugin\)/);
    assert.match(src, /id: "edit-research-experiment-data-provenance"/);
    assert.match(src, /callback: \(\) => schOpenExperimentDataProvenanceEditor\(this\)/);
  });

  it("never touches result, conclusion, status or produced_evidence from the backfill editor", () => {
    const start = source().indexOf("function schOpenExperimentDataProvenanceEditor");
    const end = source().indexOf("\nfunction ", start + 1);
    const body = source().slice(start, end === -1 ? start + 6000 : end);
    assert.noMatch(body, /\bresult:/);
    assert.noMatch(body, /\bconclusion:/);
    assert.noMatch(body, /\bstatus:/);
    assert.noMatch(body, /\bproduced_evidence:/);
    // It does stamp who/when the provenance itself was declared.
    assert.match(body, /data_recorded_by: "user"/);
  });

  it("offers a data_origin picker and blocks save when measured/imported data has no refs or note", () => {
    const start = source().indexOf("function schOpenExperimentCreator");
    const end = source().indexOf("\nfunction ", start + 1);
    const body = source().slice(start, end === -1 ? start + 8000 : end);
    assert.match(body, /"数据来源类型"/);
    assert.match(body, /data_origin: dataOrigin\.value/);
    assert.match(body, /\["measured", "imported"\]\.includes\(dataOrigin\.value\)/);
  });

  it("labels planned data as not yet integratable in the creator's status copy", () => {
    const start = source().indexOf("function schOpenExperimentCreator");
    const end = source().indexOf("\nfunction ", start + 1);
    const body = source().slice(start, end === -1 ? start + 8000 : end);
    assert.match(body, /模拟数据可用于流程演练，但不能整合为实测结论/);
  });
});
