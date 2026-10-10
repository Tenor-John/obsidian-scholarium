const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const K = require("../tools/graph-keywords.js");

/* Why this module exists at all.

   build_paper_graph.js matches entities with three hardcoded regexes written
   for a photocatalysis vocabulary (bivo4, zno, tio2, co2 reduction). Measured
   against this vault's actual corpus — gold nanostar synthesis in Good's
   buffers — that produced 512 edges of which 161 hung off the single token
   "au", while HEPES, MOPS, EPPS and nanostar, the subject of nearly every
   indexed paper, never appeared in the graph.

   The tempting fix is to add those words to the regex table. That is the same
   mistake with a different vocabulary: it would break again at the
   researcher's next project, and this one already has two whose terms differ
   from the indexed literature. So nothing domain-specific is hardcoded, and
   these tests use a synthetic corpus rather than the real one — a test that
   asserts "hepes is suggested" would itself be the hardcoding it forbids. */

function corpus(rows) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kw-corpus-"));
  const file = path.join(dir, "chunks.jsonl");
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n"));
  return { dir, file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// A term repeated inside each of several papers: the shape of real domain
// vocabulary. `zorbium` is invented so no real-world list can accidentally
// satisfy the assertion.
function paper(hash, text, count = 6) {
  return { source_hash: hash, source_path: `${hash}.pdf`, text: Array(count).fill(text).join(" ") };
}

describe("图谱关键词：三态语义", () => {
  it("null 表示未配置，[] 表示明确不要", () => {
    // Collapsing these would make the feature impossible to switch off.
    assert.eq(K.isConfigured(null), false);
    assert.eq(K.isConfigured(undefined), false);
    assert.eq(K.isConfigured([]), true);
    assert.eq(K.isConfigured(["x"]), true);
  });

  it("归一化去重、小写、去空白", () => {
    // extractEntities matches case-insensitively, so two casings of one word
    // would otherwise become two separate graph nodes.
    assert.deepEq(K.normalize(["HEPES", " hepes ", "MOPS", "", null, "HEPES"]), ["hepes", "mops"]);
  });

  it("未配置时从语料推导，已配置时原样使用", () => {
    const c = corpus([paper("a".repeat(64), "zorbium ligand"), paper("b".repeat(64), "zorbium ligand"),
      paper("c".repeat(64), "zorbium ligand")]);
    const vault = path.dirname(path.dirname(path.dirname(c.file)));
    try {
      const configured = K.resolveKeywords(["only-this"], vault);
      assert.eq(configured.source, "configured");
      assert.deepEq(configured.keywords, ["only-this"]);

      const empty = K.resolveKeywords([], vault);
      assert.eq(empty.source, "configured");
      assert.deepEq(empty.keywords, [], "显式空数组必须被尊重，而不是回退成自动推导");
    } finally { c.cleanup(); }
  });
});

describe("图谱关键词：从语料挖掘候选", () => {
  it("挖出在多篇论文里反复出现的术语", () => {
    const c = corpus([
      paper("1".repeat(64), "zorbium quenching observed"),
      paper("2".repeat(64), "zorbium quenching observed"),
      paper("3".repeat(64), "zorbium quenching observed"),
      paper("4".repeat(64), "zorbium quenching observed"),
    ]);
    try {
      const out = K.suggestFromCorpus(c.file, { limit: 20 });
      const terms = out.suggestions.map((s) => s.term);
      assert.ok(terms.includes("zorbium"), "应挖出跨论文的术语，实际：" + terms.join(", "));
      assert.eq(out.papers, 4);
    } finally { c.cleanup(); }
  });

  it("按「出现在多少篇论文」排序，而不是按总次数", () => {
    /* Raw frequency surfaces whatever one long paper repeats. A methods
       section saying one word ninety times must not outrank the vocabulary
       the whole corpus shares — the graph is built across papers. */
    const c = corpus([
      { source_hash: "1".repeat(64), source_path: "1.pdf", text: Array(90).fill("blathering").join(" ") },
      ...["2", "3", "4", "5"].map((n) => paper(n.repeat(64), "widespread finding", 4)),
    ]);
    try {
      const out = K.suggestFromCorpus(c.file, { limit: 20, minPapers: 2, minCount: 4 });
      const terms = out.suggestions.map((s) => s.term);
      const wide = terms.indexOf("widespread");
      const narrow = terms.indexOf("blathering");
      assert.ok(wide >= 0, "跨论文术语应入选：" + terms.join(", "));
      if (narrow >= 0) assert.ok(wide < narrow, "跨论文术语必须排在单篇高频词之前");
    } finally { c.cleanup(); }
  });

  it("剔除只在每篇出现一次的元数据词", () => {
    /* Metadata and author names appear about once per document; domain terms
       recur inside one. Document frequency alone cannot separate them —
       both appear in nearly every paper — but the repetition ratio can. */
    const c = corpus(["1", "2", "3", "4", "5"].map((n) => ({
      source_hash: n.repeat(64), source_path: `${n}.pdf`,
      text: "flooberkey appears once here. zorbium zorbium zorbium zorbium zorbium zorbium.",
    })));
    try {
      const out = K.suggestFromCorpus(c.file, { limit: 20, minPapers: 2, minCount: 5 });
      const terms = out.suggestions.map((s) => s.term);
      assert.ok(terms.includes("zorbium"), "文内反复的术语应入选");
      assert.ok(!terms.includes("flooberkey"), "每篇只出现一次的词应被剔除：" + terms.join(", "));
    } finally { c.cleanup(); }
  });

  it("剥掉 YAML frontmatter，不把 tags/status/title 当术语", () => {
    // The RAG index contains this vault's own notes. Their frontmatter keys
    // appear once in nearly every note, which is exactly the profile of a
    // high-document-frequency term.
    const c = corpus(["1", "2", "3", "4"].map((n) => ({
      source_hash: n.repeat(64), source_path: `${n}.md`,
      text: `---\ntags: [x]\nstatus: active\ntitle: Note ${n}\n---\n` + Array(6).fill("zorbium assay").join(" "),
    })));
    try {
      const out = K.suggestFromCorpus(c.file, { limit: 30, minPapers: 2, minCount: 4 });
      const terms = out.suggestions.map((s) => s.term);
      for (const key of ["tags", "status", "title"]) {
        assert.ok(!terms.includes(key), `frontmatter 键 ${key} 不应成为候选：` + terms.join(", "));
      }
      assert.ok(terms.includes("zorbium"));
    } finally { c.cleanup(); }
  });

  it("不建议内置正则已经能匹配的词", () => {
    // Suggesting these spends the researcher's attention on words that would
    // change nothing about the graph.
    const c = corpus(["1", "2", "3", "4"].map((n) => paper(n.repeat(64), "tio2 xrd photocatalysis")));
    try {
      const out = K.suggestFromCorpus(c.file, { limit: 30, minPapers: 2, minCount: 4 });
      const terms = out.suggestions.map((s) => s.term);
      for (const covered of ["tio2", "xrd", "photocatalysis"]) {
        assert.ok(!terms.includes(covered), `${covered} 已被内置正则覆盖，不该再建议`);
      }
    } finally { c.cleanup(); }
  });

  it("已在列表里的词不会被重复建议", () => {
    const c = corpus(["1", "2", "3", "4"].map((n) => paper(n.repeat(64), "zorbium assay")));
    try {
      const out = K.suggestFromCorpus(c.file, { limit: 20, minPapers: 2, minCount: 4, existing: ["ZORBIUM"] });
      assert.ok(!out.suggestions.some((s) => s.term === "zorbium"), "大小写不同也算已存在");
    } finally { c.cleanup(); }
  });

  it("表格线之类的非字母片段不会成为候选", () => {
    const c = corpus(["1", "2", "3", "4"].map((n) => paper(n.repeat(64), "----------- zorbium")));
    try {
      const out = K.suggestFromCorpus(c.file, { limit: 20, minPapers: 2, minCount: 4 });
      assert.ok(!out.suggestions.some((s) => !/[a-z]/.test(s.term)), "候选必须含字母");
    } finally { c.cleanup(); }
  });

  it("泛用词允许组成词组，但不能单独成词", () => {
    /* Blanket-stopwording "light" would be wrong for a photocatalysis vault
       where "visible light" is exactly the term worth graphing. */
    const c = corpus(["1", "2", "3", "4"].map((n) => paper(n.repeat(64), "visible light irradiation")));
    try {
      const out = K.suggestFromCorpus(c.file, { limit: 30, minPapers: 2, minCount: 4 });
      const terms = out.suggestions.map((s) => s.term);
      assert.ok(!terms.includes("light"), "泛用词不应单独成为实体");
      assert.ok(terms.some((t) => t.includes("light")), "但应能出现在词组里：" + terms.join(", "));
    } finally { c.cleanup(); }
  });

  it("语料不存在时给出说明，而不是抛异常", () => {
    const out = K.suggestFromCorpus(path.join(os.tmpdir(), "definitely-missing", "chunks.jsonl"));
    assert.deepEq(out.suggestions, []);
    assert.ok(out.note, "必须说明为什么没有建议");
  });

  it("损坏的一行不会中断整份语料", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kw-broken-"));
    const file = path.join(dir, "chunks.jsonl");
    fs.writeFileSync(file, [
      JSON.stringify(paper("1".repeat(64), "zorbium assay")),
      "{ this is not json",
      JSON.stringify(paper("2".repeat(64), "zorbium assay")),
      JSON.stringify(paper("3".repeat(64), "zorbium assay")),
    ].join("\n"));
    try {
      const out = K.suggestFromCorpus(file, { limit: 20, minPapers: 2, minCount: 4 });
      assert.eq(out.papers, 3, "坏行应被跳过而不是让整份语料失败");
      assert.ok(out.suggestions.some((s) => s.term === "zorbium"));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
