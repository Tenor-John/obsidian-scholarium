"use strict";
/**
 * The de-duplication audit. It deletes nothing, so what it must get right is
 * which copies it declares safe to touch.
 */
const { describe, it, assert } = require("./harness");
const A = require("../tools/pdf-dedupe-audit");
const { source } = require("./harness");

const file = (over = {}) => ({
  path: "literature/a.pdf", sha256: "a".repeat(64), bytes: 1000, doi: "10.1000/x",
  classification: "pdf_canonical_candidate", linked_from: [], ambiguous_links: [],
  duplicate_group_size: 1, proposed_keeper: "", link_critical: false,
  has_text_layer: true, encrypted: false, ...over,
});
const inventory = (files) => ({ kind: "scholarium-pdf-inventory", files });
const only = (r) => { assert.eq(r.groups.length, 1); return r.groups[0]; };

describe("pdf dedupe audit: what may be touched", () => {
  it("never proposes an action", () => {
    const r = A.report(inventory([file(), file({ path: "literature/b.pdf", classification: "pdf_exact_duplicate" })]));
    assert.eq(r.action, "none");
  });

  it("calls an unreferenced identical copy safe to reduce", () => {
    const g = only(A.report(inventory([
      file({ path: "literature/keep.pdf" }),
      file({ path: "literature/spare.pdf", classification: "pdf_exact_duplicate" }),
    ])));
    assert.eq(g.safe_to_reduce, 1);
    assert.eq(g.blocked, 0);
    assert.eq(g.reclaimable_bytes, 1000);
  });

  it("blocks a copy a note points at directly", () => {
    const g = only(A.report(inventory([
      file({ path: "literature/keep.pdf" }),
      file({ path: "literature/cited.pdf", classification: "pdf_exact_duplicate", linked_from: ["Research/n.md"] }),
    ])));
    assert.eq(g.safe_to_reduce, 0);
    assert.eq(g.blocked, 1);
    assert.match(g.others[0].blockers.join(" "), /直接引用/);
  });

  it("blocks a copy whose basename is referenced elsewhere", () => {
    // Obsidian resolves [[name.pdf]] by basename, so an identical file under a
    // referenced name is not interchangeable with the keeper.
    const g = only(A.report(inventory([
      file({ path: "literature/keep.pdf", linked_from: ["Research/a.md"] }),
      file({ path: "literature/other/keep.pdf", classification: "pdf_exact_duplicate" }),
    ])));
    assert.eq(g.blocked, 0, "same basename as the keeper: the link survives");

    const g2 = only(A.report(inventory([
      file({ path: "literature/keep.pdf", linked_from: ["Research/a.md"] }),
      file({ path: "literature/Gong2019.pdf", classification: "pdf_exact_duplicate", ambiguous_links: ["Research/b.md"] }),
    ])));
    assert.eq(g2.blocked, 1);
    assert.match(g2.others[0].blockers.join(" "), /断链|歧义/);
  });

  it("blocks a scan even when it is byte-identical to the keeper", () => {
    const g = only(A.report(inventory([
      file({ path: "literature/keep.pdf" }),
      file({ path: "literature/scan.pdf", classification: "pdf_scanned_or_encrypted", has_text_layer: false }),
    ])));
    assert.eq(g.blocked, 1);
    assert.match(g.others[0].blockers.join(" "), /扫描件或加密件/);
  });

  it("ignores files that are not duplicated at all", () => {
    const r = A.report(inventory([file({ path: "literature/solo.pdf" })]));
    assert.eq(r.groups.length, 0);
    assert.eq(r.totals.duplicate_copies, 0);
  });

  it("counts blocked copies in duplicate_bytes but not in reclaimable", () => {
    const r = A.report(inventory([
      file({ path: "literature/keep.pdf" }),
      file({ path: "literature/free.pdf", classification: "pdf_exact_duplicate" }),
      file({ path: "literature/held.pdf", classification: "pdf_exact_duplicate", linked_from: ["n.md"] }),
    ]));
    assert.eq(r.totals.reclaimable_bytes, 1000);
    assert.eq(r.totals.duplicate_bytes, 2000);
    assert.eq(r.totals.safely_reducible, 1);
    assert.eq(r.totals.blocked, 1);
  });

  it("renders a report that states it changed nothing", () => {
    const md = A.toMarkdown(A.report(inventory([
      file({ path: "literature/keep.pdf" }),
      file({ path: "literature/spare.pdf", classification: "pdf_exact_duplicate" }),
    ])));
    assert.match(md, /不删除、不移动任何文件/);
  });
});

describe("pdf downloader: no more -2 copies", () => {
  it("compares content before minting another copy", () => {
    // The old loop appended -2, -3, -4 for as long as a file existed, without
    // asking whether it was the same paper. One article ended up stored eleven
    // times.
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "..", "agent-canvas-demo", "bridge", "server.js"), "utf8");
    assert.noMatch(src, /while \(fs\.existsSync\(target\)\)/,
      "the unconditional rename loop must be gone");
    assert.match(src, /already_present/);
    assert.match(src, /variant-/, "a genuinely different rendering is named, not numbered");
    assert.match(src, /createHash/);
  });
});
