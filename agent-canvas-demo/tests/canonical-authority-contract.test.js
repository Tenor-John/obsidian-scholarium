"use strict";

// Stage B contract tests. Intentionally red until the canonical authority
// implementation lands on this isolated branch.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ProjectCore = require("../project-mode-core.js");
const IdeaCore = require("../idea-mode-core.js");
const Schema = require("../../tools/schema-objects.js");

const PROJECT = {
  uid: "01927d3f-8a41-7c62-b5e0-9f3a2c1d4e5b",
  display_id: "PRJ-001",
  schema_version: 1,
  type: "project",
  created_at: "2026-09-10T00:00:00.000Z",
  updated_at: "2026-09-10T00:00:00.000Z",
  title: "contract fixture",
  status: "active",
};

test("Project-mode AI Experiment does not claim researcher provenance", () => {
  let n = 10;
  const built = ProjectCore.buildProjectDrafts({
    project: PROJECT,
    parsed: {
      summary: "fixture",
      evidence_gaps: [],
      hypotheses: [{ statement: "界面改变选择性", predicts: "选择性改变", falsified_if: "受控后不变", assumptions: [], alternative_explanations: [], required_tests: [] }],
      experiments: [{ title: "结构对照", hypothesis_indexes: [0], independent_variables: [], dependent_variables: [], controlled_variables: [], replicates: "n=3", procedure_outline: [], estimated_hours: 4, blocked_by: [] }],
      week_plan: [],
    },
    at: "2026-09-10T00:00:00.000Z",
    uidFn: () => Schema.uuidV7(n++),
  });
  const expItem = built.items.find((item) => item.path.includes("/Experiments/"));
  const exp = Schema.parseObject(expItem.content).object;
  assert.equal(exp.created_by, "ai");
  assert.equal(exp.data_origin, undefined);
  assert.equal(exp.data_recorded_by, undefined);
  assert.equal(exp.data_recorded_at, undefined);
});

test("Idea-mode production defaults produce validator-clean IDEA/Q/HYP objects", () => {
  const card = IdeaCore.buildIdeaCard({ topic: "界面催化", summary: "fixture", records: [] });
  const notes = IdeaCore.buildIdeaNotes({
    topic: "界面催化",
    summary: "fixture",
    questions: [{ statement: "结构如何影响选择性？", note: "fixture" }],
    hypotheses: [{ statement: "界面结构提高选择性", note: "fixture" }],
    records: [],
    projectUid: PROJECT.uid,
  });
  for (const item of [card, ...notes]) {
    const parsed = Schema.parseObject(item.content);
    assert.deepEqual(Schema.validateObject(parsed.object), [], `${item.path} is not schema-valid`);
  }
});

for (const relative of ["project-mode.js", "idea-mode.js", "seed-reconstruction-ui.js"]) {
  test(`${relative} cannot opt out of Bridge-managed Vault metadata`, () => {
    const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
    const call = source.match(/bridgeFetch\('\/v1\/drafts\/batch'[\s\S]{0,900}?serverManagedMetadata\s*:\s*true/);
    assert.ok(call, "expected a Bridge-managed Vault schema batch call");
  });
}

test("Bridge-offline handling has no legacy direct-write fallback", () => {
  for (const relative of ["project-mode.js", "idea-mode.js", "seed-reconstruction-ui.js"]) {
    const source = fs.readFileSync(path.join(__dirname, "..", relative), "utf8");
    assert.doesNotMatch(source, /createExperimentFromAgent|plugin\.app\.vault|vault\.create|fs\.writeFile/,
      `${relative} contains a direct-write fallback`);
    assert.match(source, /catch\s*\(error\)/, `${relative} does not surface Bridge rejection`);
  }
  const ideaSource = fs.readFileSync(path.join(__dirname, "..", "idea-mode.js"), "utf8");
  assert.match(ideaSource, /表单内容已保留/);
  assert.match(ideaSource, /预览被拒绝/);
});
