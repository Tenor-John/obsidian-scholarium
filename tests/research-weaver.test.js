"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const { serializeObject } = require("../tools/schema-objects");
const weaver = require("../agent-canvas-demo/skills/research-weaver/scripts/merge_and_build_graph");

function tempVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-weaver-"));
  fs.mkdirSync(path.join(vault, "Research", "weave-bundles"), { recursive: true });
  return vault;
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}
function bundle(overrides = {}) {
  return {
    node_id: "mechanism-au-bivo4", axis: "mechanism", title: "Au/BiVO4 charge transfer",
    research_question: "How does Au affect BiVO4 charge transfer?", search_query: "Au BiVO4 charge transfer",
    evidence_level: "L2", summary: "A bounded metadata search.",
    papers: [{ doi: "10.1234/example.1", title: "A paper", year: 2026, venue: "Journal" }],
    ...overrides,
  };
}

describe("research weaver merge plan", () => {
  it("is dry-run by default and keeps search metadata distinct from a Paper", () => {
    const vault = tempVault();
    writeJson(path.join(vault, "Research", "weave-bundles", "one.json"), bundle());
    const plan = weaver.buildPlan(vault);
    assert.eq(plan.valid, true);
    assert.eq(plan.write_mode, "dry_run");
    assert.eq(plan.input.scanned, 1);
    assert.eq(plan.input.accepted, 1);
    assert.eq(plan.summary.external_metadata_candidates, 1);
    assert.eq(plan.paper_knowledge_graph.invoked, true);
    assert.eq(plan.paper_knowledge_graph.summary.sidecars_scanned, 0);
    assert.eq(fs.existsSync(path.join(vault, "Canvases")), false);
    assert.match(weaver.markdownFromPlan(plan), /metadata is not a Paper/);
  });

  it("accounts for every bundle and refuses malformed inputs instead of writing", () => {
    const vault = tempVault();
    writeJson(path.join(vault, "Research", "weave-bundles", "good.json"), bundle());
    writeJson(path.join(vault, "Research", "weave-bundles", "bad.json"), bundle({ axis: "magic" }));
    const plan = weaver.buildPlan(vault);
    assert.eq(plan.valid, true);
    assert.eq(plan.input.scanned, 2);
    assert.eq(plan.input.accepted, 1);
    assert.eq(plan.input.rejected, 1);
    assert.eq(plan.input.terminal[0].status, "rejected");
    assert.eq(plan.invariants.accepted_plus_rejected_equals_scanned, true);
  });

  it("links an already archived DOI as a Paper view without minting another Paper", () => {
    const vault = tempVault();
    const paperPath = path.join(vault, "Research", "Papers", "archived.md");
    fs.mkdirSync(path.dirname(paperPath), { recursive: true });
    fs.writeFileSync(paperPath, serializeObject({
      uid: "0198feba-1234-7abc-8def-1234567890ab", display_id: "PAPER-001", schema_version: 1, type: "paper",
      created_at: "2026-08-12T00:00:00.000Z", updated_at: "2026-08-12T00:00:00.000Z",
      title: "Archived paper", source: "https://doi.org/10.1234/example.1", doi: "10.1234/example.1",
    }, "\n"), "utf8");
    writeJson(path.join(vault, "Research", "weave-bundles", "one.json"), bundle());
    const plan = weaver.buildPlan(vault);
    assert.eq(plan.summary.resolved_existing_papers, 1);
    assert.eq(plan.summary.external_metadata_candidates, 0);
    const applied = weaver.applyPlan(plan, { stamp: "2026-08-12T00-00-00-000Z" });
    const canvas = JSON.parse(fs.readFileSync(path.join(vault, ...applied.canvas.split("/")), "utf8"));
    const fileNode = canvas.nodes.find((node) => node.type === "file");
    assert.eq(fileNode.file, "Research/Papers/archived.md");
    assert.eq(fs.readdirSync(path.join(vault, "Research", "Papers")).length, 1);
  });

  it("invokes the Paper Knowledge Graph as a dry-run composition and writes its view only on apply", () => {
    const vault = tempVault();
    writeJson(path.join(vault, ".scholarium", "pdf-sidecars", "one.json"), {
      kind: "scholarium-pdf-anchor-sidecar", source_path: "literature/a.pdf", source_sha256: "a".repeat(64),
      doi: "10.1000/example", original_url: "https://doi.org/10.1000/example",
      anchors: [{ id: "p0001", text: "Au nanoparticles on BiVO4 were examined by XRD.", text_hash: "b".repeat(32), quote_hash: "b".repeat(32) }],
    });
    const plan = weaver.buildPlan(vault);
    assert.eq(plan.paper_knowledge_graph.summary.pdf_sources_accepted, 1);
    assert.ok(plan.paper_knowledge_graph.summary.located_mentions > 0);
    assert.eq(fs.existsSync(path.join(vault, "Canvases")), false);
    const applied = weaver.applyPlan(plan, { stamp: "2026-08-14T00-00-00-000Z" });
    assert.match(applied.paper_knowledge_graph.visualization, /^Canvases\/paper-knowledge-graph-.*\.html$/);
    assert.ok(fs.existsSync(path.join(vault, applied.paper_knowledge_graph.visualization)));
  });

  it("accepts Bridge apply only through an exact structured request", () => {
    const vault = tempVault();
    assert.eq(weaver.parseArgs(["node", "script", vault, '{"mode":"apply"}']).apply, true);
    assert.eq(weaver.parseArgs(["node", "script", vault, "please create a graph"]).apply, false);
    assert.eq(weaver.parseArgs(["node", "script", vault, '{"mode":"delete"}']).apply, false);
  });
});
