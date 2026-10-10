"use strict";

/**
 * Withdraw an Experiment and every formal Evidence relation derived from it.
 *
 * Provenance is a graph property: changing only data_origin leaves confirmed
 * Evidence and Hypothesis support behind, while unlinking only the Evidence
 * hides why a once-integrated experiment disappeared. This module plans and
 * applies the whole withdrawal as one confirmation-gated transaction.
 *
 * It is intentionally not part of experiment.transition. The normal lifecycle
 * is forward-only; invalidation is an exceptional audit event that may start
 * from any lifecycle state and must keep a recovery snapshot.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const S = require("./schema-objects");

const ALLOWED_ORIGINS = new Set(["simulated", "demonstration", "unverifiable"]);
const sha256 = (value) => crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
const safeStamp = (value) => String(value).replace(/[:.]/g, "-");

function absolute(vault, relativePath) {
  const root = path.resolve(vault);
  const target = path.resolve(root, ...String(relativePath).split("/"));
  if (!target.startsWith(root + path.sep)) throw new Error("provenance_invalidation_path_outside_vault");
  return target;
}

function readEntry(vault, entry) {
  const file = absolute(vault, entry.path);
  const content = fs.readFileSync(file, "utf8");
  const parsed = S.parseObject(content);
  return { ...entry, file, content, body: parsed.body };
}

function evidenceWithdrawal(object, origin, reason, at) {
  const next = {
    ...object,
    verified_by_user: false,
    updated_at: at,
    provenance_history: [...(object.provenance_history || []), {
      at,
      action: "source_experiment_invalidated",
      from_review_status: object.review_status,
      data_origin: origin,
      reason,
      by: "user",
    }],
  };
  delete next.verified_at;
  if (origin === "unverifiable") {
    next.review_status = "rejected";
    next.rejection_reason = "来源实验因 provenance 无法核实而失效：" + reason;
    next.rejected_at = at;
    next.rejected_by = "user";
    delete next.demonstration_reason;
    delete next.demonstrated_at;
    delete next.demonstrated_by;
  } else if (object.review_status !== "rejected") {
    next.review_status = "demonstration";
    next.demonstration_reason = "来源实验已确认属于 " + origin + "，退出正式证据链：" + reason;
    next.demonstrated_at = at;
    next.demonstrated_by = "user";
    delete next.rejection_reason;
    delete next.rejected_at;
    delete next.rejected_by;
  }
  // A provenance withdrawal must never make a previously rejected Evidence
  // look less severe. In particular, simulated sources are retained as
  // demonstrations only when the Evidence was formerly usable; an unrelated,
  // duplicate, or otherwise rejected item stays rejected with its original
  // rejection reason and actor intact. provenance_history above records the
  // additional source-level finding without rewriting that earlier decision.
  return next;
}

function buildPlan(vault, input = {}, options = {}) {
  const root = path.resolve(vault);
  const experimentUid = String(input.experiment_uid || "").trim();
  const origin = String(input.data_origin || "").trim();
  const reason = String(input.reason || "").trim();
  const note = String(input.data_provenance_note || "").trim();
  const at = options.now || new Date().toISOString();
  if (!experimentUid) throw new Error("experiment_uid_required");
  if (!ALLOWED_ORIGINS.has(origin))
    throw new Error("invalidation_data_origin_must_be_simulated_demonstration_or_unverifiable");
  if (!reason) throw new Error("invalidation_reason_required");
  if (!note) throw new Error("data_provenance_note_required");

  const objects = S.readVaultObjects(root);
  const experimentEntry = objects.find((entry) => entry.object.type === "experiment" && entry.object.uid === experimentUid);
  if (!experimentEntry) throw new Error("experiment_not_found:" + experimentUid);
  if (experimentEntry.object.status === "invalidated") throw new Error("experiment_already_invalidated:" + experimentUid);

  const evidenceEntries = objects.filter((entry) => entry.object.type === "evidence"
    && entry.object.source_type === "experiment" && entry.object.source_uid === experimentUid);
  const evidenceUids = new Set(evidenceEntries.map((entry) => entry.object.uid));
  const hypothesisEntries = objects.filter((entry) => entry.object.type === "hypothesis"
    && [...(entry.object.supporting_evidence || []), ...(entry.object.contradicting_evidence || [])]
      .some((uid) => evidenceUids.has(uid)));

  const loadedExperiment = readEntry(root, experimentEntry);
  const loadedEvidence = evidenceEntries.map((entry) => readEntry(root, entry));
  const loadedHypotheses = hypothesisEntries.map((entry) => readEntry(root, entry));
  const experiment = {
    ...loadedExperiment.object,
    status: "invalidated",
    data_origin: origin,
    data_recorded_by: "user",
    data_recorded_at: at,
    data_provenance_note: note,
    produced_evidence: [],
    invalidation_reason: reason,
    invalidated_at: at,
    invalidated_by: "user",
    updated_at: at,
    status_history: [...(loadedExperiment.object.status_history || []), {
      at, from: loadedExperiment.object.status, to: "invalidated", reason, by: "user",
    }],
  };

  const evidence = loadedEvidence.map((entry) => ({
    entry,
    object: evidenceWithdrawal(entry.object, origin, reason, at),
  }));
  const hypotheses = loadedHypotheses.map((entry) => {
    const withdrawn = [...(entry.object.supporting_evidence || []), ...(entry.object.contradicting_evidence || [])]
      .filter((uid) => evidenceUids.has(uid));
    let object = entry.object;
    for (const uid of withdrawn) object = S.unlinkEvidence(object, uid);
    object = {
      ...object,
      updated_at: at,
      evidence_history: [...(object.evidence_history || []), ...withdrawn.map((uid) => ({
        at, action: "provenance_invalidation_unlink", evidence_uid: uid,
        experiment_uid: experimentUid, reason, by: "user",
      }))],
    };
    return { entry, object, withdrawn };
  });

  const changes = [
    { entry: loadedExperiment, object: experiment },
    ...evidence.map(({ entry, object }) => ({ entry, object })),
    ...hypotheses.map(({ entry, object }) => ({ entry, object })),
  ].map(({ entry, object }) => {
    const errors = S.validateObject(object);
    if (errors.length) throw new Error("provenance_invalidation_would_create_invalid_object:"
      + entry.path + ":" + errors.join(";"));
    return {
      path: entry.path,
      file: entry.file,
      before: entry.content,
      before_sha256: sha256(entry.content),
      after: S.serializeObject(object, entry.body),
      after_sha256: sha256(S.serializeObject(object, entry.body)),
      object,
    };
  });

  return {
    kind: "scholarium-provenance-invalidation",
    schema_version: 1,
    at,
    vault: root,
    experiment_uid: experimentUid,
    display_id: experimentEntry.object.display_id,
    from_status: experimentEntry.object.status,
    to_status: "invalidated",
    data_origin: origin,
    reason,
    data_provenance_note: note,
    evidence_uids: [...evidenceUids],
    hypothesis_uids: hypotheses.map((item) => item.object.uid),
    changes,
  };
}

function publicPlan(plan) {
  return {
    kind: plan.kind,
    schema_version: plan.schema_version,
    at: plan.at,
    experiment_uid: plan.experiment_uid,
    display_id: plan.display_id,
    from_status: plan.from_status,
    to_status: plan.to_status,
    data_origin: plan.data_origin,
    reason: plan.reason,
    evidence_uids: plan.evidence_uids,
    hypothesis_uids: plan.hypothesis_uids,
    changes: plan.changes.map(({ path: relativePath, before_sha256, after_sha256 }) => ({
      path: relativePath, before_sha256, after_sha256,
    })),
  };
}

function execute(plan, options = {}) {
  if (options.by !== "user") throw new Error("provenance_invalidation_requires_user_confirmation");
  for (const change of plan.changes) {
    const current = fs.readFileSync(change.file, "utf8");
    if (sha256(current) !== change.before_sha256)
      throw new Error("provenance_invalidation_source_changed:" + change.path);
  }

  const recoveryDir = path.join(plan.vault, "Research", "_runs", "recovery");
  fs.mkdirSync(recoveryDir, { recursive: true });
  const recoveryPath = path.join(recoveryDir,
    safeStamp(plan.at) + " experiment-provenance-invalidation.json");
  if (fs.existsSync(recoveryPath)) throw new Error("provenance_invalidation_recovery_exists");
  const recovery = {
    ...publicPlan(plan),
    kind: "scholarium-provenance-invalidation-recovery",
    originals: plan.changes.map((change) => ({
      path: change.path, sha256: change.before_sha256, content: change.before,
    })),
  };
  fs.writeFileSync(recoveryPath, JSON.stringify(recovery, null, 2) + "\n", "utf8");

  const temps = [];
  try {
    for (const change of plan.changes) {
      const temp = change.file + ".provenance-invalidation.tmp";
      if (fs.existsSync(temp)) throw new Error("provenance_invalidation_temp_exists:" + change.path);
      fs.writeFileSync(temp, change.after, "utf8");
      temps.push(temp);
    }
    for (let index = 0; index < plan.changes.length; index++)
      fs.renameSync(temps[index], plan.changes[index].file);
  } catch (error) {
    for (const change of plan.changes) fs.writeFileSync(change.file, change.before, "utf8");
    for (const temp of temps) if (fs.existsSync(temp)) fs.unlinkSync(temp);
    throw error;
  }

  return { ...publicPlan(plan), recovery_path: path.relative(plan.vault, recoveryPath).split(path.sep).join("/") };
}

function invalidate(vault, input = {}, options = {}) {
  const plan = buildPlan(vault, input, options);
  if (options.dryRun !== false) return { mode: "dry_run", ...publicPlan(plan) };
  return { mode: "committed", ...execute(plan, options) };
}

module.exports = { ALLOWED_ORIGINS, buildPlan, publicPlan, execute, invalidate };
