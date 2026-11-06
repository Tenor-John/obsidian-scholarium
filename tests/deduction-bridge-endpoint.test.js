"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
const code = (text) => text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("[L1] 研究推演室 never talks to the historical fixed Bridge address", () => {
  assert.doesNotMatch(code(main), /127\.0\.0\.1:4173\/bridge/,
    "a fresh machine assigns random ports; a fixed 4173 Bridge would be another Vault's or nothing");
  assert.doesNotMatch(code(main), /fetch\(`\$\{Md\}/, "no request is built from the retired constant");
});

test("[L1] the canonical 研究推演室 bridgeFetch resolves this Vault's own runtime first", () => {
  const sites = [...main.matchAll(/bridgeFetch(?: = async function)?\s*\([^)]*\) \{[\s\S]{0,900}?await fetch\(/g)];
  assert.equal(sites.length, 1, "the recovered room has one canonical Bridge path");
  for (const [site] of sites) assert.match(site, /await schDeductionBridgeBase\(this\.host\)/);
});

test("[L1] the resolver uses the reported canvas port and the shared verified start path", () => {
  const start = main.indexOf("async function schDeductionBridgeBase(host)");
  assert.ok(start > 0);
  const body = main.slice(start, main.indexOf("var schMaterialBridgeEndpointsCache", start));
  assert.match(body, /schVaultBridgePorts\(app\)/);
  assert.match(body, /schStartAndWaitLocalRuntime\(plugin, ports, health\)/);
  assert.match(body, /return `http:\/\/127\.0\.0\.1:\$\{ports\.canvasPort\}\/bridge`/);
  assert.doesNotMatch(code(body), /4173|4318|bridge\.config\.json/);
});

test("[L2] a fresh machine: no reported port → start this Vault's runtime, then use the port it reports", async () => {
  const start = main.indexOf("var schDeductionBridgeChecked =");
  const end = main.indexOf("var schMaterialBridgeEndpointsCache", start);
  assert.ok(start >= 0 && end > start, "deduction Bridge resolver region must exist");
  const ports = { scope: "vabc", canvasPort: 0, bridgePort: 0 };
  const calls = [];
  const sandbox = new Function("schVaultBridgePorts", "schStartAndWaitLocalRuntime", "fetch", "window",
    `${main.slice(start, end)}\nreturn schDeductionBridgeBase;`);
  const resolve = sandbox(
    (app) => { calls.push(["ports", app && app.id]); return ports; },
    async (plugin, p, health) => { calls.push(["start", plugin.id]); p.canvasPort = 51234; return health(); },
    async (url) => { calls.push(["fetch", url]); return { ok: true, json: async () => ({ ok: true }) }; },
    { setTimeout: () => 0, clearTimeout: () => {} },
  );
  const host = { app: { id: "app" }, plugin: { id: "plugin", app: { id: "app" } } };
  assert.equal(await resolve(host), "http://127.0.0.1:51234/bridge");
  assert.deepEqual(calls.map((c) => c[0]), ["ports", "start", "fetch"]);
  assert.equal(calls[2][1], "http://127.0.0.1:51234/bridge/health");
  calls.length = 0;
  assert.equal(await resolve(host), "http://127.0.0.1:51234/bridge", "a recent check is reused");
  assert.deepEqual(calls.map((c) => c[0]), ["ports"]);
});
