"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("matrix jobs run up to three AI requests concurrently and track each paper", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "rss-feed-board.ts"), "utf8");
  const start = source.indexOf("    literatureMatrixItem(id) {");
  const end = source.indexOf("    renderLiteratureMatrixJobs(box) {", start);
  const board = vm.runInNewContext(`new (class {${source.slice(start, end)}})()`, { Promise, Object, Set, schLiteratureRoot: () => "literature", Ne: { Notice: function () {} }, window: { require: () => ({ randomUUID: () => "job" }) } });
  const records = Object.fromEntries(["a", "b", "c", "d", "e"].map((id) => [id, { path: id, title: id, ai: {} }]));
  const state = { records, jobs: [] };
  const progress = {};
  Object.assign(board, {
    plugin: { settings: { literatureFolder: "literature" } },
    vaultPdfLibraryState: () => state,
    literatureMatrixJobs: () => state.jobs,
    reconcileLiteratureMatrixSelection: (ids) => ({ ids, dropped: [] }),
    literatureMatrixRecord: (id) => records[id],
    literatureMatrixFields: () => ["field"],
    save: async () => {}, rerender: () => { for (const job of state.jobs) for (const [id, item] of Object.entries(job.items || {})) { (progress[id] ||= []).push(item.progress || 0); } }, refreshVaultPdfLibrary: async () => {},
    readLiteratureMatrixSource: async (record) => ({ path: record.path, text: "text", basis: "fulltext" }),
    generateLiteratureMatrixDeepSummary: async () => ({ body: "deep" }),
    writeLiteratureMatrixAi: async (record) => ({ path: record.path + "-summary" }),
  });
  let active = 0, max = 0;
  const release = [];
  board.generateLiteratureMatrixAi = async () => {
    active++; max = Math.max(max, active);
    await new Promise((resolve) => release.push(resolve));
    active--; return { fields: { field: "summary" } };
  };
  await board.startLiteratureMatrixJob({ ids: Object.keys(records), force: true });
  const job = state.jobs[0];
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(active, 3);
  assert.equal(job.items.d.status, "queued");
  await assert.rejects(board.startLiteratureMatrixJob({ ids: ["a"], force: true }), /正在运行或排队/);
  while (job.status === "running") {
    for (const done of release.splice(0)) done();
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(max, 3);
  assert.equal(job.results.length, 5);
  assert.ok(Object.values(job.items).every((item) => item.status === "completed"));
  for (const values of Object.values(progress)) {
    assert.equal(values.at(-1), 100);
    assert.ok(values.every((value, index) => index === 0 || value >= values[index - 1]));
  }
});
