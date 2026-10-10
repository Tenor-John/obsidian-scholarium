"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const schema = require("../../tools/schema-objects.js");
const experiments = require("../../tools/experiment-store.js");
const { buildIndex } = require("../skills/experiment-record/scripts/validate_experiments.js");

function seedProject(vault) {
  const object = schema.createObject("project", { title: "测试课题", status: "active" });
  const target = path.join(vault, "Research", "Projects", `${object.display_id} 测试课题.md`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, schema.serializeObject(object, ""), "utf8");
  return object.uid;
}

test("experiment-record indexes only canonical Research Experiments and reports root Experiments as legacy", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-experiment-index-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const projectUid = seedProject(vault);
  experiments.saveNew(vault, {
    title: "正式实验", project_uid: projectUid, status: "designed",
  });
  const legacy = path.join(vault, "Experiments", "2026-09-08-old.md");
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.writeFileSync(legacy, "---\ntype: experiment\nstatus: in-progress\n---\nlegacy", "utf8");

  const report = buildIndex(vault);
  assert.equal(report.count, 1);
  assert.equal(report.experiments[0].display_id, "EXP-001");
  assert.deepEqual(report.experiments[0].errors, []);
  assert.deepEqual(report.experiments[0].warnings, []);
  assert.equal(report.legacy.count, 1);
  assert.equal(report.legacy.files[0], "Experiments/2026-09-08-old.md");
  assert.equal(report.valid, true);
});

test("a free-form canonical Experiment body is a warning, never a schema error", (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "canonical-experiment-body-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));
  const object = schema.createObject("experiment", {
    title: "自由正文", project_uid: seedProject(vault), status: "designed",
  });
  const target = path.join(vault, "Research", "Experiments", "EXP-001 自由正文.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, schema.serializeObject(object, "# 我自己的模板\n\n任何正文都可以。"), "utf8");

  const report = buildIndex(vault);
  assert.equal(report.valid, true);
  assert.deepEqual(report.experiments[0].errors, []);
  assert.match(report.experiments[0].warnings[0], /旧版\/自由格式/);
});
