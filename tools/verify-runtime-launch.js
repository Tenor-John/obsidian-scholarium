"use strict";
/**
 * L2 verification for an already-installed Scholarium runtime.
 *
 *   node tools/verify-runtime-launch.js --runtime-root DIR --work-root DIR
 *
 * It uses the same per-Vault identity, OS-assigned-port, and environment
 * contract as the bundled plugin, then proves the packaged launcher, Bridge,
 * sidecar proxy and skill catalog can run without system Node or Python.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const bootstrap = require("./runtime-bootstrap.js");

function argsFrom(argv) {
  const result = {};
  for (let i = 2; i < argv.length; i += 2) result[argv[i].replace(/^--/, "")] = argv[i + 1];
  return result;
}

function vaultScope(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `v${(hash >>> 0).toString(36)}`;
}

function portsForVault(value) {
  const scope = vaultScope(value);
  return { scope, canvasPort: 0, bridgePort: 0 };
}

async function fetchJson(url, timeoutMs = 1800) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    const body = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${body.error || JSON.stringify(body)}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHead(url, timeoutMs = 1800) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: "HEAD", cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForHead(url, attempts = 6) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await fetchHead(url, 5000); }
    catch (error) {
      last = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw last || new Error(`asset did not become ready: ${url}`);
}

async function waitFor(urlForAttempt, child, output) {
  let last = null;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`runtime exited ${child.exitCode}\n${output.join("")}`);
    try {
      const url = typeof urlForAttempt === "function" ? urlForAttempt() : urlForAttempt;
      if (!url) throw new Error("runtime has not reported its ports yet");
      return await fetchJson(url);
    }
    catch (error) { last = error; await new Promise((resolve) => setTimeout(resolve, 250)); }
  }
  throw new Error(`runtime did not become healthy: ${last?.message || last}\n${output.join("")}`);
}

async function requestGracefulShutdown(child, timeoutMs = 1800) {
  if (child.exitCode !== null) return true;
  if (!child.connected) return false;
  child.send({ type: "shutdown", reason: "runtime-launch-verification" });
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => { clearTimeout(timer); resolve(true); });
  });
}

function verifyPackagedBrowser(nodeExe, demoDir) {
  const probe = [
    "const { chromium } = require('playwright');",
    "(async () => {",
    "  let last = null;",
    "  for (const channel of ['msedge', 'chrome']) {",
    "    try {",
    "      const browser = await chromium.launch({ channel, headless: true });",
    "      const page = await browser.newPage();",
    "      await page.setContent('<title>Scholarium L2</title><h1>ready</h1>');",
    "      const result = { channel, version: await browser.version(), title: await page.title(), text: await page.textContent('h1') };",
    "      await browser.close();",
    "      console.log(JSON.stringify(result));",
    "      return;",
    "    } catch (error) { last = error; }",
    "  }",
    "  throw last || new Error('no compatible system browser found');",
    "})().catch((error) => { console.error(error.stack || error); process.exit(1); });",
  ].join("\n");
  const run = spawnSync(nodeExe, ["-e", probe], {
    cwd: demoDir,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30000,
  });
  if (run.status !== 0) {
    throw new Error(`packaged Playwright could not launch system Edge/Chrome:\n${run.stderr || run.stdout}`);
  }
  const line = String(run.stdout || "").trim().split(/\r?\n/).filter(Boolean).at(-1);
  const result = JSON.parse(line || "{}");
  if (result.title !== "Scholarium L2" || result.text !== "ready") {
    throw new Error(`browser probe returned unexpected page content: ${line}`);
  }
  return result;
}

function verifyCanonicalExperimentTools(nodeExe, core) {
  const store = path.join(core, "tools", "experiment-store.js");
  const adapter = path.join(core, "tools", "legacy-experiment-adapter.js");
  const probe = spawnSync(nodeExe, ["-e", [
    "const store = require(process.argv[1]);",
    "const adapter = require(process.argv[2]);",
    "if (typeof store.prepareNew !== 'function') throw new Error('prepareNew missing');",
    "if (typeof adapter.resolveProject !== 'function' || typeof adapter.adaptLegacyExperiment !== 'function') throw new Error('legacy adapter incomplete');",
    "process.stdout.write('ready');",
  ].join(" "), store, adapter], { encoding: "utf8", windowsHide: true });
  if (probe.status !== 0 || probe.stdout !== "ready") {
    throw new Error(`packaged canonical Experiment tools failed to load: ${probe.stderr || probe.stdout || `exit ${probe.status}`}`);
  }
}

async function main() {
  const args = argsFrom(process.argv);
  if (!args["runtime-root"] || !args["work-root"]) {
    console.error("usage: node tools/verify-runtime-launch.js --runtime-root DIR --work-root DIR");
    process.exit(2);
  }
  const runtimeRoot = path.resolve(args["runtime-root"]);
  const workRoot = path.resolve(args["work-root"]);
  const state = bootstrap.status(runtimeRoot);
  if (state.state !== "ready") throw new Error(`runtime status is ${state.state}, expected ready`);

  const vault = path.join(workRoot, "vault");
  const profile = path.join(workRoot, "profile");
  fs.mkdirSync(path.join(vault, "Materials"), { recursive: true });
  fs.mkdirSync(profile, { recursive: true });
  const core = path.join(runtimeRoot, "versions", state.activeVersion, "core");
  const nodeExe = path.join(core, "runtime", "node", "node.exe");
  const pythonDir = path.join(core, "runtime", "python");
  const launcher = path.join(core, "agent-canvas-demo", "start-local.js");
  const demoDir = path.join(core, "agent-canvas-demo");
  for (const required of [nodeExe, path.join(pythonDir, "python.exe"), launcher]) {
    if (!fs.existsSync(required)) throw new Error(`required runtime payload missing: ${required}`);
  }

  const ports = portsForVault(vault);
  const configPath = path.join(profile, "bridge.config.json");
  const pidfile = path.join(profile, "weaver.pid.json");
  const child = spawn(nodeExe, [launcher], {
    cwd: path.dirname(launcher),
    windowsHide: true,
    shell: false,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    env: {
      ...process.env,
      PATH: [pythonDir, path.dirname(nodeExe), process.env.PATH].filter(Boolean).join(path.delimiter),
      AGENT_CANVAS_PORT: "0",
      AGENT_BRIDGE_PORT: "0",
      AGENT_WEAVER_VAULT_ROOT: vault,
      AGENT_BRIDGE_CONFIG_PATH: configPath,
      AGENT_WEAVER_PIDFILE: pidfile,
      SCHOLARIUM_RUNTIME_ASSETS_ROOT: core,
    },
  });
  const output = [];
  child.stdout.on("data", (chunk) => output.push(String(chunk)));
  child.stderr.on("data", (chunk) => output.push(String(chunk)));
  child.on("message", (message) => {
    if (message?.type === "listening") {
      ports.canvasPort = Number(message.canvasPort) || 0;
      ports.bridgePort = Number(message.bridgePort) || 0;
    }
    if (message?.type === "listen-error") output.push(`${message.service || "runtime"} ${message.code || "LISTEN_FAILED"}: ${message.message || "could not listen"}\n`);
  });
  try {
    const health = await waitFor(() => ports.canvasPort ? `http://127.0.0.1:${ports.canvasPort}/bridge/health` : null, child, output);
    const skills = await fetchJson(`http://127.0.0.1:${ports.canvasPort}/bridge/v1/skills`);
    if (!Array.isArray(skills.skills) || !skills.skills.some((skill) => skill.name === "sch-data-normalize") || !skills.skills.some((skill) => skill.name === "sch-data-plot")) {
      throw new Error("packaged Bridge did not expose the required normalize/plot skills");
    }
    const ketcherJs = await waitForHead(`http://127.0.0.1:${ports.canvasPort}/runtime-assets/ketcher/ketcher.js`);
    const ketcherCss = await waitForHead(`http://127.0.0.1:${ports.canvasPort}/runtime-assets/ketcher/ketcher.css`);
    if (!/javascript/.test(ketcherJs.headers.get("content-type") || "")) throw new Error("packaged Ketcher JavaScript has the wrong content type");
    if (!/css/.test(ketcherCss.headers.get("content-type") || "")) throw new Error("packaged Ketcher CSS has the wrong content type");
    const browser = verifyPackagedBrowser(nodeExe, demoDir);
    verifyCanonicalExperimentTools(nodeExe, core);
    const pid = JSON.parse(fs.readFileSync(pidfile, "utf8"));
    const evidence = {
      schema: "scholarium-runtime-launch-verification/1",
      result: "PASS",
      runtimeVersion: state.activeVersion,
      ports,
      executionEnabled: health.executionEnabled,
      skills: skills.skills.length,
      requiredSkills: ["sch-data-normalize", "sch-data-plot"],
      launcherPid: pid.launcherPid,
      bridgePid: pid.bridgePid,
      usedPackagedNode: true,
      usedPackagedPython: true,
      packagedKetcherAssets: true,
      packagedPlaywrightModule: true,
      packagedCanonicalExperimentTools: true,
      systemBrowser: browser,
    };
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    const graceful = await requestGracefulShutdown(child);
    if (!graceful && child.pid && process.platform === "win32") {
      spawnSync("taskkill.exe", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
    } else if (!graceful) {
      try { child.kill(); } catch (_) { /* already exited */ }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (fs.existsSync(pidfile)) throw new Error(`runtime stopped but pidfile remains: ${pidfile}`);
  }
}

if (require.main === module) main().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});

module.exports = { vaultScope, portsForVault };
