"use strict";
/**
 * Hypotheses on disk, and the evidence that bears on them.
 *
 * The view this builds has three columns because §4.5 draws a line the UI has
 * to respect: evidence the user has not confirmed "不得进入正式 Research State,
 * 只能作为候选展示". So `supporting_evidence` and `contradicting_evidence` on the
 * Hypothesis are formal relations and stay empty until a person confirms, while
 * unconfirmed evidence is found through its own `target_uid` and shown in a
 * pending column. Rejected evidence has its own terminal review state: it is
 * neither pending nor a formal relation, but remains readable as a durable
 * record of a human scientific judgement.
 *
 * That split is also what stops evidence becoming orphaned. An Evidence object
 * always names its target, from the moment it is created; confirmation only
 * decides whether the Hypothesis names it back.
 *
 *   node tools/hypothesis-store.js --vault <path>       # report every hypothesis
 */
const fs = require("fs");
const path = require("path");
const S = require("./schema-objects");
const Experiments = require("./experiment-store");

/* Where each object type lives. Experiment was missing: `loadAll` could read
   the experiments the plugin had written, but `saveObject` refused to create
   one, so the tools could observe the Experiment → Evidence chain without being
   able to extend it. */
const DIRS = {
  project: "Research/Projects",
  paper: "Research/Papers",
  hypothesis: "Research/Hypotheses",
  experiment: "Research/Experiments",
  evidence: "Research/Evidence",
};

/* The human-readable half of a filename. Each type keeps its own headline
   field; falling back to `claim` for everything that was not a hypothesis
   produced "EXP-002 undefined.md". */
const LABEL = {
  project: (o) => o.title,
  paper: (o) => o.title,
  hypothesis: (o) => o.statement,
  experiment: (o) => o.title,
  evidence: (o) => o.claim,
};
const SUPPORTING = S.SUPPORTING_RELATIONS;
const CONTRADICTING = S.CONTRADICTING_RELATIONS;

const slug = (s) => String(s).replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);

function objectPath(vault, object) {
  const dir = DIRS[object.type];
  if (!dir) throw new Error("没有为该类型定义存放位置：" + object.type);
  const label = (LABEL[object.type] || ((o) => o.claim))(object) || "检索候选";
  return path.join(vault, ...dir.split("/"), object.display_id + " " + slug(label) + ".md");
}

/** Write an object, refusing to persist one that does not satisfy §4. */
function saveObject(vault, object, body = "") {
  const errors = S.validateObject(object);
  if (errors.length) throw new Error("拒绝写入不合法对象：" + errors.join("；"));
  const file = objectPath(vault, object);
  return writeObjectAt(vault, file, object, body);
}

/** Write an existing object back to its current file, even if its title changed. */
function saveExistingObject(vault, relativePath, object, body = "") {
  const errors = S.validateObject(object);
  if (errors.length) throw new Error("拒绝写入不合法对象：" + errors.join("；"));
  const root = path.resolve(vault);
  const file = path.resolve(root, ...String(relativePath).split("/"));
  if (file !== root && !file.startsWith(root + path.sep))
    throw new Error("拒绝写入 Vault 外的对象路径：" + relativePath);
  return writeObjectAt(vault, file, object, body);
}

function writeObjectAt(vault, file, object, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, S.serializeObject(object, body), "utf8");
  fs.renameSync(tmp, file);
  return path.relative(vault, file).split(path.sep).join("/");
}

function loadAll(vault, type) {
  return S.readVaultObjects(vault)
    .filter((entry) => entry.object.type === type)
    .map((entry) => ({ path: entry.path, object: entry.object }));
}

function nextDisplayId(vault, type) {
  return S.nextDisplayId(loadAll(vault, type).map((e) => e.object.display_id), type);
}

/**
 * One source block may bear on one target only once.  The review state and the
 * whole-record hash are deliberately not part of this key: editing unrelated
 * experiment prose must not create a second queue item for the same result.
 */
function findEvidenceByLocator(vault, { sourceUid, anchor, targetUid }) {
  return loadAll(vault, "evidence").find((entry) => {
    const locator = entry.object.locator || {};
    return entry.object.source_uid === sourceUid
      && locator.anchor === anchor
      && entry.object.target_uid === targetUid;
  }) || null;
}

/**
 * Everything bearing on one hypothesis, split by what the user has confirmed.
 *
 * `problems` is not decoration. A hypothesis whose formal arrays disagree with
 * the evidence objects themselves is the failure mode this whole split exists
 * to prevent, so it is reported rather than smoothed over.
 */
function hypothesisView(vault, uid) {
  const hypotheses = loadAll(vault, "hypothesis");
  const entry = hypotheses.find((e) => e.object.uid === uid);
  if (!entry) throw new Error("找不到假设：" + uid);
  const h = entry.object;

  const evidence = loadAll(vault, "evidence");
  const byUid = new Map(evidence.map((e) => [e.object.uid, e]));
  const targeting = evidence.filter((e) => e.object.target_uid === uid);

  const view = { hypothesis: h, path: entry.path, supporting: [], contradicting: [], qualifying: [], pending: [], rejected: [], demonstration: [], problems: [] };
  const add = (m) => view.problems.push(m);

  for (const e of targeting) {
    const o = e.object;
    if (o.review_status === "rejected") { view.rejected.push(e); continue; }
    if (o.review_status === "demonstration") { view.demonstration.push(e); continue; }
    if (!o.verified_by_user) { view.pending.push(e); continue; }
    if (SUPPORTING.has(o.relation)) view.supporting.push(e);
    else if (CONTRADICTING.has(o.relation)) view.contradicting.push(e);
    else view.qualifying.push(e);
  }

  // §4.5: only confirmed evidence may appear in the formal arrays.
  for (const [key, expected] of [["supporting_evidence", SUPPORTING], ["contradicting_evidence", CONTRADICTING]]) {
    for (const ref of h[key] || []) {
      const e = byUid.get(ref);
      if (!e) { add(key + " 指向不存在的证据：" + ref); continue; }
      if (!e.object.verified_by_user) add(key + " 收录了未确认证据，违反 §4.5：" + ref);
      if (e.object.review_status === "rejected") add(key + " 收录了已驳回证据，违反 §4.5：" + ref);
      if (e.object.review_status === "demonstration") add(key + " 收录了流程演示证据，违反 §4.5：" + ref);
      if (e.object.target_uid !== uid) add(key + " 收录的证据并不指向本假设：" + ref);
      if (e.object.relation && !expected.has(e.object.relation))
        add(key + " 与证据自身的 relation 不一致：" + ref + " 是 " + e.object.relation);
    }
  }
  // Confirmed evidence that never made it into the formal arrays.
  for (const e of [...view.supporting, ...view.contradicting]) {
    const key = SUPPORTING.has(e.object.relation) ? "supporting_evidence" : "contradicting_evidence";
    if (!(h[key] || []).includes(e.object.uid))
      add("已确认证据未登记进 " + key + "：" + e.object.uid);
  }
  return view;
}

/**
 * Confirm a piece of evidence and file it, in one step.
 *
 * Confirming and linking are the same decision. Leaving them as two calls means
 * a caller can confirm without filing — producing evidence a person has
 * accepted that the hypothesis still does not know about — or file without
 * confirming, which is precisely what §4.5 forbids.
 */
function confirmEvidence(vault, evidenceUid, options = {}) {
  const now = options.now || new Date().toISOString();
  const evidence = loadAll(vault, "evidence").find((e) => e.object.uid === evidenceUid);
  if (!evidence) throw new Error("找不到证据：" + evidenceUid);
  const o = evidence.object;
  if (o.review_status === "rejected")
    throw new Error("证据已被人工驳回；请先显式重新打开该证据，再重新审核：" + evidenceUid);
  if (o.candidate_only === true)
    throw new Error("candidate_only 检索候选尚未形成科研主张；请先由 AI 初审或研究者写入 claim 后再确认：" + evidenceUid);
  if (!o.target_uid) throw new Error("证据没有 target_uid，无法确认为孤立记录：" + evidenceUid);
  if (!o.relation) throw new Error("证据缺少 relation，无法判断支持还是反驳：" + evidenceUid);
  if (o.source_type === "experiment") {
    const source = Experiments.verifyEvidenceSource(vault, o);
    if (!source.ok) throw new Error("实验来源已变化，不能确认旧证据：" + source.reason);
  }

  const hypotheses = loadAll(vault, "hypothesis");
  const target = hypotheses.find((e) => e.object.uid === o.target_uid);
  if (!target) throw new Error("证据指向的假设不存在：" + o.target_uid);

  const confirmed = { ...o, verified_by_user: true, review_status: "confirmed", verified_at: now, updated_at: now };
  const linked = S.linkEvidence(target.object, evidenceUid, o.relation);
  linked.updated_at = now;

  saveExistingObject(vault, evidence.path, confirmed, S.parseObject(fs.readFileSync(path.join(vault, ...evidence.path.split("/")), "utf8")).body);
  saveExistingObject(vault, target.path, linked, S.parseObject(fs.readFileSync(path.join(vault, ...target.path.split("/")), "utf8")).body);
  // The Experiment sees a produced Evidence only after a researcher confirms
  // it.  Adding it when a candidate is created would let an unreviewed claim
  // masquerade as a result-derived scientific connection.
  const experiment = confirmed.source_type === "experiment"
    ? Experiments.addProducedEvidence(vault, confirmed.source_uid, confirmed.uid, { now })
    : null;
  return { evidence: confirmed, hypothesis: linked, experiment };
}

/**
 * Record a human rejection without erasing a correctly located quotation.
 * Rejection is a terminal review decision, not an absence of review: it lets
 * future candidate generators learn not to propose the same irrelevant link.
 */
function rejectEvidence(vault, evidenceUid, reason, options = {}) {
  const text = String(reason || "").trim();
  if (!text) throw new Error("驳回证据必须填写原因");
  const now = options.now || new Date().toISOString();
  const evidence = loadAll(vault, "evidence").find((e) => e.object.uid === evidenceUid);
  if (!evidence) throw new Error("找不到证据：" + evidenceUid);
  const o = evidence.object;
  if (o.verified_by_user || o.review_status === "confirmed")
    throw new Error("已确认的证据不能直接驳回；请先处理正式支持/反驳关系：" + evidenceUid);
  const rejected = {
    ...o,
    verified_by_user: false,
    review_status: "rejected",
    rejection_reason: text,
    rejected_at: now,
    rejected_by: options.by || "user",
    updated_at: now,
  };
  const body = S.parseObject(fs.readFileSync(path.join(vault, ...evidence.path.split("/")), "utf8")).body;
  saveExistingObject(vault, evidence.path, rejected, body);
  return rejected;
}

/**
 * Retain a human-reviewed workflow demonstration without allowing simulated
 * output to remain a formal Hypothesis relation. This is deliberately a human
 * action: an Agent may identify provenance but cannot demote research records.
 */
function demonstrateEvidence(vault, evidenceUid, reason, options = {}) {
  const text = String(reason || "").trim();
  if (!text) throw new Error("标记流程演示必须填写原因");
  const now = options.now || new Date().toISOString();
  const evidence = loadAll(vault, "evidence").find((e) => e.object.uid === evidenceUid);
  if (!evidence) throw new Error("找不到证据：" + evidenceUid);
  const o = evidence.object;
  if (o.review_status === "rejected") throw new Error("已驳回的证据不能改为流程演示：" + evidenceUid);
  const experiment = o.source_type === "experiment"
    ? Experiments.loadAll(vault).find((e) => e.object.uid === o.source_uid)
    : null;
  if (!experiment || experiment.object.data_origin !== "simulated")
    throw new Error("只有来源明确为 simulated 的 Experiment Evidence 才能标为流程演示");
  const hypotheses = loadAll(vault, "hypothesis");
  const target = hypotheses.find((e) => e.object.uid === o.target_uid);
  if (!target) throw new Error("证据指向的假设不存在：" + o.target_uid);
  const demonstrated = {
    ...o,
    verified_by_user: false,
    review_status: "demonstration",
    demonstration_reason: text,
    demonstrated_at: now,
    demonstrated_by: options.by || "user",
    updated_at: now,
  };
  delete demonstrated.verified_at;
  const unlinked = S.unlinkEvidence(target.object, evidenceUid);
  unlinked.updated_at = now;
  const body = S.parseObject(fs.readFileSync(path.join(vault, ...evidence.path.split("/")), "utf8")).body;
  saveExistingObject(vault, evidence.path, demonstrated, body);
  saveExistingObject(vault, target.path, unlinked, S.parseObject(fs.readFileSync(path.join(vault, ...target.path.split("/")), "utf8")).body);
  const source = Experiments.removeProducedEvidence(vault, o.source_uid, evidenceUid, { now });
  return { evidence: demonstrated, hypothesis: unlinked, experiment: source };
}

/** Evidence that names no target, or names one that is not there. */
function orphanEvidence(vault) {
  const objects = S.readVaultObjects(vault);
  const uids = new Set(objects.map((e) => e.object.uid));
  return objects
    .filter((e) => e.object.type === "evidence")
    .filter((e) => !e.object.target_uid || !uids.has(e.object.target_uid))
    .map((e) => ({ path: e.path, uid: e.object.uid, target_uid: e.object.target_uid || "" }));
}

function report(vault) {
  const hypotheses = loadAll(vault, "hypothesis");
  const out = hypotheses.map((e) => {
    const v = hypothesisView(vault, e.object.uid);
    return {
      display_id: e.object.display_id, status: e.object.status,
      confidence: e.object.confidence === undefined ? null : e.object.confidence,
      supporting: v.supporting.length, contradicting: v.contradicting.length,
      qualifying: v.qualifying.length, pending: v.pending.length, rejected: v.rejected.length, demonstration: v.demonstration.length, problems: v.problems,
    };
  });
  return { hypotheses: out, orphans: orphanEvidence(vault) };
}

function main() {
  const i = process.argv.indexOf("--vault");
  const vault = path.resolve(i > 0 ? process.argv[i + 1] : path.join(__dirname, "..", "..", "..", ".."));
  process.stdout.write(JSON.stringify(report(vault), null, 2) + "\n");
}
if (require.main === module) main();

module.exports = {
  DIRS, objectPath, saveObject, saveExistingObject, loadAll, nextDisplayId, findEvidenceByLocator,
  hypothesisView, confirmEvidence, rejectEvidence, demonstrateEvidence, orphanEvidence, report,
};
