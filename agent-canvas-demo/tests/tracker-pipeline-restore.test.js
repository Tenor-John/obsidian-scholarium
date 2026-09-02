"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ui = fs.readFileSync(path.join(__dirname, "..", "bridge-ui.js"), "utf8");

test("tracker reopens the newest interrupted pipeline after iframe boot", () => {
  assert.match(ui, /const history = await loadRunHistory\(\)/);
  assert.match(ui, /await restoreLatestPipelineRun\(history\)/);
  assert.match(ui, /run\.status === 'running' \|\| run\.status === 'interrupted'/);
  assert.match(ui, /await openHistoryPipeline\(candidate\.id, \{ automaticRestore: true \}\)/);
});

test("restored tracker explains interruption and exposes exact progress", () => {
  assert.match(ui, /Pipeline 已中断 · 已恢复进度/);
  assert.match(ui, /已恢复 .*个步骤状态/);
  assert.match(ui, /切换页面时旧版宿主卸载了织研者工作区/);
  assert.match(ui, /从已下载 PDF 继续/);
});

