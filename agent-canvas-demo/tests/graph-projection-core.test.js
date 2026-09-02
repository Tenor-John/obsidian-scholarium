"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../graph-projection-core.js");

const PROJECT = { uid: "01927d3f-8a41-7c62-b5e0-9f3a2c1d4e5b", display_id: "PRJ-002", title: "test project" };

function exp(overrides = {}) {
  return {
    uid: "01a01f00-0000-7000-8000-000000000001", display_id: "EXP-001", project_uid: PROJECT.uid,
    title: "AuBiVO4Pt 对比实验", status: "concluded", result: "", conclusion: "",
    path: "Research/Experiments/EXP-001 AuBiVO4Pt对比实验.md",
    ...overrides,
  };
}

test("an experiment with no result/conclusion only produces an execution node", () => {
  const { nodes, edges } = Core.buildProjectGraphProjection({ project: PROJECT, experiments: [exp({ status: "designed" })] });
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0].type, "execution");
  assert.equal(edges.length, 0);
});

test("a non-empty result adds an observation node and a measured_by edge, missing conclusion adds nothing else", () => {
  const { nodes, edges } = Core.buildProjectGraphProjection({
    project: PROJECT, experiments: [exp({ status: "running", result: "H2 evolution rate increased with shell thickness up to 18nm." })],
  });
  assert.equal(nodes.filter((n) => n.type === "execution").length, 1);
  assert.equal(nodes.filter((n) => n.type === "observation").length, 1);
  assert.equal(nodes.filter((n) => n.type === "claim").length, 0);
  assert.equal(edges.length, 1);
  assert.equal(edges[0].relation, "measured_by");
  assert.equal(edges[0].review_status, "inferred");
  assert.deepEqual(edges[0].evidence, [{ source_path: exp().path, locator: "result" }]);
});

test("a conclusion only produces a claim node when status has actually reached concluded/integrated", () => {
  const runningWithConclusionText = Core.buildProjectGraphProjection({
    project: PROJECT, experiments: [exp({ status: "running", conclusion: "premature conclusion text" })],
  });
  assert.equal(runningWithConclusionText.nodes.filter((n) => n.type === "claim").length, 0);

  const concluded = Core.buildProjectGraphProjection({
    project: PROJECT, experiments: [exp({ status: "concluded", conclusion: "HYP-001 supported by observed trend." })],
  });
  assert.equal(concluded.nodes.filter((n) => n.type === "claim").length, 1);
  assert.equal(concluded.edges.find((e) => e.relation === "tests")?.review_status, "inferred");

  const integrated = Core.buildProjectGraphProjection({
    project: PROJECT, experiments: [exp({ status: "integrated", conclusion: "confirmed after replication." })],
  });
  assert.equal(integrated.nodes.filter((n) => n.type === "claim").length, 1);
});

test("simulated data_origin is labeled as such and never silently presented as a real measurement", () => {
  const { nodes } = Core.buildProjectGraphProjection({
    project: PROJECT, experiments: [exp({ status: "concluded", data_origin: "simulated", result: "predicted rate 4.0 umol/mg/h", conclusion: "model-predicted trend matches HYP-006" })],
  });
  const execution = nodes.find((n) => n.type === "execution");
  const observation = nodes.find((n) => n.type === "observation");
  assert.match(execution.description, /模拟数据/);
  assert.match(observation.description, /模拟数据/);
});

test("an experiment belonging to a different project is never projected, even if passed in by mistake", () => {
  const { nodes, edges } = Core.buildProjectGraphProjection({
    project: PROJECT, experiments: [exp({ project_uid: "01927d3f-0000-7000-8000-999999999999", result: "x", conclusion: "y", status: "concluded" })],
  });
  assert.equal(nodes.length, 0);
  assert.equal(edges.length, 0);
});

test("an experiment missing a title or uid is skipped rather than producing a malformed node", () => {
  const { nodes } = Core.buildProjectGraphProjection({ project: PROJECT, experiments: [exp({ title: "" }), exp({ uid: "" })] });
  assert.equal(nodes.length, 0);
});

test("buildProjectGraphProjection never fabricates a node for a missing project", () => {
  const { nodes, edges, warnings } = Core.buildProjectGraphProjection({ project: null, experiments: [exp()] });
  assert.equal(nodes.length, 0);
  assert.equal(edges.length, 0);
  assert.ok(warnings.length > 0);
});

test("mergeGraphDrafts deduplicates by node id, preferring the semantic graph's version, and concatenates edges/warnings", () => {
  const semantic = {
    title: "Semantic title", nodes: [{ id: "au", label: "Au (semantic)", type: "material" }],
    edges: [{ source: "au", target: "spr", relation: "enables" }], warnings: ["semantic warning"],
  };
  const projection = {
    nodes: [{ id: "au", label: "Au (projection, should be dropped)", type: "material" }, { id: "exec-1", label: "EXP-001", type: "execution" }],
    edges: [{ source: "exec-1", target: "obs-1", relation: "measured_by" }], warnings: ["projection warning"],
  };
  const merged = Core.mergeGraphDrafts(semantic, projection);
  assert.equal(merged.title, "Semantic title");
  assert.equal(merged.nodes.length, 2);
  assert.equal(merged.nodes.find((n) => n.id === "au").label, "Au (semantic)");
  assert.equal(merged.edges.length, 2);
  assert.deepEqual(merged.warnings, ["semantic warning", "projection warning"]);
});

test("mergeGraphDrafts tolerates a missing/malformed semantic or projection graph", () => {
  assert.doesNotThrow(() => Core.mergeGraphDrafts(null, { nodes: [{ id: "a", label: "A", type: "material" }] }));
  assert.doesNotThrow(() => Core.mergeGraphDrafts({ nodes: [{ id: "a", label: "A", type: "material" }] }, undefined));
  const merged = Core.mergeGraphDrafts(undefined, undefined);
  assert.deepEqual(merged.nodes, []);
  assert.deepEqual(merged.edges, []);
});
