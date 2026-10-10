"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");

function between(source, begin, end) {
  const start = source.indexOf(begin);
  const finish = source.indexOf(end, start + begin.length);
  assert.notEqual(start, -1, `missing ${begin}`);
  assert.notEqual(finish, -1, `missing ${end}`);
  return source.slice(start, finish);
}

test("[L1] all AI/image Experiment creation crosses the canonical adapter", () => {
  const method = between(main, "async createExperimentFromAgent(e, s)", "renderImageLinks(e)");
  const canonical = between(method, 'if (e.noteType !== "research-learning")', "let i =");
  assert.match(canonical, /legacyExperiments\.resolveProject/);
  assert.match(canonical, /legacyExperiments\.adaptLegacyExperiment/);
  assert.match(canonical, /experiments\.prepareNew/);
  assert.match(canonical, /this\.app\.vault\.create\(prepared\.path, prepared\.content\)/);
  assert.doesNotMatch(canonical, /experimentsFolder|uniqueMarkdownPath|type: experiment/);
});

test("[L1] green Experiment actions open the schema-v1 creator", () => {
  const count = [...main.matchAll(/schOpenExperimentCreator\(this\.plugin\)/g)].length;
  assert.ok(count >= 2, `expected both green entry points to use canonical creator, got ${count}`);
  const dashboard = between(main, "async renderExperimentDashboard(e, s)", "renderBoardStat(e, s, i)");
  assert.match(dashboard, /\\u65B0\\u5EFA\\u5B9E\\u9A8C[\s\S]*?schOpenExperimentCreator\(this\.plugin\)/);
});
