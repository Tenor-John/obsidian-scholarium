"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const candidateRecord = "release-candidate-3.0.1-2026-11-05.md";

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((name) => name.replace(/\\/g, "/"));
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

test("release metadata names a numeric desktop candidate owned by its copyright holder", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(manifest.version, packageJson.version);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.author, "Tao Jiang");
  assert.equal(manifest.isDesktopOnly, true);
  assert.ok(fs.existsSync(path.join(root, "LICENSE")));
  assert.ok(fs.existsSync(path.join(root, "THIRD_PARTY_NOTICES.md")));
});

test("no tracked file is local state, research data, a secret config, or a backup bundle", () => {
  const prohibited = trackedFiles().filter((name) =>
    name === "data.json"
    || name.startsWith("Research/")
    || /(^|\/)bridge\.config\.json$/i.test(name)
    || /(^|\/)\.env$/i.test(name)
    || /^agent-canvas-demo\/bridge\/(audit|runtime)\//i.test(name)
    || /\.bak(?:$|-)/i.test(name)
  );
  assert.deepEqual(prohibited, [], `tracked private/recovery state:\n${prohibited.join("\n")}`);
});

test("one-time artifact recovery inputs and superseded Ketcher assets are absent", () => {
  for (const name of [
    "previous-release-main.js", "previous-release-styles.css",
    "recovered-dashboard-81ad42e.ts", "recovered-main-81ad42e.ts",
    "recovered-research-deduction-room.ts", "recovered-settings-81ad42e.ts",
    "scripts/recover-reviewed-modules.mjs", "scripts/check-recovered-globals.mjs",
    "ketcher.js", "ketcher.css",
  ]) {
    assert.equal(fs.existsSync(path.join(root, name)), false, `${name} must not enter the source-built candidate`);
  }
});

test("the three current candidate assets match the reviewed candidate record", () => {
  const record = fs.readFileSync(path.join(root, "docs", "audits", candidateRecord), "utf8");
  assert.match(record, /candidate only; not an approved public release/i);
  const expected = new Map();
  for (const match of record.matchAll(/^\| `([^`]+)` \| ([\d,]+) \| `([A-F0-9]{64})` \|$/gm)) {
    expected.set(match[1], { bytes: Number(match[2].replace(/,/g, "")), hash: match[3] });
  }
  assert.deepEqual([...expected.keys()].sort(), ["main.js", "manifest.json", "styles.css"]);

  for (const name of ["main.js", "manifest.json", "styles.css"]) {
    const pin = expected.get(name);
    const file = path.join(root, name);
    assert.equal(fs.statSync(file).size, pin.bytes, `${name} byte count drifted`);
    assert.equal(sha256(file), pin.hash, `${name} SHA-256 drifted`);
  }
});

test("documentation distinguishes a three-file-capable candidate from an approved public release", () => {
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  assert.match(readme, /supports the standard three-file Obsidian\/BRAT installation/i);
  assert.match(readme, /release candidate, not a published product release/i);
  assert.match(readme, /real-Obsidian clean-install\/upgrade\/rollback/i);
  assert.match(readme, /second clean Windows machine/i);
  assert.ok(fs.existsSync(path.join(root, "agent-canvas-demo", "start-local.js")));
  assert.ok(fs.existsSync(path.join(root, "agent-canvas-demo", "bridge", "server.js")));
});
