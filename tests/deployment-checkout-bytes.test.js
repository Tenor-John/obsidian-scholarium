"use strict";

/* A release pin is only useful if a Windows checkout preserves its bytes.
 * This reproduces a fresh clone with core.autocrlf=true, then checks the
 * release record and the reviewed-runtime embed inside that checkout. */
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.join(__dirname, "..");

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function releasePins(clone) {
  const record = fs.readFileSync(path.join(clone, "docs", "audits", "release-2.0.9-stability-2026-09-20.md"), "utf8");
  return new Map([...record.matchAll(/^\| `([^`]+)` \| ([\d,]+) \| `([A-F0-9]{64})` \|$/gm)]
    .map((match) => [match[1], { bytes: Number(match[2].replace(/,/g, "")), hash: match[3].toLowerCase() }]));
}

test("[L1] core.autocrlf=true checkout preserves release and embedded-runtime bytes", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-autocrlf-"));
  const clone = path.join(parent, "checkout");
  try {
    execFileSync("git", ["-c", "core.autocrlf=true", "clone", "--quiet", "--no-hardlinks", root, clone], { stdio: "pipe" });
    const pins = releasePins(clone);
    for (const name of ["main.js", "manifest.json", "styles.css", "ketcher.js", "ketcher.css"]) {
      const pin = pins.get(name);
      assert.ok(pin, `${name} missing from clone release record`);
      const file = path.join(clone, name);
      assert.equal(fs.statSync(file).size, pin.bytes, `${name} bytes changed in autocrlf checkout`);
      assert.equal(sha256(file), pin.hash, `${name} SHA-256 changed in autocrlf checkout`);
    }
    const main = fs.readFileSync(path.join(clone, "main.js"), "utf8");
    assert.match(main, new RegExp(`source_sha256=${sha256(path.join(clone, "tools", "runtime-bootstrap.js"))}`));
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
