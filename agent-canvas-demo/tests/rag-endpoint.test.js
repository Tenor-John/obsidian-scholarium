"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startBridge } = require("./helpers/bridge-harness.js");

const root = path.resolve(__dirname, "..");
const TOKEN = `rag-endpoint-token-${process.pid}`;
let workspace, harness;

// The port is assigned by the OS and reported back by the Bridge. freePort()
// used to bind :0, read the port and close it, handing the port back before the
// Bridge could claim it - a race that no amount of retrying removes.
const request = (pathname, options = {}) => harness
  .json(pathname, options)
  .then((res) => ({ status: res.status, body: res.body || {} }));

test.before(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "rag-endpoint-workspace-"));
  fs.writeFileSync(path.join(workspace, "paper.md"), "# Gold photocatalysis\n\nGold nanoparticles were characterized by TEM for CO2 reduction. This paragraph is long enough for indexing.\n", "utf8");
  harness = await startBridge({
    token: TOKEN,
    config: {
      workspaceRoot: workspace,
      allowedRoots: [workspace],
      skillDirectories: [path.join(root, "skills")],
      adapters: {},
      rag: { defaultRetrieval: "hybrid", maxPerSource: 3 },
    },
    // An empty process variable deliberately falls through to bridge/.env.
    // The harness points the Bridge at a disposable secrets file inside its own
    // scratch, so this test can never observe the researcher's real HF_TOKEN or
    // become machine-specific.
    env: { HF_TOKEN: "", MINERU_API_KEY: "" },
  });
});

test.after(() => {
  if (harness) harness.stop();
  if (workspace && fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
});

test("RAG endpoints ingest, diagnose, query and build a graph from one local index", async () => {
  const ingested = await request("/v1/rag/ingest", { method: "POST", body: { paths: ["paper.md"], embedding: "off" } });
  assert.equal(ingested.status, 200, JSON.stringify(ingested.body));
  assert.equal(ingested.body.manifest.vectorization.status, "off");
  assert.equal(ingested.body.manifest.index.chunks, 1);

  const status = await request("/v1/rag/status");
  assert.equal(status.status, 200);
  assert.equal(status.body.manifest.vectorized, 0);
  assert.equal(status.body.manifest.hf_token_configured, false);

  const queried = await request("/v1/rag/query", { method: "POST", body: { query: "gold CO2", retrieval: "bm25", k: 3 } });
  assert.equal(queried.status, 200, JSON.stringify(queried.body));
  assert.equal(queried.body.manifest.retrieval, "bm25");
  assert.equal(queried.body.manifest.results[0].source, "paper.md");

  const evaluated = await request("/v1/rag/evaluate", { method: "POST", body: { retrieval: "bm25", k: 3, cases: [{ query: "gold CO2", expected_sources: ["paper.md"] }] } });
  assert.equal(evaluated.status, 200, JSON.stringify(evaluated.body));
  assert.equal(evaluated.body.manifest.recall_at_k, 1);
  assert.equal(evaluated.body.manifest.mean_reciprocal_rank, 1);

  const graph = await request("/v1/rag/graph", { method: "POST", body: { limit: 10 } });
  assert.equal(graph.status, 200, JSON.stringify(graph.body));
  assert.equal(graph.body.manifest.graph.source.mode, "rag");
  assert.equal(graph.body.manifest.graph.graph.papers.length, 1);
  assert.ok(graph.body.manifest.graph.graph.edges.length >= 2);
});
