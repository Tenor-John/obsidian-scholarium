"use strict";
// M4 第一步：全量待确认回扫 (2026-08-26).
//
// Everything before this file answered "what's wrong with *this* project's
// schedule" (workspace.timeblock_drift_audit with a project_uid scope) or
// "what's wrong with *this* project's decisions" (project.get's decisions
// array) — both only fire once a chat has bound a project. That is exactly
// the gap M4 closes: a researcher who opens 织研者 without picking a project
// yet, or who has drift sitting in a project they are not currently looking
// at, never sees it. This module is the unscoped, whole-vault version of the
// same read: every Experiment-linked timeblock with an open flag, and every
// active Decision that named a trigger_condition, regardless of which
// project they belong to.
//
// Deliberately NOT included: judging whether a trigger_condition is actually
// satisfied. That requires reading the condition text against current
// project state — a reasoning step, not a mechanical comparison — and stays
// with the calling agent (research-chat-core.js's prompt), same as it always
// has for project-scoped decisions. This scan only surfaces which active
// decisions *carry* a trigger_condition worth re-checking; it does not
// evaluate them.
//
// L0 / read-only, same shape as workspace.timeblock_drift_audit: reads
// data.json and Research/**.md straight off disk, no Obsidian-open
// requirement, no queue round-trip.
//
// Every item carries a stable `marker` string. It exists so the caller (the
// chat prompt, see research-chat-core.js rule 16) can dedup against tasks it
// already proposed in an earlier session: embed the marker in the
// workspace.task_add note, then before proposing a new task for the same
// item, check whether a task with that marker already exists. Without a
// stable id, re-running this scan at the start of every chat would repropose
// the same item every single time.

const fs = require("fs");
const path = require("path");
const TDA = require("./timeblock-drift-audit");
const RS = require("./research-state");

function timeblockMarker(id) { return "RESCAN-TB:" + String(id); }
function decisionMarker(uid) { return "RESCAN-DEC:" + String(uid); }

// M4 第二步：把"多久提醒一次"从"每次会话第一条消息"升级成可配置的按天/周
// 节流 (2026-08-26)。节流状态本身（"上次全量回扫是什么时候做的"）不属于
// 研究记录——它不是 schema-v1 对象，也不是 workspace.tasks 里的任何一条待
// 办，只是这个模块自己的记账游标。所以它落在 Research/_runs/rescan/ 下，
// 和 tools/action-registry.js 的 Research/_runs/actions/ 审计清单同一个"Bridge
// 自己的运行记账"目录家族，而不是 data.json（会被 Obsidian 的内存态覆盖）
// 或 .scholarium/agent/（那是研究员/规则9 讲的跨会话"项目记忆"，有自己的写
// 入纪律，agent 不能直写）。
//
// 这一条记账写入被明确豁免于"所有写入都要走确认卡片"的原则——研究员已经
// 在 2026-08-26 的设计讨论里确认了这个窄口子：写的只是"什么时候查过"，不
// 改变任何研究记录，重复写入也无害。豁免范围严格限定于这一个文件；不要把
// 这个先例套到其它任何数据上。
const CHECKPOINT_PATH_PARTS = ["Research", "_runs", "rescan", "last-checked.json"];

function checkpointPath(vault) { return path.join(vault, ...CHECKPOINT_PATH_PARTS); }

function readCheckpoint(vault) {
  try {
    const raw = JSON.parse(fs.readFileSync(checkpointPath(vault), "utf8"));
    return raw && raw.last_checked_at ? String(raw.last_checked_at) : null;
  } catch {
    return null; // no checkpoint yet, or unreadable — treat as "never checked"
  }
}

function writeCheckpoint(vault, atIso) {
  const at = atIso || new Date().toISOString();
  const target = checkpointPath(vault);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify({ last_checked_at: at }, null, 2), "utf8");
  return at;
}

const DEFAULT_CADENCE_DAYS = 1;

function scanPendingReview(vault, options = {}) {
  const cadenceDays = Number(options.cadence_days) > 0 ? Number(options.cadence_days) : DEFAULT_CADENCE_DAYS;
  const now = options.now ? new Date(options.now) : new Date();
  const lastCheckedAt = readCheckpoint(vault);
  const cadenceMs = cadenceDays * 24 * 60 * 60 * 1000;
  const due = !lastCheckedAt || (now.getTime() - new Date(lastCheckedAt).getTime()) >= cadenceMs;
  const nextDueAt = lastCheckedAt ? new Date(new Date(lastCheckedAt).getTime() + cadenceMs).toISOString() : null;

  const drift = TDA.auditTimeblocks(vault, options);
  const timeblockIssues = drift.findings
    .filter((f) => !f.clean)
    .map((f) => ({
      marker: timeblockMarker(f.id),
      id: f.id,
      date: f.date,
      title: f.title,
      experiment_uid: f.experimentUid,
      experiment_display_id: f.experiment_display_id,
      flags: f.flags,
      execution_status: f.execution_status,
      execution_note: f.execution_note,
    }));

  const idx = RS.indexVault(vault);
  const decisionTriggers = idx.byType.decision
    .filter((entry) => entry.object.status === "active" && String(entry.object.trigger_condition || "").trim())
    .map((entry) => {
      const dec = entry.object;
      const project = dec.project_uid ? idx.byUid.get(dec.project_uid) : null;
      return {
        marker: decisionMarker(dec.uid),
        uid: dec.uid,
        display_id: dec.display_id,
        title: dec.title || "",
        trigger_condition: dec.trigger_condition,
        project_uid: dec.project_uid || null,
        project_display_id: project ? project.object.display_id || null : null,
      };
    });
  decisionTriggers.sort((a, b) => String(a.display_id || "").localeCompare(String(b.display_id || "")));

  return {
    checked_at: drift.checked_at,
    due,
    last_checked_at: lastCheckedAt,
    cadence_days: cadenceDays,
    next_due_at: nextDueAt,
    timeblock_issues: timeblockIssues,
    decision_triggers: decisionTriggers,
    counts: {
      timeblock_issues: timeblockIssues.length,
      decision_triggers: decisionTriggers.length,
    },
  };
}

module.exports = { scanPendingReview, timeblockMarker, decisionMarker, readCheckpoint, writeCheckpoint };
