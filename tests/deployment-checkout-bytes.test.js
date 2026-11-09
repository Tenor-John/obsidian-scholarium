"use strict";

/* A candidate pin is useful only if a Windows checkout preserves its bytes.
 * Build a temporary repository from the uncommitted candidate, commit only in
 * that temporary directory, then clone it with core.autocrlf=true. */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");
const recordName = "release-candidate-3.0.4-2026-11-09.md";

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function releasePins(clone) {
  const record = fs.readFileSync(path.join(clone, "docs", "audits", recordName), "utf8");
  return new Map([...record.matchAll(/^\| `([^`]+)` \| ([\d,]+) \| `([A-F0-9]{64})` \|$/gm)]
    .map((match) => [match[1], { bytes: Number(match[2].replace(/,/g, "")), hash: match[3].toLowerCase() }]));
}

function git(args) {
  return execFileSync("git", args, { stdio: "pipe" });
}

test("[L1] core.autocrlf=true checkout preserves current candidate and embedded-runtime bytes", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-autocrlf-"));
  const source = path.join(parent, "candidate-source");
  const clone = path.join(parent, "checkout");
  try {
    for (const name of [
      ".gitattributes", "main.js", "manifest.json", "styles.css",
      "tools/runtime-bootstrap.js", `docs/audits/${recordName}`,
    ]) {
      const target = path.join(source, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(root, name), target);
    }
    git(["-C", source, "init", "--quiet"]);
    git(["-C", source, "config", "user.name", "Scholarium Test Fixture"]);
    git(["-C", source, "config", "user.email", "scholarium-fixture@example.invalid"]);
    git(["-C", source, "add", "--all"]);
    git(["-C", source, "commit", "--quiet", "-m", "Temporary candidate fixture"]);
    git(["-c", "core.autocrlf=true", "clone", "--quiet", "--no-hardlinks", source, clone]);

    const pins = releasePins(clone);
    assert.deepEqual([...pins.keys()].sort(), ["main.js", "manifest.json", "styles.css"]);
    for (const name of ["main.js", "manifest.json", "styles.css"]) {
      const pin = pins.get(name);
      const file = path.join(clone, name);
      assert.equal(fs.statSync(file).size, pin.bytes, `${name} bytes changed in autocrlf checkout`);
      assert.equal(sha256(file), pin.hash, `${name} SHA-256 changed in autocrlf checkout`);
      assert.equal(sha256(file), sha256(path.join(root, name)), `${name} differs from the current candidate`);
    }
    assert.equal(fs.existsSync(path.join(clone, "ketcher.js")), false);
    assert.equal(fs.existsSync(path.join(clone, "ketcher.css")), false);
    const main = fs.readFileSync(path.join(clone, "main.js"), "utf8");
    assert.match(main, new RegExp(`source_sha256=${sha256(path.join(clone, "tools", "runtime-bootstrap.js"))}`));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
