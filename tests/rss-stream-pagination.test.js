"use strict";

const { source, describe, it, assert } = require("./harness");

describe("RSS stream memory/perf (2026-08-14 pagination patch)", () => {
  it("paginates the card list instead of rendering every filtered article at once", () => {
    const src = source();
    assert.match(src, /Rc = 60,/);
    assert.match(src, /this\.streamRenderCount = Rc;/);
    assert.match(
      src,
      /let visibleCount = Math\.min\(this\.streamRenderCount, r\.length\);/,
    );
    assert.match(
      src,
      /for \(let a of r\.slice\(0, visibleCount\)\) this\.renderCard\(n, a\);/,
    );
    assert.match(src, /loadMoreBtn\.onclick = \(\) => \{/);
  });

  it("resets the page size whenever the feed selection or filter tab changes", () => {
    const src = source();
    const resets = src.match(/\(this\.streamRenderCount = Rc\)/g) || [];
    assert.ok(
      resets.length >= 3,
      "expected streamRenderCount to reset at the 'all articles', per-feed, and filter-tab click sites",
    );
  });

  it("prefers the short feed summary over parsing the full extracted body for card previews", () => {
    const src = source();
    assert.match(
      src,
      /let n =\s*\n\s*e\.summary \|\|\s*\n\s*\(e\.contentHtml \? Xe\(e\.contentHtml\)\.slice\(0, 220\) : ""\) \|\|\s*\n\s*"";/,
    );
  });

  it("sheds cached full-text extraction for old, read, unstarred articles during trimArticles", () => {
    const src = source();
    const t = src.slice(src.indexOf("trimArticles() {"), src.indexOf("fmtDate(t) {"));
    assert.match(t, /list\.slice\(20\)/);
    assert.match(t, /if \(!art\.starred && art\.read && art\.contentHtml\)/);
    assert.match(t, /art\.contentHtml = void 0;/);
  });
});
