"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { listArticles } = require("../../tools/rss-actions");

test("rss.list_articles reads the persisted board as L0 data and can select one id", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-rss-list-"));
  try {
    const plugin = path.join(vault, ".obsidian", "plugins", "obsidian-scholarium");
    fs.mkdirSync(plugin, { recursive: true });
    fs.writeFileSync(path.join(plugin, "data.json"), JSON.stringify({
      rssBoard: {
        feeds: [{ id: "feed-1", title: "Lignin" }],
        articles: [{ id: "article-1", feedId: "feed-1", title: "DES", read: false, starred: true, relevance: { overallScore: 88 } }],
      },
    }), "utf8");
    const all = listArticles(vault);
    assert.equal(all.articles.length, 1);
    assert.equal(all.articles[0].relevance.overallScore, 88);
    assert.deepEqual(listArticles(vault, { article_id: "article-1" }).articles.map((article) => article.id), ["article-1"]);
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
