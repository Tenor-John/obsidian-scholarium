"use strict";
/**
 * The PDF corpus inventory: 340 files the migration ledger had never seen.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const P = require("../tools/pdf-inventory");

/* A minimal but structurally real PDF: `/Font` decides whether a text layer
   exists, `/Encrypt` whether it can be opened at all, and the DOI is read out
   of the bytes rather than the filename. */
function pdf({ doi = "", font = true, encrypted = false, filler = "x" } = {}) {
  return "%PDF-1.7\n"
    + (font ? "/Type /Font /BaseFont /Helvetica\n" : "")
    + (encrypted ? "/Encrypt 12 0 R\n" : "")
    + (doi ? "<rdf:Description dc:identifier='doi:" + doi + "'/>\n" : "")
    + filler.repeat(50) + "\n%%EOF\n";
}

function vault(build) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sch-pdf-"));
  fs.mkdirSync(path.join(root, "literature"), { recursive: true });
  build({
    root,
    put(rel, body) {
      const p = path.join(root, ...rel.split("/"));
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body, "utf8");
      return p;
    },
  });
  return root;
}

const inv = (root) => P.inventory(root, ["literature", "Experiments", "Research"]);
const find = (report, needle) => report.files.find((f) => f.path.includes(needle));

describe("pdf inventory: classification", () => {
  it("gives every file exactly one classification", () => {
    const root = vault(({ put }) => {
      put("literature/a.pdf", pdf({ doi: "10.1000/a" }));
      put("literature/b.pdf", pdf({ doi: "10.1000/b" }));
      put("literature/scan.pdf", pdf({ font: false }));
    });
    const r = inv(root);
    assert.eq(r.counts.scanned, 3);
    assert.ok(r.conservation.every_file_classified);
    const sum = P.CLASSIFICATIONS.reduce((a, c) => a + r.counts[c], 0);
    assert.eq(sum, r.counts.scanned, "the parts must sum to the whole");
  });

  it("stops the DOI at PDF dictionary syntax without losing a valid one", () => {
    // A greedy match ran out of the DOI and into the Info dictionary, producing
    // 10.1038/s41467-023-35860-2)/producer(itext and inflating the unique-DOI
    // count. Elsevier suffixes really do contain balanced parentheses, so they
    // cannot simply be excluded.
    assert.eq(P.trimDoi("10.1038/s41467-023-35860-2)/producer(itext"), "10.1038/s41467-023-35860-2");
    assert.eq(P.trimDoi("10.1016/S0022-2836(05)80360-2"), "10.1016/S0022-2836(05)80360-2");
    assert.eq(P.trimDoi("10.1186/s13568-019-0923-1)/creator(springer"), "10.1186/s13568-019-0923-1");
  });

  it("reads the DOI out of the bytes, not the filename", () => {
    const root = vault(({ put }) => put("literature/anonymous-name.pdf", pdf({ doi: "10.1038/s41467-019-10819-4" })));
    assert.eq(find(inv(root), "anonymous-name").doi, "10.1038/s41467-019-10819-4");
  });

  it("marks byte-identical copies as duplicates and nominates one keeper", () => {
    const body = pdf({ doi: "10.1000/dup" });
    const root = vault(({ put }) => {
      put("literature/paper.pdf", body);
      put("literature/paper-2.pdf", body);
      put("literature/paper-3.pdf", body);
    });
    const r = inv(root);
    const dups = r.files.filter((f) => f.classification === "pdf_exact_duplicate");
    assert.eq(dups.length, 2, "one of the three is kept, not all discarded");
    assert.eq(r.unique_by_content, 1);
    assert.ok(dups.every((d) => d.proposed_keeper && d.proposed_keeper !== d.path));
  });

  it("separates a different rendering of the same DOI from a byte-identical copy", () => {
    // A publisher version and an accepted manuscript share a DOI and differ in
    // bytes. Deleting one is a content decision, not a de-duplication.
    const root = vault(({ put }) => {
      put("literature/published.pdf", pdf({ doi: "10.1000/same", filler: "a" }));
      put("literature/accepted.pdf", pdf({ doi: "10.1000/same", filler: "bb" }));
    });
    const r = inv(root);
    assert.eq(r.files.filter((f) => f.classification === "pdf_version_variant").length, 2);
    assert.eq(r.files.filter((f) => f.classification === "pdf_exact_duplicate").length, 0);
  });

  it("refuses a scanned or encrypted file ahead of any other verdict", () => {
    // A hard limit on what can ever be done with the file. No de-duplication
    // decision changes it, so it is reported first even when the file is also
    // a duplicate.
    const body = pdf({ font: false });
    const root = vault(({ put }) => {
      put("literature/scan.pdf", body);
      put("literature/scan-2.pdf", body);
      put("literature/locked.pdf", pdf({ encrypted: true, doi: "10.1000/x" }));
    });
    const r = inv(root);
    assert.eq(r.counts.pdf_scanned_or_encrypted, 3);
    assert.eq(r.counts.pdf_exact_duplicate, 0);
  });

  it("flags a file with no recoverable DOI rather than calling it canonical", () => {
    const root = vault(({ put }) => put("literature/mystery.pdf", pdf({})));
    assert.eq(find(inv(root), "mystery").classification, "pdf_unidentified");
  });
});

describe("pdf inventory: link audit", () => {
  it("records the notes that point at a file", () => {
    const root = vault(({ put }) => {
      put("literature/cited.pdf", pdf({ doi: "10.1000/c" }));
      put("Research/note.md", "see [[cited.pdf]] for details");
    });
    assert.deepEq(find(inv(root), "cited.pdf").linked_from, ["Research/note.md"]);
  });

  it("resolves a full relative path as well as a bare basename", () => {
    const root = vault(({ put }) => {
      put("literature/deep/paper.pdf", pdf({ doi: "10.1000/d" }));
      put("Research/note.md", "[open](literature/deep/paper.pdf)");
    });
    assert.eq(find(inv(root), "deep/paper.pdf").linked_from.length, 1);
  });

  it("will not let an ambiguous basename vote for a particular copy", () => {
    // Duplication is exactly what makes basenames repeat, so a wikilink that
    // matches several copies cannot justify keeping any one of them.
    const body = pdf({ doi: "10.1000/amb" });
    const root = vault(({ put }) => {
      put("literature/one/same.pdf", body);
      put("literature/two/same.pdf", body);
      put("Research/note.md", "[[same.pdf]]");
    });
    const r = inv(root);
    for (const f of r.files) {
      assert.deepEq(f.linked_from, [], "no copy may claim the link");
      assert.eq(f.ambiguous_links.length, 1);
    }
    assert.eq(r.ambiguously_linked_files, 2);
  });

  it("prefers the linked copy as keeper over an unlinked one", () => {
    const body = pdf({ doi: "10.1000/keep" });
    const root = vault(({ put }) => {
      put("literature/unreferenced.pdf", body);
      put("literature/referenced.pdf", body);
      put("Research/note.md", "[[referenced.pdf]]");
    });
    const r = inv(root);
    const dup = r.files.find((f) => f.classification === "pdf_exact_duplicate");
    assert.match(dup.proposed_keeper, /referenced\.pdf/,
      "a copy a note points at is not interchangeable with one nothing references");
  });

  it("finds references inside canvases, not only notes", () => {
    const root = vault(({ put }) => {
      put("literature/oncanvas.pdf", pdf({ doi: "10.1000/e" }));
      put("Canvases/board.canvas", JSON.stringify({ nodes: [{ file: "literature/oncanvas.pdf" }] }));
    });
    assert.eq(find(inv(root), "oncanvas").linked_from.length, 1);
  });
});

describe("pdf inventory: link-critical duplicates", () => {
  it("names duplicates that must survive because a note links their basename", () => {
    // Obsidian resolves [[name.pdf]] by basename, so keeping one copy per
    // content hash is not sufficient: when a group spans several basenames and
    // a note references a non-keeper, deleting it dangles the link even though
    // the bytes still exist under another name.
    // One link is not enough to create the problem: the linked copy simply
    // becomes the keeper. The bite comes when two different basenames in the
    // same group are each referenced, so whichever is kept, the other dangles.
    const body = pdf({ doi: "10.1000/lc" });
    const root = vault(({ put }) => {
      put("literature/s41467-019.pdf", body);
      put("literature/Gong2019_Structural.pdf", body);
      put("Research/a.md", "[[s41467-019.pdf]]");
      put("Research/b.md", "[[Gong2019_Structural.pdf]]");
    });
    const r = inv(root);
    const critical = r.files.filter((f) => f.link_critical);
    assert.eq(critical.length, 1, "one survives as keeper, the other must be kept deliberately");
    assert.eq(r.link_critical_duplicates, 1);
    assert.eq(r.reclaimable_bytes, 0, "this group frees nothing without dangling a link");
  });

  it("frees a duplicate that nothing references", () => {
    const body = pdf({ doi: "10.1000/free" });
    const root = vault(({ put }) => {
      put("literature/keep.pdf", body);
      put("literature/spare.pdf", body);
    });
    const r = inv(root);
    assert.eq(r.link_critical_duplicates, 0);
    assert.ok(r.reclaimable_bytes > 0);
  });

  it("prefers the original over a re-download suffix when nothing else decides", () => {
    // -2, -3, -6 are what the downloader appends when it fetches the same paper
    // again; the un-suffixed name is the one to keep.
    const body = pdf({ doi: "10.1000/sfx" });
    const root = vault(({ put }) => {
      put("literature/1129493-3.pdf", body);
      put("literature/1129493.pdf", body);
    });
    const dup = inv(root).files.find((f) => f.classification === "pdf_exact_duplicate");
    assert.match(dup.proposed_keeper, /1129493\.pdf$/);
    assert.match(dup.path, /1129493-3\.pdf$/);
  });
});

describe("pdf inventory: the real corpus", () => {
  it("classifies every PDF in the vault", () => {
    const v = path.join(__dirname, "..", "..", "..", "..");
    if (!fs.existsSync(path.join(v, "literature"))) return;
    const r = P.inventory(v);
    assert.ok(r.conservation.every_file_classified);
    const sum = P.CLASSIFICATIONS.reduce((a, c) => a + r.counts[c], 0);
    assert.eq(sum, r.counts.scanned,
      "conservation must cover the whole corpus, not the part that was already visible");
  });
});
