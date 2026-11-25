"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "rss-feed-board.ts"), "utf8");
const fieldsStart = source.indexOf("    literatureMatrixFields() {");
const fieldsEnd = source.indexOf("    literatureMatrixColumnOrder(", fieldsStart);
const methodsStart = source.indexOf("    parseLiteratureMatrixAi(text) {");
const methodsEnd = source.indexOf("    async submitLiteratureMatrixAi(", methodsStart);
assert.ok(fieldsStart >= 0 && fieldsEnd > fieldsStart && methodsStart >= 0 && methodsEnd > methodsStart);
const headings = ["总体深度解读", "研究目标与问题重要性", "新思路、方法、模型与框架", "实验设计与关键结果", "学术价值与应用意义", "局限与批判性分析", "学习启发与未来方向"];
const body = headings.map((heading) => `## ${heading}\n\n这是对应章节的分析。`).join("\n\n");
let modelResponse = body + "\n\n<!-- SCHOLARIUM_SUMMARY_COMPLETE -->";
const context = {
  window: { require },
  Sl: async () => modelResponse,
  schLiteratureRoot: () => "literature",
  Date, JSON, Map, Set, Promise,
};
const board = vm.runInNewContext(`new (class {${source.slice(fieldsStart, fieldsEnd)}\n${source.slice(methodsStart, methodsEnd)}})()`, context);
board.plugin = {};
board.buildWriterSettings = () => ({ apiKey: "test" });
board.isLiteratureMatrixPath = (value) => value.startsWith("literature/");
board.literatureMatrixStem = () => "2019-Paper";
board.literatureMatrixLabel = () => "2019-Paper";
board.ensureLiteratureMatrixFolder = async () => {};
board.save = async () => {};
let written;
board.app = { vault: { create: async (target, content) => { written = { target, content }; } } };
const record = { path: "literature/Subscriptions/paper/paper.md", note_paths: [], title: "Paper", year: "2019", doi: "10.1/example" };
const material = { path: record.path, text: "全文内容", basis: "fulltext" };
const fields = Object.fromEntries(board.literatureMatrixFields().map((field) => [field, `该列-${field}`]));

test("writes the deep summary and distinct matrix metadata into one note next to the article", async () => {
  const deep = await board.generateLiteratureMatrixDeepSummary(record, material);
  assert.equal(deep.body, body);
  await board.writeLiteratureMatrixAi(record, fields, material, { summary_markdown: deep.body });
  assert.match(written.target, /^literature\/Subscriptions\/paper\/paper-文献总结--/);
  assert.match(written.content, /^---\n/);
  const metadata = JSON.parse(written.content.split("\n").find((line) => line.startsWith("matrix_fields: ")).slice("matrix_fields: ".length));
  for (const field of board.literatureMatrixFields()) assert.equal(metadata[field], fields[field]);
  for (const heading of headings) assert.ok(written.content.includes(`## ${heading}`));
  const metadataStart = written.content.indexOf("## 文献矩阵 metadata");
  assert.ok(metadataStart > written.content.indexOf("## 学习启发与未来方向"));
  for (const field of board.literatureMatrixFields()) assert.ok(written.content.slice(metadataStart).includes(field + ":: " + fields[field]));
  assert.doesNotMatch(written.content, /SCHOLARIUM_SUMMARY_COMPLETE/);
});

test("refuses an incomplete summary before writing", async () => {
  written = null;
  modelResponse = body.slice(0, 50);
  await assert.rejects(board.generateLiteratureMatrixDeepSummary(record, material), /没有完整结束标记/);
  assert.equal(written, null);
  await assert.rejects(board.writeLiteratureMatrixAi(record, fields, material), /缺少完整的深度总结正文/);
  assert.equal(written, null);
});
