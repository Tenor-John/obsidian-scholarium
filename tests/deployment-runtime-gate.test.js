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
  const pack = Buffer.from("verified local runtime pack");
  const embedded = {
    version: "2.0.9-preview.test",
    platform: "win32-x64",
    file: "core.tar.gz",
    sha256: sha256(pack),
    size: pack.length,
  };
  const main = `var SCH_RUNTIME_RELEASE = Object.freeze({\n` +
    `version: "${embedded.version}", platform: "${embedded.platform}"\n});\n` +
    `/* SCHOLARIUM_RUNTIME_PACK_EMBED_BEGIN */\n` +
    `var SCH_EMBEDDED_RUNTIME_PACK = Object.freeze(${JSON.stringify(embedded)});\n` +
    `var SCH_EMBEDDED_RUNTIME_PACK_BASE64 = [\n  "${pack.toString("base64")}"\n].join("");\n` +
    `/* SCHOLARIUM_RUNTIME_PACK_EMBED_END */`;
  const mainPath = path.join(root, "main.js");
  fs.writeFileSync(mainPath, main);
  return { root, runtimeRoot, mainPath, embedded, pack };
}

test("[L1] deployment gate accepts the exact active pinned runtime", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(f.runtimeRoot, "versions", f.embedded.version, "core"), { recursive: true });
  fs.writeFileSync(path.join(f.runtimeRoot, "current.json"), JSON.stringify({
    version: f.embedded.version, previous: "preview.previous", packs: ["core"],
  }));
  const result = verifyDeploymentRuntime(f);
  assert.equal(result.mode, "installed");
  assert.equal(result.previousVersion, "preview.previous");
});

test("[L1] deployment gate accepts the verified embedded pack when runtime is absent", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const result = verifyDeploymentRuntime(f);
  assert.deepEqual(result, { mode: "embedded-pack", version: f.embedded.version, platform: f.embedded.platform, packs: ["core"] });
  assert.equal(fs.existsSync(path.join(f.runtimeRoot, "current.json")), false, "preflight must be read-only");
});

test("[L1] deployment gate rejects an altered or wrong-version embedded runtime", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  let main = fs.readFileSync(f.mainPath, "utf8").replace(f.pack.toString("base64"), Buffer.from("altered").toString("base64"));
  fs.writeFileSync(f.mainPath, main);
  assert.throws(() => verifyDeploymentRuntime(f), /size mismatch/);
  main = main.replace(Buffer.from("altered").toString("base64"), f.pack.toString("base64")).replace(f.embedded.version, "different-version");
  fs.writeFileSync(f.mainPath, main);
  assert.throws(() => verifyDeploymentRuntime(f), /version .* does not match/);
});

test("[L1] runtime release pins are mandatory and parsed from the deployed bundle", () => {
  assert.throws(() => readPins("var nothing = true;"), /does not contain SCH_RUNTIME_RELEASE/);
});
