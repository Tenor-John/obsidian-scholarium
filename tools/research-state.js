"use strict";
// L0 read-only views over the vault's schema-v1 Markdown objects
// (Research/Projects, Research/Hypotheses, Research/Experiments, ...).
//
// These handlers are the M1 "read channel" of the self-evolving agent design
// (docs/self-evolving-agent-design.md §4): the panel and local agents need to
// SEE the project registry and unsettled experiment outcomes before any
// closed-loop planning makes sense. Three deliberate constraints:
//
//   1. Markdown is the only truth source read here (schema-v1 §7.1). Nothing
//      in this file touches data.json, SQLite indexes or any live plugin
//      object, so every handler runs correctly outside Obsidian — which is
//      what lets the Bridge serve these actions directly (synchronously, no
//      queue round-trip, no Obsidian-open requirement) via
//      GET /v1/scholarium/state.
//   2. Everything is L0 / read_only / requires_confirmation:false. A read
//      must never be able to strand a queue item waiting for a confirmation
//      it does not need.
//   3. Outputs are summaries, not raw dumps: bodies of notes stay in the
//      vault. Excerpts are capped so an agent's context window is spent on
//      decisions, not on re-reading full records it can open by path.
//
// Like every other action, these run inside tools/action-registry.js's
// policy check and manifest wrapper; this module only implements the reads.

const S = require("./schema-objects");

const EXCERPT = 280; // characters, for statement/conclusion excerpts

// schema-v1 experiment lifecycle (schema-v1.md §4.6):
//   idea → designed → ready → running → data_pending → analyzing → concluded → integrated
// "Integrated" is the settled terminal state: conclusion exists AND
// produced_evidence is linked. A concluded-but-not-integrated experiment is
// exactly what the P7 closed-loop scan (design doc §3) needs to pick up: a
// result the researcher has written down that has not yet been turned into
// evidence and settled against its hypotheses.
const SETTLED_STATUS = new Set(["integrated"]);
const RESULT_READY_STATUS = new Set(["concluded"]);
const IN_PROGRESS_STATUS = new Set(["running", "data_pending", "analyzing"]);

function excerpt(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > EXCERPT ? text.slice(0, EXCERPT) + "…" : text;
}

/* ------------------------------------------------------------------ */
/* vault index (per call — these are human-scale scans, not hot paths) */
/* ------------------------------------------------------------------ */
function indexVault(vault) {
  const found = S.readVaultObjects(vault);
  const byUid = new Map();
  const byType = { project: [], question: [], hypothesis: [], paper: [], evidence: [], experiment: [], idea: [], decision: [], lesson: [] };
  for (const { path: p, object } of found) {
    const entry = { path: p, object };
    if (object.uid) byUid.set(object.uid, entry);
    if (byType[object.type]) byType[object.type].push(entry);
  }
  const displayId = (uid) => {
    const hit = byUid.get(uid);
    return hit ? hit.object.display_id || null : null;
  };
  return { byUid, byType, displayId };
}

// Settlement tallies for one hypothesis, counted from the Evidence objects
// that target it. Mirrors the "0 支持 / 0 反驳 / 4 限定 / 19 驳回" view in
// the work-summary doc: only review_status:confirmed counts as a formal
// vote; pending and rejected are reported separately so an agent can see the
// review backlog instead of mistaking it for signal. review_status is
// optional on legacy Evidence — fall back to verified_by_user per
// schema-v1 §4.5's compatibility rule.
function reviewStatusOf(evidence) {
  if (evidence.review_status) return evidence.review_status;
  return evidence.verified_by_user === true ? "confirmed" : "pending";
}

function settlementFor(hypUid, evidenceEntries) {
  const tally = { supports: 0, contradicts: 0, qualifies: 0, pending: 0, rejected: 0 };
  for (const { object: ev } of evidenceEntries) {
    if (ev.target_uid !== hypUid) continue;
    const status = reviewStatusOf(ev);
    if (status === "pending") { tally.pending++; continue; }
    if (status === "rejected") { tally.rejected++; continue; }
    if (status === "demonstration") continue; // explicit non-vote, schema-v1 §4.5
    if (S.SUPPORTING_RELATIONS.has(ev.relation)) tally.supports++;
    else if (S.CONTRADICTING_RELATIONS.has(ev.relation)) tally.contradicts++;
    else if (ev.relation === "QUALIFIES") tally.qualifies++;
  }
  return tally;
}

function experimentSummary(entry, idx) {
  const exp = entry.object;
  const project = exp.project_uid ? idx.byUid.get(exp.project_uid) : null;
  return {
    uid: exp.uid,
    display_id: exp.display_id,
    title: exp.title || "",
    status: exp.status || "",
    project_uid: exp.project_uid || null,
    project_display_id: project ? project.object.display_id || null : null,
    tests_hypotheses: (exp.tests_hypotheses || []).map((uid) => ({ uid, display_id: idx.displayId(uid) })),
    has_conclusion: Boolean(String(exp.conclusion || "").trim()),
    conclusion_excerpt: excerpt(exp.conclusion),
    produced_evidence_count: (exp.produced_evidence || []).length,
    data_origin: exp.data_origin || null,
    updated_at: exp.updated_at || null,
    path: entry.path,
  };
}

function hypothesisSummary(entry, idx) {
  const hyp = entry.object;
  return {
    uid: hyp.uid,
    display_id: hyp.display_id,
    statement: excerpt(hyp.statement),
    status: hyp.status || "",
    // confidence is human-set only (schema-v1 §4.3); surfaced read-only.
    confidence: hyp.confidence === undefined ? null : hyp.confidence,
    formal_supporting: (hyp.supporting_evidence || []).length,
    formal_contradicting: (hyp.contradicting_evidence || []).length,
    settlement: settlementFor(hyp.uid, idx.byType.evidence),
    path: entry.path,
  };
}

// Evidence "belongs to" a project if it targets one of the project's
// hypotheses or questions, or if it was produced by one of the project's
// experiments. Returns uids, deduplicated.
function projectEvidenceUids(projectUid, idx) {
  const memberTargets = new Set();
  for (const { object } of [...idx.byType.hypothesis, ...idx.byType.question])
    if (object.project_uid === projectUid && object.uid) memberTargets.add(object.uid);
  const memberSources = new Set();
  for (const { object } of idx.byType.experiment)
    if (object.project_uid === projectUid && object.uid) memberSources.add(object.uid);
  const uids = new Set();
  for (const { object: ev } of idx.byType.evidence) {
    if (ev.target_uid && memberTargets.has(ev.target_uid)) uids.add(ev.uid);
    else if (ev.source_uid && memberSources.has(ev.source_uid)) uids.add(ev.uid);
  }
  return uids;
}

/* ------------------------------------------------------------------ */
/* handlers                                                            */
/* ------------------------------------------------------------------ */

// project.list — the registry the panel's multi-project sidebar is built on.
// One summary per Project, cheapest possible: no statement excerpts, just
// identity, lifecycle state and counts.
function listProjects(vault) {
  const idx = indexVault(vault);
  const projects = idx.byType.project.map((entry) => {
    const prj = entry.object;
    const hypotheses = idx.byType.hypothesis.filter((h) => h.object.project_uid === prj.uid);
    const experiments = idx.byType.experiment.filter((e) => e.object.project_uid === prj.uid);
    const questions = idx.byType.question.filter((q) => q.object.project_uid === prj.uid);
    const evidenceUids = projectEvidenceUids(prj.uid, idx);
    return {
      uid: prj.uid,
      display_id: prj.display_id,
      title: prj.title || "",
      status: prj.status || "",
      stage: prj.stage || "",
      updated_at: prj.updated_at || null,
      path: entry.path,
      counts: {
        questions: questions.length,
        hypotheses: hypotheses.length,
        experiments: experiments.length,
        evidence: evidenceUids.size,
      },
      open_questions: questions.filter((q) => q.object.status === "open" || q.object.status === "blocked").length,
      // The number that drives the closed loop: results written down but not
      // yet settled into evidence.
      unsettled_experiments: experiments.filter((e) => RESULT_READY_STATUS.has(e.object.status)).length,
    };
  });
  projects.sort((a, b) => String(a.display_id).localeCompare(String(b.display_id)));
  return { projects, total: projects.length };
}

// project.get — one project in full: object + related hypotheses (with
// settlement tallies), experiments (with status) and questions.
// input: { project_uid } or { display_id } — display_id is accepted for
// human/agent convenience but always resolved to the uid before lookup.
function getProject(vault, input = {}) {
  const idx = indexVault(vault);
  let entry = null;
  if (input.project_uid) entry = idx.byUid.get(String(input.project_uid));
  if (!entry && input.display_id)
    entry = idx.byType.project.find((p) => p.object.display_id === String(input.display_id)) || null;
  if (!entry || entry.object.type !== "project")
    throw new Error("project_not_found:" + (input.project_uid || input.display_id || ""));
  const prj = entry.object;
  const hypotheses = idx.byType.hypothesis.filter((h) => h.object.project_uid === prj.uid);
  const experiments = idx.byType.experiment.filter((e) => e.object.project_uid === prj.uid);
  const questions = idx.byType.question.filter((q) => q.object.project_uid === prj.uid);
  const evidenceUids = projectEvidenceUids(prj.uid, idx);
  // 决策持久化（2026-08-26）：捆进 project.get，而不是要求聊天预取逻辑再单
  // 独打一次请求——这条端点已经是"项目状态（Bridge L0 实读）"唯一事实源
  // 注入 prompt 的入口，决策同样属于"这个课题当前的事实"，混进同一批读取
  // 比新开一条并行的 fetch 更不容易漏掉。active 排前、按 decided_at 倒序，
  // 和 decision.list 同一收敛纪律。
  const decisions = idx.byType.decision
    .filter((d) => d.object.project_uid === prj.uid)
    .map((d) => decisionSummary(d, idx));
  const decisionRank = { active: 0, resolved: 1 };
  decisions.sort((a, b) =>
    (decisionRank[a.status] ?? 9) - (decisionRank[b.status] ?? 9) ||
    String(b.decided_at || "").localeCompare(String(a.decided_at || "")));
  // 经验候选（M5 步骤1, 2026-08-26）：同一个道理，混进 project.get 而不是要
  // 求聊天再单独打一次 lesson.list。project_uid 为空的经验（方法论层面、跨
  // 课题成立）也算进这个课题相关——见 listLessons 同一条注释。
  const lessons = idx.byType.lesson
    .filter((l) => !l.object.project_uid || l.object.project_uid === prj.uid)
    .map((l) => lessonSummary(l, idx));
  const lessonRank = { active: 0, retired: 1 };
  lessons.sort((a, b) =>
    (lessonRank[a.status] ?? 9) - (lessonRank[b.status] ?? 9) ||
    String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  return {
    project: prj,
    path: entry.path,
    hypotheses: hypotheses.map((h) => hypothesisSummary(h, idx)),
    experiments: experiments.map((e) => experimentSummary(e, idx)),
    questions: questions.map((q) => ({
      uid: q.object.uid,
      display_id: q.object.display_id,
      statement: excerpt(q.object.statement),
      status: q.object.status || "",
      path: q.path,
    })),
    decisions,
    lessons,
    counts: {
      questions: questions.length,
      hypotheses: hypotheses.length,
      experiments: experiments.length,
      evidence: evidenceUids.size,
      decisions: decisions.length,
      lessons: lessons.length,
    },
  };
}

// experiment.scan_outcomes — the P7 perception entry point. Buckets every
// experiment by where it sits in the lifecycle, with full detail only for
// the bucket an agent must act on: concluded-but-not-integrated results
// waiting to be settled against their hypotheses.
// input: optional { project_uid } to scope the scan to one project.
function scanExperimentOutcomes(vault, input = {}) {
  const idx = indexVault(vault);
  const scope = input.project_uid ? String(input.project_uid) : null;
  if (scope && !idx.byUid.has(scope)) throw new Error("project_not_found:" + scope);
  const experiments = idx.byType.experiment.filter((e) => !scope || e.object.project_uid === scope);
  const awaitingIntegration = [];
  const inProgress = [];
  let planned = 0, settled = 0;
  for (const entry of experiments) {
    const status = entry.object.status || "";
    if (RESULT_READY_STATUS.has(status)) awaitingIntegration.push(experimentSummary(entry, idx));
    else if (IN_PROGRESS_STATUS.has(status)) {
      const exp = entry.object;
      inProgress.push({
        uid: exp.uid, display_id: exp.display_id, title: exp.title || "", status,
        updated_at: exp.updated_at || null, path: entry.path,
      });
    } else if (SETTLED_STATUS.has(status)) settled++;
    else planned++; // idea / designed / ready / undeclared
  }
  const order = (a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
  awaitingIntegration.sort(order);
  inProgress.sort(order);
  return {
    scope_project_uid: scope,
    awaiting_integration: awaitingIntegration,
    in_progress: inProgress,
    counts: {
      awaiting_integration: awaitingIntegration.length,
      in_progress: inProgress.length,
      settled,
      planned,
      total: experiments.length,
    },
  };
}

// idea.list — M2 §5.1: the Idea 卡片列表页's data source. Cheap summaries
// only (bodies stay in the vault, same excerpt discipline as everything
// else here); exploring cards first (they are the ones needing a decision),
// then most-recently-updated within each status bucket.
function ideaSummary(entry) {
  const idea = entry.object;
  return {
    uid: idea.uid,
    display_id: idea.display_id,
    title: idea.title || "",
    status: idea.status || "",
    summary: excerpt(idea.summary),
    hotspots: (idea.hotspots || []).slice(0, 8),
    key_papers: (idea.key_papers || []).slice(0, 8),
    gaps: (idea.gaps || []).slice(0, 8),
    promoted_to: idea.promoted_to || null,
    created_at: idea.created_at || null,
    updated_at: idea.updated_at || null,
    path: entry.path,
  };
}

// decision.list / project.get 的决策摘要（决策持久化, 2026-08-26）。relates_to
// 里的每个 uid 顺带解析出 display_id，方便消费方直接显示"关联 EXP-007"而不
// 需要自己再查一次 project.get/experiment.scan_outcomes。
function decisionSummary(entry, idx) {
  const dec = entry.object;
  return {
    uid: dec.uid,
    display_id: dec.display_id,
    title: dec.title || "",
    decision: excerpt(dec.decision),
    rationale: excerpt(dec.rationale),
    trigger_condition: dec.trigger_condition ? excerpt(dec.trigger_condition) : null,
    status: dec.status || "active",
    relates_to: (dec.relates_to || []).map((uid) => ({ uid, display_id: idx.displayId(uid) })),
    project_uid: dec.project_uid || null,
    decided_at: dec.decided_at || dec.created_at || null,
    updated_at: dec.updated_at || null,
    path: entry.path,
  };
}

// decision.list — L0 read, optionally scoped to one project (same convention
// as experiment.scan_outcomes's project_uid input). Most-recently-decided
// first; resolved decisions sort after active ones so an agent glancing at
// the list sees what's still governing before what's settled history.
function listDecisions(vault, input = {}) {
  const idx = indexVault(vault);
  const scope = input.project_uid ? String(input.project_uid) : null;
  const decisions = idx.byType.decision
    .filter((entry) => !scope || entry.object.project_uid === scope)
    .map((entry) => decisionSummary(entry, idx));
  const rank = { active: 0, resolved: 1 };
  decisions.sort((a, b) =>
    (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
    String(b.decided_at || "").localeCompare(String(a.decided_at || "")));
  return { decisions, total: decisions.length };
}

// lesson.list / project.get 的经验候选摘要（M5 步骤1, 2026-08-26）。evidence_refs
// 里的每个 uid 顺带解析出 display_id，和 decisionSummary 对 relates_to 的处理
// 同一约定——消费方不用再自己查一次就能看出"这条经验挂在哪条 EXP/DEC 上"。
function lessonSummary(entry, idx) {
  const les = entry.object;
  return {
    uid: les.uid,
    display_id: les.display_id,
    title: les.title || "",
    statement: excerpt(les.statement),
    scope: excerpt(les.scope),
    evidence_summary: excerpt(les.evidence_summary),
    evidence_refs: (les.evidence_refs || []).map((uid) => ({ uid, display_id: idx.displayId(uid) })),
    source_types: les.source_types || [],
    status: les.status || "active",
    project_uid: les.project_uid || null,
    created_at: les.created_at || null,
    updated_at: les.updated_at || null,
    path: entry.path,
  };
}

// lesson.list — L0 读，可选 { project_uid } 限定。一条经验候选只要
// project_uid 为空（方法论层面、跨课题成立）或匹配所请求的课题，就算相关——
// 和 decision.list 的"只看这个课题"不同，因为经验的适用范围本来就可能超出
// 单一课题（scope 字段里写明的边界），不该被 project_uid 过滤器直接挡掉。
// active 排前、按 updated_at 倒序，与 decision.list 同一收敛纪律。
function listLessons(vault, input = {}) {
  const idx = indexVault(vault);
  const scope = input.project_uid ? String(input.project_uid) : null;
  const lessons = idx.byType.lesson
    .filter((entry) => !scope || !entry.object.project_uid || entry.object.project_uid === scope)
    .map((entry) => lessonSummary(entry, idx));
  const rank = { active: 0, retired: 1 };
  lessons.sort((a, b) =>
    (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
    String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  return { lessons, total: lessons.length };
}

function listIdeas(vault) {
  const idx = indexVault(vault);
  const ideas = idx.byType.idea.map(ideaSummary);
  const rank = { exploring: 0, promoted: 1, shelved: 2 };
  ideas.sort((a, b) =>
    (rank[a.status] ?? 9) - (rank[b.status] ?? 9) ||
    String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
  return { ideas, total: ideas.length };
}

// Small allocation view used by M3 draft builders. Display ids are not
// relationship keys, but filenames share global type folders; allocating
// against only the current Project can otherwise collide with another
// Project's HYP-001/EXP-001 note.
function listDisplayIds(vault, input = {}) {
  const idx = indexVault(vault);
  const requested = Array.isArray(input.types) && input.types.length
    ? input.types.map(String) : ['project', 'question', 'hypothesis', 'experiment', 'idea', 'decision', 'lesson'];
  const ids = {};
  for (const type of requested) {
    if (!idx.byType[type]) throw new Error('unsupported_object_type:' + type);
    ids[type] = idx.byType[type].map((entry) => entry.object.display_id).filter(Boolean).sort();
  }
  return { ids };
}

module.exports = {
  listProjects, getProject, scanExperimentOutcomes, listIdeas, listDecisions, listLessons, listDisplayIds,
  // exported for tests and for future actions that need the same buckets
  indexVault, settlementFor,
  SETTLED_STATUS, RESULT_READY_STATUS, IN_PROGRESS_STATUS,
};
