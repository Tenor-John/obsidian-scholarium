"use strict";

const fs = require("fs");
const path = require("path");
const { describe, it, assert } = require("./harness");

const root = path.join(__dirname, "..", "docs", "examples");
const objects = fs
  .readdirSync(root)
  .filter((name) => name.endsWith(".json"))
  .map((name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8")));
const byUid = new Map(objects.map((object) => [object.uid, object]));
const prefix = {
  project: "PRJ",
  question: "Q",
  hypothesis: "HYP",
  paper: "PAPER",
  evidence: "EVD",
  experiment: "EXP",
};
const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function refs(object) {
  const scalar = ["project_uid", "source_uid", "target_uid", "next_test", "method_uid", "protocol_uid"];
  const arrays = ["active_hypothesis_uids", "related_hypotheses", "supporting_evidence", "contradicting_evidence", "tests_hypotheses", "produced_evidence", "projects"];
  return [
    ...scalar.filter((key) => object[key]).map((key) => object[key]),
    ...arrays.flatMap((key) => object[key] || []),
  ];
}

describe("Schema v1 examples", () => {
  it("contains one valid UUIDv7 object for each first-loop type", () => {
    assert.eq(objects.length, 6);
    assert.eq(byUid.size, objects.length, "uids must be globally unique");
    for (const object of objects) {
      assert.match(object.uid, uuidV7, object.type + " uid");
      assert.eq(object.schema_version, 1, object.type + " schema version");
      assert.eq(object.display_id.split("-")[0], prefix[object.type]);
      for (const key of ["created_at", "updated_at", "type"]) assert.ok(object[key]);
    }
  });

  it("resolves every formal relationship by uid", () => {
    for (const object of objects)
      for (const uid of refs(object)) assert.ok(byUid.has(uid), object.type + " reference " + uid);
  });

  it("enforces the first-loop state invariants", () => {
    const project = objects.find((object) => object.type === "project");
    const hypothesis = objects.find((object) => object.type === "hypothesis");
    const evidence = objects.find((object) => object.type === "evidence");
    const experiment = objects.find((object) => object.type === "experiment");
    assert.ok(project.title);
    assert.ok(project.active_hypothesis_uids.includes(hypothesis.uid));
    assert.ok(hypothesis.statement && hypothesis.confidence_set_by === "user");
    assert.ok(evidence.claim && evidence.verified_by_user === true);
    assert.ok(evidence.locator.source_sha256 && evidence.locator.anchor && evidence.locator.quote_hash && evidence.locator.original_url);
    assert.ok(experiment.conclusion);
    assert.ok(experiment.produced_evidence.length > 0);
  });

  it("keeps unverified evidence out of formal support and contradiction lists", () => {
    const unverified = objects.filter((object) => object.type === "evidence" && !object.verified_by_user).map((object) => object.uid);
    for (const hypothesis of objects.filter((object) => object.type === "hypothesis")) {
      const formal = [...(hypothesis.supporting_evidence || []), ...(hypothesis.contradicting_evidence || [])];
      for (const uid of unverified) assert.notOk(formal.includes(uid));
    }
  });
});
