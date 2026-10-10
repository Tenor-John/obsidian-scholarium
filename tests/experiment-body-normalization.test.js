"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const S = require("../tools/schema-objects");
const N = require("../tools/normalize-experiment-bodies");

const NOW = "2026-09-09T00:00:00.000Z";
const PRJ = "01a081d2-0000-7000-8000-000000000001";

function fixture(body, fields = {}) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "sch-normalize-"));
  const object = S.createObject("experiment", {
    title: "planned test", project_uid: PRJ, status: "designed", result: "", conclusion: "", produced_evidence: [], ...fields,
  }, { now: NOW, uid: "01a081d2-0000-7000-8000-000000000002", display_id: "EXP-003" });
  const file = path.join(vault, "Research", "Experiments", "EXP-003 planned test.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, S.serializeObject(object, body), "utf8");
  return { vault, file };
}

describe("canonical Experiment body normalization", () => {
  it("removes a planned protocol from the Evidence result surface", () => {
    const f = fixture("# old\n\n## 目的\n\nOnly a plan; no data.\n");
    const item = N.buildPlan(f.vault).items[0];
    assert.eq(item.action, "normalize");
    assert.eq(item.reason, "remove_false_planned_result_blocks");
    assert.eq(item.new_result_blocks.length, 0);
  });

  it("blocks a rewrite that would change an existing result block", () => {
    const f = fixture("# old\n\n## 结果\n\nobserved A\n", {
      status: "concluded", result: "observed B", conclusion: "B differs",
      data_origin: "simulated", data_recorded_by: "user", data_recorded_at: NOW,
      data_provenance_note: "workflow simulation",
    });
    const item = N.buildPlan(f.vault).items[0];
    assert.eq(item.action, "blocked");
    assert.eq(item.reason, "result_blocks_would_change");
  });

  it("requires an external backup and writes a hash manifest", () => {
    const f = fixture("# old\n\n## 目的\n\nOnly a plan; no data.\n");
    const plan = N.buildPlan(f.vault);
    let message = "";
    try { N.execute(plan, path.join(f.vault, "backup")); } catch (error) { message = error.message; }
    assert.match(message, /Vault 外部/);
    const backup = fs.mkdtempSync(path.join(os.tmpdir(), "sch-normalize-backup-"));
    const result = N.execute(plan, backup);
    assert.deepEq(result.changed_paths, ["Research/Experiments/EXP-003 planned test.md"]);
    assert.match(fs.readFileSync(f.file, "utf8"), /scholarium-experiment-template:v1/);
    assert.ok(fs.existsSync(path.join(backup, "normalization-manifest.json")));
  });
});
