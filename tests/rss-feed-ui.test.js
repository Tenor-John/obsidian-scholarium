"use strict";

const { source, describe, it, assert } = require("./harness");

describe("RSS feed controls", () => {
  it("offers a hover refresh action for each individual feed", () => {
    const src = source();
    assert.match(src, /rss-feed-act rss-feed-refresh/);
    assert.match(src, /this\.refreshOneFeed\(p\)/);
    assert.match(src, /title: p\.refreshing \? ".*" : ".*"/);
  });

  it("serialises a single-feed refresh without invoking a global refresh", () => {
    const src = source();
    assert.match(src, /async refreshOneFeed\(t\)/);
    assert.match(src, /if \(!t \|\| this\.refreshing \|\| t\.refreshing\) return/);
    assert.match(src, /await this\.refreshFeed\(t\)/);
  });

  it("protects a recent window for every source before applying the global cap", () => {
    const src = source();
    assert.match(src, /Jn = 6000/);
    assert.match(src, /Preserve a recent window for every source/);
    assert.match(src, /for \(let n of i\.values\(\)\) r\.push\(\.\.\.n\.slice\(0, 40\)\)/);
  });

  it("offers a direct refresh when the selected journal has no retained articles", () => {
    const src = source();
    assert.match(src, /text: l\.refreshing \? ".*" : ".*"/);
    assert.match(src, /c\.onclick = \(\) => this\.refreshOneFeed\(l\)/);
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
    assert.match(src, /rssAutoCaptureEnabled: !1/);
    assert.match(src, /rssAutoCaptureMinScore: 70/);
    assert.match(src, /rssAutoCaptureMaxPerBatch: 5/);
    assert.match(src, /autoClipHighScoredArticles\(scoredArticles\)/);
    assert.match(src, /async autoClipHighScoredArticles\(t\)/);
    assert.match(src, /loadUrlInHiddenWebview\(a\.link, 9e4\)/);
    assert.match(src, /throwOnError: !0, openResult: !1, quiet: !0/);
    assert.match(src, /status: p \? "needs_interaction" : "failed"/);
  });

  it("shares the persistent research browser session with automatic capture", () => {
    const src = source();
    const hidden = src.slice(
      src.indexOf("async loadUrlInHiddenWebview(t, e = 45e3) {"),
      src.indexOf("async loadUrlInVisibleWebview"),
    );
    assert.match(hidden, /partition", "persist:scholarium-research-browser/);
  });
});
