"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { normalizeVector, cosineSimilarity, vectorRank, hybridRank, diversifyBySource, chunkMarkdown } = require("../bridge/rag-core.js");
const rag = require("../skills/rag-ingest/scripts/rag.js");
const paperGraph = require("../skills/paper-knowledge-graph/scripts/build_paper_graph.js");

function workspace() { return fs.mkdtempSync(path.join(os.tmpdir(), "weaver-rag-vector-")); }
function withToken(value, fn) {
  const previous = process.env.HF_TOKEN;
  if (value === undefined) delete process.env.HF_TOKEN; else process.env.HF_TOKEN = value;
  return Promise.resolve().then(fn).finally(() => {
    if (previous === undefined) delete process.env.HF_TOKEN; else process.env.HF_TOKEN = previous;
  });
}
function fakeClient(vectorForText) {
  return {
    calls: [],
    async featureExtraction(args) {
      this.calls.push(args);
      return args.inputs.map((text) => vectorForText(String(text)));
    },
  };
}

test("vector helpers normalize, compare and reject dimension mismatch", () => {
  assert.deepEqual(normalizeVector([3, 4]), [0.6, 0.8]);
  assert.equal(Number(cosineSimilarity([1, 0], [2, 0]).toFixed(6)), 1);
  assert.equal(cosineSimilarity([1, 0], [1, 0, 0]), null);
  assert.equal(normalizeVector([0, 0]), null);
});

test("vector and hybrid ranking keep component scores and support source diversity", () => {
  const chunks = [
    { source_path: "a.md", heading: "", text: "gold nanostar synthesis", embedding: [1, 0], embedding_meta: { model: "m" } },
    { source_path: "a.md", heading: "", text: "gold growth", embedding: [0.9, 0.1], embedding_meta: { model: "m" } },
    { source_path: "b.md", heading: "", text: "cooking", embedding: [0, 1], embedding_meta: { model: "m" } },
  ];
  assert.equal(vectorRank(chunks, [1, 0], 2, { model: "m" })[0].index, 0);
  const hybrid = hybridRank(chunks, "gold", [1, 0], 3, { model: "m" });
  assert.ok(hybrid[0].bm25_score > 0 && hybrid[0].vector_score > 0);
  const diverse = diversifyBySource(hybrid, chunks, 2, 1);
  assert.deepEqual(diverse.map((item) => chunks[item.index].source_path), ["a.md", "b.md"]);
});

test("heading-aware chunks include stable character offsets", () => {
  const source = `# Title\n\n${"alpha sentence. ".repeat(100)}\n\n## Method\n\n${"beta method。".repeat(100)}`;
  const chunks = chunkMarkdown(source, { maxChars: 240, overlap: 30 });
  assert.ok(chunks.length > 4);
  for (const chunk of chunks) assert.equal(source.slice(chunk.start_index, chunk.end_index), chunk.text);
});

test("ingest creates real normalized Hugging Face vectors and query uses hybrid retrieval", async () => {
  const root = workspace();
  try {
    fs.writeFileSync(path.join(root, "paper.md"), "# Gold study\n\nGold nanoparticles were synthesized by TEM-guided seed growth. This paragraph is long enough for indexing and retrieval.\n", "utf8");
    const client = fakeClient((text) => /gold/i.test(text) ? [3, 4, 0] : [0, 0, 5]);
    await withToken("hf_testtoken000000000000000000", async () => {
      const ingested = await rag.run(root, { mode: "ingest", paths: ["paper.md"], embedding: "required", model: "test/model" }, { client, retries: 0 });
      assert.equal(ingested.vectorization.status, "completed");
      assert.equal(ingested.index.vectorized, 1);
      assert.equal(ingested.index.compatible_vectorized, 1);
      const line = JSON.parse(fs.readFileSync(path.join(root, "Scholarium", "runtime", "rag-index", "chunks.jsonl"), "utf8").trim());
      assert.deepEqual(line.embedding, [0.6, 0.8, 0]);
      assert.equal(line.embedding_meta.model, "test/model");
      assert.equal(line.embedding_meta.content_hash, line.content_hash);

      const result = await rag.run(root, { mode: "query", query: "gold synthesis", retrieval: "hybrid", model: "test/model" }, { client, retries: 0 });
      assert.equal(result.retrieval, "hybrid");
      assert.equal(result.degraded, false);
      assert.equal(result.results[0].source, "paper.md");
      assert.ok(result.results[0].scores.vector > 0);
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("auto mode records an explicit BM25 degradation while required mode fails closed", async () => {
  const root = workspace();
  try {
    fs.writeFileSync(path.join(root, "paper.md"), "# Study\n\nThis sufficiently long paragraph can still be indexed for lexical retrieval when the cloud is unavailable.\n", "utf8");
    await withToken(undefined, async () => {
      const result = await rag.run(root, { mode: "ingest", paths: ["paper.md"], embedding: "auto" });
      assert.equal(result.vectorization.status, "degraded_bm25");
      assert.match(result.warnings[0], /HF_TOKEN/);
      await assert.rejects(() => rag.run(root, { mode: "reindex" }), /HF_TOKEN/);
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("multi-batch embedding is transactional when a later cloud batch fails", async () => {
  const chunks = [
    { heading: "A", text: "first sufficiently long chunk", embedding: null, embedding_meta: null },
    { heading: "B", text: "second sufficiently long chunk", embedding: null, embedding_meta: null },
  ];
  let calls = 0;
  const client = { async featureExtraction() { calls++; if (calls === 2) throw new Error("simulated outage"); return [[1, 0]]; } };
  await withToken("hf_testtoken000000000000000000", async () => {
    const config = rag.embeddingConfig({ model: "test/model", batch_size: 1 });
    await assert.rejects(() => rag.vectorizeChunks(chunks, config, { client, retries: 0 }), /simulated outage/);
  });
  assert.deepEqual(chunks.map((chunk) => chunk.embedding), [null, null]);
});

test("RAG chunks feed the provenance-preserving paper graph directly", async () => {
  const root = workspace();
  try {
    fs.writeFileSync(path.join(root, "paper.md"), "# Photocatalysis\n\nGold nanoparticles were characterized by TEM for CO2 reduction and photocatalytic activity.\n", "utf8");
    await withToken(undefined, () => rag.run(root, { mode: "ingest", paths: ["paper.md"], embedding: "off" }));
    const plan = paperGraph.buildPlan(root, { source: "rag", limit: 10 });
    assert.equal(plan.valid, true);
    assert.equal(plan.source.mode, "rag");
    assert.equal(plan.graph.papers.length, 1);
    assert.ok(plan.graph.edges.length >= 3);
    assert.ok(plan.graph.edges.every((edge) => edge.relation === "MENTIONS" && edge.locator.source_type === "rag_chunk"));
    assert.ok(plan.graph.edges.every((edge) => edge.locator.source_sha256 && edge.locator.quote_hash && edge.locator.anchor));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("retrieval evaluation reports Recall@k and MRR from expected sources", async () => {
  const root = workspace();
  try {
    fs.writeFileSync(path.join(root, "gold.md"), "# Gold\n\nGold nanostar seed-mediated growth uses HEPES buffer and optical characterization.\n", "utf8");
    fs.writeFileSync(path.join(root, "food.md"), "# Cooking\n\nA sufficiently long unrelated paragraph about recipes, kitchens, vegetables, and dinner.\n", "utf8");
    await withToken(undefined, async () => {
      await rag.run(root, { mode: "ingest", paths: ["gold.md", "food.md"], embedding: "off" });
      const report = await rag.run(root, { mode: "evaluate", retrieval: "bm25", k: 2, cases: [{ query: "HEPES gold nanostar", expected_sources: ["gold.md"] }] });
      assert.equal(report.recall_at_k, 1);
      assert.equal(report.mean_reciprocal_rank, 1);
      assert.equal(report.results[0].first_rank, 1);
    });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
