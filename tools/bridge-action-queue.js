"use strict";
// File-based handoff queue between the local Agent Bridge (a separate Node
// process: agent-canvas-demo/bridge/server.js) and the Scholarium plugin
// (running inside Obsidian, the only process holding a live RssFeedBoard).
//
// The Bridge only ever writes a *request* here (see submit()); it never
// touches data.json or the live board. The plugin's queue consumer (to be
// registered in onload(), see docs/bridge-control-plane.md for the exact
// wiring) claims pending items and executes them through
// tools/action-registry.js `runAsync()`, so every non-dry-run action still
// goes through the same L0-L3 policy, whitelist and Research/_runs/actions/
// audit manifest as a user-initiated action. settle() then archives the
// request together with its result so the Bridge (or Claude, via the
// existing read-only /v1/workspace-file endpoint or the new
// /v1/scholarium/actions/:id endpoint) can read back what happened.
//
// Deliberately dumb: no locking beyond atomic rename-into-place, no retries,
// no priority. One human-scale research workflow does not need a job queue,
// it needs an auditable in-tray.
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");

const QUEUE_DIR = "Research/_runs/queue";
const ARCHIVE_DIR = "Research/_runs/queue-archive";

function segments(relative) { return relative.split("/"); }
function queueDir(vault) { return path.join(vault, ...segments(QUEUE_DIR)); }
function archiveDir(vault) { return path.join(vault, ...segments(ARCHIVE_DIR)); }
function queuePath(vault, id) { return path.join(queueDir(vault), `${id}.json`); }
function archivePath(vault, id) { return path.join(archiveDir(vault), `${id}.json`); }

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

// Called by the Bridge process only. `action` is validated by the caller
// against tools/action-registry.js ACTIONS before this is ever reached.
function submit(vault, action, input = {}, meta = {}) {
  const id = randomUUID();
  const item = {
    id,
    action: String(action),
    input: input && typeof input === "object" ? input : {},
    status: "pending",
    submitted_at: new Date().toISOString(),
    submitted_by: meta.by || "bridge",
    source_task_id: meta.sourceTaskId || undefined,
    provider: meta.provider || undefined,
  };
  writeJsonAtomic(queuePath(vault, id), item);
  return item;
}

// Called by the plugin's queue consumer to see what is waiting.
function listPending(vault) {
  const dir = queueDir(vault);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)));
}

// Called by either side: the Bridge to report status back to the calling
// agent, the plugin consumer to check it isn't double-claiming.
function read(vault, id) {
  const pending = queuePath(vault, id);
  if (fs.existsSync(pending)) return JSON.parse(fs.readFileSync(pending, "utf8"));
  const archived = archivePath(vault, id);
  if (fs.existsSync(archived)) return JSON.parse(fs.readFileSync(archived, "utf8"));
  return null;
}

function recentArchive(vault, limit = 20) {
  const dir = archiveDir(vault);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      try { return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); }
      catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.settled_at || "").localeCompare(String(a.settled_at || "")))
    .slice(0, Math.max(0, Math.min(200, limit)));
}

// Called only from inside the Obsidian process (the plugin's queue
// consumer), after tools/action-registry.js has run the action (or refused
// to). Moves the request out of the pending queue and stamps it with the
// outcome so it is never picked up twice.
function settle(vault, id, patch) {
  const file = queuePath(vault, id);
  if (!fs.existsSync(file)) throw new Error("queue_item_not_found:" + id);
  const item = JSON.parse(fs.readFileSync(file, "utf8"));
  // 2026-08-23 bugfix: 消费者（main.js schPollScholariumQueue）传进来的 patch
  // 是 { status, result?, error? } 平铺形态，而织研者聊天端轮询结算时认的是
  // 嵌套的 item.outcome.status。之前只平铺展开，聊天端永远等不到 outcome，
  // 180 秒后误报"超时未结算"——实际写入早已成功。这里同时保留平铺字段
  // （向后兼容任何按旧格式读 archive 的地方）和嵌套 outcome（轮询认的格式）。
  const settled = { ...item, ...patch, outcome: patch, settled_at: new Date().toISOString() };
  writeJsonAtomic(archivePath(vault, id), settled);
  fs.unlinkSync(file);
  return settled;
}

module.exports = { QUEUE_DIR, ARCHIVE_DIR, submit, listPending, read, recentArchive, settle };
