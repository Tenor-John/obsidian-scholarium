"use strict";

const { describe, it, assert } = require("./harness");
const adapter = require("../tools/legacy-experiment-adapter.js");

const project = { uid: "018f5c2a-7b3d-7abc-8def-1234567890ab", display_id: "PRJ-007" };

describe("legacy Experiment creation -> canonical schema-v1 draft", () => {
  it("requires an explicit Project when more than one exists", () => {
    let error = null;
    try { adapter.resolveProject([{ object: project }, { object: { ...project, display_id: "PRJ-008" } }], ""); }
    catch (caught) { error = caught; }
    assert.eq(Boolean(error), true);
    assert.eq(error.message.includes("明确选择"), true);
  });

  it("resolves a Project by display id and never fabricates a uid", () => {
    const hit = adapter.resolveProject([{ object: project }], "prj-007");
    assert.eq(hit.uid, project.uid);
  });

  it("keeps planned input planned and preserves the protocol as readable Markdown", () => {
    const fields = adapter.adaptLegacyExperiment({
      title: "Dark control", objective: "Measure baseline", steps: ["Prepare sample", "Measure"], reagents: ["Au", "TiO2"],
    }, { project });
    assert.eq(fields.status, "designed");
    assert.eq(fields.data_origin, "planned");
    assert.eq(fields.plan.includes("### 实验步骤"), true);
    assert.eq(fields.plan.includes("1. Prepare sample"), true);
  });

  it("does not let AI/image results claim measured or imported provenance", () => {
    const fields = adapter.adaptLegacyExperiment({
      title: "TEM import", results: "Particle size 8 nm", observations: "Agglomeration visible", source_image: "Materials/tem.tif",
    }, { project });
    assert.eq(fields.status, "analyzing");
    assert.eq(fields.data_origin, "unknown");
    assert.deepEq(fields.raw_data_refs, ["Materials/tem.tif"]);
    assert.eq(fields.result.includes("### 结果"), true);
    assert.eq(fields.result.includes("### 观察与现象"), true);
    assert.eq(fields.data_provenance_note.includes("不得作为正式 Evidence"), true);
  });
});
