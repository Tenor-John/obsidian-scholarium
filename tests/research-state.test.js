"use strict";
// Tests for tools/research-state.js — the M1 L0 read channel
// (project.list / project.get / experiment.scan_outcomes) and its wiring into
// tools/action-registry.js. Fixtures are real schema-v1 Markdown written to a
// temp vault, so the tests exercise the same parse path the vault uses.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const S = require("../tools/schema-objects");
const RS = require("../tools/research-state");
const registry = require("../tools/action-registry");

const HEX64 = "a".repeat(64);
const NOW = "2026-08-17T02:00:00.000Z";

function writeObject(vault, dir, filename, object) {
  const target = path.join(vault, "Research", dir, filename);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, S.serializeObject(object, "\n# " + filename + "\n"), "utf8");
}

// A two-project fixture:
//   PRJ-001: 2 hypotheses, 3 experiments (concluded / running / integrated),
//            3 evidence (confirmed SUPPORTS, pending CONTRADICTS, rejected SUPPORTS)
//   PRJ-002: empty, proves counts don't leak across projects
function makeVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-research-state-"));
  // createObject assigns display_id per call; thread existingDisplayIds so
  // same-type objects get distinct, sequential ids matching their filenames.
  const prj1 = S.createObject("project", { title: "课题一", status: "active", stage: "验证期" }, { now: NOW });
  const prj2 = S.createObject("project", { title: "课题二", status: "paused" }, { now: NOW, existingDisplayIds: [prj1.display_id] });
  const hyp1 = S.createObject("hypothesis", { project_uid: prj1.uid, statement: "假设一：双波长存在协同。" }, { now: NOW });
  const hyp2 = S.createObject("hypothesis", { project_uid: prj1.uid, statement: "假设二：界面电荷转移主导。" }, { now: NOW, existingDisplayIds: [hyp1.display_id] });
  const paper = S.createObject("paper", { title: "一篇文献", source: "https://example.org/p1" }, { now: NOW });

  const exp1 = S.createObject("experiment", {
    project_uid: prj1.uid, title: "对比实验", status: "concluded",
    conclusion: "双波长下协同因子 2.38，支持假设一。",
    tests_hypotheses: [hyp1.uid],
    data_origin: "measured", raw_data_refs: ["data/run1.csv"],
    data_provenance_note: "GC 实测", data_recorded_by: "user", data_recorded_at: NOW,
  }, { now: NOW });
  const exp2 = S.createObject("experiment", {
    project_uid: prj1.uid, title: "梯度实验", status: "running",
    // 不声明 data_origin：遗留/未声明是合法读取态（schema-v1 §4.6），
    // 一旦声明就必须补齐 data_recorded_by/at 三个溯源字段。
  }, { now: NOW, existingDisplayIds: [exp1.display_id] });
  const evd3 = S.createObject("evidence", {
    source_type: "paper", source_uid: paper.uid, target_uid: hyp2.uid,
    relation: "QUALIFIES", claim: "仅在固定光通量下成立。",
    verified_by_user: true, review_status: "confirmed", verified_at: NOW,
    locator: { source_sha256: HEX64, anchor: "a3", quote_hash: "h3", original_url: "https://example.org/p1" },
  }, { now: NOW });
  const exp3 = S.createObject("experiment", {
    project_uid: prj1.uid, title: "已整合实验", status: "integrated",
    conclusion: "已产出证据。", produced_evidence: [evd3.uid],
    data_origin: "measured", raw_data_refs: ["data/run3.csv"],
    data_provenance_note: "GC 实测", data_recorded_by: "user", data_recorded_at: NOW,
  }, { now: NOW, existingDisplayIds: [exp1.display_id, exp2.display_id] });

  const evd1 = S.createObject("evidence", {
    source_type: "paper", source_uid: paper.uid, target_uid: hyp1.uid,
    relation: "SUPPORTS", claim: "文献支持协同存在。",
    verified_by_user: true, review_status: "confirmed", verified_at: NOW,
    locator: { source_sha256: HEX64, anchor: "a1", quote_hash: "h1", original_url: "https://example.org/p1" },
  }, { now: NOW, existingDisplayIds: [evd3.display_id] });
  const evd2 = S.createObject("evidence", {
    source_type: "paper", source_uid: paper.uid, target_uid: hyp1.uid,
    relation: "CONTRADICTS", claim: "候选反驳，待审。",
    verified_by_user: false, review_status: "pending",
    locator: { source_sha256: HEX64, anchor: "a2", quote_hash: "h2", original_url: "https://example.org/p1" },
  }, { now: NOW, existingDisplayIds: [evd3.display_id, "EVD-002"] });
  const evd4 = S.createObject("evidence", {
    source_type: "paper", source_uid: paper.uid, target_uid: hyp1.uid,
    relation: "SUPPORTS", claim: "被驳回的候选。",
    verified_by_user: false, review_status: "rejected",
    rejection_reason: "引文与假设无关。", rejected_at: NOW, rejected_by: "user",
    locator: { source_sha256: HEX64, anchor: "a4", quote_hash: "h4", original_url: "https://example.org/p1" },
  }, { now: NOW, existingDisplayIds: [evd3.display_id, "EVD-002", "EVD-003"] });

  writeObject(vault, "Projects", "PRJ-001.md", prj1);
  writeObject(vault, "Projects", "PRJ-002.md", prj2);
  writeObject(vault, "Hypotheses", "HYP-001.md", hyp1);
  writeObject(vault, "Hypotheses", "HYP-002.md", hyp2);
  writeObject(vault, "Papers", "PAPER-001.md", paper);
  writeObject(vault, "Experiments", "EXP-001.md", exp1);
  writeObject(vault, "Experiments", "EXP-002.md", exp2);
  writeObject(vault, "Experiments", "EXP-003.md", exp3);
  writeObject(vault, "Evidence", "EVD-001.md", evd1);
  writeObject(vault, "Evidence", "EVD-002.md", evd2);
  writeObject(vault, "Evidence", "EVD-003.md", evd3);
  writeObject(vault, "Evidence", "EVD-004.md", evd4);

  const dec1 = S.createObject("decision", {
    project_uid: prj1.uid, title: "EXP-002 本周不排期",
    decision: "EXP-002 未纳入本周正式排期，不得标记为已延期。",
    rationale: "本周时间块里没有一条对应 EXP-002。",
    relates_to: [exp2.uid, hyp1.uid], status: "active",
  }, { now: NOW });
  const dec2 = S.createObject("decision", {
    project_uid: prj1.uid, title: "已解决的旧决策",
    decision: "占位，仅用于验证 resolved 排序在 active 之后。",
    rationale: "测试夹具。", status: "resolved",
  }, { now: NOW, existingDisplayIds: [dec1.display_id] });
  writeObject(vault, "Decisions", "DEC-001.md", dec1);
  writeObject(vault, "Decisions", "DEC-002.md", dec2);

  // M5 步骤1（2026-08-26）：一条课题专属经验（挂 prj1）、一条跨课题方法论
  // 经验（project_uid 不填，两个课题的 project.get 都该看到）、一条已退休
  // 的经验（验证 retired 排在 active 后面）。
  const les1 = S.createObject("lesson", {
    project_uid: prj1.uid, title: "同一设备连续排期容易 blocked",
    statement: "同一台共享设备连续两天排给不同实验时，后一条常因设备未清空被回填为 blocked。",
    scope: "仅适用于课题一里依赖共享表征设备的实验。",
    evidence_summary: "EXP-001 和 EXP-002 都在回填记录里提到设备冲突，两条独立。",
    evidence_refs: [exp1.uid, exp2.uid], source_types: ["execution_backfill", "drift_audit"],
    status: "active",
  }, { now: NOW });
  const les2 = S.createObject("lesson", {
    title: "决策优先于口头共识",
    statement: "一旦某个安排被正式记成决策，后续排期建议必须先核对该决策，而不是依赖聊天里的口头共识。",
    scope: "适用于所有课题——不限于课题一。",
    evidence_summary: "DEC-001 明确排除了 EXP-002 本周排期，若不查决策记录容易重复建议冲突安排。",
    evidence_refs: [dec1.uid], source_types: ["decision"],
    status: "active",
  }, { now: NOW, existingDisplayIds: [les1.display_id] });
  const les3 = S.createObject("lesson", {
    project_uid: prj1.uid, title: "已作废的旧经验",
    statement: "占位，仅用于验证 retired 排序在 active 之后。",
    scope: "占位。", evidence_summary: "占位测试夹具。",
    evidence_refs: [exp3.uid], source_types: ["drift_audit"],
    status: "retired",
  }, { now: NOW, existingDisplayIds: [les1.display_id, les2.display_id] });
  writeObject(vault, "Lessons", "LES-001.md", les1);
  writeObject(vault, "Lessons", "LES-002.md", les2);
  writeObject(vault, "Lessons", "LES-003.md", les3);

  return { vault, prj1, prj2, hyp1, hyp2, exp1, exp2, exp3, dec1, dec2, les1, les2, les3 };
}

describe("research-state: project.list", () => {
  it("lists every project with identity, lifecycle state and per-type counts", () => {
    const { vault } = makeVault();
    const { projects, total } = RS.listProjects(vault);
    assert.eq(total, 2);
    const p1 = projects.find((p) => p.display_id === "PRJ-001");
    const p2 = projects.find((p) => p.display_id === "PRJ-002");
    assert.ok(p1 && p2, "both projects must be listed");
    assert.eq(p1.title, "课题一");
    assert.eq(p1.status, "active");
    assert.deepEq(p1.counts, { questions: 0, hypotheses: 2, experiments: 3, evidence: 4 });
    assert.eq(p1.unsettled_experiments, 1, "EXP-001 concluded-but-not-integrated is the unsettled one");
    assert.deepEq(p2.counts, { questions: 0, hypotheses: 0, experiments: 0, evidence: 0 });
    assert.eq(p2.unsettled_experiments, 0);
    assert.match(p1.path, /^Research\/Projects\//);
  });
  it("returns an empty registry for a vault without Research/", () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-empty-"));
    assert.deepEq(RS.listProjects(vault), { projects: [], total: 0 });
  });
});

describe("research-state: project.get", () => {
  it("resolves by display_id and returns hypotheses with settlement tallies", () => {
    const { vault } = makeVault();
    const detail = RS.getProject(vault, { display_id: "PRJ-001" });
    assert.eq(detail.project.title, "课题一");
    assert.eq(detail.hypotheses.length, 2);
    const h1 = detail.hypotheses.find((h) => h.display_id === "HYP-001");
    assert.deepEq(h1.settlement, { supports: 1, contradicts: 0, qualifies: 0, pending: 1, rejected: 1 });
    const h2 = detail.hypotheses.find((h) => h.display_id === "HYP-002");
    assert.deepEq(h2.settlement, { supports: 0, contradicts: 0, qualifies: 1, pending: 0, rejected: 0 });
    assert.eq(detail.experiments.length, 3);
    assert.eq(detail.counts.evidence, 4);
    // 决策持久化（2026-08-26）：project.get 捆带这个课题的决策，active 排在
    // resolved 前面，供聊天预取直接注入"项目状态"块，不需要单独再拉一次。
    assert.eq(detail.decisions.length, 2);
    assert.eq(detail.counts.decisions, 2);
    assert.eq(detail.decisions[0].status, "active");
    assert.eq(detail.decisions[0].display_id, "DEC-001");
    assert.deepEq(detail.decisions[0].relates_to.map((r) => r.display_id), ["EXP-002", "HYP-001"]);
    assert.eq(detail.decisions[1].status, "resolved");
    // M5 步骤1：project.get 同样捆带这个课题相关的经验——课题专属的
    // （project_uid 匹配）加上跨课题通用的（project_uid 未填）；和 decisions
    // 一样不按 status 过滤（resolved 决策也照样返回），active 排在
    // retired/resolved 之前，供聊天在给建议前一眼看到最新有效的那些。
    assert.eq(detail.lessons.length, 3, "les1 (PRJ-001) + les2 (cross-project) + les3 (retired, PRJ-001)");
    assert.eq(detail.counts.lessons, 3);
    assert.eq(detail.lessons[0].status, "active");
    assert.eq(detail.lessons[1].status, "active");
    assert.eq(detail.lessons[2].status, "retired");
    assert.eq(detail.lessons[2].display_id, "LES-003");
    const crossProject = detail.lessons.find((l) => l.display_id === "LES-002");
    assert.eq(crossProject.project_uid, null, "the cross-project lesson keeps no project_uid even when surfaced under PRJ-001");
    assert.deepEq(crossProject.evidence_refs.map((r) => r.display_id), ["DEC-001"]);
  });
  it("resolves by project_uid and never leaks another project's objects", () => {
    const { vault, prj1, prj2 } = makeVault();
    const detail = RS.getProject(vault, { project_uid: prj1.uid });
    assert.eq(detail.project.uid, prj1.uid);
    const other = RS.getProject(vault, { project_uid: prj2.uid });
    assert.eq(other.hypotheses.length, 0);
    assert.eq(other.experiments.length, 0);
  });
  it("throws project_not_found for an unknown reference", () => {
    const { vault } = makeVault();
    let threw = false;
    try { RS.getProject(vault, { display_id: "PRJ-999" }); }
    catch (e) { threw = true; assert.match(e.message, /project_not_found/); }
    assert.ok(threw);
  });
});

describe("research-state: experiment.scan_outcomes", () => {
  it("buckets concluded-not-integrated as awaiting_integration with hypothesis display ids", () => {
    const { vault } = makeVault();
    const scan = RS.scanExperimentOutcomes(vault);
    assert.eq(scan.awaiting_integration.length, 1);
    const exp = scan.awaiting_integration[0];
    assert.eq(exp.display_id, "EXP-001");
    assert.eq(exp.has_conclusion, true);
    assert.eq(exp.project_display_id, "PRJ-001", "scan results must name the owning project for downstream prompt assembly");
    assert.match(exp.conclusion_excerpt, /协同因子 2\.38/);
    assert.deepEq(exp.tests_hypotheses.map((h) => h.display_id), ["HYP-001"]);
    assert.eq(scan.in_progress.length, 1);
    assert.eq(scan.in_progress[0].display_id, "EXP-002");
    assert.deepEq(scan.counts, { awaiting_integration: 1, in_progress: 1, settled: 1, invalidated: 0, planned: 0, total: 3 });
  });
  it("scopes to one project when project_uid is given", () => {
    const { vault, prj2 } = makeVault();
    const scan = RS.scanExperimentOutcomes(vault, { project_uid: prj2.uid });
    assert.deepEq(scan.counts, { awaiting_integration: 0, in_progress: 0, settled: 0, invalidated: 0, planned: 0, total: 0 });
  });
  it("throws project_not_found for an unknown scope", () => {
    const { vault } = makeVault();
    let threw = false;
    try { RS.scanExperimentOutcomes(vault, { project_uid: "019ff070-9601-7fc3-8c67-110e08c6bb33" }); }
    catch (e) { threw = true; assert.match(e.message, /project_not_found/); }
    assert.ok(threw);
  });
});

describe("research-state: decision.list", () => {
  it("lists decisions, active before resolved, with relates_to resolved to display ids", () => {
    const { vault } = makeVault();
    const { decisions, total } = RS.listDecisions(vault);
    assert.eq(total, 2);
    assert.eq(decisions[0].display_id, "DEC-001");
    assert.eq(decisions[0].status, "active");
    assert.eq(decisions[1].status, "resolved");
  });
  it("scopes to one project_uid like experiment.scan_outcomes does", () => {
    const { vault, prj2 } = makeVault();
    const { decisions, total } = RS.listDecisions(vault, { project_uid: prj2.uid });
    assert.eq(total, 0);
    assert.deepEq(decisions, []);
  });
});

describe("research-state: lesson.list (M5 步骤1)", () => {
  it("lists every lesson unscoped, active before retired", () => {
    const { vault } = makeVault();
    const { lessons, total } = RS.listLessons(vault);
    assert.eq(total, 3);
    assert.eq(lessons[2].status, "retired");
    assert.eq(lessons[2].display_id, "LES-003");
  });
  it("scoping to one project keeps that project's lessons plus every cross-project one, but not another project's", () => {
    const { vault, prj1, prj2 } = makeVault();
    const scopedToPrj1 = RS.listLessons(vault, { project_uid: prj1.uid });
    // les1 (PRJ-001) + les2 (cross-project) + les3 (retired, PRJ-001) — same
    // "project-specific OR unscoped" rule as project.get's bundling above.
    assert.eq(scopedToPrj1.total, 3);
    const scopedToPrj2 = RS.listLessons(vault, { project_uid: prj2.uid });
    // PRJ-002 owns none of les1/les3, but still sees the cross-project les2.
    assert.eq(scopedToPrj2.total, 1);
    assert.eq(scopedToPrj2.lessons[0].display_id, "LES-002");
  });
  it("resolves evidence_refs uids to display ids, same convention as decision.list's relates_to", () => {
    const { vault } = makeVault();
    const { lessons } = RS.listLessons(vault);
    const les1 = lessons.find((l) => l.display_id === "LES-001");
    assert.deepEq(les1.evidence_refs.map((r) => r.display_id).sort(), ["EXP-001", "EXP-002"]);
    assert.deepEq(les1.source_types, ["execution_backfill", "drift_audit"]);
  });
});

describe("research-state: action-registry wiring", () => {
  it("registers the M1/M3 reads as L0 / read_only / no confirmation, runnable via sync run()", () => {
    for (const name of ["project.list", "project.get", "experiment.scan_outcomes", "research.ids"]) {
      const d = registry.describe(name);
      assert.eq(d.level, "L0", name);
      assert.eq(d.risk, "read_only", name);
      assert.eq(d.requires_confirmation, false, name);
      assert.eq(d.async, false, name + " must stay sync so the Bridge can serve it directly");
    }
    const { vault } = makeVault();
    const manifest = registry.run(vault, "project.list", {}, {});
    assert.eq(manifest.action, "project.list");
    assert.eq(manifest.dry_run, true, "default is dry-run; reads behave identically either way");
    assert.eq(manifest.result.total, 2);
  });
  it("a dry-run writes no audit file; a real run writes one under Research/_runs/actions/", () => {
    const { vault } = makeVault();
    registry.run(vault, "project.list", {}, { dryRun: true });
    assert.notOk(fs.existsSync(path.join(vault, "Research", "_runs", "actions")), "dry-run must not write");
    const manifest = registry.run(vault, "project.list", {}, { dryRun: false, by: "test" });
    const dir = path.join(vault, "Research", "_runs", "actions");
    const files = fs.readdirSync(dir).filter((f) => f.includes("project-list"));
    assert.eq(files.length, 1);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
    assert.eq(onDisk.manifest_sha256, manifest.manifest_sha256);
  });
  it("input errors propagate as ordinary action errors", () => {
    const { vault } = makeVault();
    let threw = false;
    try { registry.run(vault, "project.get", { display_id: "PRJ-999" }, {}); }
    catch (e) { threw = true; assert.match(e.message, /project_not_found/); }
    assert.ok(threw);
  });
});

describe("research-state: research.ids", () => {
  it("allocates M3 draft ids against every Project, not only the selected one", () => {
    const { vault } = makeVault();
    const result = RS.listDisplayIds(vault, { types: ["hypothesis", "experiment"] });
    assert.deepEq(result.ids.hypothesis, ["HYP-001", "HYP-002"]);
    assert.deepEq(result.ids.experiment, ["EXP-001", "EXP-002", "EXP-003"]);
  });
});
