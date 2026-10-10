"use strict";

/**
 * R1 deployment preflight.
 *
 * A generated main.js may be deployed only when its pinned runtime is already
 * active on this machine, or the exact manifest/core pair is present locally
 * and passes every pinned hash/size/platform check. This command is read-only:
 * it proves installability without mutating the active runtime.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const bootstrap = require("./runtime-bootstrap.js");

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readPins(mainSource) {
  const block = mainSource.match(/var SCH_RUNTIME_RELEASE = Object\.freeze\(\{([\s\S]*?)\}\);/);
  if (!block) throw new Error("main.js does not contain SCH_RUNTIME_RELEASE");
  const value = (name) => {
    const match = block[1].match(new RegExp(`${name}:\\s*"([^"]+)"`));
    if (!match) throw new Error(`SCH_RUNTIME_RELEASE is missing ${name}`);
    return match[1];
  };
  return {
    version: value("version"),
    platform: value("platform"),
    manifestUrl: value("manifestUrl"),
    manifestSha256: value("manifestSha256"),
  };
}

function verifyLocalPack({ pins, manifestPath, packDir }) {
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    throw new Error("pinned runtime is not installed and no local manifest is available");
  }
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifestHash = sha256(manifestBytes);
  if (manifestHash !== pins.manifestSha256) {
    throw new Error(`local manifest SHA-256 does not match main.js pin: ${manifestHash}`);
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  if (manifest.schema !== bootstrap.MANIFEST_SCHEMA) throw new Error(`unexpected runtime manifest schema: ${manifest.schema}`);
  if (manifest.version !== pins.version) throw new Error(`local runtime version ${manifest.version} does not match ${pins.version}`);
  if (manifest.platform !== pins.platform) throw new Error(`local runtime platform ${manifest.platform} does not match ${pins.platform}`);
  const required = (manifest.packs || []).filter((pack) => pack.required);
  if (required.length === 0) throw new Error("local runtime manifest has no required packs");
  for (const pack of required) {
    const file = path.join(packDir || path.dirname(manifestPath), pack.file || path.basename(pack.url || ""));
    if (!fs.existsSync(file)) throw new Error(`local runtime pack is missing: ${path.basename(file)}`);
    const bytes = fs.readFileSync(file);
    if (bytes.length !== pack.size) throw new Error(`local runtime pack size mismatch: ${path.basename(file)}`);
    const actual = sha256(bytes);
    if (actual !== pack.sha256) throw new Error(`local runtime pack SHA-256 mismatch: ${path.basename(file)}`);
  }
  return { mode: "local-pack", version: pins.version, platform: pins.platform, packs: required.map((pack) => pack.name) };
}

function verifyDeploymentRuntime({ mainPath, runtimeRoot, manifestPath, packDir }) {
  const pins = readPins(fs.readFileSync(mainPath, "utf8"));
  const current = bootstrap.status(runtimeRoot);
  if (current.state === "ready" && current.activeVersion === pins.version) {
    return { mode: "installed", version: pins.version, platform: pins.platform, previousVersion: current.previousVersion };
  }
  return verifyLocalPack({ pins, manifestPath, packDir });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`unexpected argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[++i];
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    out[key] = value;
  }
  return out;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const repoRoot = path.join(__dirname, "..");
    const result = verifyDeploymentRuntime({
      mainPath: path.resolve(args.main || path.join(repoRoot, "main.js")),
      runtimeRoot: path.resolve(args["runtime-root"] || bootstrap.defaultRuntimeRoot()),
      manifestPath: args.manifest ? path.resolve(args.manifest) : null,
      packDir: args["pack-dir"] ? path.resolve(args["pack-dir"]) : null,
    });
    process.stdout.write(`runtime deployment gate passed (${result.mode}): ${result.version} ${result.platform}\n`);
  } catch (error) {
    process.stderr.write(`runtime deployment gate failed: ${error.message || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = { sha256, readPins, verifyLocalPack, verifyDeploymentRuntime, parseArgs };
