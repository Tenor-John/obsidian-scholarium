"use strict";
// Scholarium 博士工作台 (workspace.* in data.json) action handlers.
//
// Sections and their real shapes (verified against the owner's data.json):
//   timeblocks: [{id, date, startTime, endTime, category, title, note, experimentUid,
//                 executionStatus?, executionNote?, executionRecordedAt?}]
//   checkin:    { "YYYY-MM-DD": { morning:[], afternoon:[], evening:[], activePeriod } }
//   tasks:      [{...}]  captures: [{...}]  submissions/leave: [...]
//   focus:      { sessions:[{id,date,title,start,end,minutes}], active }
//   habits:     { list:[...], logs:{...} }
//   food:       { entries:[...] }   emotions: {...}  phone: { logs:[...] }
//
// Reads (workspace.get_state) are L0 and read data.json from disk, so the
// Bridge can serve them even while Obsidian is closed. Writes are L1 and run
// through the queue consumer inside Obsidian, where the handler receives
// live.plugin and goes through plugin.loadData()/saveData() — never a direct
// data.json write, which Obsidian would silently overwrite from memory.
//
// timeblocks.experimentUid — formal link to a schema-v1 Experiment (§ time
// block ↔ experiment closed-loop work, 2026-08-26). This is the *only*
// machine-readable relationship key, the same `_uid` convention used
// everywhere else in this codebase (project_uid/target_uid/source_uid/
// experiment_uid on experiment.append_note): it always holds the Experiment
// object's `uid` (UUIDv7), never its `display_id` (e.g. "EXP-007"), because
// display ids are for humans and can in principle be reassigned while a uid
// never changes. `note` remains free text for a human-readable pointer (e.g.
// writing "EXP-007" in prose) but is never parsed to resolve a relationship —
// that was the pre-2026-08-26 state, where "对应 EXP-007" only existed inside
// `note` and nothing could check it against the actual Experiment record.
// `resolveExperimentUid` below accepts either the raw uid or, for caller
// convenience, the human display id — and resolves it against the vault
// before anything is written, so a bad or stale reference is rejected at
// write time instead of silently rotting in data.json.

const fs = require("fs");
const path = require("path");
const S = require("./schema-objects");

const SECTIONS = ["checkin", "timeblocks", "tasks", "captures", "focus", "habits", "food", "emotions", "journal", "phone", "submissions", "leave"];
const WRITE_SECTIONS = ["timeblocks", "checkin", "tasks", "captures", "focus", "habits", "food", "emotions"];

function dataJsonPath(vault) {
  const candidates = [
    path.join(vault, ".obsidian", "plugins", "obsidian-scholarium", "data.json"),
    path.join(vault, ".obsidian", "plugins", "scholarium", "data.json"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function readWorkspaceFromDisk(vault) {
  try {
    const data = JSON.parse(fs.readFileSync(dataJsonPath(vault), "utf8"));
    return data && typeof data.workspace === "object" && data.workspace ? data.workspace : {};
  } catch (_) {
    return null;
  }
}

function getState(vault, input = {}) {
  const workspace = readWorkspaceFromDisk(vault);
  if (!workspace) throw new Error("workspace_state_unreadable: data.json not found or invalid");
  const section = String(input.section || "").trim();
  if (section) {
    if (!SECTIONS.includes(section)) throw new Error("unknown_workspace_section:" + section + " (known: " + SECTIONS.join(", ") + ")");
    return { section, value: workspace[section] ?? null, note: "read from data.json on disk; Obsidian may hold newer unsaved state for a few seconds" };
  }
  const summary = {};
  for (const key of SECTIONS) {
    const value = workspace[key];
    summary[key] = Array.isArray(value) ? { count: value.length } : value && typeof value === "object" ? { keys: Object.keys(value).length } : { empty: true };
  }
  return { sections: summary };
}

function requirePlugin(live, dryRun) {
  if (live && live.plugin && typeof live.plugin.loadData === "function") return live.plugin;
  if (dryRun) return null; // validate input only
  throw new Error("scholarium_live_context_required");
}

function rid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
// 执行回填（2026-08-26）：一个时间块排出去之后到底发生了什么，此前完全没有
// 地方记录——workspace.timeblock_drift_audit 只能看出"日期过了、实验状态
// 没推进"，看不出是"压根没人说这块时间干了什么"还是"说了但实验记录没跟上"。
// executionStatus 就是补上"发生了什么"这一步的最小事实字段。
const EXECUTION_STATUSES = new Set(["completed", "not_completed", "blocked"]);

// Resolve `input.experiment_uid` / `input.experiment_display_id` into the
// canonical Experiment uid to store on a timeblock. Returns:
//   undefined — neither key was present in input: leave the field untouched
//               (timeblock_add: defaults to null; timeblock_update: no patch)
//   null      — the key was present but blank ("" / null): explicit unlink
//   <uid>     — resolved and confirmed to exist as a real experiment record
// Throws experiment_not_found:<value> if a non-blank reference does not
// resolve to any Experiment in the vault — a stale or typo'd reference must
// fail loudly at write time, not be stored and silently rot.
function resolveExperimentUid(vault, input) {
  const hasUid = Object.prototype.hasOwnProperty.call(input, "experiment_uid");
  const hasDisplayId = Object.prototype.hasOwnProperty.call(input, "experiment_display_id");
  if (!hasUid && !hasDisplayId) return undefined;
  const rawUid = hasUid ? String(input.experiment_uid || "").trim() : "";
  const displayId = hasDisplayId ? String(input.experiment_display_id || "").trim() : "";
  if (!rawUid && !displayId) return null;
  const experiments = S.readVaultObjects(vault).filter((entry) => entry.object.type === "experiment");
  if (rawUid) {
    const hit = experiments.find((entry) => entry.object.uid === rawUid);
    if (!hit) throw new Error("experiment_not_found:" + rawUid);
    return hit.object.uid;
  }
  const hit = experiments.find((entry) => entry.object.display_id === displayId);
  if (!hit) throw new Error("experiment_not_found:" + displayId);
  return hit.object.uid;
}

async function mutateWorkspace(plugin, fn) {
  const data = (await plugin.loadData()) || {};
  if (!data.workspace || typeof data.workspace !== "object") data.workspace = {};
  const result = await fn(data.workspace);
  await plugin.saveData(data);
  return result;
}

// ── timeblocks ─────────────────────────────────────────────
async function timeblockAdd(vault, input, options, live) {
  const date = String(input.date || "");
  const startTime = String(input.start || input.startTime || "");
  const endTime = String(input.end || input.endTime || "");
  const title = String(input.title || "").trim();
  if (!DATE_RE.test(date)) throw new Error("date_required:YYYY-MM-DD");
  if (!TIME_RE.test(startTime) || !TIME_RE.test(endTime)) throw new Error("start_end_required:HH:MM");
  if (startTime >= endTime) throw new Error("start_must_be_before_end");
  if (!title) throw new Error("title_required");
  const category = String(input.category || "research");
  const note = String(input.note || "");
  const experimentUid = resolveExperimentUid(vault, input) ?? null;
  const entry = { id: rid(), date, startTime, endTime, category, title, note, experimentUid };
  if (options.dryRun) return { mode: "dry_run", would_add: entry };
  const plugin = requirePlugin(live, false);
  return mutateWorkspace(plugin, async (workspace) => {
    if (!Array.isArray(workspace.timeblocks)) workspace.timeblocks = [];
    workspace.timeblocks.push(entry);
    return { added: entry, total: workspace.timeblocks.length };
  });
}

async function timeblockUpdate(vault, input, options, live) {
  const id = String(input.id || "");
  if (!id) throw new Error("id_required");
  const patch = {};
  for (const key of ["date", "startTime", "endTime", "category", "title", "note"]) {
    if (input[key] !== undefined) patch[key] = String(input[key]);
  }
  const experimentUid = resolveExperimentUid(vault, input);
  if (experimentUid !== undefined) patch.experimentUid = experimentUid; // may be null: explicit unlink
  // 执行回填：execution_status 是这次巡查的最小事实（completed / not_completed
  // / blocked），execution_note 是补充说明（可选，但强烈建议——一条
  // "blocked" 不说明为什么，下周还是不知道该怎么办）。两者一起写，任一提供
  // 就盖上 executionRecordedAt 时间戳；只给 execution_note 不给
  // execution_status 视为无效输入，拒绝——"记了点什么但没说算完成还是没完成"
  // 不是一条可用的回填事实。
  if (input.execution_status !== undefined) {
    const status = String(input.execution_status || "").trim();
    if (!EXECUTION_STATUSES.has(status))
      throw new Error("execution_status_required:" + [...EXECUTION_STATUSES].join("|"));
    patch.executionStatus = status;
    patch.executionNote = String(input.execution_note || "");
    patch.executionRecordedAt = new Date().toISOString();
  } else if (input.execution_note !== undefined) {
    throw new Error("execution_status_required_with_execution_note");
  }
  if (!Object.keys(patch).length) throw new Error("no_fields_to_update");
  if (options.dryRun) return { mode: "dry_run", id, patch };
  const plugin = requirePlugin(live, false);
  return mutateWorkspace(plugin, async (workspace) => {
    const list = Array.isArray(workspace.timeblocks) ? workspace.timeblocks : [];
    const entry = list.find((item) => item.id === id);
    if (!entry) throw new Error("timeblock_not_found:" + id);
    Object.assign(entry, patch);
    return { updated: entry };
  });
}

async function timeblockRemove(vault, input, options, live) {
  const id = String(input.id || "");
  if (!id) throw new Error("id_required");
  if (options.dryRun) return { mode: "dry_run", id };
  const plugin = requirePlugin(live, false);
  return mutateWorkspace(plugin, async (workspace) => {
    const list = Array.isArray(workspace.timeblocks) ? workspace.timeblocks : [];
    const index = list.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("timeblock_not_found:" + id);
    const [removed] = list.splice(index, 1);
    return { removed };
  });
}

// ── checkin (考勤) ─────────────────────────────────────────
const PERIODS = ["morning", "afternoon", "evening"];
async function checkinUpsert(vault, input, options, live) {
  const date = String(input.date || "");
  const period = String(input.period || "");
  if (!DATE_RE.test(date)) throw new Error("date_required:YYYY-MM-DD");
  if (!PERIODS.includes(period)) throw new Error("period_required:morning|afternoon|evening");
  const note = String(input.note || "").trim();
  const at = String(input.at || new Date().toISOString());
  const clear = input.clear === true;
  if (options.dryRun) return { mode: "dry_run", date, period, note, clear };
  const plugin = requirePlugin(live, false);
  return mutateWorkspace(plugin, async (workspace) => {
    if (!workspace.checkin || typeof workspace.checkin !== "object") workspace.checkin = {};
    const day = workspace.checkin[date] || { morning: [], afternoon: [], evening: [], activePeriod: null };
    if (clear) {
      day[period] = [];
    } else {
      day[period] = [...(Array.isArray(day[period]) ? day[period] : []), { at, note }];
      day.activePeriod = period;
    }
    workspace.checkin[date] = day;
    return { date, period, entries: day[period].length, cleared: clear };
  });
}

// ── habits / emotions / tasks / focus / captures ──────────
async function habitAdd(vault, input, options, live) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("name_required");
  const entry = { id: rid(), name, cadence: String(input.cadence || "daily"), createdAt: new Date().toISOString() };
  if (options.dryRun) return { mode: "dry_run", would_add: entry };
  const plugin = requirePlugin(live, false);
  return mutateWorkspace(plugin, async (workspace) => {
    if (!workspace.habits || typeof workspace.habits !== "object") workspace.habits = { list: [], logs: {} };
    if (!Array.isArray(workspace.habits.list)) workspace.habits.list = [];
    workspace.habits.list.push(entry);
    return { added: entry, total: workspace.habits.list.length };
  });
}

async function habitLog(vault, input, options, live) {
  const habitId = String(input.habit_id || "");
  const date = String(input.date || new Date().toISOString().slice(0, 10));
  if (!habitId) throw new Error("habit_id_required");
  if (!DATE_RE.test(date)) throw new Error("date_required:YYYY-MM-DD");
  const done = input.done !== false;
  const note = String(input.note || "");
  if (options.dryRun) return { mode: "dry_run", habit_id: habitId, date, done, note };
  const plugin = requirePlugin(live, false);
  return mutateWorkspace(plugin, async (workspace) => {
    const habits = workspace.habits && typeof workspace.habits === "object" ? workspace.habits : (workspace.habits = { list: [], logs: {} });
    if (!habits.logs || typeof habits.logs !== "object") habits.logs = {};
    const key = `${habitId}:${date}`;
    habits.logs[key] = { done, note, at: new Date().toISOString() };
    return { logged: key, done };
  });
}

async function emotionLog(vault, input, options, live) {
  const mood = String(input.mood || "").trim();
  if (!mood) throw new Error("mood_required");
  const date = String(input.date || new Date().toISOString().slice(0, 10));
  const entry = { at: new Date().toISOString(), mood, score: Number.isFinite(Number(input.score)) ? Number(input.score) : null, note: String(input.note || "") };
  if (options.dryRun) return { mode: "dry_run", date, would_add: entry };
  const plugin = requirePlugin(live, false);
  return mutateWorkspace(plugin, async (workspace) => {
    if (!workspace.emotions || typeof workspace.emotions !== "object" || Array.isArray(workspace.emotions)) workspace.emotions = {};
    if (!Array.isArray(workspace.emotions[date])) workspace.emotions[date] = [];
    workspace.emotions[date].push(entry);
    return { date, logged: entry, total_that_day: workspace.emotions[date].length };
  });
}

async function taskAdd(vault, input, options, live) {
  const title = String(input.title || "").trim();
  if (!title) throw new Error("title_required");
  const entry = { id: rid(), title, status: "todo", due: String(input.due || ""), note: String(input.note || ""), createdAt: new Date().toISOString() };
  if (options.dryRun) return { mode: "dry_run", would_add: entry };
  const plugin = requirePlugin(live, false);
  return mutateWorkspace(plugin, async (workspace) => {
    if (!Array.isArray(workspace.tasks)) workspace.tasks = [];
    workspace.tasks.push(entry);
    return { added: entry, total: workspace.tasks.length };
  });
}

async function taskUpdate(vault, input, options, live) {
  const id = String(input.id || "");
  if (!id) throw new Error("id_required");
  const patch = {};
  for (const key of ["title", "status", "due", "note"]) {
    if (input[key] !== undefined) patch[key] = String(input[key]);
  }
  if (!Object.keys(patch).length) throw new Error("no_fields_to_update");
  if (options.dryRun) return { mode: "dry_run", id, patch };
  const plugin = requirePlugin(live, false);
  return mutateWorkspace(plugin, async (workspace) => {
    const list = Array.isArray(workspace.tasks) ? workspace.tasks : [];
    const entry = list.find((item) => item.id === id);
    if (!entry) throw new Error("task_not_found:" + id);
    Object.assign(entry, patch);
    return { updated: entry };
  });
}

async function taskRemove(vault, input, options, live) {
  const id = String(input.id || "");
  if (!id) throw new Error("id_required");
  if (options.dryRun) return { mode: "dry_run", id };
  const plugin = requirePlugin(live, false);
  return mutateWorkspace(plugin, async (workspace) => {
    const list = Array.isArray(workspace.tasks) ? workspace.tasks : [];
    const index = list.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("task_not_found:" + id);
    const [removed] = list.splice(index, 1);
    return { removed };
  });
}

async function focusLog(vault, input, options, live) {
  const title = String(input.title || "").trim();
  const date = String(input.date || new Date().toISOString().slice(0, 10));
  if (!title) throw new Error("title_required");
  const entry = {
    id: rid(), date, title,
    start: String(input.start || ""), end: String(input.end || ""),
    minutes: Number.isFinite(Number(input.minutes)) ? Number(input.minutes) : 0,
  };
  if (options.dryRun) return { mode: "dry_run", would_add: entry };
  const plugin = requirePlugin(live, false);
  return mutateWorkspace(plugin, async (workspace) => {
    if (!workspace.focus || typeof workspace.focus !== "object") workspace.focus = { sessions: [], active: null };
    if (!Array.isArray(workspace.focus.sessions)) workspace.focus.sessions = [];
    workspace.focus.sessions.push(entry);
    return { added: entry, total: workspace.focus.sessions.length };
  });
}

async function captureAdd(vault, input, options, live) {
  const text = String(input.text || input.title || "").trim();
  if (!text) throw new Error("text_required");
  const entry = { id: rid(), text, createdAt: new Date().toISOString() };
  if (options.dryRun) return { mode: "dry_run", would_add: entry };
  const plugin = requirePlugin(live, false);
  return mutateWorkspace(plugin, async (workspace) => {
    if (!Array.isArray(workspace.captures)) workspace.captures = [];
    workspace.captures.push(entry);
    return { added: entry, total: workspace.captures.length };
  });
}

module.exports = {
  SECTIONS, WRITE_SECTIONS,
  getState, readWorkspaceFromDisk,
  timeblockAdd, timeblockUpdate, timeblockRemove, resolveExperimentUid,
  checkinUpsert, habitAdd, habitLog, emotionLog,
  taskAdd, taskUpdate, taskRemove, focusLog, captureAdd,
};
