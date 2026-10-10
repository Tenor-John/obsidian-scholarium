"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const graph = require("../agent-canvas-demo/skills/paper-knowledge-graph/scripts/build_paper_graph.js");

function tempVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sch-paper-graph-"));
  const dir = path.join(root, ".scholarium", "pdf-sidecars"); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "one.json"), JSON.stringify({ kind: "scholarium-pdf-anchor-sidecar", source_path: "literature/a.pdf", source_sha256: "a".repeat(64), doi: "10.1000/example", original_url: "https://doi.org/10.1000/example", anchors: [{ id: "p0001", text: "Au nanoparticles on BiVO4 were measured by XRD for photocatalytic CO2 reduction.", text_hash: "b".repeat(32), quote_hash: "b".repeat(32) }] }), "utf8");
  return root;
}
describe("paper knowledge graph skill", () => {
  it("creates only located MENTIONS edges in a dry run", () => {
    const vault = tempVault(); const plan = graph.buildPlan(vault, { limit: 3 });
    assert.ok(plan.valid); assert.eq(plan.write_mode, "dry_run"); assert.eq(plan.graph.papers.length, 1);
    assert.ok(plan.graph.edges.length > 0); assert.ok(plan.graph.edges.every((edge) => edge.relation === "MENTIONS"));
    assert.ok(plan.graph.edges.every((edge) => edge.locator.anchor === "p0001"));
    assert.notOk(fs.existsSync(path.join(vault, "Canvases")));
  });
  it("rejects a sidecar missing a durable source URL", () => {
    const vault = tempVault(); const file = path.join(vault, ".scholarium", "pdf-sidecars", "one.json"); const x = JSON.parse(fs.readFileSync(file)); delete x.original_url; fs.writeFileSync(file, JSON.stringify(x));
    const plan = graph.buildPlan(vault); assert.eq(plan.source.rejected, 1); assert.eq(plan.graph.edges.length, 0); assert.ok(plan.valid);
  });
  it("does not turn bibliography mentions into paper-level graph edges", () => {
    const vault = tempVault(); const file = path.join(vault, ".scholarium", "pdf-sidecars", "one.json"); const x = JSON.parse(fs.readFileSync(file));
    x.anchors.push({ id: "p0002", text: "References. A. Author, 2020, DOI PubMed; B. Author, 2021, DOI PubMed; C. Author, 2022, DOI PubMed. Au nanoparticles and BiVO4.", text_hash: "c".repeat(32), quote_hash: "c".repeat(32) }); fs.writeFileSync(file, JSON.stringify(x));
    const plan = graph.buildPlan(vault); assert.eq(plan.source.skipped_reference_anchors, 1); assert.ok(plan.graph.edges.every((edge) => edge.locator.anchor !== "p0002"));
  });
  it("writes only timestamped rebuildable views when explicitly applied", () => {
    const vault = tempVault(); const plan = graph.buildPlan(vault); const applied = graph.applyPlan(plan);
    assert.match(applied.canvas, /^Canvases\/paper-knowledge-graph-/); assert.match(applied.report, /^Research\/WeaveRuns\/paper-knowledge-graph-/);
    assert.match(applied.visualization, /^Canvases\/paper-knowledge-graph-.*\.html$/);
    assert.ok(fs.existsSync(path.join(vault, applied.canvas))); assert.ok(fs.existsSync(path.join(vault, applied.visualization))); assert.ok(fs.existsSync(path.join(vault, applied.report)));
    const html = fs.readFileSync(path.join(vault, applied.visualization), "utf8");
    assert.match(html, /Evidence-located navigation view/); assert.match(html, /MENTIONS/);
  });
});
