"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const { normalizeTarget, auditVault } = require("../tools/vault-link-audit");

function vault(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sch-links-"));
  for (const [name, body] of Object.entries(files)) {
    const file = path.join(root, ...name.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body, "utf8");
  }
  return root;
}

describe("whole-vault Obsidian link audit", () => {
  it("normalizes aliases and block fragments without losing the note target", () => {
    assert.eq(normalizeTarget("Folder/Note#Heading|label"), "Folder/Note");
    assert.eq(normalizeTarget("#local heading"), "");
  });

  it("accepts exact, relative and unique-shortest-path links", () => {
    const root = vault({
      "Home.md": "[[Research/Exact]] [[Unique]]",
      "Research/Exact.md": "[[Sibling]]",
      "Research/Sibling.md": "ok",
      "Elsewhere/Unique.md": "ok",
    });
    const report = auditVault(root);
    assert.deepEq(report.unresolved, []);
    assert.deepEq(report.ambiguous, []);
  });

  it("separates missing targets from ambiguous basename links", () => {
    const root = vault({
      "Home.md": "[[Missing]]\n[[Same]]",
      "A/Same.md": "a",
      "B/Same.md": "b",
    });
    const report = auditVault(root);
    assert.eq(report.unresolved.length, 1);
    assert.eq(report.unresolved[0].target, "Missing");
    assert.eq(report.ambiguous.length, 1);
    assert.eq(report.ambiguous[0].matches.length, 2);
  });

  it("does not audit dot-directories that Obsidian excludes from the note graph", () => {
    const root = vault({ "Home.md": "ok", ".trash/Old.md": "[[Missing]]" });
    const report = auditVault(root);
    assert.eq(report.scanned_markdown, 1);
    assert.deepEq(report.unresolved, []);
  });
});
