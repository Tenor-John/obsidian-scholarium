"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sha256, readPins, verifyDeploymentRuntime } = require("../tools/verify-deployment-runtime.js");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sch-runtime-deploy-gate-"));
  const runtimeRoot = path.join(root, "runtime");
  const packDir = path.join(root, "release");
  fs.mkdirSync(packDir, { recursive: true });
  const pack = Buffer.from("verified local runtime pack");
  const manifest = {
    schema: "scholarium-runtime-pack/1",
    version: "2.0.9-preview.test",
    platform: "win32-x64",
    packs: [{ name: "core", file: "core.tar.gz", sha256: sha256(pack), size: pack.length, required: true }],
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const main = `var SCH_RUNTIME_RELEASE = Object.freeze({\n` +
    `version: "${manifest.version}", platform: "${manifest.platform}",\n` +
    `manifestUrl: "https://example.invalid/manifest.json", manifestSha256: "${sha256(manifestBytes)}"\n});`;
  const mainPath = path.join(root, "main.js");
  const manifestPath = path.join(packDir, "manifest.json");
  fs.writeFileSync(mainPath, main);
  fs.writeFileSync(manifestPath, manifestBytes);
  fs.writeFileSync(path.join(packDir, "core.tar.gz"), pack);
  return { root, runtimeRoot, packDir, mainPath, manifestPath, manifest };
}

test("[L1] deployment gate accepts the exact active pinned runtime", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(f.runtimeRoot, "versions", f.manifest.version, "core"), { recursive: true });
  fs.writeFileSync(path.join(f.runtimeRoot, "current.json"), JSON.stringify({
    version: f.manifest.version, previous: "preview.previous", packs: ["core"],
  }));
  const result = verifyDeploymentRuntime(f);
  assert.equal(result.mode, "installed");
  assert.equal(result.previousVersion, "preview.previous");
});

test("[L1] deployment gate accepts an exact verified local pack when runtime is absent", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const result = verifyDeploymentRuntime(f);
  assert.deepEqual(result, { mode: "local-pack", version: f.manifest.version, platform: f.manifest.platform, packs: ["core"] });
  assert.equal(fs.existsSync(path.join(f.runtimeRoot, "current.json")), false, "preflight must be read-only");
});

test("[L1] deployment gate rejects a missing, altered, or wrong-version local runtime", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  fs.rmSync(path.join(f.packDir, "core.tar.gz"));
  assert.throws(() => verifyDeploymentRuntime(f), /pack is missing/);
  fs.writeFileSync(path.join(f.packDir, "core.tar.gz"), "altered");
  assert.throws(() => verifyDeploymentRuntime(f), /size mismatch/);
  fs.writeFileSync(path.join(f.packDir, "core.tar.gz"), Buffer.from("verified local runtime pack"));
  const main = fs.readFileSync(f.mainPath, "utf8").replace(f.manifest.version, "different-version");
  fs.writeFileSync(f.mainPath, main);
  assert.throws(() => verifyDeploymentRuntime(f), /manifest SHA-256 does not match|version .* does not match/);
});

test("[L1] runtime release pins are mandatory and parsed from the deployed bundle", () => {
  assert.throws(() => readPins("var nothing = true;"), /does not contain SCH_RUNTIME_RELEASE/);
});
