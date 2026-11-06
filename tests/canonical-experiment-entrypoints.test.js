"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const { block } = require("./harness");

test("[L1] all AI/image Experiment creation crosses the canonical adapter", () => {
  const method = block("createExperimentFromAgent(e, s) {");
  const split = method.indexOf('if (e.noteType !== "research-learning")');
  assert.notEqual(split, -1, "missing research-learning branch");
  const write = 'return this.app.vault.create(prepared.path, prepared.content);';
  const end = method.indexOf(write, split);
  assert.notEqual(end, -1, "canonical branch must return the prepared schema-v1 write");
  const canonical = method.slice(split, end + write.length);
  assert.match(canonical, /legacyExperiments\.resolveProject/);
  assert.match(canonical, /legacyExperiments\.adaptLegacyExperiment/);
  assert.match(canonical, /experiments\.prepareNew/);
  assert.match(main, /adaptLegacyExperiment\(data, \{\s*project,\s*titleSuggestion\s*\}\)/);
  assert.doesNotMatch(canonical, /experimentsFolder|uniqueMarkdownPath|type: experiment/);
});

test("[L1] green Experiment actions open the schema-v1 creator", () => {
  assert.match(main, /callback:\s*\(\)\s*=>\s*schOpenExperimentCreator\(this\)/);
  const dashboard = block("renderExperimentDashboard(e, s) {");
  assert.match(dashboard, /新建实验[\s\S]*?schOpenExperimentCreator\(this\.plugin\)/);
});
