"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");

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

test("release metadata names a numeric desktop Preview owned by its copyright holder", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.version, "2.0.9");
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

test("the frozen Preview assets match the reviewed stability record", () => {
  const record = fs.readFileSync(
    path.join(root, "docs", "audits", "release-2.0.9-stability-2026-09-20.md"),
    "utf8",
  );
  const expected = new Map();
  for (const match of record.matchAll(/^\| `([^`]+)` \| ([\d,]+) \| `([A-F0-9]{64})` \|$/gm)) {
    expected.set(match[1], { bytes: Number(match[2].replace(/,/g, "")), hash: match[3] });
  }

  for (const name of ["main.js", "manifest.json", "styles.css", "ketcher.js", "ketcher.css"]) {
    const pin = expected.get(name);
    assert.ok(pin, `${name} is not pinned in the stability record`);
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
