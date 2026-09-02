"use strict";
// Real end-to-end tests for the seed-reconstruction run-record endpoints
// (POST/GET/PATCH /v1/seed-reconstruction*) and the deterministic journal
// whitelist endpoint (POST /v1/literature/whitelist-check). Spawns the real
// Bridge against a disposable config + temp workspace, same pattern as
// tests/drafts-batch-endpoint.test.js — these endpoints only do identity-gate
// validation and run-record bookkeeping; they never dispatch an Agent or
// write a vault object themselves.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const bridgePort = 47100 + (process.pid % 300);
const TOKEN = "test-token-" + process.pid;

let bridge, workspace, configPath, auditDir, whitelistDir, fakeCrossref, crossrefOrigin;

function request(pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const headers = options.body ? { "content-type": "application/json" } : {};
    if (!options.noAuth) headers["x-agent-bridge-token"] = TOKEN;
    const req = http.request({ host: "127.0.0.1", port: bridgePort, path: pathname, method: options.method || "GET", headers }, (res) => {
      let raw = ""; res.on("data", (chunk) => { raw += chunk; }); res.on("end", () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on("error", reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function waitForBridge() {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { const res = await request("/health", { noAuth: true }); if (res.status === 200) return; }
    catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error("bridge did not start");
}

test.before(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "seed-recon-workspace-"));
  fs.writeFileSync(path.join(workspace, "topic.json"), JSON.stringify({ name: "CeO2壳厚对Au@CeO2可见光析氢活性的影响" }), "utf8");
  auditDir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-recon-audit-"));
  whitelistDir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-recon-whitelist-"));
  fs.writeFileSync(path.join(whitelistDir, "whitelist_journals.json"), JSON.stringify({
    "0926-3373": { issn: "0926-3373", names: ["APPLIED CATALYSIS B: ENVIRONMENTAL"], fqb_tier: 1, fqb_top: false, xr_tier: 1, xr_top: false, jcr_best_quartile: 1, jcr_if: 20.3, is_warned: false, priority_score: 90 },
  }), "utf8");
  fs.writeFileSync(path.join(whitelistDir, "blacklist.json"), JSON.stringify({
    WARNED: { name: "Some Warned Journal", type: "warned", reason: "预警期刊" },
  }), "utf8");
  fakeCrossref = http.createServer((req, res) => {
    const records = {
      "/works/10.1039%2Fd0ta00811g": {
        DOI: "10.1039/d0ta00811g", title: ["Seed paper"], "container-title": ["J. Mater. Chem. A"], ISSN: ["2050-7488"],
        issued: { "date-parts": [[2020]] }, "is-referenced-by-count": 67,
        reference: [
          { DOI: "10.1039/C9TA09333H", "article-title": "Dao method paper", "journal-title": "J. Mater. Chem. A", author: "Dao", year: "2019" },
          { DOI: "10.1016/j.jcat.2019.07.054", "article-title": "Core shell method", "journal-title": "J. Catalysis", author: "Dao", year: "2019" },
        ],
      },
      "/works/10.1039%2Fc9ta09333h": {
        DOI: "10.1039/c9ta09333h", title: ["Pt-loaded Au@CeO \n <sub>2</sub> core-shell nanocatalysts for improving methanol oxidation"],
        "container-title": ["Journal of Materials Chemistry A"], ISSN: ["2050-7488"], issued: { "date-parts": [[2019]] }, author: [{ given: "Dung Van", family: "Dao" }],
      },
    };
    if (!records[req.url]) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: records[req.url] }));
  });
  await new Promise((resolve) => fakeCrossref.listen(0, "127.0.0.1", resolve));
  crossrefOrigin = `http://127.0.0.1:${fakeCrossref.address().port}`;
  configPath = path.join(os.tmpdir(), `seed-recon-${process.pid}.config.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    token: TOKEN, allowExecution: false, workspaceRoot: workspace, allowedRoots: [workspace], adapters: {},
    scholarium: { enabled: true, vaultRoot: workspace },
    journalWhitelistPath: whitelistDir,
  }, null, 2), "utf8");

  bridge = spawn(process.execPath, [path.join(root, "bridge", "server.js")], {
    cwd: root,
    env: { ...process.env, AGENT_BRIDGE_PORT: String(bridgePort), AGENT_BRIDGE_CONFIG_PATH: configPath, AGENT_BRIDGE_AUDIT_DIR: auditDir, AGENT_BRIDGE_CROSSREF_ORIGIN: crossrefOrigin },
    stdio: "ignore", windowsHide: true,
  });
  await waitForBridge();
});

test.after(() => {
  if (bridge && !bridge.killed) bridge.kill();
  if (fakeCrossref) fakeCrossref.close();
  for (const p of [configPath]) if (p && fs.existsSync(p)) fs.rmSync(p);
  for (const d of [workspace, auditDir, whitelistDir]) if (d && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
});

test("rejects a run-record create without the bridge token", async () => {
  const res = await request("/v1/seed-reconstruction", { method: "POST", noAuth: true, body: JSON.stringify({}) });
  assert.equal(res.status, 401);
});

test("identity gate rejects a Project title that does not match workspace topic.json (the PRJ-004/PRJ-002 cwd bug, closed)", async () => {
  const res = await request("/v1/seed-reconstruction", {
    method: "POST",
    body: JSON.stringify({ project_uid: "u1", project_display_id: "PRJ-004", project_title: "验收测试用临时课题", workspace, seeds: ["10.1039/D0TA00811G"] }),
  });
  assert.equal(res.status, 409);
  const payload = JSON.parse(res.body);
  assert.match(payload.reasons[0], /不一致/);
});

test("identity gate accepts a matching Project title and creates a run record", async () => {
  const res = await request("/v1/seed-reconstruction", {
    method: "POST",
    body: JSON.stringify({ project_uid: "u1", project_display_id: "PRJ-002", project_title: "CeO2 壳厚对 Au@CeO2 可见光析氢活性的影响", workspace, seeds: ["10.1039/D0TA00811G"] }),
  });
  assert.equal(res.status, 201);
  const record = JSON.parse(res.body);
  assert.equal(record.project_display_id, "PRJ-002");
  assert.deepEqual(record.admitted_inputs, []);
  assert.ok(record.id);
});

test("requires at least one seed DOI", async () => {
  const res = await request("/v1/seed-reconstruction", {
    method: "POST",
    body: JSON.stringify({ project_uid: "u1", project_display_id: "PRJ-002", project_title: "CeO2 壳厚对 Au@CeO2 可见光析氢活性的影响", workspace, seeds: [] }),
  });
  assert.equal(res.status, 400);
});

test("workspace outside allowedRoots is rejected before the identity gate even runs", async () => {
  const res = await request("/v1/seed-reconstruction", {
    method: "POST",
    body: JSON.stringify({ project_uid: "u1", project_display_id: "PRJ-002", project_title: "x", workspace: os.tmpdir(), seeds: ["10.1039/D0TA00811G"] }),
  });
  assert.equal(res.status, 403);
});

test("GET/PATCH round-trip a run record; identity fields cannot be overwritten by PATCH", async () => {
  const created = JSON.parse((await request("/v1/seed-reconstruction", {
    method: "POST",
    body: JSON.stringify({ project_uid: "u1", project_display_id: "PRJ-002", project_title: "CeO2 壳厚对 Au@CeO2 可见光析氢活性的影响", workspace, seeds: ["10.1039/D0TA00811G"] }),
  })).body);

  const got = await request(`/v1/seed-reconstruction/${created.id}`);
  assert.equal(got.status, 200);
  assert.equal(JSON.parse(got.body).id, created.id);

  const patched = await request(`/v1/seed-reconstruction/${created.id}`, {
    method: "PATCH",
    body: JSON.stringify({
      candidates: [{ doi: "10.1016/J.APCATB.2021.119947" }],
      source_manifest: [{ source: "crossref", seed_doi: "10.1039/d0ta00811g", references: [] }],
      admitted_inputs: [{ doi: "10.1016/J.APCATB.2021.119947", path: "literature/x.pdf", sha256: "abc" }],
      status: "downloads-done",
      project_uid: "SOMEONE-ELSE", // must be ignored — identity fields are fixed at creation
    }),
  });
  assert.equal(patched.status, 200);
  const record = JSON.parse(patched.body);
  assert.equal(record.candidates.length, 1);
  assert.equal(record.source_manifest[0].source, "crossref");
  assert.equal(record.admitted_inputs[0].sha256, "abc");
  assert.equal(record.status, "downloads-done");
  assert.equal(record.project_uid, "u1"); // unchanged despite the PATCH payload
});

test("Crossref seed reader is a fixed-origin, DOI-scoped L0 manifest and does not need an Agent WebFetch", async () => {
  const res = await request("/v1/literature/crossref/works/10.1039%2FD0TA00811G");
  assert.equal(res.status, 200);
  const manifest = JSON.parse(res.body);
  assert.equal(manifest.source, "crossref");
  assert.equal(manifest.seed_doi, "10.1039/d0ta00811g");
  assert.equal(manifest.work.reference_count, 2);
  assert.equal(manifest.work.cited_by_count, 67);
  assert.equal(manifest.references[1].doi, "10.1016/j.jcat.2019.07.054");
  const candidate = await request("/v1/literature/crossref/works/10.1039%2FC9TA09333H");
  assert.equal(candidate.status, 200);
  assert.equal(JSON.parse(candidate.body).work.title, "Pt-loaded Au@CeO2 core-shell nanocatalysts for improving methanol oxidation");
  const bad = await request("/v1/literature/crossref/works/not-a-doi");
  assert.equal(bad.status, 400);
});

test("unknown run id returns 404 for GET and PATCH", async () => {
  const g = await request("/v1/seed-reconstruction/does-not-exist");
  assert.equal(g.status, 404);
  const p = await request("/v1/seed-reconstruction/does-not-exist", { method: "PATCH", body: "{}" });
  assert.equal(p.status, 404);
});

test("whitelist-check classifies a real ISSN as whitelisted and a blacklisted journal name as blacklisted", async () => {
  const res = await request("/v1/literature/whitelist-check", {
    method: "POST",
    body: JSON.stringify({ candidates: [
      { doi: "d1", issn: "0926-3373", journal: "Applied Catalysis B: Environmental" },
      { doi: "d2", issn: "0000-0000", journal: "Some Warned Journal" },
      { doi: "d3", issn: "0000-0001", journal: "Totally Unlisted Journal" },
    ] }),
  });
  assert.equal(res.status, 200);
  const { candidates } = JSON.parse(res.body);
  assert.equal(candidates[0].whitelistStatus, "whitelist");
  assert.ok(candidates[0].whitelistTier);
  assert.equal(candidates[1].whitelistStatus, "blacklist");
  assert.equal(candidates[2].whitelistStatus, "unknown");
});

test("dedup lists an existing Paper and its Evidence by DOI without modifying either object", async () => {
  const papersDir = path.join(workspace, "Research", "Papers");
  const evidenceDir = path.join(workspace, "Research", "Evidence");
  fs.mkdirSync(papersDir, { recursive: true }); fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(papersDir, "PAPER-001 existing.md"), '---\nuid: "paper-u1"\ndisplay_id: "PAPER-001"\ntype: "paper"\ndoi: "10.1016/J.APCATB.2021.119947"\n---\n', "utf8");
  fs.writeFileSync(path.join(evidenceDir, "EVD-001 existing.md"), '---\nuid: "evidence-u1"\ndisplay_id: "EVD-001"\ntype: "evidence"\nsource_uid: "paper-u1"\ntarget_uid: "hyp-u1"\n---\n', "utf8");
  const res = await request("/v1/seed-reconstruction/dedup", { method: "POST", body: JSON.stringify({ dois: ["10.1016/j.apcatb.2021.119947"] }) });
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.papers["10.1016/j.apcatb.2021.119947"].display_id, "PAPER-001");
  assert.equal(payload.evidence[0].display_id, "EVD-001");
});
