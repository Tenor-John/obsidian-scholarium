"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const shell = fs.readFileSync(path.join(__dirname, "..", "shell-ui.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "weaver-ui.css"), "utf8");

test("Pipeline summary can be collapsed and reopened without stopping the run", () => {
  assert.match(shell, /RUN_SUMMARY_COLLAPSED_KEY/);
  assert.match(shell, /localStorage\.getItem\(RUN_SUMMARY_COLLAPSED_KEY\) === '1'/);
  assert.match(shell, /setRunSummaryCollapsed\(true\)/);
  assert.match(shell, /setRunSummaryCollapsed\(false\)/);
  assert.match(shell, /收起 Pipeline 进度卡（不会停止任务）/);
  assert.match(shell, /显示 Pipeline 进度/);
  assert.match(shell, /localStorage\.setItem\(RUN_SUMMARY_COLLAPSED_KEY/);
});
test("collapsed summary leaves a visible, accessible reopen control", () => {
  assert.match(shell, /className = 'wv-run-summary-reopen'/);
  assert.match(shell, /aria-label', '重新显示 Pipeline 进度卡'/);
  assert.match(shell, /aria-expanded', 'false'/);
  assert.match(shell, /aria-expanded', 'true'/);
  assert.match(css, /\.wv-run-summary\.is-collapsed/);
  assert.match(css, /\.wv-run-summary-reopen:focus-visible/);
  assert.match(css, /\.wv-run-summary-toggle:focus-visible/);
});
