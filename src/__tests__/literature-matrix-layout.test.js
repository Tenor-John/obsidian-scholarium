"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "rss-feed-board.ts"), "utf8");
const from = source.indexOf("    literatureMatrixFields() {");
const until = source.indexOf("    async refreshVaultPdfLibrary()", from);
const methods = vm.runInNewContext(`new (class {${source.slice(from, until)}})()`, {
  schLiteratureRoot: (plugin) => plugin.settings.literatureFolder,
  Ne: {},
});

test("fixed columns move to the front and return to their original order when unpinned", () => {
  const columns = [["title", "标题"], ["authors", "作者"], ["journal", "期刊"], ["year", "年份"]];
  assert.deepEqual(Array.from(methods.literatureMatrixColumnOrder(columns, ["期刊"])), [0, 2, 1, 3]);
  assert.deepEqual(Array.from(methods.literatureMatrixColumnOrder(columns, [])), [0, 1, 2, 3]);
  assert.deepEqual(Array.from(methods.literatureMatrixColumnOrder(columns, ["年份", "期刊"])), [0, 2, 3, 1]);
});

test("tags use stable category colors and display suffixes without changing stored tags", () => {
  const stored = ["#topic/photocatalysis", "journal/nature", "topic/solar-fuels", "source/web-clip", "year/2025", "custom/value", "plain", "topic/photocatalysis"];
  const before = [...stored];
  const tags = methods.literatureMatrixTags(stored);
  assert.equal(tags.length, 7);
  assert.equal(tags[0].category, "topic");
  assert.equal(tags[2].category, "topic");
  assert.equal(tags[1].category, "journal");
  assert.equal(tags[0].label, "photocatalysis");
  assert.equal(tags[5].category, "other");
  assert.equal(tags[6].label, "plain");
  assert.deepEqual(stored, before);
  const elements = [];
  methods.renderLiteratureMatrixTags({ createEl: (tag, options) => elements.push(options) }, "topic/acid-hydrolysis; journal/test; topic/path/subtopic");
  assert.equal(elements[0].cls, "sch-matrix-tag sch-matrix-tag-topic");
  assert.equal(elements[1].cls, "sch-matrix-tag sch-matrix-tag-journal");
  assert.equal(elements[2].text, "path/subtopic");
  assert.equal(elements[0].attr.title, "topic/acid-hydrolysis");
  let empty = "";
  methods.renderLiteratureMatrixTags({ setText: (value) => { empty = value; } }, "");
  assert.equal(empty, "—");
});

test("adding a classified tag preserves metadata, deduplicates and persists to the source note", async () => {
  const record = { path: "literature/paper.md", tags: "source/web-clip; topic/catalysis", note_paths: [] };
  const fm = { tags: ["journal/nature"], title: "Paper", reading_status: "在读" };
  const file = { path: record.path };
  const board = Object.create(methods);
  board.app = { vault: { getAbstractFileByPath: () => file }, fileManager: { processFrontMatter: async (_, update) => update(fm) } };
  board.literatureMatrixRecord = () => record;
  board.save = async () => {};
  board.rerender = () => {};
  assert.equal(await board.addLiteratureMatrixTag(record, "TOPIC", "visible light"), "topic/visible-light");
  assert.deepEqual(Array.from(fm.tags), ["journal/nature", "source/web-clip", "topic/catalysis", "topic/visible-light"]);
  await board.addLiteratureMatrixTag(record, "topic", "visible-light");
  assert.equal(fm.tags.length, 4);
  assert.equal(fm.title, "Paper");
  assert.equal(fm.reading_status, "在读");
  assert.throws(() => board.literatureMatrixTagValue("", "x"), /类别/);
  assert.throws(() => board.literatureMatrixTagValue("topic", "bad;tag"), /标签内容/);
  assert.equal(board.literatureMatrixTagValue("method", "光催化/产氢"), "method/光催化/产氢");
});

test("PDF tags persist in a linked metadata note without modifying the PDF", async () => {
  const record = { path: "literature/paper.pdf", pdf_path: "literature/paper.pdf", title: "Paper", tags: "year/2025", note_paths: [] };
  const board = Object.create(methods);
  let created;
  const fm = {};
  board.plugin = { settings: { literatureFolder: "literature" } };
  board.app = { vault: { getAbstractFileByPath: () => null, create: async (target, content) => { created = { path: target, content }; return created; } }, fileManager: { processFrontMatter: async (_, update) => update(fm) } };
  board.ensureLiteratureMatrixFolder = async () => {};
  board.literatureMatrixRecord = () => record;
  board.save = async () => {}; board.rerender = () => {};
  // Supply only the Node hash API used for deterministic metadata-note naming.
  const originalWindow = { require };
  const sourceMethod = source.slice(source.indexOf("    async addLiteratureMatrixTag("), source.indexOf("    openLiteratureMatrixTagEditor("));
  const writer = vm.runInNewContext(`new (class {${sourceMethod}})()`, { window: originalWindow, schLiteratureRoot: () => "literature" });
  const add = writer.addLiteratureMatrixTag.bind(board);
  await add(record, "topic", "photocatalysis");
  assert.match(created.path, /^literature\/tag-notes\/.+\.md$/);
  assert.match(created.content, /fulltext_path: "literature\/paper.pdf"/);
  assert.deepEqual(Array.from(fm.tags), ["year/2025", "topic/photocatalysis"]);
  assert.equal(record.note_paths[0], created.path);
});

test("library discovery respects the configured root and excludes unrelated markdown", () => {
  const board = Object.assign(methods, { plugin: { settings: { literatureFolder: "Papers/Library" } } });
  assert.equal(board.isLiteratureMatrixNote({ path: "Papers/Library/Sub/a.md" }), true);
  assert.equal(board.isLiteratureMatrixNote({ path: "Papers/Library-old/a.md" }), false);
  assert.equal(board.isLiteratureMatrixNote({ path: "literature/a.md" }), false);
  assert.equal(board.isLiteratureMatrixDocument({ basename: "scratch" }, { type: "experiment" }, { doi: "" }), false);
  assert.equal(board.isLiteratureMatrixDocument({ basename: "scratch" }, { type: "experiment" }, { doi: "10.1/example" }), false);
  assert.equal(board.isLiteratureMatrixDocument({ basename: "a" }, { type: "literature_fulltext" }, { doi: "" }), true);
  assert.equal(board.isLiteratureMatrixDocument({ basename: "a-文献总结" }, {}, { doi: "" }), true);
});

test("matrix values are extracted from the summary note's metadata", () => {
  const values = Object.fromEntries(methods.literatureMatrixFields().map((field) => [field, `内容-${field}`]));
  const meta = methods.literatureMatrixMetadata({ basename: "paper-文献总结" }, "# Summary", { type: "literature-summary", matrix_fields: values });
  for (const field of methods.literatureMatrixFields()) assert.equal(meta.ai[field], values[field]);
  const preferred = methods.literatureMatrixMetadata({ basename: "paper" }, "", { 研究背景: "旧的长字段", matrix_fields: { 研究背景: "新的短要点" } });
  assert.equal(preferred.ai["研究背景"], "新的短要点");
  const withoutMetadata = methods.literatureMatrixMetadata({ basename: "paper" }, "## 研究背景\n\n这段正文不是 metadata", {});
  assert.equal(withoutMetadata.ai["研究背景"], "");
  const dedicated = methods.literatureMatrixMetadata({ basename: "paper" }, "## 研究背景\n\n正文内容\n\n## 文献矩阵 metadata\n\n研究背景:: 简短要点\n\n研究结论:: 不同的结论", {});
  assert.equal(dedicated.ai["研究背景"], "简短要点");
  assert.equal(dedicated.ai["研究结论"], "不同的结论");
  const dataview = methods.literatureMatrixMetadata({ basename: "paper" }, "## 专区：便于 Obsidian Dataview 插件调用\n\n研究背景:: 参考格式要点\n", {});
  assert.equal(dataview.ai["研究背景"], "参考格式要点");
});

test("manual summary templates expose edited sections to the matrix", () => {
  const file = { path: "literature/summary-notes/paper.md", basename: "paper" };
  const text = "---\ntype: literature-summary\ngenerator: manual\n---\n\n## 研究背景\n\n手写背景第一行\n第二行\n\n## 研究结论\n\n手写结论\n";
  const fm = { type: "literature-summary", generator: "manual" };
  assert.equal(methods.isManualLiteratureSummary(file, text, fm), true);
  const meta = methods.literatureMatrixMetadata(file, text, fm, methods.isManualLiteratureSummary(file, text, fm));
  assert.equal(meta.ai["研究背景"], "手写背景第一行\n第二行");
  assert.equal(meta.ai["研究结论"], "手写结论");
  assert.equal(methods.isManualLiteratureSummary(file, "", {}), true);
  assert.equal(methods.isManualLiteratureSummary(file, "", { matrix_fields: {} }), false);
});

test("matrix preview stays brief without modifying stored metadata, and export remains traceable", () => {
  const full = "论".repeat(180);
  assert.equal(Array.from(methods.literatureMatrixPreview(full)).length, 121);
  const row = { title: "Paper | A", doi: "10.1/a", path: "literature/a.md", summary_path: "literature/a-summary.md", ai: { 研究背景: full } };
  const output = methods.literatureMatrixExportMarkdown([row]);
  assert.match(output, /Paper \\?\| A/);
  assert.match(output, /10\.1\/a/);
  assert.match(output, /literature\/a-summary\.md/);
  assert.equal(row.ai["研究背景"], full);
});

test("duplicate summary values are rejected, while shared missing-information markers are allowed", () => {
  const fields = Object.fromEntries(methods.literatureMatrixFields().map((field) => [field, `不同的${field}`]));
  methods.validateLiteratureMatrixDistinct(fields);
  fields["研究背景"] = fields["领域基础知识"] + "。";
  assert.throws(() => methods.validateLiteratureMatrixDistinct(fields), /总结字段内容重复/);
  fields["研究背景"] = "原文未说明";
  fields["领域基础知识"] = "原文未说明。";
  assert.doesNotThrow(() => methods.validateLiteratureMatrixDistinct(fields));
});

test("selection survives merging and drops stale entries without selecting ambiguous papers", () => {
  const start = source.indexOf("    reconcileLiteratureMatrixSelection(");
  const end = source.indexOf("    literatureMatrixRecord(", start);
  assert.ok(start >= 0 && end > start);
  const selection = vm.runInNewContext(`new (class {${source.slice(start, end)}})()`).reconcileLiteratureMatrixSelection;
  const old = { oldPath: { path: "oldPath", doi: "10.1/one", note_paths: ["note.md"] }, stale: { path: "stale", doi: "10.1/missing" } };
  const current = { newPath: { path: "newPath", doi: "10.1/one", note_paths: ["note.md"] }, existing: { path: "existing" } };
  const result = selection(["oldPath", "stale", "existing"], old, current);
  assert.deepEqual(Array.from(result.ids), ["newPath", "existing"]);
  assert.deepEqual(Array.from(result.dropped), ["stale"]);
  assert.equal(result.remap.oldPath, "newPath");
  current.duplicate = { path: "duplicate", doi: "10.1/one", note_paths: ["note.md"] };
  assert.deepEqual(Array.from(selection(["oldPath"], old, current).dropped), ["oldPath"]);
});

test("captured summaries write all matrix fields into the summary itself", async () => {
  const start = source.indexOf("    async saveSummaryNote(t, e, s, i) {");
  const end = source.indexOf("    async clipAndSummarize(", start);
  assert.ok(start >= 0 && end > start);
  const writer = vm.runInNewContext(`new (class {${source.slice(start, end)}})()`, { je: (value) => Array.isArray(value) ? value : [], Date, JSON });
  const saveSummary = writer.saveSummaryNote.bind(writer);
  let written = null;
  Object.setPrototypeOf(writer, Object.getPrototypeOf(methods));
  writer.parseSummaryVocab = (text) => ({ body: text, methods: [], materials: [], topics: [] });
  writer.buildClipTags = () => [];
  writer.app = { vault: { getAbstractFileByPath: () => null, create: async (target, content) => { written = { target, content }; return written; } } };
  const fields = methods.literatureMatrixFields();
  const summary = fields.map((field) => `## ${field}\n\n内容-${field}`).join("\n\n");
  await saveSummary({ folder: "Papers", base: "article", meta: {} }, { title: "article" }, "https://example.org", summary);
  assert.equal(written.target, "Papers/article-文献总结.md");
  const line = written.content.split("\n").find((value) => value.startsWith("matrix_fields: "));
  const matrix = JSON.parse(line.slice("matrix_fields: ".length));
  for (const field of fields) assert.equal(matrix[field], `内容-${field}`);
  written = null;
  await assert.rejects(saveSummary({ folder: "Papers", base: "article", meta: {} }, { title: "article" }, "", "## 研究背景\n\n只有一项"), /缺少文献矩阵字段/);
  assert.equal(written, null);
});

test("the pinned native Weaver embed receives the same-file matrix instruction", () => {
  const root = path.join(__dirname, "..", "..");
  const embed = require(path.join(root, "tools", "embed-native-weaver.js"));
  const bundle = fs.readFileSync(path.join(root, "vendor", "native-weaver", "scholarium-weaver-native.js"), "utf8");
  const sourceInfo = JSON.parse(fs.readFileSync(path.join(root, "vendor", "native-weaver", "SOURCE.json"), "utf8"));
  const result = embed.buildJsBlock({ source: sourceInfo, bundle }, "");
  assert.match(result, /literature-prompt-patch=1/);
  assert.match(result, /不得把这些 metadata 另存为独立文档/);
  assert.throws(() => embed.buildJsBlock({ source: sourceInfo, bundle: bundle.replace("12. 研究员要求把具体安排”写入工作台”", "removed anchor") }, ""), /锚点变化/);
});
