"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const root = path.resolve(__dirname, "../..");

for (const target of [path.join(__dirname, "..", "rss-feed-board.ts"), path.join(root, "main.js")]) {
  test(`saved fulltext with pending archive is read locally: ${path.basename(target)}`, async () => {
    const source = fs.readFileSync(target, "utf8");
    const start = source.search(/(?:^|\n)\s*isReadableLiteratureFulltext\(/);
    const rest = source.slice(start);
    const end = start + rest.search(/\n\s*parseLiteratureMatrixAi\(/);
    assert.ok(start >= 0 && end > start);
    const board = vm.runInNewContext(`new (class {${source.slice(start, end)}})()`);
    const notePath = "literature/Subscriptions/example.md";
    const text = '---\ntype: literature_fulltext\nsource_preservation: "pending"\n---\n## Introduction\n' + 'Saved article introduction and scientific context. '.repeat(40) + '\n## Results and discussion\n' + 'Experimental measurements and analysis. '.repeat(40);
    assert.match(text, /source_preservation: "pending"/);
    assert.equal(board.isReadableLiteratureFulltext(text, {}), true);
    board.app = { vault: { adapter: { exists: async () => true, read: async () => text }, getAbstractFileByPath: () => ({ path: notePath }), cachedRead: async () => text }, metadataCache: { getFileCache: () => ({ frontmatter: { type: "literature_fulltext", source_preservation: "pending" } }) } };
    board.parseVaultPdf = async () => { throw new Error("should use saved text before parsing PDF"); };
    board.createPipelineDoiBatch = async () => { throw new Error("should not fetch again"); };
    const result = await board.readLiteratureMatrixSource({ path: notePath, pdf_path: "paper.pdf", doi: "10.1016/j.apcatb.2021.119947" }, { fetch: true });
    assert.equal(result.path, notePath);
    assert.equal(result.text, text);
    assert.equal(result.basis, "fulltext");
    assert.equal(board.isReadableLiteratureFulltext("---\ntype: literature_fulltext\n---\n## Abstract\n" + "abstract ".repeat(500)), false);
    assert.equal(board.isReadableLiteratureFulltext("---\ntype: literature_fulltext\n---\nVerify you are human"), false);
    assert.equal(board.isReadableLiteratureFulltext(text.replace("literature_fulltext", "literature-summary")), false);
  });
}
