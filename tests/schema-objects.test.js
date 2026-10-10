"use strict";
/**
 * Schema-v1 objects as Markdown — the executable form of §7.1's promise that a
 * user's confirmed research cognition survives without the plugin.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const S = require("../tools/schema-objects");

const NOW = "2026-08-11T00:00:00.000Z";
const PRJ = "019fef48-5be0-786b-8da5-39a220613712";
const EVD = "019fef48-5be1-79a0-82ad-2770965f8be4";

const hypothesis = (extra = {}) => S.createObject("hypothesis", {
  project_uid: PRJ, statement: "Au 热电子注入半导体促进 CO2 还原", ...extra,
}, { now: NOW });

describe("schema objects: markdown round trip", () => {
  it("round-trips an object through frontmatter unchanged", () => {
    const h = hypothesis({ assumptions: ["表面清洁", "无光热贡献"] });
    const back = S.parseObject(S.serializeObject(h, "正文")).object;
    assert.deepEq(back, h);
  });

  it("keeps the body untouched", () => {
    const body = "# 标题\n\n带 --- 分隔线的正文\n";
    assert.eq(S.parseObject(S.serializeObject(hypothesis(), body)).body, body);
  });

  it("does not accumulate escapes across repeated saves", () => {
    // A quote in a statement used to gain a backslash on every save, because
    // values were written with JSON escaping and read back without unescaping.
    let h = hypothesis({ statement: 'Au 的 "热电子" 机制' });
    for (let i = 0; i < 5; i++) h = S.parseObject(S.serializeObject(h)).object;
    assert.eq(h.statement, 'Au 的 "热电子" 机制');
  });

  it("round-trips a nested locator block", () => {
    // Reading this by character offset returned an empty object and cost every
    // Evidence its locator on the first save.
    const e = S.createObject("evidence", {
      claim: "c", source_type: "paper", source_uid: PRJ, relation: "SUPPORTS",
      locator: { source_sha256: "a".repeat(64), anchor: "b0037", quote_hash: "q1", original_url: "https://e.org/a" },
    }, { now: NOW });
    const back = S.parseObject(S.serializeObject(e)).object;
    assert.deepEq(back.locator, e.locator);
    assert.deepEq(S.validateObject(back), []);
  });

  it("round-trips lists inside a nested mapping", () => {
    // Project profile boundaries are a nested mapping whose children are
    // lists. Losing either list after a save changes the declared research
    // scope, so this must remain a lossless representation.
    const object = {
      uid: PRJ,
      display_id: "PRJ-001",
      schema_version: 1,
      type: "project",
      created_at: NOW,
      updated_at: NOW,
      boundaries: { do: ["验证机制", "保留审计"], dont: ["不把相关性写成因果"] },
    };
    const back = S.parseObject(S.serializeObject(object)).object;
    assert.deepEq(back.boundaries, object.boundaries);
  });

  it("round-trips history entries instead of flattening them", () => {
    // String(entry) is "[object Object]", which would destroy the record §4.3
    // requires every transition to leave.
    const h = S.applyHypothesisChange(hypothesis(), { status: "challenged", by: "user", cause_uid: EVD }, { now: NOW });
    const back = S.parseObject(S.serializeObject(h)).object;
    assert.deepEq(back.history, h.history);
    assert.eq(back.history[0].cause_uid, EVD);
  });

  it("writes an empty list as [] rather than dropping the key", () => {
    const text = S.serializeObject(hypothesis());
    assert.match(text, /supporting_evidence: \[\]/);
    assert.deepEq(S.parseObject(text).object.supporting_evidence, []);
  });
});

describe("schema objects: §4 field rules", () => {
  it("accepts a well-formed hypothesis", () => {
    assert.deepEq(S.validateObject(hypothesis()), []);
  });

  it("mints UUIDv7, not v4", () => {
    assert.match(S.uuidV7(), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/i);
  });

  it("allocates above the high-water mark instead of reusing a deleted gap", () => {
    assert.eq(S.nextDisplayId(["EXP-001", "EXP-003"], "experiment"), "EXP-004");
  });

  it("gives a new hypothesis no confidence at all", () => {
    // A default would be a machine-set confidence wearing a default's clothes.
    assert.eq(hypothesis().confidence, undefined);
    assert.eq(hypothesis().status, "proposed");
  });

  it("rejects a confidence no human set", () => {
    const h = { ...hypothesis(), confidence: 0.7, confidence_set_by: "ai" };
    assert.match(S.validateObject(h).join("; "), /只接受人工写入/);
  });

  it("rejects relations that reference a path or title instead of a uid", () => {
    const h = { ...hypothesis(), project_uid: "Research/Projects/PRJ-001.md" };
    assert.match(S.validateObject(h).join("; "), /必须引用 UUIDv7/);
  });

  it("rejects an unknown status rather than storing it", () => {
    assert.match(S.validateObject({ ...hypothesis(), status: "maybe" }).join("; "), /status 必须是/);
  });

  it("requires all four locator fields on evidence", () => {
    const base = {
      uid: EVD, display_id: "EVD-001", schema_version: 1, type: "evidence",
      created_at: NOW, updated_at: NOW, claim: "CO 产率上升", source_type: "paper",
      source_uid: PRJ, relation: "SUPPORTS", verified_by_user: false,
      locator: { source_sha256: "a".repeat(64), anchor: "b0007", quote_hash: "d2", original_url: "https://e.org/a" },
    };
    assert.deepEq(S.validateObject(base), []);
    for (const key of ["source_sha256", "anchor", "quote_hash", "original_url"]) {
      const broken = { ...base, locator: { ...base.locator, [key]: "" } };
      assert.match(S.validateObject(broken).join("; "), /四项缺一不可/, key + " must be required");
    }
  });

  it("makes a new Evidence explicitly pending, while still reading legacy Evidence", () => {
    const fields = {
      claim: "c", source_type: "paper", source_uid: PRJ,
      locator: { source_sha256: "a".repeat(64), anchor: "b0007", quote_hash: "d2", original_url: "https://e.org/a" },
    };
    assert.eq(S.createObject("evidence", fields, { now: NOW }).review_status, "pending");
    const legacy = { uid: EVD, display_id: "EVD-001", schema_version: 1, type: "evidence", created_at: NOW, updated_at: NOW,
      ...fields, verified_by_user: false };
    assert.deepEq(S.validateObject(legacy), [], "legacy Evidence must remain readable");
  });

  it("requires a reason and timestamp for a human rejection", () => {
    const base = {
      uid: EVD, display_id: "EVD-001", schema_version: 1, type: "evidence", created_at: NOW, updated_at: NOW,
      claim: "c", source_type: "paper", source_uid: PRJ, verified_by_user: false, review_status: "rejected",
      locator: { source_sha256: "a".repeat(64), anchor: "b0007", quote_hash: "d2", original_url: "https://e.org/a" },
    };
    assert.match(S.validateObject(base).join("; "), /rejection_reason/);
    assert.deepEq(S.validateObject({ ...base, rejection_reason: "irrelevant", rejected_at: NOW, rejected_by: "user" }), []);
    assert.match(S.validateObject({ ...base, verified_by_user: true, rejection_reason: "irrelevant", rejected_at: NOW }).join("; "), /rejected/);
    const confirmed = { ...base, review_status: "confirmed", verified_by_user: true, rejection_reason: undefined, rejected_at: undefined };
    assert.match(S.validateObject(confirmed).join("; "), /verified_at/);
    assert.deepEq(S.validateObject({ ...confirmed, verified_at: NOW }), []);
  });

  it("requires an auditable human reason for a workflow demonstration", () => {
    const base = {
      uid: EVD, display_id: "EVD-001", schema_version: 1, type: "evidence", created_at: NOW, updated_at: NOW,
      claim: "c", source_type: "paper", source_uid: PRJ, verified_by_user: false, review_status: "demonstration",
      locator: { source_sha256: "a".repeat(64), anchor: "b0007", quote_hash: "d2", original_url: "https://e.org/a" },
    };
    assert.match(S.validateObject(base).join("; "), /demonstration_reason/);
    assert.match(S.validateObject({ ...base, demonstration_reason: "workflow fixture", demonstrated_at: NOW }).join("; "), /demonstrated_by/);
    assert.deepEq(S.validateObject({ ...base, demonstration_reason: "workflow fixture", demonstrated_at: NOW, demonstrated_by: "user" }), []);
    assert.match(S.validateObject({ ...base, verified_by_user: true, demonstration_reason: "workflow fixture", demonstrated_at: NOW, demonstrated_by: "user" }).join("; "), /demonstration/);
  });

  it("rejects a publisher CSS selector as an anchor", () => {
    // §6 bans them because they die on the next site redesign.
    const e = {
      uid: EVD, display_id: "EVD-001", schema_version: 1, type: "evidence",
      created_at: NOW, updated_at: NOW, claim: "c", source_type: "paper", source_uid: PRJ,
      verified_by_user: false,
      locator: { source_sha256: "a".repeat(64), anchor: ".article__body > p:nth-child(3)", quote_hash: "d", original_url: "https://e.org" },
    };
    assert.match(S.validateObject(e).join("; "), /CSS selector/);
  });

  it("will not accept a YAML indicator as a conclusion", () => {
    // EXP-001 shipped with result and conclusion each holding the single
    // character "|" while its actual 1,059 characters sat in the note body.
    // Non-empty, so §4.6's guard passed and the experiment reached `concluded`
    // carrying no conclusion — a requirement defeated by one punctuation mark.
    const base = {
      uid: PRJ, display_id: "EXP-001", schema_version: 1, type: "experiment",
      created_at: NOW, updated_at: NOW, project_uid: PRJ, status: "concluded",
      title: "间隔层梯度",
      // Provenance gate, 2026-09-05: a `concluded` experiment now needs a
      // declared evidence-grade origin, or the unknown-provenance rule fires
      // and this fixture stops isolating the conclusion rule it is about.
      data_origin: "measured", data_recorded_by: "user", data_recorded_at: NOW,
      raw_data_refs: ["raw/exp-001.csv"], data_provenance_note: "台架原始记录",
    };
    for (const junk of ["|", ">", "|-", " > ", "---"])
      assert.match(S.validateObject({ ...base, conclusion: junk }).join("; "),
        /conclusion 必填/, JSON.stringify(junk) + " must not count as a conclusion");
    assert.deepEq(S.validateObject({ ...base, conclusion: "协同因子随间隔层厚度指数衰减" }), []);
  });

  it("holds an experiment to its own status contract", () => {
    const base = {
      uid: PRJ, display_id: "EXP-001", schema_version: 1, type: "experiment",
      created_at: NOW, updated_at: NOW, project_uid: PRJ,
    };
    assert.match(S.validateObject({ ...base, status: "concluded" }).join("; "), /conclusion 必填/);
    assert.match(S.validateObject({ ...base, status: "integrated", conclusion: "x" }).join("; "),
      /produced_evidence 必须非空/);
  });

  it("keeps legacy Experiment records readable but validates every explicit provenance declaration", () => {
    const base = {
      uid: PRJ, display_id: "EXP-001", schema_version: 1, type: "experiment",
      created_at: NOW, updated_at: NOW, project_uid: PRJ, status: "designed", title: "数据来源测试",
    };
    assert.deepEq(S.validateObject(base), [], "old records must remain legacy/unknown rather than being guessed as measured");
    assert.match(S.validateObject({ ...base, data_origin: "measured", data_recorded_by: "user", data_recorded_at: NOW }).join("; "), /raw_data_refs/);
    assert.match(S.validateObject({ ...base, data_origin: "simulated", data_recorded_by: "user", data_recorded_at: NOW }).join("; "), /模拟数据必须说明/);
    const measured = {
      ...base, data_origin: "measured", raw_data_refs: ["Experiments/raw/run-01.csv"],
      data_provenance_note: "GC-MS 原始导出，样品批次 S24。", data_recorded_by: "user", data_recorded_at: NOW,
    };
    assert.deepEq(S.validateObject(measured), []);
    assert.match(S.validateObject({ ...measured, status: "concluded", data_origin: "planned", raw_data_refs: [], data_provenance_note: "" }).join("; "), /planned/);
    assert.match(S.validateObject({ ...measured, status: "integrated", data_origin: "simulated", data_provenance_note: "流程演练", produced_evidence: [EVD] }).join("; "), /模拟数据/);
  });
});

describe("schema objects: Experiment title", () => {
  it("requires the human-readable title introduced with the first Experiment writer", () => {
    const e = {
      uid: "019fef48-5be0-786b-8da5-39a220613712", display_id: "EXP-001", schema_version: 1, type: "experiment",
      created_at: NOW, updated_at: NOW, project_uid: PRJ, status: "designed",
    };
    assert.match(S.validateObject(e).join("; "), /title/);
    assert.deepEq(S.validateObject({ ...e, title: "暗态对照" }), []);
  });
});

describe("schema objects: §6.2 experiment-sourced evidence", () => {
  const EXP = "019fef48-5be0-786b-8da5-39a220613712";
  const locator = {
    source_sha256: "a".repeat(64), anchor: "r0003", quote_hash: "d41d8cd9",
    original_url: "scholarium://experiment/" + EXP,
  };
  const evidence = (over = {}) => ({
    uid: EVD, display_id: "EVD-023", schema_version: 1, type: "evidence",
    created_at: NOW, updated_at: NOW,
    claim: "同温暗态对照下 CO 产率未上升",
    source_type: "experiment", source_uid: EXP, target_uid: PRJ,
    relation: "CONTRADICTS", verified_by_user: false, review_status: "pending",
    locator, ...over,
  });

  it("accepts an experiment result as a source", () => {
    // §4.5 always allowed source_type: experiment, but every one of §6's four
    // fields was written for a web archive, so the whole
    // Hypothesis → Experiment → Evidence chain was blocked at the contract
    // rather than in code.
    assert.deepEq(S.validateObject(evidence()), []);
  });

  it("refuses a vault path as the review entry point", () => {
    // §2.1 refuses paths as relation anchors because renaming breaks them. A
    // review entry that dies on rename is no better than a dangling citation.
    const e = evidence({ locator: { ...locator, original_url: "Research/Experiments/EXP-001.md" } });
    assert.match(S.validateObject(e).join("; "), /scholarium:\/\/experiment/);
  });

  it("refuses a locator pointing at a different experiment than source_uid", () => {
    const e = evidence({ locator: { ...locator, original_url: "scholarium://experiment/019fef48-0000-7000-8000-000000000000" } });
    assert.match(S.validateObject(e).join("; "), /与 source_uid 不一致/);
  });

  it("still requires source_sha256, so a superseded result is detectable", () => {
    // For a paper this pins bytes we do not control. For an experiment it pins
    // our own record as it read when the evidence was drawn — a conclusion
    // resting on an edited result is as broken as a citation into a re-rendered
    // page.
    const e = evidence({ locator: { ...locator, source_sha256: "" } });
    assert.match(S.validateObject(e).join("; "), /四项缺一不可/);
  });

  it("keeps the internal scheme out of paper evidence", () => {
    assert.match(S.validateObject(evidence({ source_type: "paper" })).join("; "), /必须是 http\(s\) 地址/);
  });
});

describe("schema objects: hypothesis change history", () => {
  it("records the cause of every transition", () => {
    const h = applyOn(hypothesis(), { status: "challenged", by: "user", cause_uid: EVD });
    assert.eq(h.status, "challenged");
    assert.eq(h.history.length, 1);
    assert.eq(h.history[0].from_status, "proposed");
    assert.eq(h.history[0].to_status, "challenged");
    assert.eq(h.history[0].cause_uid, EVD);
  });

  it("refuses a confidence set by anything other than a person", () => {
    let threw = "";
    try { applyOn(hypothesis(), { confidence: 0.8, by: "ai" }); } catch (e) { threw = e.message; }
    assert.match(threw, /只接受人工写入/);
  });

  it("stamps confidence_set_by when a person sets it", () => {
    const h = applyOn(hypothesis(), { confidence: 0.8, by: "user" });
    assert.eq(h.confidence_set_by, "user");
    assert.eq(h.history[0].to_conf, 0.8);
    assert.deepEq(S.validateObject(h), []);
  });

  it("will not file one piece of evidence as both support and contradiction", () => {
    const supported = S.linkEvidence(hypothesis(), EVD, "SUPPORTS");
    let threw = "";
    try { S.linkEvidence(supported, EVD, "CONTRADICTS"); } catch (e) { threw = e.message; }
    assert.match(threw, /不能同时支持与反驳/);
  });

  it("is idempotent when the same evidence is linked twice", () => {
    const once = S.linkEvidence(hypothesis(), EVD, "SUPPORTS");
    assert.deepEq(S.linkEvidence(once, EVD, "SUPPORTS").supporting_evidence, [EVD]);
  });

  function applyOn(h, change) { return S.applyHypothesisChange(h, change, { now: NOW }); }
});

describe("schema objects: idea (M2 §5.1)", () => {
  const idea = (extra = {}) => S.createObject("idea", { title: "SMSI 对 CO2 还原选择性的影响", ...extra }, { now: NOW });

  it("creates a valid idea with default exploring status", () => {
    const i = idea();
    assert.eq(i.type, "idea");
    assert.match(i.display_id, /^IDEA-\d+$/);
    assert.deepEq(S.validateObject(i), []);
  });

  it("round-trips hotspots/key_papers/gaps as arrays", () => {
    const i = idea({ status: "exploring", hotspots: ["SMSI", "单原子"], key_papers: ["10.1000/a"], gaps: ["缺少原位表征"] });
    const back = S.parseObject(S.serializeObject(i)).object;
    assert.deepEq(back.hotspots, ["SMSI", "单原子"]);
    assert.deepEq(back.key_papers, ["10.1000/a"]);
    assert.deepEq(back.gaps, ["缺少原位表征"]);
    assert.deepEq(S.validateObject(back), []);
  });

  // These three exercise validateObject directly on a hand-mutated copy,
  // not createObject: createObject itself validates and throws on an
  // invalid draft, so it cannot be used to construct the invalid states
  // being tested here.
  it("rejects a promoted_to that is not PRJ-NNN", () => {
    const i = { ...idea(), status: "promoted", promoted_to: "not-a-project" };
    assert.match(S.validateObject(i).join(";"), /promoted_to 必须是 PRJ-NNN/);
  });

  it("requires promoted_to when status is promoted", () => {
    const i = { ...idea(), status: "promoted" };
    assert.match(S.validateObject(i).join(";"), /promoted_to 必须指向已创建的课题/);
  });

  it("rejects promoted_to being set while status is not promoted", () => {
    const i = { ...idea(), status: "exploring", promoted_to: "PRJ-001" };
    assert.match(S.validateObject(i).join(";"), /只能在 status 为 promoted 时填写/);
  });

  it("accepts a fully promoted idea", () => {
    const i = { ...idea(), status: "promoted", promoted_to: "PRJ-001" };
    assert.deepEq(S.validateObject(i), []);
  });
});

describe("schema objects: decision (决策持久化, 2026-08-26)", () => {
  const decision = (extra = {}) => S.createObject("decision", {
    project_uid: PRJ, title: "EXP-009 本周不排期",
    decision: "EXP-009 已设计但未纳入本周正式排期；现无原定日期、调整日期或延期原因记录，因此不得标记为已延期。",
    rationale: "本周 10 个时间块里没有一个对应 EXP-009（PL/瞬态光电流/EIS 类任务本周未见）。",
    ...extra,
  }, { now: NOW });

  it("creates a valid decision with default status active and empty relates_to", () => {
    const d = decision();
    assert.eq(d.type, "decision");
    assert.match(d.display_id, /^DEC-\d+$/);
    assert.eq(d.status, "active");
    assert.deepEq(d.relates_to, []);
    assert.eq(d.decided_at, NOW); // defaults to created_at when not given explicitly
    assert.deepEq(S.validateObject(d), []);
  });

  it("rejects a decision with no rationale", () => {
    let threw = false;
    try { decision({ rationale: "" }); } catch (e) { threw = true; assert.match(e.message, /rationale/); }
    assert.ok(threw, "createObject must refuse to construct an undocumented decision");
  });

  it("round-trips relates_to (EXP/HYP uids) and an explicit trigger_condition", () => {
    const expUid = "01a01f23-7857-73e0-9122-83b9a68858b2"; // EXP-007
    const hypUid = "01a01f23-7857-705c-b985-660c8bf74707"; // HYP-005
    const d = decision({ relates_to: [expUid, hypUid], trigger_condition: "待 EXP-007 完成结构准入、EXP-008 产出 HER 初筛结果后，由研究员决定是否将 EXP-009 排入下周。" });
    const back = S.parseObject(S.serializeObject(d)).object;
    assert.deepEq(back.relates_to, [expUid, hypUid]);
    assert.match(back.trigger_condition, /由研究员决定/);
    assert.deepEq(S.validateObject(back), []);
  });

  it("keeps retired object identities and run files out of the live relation graph", () => {
    const retired = "01a01f23-7857-7433-842f-e44a4fb1b491";
    const ref = "Research/_runs/actions/2026-09-04T17-13-47-780Z experiment-append_note.json";
    const d = decision({ relates_to: [], retired_object_uids: [retired], retired_display_ids: ["EXP-009"], audit_refs: [ref] });
    const back = S.parseObject(S.serializeObject(d)).object;
    assert.deepEq(back.retired_object_uids, [retired]);
    assert.deepEq(back.retired_display_ids, ["EXP-009"]);
    assert.deepEq(back.audit_refs, [ref]);
    assert.deepEq(S.validateObject(back), []);
  });

  it("rejects an audit ref outside the immutable Research/_runs areas", () => {
    const d = { ...decision(), audit_refs: ["Research/Experiments/EXP-001.md"] };
    assert.match(S.validateObject(d).join(";"), /audit_refs 必须是 Research\/_runs/);
  });

  it("rejects a retired display id outside the frozen prefix registry", () => {
    const d = { ...decision(), retired_display_ids: ["TASK-001"] };
    assert.match(S.validateObject(d).join(";"), /retired_display_ids/);
  });

  it("rejects a relates_to entry that is not a UUIDv7", () => {
    const d = { ...decision(), relates_to: ["EXP-007"] }; // display_id, not a uid — the exact mistake this field exists to prevent
    assert.match(S.validateObject(d).join(";"), /relates_to 的每一项都必须是 UUIDv7/);
  });

  it("accepts an explicit decided_at that predates created_at (decision reached earlier, recorded later)", () => {
    const d = decision({ decided_at: "2026-08-20T00:00:00.000Z" });
    assert.eq(d.decided_at, "2026-08-20T00:00:00.000Z");
    assert.deepEq(S.validateObject(d), []);
  });

  it("accepts status: resolved", () => {
    const d = { ...decision(), status: "resolved" };
    assert.deepEq(S.validateObject(d), []);
  });
});

describe("schema objects: lesson (经验候选提取, M5 步骤1, 2026-08-26)", () => {
  const EXP_A = "01a01f23-7857-73e0-9122-83b9a68858b2"; // EXP-007
  const EXP_B = "01a01f23-7857-7925-920e-20fc8f49a0c5"; // EXP-008
  const lesson = (extra = {}) => S.createObject("lesson", {
    title: "共享设备排期容易 blocked",
    statement: "排 XPS 相关时间块时若没有提前确认设备档期，实验记录常常在同一天被标 blocked。",
    scope: "仅适用于需要预约共享表征设备（XPS/SEM）的实验，不适用于台面湿化学实验。",
    evidence_summary: "EXP-007 和 EXP-008 都因为同一台 XPS 设备冲突被回填为 blocked，两条记录相互独立。",
    evidence_refs: [EXP_A, EXP_B],
    source_types: ["execution_backfill", "drift_audit"],
    ...extra,
  }, { now: NOW });

  it("creates a valid lesson with default status active", () => {
    const l = lesson();
    assert.eq(l.type, "lesson");
    assert.match(l.display_id, /^LES-\d+$/);
    assert.eq(l.status, "active");
    assert.eq(l.project_uid, undefined, "project_uid stays unset for a cross-project lesson");
    assert.deepEq(S.validateObject(l), []);
  });

  it("rejects a lesson with empty evidence_refs — no citation, no lesson", () => {
    let threw = false;
    try { lesson({ evidence_refs: [] }); } catch (e) { threw = true; assert.match(e.message, /evidence_refs 与 audit_refs 不能同时为空/); }
    assert.ok(threw, "createObject must refuse an uncited lesson candidate");
  });

  it("accepts a lesson grounded in immutable run audits after its source object was retired", () => {
    const l = lesson({
      evidence_refs: [],
      retired_object_uids: [EXP_A],
      audit_refs: ["Research/_runs/actions/2026-08-27T01-33-55-625Z experiment-append_note.json"],
    });
    const back = S.parseObject(S.serializeObject(l)).object;
    assert.deepEq(back.evidence_refs, []);
    assert.deepEq(back.retired_object_uids, [EXP_A]);
    assert.eq(back.audit_refs.length, 1);
    assert.deepEq(S.validateObject(back), []);
  });

  it("rejects an evidence_refs entry that is not a UUIDv7 (e.g. an EXP display_id)", () => {
    const l = { ...lesson(), evidence_refs: ["EXP-007"] };
    assert.match(S.validateObject(l).join(";"), /evidence_refs 的每一项都必须是 UUIDv7/);
  });

  it("rejects an empty source_types array", () => {
    let threw = false;
    try { lesson({ source_types: [] }); } catch (e) { threw = true; assert.match(e.message, /source_types 不能为空/); }
    assert.ok(threw);
  });

  it("rejects a source_types value outside the three named categories", () => {
    const l = { ...lesson(), source_types: ["vibes"] };
    assert.match(S.validateObject(l).join(";"), /source_types 的每一项必须是 execution_backfill \| drift_audit \| decision/);
  });

  it("rejects a lesson with empty scope — applicability boundary is mandatory, not optional", () => {
    let threw = false;
    try { lesson({ scope: "" }); } catch (e) { threw = true; assert.match(e.message, /缺少必填字段 scope/); }
    assert.ok(threw);
  });

  it("accepts an explicit project_uid for a project-specific lesson", () => {
    const l = lesson({ project_uid: PRJ });
    assert.eq(l.project_uid, PRJ);
    assert.deepEq(S.validateObject(l), []);
  });

  it("round-trips through frontmatter, including the evidence_refs and source_types arrays", () => {
    const l = lesson();
    const back = S.parseObject(S.serializeObject(l)).object;
    assert.deepEq(back.evidence_refs, [EXP_A, EXP_B]);
    assert.deepEq(back.source_types, ["execution_backfill", "drift_audit"]);
    assert.deepEq(S.validateObject(back), []);
  });

  it("accepts status: retired", () => {
    const l = { ...lesson(), status: "retired" };
    assert.deepEq(S.validateObject(l), []);
  });

  it("accepts a lesson sourced purely from a decision (single independent judgment is enough for that source type)", () => {
    const DEC = "01a01f23-7857-7abc-8def-000000000001";
    const l = lesson({ evidence_refs: [DEC], source_types: ["decision"] });
    assert.deepEq(S.validateObject(l), []);
  });
});

describe("schema objects: the real vault", () => {
  it("validates every object migrated into Research/", () => {
    // The point of §7.1: these files must stand on their own. This runs against
    // the actual vault, not a fixture, so a migration that produced a
    // structurally invalid object fails here rather than in Phase 3.
    const vault = path.join(__dirname, "..", "..", "..", "..");
    if (!fs.existsSync(path.join(vault, "Research"))) return; // fresh clone
    const report = S.validateVault(vault);
    /* Changed 2026-09-05, when the provenance gate went in. Demanding zero
       problems here would have left exactly two ways forward, both wrong:
       weaken the gate, or invent a data_origin for legacy records whose
       provenance nobody actually knows. Only a human can declare that.

       So this is now a shrinking baseline. The listed records are the known
       pre-provenance experiments — EXP-001 is the one DEC-005 was written
       about. A NEW unresolved record fails this test; clearing one of these is
       expected to require deleting its line. The list must never grow. */
    const KNOWN_LEGACY_PROVENANCE_GAPS = ["EXP-001", "EXP-003", "EXP-004"];
    const isKnownGap = (p) => /data_origin 为 unknown/.test(p.message)
      && KNOWN_LEGACY_PROVENANCE_GAPS.some((id) => p.path.includes(id) || p.message.includes(id));
    const unexpected = report.problems.filter((p) => !isKnownGap(p));
    assert.deepEq(unexpected.map((p) => p.path + ": " + p.message), [],
      "除已登记的遗留 provenance 缺口外，不得出现新的 schema 问题");
    // The contaminated subgraph is wider than the three experiments: their
    // Evidence and the Hypotheses those support are pulled in too. Pin the
    // size so that clearing EXP-001 visibly shrinks it, and so that a new
    // record quietly joining it cannot pass unnoticed.
    // Baseline 2026-09-05: 17 = 3 experiments blocked from `concluded`
    // + the same 3 blocked from producing Evidence + 6 confirmed Evidence
    // resting on them + 5 hypothesis support links drawing on those.
    assert.ok(report.problems.length <= 17,
      "遗留 provenance 污染面不得扩大，当前 " + report.problems.length + " 条");
  });

  it("reports unresolvable relations instead of ignoring them", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sch-obj-"));
    fs.mkdirSync(path.join(dir, "Research", "Hypotheses"), { recursive: true });
    fs.writeFileSync(path.join(dir, "Research", "Hypotheses", "h.md"),
      S.serializeObject(hypothesis()), "utf8");
    const report = S.validateVault(dir);
    assert.notOk(report.valid, "project_uid points at a Project that is not there");
    assert.match(report.problems.map((p) => p.message).join(" "), /指向不存在的 uid/);
  });
});
