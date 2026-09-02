"use strict";
// Narrow L0-L3 Action Registry. The registry makes side effects explicit,
// auditable and dry-runnable; it deliberately has no evidence-confirm action.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const W = require("./experiment-workflow");
const S = require("./schema-objects");
const R = require("./rss-actions");
const AN = require("./analysis-actions");
const RS = require("./research-state");
const WA = require("./workspace-actions");
const MA = require("./material-actions");
const TDA = require("./timeblock-drift-audit");
const PRS = require("./pending-review-scan");
const hash = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
// The policy names all four autonomy levels even though this release only
// ships L0 and L1 actions. L2/L3 are deliberately unavailable until a future
// action has an undo story and an explicit user-facing consent flow.
const LEVELS = {
  L0: { description: "read-only", requires_confirmation: false },
  L1: { description: "local reversible write", requires_confirmation: true },
  L2: { description: "local consequential write", requires_confirmation: true, released: false },
  L3: { description: "external or irreversible effect", requires_confirmation: true, released: false },
};
const ACTIONS = {
  "experiment.transition": { level: "L1", risk: "reversible", requires_confirmation: true, handler: (v, input, o) => W.transition(v, input.experiment_uid, input.to_status, input.reason, o) },
  "vault.validate": { level: "L0", risk: "read_only", requires_confirmation: false, handler: (v) => S.validateVault(v) },
  // The three actions below are the first slice of the Bridge control plane
  // (agent-canvas-demo/bridge/server.js -> tools/bridge-action-queue.js ->
  // here). They are `async: true` because they wrap live RssFeedBoard
  // methods (network fetch, scoring API calls); see run()/runAsync() below
  // for why that means they can only be invoked through runAsync(). Each
  // handler receives a fourth `live` argument (see tools/rss-actions.js) that
  // is undefined unless the caller is the Obsidian-side queue consumer.
  "rss.refresh_feed": { level: "L1", risk: "network_fetch", requires_confirmation: true, async: true, handler: (v, input, o, live) => R.refreshFeed(v, input, o, live) },
  "rss.score_feed": { level: "L1", risk: "external_api_call", requires_confirmation: true, async: true, handler: (v, input, o, live) => R.scoreFeed(v, input, o, live) },
  "rss.clip_high_score": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => R.clipHighScore(v, input, o, live) },
  // Clip a single arbitrary URL (typically a publisher landing page reported
  // by the Weaver full lane's fetch_and_attach_pdf landing outcome) through
  // the same hidden-webview capture path the RSS panel's "抓取全文" button
  // uses. Unlike rss.clip_high_score this is an explicit per-URL instruction,
  // so it is not gated on rssAutoCaptureEnabled.
  "rss.clip_url": { level: "L1", risk: "network_fetch_and_local_write", requires_confirmation: true, async: true, handler: (v, input, o, live) => R.clipUrl(v, input, o, live) },
  // Download a PDF through the hidden webview's browser session (the shared
  // persist:scholarium-research-browser partition, so WebVPN/institutional
  // login cookies apply) for URLs the Bridge's own downloader cannot reach —
  // publisher anti-bot 403 on datacenter IPs, paywalls. Validation and dedup
  // semantics mirror bridge/server.js fetchPdfBytes + savePdfWithDedup.
  "rss.fetch_pdf": { level: "L1", risk: "network_fetch_and_local_write", requires_confirmation: true, async: true, handler: (v, input, o, live) => R.fetchPdf(v, input, o, live) },
  // Second slice of the control plane: agent-proposable Materials analysis.
  // Same shape as the rss.* actions above (async, live-context duck-typed,
  // requires_confirmation), but the handler calls the Bridge's existing
  // /v1/skills/run path instead of a live RssFeedBoard method. See
  // tools/analysis-actions.js for why this is not a new write surface.
  "sch-data-plot": { level: "L1", risk: "local_write", requires_confirmation: true, async: true, handler: (v, input, o, live) => AN.dataPlot(v, input, o, live) },
  "sch-data-profile-audit": { level: "L1", risk: "local_write", requires_confirmation: true, async: true, handler: (v, input, o, live) => AN.profileAudit(v, input, o, live) },
  // M1 read channel (docs/self-evolving-agent-design.md §4): L0 views over
  // the vault's schema-v1 Markdown. Synchronous and live-context-free on
  // purpose — the Bridge serves them directly via GET /v1/scholarium/state
  // without queueing, because Markdown is the truth source (schema-v1 §7.1)
  // and a read must not wait on Obsidian being open. Keep them L0: anything
  // that writes belongs in the queue, not in this endpoint.
  "project.list": { level: "L0", risk: "read_only", requires_confirmation: false, handler: (v, input, o) => RS.listProjects(v, input, o) },
  "project.get": { level: "L0", risk: "read_only", requires_confirmation: false, handler: (v, input, o) => RS.getProject(v, input, o) },
  "experiment.scan_outcomes": { level: "L0", risk: "read_only", requires_confirmation: false, handler: (v, input, o) => RS.scanExperimentOutcomes(v, input, o) },
  // M2 (docs/self-evolving-agent-design.md §5.1/§6): read-only list of
  // Idea cards (Research/Ideas/IDEA-xxx.md), for the Idea 卡片列表页. Same
  // synchronous, queue-free L0 shape as the three actions above — served
  // directly by GET /v1/scholarium/state, no Obsidian-open requirement.
  "idea.list": { level: "L0", risk: "read_only", requires_confirmation: false, handler: (v, input, o) => RS.listIdeas(v, input, o) },
  // 决策持久化（2026-08-26）：input 可选 {"project_uid":"..."} 限定课题，和
  // experiment.scan_outcomes/workspace.timeblock_drift_audit 同一约定；
  // project.get 已经把当前课题的决策捆在一起返回，这个动作是给不想先查
  // project.get 就想直接看全部/某课题决策的调用方用的。
  "decision.list": { level: "L0", risk: "read_only", requires_confirmation: false, handler: (v, input, o) => RS.listDecisions(v, input, o) },
  // M5 步骤1（2026-08-26）：经验候选/已确认经验列表，input 可选
  // {"project_uid":"..."} 限定课题，和 decision.list 同一约定；project.get
  // 已经把当前课题相关的（project_uid 匹配 + 跨课题通用的）经验捆在一起
  // 返回，这个动作是给不想先查 project.get 就想直接看的调用方用的。
  "lesson.list": { level: "L0", risk: "read_only", requires_confirmation: false, handler: (v, input, o) => RS.listLessons(v, input, o) },
  "research.ids": { level: "L0", risk: "read_only", requires_confirmation: false, handler: (v, input, o) => RS.listDisplayIds(v, input, o) },
  // Third slice of the control plane: 织研者对 Scholarium 面板的全面操作。
  // L0 reads are served by the Bridge straight from data.json on disk
  // (Obsidian may be closed); every L1 write goes through the queue consumer
  // with live.plugin (plugin.loadData/saveData) — never a direct data.json
  // write, which Obsidian would silently overwrite from in-memory state.
  // All handlers are async (they await loadData/saveData), so runAsync only.
  "workspace.get_state": { level: "L0", risk: "read_only", requires_confirmation: false, handler: (v, input, o) => WA.getState(v, input, o) },
  // Read-only cross-check between workspace.timeblocks (data.json) and the
  // Experiment records their experimentUid fields point to (Research/
  // Experiments/*.md) — see tools/timeblock-drift-audit.js. Same L0 shape as
  // workspace.get_state: reads data.json straight from disk, never touches
  // Obsidian's live state, no queue round-trip required.
  "workspace.timeblock_drift_audit": { level: "L0", risk: "read_only", requires_confirmation: false, handler: (v, input, o) => TDA.auditTimeblocks(v, input) },
  // M4 (2026-08-26): whole-vault version of the drift audit + decision
  // trigger surfacing, unscoped to whichever project the chat currently has
  // bound. See tools/pending-review-scan.js for why this needs to exist
  // separately from workspace.timeblock_drift_audit/project.get instead of
  // just calling both unscoped from the prompt: it also carries the stable
  // `marker` ids the chat uses to dedup against tasks it already proposed.
  // input.cadence_days (server.js injects scholarium.rescanCadenceDays when
  // the caller doesn't pass one) gates the `due` flag in the result — the
  // date math happens here in JS, not in the model's head. This handler
  // itself stays a pure read (dryRun:true from GET /v1/scholarium/state
  // never sees a write); the paired checkpoint-mark write that resets the
  // due-clock is deliberately NOT modeled as a registry action — see
  // bridge/server.js's GET /v1/scholarium/rescan-checkpoint-mark and
  // tools/pending-review-scan.js's header comment for why.
  "workspace.rescan_pending": { level: "L0", risk: "read_only", requires_confirmation: false, handler: (v, input, o) => PRS.scanPendingReview(v, input) },
  "material.list": { level: "L0", risk: "read_only", requires_confirmation: false, handler: (v, input, o) => MA.list(v, input, o) },
  "workspace.timeblock_add": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => WA.timeblockAdd(v, input, o, live) },
  "workspace.timeblock_update": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => WA.timeblockUpdate(v, input, o, live) },
  "workspace.timeblock_remove": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => WA.timeblockRemove(v, input, o, live) },
  "workspace.checkin_upsert": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => WA.checkinUpsert(v, input, o, live) },
  "workspace.habit_add": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => WA.habitAdd(v, input, o, live) },
  "workspace.habit_log": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => WA.habitLog(v, input, o, live) },
  "workspace.emotion_log": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => WA.emotionLog(v, input, o, live) },
  "workspace.task_add": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => WA.taskAdd(v, input, o, live) },
  "workspace.task_update": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => WA.taskUpdate(v, input, o, live) },
  "workspace.task_remove": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => WA.taskRemove(v, input, o, live) },
  "workspace.focus_log": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => WA.focusLog(v, input, o, live) },
  "workspace.capture_add": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => WA.captureAdd(v, input, o, live) },
  "material.add": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => MA.add(v, input, o, live) },
  "material.update": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => MA.update(v, input, o, live) },
  "material.remove": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => MA.remove(v, input, o, live) },
  "material.category_add": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => MA.categoryAdd(v, input, o, live) },
  "material.category_remove": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => MA.categoryRemove(v, input, o, live) },
  // Agent 代用户修改一篇文章的 radar 评分（model 固定标 agent-override，
  // 与模型打分可区分）和已读/收藏标记。走 board.data + board.save()，
  // 与 RSS 面板 UI 手动操作同一条路径。
  "rss.set_article_score": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => R.setArticleScore(v, input, o, live) },
  "rss.mark_article": { level: "L1", risk: "reversible", requires_confirmation: true, async: true, handler: (v, input, o, live) => R.markArticle(v, input, o, live) },
  // 往实验记录追加带时间戳的日志条目（frontmatter log 列表），不改状态、
  // 不走生命周期门槛；by 默认 "agent"。同步 handler（纯磁盘读写），与
  // experiment.transition 相同，可经 run() 也可经 runAsync()。
  "experiment.append_note": { level: "L1", risk: "reversible", requires_confirmation: true, handler: (v, input, o) => W.appendNote(v, input.experiment_uid, input.text, o) },
};
function describe(name) { const a = ACTIONS[name]; if (!a) throw new Error("unknown_action:" + name); return { name, level: a.level, risk: a.risk, requires_confirmation: a.requires_confirmation, async: !!a.async, policy: LEVELS[a.level] }; }
function checkAndPrepare(name, options) {
  const action = ACTIONS[name]; if (!action) throw new Error("unknown_action:" + name);
  const policy = LEVELS[action.level];
  if (!policy || policy.released === false) throw new Error("action_level_not_released:" + action.level);
  const allowed = options.allowedLevels || ["L0", "L1"];
  if (!allowed.includes(action.level)) throw new Error("action_level_not_authorized:" + action.level);
  const dryRun = options.dryRun !== false;
  if (action.requires_confirmation && !dryRun && options.confirmed !== true) throw new Error("explicit_confirmation_required");
  return { action, policy, dryRun };
}
function buildManifest(vault, name, action, policy, dryRun, input, result, options) {
  const manifest = { kind: "scholarium_action_run", action: name, level: action.level, risk: action.risk, policy, dry_run: dryRun, input, result, at: options.now || new Date().toISOString(), actor: options.by || "user" };
  manifest.manifest_sha256 = hash(JSON.stringify(manifest));
  if (!dryRun) {
    const dir = path.join(vault, "Research", "_runs", "actions"); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, manifest.at.replace(/[:.]/g, "-") + " " + name.replace(/\./g, "-") + ".json"), JSON.stringify(manifest, null, 2), "utf8");
  }
  return manifest;
}
// Synchronous path, unchanged in behaviour from before rss.* existed. Every
// existing caller (e.g. schOpenExperimentTransition's modal in main.js) reads
// this return value immediately without awaiting it, so an `async: true`
// action must never reach this function.
function run(vault, name, input = {}, options = {}) {
  const { action, policy, dryRun } = checkAndPrepare(name, options);
  if (action.async) throw new Error("action_requires_runAsync:" + name);
  const result = action.handler(vault, input, { dryRun, by: options.by || "user", now: options.now }, options.live);
  return buildManifest(vault, name, action, policy, dryRun, input, result, options);
}
// Async twin for actions whose handler needs to await a live board method
// (network fetch, scoring API call). Same contract as run(), returns a
// Promise<manifest> instead of manifest.
async function runAsync(vault, name, input = {}, options = {}) {
  const { action, policy, dryRun } = checkAndPrepare(name, options);
  const result = await action.handler(vault, input, { dryRun, by: options.by || "user", now: options.now }, options.live);
  return buildManifest(vault, name, action, policy, dryRun, input, result, options);
}
module.exports = { LEVELS, ACTIONS, describe, run, runAsync };
