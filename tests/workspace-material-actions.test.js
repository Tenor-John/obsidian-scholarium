"use strict";

const { describe, it, assert } = require("./harness");
const fs = require("fs");
const os = require("os");
const path = require("path");
const registry = require("../tools/action-registry");
const WA = require("../tools/workspace-actions");
const MA = require("../tools/material-actions");

function tmpVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-panel-actions-"));
}

function fakePlugin(initial = {}) {
  const data = initial;
  const saved = [];
  return {
    saved,
    async loadData() { return data; },
    async saveData(d) { saved.push(JSON.parse(JSON.stringify(d))); },
  };
}

describe("workspace.* dry-run validation", () => {
  it("timeblock_add rejects a missing date", async () => {
    let threw = false;
    try { await registry.runAsync("/tmp", "workspace.timeblock_add", { start: "09:00", end: "11:00", title: "HPLC" }, { dryRun: true }); }
    catch (e) { threw = true; assert.match(e.message, /date_required/); }
    assert.ok(threw);
  });
  it("timeblock_add rejects start >= end", async () => {
    let threw = false;
    try { await registry.runAsync("/tmp", "workspace.timeblock_add", { date: "2026-08-21", start: "11:00", end: "09:00", title: "x" }, { dryRun: true }); }
    catch (e) { threw = true; assert.match(e.message, /start_must_be_before_end/); }
    assert.ok(threw);
  });
  it("checkin_upsert rejects an unknown period", async () => {
    let threw = false;
    try { await registry.runAsync("/tmp", "workspace.checkin_upsert", { date: "2026-08-21", period: "midnight" }, { dryRun: true }); }
    catch (e) { threw = true; assert.match(e.message, /period_required/); }
    assert.ok(threw);
  });
  it("a valid timeblock_add dry-run reports the would-be entry without a plugin", async () => {
    const manifest = await registry.runAsync("/tmp", "workspace.timeblock_add", { date: "2026-08-21", start: "09:00", end: "11:00", title: "HPLC" }, { dryRun: true });
    assert.eq(manifest.result.mode, "dry_run");
    assert.eq(manifest.result.would_add.title, "HPLC");
    assert.eq(manifest.result.would_add.startTime, "09:00");
    assert.eq(manifest.result.would_add.endTime, "11:00");
    assert.eq(Object.hasOwn(manifest.result.would_add, "start"), false);
    assert.eq(Object.hasOwn(manifest.result.would_add, "end"), false);
  });
  it("timeblock_add also accepts canonical startTime/endTime input", async () => {
    const manifest = await registry.runAsync("/tmp", "workspace.timeblock_add", { date: "2026-08-21", startTime: "13:00", endTime: "14:30", title: "XRD" }, { dryRun: true });
    assert.eq(manifest.result.would_add.startTime, "13:00");
    assert.eq(manifest.result.would_add.endTime, "14:30");
  });
});

describe("workspace.* writes go through plugin.loadData/saveData", () => {
  it("timeblock_add appends to workspace.timeblocks and persists via saveData", async () => {
    const plugin = fakePlugin({});
    const vault = tmpVault();
    const manifest = await registry.runAsync(vault, "workspace.timeblock_add", { date: "2026-08-21", start: "09:00", end: "11:00", title: "HPLC" }, { dryRun: false, confirmed: true, live: { plugin } });
    assert.eq(manifest.result.added.title, "HPLC");
    assert.eq(plugin.saved.length, 1);
    assert.eq(plugin.saved[0].workspace.timeblocks.length, 1);
  });
  it("timeblock_add defaults experimentUid to null when not linked", async () => {
    const plugin = fakePlugin({});
    const vault = tmpVault();
    const manifest = await registry.runAsync(vault, "workspace.timeblock_add", { date: "2026-08-21", start: "09:00", end: "11:00", title: "跑步" }, { dryRun: false, confirmed: true, live: { plugin } });
    assert.eq(manifest.result.added.experimentUid, null);
  });
  it("checkin_upsert appends to the right period and sets activePeriod", async () => {
    const plugin = fakePlugin({ workspace: { checkin: {} } });
    const vault = tmpVault();
    await registry.runAsync(vault, "workspace.checkin_upsert", { date: "2026-08-21", period: "morning", note: "到实验室" }, { dryRun: false, confirmed: true, live: { plugin } });
    const day = plugin.saved[0].workspace.checkin["2026-08-21"];
    assert.eq(day.morning.length, 1);
    assert.eq(day.activePeriod, "morning");
  });
  it("habit_log keys logs by habitId:date", async () => {
    const plugin = fakePlugin({});
    const vault = tmpVault();
    await registry.runAsync(vault, "workspace.habit_log", { habit_id: "h1", date: "2026-08-21", done: true }, { dryRun: false, confirmed: true, live: { plugin } });
    assert.eq(plugin.saved[0].workspace.habits.logs["h1:2026-08-21"].done, true);
  });
  it("timeblock_update fails for an unknown id", async () => {
    const plugin = fakePlugin({ workspace: { timeblocks: [] } });
    const vault = tmpVault();
    let threw = false;
    try { await registry.runAsync(vault, "workspace.timeblock_update", { id: "nope", title: "x" }, { dryRun: false, confirmed: true, live: { plugin } }); }
    catch (e) { threw = true; assert.match(e.message, /timeblock_not_found/); }
    assert.ok(threw);
  });
  it("writes without a live plugin are refused, never silently dropped", async () => {
    const vault = tmpVault();
    let threw = false;
    try { await registry.runAsync(vault, "workspace.task_add", { title: "x" }, { dryRun: false, confirmed: true }); }
    catch (e) { threw = true; assert.match(e.message, /scholarium_live_context_required/); }
    assert.ok(threw);
  });
  it("task_remove deletes only the requested task", async () => {
    const plugin = fakePlugin({ workspace: { tasks: [{ id: "keep", title: "保留" }, { id: "drop", title: "删除" }] } });
    const manifest = await registry.runAsync(tmpVault(), "workspace.task_remove", { id: "drop" }, { dryRun: false, confirmed: true, live: { plugin } });
    assert.eq(manifest.result.removed.id, "drop");
    assert.eq(plugin.saved[0].workspace.tasks.length, 1);
    assert.eq(plugin.saved[0].workspace.tasks[0].id, "keep");
  });
  it("task_remove dry-runs without a live plugin and refuses an unknown id when live", async () => {
    const dryRun = await registry.runAsync(tmpVault(), "workspace.task_remove", { id: "drop" }, { dryRun: true });
    assert.eq(dryRun.result.id, "drop");
    const plugin = fakePlugin({ workspace: { tasks: [] } });
    let threw = false;
    try { await registry.runAsync(tmpVault(), "workspace.task_remove", { id: "missing" }, { dryRun: false, confirmed: true, live: { plugin } }); }
    catch (e) { threw = true; assert.match(e.message, /task_not_found:missing/); }
    assert.ok(threw);
    assert.eq(plugin.saved.length, 0, "a refused removal must not persist a partial write");
  });
});

describe("workspace.timeblock_* experimentUid linkage (2026-08-26)", () => {
  const PRJ = "019fef48-5be0-786b-8da5-39a220613712";
  function withExperiment(vault) {
    const X = require("../tools/experiment-store");
    return X.saveNew(vault, { title: "壳厚梯度预筛查", project_uid: PRJ, status: "designed", data_origin: "planned", result: "", conclusion: "" }).object;
  }
  it("timeblock_add resolves a raw experiment_uid and stores only the uid", async () => {
    const vault = tmpVault();
    const exp = withExperiment(vault);
    const plugin = fakePlugin({});
    const manifest = await registry.runAsync(vault, "workspace.timeblock_add", { date: "2026-08-21", start: "09:00", end: "11:00", title: "TEM 表征", experiment_uid: exp.uid }, { dryRun: false, confirmed: true, live: { plugin } });
    assert.eq(manifest.result.added.experimentUid, exp.uid);
  });
  it("timeblock_add resolves a convenience experiment_display_id to the canonical uid", async () => {
    const vault = tmpVault();
    const exp = withExperiment(vault);
    const plugin = fakePlugin({});
    const manifest = await registry.runAsync(vault, "workspace.timeblock_add", { date: "2026-08-21", start: "09:00", end: "11:00", title: "TEM 表征", experiment_display_id: exp.display_id }, { dryRun: false, confirmed: true, live: { plugin } });
    assert.eq(manifest.result.added.experimentUid, exp.uid);
  });
  it("timeblock_add rejects a uid that does not resolve to any experiment, even in dry-run", async () => {
    const vault = tmpVault();
    let threw = false;
    try {
      await registry.runAsync(vault, "workspace.timeblock_add", { date: "2026-08-21", start: "09:00", end: "11:00", title: "x", experiment_uid: "00000000-0000-7000-8000-000000000000" }, { dryRun: true });
    } catch (e) { threw = true; assert.match(e.message, /experiment_not_found/); }
    assert.ok(threw);
  });
  it("timeblock_add rejects an unresolvable experiment_display_id", async () => {
    const vault = tmpVault();
    let threw = false;
    try {
      await registry.runAsync(vault, "workspace.timeblock_add", { date: "2026-08-21", start: "09:00", end: "11:00", title: "x", experiment_display_id: "EXP-999" }, { dryRun: true });
    } catch (e) { threw = true; assert.match(e.message, /experiment_not_found:EXP-999/); }
    assert.ok(threw);
  });
  it("timeblock_update links an existing timeblock to an experiment", async () => {
    const vault = tmpVault();
    const exp = withExperiment(vault);
    const plugin = fakePlugin({ workspace: { timeblocks: [{ id: "t1", date: "2026-08-21", startTime: "09:00", endTime: "10:00", category: "experiment", title: "x", note: "", experimentUid: null }] } });
    const manifest = await registry.runAsync(vault, "workspace.timeblock_update", { id: "t1", experiment_uid: exp.uid }, { dryRun: false, confirmed: true, live: { plugin } });
    assert.eq(manifest.result.updated.experimentUid, exp.uid);
  });
  it("timeblock_update with experiment_uid: '' explicitly unlinks", async () => {
    const vault = tmpVault();
    const exp = withExperiment(vault);
    const plugin = fakePlugin({ workspace: { timeblocks: [{ id: "t1", date: "2026-08-21", startTime: "09:00", endTime: "10:00", category: "experiment", title: "x", note: "", experimentUid: exp.uid }] } });
    const manifest = await registry.runAsync(vault, "workspace.timeblock_update", { id: "t1", experiment_uid: "" }, { dryRun: false, confirmed: true, live: { plugin } });
    assert.eq(manifest.result.updated.experimentUid, null);
  });
  it("timeblock_update leaves experimentUid untouched when neither key is given", async () => {
    const vault = tmpVault();
    const exp = withExperiment(vault);
    const plugin = fakePlugin({ workspace: { timeblocks: [{ id: "t1", date: "2026-08-21", startTime: "09:00", endTime: "10:00", category: "experiment", title: "x", note: "", experimentUid: exp.uid }] } });
    const manifest = await registry.runAsync(vault, "workspace.timeblock_update", { id: "t1", title: "y" }, { dryRun: false, confirmed: true, live: { plugin } });
    assert.eq(manifest.result.updated.experimentUid, exp.uid);
    assert.eq(manifest.result.updated.title, "y");
  });
});

describe("workspace.timeblock_update execution backfill (2026-08-26)", () => {
  it("records execution_status/execution_note with a timestamp", async () => {
    const vault = tmpVault();
    const plugin = fakePlugin({ workspace: { timeblocks: [{ id: "t1", date: "2026-08-20", startTime: "09:00", endTime: "10:00", category: "experiment", title: "x", note: "" }] } });
    const manifest = await registry.runAsync(vault, "workspace.timeblock_update", { id: "t1", execution_status: "completed", execution_note: "顺利做完，产率约 62%" }, { dryRun: false, confirmed: true, live: { plugin } });
    assert.eq(manifest.result.updated.executionStatus, "completed");
    assert.eq(manifest.result.updated.executionNote, "顺利做完，产率约 62%");
    assert.ok(manifest.result.updated.executionRecordedAt, "must stamp when the backfill was recorded");
  });
  it("rejects an unknown execution_status", async () => {
    const vault = tmpVault();
    let threw = false;
    try { await registry.runAsync(vault, "workspace.timeblock_update", { id: "t1", execution_status: "maybe" }, { dryRun: true }); }
    catch (e) { threw = true; assert.match(e.message, /execution_status_required/); }
    assert.ok(threw);
  });
  it("rejects execution_note without execution_status", async () => {
    const vault = tmpVault();
    let threw = false;
    try { await registry.runAsync(vault, "workspace.timeblock_update", { id: "t1", execution_note: "只写了说明" }, { dryRun: true }); }
    catch (e) { threw = true; assert.match(e.message, /execution_status_required_with_execution_note/); }
    assert.ok(threw);
  });
  it("accepts blocked/not_completed with an empty execution_note", async () => {
    const vault = tmpVault();
    const plugin = fakePlugin({ workspace: { timeblocks: [{ id: "t1", date: "2026-08-20", startTime: "09:00", endTime: "10:00", category: "experiment", title: "x", note: "" }] } });
    const manifest = await registry.runAsync(vault, "workspace.timeblock_update", { id: "t1", execution_status: "blocked" }, { dryRun: false, confirmed: true, live: { plugin } });
    assert.eq(manifest.result.updated.executionStatus, "blocked");
    assert.eq(manifest.result.updated.executionNote, "");
  });
});

describe("workspace.get_state (L0, from disk)", () => {
  it("reads a section from data.json on disk", () => {
    const vault = tmpVault();
    const dir = path.join(vault, ".obsidian", "plugins", "obsidian-scholarium");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({ workspace: { timeblocks: [{ id: "t1", date: "2026-08-21", title: "HPLC" }] } }), "utf8");
    const manifest = registry.run(vault, "workspace.get_state", { section: "timeblocks" }, {});
    assert.eq(manifest.result.value.length, 1);
    assert.eq(manifest.result.value[0].title, "HPLC");
  });
  it("rejects an unknown section", () => {
    const vault = tmpVault();
    const dir = path.join(vault, ".obsidian", "plugins", "obsidian-scholarium");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({ workspace: {} }), "utf8");
    let threw = false;
    try { registry.run(vault, "workspace.get_state", { section: "bogus" }, {}); }
    catch (e) { threw = true; assert.match(e.message, /unknown_workspace_section/); }
    assert.ok(threw);
  });
});

describe("material.* actions", () => {
  it("material.add rejects path traversal", async () => {
    let threw = false;
    try { await registry.runAsync("/tmp", "material.add", { path: "../outside.pdf" }, { dryRun: true }); }
    catch (e) { threw = true; assert.match(e.message, /path_must_be_vault_relative/); }
    assert.ok(threw);
  });
  it("material.add rejects a file that does not exist in the vault", async () => {
    let threw = false;
    try { await registry.runAsync(tmpVault(), "material.add", { path: "nope/missing.pdf" }, { dryRun: true }); }
    catch (e) { threw = true; assert.match(e.message, /file_not_in_vault/); }
    assert.ok(threw);
  });
  it("material.add registers a real file and refuses duplicates", async () => {
    const vault = tmpVault();
    fs.writeFileSync(path.join(vault, "curve.csv"), "a,b\n1,2\n", "utf8");
    const plugin = fakePlugin({});
    const first = await registry.runAsync(vault, "material.add", { path: "curve.csv", category: "HPLC" }, { dryRun: false, confirmed: true, live: { plugin } });
    assert.eq(first.result.added.name, "curve");
    assert.eq(plugin.saved[0].materialLibrary.categories.includes("HPLC"), true);
    let threw = false;
    try { await registry.runAsync(vault, "material.add", { path: "curve.csv" }, { dryRun: false, confirmed: true, live: { plugin } }); }
    catch (e) { threw = true; assert.match(e.message, /material_already_registered/); }
    assert.ok(threw);
  });
  it("material.remove keeps the file on disk", async () => {
    const vault = tmpVault();
    fs.writeFileSync(path.join(vault, "curve.csv"), "a,b\n", "utf8");
    const plugin = fakePlugin({ materialLibrary: { items: [{ id: "m1", path: "curve.csv", name: "curve", category: "" }], categories: [] } });
    const manifest = await registry.runAsync(vault, "material.remove", { id: "m1" }, { dryRun: false, confirmed: true, live: { plugin } });
    assert.eq(manifest.result.file_kept, "curve.csv");
    assert.ok(fs.existsSync(path.join(vault, "curve.csv")), "the file itself must never be deleted");
  });
  it("material.category_remove deletes only an empty category", async () => {
    const plugin = fakePlugin({ materialLibrary: { items: [], categories: ["obsolete"] } });
    const manifest = await registry.runAsync(tmpVault(), "material.category_remove", { name: "obsolete" }, { dryRun: false, confirmed: true, live: { plugin } });
    assert.eq(manifest.result.removed, "obsolete");
    assert.eq(plugin.saved[0].materialLibrary.categories.length, 0);
  });
  it("material.category_remove refuses a category still used by a material", async () => {
    const plugin = fakePlugin({ materialLibrary: { items: [{ id: "m1", path: "curve.csv", name: "curve", category: "HPLC" }], categories: ["HPLC"] } });
    let threw = false;
    try { await registry.runAsync(tmpVault(), "material.category_remove", { name: "HPLC" }, { dryRun: false, confirmed: true, live: { plugin } }); }
    catch (e) { threw = true; assert.match(e.message, /material_category_in_use:HPLC/); }
    assert.ok(threw);
    assert.eq(plugin.saved.length, 0, "a refused removal must not persist a partial write");
  });
  it("material.category_remove dry-runs without a live plugin", async () => {
    const manifest = await registry.runAsync(tmpVault(), "material.category_remove", { name: "obsolete" }, { dryRun: true });
    assert.eq(manifest.result.would_remove, "obsolete");
  });
  it("material.list is L0 and reads from disk", () => {
    const vault = tmpVault();
    const dir = path.join(vault, ".obsidian", "plugins", "obsidian-scholarium");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "data.json"), JSON.stringify({ materialLibrary: { items: [{ id: "m1", path: "a.csv", name: "a", category: "HPLC" }], categories: ["HPLC"] } }), "utf8");
    const manifest = registry.run(vault, "material.list", {}, {});
    assert.eq(manifest.result.items.length, 1);
    assert.eq(manifest.result.categories[0], "HPLC");
  });
});

describe("rss.set_article_score / rss.mark_article", () => {
  function fakeRssBoard() {
    const board = {
      data: { feeds: [], articles: [{ id: "a1", title: "Paper One", relevance: { overallScore: 55, model: "deepseek" } }] },
      saved: 0,
      async save() { board.saved++; },
    };
    return board;
  }
  it("set_article_score writes an agent-override relevance and keeps the old score visible", async () => {
    const board = fakeRssBoard();
    const manifest = await registry.runAsync("/tmp", "rss.set_article_score", { article_id: "a1", overall_score: 88, reason: "与 LSPR CO2RR 主线直接相关" }, { dryRun: false, confirmed: true, live: { board } });
    assert.eq(manifest.result.score_before, 55);
    assert.eq(manifest.result.score_after, 88);
    const rel = board.data.articles[0].relevance;
    assert.eq(rel.overallScore, 88);
    assert.eq(rel.model, "agent-override");
    assert.eq(rel.basis, "manual_agent");
    assert.eq(board.saved, 1);
  });
  it("set_article_score refuses without a reason", async () => {
    let threw = false;
    try { await registry.runAsync("/tmp", "rss.set_article_score", { article_id: "a1", overall_score: 88 }, { dryRun: true }); }
    catch (e) { threw = true; assert.match(e.message, /reason_required/); }
    assert.ok(threw);
  });
  it("set_article_score refuses an out-of-range score", async () => {
    let threw = false;
    try { await registry.runAsync("/tmp", "rss.set_article_score", { article_id: "a1", overall_score: 120, reason: "x" }, { dryRun: true }); }
    catch (e) { threw = true; assert.match(e.message, /overall_score_required/); }
    assert.ok(threw);
  });
  it("mark_article flips read/starred and saves", async () => {
    const board = fakeRssBoard();
    const manifest = await registry.runAsync("/tmp", "rss.mark_article", { article_id: "a1", read: true, starred: true }, { dryRun: false, confirmed: true, live: { board } });
    assert.eq(manifest.result.read, true);
    assert.eq(manifest.result.starred, true);
    assert.eq(board.saved, 1);
  });
  it("mark_article requires at least one flag", async () => {
    let threw = false;
    try { await registry.runAsync("/tmp", "rss.mark_article", { article_id: "a1" }, { dryRun: true }); }
    catch (e) { threw = true; assert.match(e.message, /nothing_to_mark/); }
    assert.ok(threw);
  });
});

describe("experiment.append_note", () => {
  const PRJ = "019fef48-5be0-786b-8da5-39a220613712";
  it("appends a timestamped log entry without touching status", async () => {
    const vault = tmpVault();
    const X = require("../tools/experiment-store");
    // Create a real experiment via the same store the plugin uses.
    const created = X.saveNew(vault, { title: "AuNS 重复性", project_uid: PRJ, status: "running", data_origin: "planned", result: "", conclusion: "" });
    const uid = created.object.uid;
    const manifest = await registry.runAsync(vault, "experiment.append_note", { experiment_uid: uid, text: "第三批粒径分布偏宽，明天换 MOPS 浓度重试" }, { dryRun: false, confirmed: true });
    assert.eq(manifest.result.log_entries, 1);
    const entry = X.loadAll(vault).find((item) => item.object.uid === uid);
    const record = X.readRecord(vault, entry);
    assert.eq(record.object.status, "running");
    assert.eq(record.object.log.length, 1);
    assert.eq(record.object.log[0].by, "user"); // 直接调用时如实记录调用者；队列链路里会是 "agent:research-weaver"
    // Round-trip: the log survives a re-parse from markdown.
    assert.match(record.object.log[0].text, /MOPS/);
  });
  it("dry-run reports the would-be entry without writing", async () => {
    const vault = tmpVault();
    const X = require("../tools/experiment-store");
    const created = X.saveNew(vault, { title: "AuNS 重复性", project_uid: PRJ, status: "running", data_origin: "planned", result: "", conclusion: "" });
    const manifest = await registry.runAsync(vault, "experiment.append_note", { experiment_uid: created.object.uid, text: "观察" }, { dryRun: true });
    assert.eq(manifest.result.mode, "dry_run");
    const record = X.readRecord(vault, X.loadAll(vault)[0]);
    assert.ok(!record.object.log, "dry-run must not write a log field");
  });
  it("rejects an unknown experiment uid", async () => {
    const vault = tmpVault();
    let threw = false;
    try { await registry.runAsync(vault, "experiment.append_note", { experiment_uid: "00000000-0000-7000-8000-000000000000", text: "x" }, { dryRun: true }); }
    catch (e) { threw = true; assert.match(e.message, /experiment_not_found/); }
    assert.ok(threw);
  });
});
