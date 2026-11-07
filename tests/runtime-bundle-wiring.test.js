"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
const bootstrapSource = fs.readFileSync(path.join(root, "tools", "runtime-bootstrap.js"), "utf8");
const logoBytes = fs.readFileSync(path.join(root, "assets", "logo.png"));
const launcherSource = fs.readFileSync(path.join(root, "agent-canvas-demo", "start-local.js"), "utf8");
const bridgeSource = fs.readFileSync(path.join(root, "agent-canvas-demo", "bridge", "server.js"), "utf8");
const manifestPath = path.join(root, "release", "scholarium-runtime-manifest-2.0.9-preview.4.json");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function between(source, begin, end) {
  const start = source.indexOf(begin);
  const finish = source.indexOf(end, start + begin.length);
  assert.notEqual(start, -1, `missing ${begin}`);
  assert.notEqual(finish, -1, `missing ${end}`);
  return source.slice(start, finish + end.length);
}

test("[L1] bundled runtime bootstrap is mechanically tied to its reviewed source", () => {
  const sourceHash = sha256(bootstrapSource);
  assert.match(main, new RegExp(`source_sha256=${sourceHash}`));
  const block = between(
    main,
    "/* SCHOLARIUM_RUNTIME_BOOTSTRAP_EMBED_BEGIN */",
    "/* SCHOLARIUM_RUNTIME_BOOTSTRAP_EMBED_END */",
  );
  const context = { window: { require }, process, Buffer, fetch, result: null };
  vm.runInNewContext(`${block}\nresult = schRuntimeBootstrap;`, context, { filename: "embedded-runtime-bootstrap.js" });
  for (const name of ["status", "install", "installFromIncoming", "rollback", "resolveRoot"]) {
    assert.equal(typeof context.result[name], "function", `${name} missing from embedded bootstrap`);
  }
});

test("[L1] release manifest bytes and URL are pinned in the bundle", () => {
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  assert.match(main, new RegExp(`manifestSha256: "${sha256(manifestBytes)}"`));
  assert.match(main, new RegExp(`version: "${manifest.version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(main, /scholarium-runtime-manifest-2\.0\.9-preview\.4\.json/);
  assert.equal(manifest.packs[0].sha256, "91c7e74e46c2da635a8092badefc072d93a48f6131155fd7be2eff1c296257f0");
});

test("[L1] Weaver and Material Library share the verified runtime start path", () => {
  const mount = between(main, "const ensure = async (view, ports) => {", "const recoverLegacyBrowserState");
  assert.match(mount, /schStartAndWaitLocalRuntime\(view\.plugin, ports/);
  assert.doesNotMatch(mount, /spawn\("node"/);

  const bridge = between(main, "async function schMaterialBridgeJson", "var SCH_MATERIAL_DEFAULT_SKILLS");
  assert.match(bridge, /schStartAndWaitLocalRuntime\(plugin, ports, health\)/);
  assert.match(bridge, /__schRuntimeRetried/);
  assert.match(bridge, /schMaterialBridgeEndpointsCache\.delete\(ports\.scope\)/);
  const resolver = between(main, "async function schResolveRuntimeLaunchSpec", "async function schSpawnLocalRuntime");
  assert.match(resolver, /return schEnsureRuntimeInstalled\(plugin, onProgress\)/);
  assert.doesNotMatch(resolver, /legacy|catch/,
    "a rejected runtime must not fall back to unverified plugin-directory bytes");
});

test("[L1] plugin-side canonical tools load only from the verified core", () => {
  const loader = between(main, "function schEvidenceTools", "// src/ai-chat-modal.ts");
  assert.match(loader, /schRuntimeBootstrap\.status\(runtimeRoot\)/);
  assert.match(loader, /runtimeState\.activeVersion !== SCH_RUNTIME_RELEASE\.version/);
  assert.match(loader, /path\d*\.join\(runtimeRoot, "versions", runtimeState\.activeVersion, "core"\)/);
  assert.match(loader, /path\d*\.join\(toolsRoot, "experiment-store\.js"\)/);
  assert.match(loader, /path\d*\.join\(toolsRoot, "legacy-experiment-adapter\.js"\)/);
  assert.doesNotMatch(loader, /plugin\.manifest\.id|configDir|\.obsidian/,
    "three-file installs must not require unshipped plugin-directory tools");

  const onload = between(main, "const schScholariumBridgeOnload", "// src/persistent-dashboard-host.ts");
  assert.match(onload, /this\.__schRuntimeReadyPromise = this\.__schEnsureRuntime\(\)/);
});

test("[L1] Material Library runtime endpoint caches are isolated per Vault", () => {
  const cache = between(
    main,
    "var schMaterialBridgeEndpointsCache =",
    "async function schMaterialBridgeJson",
  );
  assert.match(cache, /const cacheKey = schRuntimeScope\(plugin\.app\)/);
  assert.match(cache, /schMaterialBridgeEndpointsCache\.has\(cacheKey\)/);
  assert.match(cache, /schMaterialBridgeEndpointsCache\.set\(cacheKey, endpoints\)/);
  assert.doesNotMatch(cache, /schMaterialBridgeEndpointsCache\s*=\s*endpoints/);
  const executable = cache.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(executable, /bridge\.config\.json|\b4318\b|\b4173\b|\bMd\b/,
    "a Vault must not fall back to a shared or plugin-directory Bridge");
});

test("[L1] plugin unload owns the runtime process tree", () => {
  const onload = between(main, "const schScholariumBridgeOnload", "// src/persistent-dashboard-host.ts");
  assert.match(onload, /this\.register\(\(\) => schStopLocalRuntime\(schRuntimeScope\(this\.app\)\)\)/);
  assert.match(main, /stdio: \["ignore", "pipe", "pipe", "ipc"\]/);
  assert.match(main, /child\.send\(\{ type: "shutdown", reason: "plugin-unload" \}\)/);
  assert.match(main, /taskkill\.exe[\s\S]{0,160}"\/T"[\s\S]{0,80}"\/F"/);
});

test("[L1] the three-file plugin embeds the reviewed logo without an unshipped asset dependency", () => {
  assert.doesNotMatch(main, /manifest\.dir\s*\+\s*["']\/assets\/logo\.png/);
  assert.doesNotMatch(main, /getResourcePath\([^)]*assets\/logo\.png/);
  assert.match(main, new RegExp(`source_sha256=${sha256(logoBytes)}`));
  assert.match(main, /var SCHOLARIUM_LOGO_DATA_URL = "data:image\/png;base64,[A-Za-z0-9+/=]+";/);
  const brand = between(main, "const originalBrandBar = proto.renderBrandBar;", "const originalRender = proto.render;");
  assert.match(brand, /logo\.src = SCHOLARIUM_LOGO_DATA_URL/);
  const plotter = between(main, "async function schOpenMaterialPlotter", "async function schOpenMaterialDatasetPicker");
  assert.match(plotter, /src: SCHOLARIUM_LOGO_DATA_URL/);
});

test("[L1] Ketcher and its styles are statically bundled without runtime script loading", () => {
  assert.match(main, /\/\/ src\/chem\/ketcher-runtime\.tsx/);
  assert.match(main, /StandaloneStructServiceProvider/);
  const styles = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  const ketcherSource = fs.readFileSync(path.join(root, "src", "chem", "ketcher-runtime.tsx"), "utf8");
  assert.match(styles, /SCHOLARIUM_KETCHER_STYLES_BEGIN/);
  assert.match(styles, /SCHOLARIUM_KETCHER_STYLES_END/);
  assert.doesNotMatch(ketcherSource, /createElement\(["']style["']\)/);
  assert.doesNotMatch(main, /schEnsureKetcherStyle/);
  assert.doesNotMatch(main, /runtime-assets\/ketcher\//);
  assert.doesNotMatch(main, /createElement\(["']script["']\)/);
});

test("[L1] runtime ports are assigned by the owning processes and reported over IPC", () => {
  const spawn = between(main, "async function schSpawnLocalRuntime", "function schRuntimeFailureDetail");
  assert.match(spawn, /AGENT_CANVAS_PORT: "0"/);
  assert.match(spawn, /AGENT_BRIDGE_PORT: "0"/);
  assert.match(spawn, /child\.on\("message"/);
  assert.match(spawn, /ports\.canvasPort = canvasPort/);
  assert.match(spawn, /ports\.bridgePort = bridgePort/);

  assert.match(launcherSource, /web\.listen\(REQUESTED_PORT/);
  assert.match(launcherSource, /web\.address\(\)/);
  assert.match(launcherSource, /process\.send\(\{ type: 'listening', canvasPort: actualCanvasPort, bridgePort: actualBridgePort/);
  assert.match(bridgeSource, /server\.address\(\)/);
  assert.match(bridgeSource, /process\.send\(\{ type: 'listening', service: 'bridge', port: actualPort \}\)/);
});

test("[L1] XLSX entry translates runtime failures into actionable user text", () => {
  const notice = between(main, "function schDescribeMaterialRuntimeFailure", "async function schOpenMaterialNormalization");
  assert.match(notice, /已尝试自动下载并校验/);
  assert.match(notice, /incoming/);
  assert.match(notice, /原文件未被改动|原文件保持只读/);
  const modal = between(main, "async function schOpenMaterialNormalization", "async function schMaterialRunSkill");
  assert.match(modal, /status\d*\.setText\(schDescribeMaterialRuntimeFailure\(error\d*\)\)/);
});
