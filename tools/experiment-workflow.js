"use strict";
// Explicit lifecycle for schema-v1 Experiment records.  This is intentionally
// separate from the legacy experiment board: it only operates on Research/
// Experiment objects and records every state change in Markdown frontmatter.
const X = require("./experiment-store");

const ORDER = ["idea", "designed", "ready", "running", "data_pending", "analyzing", "concluded", "integrated"];
// A lifecycle is useful only when its steps mean something. Allowing a jump
// from designed straight to concluded makes every intermediate status cosmetic
// and prevents a later audit from knowing whether the apparatus was ever ready
// or data were ever analysed. One explicit transition at a time is cheap here.
const NEXT = Object.fromEntries(ORDER.map((s, i) => [s, ORDER[i + 1] ? [ORDER[i + 1]] : []]));

function substantive(value) {
  return String(value || "").replace(/[|>+\-\s]/g, "").length > 0;
}
function transitionPlan(entry, target, reason) {
  if (!entry || entry.object.type !== "experiment") throw new Error("experiment_required");
  const from = entry.object.status;
  if (!ORDER.includes(target)) throw new Error("unknown_experiment_status:" + target);
  if (from === target) return { noop: true, from, to: target, reason: String(reason || "") };
  if (!(NEXT[from] || []).includes(target)) throw new Error("invalid_experiment_transition:" + from + "→" + target);
  if (!String(reason || "").trim()) throw new Error("transition_reason_required");
  if (target === "concluded" && !substantive(entry.object.conclusion))
    throw new Error("conclusion_required_before_concluded");
  // Keep the dry-run honest: a planned record has no observation to conclude
  // from, while a simulated record may exercise the workflow but must never
  // be represented as an integrated measured conclusion.
  if (["concluded", "integrated"].includes(target) && entry.object.data_origin === "planned")
    throw new Error("data_required_before_concluded");
  if (target === "integrated" && entry.object.data_origin === "simulated")
    throw new Error("simulated_data_cannot_be_integrated");
  if (target === "integrated" && !(entry.object.produced_evidence || []).length)
    throw new Error("produced_evidence_required_before_integrated");
  return { noop: false, from, to: target, reason: String(reason).trim() };
}
function transition(vault, experimentUid, target, reason, options = {}) {
  const entry = X.loadAll(vault).find((item) => item.object.uid === experimentUid);
  if (!entry) throw new Error("experiment_not_found:" + experimentUid);
  const record = X.readRecord(vault, entry);
  const hydratedEntry = { ...entry, object: record.object };
  const plan = transitionPlan(hydratedEntry, target, reason);
  if (plan.noop || options.dryRun) return { ...plan, path: entry.path, object: hydratedEntry.object };
  const at = options.now || new Date().toISOString();
  const object = {
    ...hydratedEntry.object, status: target, updated_at: at,
    status_history: [...(hydratedEntry.object.status_history || []), { at, from: plan.from, to: target, reason: plan.reason, by: options.by || "user" }],
  };
  X.saveExisting(vault, entry.path, object);
  return { ...plan, path: entry.path, object };
}
// experiment.append_note：往实验记录的 frontmatter 追加一条带时间戳的日志
// （agent 写入的进展/观察/调整说明）。复用 status_history 的存储模式——
// 一个由单行 JSON 对象组成的列表字段，parseObject/serializeObject 已能无损
// 往返。刻意不改 status、不碰 status_history：追加日志不是状态迁移，不需要
// 走 transitionPlan 的生命周期门槛，也不该伪造状态变化。by 字段如实记录
// 写入者（默认 "agent"），与 status_history 里的 by 同一约定。
function appendNote(vault, experimentUid, text, options = {}) {
  const note = String(text || "").trim();
  if (!note) throw new Error("note_text_required");
  const entry = X.loadAll(vault).find((item) => item.object.uid === experimentUid);
  if (!entry) throw new Error("experiment_not_found:" + experimentUid);
  if (entry.object.type !== "experiment") throw new Error("experiment_required");
  const record = X.readRecord(vault, entry);
  const at = options.now || new Date().toISOString();
  const logEntry = { at, text: note, by: options.by || "agent" };
  if (options.dryRun) return { mode: "dry_run", path: entry.path, display_id: record.object.display_id, would_append: logEntry, existing_log_entries: (record.object.log || []).length };
  const object = {
    ...record.object, updated_at: at,
    log: [...(record.object.log || []), logEntry],
  };
  X.saveExisting(vault, entry.path, object);
  return { path: entry.path, display_id: object.display_id, appended: logEntry, log_entries: object.log.length };
}
module.exports = { ORDER, NEXT, substantive, transitionPlan, transition, appendNote };
