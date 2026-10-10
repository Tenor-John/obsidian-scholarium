"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { describe, it, assert } = require("./harness");
const A = require("../tools/pdf-anchor-sidecar");
const S = require("../tools/schema-objects");

function fakePdf(text, doi = "10.1000/pilot") {
  const stream = Buffer.from("BT (" + text.replace(/[()\\]/g, "\\$&") + ") Tj ET", "latin1");
  const zip = zlib.deflateSync(stream);
  return Buffer.concat([Buffer.from("%PDF-1.7\n/Type /Font /BaseFont /Helvetica\n/Filter /FlateDecode\nstream\n", "latin1"), zip, Buffer.from("\nendstream\n" + doi + "\n%%EOF\n", "latin1")]);
}
function vault(build) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sch-pdf-anchor-"));
  fs.mkdirSync(path.join(root, "literature"), { recursive: true });
  fs.mkdirSync(path.join(root, "Research", "QueryPacks"), { recursive: true });
  const pack = S.serializeObject({
    artifact: "evidence_query_expansion", hypothesis_uid: "h", terms: ["gold nanoparticle"],
    concept_groups: [
      { label: "gold", terms: ["gold nanoparticle"] },
      { label: "bivo4", terms: ["bivo4"] },
      { label: "platinum", terms: ["platinum nanoparticle"] },
    ],
  }, "# pack\n");
  fs.writeFileSync(path.join(root, "Research", "QueryPacks", "pilot.md"), pack, "utf8");
  build(root);
  return root;
}

describe("pdf anchor pilot", () => {
  it("refuses rather than falling back to the unsafe built-in extractor when pdftotext is unavailable", () => {
    let message = "";
    try { A.findPdftotext("scholarium-pdftotext-that-does-not-exist"); }
    catch (error) { message = error.message; }
    assert.match(message, /pdftotext/);
  });

  it("re-extracts an ordinary FlateDecode text stream identically", () => {
    const text = Array(16).fill("Gold nanoparticle loaded BiVO4 with platinum nanoparticle improves catalytic performance.").join(" ");
    const one = A.extractPdfText(fakePdf(text));
    const two = A.extractPdfText(fakePdf(text));
    assert.eq(one, two);
    assert.deepEq(A.blocksFromText(one), A.blocksFromText(two));
    assert.ok(A.blocksFromText(one).every((block) => block.text_hash === A.textHash(block.text)));
  });

  it("uses only BT/ET text-show operations, never PDF font-map strings", () => {
    const stream = "(glyph-fragment) [(Gold)( nanoparticle)] TJ BT (BiVO4) Tj ET (metadata)";
    assert.deepEq(A.textShowOperations(stream), ["BiVO4"]);
  });

  it("selects only unique PDFs with three literal concept groups and does not write by planning", () => {
    const text = Array(14).fill("Gold nanoparticle on BiVO4 with platinum nanoparticle is a useful photocatalytic system.").join(" ");
    const root = vault((v) => {
      fs.writeFileSync(path.join(v, "literature", "good.pdf"), fakePdf(text));
      fs.writeFileSync(path.join(v, "literature", "good-2.pdf"), fakePdf(text));
      fs.writeFileSync(path.join(v, "literature", "weak.pdf"), fakePdf(Array(20).fill("BiVO4 was studied.").join(" ")));
    });
    const plan = A.planPilot(root, "Research/QueryPacks/pilot.md", {
      minGroups: 3, max: 30,
      extract: (absolute) => A.extractPdfText(fs.readFileSync(absolute)),
    });
    assert.eq(plan.selected.length, 1);
    assert.eq(plan.selected[0].matched_concept_groups.length, 3);
    assert.ok(plan.conservation.every_unique_pdf_has_terminal_state);
    assert.ok(!fs.existsSync(path.join(root, ".scholarium")), "planning must not write a sidecar");
  });

  it("writes a hash-bound, non-object sidecar only after an explicit write", () => {
    const text = Array(14).fill("Gold nanoparticle on BiVO4 with platinum nanoparticle is a useful photocatalytic system.").join(" ");
    const root = vault((v) => fs.writeFileSync(path.join(v, "literature", "good.pdf"), fakePdf(text)));
    const extract = (absolute) => A.extractPdfText(fs.readFileSync(absolute));
    const plan = A.planPilot(root, "Research/QueryPacks/pilot.md", { minGroups: 3, extract });
    const result = A.writeSidecars(root, plan, { extract });
    assert.eq(result.count, 1);
    const sidecar = JSON.parse(fs.readFileSync(path.join(root, ...result.written[0].split("/")), "utf8"));
    assert.eq(sidecar.kind, "scholarium-pdf-anchor-sidecar");
    assert.ok(!sidecar.type, "a sidecar must not masquerade as a Schema-v1 object");
    assert.eq(sidecar.anchor_count, sidecar.anchors.length);
    assert.eq(sidecar.doi, "10.1000/pilot");
    assert.eq(sidecar.original_url, "https://doi.org/10.1000/pilot");
    assert.eq(sidecar.evidence_locator_status, "ready");
    assert.eq(sidecar.extracted_text_sha256, A.sha256(extract(path.join(root, "literature", "good.pdf"))));
    assert.deepEq(sidecar.extraction, { command: "test-extractor", argv: [], version: "test-only" });
    assert.ok(sidecar.anchors.every((anchor) => anchor.text_hash === A.textHash(anchor.text) && anchor.quote_hash === anchor.text_hash));
  });

  it("refuses a PDF with no authoritative URL as an Evidence source, without inventing one", () => {
    const text = Array(14).fill("Gold nanoparticle on BiVO4 with platinum nanoparticle is a useful photocatalytic system.").join(" ");
    const root = vault((v) => fs.writeFileSync(path.join(v, "literature", "unknown.pdf"), fakePdf(text, "")));
    const extract = (absolute) => A.extractPdfText(fs.readFileSync(absolute));
    const plan = A.planPilot(root, "Research/QueryPacks/pilot.md", { minGroups: 3, extract });
    assert.eq(plan.selected[0].original_url, "");
    assert.eq(plan.selected[0].evidence_locator_status, "missing_original_url");
  });

  it("requires an explicit replacement flag to upgrade a rebuildable sidecar", () => {
    const text = Array(14).fill("Gold nanoparticle on BiVO4 with platinum nanoparticle is a useful photocatalytic system.").join(" ");
    const root = vault((v) => fs.writeFileSync(path.join(v, "literature", "good.pdf"), fakePdf(text)));
    const extract = (absolute) => A.extractPdfText(fs.readFileSync(absolute));
    const plan = A.planPilot(root, "Research/QueryPacks/pilot.md", { minGroups: 3, extract });
    A.writeSidecars(root, plan, { extract });
    let message = "";
    try { A.writeSidecars(root, plan, { extract }); } catch (error) { message = error.message; }
    assert.match(message, /已有 sidecar/);
    assert.eq(A.writeSidecars(root, plan, { extract, replaceExisting: true }).count, 1);
  });
});
