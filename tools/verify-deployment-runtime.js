"use strict";

/**
 * R1 deployment preflight.
 *
 * A generated main.js may be deployed only when its pinned runtime is already
 * active on this machine, or the exact verified core is embedded in main.js.
 * This command is read-only: it proves installability without mutating the
 * active runtime.
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
  const embedded = mainSource.match(/var SCH_EMBEDDED_RUNTIME_PACK = Object\.freeze\((\{[^\n]+\})\);/);
  if (!embedded) throw new Error("main.js does not contain SCH_EMBEDDED_RUNTIME_PACK");
  const pack = JSON.parse(embedded[1]);
  return { version: value("version"), platform: value("platform"), pack };
}

function verifyEmbeddedPack(mainSource, pins) {
  const start = mainSource.indexOf("/* SCHOLARIUM_RUNTIME_PACK_EMBED_BEGIN */");
  const end = mainSource.indexOf("/* SCHOLARIUM_RUNTIME_PACK_EMBED_END */", start);
  if (start < 0 || end <= start) throw new Error("embedded runtime block is missing");
  const block = mainSource.slice(start, end);
  const chunks = [...block.matchAll(/^\s*"([A-Za-z0-9+/=]+)"[,]?$/gm)].map((match) => match[1]);
  if (!chunks.length) throw new Error("embedded runtime payload is empty");
  const bytes = Buffer.from(chunks.join(""), "base64");
  if (pins.pack.version !== pins.version) throw new Error(`embedded runtime version ${pins.pack.version} does not match ${pins.version}`);
  if (pins.pack.platform !== pins.platform) throw new Error(`embedded runtime platform ${pins.pack.platform} does not match ${pins.platform}`);
  if (bytes.length !== pins.pack.size) throw new Error(`embedded runtime size mismatch: ${bytes.length}`);
  const actual = sha256(bytes);
  if (actual !== pins.pack.sha256) throw new Error(`embedded runtime SHA-256 mismatch: ${actual}`);
  return { mode: "embedded-pack", version: pins.version, platform: pins.platform, packs: ["core"] };
}

function verifyDeploymentRuntime({ mainPath, runtimeRoot }) {
  const mainSource = fs.readFileSync(mainPath, "utf8");
  const pins = readPins(mainSource);
  const current = bootstrap.status(runtimeRoot);
  if (current.state === "ready" && current.activeVersion === pins.version) {
    return { mode: "installed", version: pins.version, platform: pins.platform, previousVersion: current.previousVersion };
  }
  return verifyEmbeddedPack(mainSource, pins);
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
    });
    process.stdout.write(`runtime deployment gate passed (${result.mode}): ${result.version} ${result.platform}\n`);
  } catch (error) {
    process.stderr.write(`runtime deployment gate failed: ${error.message || error}\n`);
    process.exitCode = 1;
  }
}

module.exports = { sha256, readPins, verifyEmbeddedPack, verifyDeploymentRuntime, parseArgs };
