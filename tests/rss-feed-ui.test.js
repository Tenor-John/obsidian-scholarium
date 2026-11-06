"use strict";

const { source, block, describe, it, assert } = require("./harness");

describe("RSS feed controls", () => {
  it("offers a hover refresh action for each individual feed", () => {
    const src = source();
    assert.match(src, /rss-feed-act rss-feed-refresh/);
    assert.match(src, /this\.refreshOneFeed\(\w+\)/);
    assert.match(src, /title: \w+\.refreshing \? "[^"]*" : "[^"]*"/);
  });

  it("serialises a single-feed refresh without invoking a global refresh", () => {
    const refresh = block("refreshOneFeed(t) {");
    assert.match(refresh, /if \(!t \|\| this\.refreshing \|\| t\.refreshing\) return/);
    assert.match(refresh, /await this\.refreshFeed\(t\)/);
    assert.noMatch(refresh, /refreshAll\(/);
  });

  it("protects a recent window for every source before applying the global cap", () => {
    const src = source();
    assert.match(src, /var Jn = (?:6000|6e3);/);
    assert.match(src, /for \(let \w+ of \w+\.values\(\)\) \w+\.push\(\.\.\.\w+\.slice\(0, 40\)\)/);
    assert.match(src, /Math\.max\(0, Jn - \w+\.length - \w+\.length\)/);
  });

  it("offers a direct refresh when the selected journal has no retained articles", () => {
    const src = source();
    const refreshAt = src.indexOf("刷新此期刊");
    assert.ok(refreshAt >= 0, "missing direct-refresh button");
    const button = src.slice(Math.max(0, refreshAt - 300), refreshAt + 600);
    assert.match(button, /text: \w+\.refreshing \? "[^"]*" : "[^"]*"/);
    assert.match(button, /\w+\.onclick = \(\) => this\.refreshOneFeed\(\w+\)/);
  });
  it("offers an explicit, protected cleanup for disposable zero-score cache rows", () => {
    const src = source();
    assert.match(src, /radar-cache-prune\.js/);
    assert.match(src, /radarPrune\.execute/);
    assert.match(src, /Research\/RadarScores/);
    assert.match(src, /removable_count/);
  });
  it("automatically runs the protected cleanup after a source scoring batch", () => {
    const src = source();
    assert.match(src, /async scoreNewArticles\(\)[\s\S]{0,5000}RSS zero-score cleanup skipped/);
    assert.match(src, /async scoreNewArticles\(\)[\s\S]{0,5000}radarPrune\.execute/);
    assert.match(src, /cleanup\.removed/);
  });

  it("can opt in to a bounded high-score capture queue after scoring", () => {
    const src = source();
    const capture = block("autoClipHighScoredArticles(t) {");
    assert.match(src, /rssAutoCaptureEnabled: false/);
    assert.match(src, /rssAutoCaptureMinScore: 70/);
    assert.match(src, /rssAutoCaptureMaxPerBatch: 5/);
    assert.match(src, /autoClipHighScoredArticles\(scoredArticles\)/);
    assert.match(capture, /loadUrlInHiddenWebview\(\w+\.link, 9e4\)/);
    assert.match(capture, /throwOnError: true, openResult: false, quiet: true/);
    assert.match(capture, /status: \w+ \? "needs_interaction" : "failed"/);
  });

  it("shares the persistent research browser session with automatic capture", () => {
    const hidden = block("loadUrlInHiddenWebview(t, e = 45e3) {");
    assert.match(hidden, /partition", "persist:scholarium-research-browser/);
  });
});
