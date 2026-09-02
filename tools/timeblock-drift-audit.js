"use strict";
// Drift audit for workspace.timeblocks ↔ schema-v1 Experiment records
// (时间块 ↔ 实验正式关联的收尾环节, 2026-08-26).
//
// A timeblock's `experimentUid` (see workspace-actions.js) is written once,
// at scheduling time. The Experiment record it points to keeps moving
// afterwards — status advances, blocked_by clears, review_status flips to
// confirmed, or the record disappears entirely. Nothing before this module
// ever went back and checked whether a schedule entry still describes
// reality; that is what this file does. It is L0 / read-only: it never
// writes to data.json or to the vault, it only reports.
//
// Drift categories (a timeblock can carry more than one at once):
//   orphaned     — experimentUid does not resolve to any Experiment in the
//                  vault (the record was deleted, or the uid was hand-typed
//                  before validation existed).
//   blocked      — the Experiment still lists unresolved `blocked_by` items.
//                  Scheduling execution time against a blocked design is
//                  exactly the "日程写的是 EXP-007，但实验状态已变更/阻塞"
//                  scenario this module exists to catch.
//   unreviewed   — review_status is present and is not "confirmed": the
//                  Experiment is still an AI-drafted plan nobody has signed
//                  off on, so treating its schedule slot as settled is
//                  premature.
//   unbackfilled — the timeblock's date has passed and nobody has recorded
//                  what actually happened (workspace.timeblock_update's
//                  execution_status is unset). This is the first, most basic
//                  missing step in the closed loop: the schedule made a
//                  claim about the future and nothing has confirmed or
//                  denied it since.
//   stale        — the date has passed AND execution *was* backfilled, but
//                  the Experiment record's own status never advanced past
//                  "designed" — the backfill happened at the calendar level
//                  and was never propagated into the formal record. This is
//                  a strictly later-stage gap than `unbackfilled`: it means
//                  someone already answered "what happened", but the answer
//                  never made it into Research/Experiments/.
//
// unbackfilled and stale are mutually exclusive by construction (stale can
// only fire once executionStatus is set). `flags` lists every category that
// applies; `clean: true` means none did.

const S = require("./schema-objects");
const WA = require("./workspace-actions");
const { ORDER } = require("./experiment-workflow");

// "idea" and "designed" both count as "not yet started" for staleness
// purposes — anything from "ready" onward means the record shows real
// progress, even if that progress has since stalled elsewhere.
const STALL_STATUS_INDEX = ORDER.indexOf("designed");

function todayISO(now) {
  const d = now ? new Date(now) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function auditTimeblocks(vault, options = {}) {
  const workspace = WA.readWorkspaceFromDisk(vault);
  if (!workspace) throw new Error("workspace_state_unreadable: data.json not found or invalid");
  const timeblocks = Array.isArray(workspace.timeblocks) ? workspace.timeblocks : [];
  const experiments = S.readVaultObjects(vault).filter((entry) => entry.object.type === "experiment");
  const byUid = new Map(experiments.map((entry) => [entry.object.uid, entry.object]));
  const today = options.today || todayISO(options.now);
  // Optional project scope (same convention as experiment.scan_outcomes's
  // `project_uid` input): timeblocks are not project-scoped in data.json, so
  // scoping only makes sense once a timeblock's experimentUid resolves to an
  // Experiment that belongs to the requested project. An orphaned reference
  // has no project to check against, so it is only surfaced in an unscoped
  // (whole-vault) audit — a scoped view answers "what's wrong with *this*
  // project's schedule", not "what's wrong everywhere".
  const scope = options.project_uid ? String(options.project_uid) : null;

  const linked = timeblocks.filter((tb) => tb && tb.experimentUid);
  const findings = linked.map((tb) => {
    const exp = byUid.get(tb.experimentUid);
    if (!exp) {
      return {
        id: tb.id, date: tb.date, title: tb.title, experimentUid: tb.experimentUid,
        experiment_display_id: null, experiment_status: null, experiment_project_uid: null,
        blocked_by: [], review_status: null,
        flags: ["orphaned"], clean: false,
      };
    }
    const flags = [];
    if (Array.isArray(exp.blocked_by) && exp.blocked_by.length) flags.push("blocked");
    if (exp.review_status && exp.review_status !== "confirmed") flags.push("unreviewed");
    const pastDue = Boolean(tb.date && tb.date < today);
    if (pastDue && !tb.executionStatus) {
      flags.push("unbackfilled");
    } else if (pastDue) {
      const statusIndex = ORDER.indexOf(exp.status);
      if (statusIndex >= 0 && statusIndex <= STALL_STATUS_INDEX) flags.push("stale");
    }
    return {
      id: tb.id, date: tb.date, title: tb.title, experimentUid: tb.experimentUid,
      experiment_display_id: exp.display_id || null, experiment_status: exp.status || null,
      experiment_project_uid: exp.project_uid || null,
      blocked_by: Array.isArray(exp.blocked_by) ? exp.blocked_by : [],
      review_status: exp.review_status || null,
      execution_status: tb.executionStatus || null,
      execution_note: tb.executionNote || null,
      flags, clean: flags.length === 0,
    };
  }).filter((f) => !scope || f.experiment_project_uid === scope);

  return {
    checked_at: options.now ? new Date(options.now).toISOString() : new Date().toISOString(),
    scope_project_uid: scope,
    total_timeblocks: timeblocks.length,
    linked_timeblocks: findings.length,
    unlinked_timeblocks: scope ? null : timeblocks.length - linked.length,
    drift_count: findings.filter((f) => !f.clean).length,
    findings,
  };
}

module.exports = { auditTimeblocks, STALL_STATUS_INDEX };
