"use strict";
/**
 * Publisher metadata extraction + tag construction + full-text cleaning.
 * Publishers disagree on attribute order and vocabulary, so both orders and
 * several fallbacks are covered.
 */
const { sandbox, describe, it, assert } = require("./harness");

const S = sandbox({
  fns: ["je", "schNormalizeDoi", "Dc", "schOpenAlexAbstract", "schRssMetadataProvenance"],
  methods: {
    extractCitationMeta: ["t", "e"],
    slugTag: ["t"],
    buildClipTags: ["t", "e"],
    parseSummaryVocab: ["t"],
    stripClipNoise: ["t"],
  },
});
global.je = S.je; // stripClipNoise / buildClipTags reach for the module-scope helper

const NATURE = `<meta name="citation_journal_title" content="Nature Chemistry"/>
<meta name="citation_doi" content="10.1038/s41557-026-02210-w"/>
<meta name="citation_publication_date" content="2026/08/01"/>
<meta name="citation_author" content="Ben L. Feringa"/>
<meta name="citation_author" content="Eric Sidler"/>
<meta name="dc.subject" content="Molecular machines and motors"/>`;

// ACS puts content= before name=
const ACS = `<meta content="10.1021/acs.chemrev.5c00123" name="dc.Identifier" scheme="doi"/>
<meta content="Chemical Reviews" name="citation_journal_title"/>
<meta content="2026-07-14" name="citation_online_date"/>
<meta content="CO2 fixation; formate dehydrogenase" name="keywords"/>`;

describe("citation metadata", () => {
  it("accepts RSS DOIs only from an explicit DOI field or the article URL", () => {
    assert.eq(S.Dc({ doi: "https://doi.org/10.1038/s41557-026-02210-w" }), "10.1038/s41557-026-02210-w");
    assert.eq(S.Dc({ link: "https://pubs.acs.org/doi/10.1021/acscatal.6c05102" }), "10.1021/acscatal.6c05102");
    assert.eq(S.Dc({ summary: "Reference DOI: 10.1021/acs.jmedchem.4c01122" }), undefined);
  });

  it("reconstructs an OpenAlex inverted abstract index in reading order", () => {
    assert.eq(
      S.schOpenAlexAbstract({ abstract_inverted_index: { catalysts: [2], "enable": [1], "These": [0] } }),
      "These enable catalysts",
    );
  });

  it("records which database actually supplied each enriched field", () => {
    const article = { metadataSources: [{ source: "crossref", fields: ["authors"], fetchedAt: 1 }] };
    S.schRssMetadataProvenance(article, "crossref", ["abstract", "authors", "abstract"]);
    S.schRssMetadataProvenance(article, "openalex", ["affiliations"]);
    assert.deepEq(
      article.metadataSources.map((source) => [source.source, source.fields]),
      [["crossref", ["abstract", "authors"]], ["openalex", ["affiliations"]]],
    );
  });

  it("reads Highwire tags (name= first)", () => {
    const m = S.extractCitationMeta(NATURE, "https://www.nature.com/articles/x");
    assert.eq(m.doi, "10.1038/s41557-026-02210-w");
    assert.eq(m.journal, "Nature Chemistry");
    assert.eq(m.year, "2026");
    assert.deepEq(m.authors, ["Ben L. Feringa", "Eric Sidler"]);
  });

  it("reads Dublin Core with reversed attribute order", () => {
    const m = S.extractCitationMeta(ACS, "https://pubs.acs.org/x");
    assert.eq(m.doi, "10.1021/acs.chemrev.5c00123");
    assert.eq(m.journal, "Chemical Reviews");
    assert.eq(m.year, "2026");
    assert.deepEq(m.keywords, ["CO2 fixation", "formate dehydrogenase"]);
  });

  it("falls back to the DOI embedded in the URL", () => {
    const m = S.extractCitationMeta("<html></html>", "https://doi.org/10.1021/abc.9b01234");
    assert.eq(m.doi, "10.1021/abc.9b01234");
  });

  it("never mistakes a reference-list DOI for the clipped article DOI", () => {
    const m = S.extractCitationMeta(
      `<main><h1>Copper-catalysed site-selective arylation of pyrazoles</h1>
       <section class="references">Marshall et al. J. Med. Chem.
       doi: 10.1021/acs.jmedchem.4c01122</section></main>`,
      "https://www.nature.com/articles/s41557-026-02148-z",
    );
    assert.eq(m.doi, "");
  });

  it("uses a publisher citation DOI even when the body contains other DOI strings", () => {
    const m = S.extractCitationMeta(
      `<meta name="citation_doi" content="10.1038/s41557-026-02148-z"/>
       <section class="references">doi: 10.1021/acs.jmedchem.4c01122</section>`,
      "https://www.nature.com/articles/s41557-026-02148-z",
    );
    assert.eq(m.doi, "10.1038/s41557-026-02148-z");
  });

  it("strips a doi.org prefix rather than storing a URL", () => {
    const m = S.extractCitationMeta(
      `<meta name="citation_doi" content="https://doi.org/10.1000/xyz"/>`,
      "",
    );
    assert.eq(m.doi, "10.1000/xyz");
  });

  it("returns empty strings, never undefined, when nothing is present", () => {
    const m = S.extractCitationMeta("<html></html>", "https://example.com/a");
    for (const k of ["doi", "journal", "year", "publisher"]) assert.eq(m[k], "", k);
    assert.deepEq(m.authors, []);
  });
});

describe("tag construction", () => {
  it("builds a hierarchical namespace", () => {
    const t = S.buildClipTags(
      { journal: "Nature Chemistry", year: "2026", keywords: ["Photochemistry"] },
      ["source/web-clip"],
    );
    assert.ok(t.includes("journal/nature-chemistry"), JSON.stringify(t));
    assert.ok(t.includes("year/2026"));
    assert.ok(t.includes("topic/photochemistry"));
  });

  it("deduplicates", () => {
    const t = S.buildClipTags({ year: "2026" }, ["source/web-clip", "source/web-clip"]);
    assert.eq(t.length, new Set(t).size);
  });

  it("slugifies without destroying formulae or CJK", () => {
    assert.eq(S.slugTag("Chemical Reviews".toLowerCase()), "chemical-reviews");
    assert.eq(S.slugTag("CO2 fixation".toLowerCase()), "co2-fixation");
    assert.eq(S.slugTag("分子马达"), "分子马达");
  });
});

describe("summary controlled vocabulary", () => {
  it("parses block lists and removes the yaml fence from the prose", () => {
    const v = S.parseSummaryVocab(
      "正文段落。\n\n```yaml\nmethods:\n  - fsTAS\n  - XPS\nmaterials:\n  - Au-BiVO4\ntopics:\n  - charge-transfer\n```",
    );
    assert.deepEq(v.methods, ["fsTAS", "XPS"]);
    assert.deepEq(v.materials, ["Au-BiVO4"]);
    assert.deepEq(v.topics, ["charge-transfer"]);
    assert.noMatch(v.body, /```/, "fence must not leak into the note body");
    assert.eq(v.body, "正文段落。");
  });

  it("parses inline array syntax", () => {
    const v = S.parseSummaryVocab("x\n\n```yaml\nmethods: [fsTAS, XPS]\ntopics: [hot-electron]\n```");
    assert.deepEq(v.methods, ["fsTAS", "XPS"]);
    assert.deepEq(v.topics, ["hot-electron"]);
  });

  it("tolerates trailing chatter after the block", () => {
    const v = S.parseSummaryVocab("正文。\n\n```yaml\nmethods:\n  - DFT\n```\n\n希望有帮助！");
    assert.deepEq(v.methods, ["DFT"]);
    assert.eq(v.body, "正文。");
  });

  it("keeps the whole summary when the model omits the block", () => {
    const v = S.parseSummaryVocab("一段普通总结，没有 yaml。");
    assert.deepEq(v.methods, []);
    assert.eq(v.body, "一段普通总结，没有 yaml。");
  });

  it("ignores an unrelated code block", () => {
    const v = S.parseSummaryVocab("正文\n\n```python\nprint(1)\n```");
    assert.deepEq(v.methods, []);
    assert.match(v.body, /print/, "unrelated blocks stay in the body");
  });
});

describe("full-text cleaning for scoring", () => {
  it("drops frontmatter, images, wikilink embeds and reference tails", () => {
    const out = S.stripClipNoise(
      `---\ntitle: "x"\n---\n# T\n\n![](assets/img-01.png)\n![[Pasted image 1.png]]\nBody text here.\n\n## References\n1. Someone et al.`,
    );
    assert.noMatch(out, /^---/);
    assert.noMatch(out, /!\[/);
    assert.noMatch(out, /References/);
    assert.match(out, /Body text here/);
  });

  it("unwraps links but keeps their text", () => {
    assert.eq(S.stripClipNoise("see [Fig. 2c](https://x.com/a) now"), "see Fig. 2c now");
  });

  it("strips glued citation superscripts", () => {
    assert.match(S.stripClipNoise("in drug discovery3 and scaffolds1,2"), /discovery\s+and/);
  });

  it("does NOT damage chemical formulae or units", () => {
    const out = S.stripClipNoise("TiO2 and BiVO4 with 5 mmol H2O2 at 450 nm");
    for (const s of ["TiO2", "BiVO4", "mmol", "H2O2", "450 nm"])
      assert.match(out, new RegExp(s.replace(/([.*+?^${}()|[\]\\])/g, "\\$1")), s + " was corrupted");
  });

  it("clears leaked LaTeX escaping", () => {
    assert.noMatch(S.stripClipNoise("H2O \\\\(\\\\to\\\\) O2 and $$\\alpha$$"), /\\\(|\$\$/);
  });
});
