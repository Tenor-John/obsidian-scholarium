"use strict";
/**
 * Hypotheses, the evidence that bears on them, and the line §4.5 draws between
 * what a person has confirmed and what a machine merely proposed.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const H = require("../tools/hypothesis-store");
const S = require("../tools/schema-objects");

const NOW = "2026-08-11T00:00:00.000Z";
const PROJECT = "019fef48-5be0-786b-8da5-39a220613712";
const PAPER = "019fef48-5be1-79a0-82ad-2770965f8be4";

function vault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sch-hyp-"));
  fs.mkdirSync(path.join(root, "Research", "Projects"), { recursive: true });
  fs.writeFileSync(path.join(root, "Research", "Projects", "PRJ-001.md"),
    S.serializeObject({
      uid: PROJECT, display_id: "PRJ-001", schema_version: 1, type: "project",
      created_at: NOW, updated_at: NOW, title: "光催化 CO2 还原", status: "active",
    }), "utf8");
  fs.mkdirSync(path.join(root, "Research", "Papers"), { recursive: true });
  fs.writeFileSync(path.join(root, "Research", "Papers", "p.md"),
    S.serializeObject({
      uid: PAPER, display_id: "PAPER-001", schema_version: 1, type: "paper",
      created_at: NOW, updated_at: NOW, title: "A paper", source: "https://e.org/a",
    }), "utf8");
  return root;
}

const newHypothesis = (v, extra = {}) => S.createObject("hypothesis", {
  project_uid: PROJECT, statement: "Au 热电子注入半导体促进 CO2 还原", ...extra,
}, { existingDisplayIds: H.loadAll(v, "hypothesis").map((e) => e.object.display_id), now: NOW });

function newEvidence(v, target, relation, extra = {}) {
  return S.createObject("evidence", {
    claim: "525 nm 光照下 CO 产率上升", source_type: "paper", source_uid: PAPER,
    target_uid: target, relation, created_by: "user", verified_by_user: false,
    locator: {
      source_sha256: "a".repeat(64), anchor: "b0037",
      quote_hash: "cfdb6136d4d268547a3c4b50686d3b67", original_url: "https://e.org/a",
    },
    ...extra,
  }, { existingDisplayIds: H.loadAll(v, "evidence").map((e) => e.object.display_id), now: NOW });
}

function newSimulatedExperiment(v) {
  const experiment = S.createObject("experiment", {
    title: "Workflow demonstration", project_uid: PROJECT, status: "concluded",
    result: "Demonstration result.", conclusion: "Workflow-only conclusion.",
    data_origin: "simulated", raw_data_refs: [],
    data_provenance_note: "Researcher-declared simulated workflow data.",
    data_recorded_by: "user", data_recorded_at: NOW,
  }, { existingDisplayIds: H.loadAll(v, "experiment").map((e) => e.object.display_id), now: NOW });
  return { object: experiment, path: H.saveObject(v, experiment) };
}

describe("hypothesis store: persistence", () => {
  it("writes a hypothesis that reads back identically", () => {
    const v = vault();
    const h = newHypothesis(v);
    const p = H.saveObject(v, h);
    const back = S.parseObject(fs.readFileSync(path.join(v, ...p.split("/")), "utf8")).object;
    assert.deepEq(back, h);
  });

  it("refuses to write an object that does not satisfy §4", () => {
    const v = vault();
    let threw = "";
    try { H.saveObject(v, { ...newHypothesis(v), status: "maybe" }); } catch (e) { threw = e.message; }
    assert.match(threw, /拒绝写入不合法对象/);
  });

  it("keeps display ids unique as hypotheses accumulate", () => {
    const v = vault();
    H.saveObject(v, newHypothesis(v));
    assert.eq(H.nextDisplayId(v, "hypothesis"), "HYP-002");
  });

  it("updates an existing object in place when editable text changes", () => {
    const v = vault();
    const h = newHypothesis(v);
    const relative = H.saveObject(v, h);
    H.saveExistingObject(v, relative, { ...h, statement: "Revised statement", updated_at: NOW });
    const all = H.loadAll(v, "hypothesis");
    assert.eq(all.length, 1, "an edited title must not create a second object with the same uid");
    assert.eq(all[0].object.statement, "Revised statement");
    assert.eq(all[0].path, relative, "the stable original path remains the update target");
  });
});

describe("hypothesis store: where each type lives", () => {
  it("can save an experiment, not only read one", () => {
    // DIRS listed hypothesis and evidence only, so loadAll could read the
    // experiments the plugin had written while saveObject refused to create
    // one: the tools could observe the Experiment → Evidence chain without
    // being able to extend it.
    const v = vault();
    const e = S.createObject("experiment", {
      title: "间隔层梯度", project_uid: PROJECT, status: "designed",
    }, { now: NOW });
    const p = H.saveObject(v, e);
    assert.match(p, /^Research\/Experiments\/EXP-001 /);
    assert.deepEq(S.parseObject(fs.readFileSync(path.join(v, ...p.split("/")), "utf8")).object, e);
  });

  it("names each type from its own headline field", () => {
    // Falling back to `claim` for everything that was not a hypothesis produced
    // "EXP-002 undefined.md".
    const v = vault();
    const e = S.createObject("experiment", {
      title: "双波长对照", project_uid: PROJECT, status: "idea",
    }, { now: NOW });
    assert.match(H.saveObject(v, e), /EXP-001 双波长对照\.md$/);
    assert.notOk(/undefined/.test(H.objectPath(v, e)));
  });
});

describe("hypothesis store: the three columns", () => {
  it("holds unconfirmed evidence in pending, out of the formal arrays", () => {
    const v = vault();
    const h = newHypothesis(v);
    H.saveObject(v, h);
    H.saveObject(v, newEvidence(v, h.uid, "SUPPORTS"));

    const view = H.hypothesisView(v, h.uid);
    assert.eq(view.pending.length, 1);
    assert.eq(view.supporting.length, 0, "§4.5: unconfirmed evidence is a candidate, not support");
    assert.deepEq(view.problems, []);
  });

  it("keeps human-rejected evidence out of both pending and formal columns", () => {
    const v = vault();
    const h = newHypothesis(v);
    H.saveObject(v, h);
    const e = newEvidence(v, h.uid, "SUPPORTS");
    H.saveObject(v, e);
    H.rejectEvidence(v, e.uid, "The passage is about a different material system.", { now: NOW });
    const view = H.hypothesisView(v, h.uid);
    assert.eq(view.pending.length, 0);
    assert.eq(view.rejected.length, 1);
    assert.eq(view.supporting.length, 0);
    assert.deepEq(view.problems, []);
  });

  it("splits confirmed evidence by what it actually says", () => {
    const v = vault();
    const h = newHypothesis(v);
    H.saveObject(v, h);
    for (const rel of ["SUPPORTS", "CONTRADICTS", "QUALIFIES"])
      H.saveObject(v, newEvidence(v, h.uid, rel));
    for (const e of H.loadAll(v, "evidence")) H.confirmEvidence(v, e.object.uid, { now: NOW });

    const view = H.hypothesisView(v, h.uid);
    assert.eq(view.supporting.length, 1);
    assert.eq(view.contradicting.length, 1);
    assert.eq(view.qualifying.length, 1, "QUALIFIES is neither support nor refutation");
    assert.eq(view.pending.length, 0);
    assert.deepEq(view.problems, []);

    // §4.3 gives a Hypothesis two arrays and no third. Evidence that narrows a
    // hypothesis's conditions is not evidence for it, so it stays out of both
    // and remains reachable through its own target_uid.
    const h2 = H.loadAll(v, "hypothesis")[0].object;
    assert.eq(h2.supporting_evidence.length, 1);
    assert.eq(h2.contradicting_evidence.length, 1);
    assert.eq(view.qualifying[0].object.relation, "QUALIFIES");
    assert.notOk([...h2.supporting_evidence, ...h2.contradicting_evidence]
      .includes(view.qualifying[0].object.uid), "a qualification must not become a vote in favour");
  });

  it("reports a formal array that disagrees with the evidence itself", () => {
    const v = vault();
    const h = newHypothesis(v);
    const e = newEvidence(v, h.uid, "CONTRADICTS");
    H.saveObject(v, { ...e, verified_by_user: true, review_status: "confirmed", verified_at: NOW });
    // Filed as support while the evidence says it contradicts.
    H.saveObject(v, { ...h, supporting_evidence: [e.uid] });
    assert.match(H.hypothesisView(v, h.uid).problems.join(" "), /与证据自身的 relation 不一致/);
  });

  it("reports unconfirmed evidence smuggled into a formal array", () => {
    const v = vault();
    const h = newHypothesis(v);
    const e = newEvidence(v, h.uid, "SUPPORTS");
    H.saveObject(v, e);
    H.saveObject(v, { ...h, supporting_evidence: [e.uid] });
    assert.match(H.hypothesisView(v, h.uid).problems.join(" "), /违反 §4\.5/);
  });

  it("reports confirmed evidence the hypothesis never filed", () => {
    const v = vault();
    const h = newHypothesis(v);
    H.saveObject(v, h);
    H.saveObject(v, { ...newEvidence(v, h.uid, "SUPPORTS"), verified_by_user: true, review_status: "confirmed", verified_at: NOW });
    assert.match(H.hypothesisView(v, h.uid).problems.join(" "), /未登记进 supporting_evidence/);
  });
});

describe("hypothesis store: confirmation", () => {
  it("confirms and files in one step", () => {
    const v = vault();
    const h = newHypothesis(v);
    H.saveObject(v, h);
    const e = newEvidence(v, h.uid, "SUPPORTS");
    H.saveObject(v, e);

    const result = H.confirmEvidence(v, e.uid, { now: NOW });
    assert.eq(result.evidence.verified_by_user, true);
    assert.eq(result.evidence.review_status, "confirmed");
    assert.eq(result.evidence.verified_at, NOW);
    assert.deepEq(result.hypothesis.supporting_evidence, [e.uid]);

    const view = H.hypothesisView(v, h.uid);
    assert.eq(view.supporting.length, 1);
    assert.deepEq(view.problems, [], "confirming without filing would leave a problem behind");
  });

  it("records a reason for rejection and refuses to silently re-confirm it", () => {
    const v = vault();
    const h = newHypothesis(v);
    H.saveObject(v, h);
    const e = newEvidence(v, h.uid, "SUPPORTS");
    H.saveObject(v, e);
    const rejected = H.rejectEvidence(v, e.uid, "The quote is unrelated to this hypothesis.", { now: NOW });
    assert.eq(rejected.review_status, "rejected");
    assert.eq(rejected.rejection_reason, "The quote is unrelated to this hypothesis.");
    assert.eq(rejected.rejected_at, NOW);
    let threw = "";
    try { H.confirmEvidence(v, e.uid, { now: NOW }); } catch (err) { threw = err.message; }
    assert.match(threw, /人工驳回/);
  });

  it("does not permit a blank rejection reason", () => {
    const v = vault();
    const h = newHypothesis(v);
    H.saveObject(v, h);
    const e = newEvidence(v, h.uid, "SUPPORTS");
    H.saveObject(v, e);
    let threw = "";
    try { H.rejectEvidence(v, e.uid, "   ", { now: NOW }); } catch (err) { threw = err.message; }
    assert.match(threw, /必须填写原因/);
  });

  it("refuses to confirm evidence that names no target", () => {
    const v = vault();
    const h = newHypothesis(v);
    H.saveObject(v, h);
    const e = newEvidence(v, h.uid, "SUPPORTS");
    delete e.target_uid;
    H.saveObject(v, e);
    let threw = "";
    try { H.confirmEvidence(v, e.uid, { now: NOW }); } catch (err) { threw = err.message; }
    assert.match(threw, /孤立记录/);
  });

  it("refuses to confirm evidence pointing at a hypothesis that is not there", () => {
    const v = vault();
    H.saveObject(v, newEvidence(v, "019fef48-0000-7000-8000-000000000000", "SUPPORTS"));
    const e = H.loadAll(v, "evidence")[0].object;
    let threw = "";
    try { H.confirmEvidence(v, e.uid, { now: NOW }); } catch (err) { threw = err.message; }
    assert.match(threw, /指向的假设不存在/);
  });

  it("will not file one piece of evidence as both support and refutation", () => {
    const v = vault();
    const h = newHypothesis(v);
    const e = newEvidence(v, h.uid, "SUPPORTS");
    H.saveObject(v, { ...h, supporting_evidence: [e.uid] });
    H.saveObject(v, e);
    let threw = "";
    try { S.linkEvidence(H.loadAll(v, "hypothesis")[0].object, e.uid, "CONTRADICTS"); }
    catch (err) { threw = err.message; }
    assert.match(threw, /不能同时支持与反驳/);
  });
});

describe("hypothesis store: workflow demonstrations", () => {
  it("retains simulated workflow evidence but removes it from formal research state", () => {
    const v = vault();
    const h = newHypothesis(v);
    const hPath = H.saveObject(v, h);
    const experiment = newSimulatedExperiment(v);
    const e = S.createObject("evidence", {
      claim: "The workflow demonstration produced a stronger synchronous signal.",
      source_type: "experiment", source_uid: experiment.object.uid,
      target_uid: h.uid, relation: "SUPPORTS", created_by: "user", verified_by_user: true,
      review_status: "confirmed", verified_at: NOW,
      locator: {
        source_sha256: "a".repeat(64), anchor: "r0001", quote_hash: "d2",
        original_url: `scholarium://experiment/${experiment.object.uid}`,
      },
    }, { existingDisplayIds: [], now: NOW });
    const ePath = H.saveObject(v, e);
    H.saveExistingObject(v, hPath, { ...h, supporting_evidence: [e.uid], updated_at: NOW });
    H.saveExistingObject(v, experiment.path, { ...experiment.object, produced_evidence: [e.uid], updated_at: NOW });

    const result = H.demonstrateEvidence(v, e.uid, "Source Experiment is declared simulated and retained only for workflow verification.", { now: NOW });
    assert.eq(result.evidence.review_status, "demonstration");
    assert.eq(result.evidence.verified_by_user, false);
    assert.eq(result.evidence.demonstrated_at, NOW);
    assert.eq(result.hypothesis.supporting_evidence.length, 0);
    assert.eq(result.experiment.produced_evidence.length, 0);
    const view = H.hypothesisView(v, h.uid);
    assert.eq(view.demonstration.length, 1);
    assert.eq(view.pending.length, 0);
    assert.deepEq(view.problems, []);
    assert.eq(S.parseObject(fs.readFileSync(path.join(v, ...ePath.split("/")), "utf8")).object.review_status, "demonstration");
  });
});

describe("hypothesis store: orphans", () => {
  it("finds evidence that names no target", () => {
    const v = vault();
    const e = newEvidence(v, PROJECT, "SUPPORTS");
    delete e.target_uid;
    H.saveObject(v, e);
    assert.eq(H.orphanEvidence(v).length, 1);
  });

  it("finds evidence whose target has gone", () => {
    const v = vault();
    H.saveObject(v, newEvidence(v, "019fef48-0000-7000-8000-000000000000", "SUPPORTS"));
    assert.eq(H.orphanEvidence(v).length, 1);
  });

  it("does not call a properly targeted piece of evidence an orphan", () => {
    const v = vault();
    const h = newHypothesis(v);
    H.saveObject(v, h);
    H.saveObject(v, newEvidence(v, h.uid, "SUPPORTS"));
    assert.deepEq(H.orphanEvidence(v), []);
  });
});

describe("hypothesis store: the real vault", () => {
  it("reports no orphaned evidence", () => {
    const v = path.join(__dirname, "..", "..", "..", "..");
    if (!fs.existsSync(path.join(v, "Research"))) return;
    const r = H.report(v);
    assert.deepEq(r.orphans, [], "every Evidence must name a target that exists");
    for (const h of r.hypotheses)
      assert.deepEq(h.problems, [], h.display_id + " has inconsistencies");
  });
});
