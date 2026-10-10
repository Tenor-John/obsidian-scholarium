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

test("[L1] both 研究推演室 bridgeFetch paths resolve this Vault's own runtime first", () => {
  const sites = [...main.matchAll(/bridgeFetch(?: = async function \(path, options = \{\}\)| ?\(t, e = \{\}\)) \{[\s\S]{0,900}?await fetch\(/g)];
  assert.equal(sites.length, 2, "the class method and the 2.0.9 command-bar override");
  for (const [site] of sites) assert.match(site, /await schDeductionBridgeBase\(this\.host\)/);
});

test("[L1] the resolver uses the reported canvas port and the shared verified start path", () => {
  const start = main.indexOf("async function schDeductionBridgeBase(host)");
  assert.ok(start > 0);
  const body = main.slice(start, main.indexOf("let schMaterialBridgeEndpointsCache", start));
  assert.match(body, /schVaultBridgePorts\(app\)/);
  assert.match(body, /schStartAndWaitLocalRuntime\(plugin, ports, health\)/);
  assert.match(body, /return `http:\/\/127\.0\.0\.1:\$\{ports\.canvasPort\}\/bridge`/);
  assert.doesNotMatch(code(body), /4173|4318|bridge\.config\.json/);
});

test("[L2] a fresh machine: no reported port → start this Vault's runtime, then use the port it reports", async () => {
  const start = main.indexOf("const schDeductionBridgeChecked = new Map();");
  const end = main.indexOf("let schMaterialBridgeEndpointsCache", start);
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
