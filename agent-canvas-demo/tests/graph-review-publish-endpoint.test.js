"use strict";
// Real end-to-end tests for the knowledge-graph review/publish endpoints:
// GET /v1/knowledge-graph/project-objects (full, untruncated Project+Experiment
// read for graph-projection-core.js) and the two-phase
// POST /v1/knowledge-graph/publish/preview -> POST .../:id/commit publish gate.
// Spawns the real Bridge against a disposable config/workspace/vault, same
// pattern as tests/seed-reconstruction-endpoint.test.js. The commit tests
// also spawn the real render_graph.py, so they skip cleanly if python isn't
// on PATH (same convention as tests/knowledge-graph-core.test.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { startBridge } = require("./helpers/bridge-harness.js");

const root = path.resolve(__dirname, "..");
const TOKEN = "test-token-" + process.pid;

// This file used to derive 47600 + (process.pid % 300). The port is now
// assigned by the OS and reported back by the Bridge, so nothing has to be
// probed and no two test files can land on the same number.
let harness, workspace, vault, runtimeDir;

const request = (pathname, options = {}) => harness
  .request(pathname, { ...options, ...(options.noAuth ? { auth: false } : {}) })
  .then((res) => ({ status: res.status, body: res.text }));

const PROJECT_UID = "01927d3f-8a41-7c62-b5e0-9f3a2c1d4e5b";
const EXP_UID = "01927d3f-8a41-7c62-b5e0-9f3a2c1d4e5c";

function writeFixtureVault(vaultDir) {
  const projectsDir = path.join(vaultDir, "Research", "Projects");
  const experimentsDir = path.join(vaultDir, "Research", "Experiments");
  fs.mkdirSync(projectsDir, { recursive: true });
  fs.mkdirSync(experimentsDir, { recursive: true });
  fs.writeFileSync(path.join(projectsDir, "PRJ-TEST.md"), [
    "---", 'uid: "' + PROJECT_UID + '"', 'display_id: "PRJ-TEST"', "schema_version: 1", 'type: "project"',
    'created_at: "2026-09-01T00:00:00.000Z"', 'updated_at: "2026-09-01T00:00:00.000Z"', 'title: "测试课题"', 'status: "active"',
    "---", "", "# 测试课题", "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(experimentsDir, "EXP-TEST.md"), [
    "---", 'uid: "' + EXP_UID + '"', 'display_id: "EXP-TEST"', "schema_version: 1", 'type: "experiment"',
    'created_at: "2026-09-01T00:00:00.000Z"', 'updated_at: "2026-09-01T00:00:00.000Z"',
    'project_uid: "' + PROJECT_UID + '"', 'title: "测试实验"', 'status: "concluded"',
    'result: "H2 evolution rate increased with shell thickness up to 18nm."',
    'conclusion: "supports a non-monotonic shell-thickness relationship."',
    "---", "", "# 测试实验", "",
  ].join("\n"), "utf8");
}

test.before(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "graph-review-workspace-"));
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "graph-review-vault-"));
  writeFixtureVault(vault);

  harness = await startBridge({
    token: TOKEN,
    config: { workspaceRoot: workspace, allowedRoots: [workspace], adapters: {}, scholarium: { enabled: true, vaultRoot: vault } },
    // Audit and runtime live inside the harness scratch, so stop() clears them.
    // The runtime directory must be isolated from bridge/runtime/ (the un-set
    // default): without it the publish/list tests below would see every real
    // knowledge-graph-runs record this repo has ever committed, not just this
    // test's fixtures.
    env: (scratch) => {
      // Two tests below build run-history fixtures directly on disk, so the
      // runtime directory has to be reachable from the test body as well.
      runtimeDir = path.join(scratch, "runtime");
      return {
        AGENT_BRIDGE_AUDIT_DIR: path.join(scratch, "audit"),
        AGENT_BRIDGE_RUNTIME_DIR: runtimeDir,
      };
    },
  });
});

test.after(() => {
  if (harness) harness.stop();
  for (const dir of [workspace, vault]) if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
});

test("rejects project-objects without the bridge token", async () => {
  const res = await request("/v1/knowledge-graph/project-objects?display_id=PRJ-TEST", { noAuth: true });
  assert.equal(res.status, 401);
});

test("project-objects requires display_id", async () => {
  const res = await request("/v1/knowledge-graph/project-objects");
  assert.equal(res.status, 400);
});

test("project-objects returns unknown for a display_id that doesn't exist", async () => {
  const res = await request("/v1/knowledge-graph/project-objects?display_id=PRJ-DOES-NOT-EXIST");
  assert.equal(res.status, 404);
});

test("project-objects returns the full, untruncated experiment fields for the matching project only", async () => {
  const res = await request("/v1/knowledge-graph/project-objects?display_id=PRJ-TEST");
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.project.uid, PROJECT_UID);
  assert.equal(payload.experiments.length, 1);
  assert.equal(payload.experiments[0].uid, EXP_UID);
  assert.match(payload.experiments[0].result, /shell thickness up to 18nm/);
  assert.match(payload.experiments[0].conclusion, /non-monotonic/);
  assert.ok(payload.experiments[0].__vault_path.includes("EXP-TEST.md"));
});

const MINIMAL_GRAPH = {
  title: "publish test", nodes: [
    { id: "a", label: "A", type: "material" },
    { id: "b", label: "B", type: "outcome" },
  ],
  edges: [{ source: "a", target: "b", relation: "correlates_with", confidence: 0.5, review_status: "inferred", evidence: [] }],
  warnings: [],
};

test("rejects a publish preview without the bridge token", async () => {
  const res = await request("/v1/knowledge-graph/publish/preview", { method: "POST", noAuth: true, body: JSON.stringify({}) });
  assert.equal(res.status, 401);
});

test("publish preview requires a graph with nodes/edges and a project_display_id", async () => {
  const noGraph = await request("/v1/knowledge-graph/publish/preview", { method: "POST", body: JSON.stringify({ workspace, project_display_id: "PRJ-TEST" }) });
  assert.equal(noGraph.status, 400);
  const noProject = await request("/v1/knowledge-graph/publish/preview", { method: "POST", body: JSON.stringify({ workspace, graph: MINIMAL_GRAPH }) });
  assert.equal(noProject.status, 400);
});

test("publish preview rejects a workspace outside allowedRoots", async () => {
  const res = await request("/v1/knowledge-graph/publish/preview", { method: "POST", body: JSON.stringify({ workspace: os.tmpdir(), project_display_id: "PRJ-TEST", graph: MINIMAL_GRAPH }) });
  assert.equal(res.status, 403);
});

test("publish preview does not write any files", async () => {
  const before = fs.existsSync(path.join(workspace, "knowledge-graph"));
  const res = await request("/v1/knowledge-graph/publish/preview", { method: "POST", body: JSON.stringify({ workspace, project_display_id: "PRJ-TEST", graph: MINIMAL_GRAPH }) });
  assert.equal(res.status, 201);
  const payload = JSON.parse(res.body);
  assert.equal(payload.nodeCount, 2);
  assert.equal(payload.edgeCount, 1);
  assert.match(payload.targetDir, /^knowledge-graph\/runs\//);
  assert.equal(fs.existsSync(path.join(workspace, "knowledge-graph")), before);
});

test("commit rejects an unknown or already-consumed previewId", async () => {
  const res = await request("/v1/knowledge-graph/publish/does-not-exist/commit", { method: "POST" });
  assert.equal(res.status, 403);
});

test("commit writes to the versioned directory, never touches the canonical location, and burns the previewId", async (t) => {
  const probe = spawnSync("python", ["-c", "import sys"], { encoding: "utf8" });
  if (probe.status !== 0) return t.skip("python unavailable");

  const canonicalDir = path.join(workspace, "knowledge-graph");
  fs.mkdirSync(canonicalDir, { recursive: true });
  fs.writeFileSync(path.join(canonicalDir, "knowledge_graph.json"), '{"canary": true}', "utf8");

  const preview = JSON.parse((await request("/v1/knowledge-graph/publish/preview", {
    method: "POST", body: JSON.stringify({ workspace, project_display_id: "PRJ-TEST", graph: MINIMAL_GRAPH }),
  })).body);

  const commit = await request(`/v1/knowledge-graph/publish/${preview.id}/commit`, { method: "POST" });
  assert.equal(commit.status, 200, commit.body);
  const record = JSON.parse(commit.body);
  assert.equal(record.nodeCount, 2);
  assert.equal(record.edgeCount, 1);
  assert.equal(record.targetDir, preview.targetDir);

  const versionedDir = path.join(workspace, ...preview.targetDir.split("/"));
  assert.ok(fs.existsSync(path.join(versionedDir, "knowledge_graph.json")));
  assert.ok(fs.existsSync(path.join(versionedDir, "knowledge_graph.html")));
  assert.ok(fs.existsSync(path.join(versionedDir, "knowledge_graph-report.md")));

  // the pre-existing canonical file must survive byte-for-byte
  assert.equal(fs.readFileSync(path.join(canonicalDir, "knowledge_graph.json"), "utf8"), '{"canary": true}');

  // the previewId is one-time use
  const replay = await request(`/v1/knowledge-graph/publish/${preview.id}/commit`, { method: "POST" });
  assert.equal(replay.status, 403);
});

// --- GET /v1/knowledge-graph/publish/list + /file -------------------------
// Read-only surfaces added for the project card's "打开最新版本" button and
// the tracker rail's "知识图谱" tab: list() reads persisted commit records,
// file() streams one recorded file back. Both must stay strictly read-only
// and bounded to the run's own recorded workspace/targetDir, since neither
// takes a client-supplied raw path.

async function publishOneRun(t, { titleSuffix = "" } = {}) {
  const probe = spawnSync("python", ["-c", "import sys"], { encoding: "utf8" });
  if (probe.status !== 0) { t.skip("python unavailable"); return null; }
  const graph = { ...MINIMAL_GRAPH, title: `publish test${titleSuffix}` };
  const preview = JSON.parse((await request("/v1/knowledge-graph/publish/preview", {
    method: "POST", body: JSON.stringify({ workspace, project_display_id: "PRJ-TEST", graph }),
  })).body);
  const commit = await request(`/v1/knowledge-graph/publish/${preview.id}/commit`, { method: "POST" });
  assert.equal(commit.status, 200, commit.body);
  return JSON.parse(commit.body);
}

test("publish/list requires no auth bypass: rejects without the bridge token", async () => {
  const res = await request("/v1/knowledge-graph/publish/list?project_display_id=PRJ-TEST", { noAuth: true });
  assert.equal(res.status, 401);
});

test("publish/list returns an empty array for a project with no published runs", async () => {
  const res = await request("/v1/knowledge-graph/publish/list?project_display_id=PRJ-NOTHING-PUBLISHED");
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.deepEqual(payload.runs, []);
});

test("publish/list filters by project_display_id and sorts newest-first", async (t) => {
  const first = await publishOneRun(t, { titleSuffix: " #1" });
  if (!first) return;
  await new Promise((resolve) => setTimeout(resolve, 5)); // force a distinct publishedAt
  const second = await publishOneRun(t, { titleSuffix: " #2" });

  const res = await request("/v1/knowledge-graph/publish/list?project_display_id=PRJ-TEST");
  assert.equal(res.status, 200);
  const { runs } = JSON.parse(res.body);
  assert.ok(runs.length >= 2);
  assert.ok(runs.every((r) => r.projectDisplayId === "PRJ-TEST"));
  const firstIndex = runs.findIndex((r) => r.id === first.id);
  const secondIndex = runs.findIndex((r) => r.id === second.id);
  assert.ok(firstIndex >= 0 && secondIndex >= 0);
  assert.ok(secondIndex < firstIndex, "the later commit should sort before the earlier one");
});

test("publish/file rejects an unknown kind", async () => {
  const res = await request("/v1/knowledge-graph/publish/file?run_id=whatever&kind=exe");
  assert.equal(res.status, 400);
});

test("publish/file 404s for an unknown run_id", async () => {
  const res = await request("/v1/knowledge-graph/publish/file?run_id=does-not-exist&kind=html");
  assert.equal(res.status, 404);
});

test("publish/file serves the real html/report/json content with the right content-type", async (t) => {
  const record = await publishOneRun(t, { titleSuffix: " #serve" });
  if (!record) return;

  const html = await request(`/v1/knowledge-graph/publish/file?run_id=${record.id}&kind=html`);
  assert.equal(html.status, 200);
  assert.match(html.body, /<html/i);

  const report = await request(`/v1/knowledge-graph/publish/file?run_id=${record.id}&kind=report`);
  assert.equal(report.status, 200);
  assert.match(report.body, /#/); // markdown heading

  const json = await request(`/v1/knowledge-graph/publish/file?run_id=${record.id}&kind=json`);
  assert.equal(json.status, 200);
  const parsedGraph = JSON.parse(json.body);
  assert.ok(Array.isArray(parsedGraph.nodes));
});

test("publish/file 404s when the recorded file has been deleted off disk", async (t) => {
  const record = await publishOneRun(t, { titleSuffix: " #deleted" });
  if (!record) return;
  fs.rmSync(path.join(workspace, record.htmlPath));

  const res = await request(`/v1/knowledge-graph/publish/file?run_id=${record.id}&kind=html`);
  assert.equal(res.status, 404);
});

test("publish/file returns 403 for a run whose recorded workspace has fallen outside allowedRoots", async () => {
  // Simulates the exact case flagged for review: a run committed under an
  // older/different workspace should not become readable just because a
  // record for its id still exists on disk. Written directly to the
  // run-history store (not through the API) since the API only ever writes
  // records for the currently-allowed workspace itself.
  const outsideWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), "graph-review-outside-workspace-"));
  const runId = "outside-workspace-run";
  const record = {
    id: runId, previewId: "irrelevant", projectDisplayId: "PRJ-TEST",
    workspace: outsideWorkspace, targetDir: "knowledge-graph/runs/outside-workspace-run",
    htmlPath: "knowledge-graph/runs/outside-workspace-run/knowledge_graph.html",
    jsonPath: "knowledge-graph/runs/outside-workspace-run/knowledge_graph.json",
    reportPath: "knowledge-graph/runs/outside-workspace-run/knowledge_graph-report.md",
    nodeCount: 1, edgeCount: 0, warnings: [], publishedAt: new Date().toISOString(),
  };
  const dir = path.join(runtimeDir, "run-history", "knowledge-graph-runs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${runId}.json`), JSON.stringify(record, null, 2), "utf8");
  // Even give it a real file to make sure the 403 is the allowedRoots check
  // firing, not an incidental 404.
  fs.mkdirSync(path.join(outsideWorkspace, "knowledge-graph", "runs", "outside-workspace-run"), { recursive: true });
  fs.writeFileSync(path.join(outsideWorkspace, "knowledge-graph", "runs", "outside-workspace-run", "knowledge_graph.html"), "<html>leaked</html>", "utf8");

  const res = await request(`/v1/knowledge-graph/publish/file?run_id=${runId}&kind=html`);
  assert.equal(res.status, 403);
  assert.doesNotMatch(res.body, /leaked/);

  fs.rmSync(outsideWorkspace, { recursive: true, force: true });
});

test("publish/file returns 403 when the recorded path escapes the run's own targetDir", async () => {
  // Defense-in-depth: even a workspace that *is* allowed must not let a
  // (corrupted or tampered) record's htmlPath point outside the specific
  // run directory it claims to belong to.
  const runId = "path-escape-run";
  const secretPath = path.join(workspace, "secret-outside-run.html");
  fs.writeFileSync(secretPath, "<html>should not be servable</html>", "utf8");
  const record = {
    id: runId, previewId: "irrelevant", projectDisplayId: "PRJ-TEST",
    workspace, targetDir: "knowledge-graph/runs/path-escape-run",
    htmlPath: "secret-outside-run.html", // escapes runRoot even though it's inside workspace
    jsonPath: "knowledge-graph/runs/path-escape-run/knowledge_graph.json",
    reportPath: "knowledge-graph/runs/path-escape-run/knowledge_graph-report.md",
    nodeCount: 1, edgeCount: 0, warnings: [], publishedAt: new Date().toISOString(),
  };
  const dir = path.join(runtimeDir, "run-history", "knowledge-graph-runs");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${runId}.json`), JSON.stringify(record, null, 2), "utf8");

  const res = await request(`/v1/knowledge-graph/publish/file?run_id=${runId}&kind=html`);
  assert.equal(res.status, 403);
  assert.doesNotMatch(res.body, /should not be servable/);

  fs.rmSync(secretPath, { force: true });
});
