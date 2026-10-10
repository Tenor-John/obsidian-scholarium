"use strict";

const { describe, it, assert } = require("./harness");
const registry = require("../tools/action-registry");

function fakeBoard(overrides = {}) {
  const articles = overrides.articles || [
    { id: "a1", feedId: "feed-1", link: "https://example.org/a1", radarScores: [] },
    { id: "a2", feedId: "feed-1", link: "https://example.org/a2", radarScores: [{ projectId: "p", priority: 82 }] },
    { id: "a3", feedId: "feed-2", link: "https://example.org/a3", radarScores: [] },
  ];
  const feeds = overrides.feeds || [
    { id: "feed-1", title: "Feed One", lastFetched: 111 },
    { id: "feed-2", title: "Feed Two", lastFetched: 222 },
  ];
  const scores = new Map(articles.filter((a) => (a.radarScores || []).length).map((a) => [a.id, a.radarScores[0]]));
  const board = {
    data: { feeds, articles },
    selectedFeedId: null,
    currentRadarScore(article) { return scores.get(article.id) || null; },
    async refreshOneFeed(feed) {
      board.data.articles.push({ id: "new-" + feed.id, feedId: feed.id, link: "https://example.org/new", radarScores: [] });
    },
    async scoreNewArticles() {
      assert.ok(board.selectedFeedId, "scoreNewArticles should run against a selected feed");
      for (const article of board.data.articles) {
        if (article.feedId === board.selectedFeedId && !scores.get(article.id)) {
          scores.set(article.id, { projectId: "p", priority: 91 });
        }
      }
    },
    async autoClipHighScoredArticles(list) {
      return { enabled: true, started: list.length, completed: list.length, needsInteraction: 0, failed: 0 };
    },
  };
  return board;
}

describe("existing sync actions are unaffected by runAsync()", () => {
  it("run() still returns a manifest synchronously for vault.validate", () => {
    const fs = require("fs"), os = require("os"), path = require("path");
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-sync-sanity-"));
    const manifest = registry.run(vault, "vault.validate", {}, {});
    assert.eq(manifest.action, "vault.validate");
    assert.eq(manifest.dry_run, true);
  });
});

describe("rss.refresh_feed", () => {
  it("dry-runs without touching the board when no live context is supplied", async () => {
    const manifest = await registry.runAsync("/tmp/does-not-matter", "rss.refresh_feed", { feed_id: "feed-1" }, { dryRun: true });
    assert.eq(manifest.result.mode, "dry_run_no_live_context");
  });
  it("refuses to run for real through the sync run() entry point", () => {
    let threw = false;
    try { registry.run("/tmp", "rss.refresh_feed", { feed_id: "feed-1" }, { dryRun: false, confirmed: true }); }
    catch (e) { threw = true; assert.match(e.message, /action_requires_runAsync/); }
    assert.ok(threw, "run() must refuse an async action");
  });
  it("requires a live board once dryRun is false", async () => {
    let threw = false;
    try { await registry.runAsync("/tmp", "rss.refresh_feed", { feed_id: "feed-1" }, { dryRun: false, confirmed: true }); }
    catch (e) { threw = true; assert.match(e.message, /scholarium_live_context_required/); }
    assert.ok(threw, "runAsync must require live when not a dry run");
  });
});

async function withTempVault(fn) {
  const fs = require("fs"), os = require("os"), path = require("path");
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "scholarium-rss-actions-"));
  await fn(vault);
}

describe("rss.refresh_feed live execution", () => {
  it("reports the article count delta and writes an audit manifest", async () => {
    await withTempVault(async (vault) => {
      const board = fakeBoard();
      const before = board.data.articles.filter((a) => a.feedId === "feed-1").length;
      const manifest = await registry.runAsync(vault, "rss.refresh_feed", { feed_id: "feed-1" }, { dryRun: false, confirmed: true, live: { board } });
      assert.eq(manifest.result.articles_before, before);
      assert.eq(manifest.result.new_articles, 1);
      const fs = require("fs"), path = require("path");
      const dir = path.join(vault, "Research", "_runs", "actions");
      assert.ok(fs.existsSync(dir) && fs.readdirSync(dir).length === 1, "expected exactly one audit manifest on disk");
    });
  });
  it("rejects an unknown feed id", async () => {
    await withTempVault(async (vault) => {
      let threw = false;
      try { await registry.runAsync(vault, "rss.refresh_feed", { feed_id: "no-such-feed" }, { dryRun: false, confirmed: true, live: { board: fakeBoard() } }); }
      catch (e) { threw = true; assert.match(e.message, /feed_not_found/); }
      assert.ok(threw);
    });
  });
});

describe("rss.score_feed", () => {
  it("dry-runs to a candidate count without touching the board", async () => {
    const board = fakeBoard();
    const manifest = await registry.runAsync("/tmp", "rss.score_feed", { feed_id: "feed-1" }, { dryRun: true, live: { board } });
    assert.eq(manifest.result.feed_id, "feed-1");
    assert.eq(manifest.result.candidates, 1); // only a1 is unscored on feed-1
    assert.eq(board.selectedFeedId, null, "a dry run must not touch selectedFeedId");
  });
  it("scores only the unscored articles on the selected feed and restores selectedFeedId", async () => {
    await withTempVault(async (vault) => {
      const board = fakeBoard();
      board.selectedFeedId = "feed-2";
      const manifest = await registry.runAsync(vault, "rss.score_feed", { feed_id: "feed-1" }, { dryRun: false, confirmed: true, live: { board } });
      assert.eq(manifest.result.candidates_before, 1); // a1 has no score, a2 already scored
      assert.eq(manifest.result.scored, 1);
      assert.eq(manifest.result.unscored_remaining, 0);
      assert.eq(board.selectedFeedId, "feed-2", "selectedFeedId must be restored after scoring");
    });
  });
});

describe("rss.clip_high_score", () => {
  it("refuses when rssAutoCaptureEnabled is off, without throwing", async () => {
    await withTempVault(async (vault) => {
      const board = fakeBoard();
      const manifest = await registry.runAsync(vault, "rss.clip_high_score", { feed_id: "feed-1" }, { dryRun: false, confirmed: true, live: { board, settings: { rssAutoCaptureEnabled: false } } });
      assert.eq(manifest.result.enabled, false);
    });
  });
  it("clips only articles at or above the configured threshold", async () => {
    await withTempVault(async (vault) => {
      const board = fakeBoard();
      const manifest = await registry.runAsync(vault, "rss.clip_high_score", { feed_id: "feed-1" }, {
        dryRun: false, confirmed: true,
        live: { board, settings: { rssAutoCaptureEnabled: true, rssAutoCaptureMinScore: 70, rssAutoCaptureMaxPerBatch: 5 } },
      });
      assert.eq(manifest.result.started, 1); // only a2 (priority 82) qualifies
    });
  });
});

// Fake live board with the two capture methods rss.clip_url needs. Records
// what it was called with so tests can assert the pseudo-article shape.
function fakeClipBoard(overrides = {}) {
  const calls = { load: [], clip: [] };
  const board = {
    data: { feeds: [], articles: [] },
    findExistingClip(article) { return overrides.existing || null; },
    async loadUrlInHiddenWebview(url, timeout) {
      calls.load.push({ url, timeout });
      if (overrides.loadError) throw overrides.loadError;
      return { webview: { fake: true }, dispose() { board.disposed = true; } };
    },
    async clipAndSummarize(webview, article, el, opts) {
      calls.clip.push({ article, opts });
      if (overrides.clipError) throw overrides.clipError;
      article.clipNotePath = "素材库/papers/x.md";
      article.summaryNotePath = "素材库/papers/x-文献总结.md";
      return { status: "completed" };
    },
    async save() {},
  };
  return { board, calls };
}

describe("rss.clip_url", () => {
  it("dry-runs without a live context after validating the URL", async () => {
    const manifest = await registry.runAsync("/tmp", "rss.clip_url", { url: "https://example.org/paper", title: "T" }, { dryRun: true });
    assert.eq(manifest.result.mode, "dry_run_no_live_context");
    assert.eq(manifest.result.url, "https://example.org/paper");
  });
  it("rejects a missing or non-http URL even in dry-run (fail-fast at the Bridge)", async () => {
    for (const bad of ["", "doi:10.1000/x", "ftp://example.org/x", "javascript:alert(1)"]) {
      let threw = false;
      try { await registry.runAsync("/tmp", "rss.clip_url", { url: bad }, { dryRun: true }); }
      catch (e) { threw = true; assert.match(e.message, /url_must_be_http/); }
      assert.ok(threw, "must reject url: " + JSON.stringify(bad));
    }
  });
  it("requires confirmation and a live board for a real run", async () => {
    let threw = false;
    try { await registry.runAsync("/tmp", "rss.clip_url", { url: "https://example.org/p" }, { dryRun: false, confirmed: false }); }
    catch (e) { threw = true; assert.match(e.message, /explicit_confirmation_required/); }
    assert.ok(threw);
    threw = false;
    try { await registry.runAsync("/tmp", "rss.clip_url", { url: "https://example.org/p" }, { dryRun: false, confirmed: true }); }
    catch (e) { threw = true; assert.match(e.message, /scholarium_live_context_required/); }
    assert.ok(threw);
  });
  it("clips through the hidden webview and reports the saved note paths", async () => {
    await withTempVault(async (vault) => {
      const { board, calls } = fakeClipBoard();
      const manifest = await registry.runAsync(vault, "rss.clip_url", { url: "https://example.org/paper", title: "Paper T" }, { dryRun: false, confirmed: true, live: { board } });
      assert.eq(manifest.result.status, "completed");
      assert.eq(manifest.result.clip_note_path, "素材库/papers/x.md");
      assert.eq(calls.load.length, 1);
      assert.eq(calls.clip.length, 1);
      assert.eq(calls.clip[0].article.link, "https://example.org/paper");
      assert.eq(calls.clip[0].article.title, "Paper T");
      assert.eq(calls.clip[0].opts.throwOnError, true);
      assert.ok(board.disposed, "hidden webview must be disposed even on success");
    });
  });
  it("skips when a clip+summary already exists, without loading the page", async () => {
    await withTempVault(async (vault) => {
      const existing = { clip: { path: "素材库/old.md" }, summary: { path: "素材库/old-文献总结.md" } };
      const { board, calls } = fakeClipBoard({ existing });
      const manifest = await registry.runAsync(vault, "rss.clip_url", { url: "https://example.org/paper" }, { dryRun: false, confirmed: true, live: { board } });
      assert.eq(manifest.result.status, "skipped_existing");
      assert.eq(manifest.result.clip_note_path, "素材库/old.md");
      assert.eq(calls.load.length, 0, "must not touch the network when the clip already exists");
    });
  });
  it("maps paywall/challenge errors to needs_interaction instead of failed", async () => {
    await withTempVault(async (vault) => {
      const { board } = fakeClipBoard({ clipError: new Error("当前页面是出版社验证页。请完成验证后再抓取，未保存为论文正文。") });
      const manifest = await registry.runAsync(vault, "rss.clip_url", { url: "https://example.org/paper" }, { dryRun: false, confirmed: true, live: { board } });
      assert.eq(manifest.result.status, "needs_interaction");
      assert.match(manifest.result.detail, /验证页/);
    });
  });
  it("rethrows non-challenge errors so the queue item settles as failed", async () => {
    await withTempVault(async (vault) => {
      const { board } = fakeClipBoard({ clipError: new Error("disk full") });
      let threw = false;
      try { await registry.runAsync(vault, "rss.clip_url", { url: "https://example.org/paper" }, { dryRun: false, confirmed: true, live: { board } }); }
      catch (e) { threw = true; assert.match(e.message, /disk full/); }
      assert.ok(threw);
    });
  });
  it("does not require rssAutoCaptureEnabled (explicit per-URL instruction)", async () => {
    await withTempVault(async (vault) => {
      const { board, calls } = fakeClipBoard();
      const manifest = await registry.runAsync(vault, "rss.clip_url", { url: "https://example.org/paper" }, { dryRun: false, confirmed: true, live: { board, settings: { rssAutoCaptureEnabled: false } } });
      assert.eq(manifest.result.status, "completed");
      assert.eq(calls.clip.length, 1);
    });
  });
});

// ---------------------------------------------------------------------------
// rss.fetch_pdf：经浏览器会话（隐藏 webview，共享 WebVPN 登录态）下载 PDF。
// Fake board 只提供 handler 实际调用的两个方法；字节传输细节（页面内
// fetch + base64 分块）在 main.js 的 fetchPdfBytesViaWebview 里，不在这层。
// ---------------------------------------------------------------------------
const PDF_BYTES = (() => {
  const head = Buffer.from("%PDF-1.4 fake test payload ");
  return Buffer.concat([head, Buffer.alloc(600, 0x61)]); // > 512B, %PDF magic
})();
const HTML_BYTES = Buffer.concat([Buffer.from("<!DOCTYPE html><html>challenge</html>"), Buffer.alloc(600, 0x62)]);

function fakePdfBoard(overrides = {}) {
  const calls = { load: [], fetch: [] };
  const board = {
    data: { feeds: [], articles: [] },
    async loadUrlInHiddenWebview(url, timeout) {
      calls.load.push({ url, timeout });
      if (overrides.loadError) throw overrides.loadError;
      return { webview: { fake: true }, dispose() { board.disposed = true; } };
    },
    async fetchPdfBytesViaWebview(webview, pdfUrl) {
      calls.fetch.push({ pdfUrl });
      if (overrides.fetchError) throw overrides.fetchError;
      if (overrides.fetched) return overrides.fetched;
      return { status: 200, contentType: "application/pdf", finalUrl: pdfUrl, size: PDF_BYTES.length, tooLarge: false, error: null, bytes: PDF_BYTES };
    },
    async save() {},
  };
  return { board, calls };
}

describe("rss.fetch_pdf", () => {
  it("dry-runs without a live context, deriving page_url and file_name", async () => {
    const manifest = await registry.runAsync("/tmp", "rss.fetch_pdf", { pdf_url: "https://example.org/papers/x.pdf" }, { dryRun: true });
    assert.eq(manifest.result.mode, "dry_run_no_live_context");
    assert.eq(manifest.result.page_url, "https://example.org/");
    assert.eq(manifest.result.file_name, "x.pdf");
  });
  it("rejects a missing or non-http pdf_url even in dry-run", async () => {
    for (const bad of ["", "doi:10.1000/x", "ftp://example.org/x.pdf", "javascript:alert(1)"]) {
      let threw = false;
      try { await registry.runAsync("/tmp", "rss.fetch_pdf", { pdf_url: bad }, { dryRun: true }); }
      catch (e) { threw = true; assert.match(e.message, /url_must_be_http/); }
      assert.ok(threw, "must reject pdf_url: " + JSON.stringify(bad));
    }
  });
  it("requires confirmation and a live board for a real run", async () => {
    let threw = false;
    try { await registry.runAsync("/tmp", "rss.fetch_pdf", { pdf_url: "https://example.org/x.pdf" }, { dryRun: false, confirmed: false }); }
    catch (e) { threw = true; assert.match(e.message, /explicit_confirmation_required/); }
    assert.ok(threw);
    threw = false;
    try { await registry.runAsync("/tmp", "rss.fetch_pdf", { pdf_url: "https://example.org/x.pdf" }, { dryRun: false, confirmed: true }); }
    catch (e) { threw = true; assert.match(e.message, /scholarium_live_context_required/); }
    assert.ok(threw);
  });
  it("downloads through the webview session and saves into literature/downloaded-pdfs", async () => {
    await withTempVault(async (vault) => {
      const { board, calls } = fakePdfBoard();
      const manifest = await registry.runAsync(vault, "rss.fetch_pdf", { pdf_url: "https://example.org/papers/x.pdf", file_name: "Guo 2022 Au g-C3N4.pdf", page_url: "https://example.org/science/article/pii/x" }, { dryRun: false, confirmed: true, live: { board } });
      assert.eq(manifest.result.status, "completed");
      assert.eq(manifest.result.download_status, "downloaded");
      assert.eq(manifest.result.path, "literature/downloaded-pdfs/Guo_2022_Au_g-C3N4.pdf");
      assert.eq(manifest.result.bytes, PDF_BYTES.length);
      const fs = require("fs"), path = require("path");
      const onDisk = fs.readFileSync(path.join(vault, "literature", "downloaded-pdfs", "Guo_2022_Au_g-C3N4.pdf"));
      assert.ok(onDisk.equals(PDF_BYTES), "bytes on disk must equal the fetched bytes");
      assert.eq(calls.load[0].url, "https://example.org/science/article/pii/x");
      assert.eq(calls.fetch[0].pdfUrl, "https://example.org/papers/x.pdf");
      assert.ok(board.disposed, "hidden webview must be disposed even on success");
    });
  });
  it("skips when the same bytes already exist under the same name", async () => {
    await withTempVault(async (vault) => {
      const fs = require("fs"), path = require("path");
      const folder = path.join(vault, "literature", "downloaded-pdfs");
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, "x.pdf"), PDF_BYTES);
      const { board } = fakePdfBoard();
      const manifest = await registry.runAsync(vault, "rss.fetch_pdf", { pdf_url: "https://example.org/papers/x.pdf" }, { dryRun: false, confirmed: true, live: { board } });
      assert.eq(manifest.result.status, "skipped_existing");
      assert.eq(manifest.result.download_status, "already_present");
      assert.eq(fs.readdirSync(folder).length, 1, "must not mint a duplicate file");
    });
  });
  it("saves a named variant when the same name holds different bytes", async () => {
    await withTempVault(async (vault) => {
      const fs = require("fs"), path = require("path");
      const folder = path.join(vault, "literature", "downloaded-pdfs");
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, "x.pdf"), HTML_BYTES); // 占位：同名不同内容
      const { board } = fakePdfBoard();
      const manifest = await registry.runAsync(vault, "rss.fetch_pdf", { pdf_url: "https://example.org/papers/x.pdf" }, { dryRun: false, confirmed: true, live: { board } });
      assert.eq(manifest.result.status, "completed");
      assert.eq(manifest.result.download_status, "variant_saved");
      assert.match(manifest.result.path, /x\.variant-[0-9a-f]{8}\.pdf$/);
      assert.eq(fs.readdirSync(folder).length, 2);
    });
  });
  it("maps HTTP 403 from the browser session to needs_interaction, not failed", async () => {
    await withTempVault(async (vault) => {
      const { board } = fakePdfBoard({ fetched: { status: 403, contentType: "text/html", finalUrl: "", size: 0, tooLarge: false, error: null, bytes: [] } });
      const manifest = await registry.runAsync(vault, "rss.fetch_pdf", { pdf_url: "https://example.org/x.pdf" }, { dryRun: false, confirmed: true, live: { board } });
      assert.eq(manifest.result.status, "needs_interaction");
      assert.match(manifest.result.detail, /403/);
      const fs = require("fs"), path = require("path");
      assert.ok(!fs.existsSync(path.join(vault, "literature", "downloaded-pdfs")), "must not write anything on needs_interaction");
    });
  });
  it("maps non-PDF bytes (challenge page HTML) to needs_interaction", async () => {
    await withTempVault(async (vault) => {
      const { board } = fakePdfBoard({ fetched: { status: 200, contentType: "text/html", finalUrl: "https://example.org/x.pdf", size: HTML_BYTES.length, tooLarge: false, error: null, bytes: HTML_BYTES } });
      const manifest = await registry.runAsync(vault, "rss.fetch_pdf", { pdf_url: "https://example.org/x.pdf" }, { dryRun: false, confirmed: true, live: { board } });
      assert.eq(manifest.result.status, "needs_interaction");
      assert.match(manifest.result.detail, /不是 PDF/);
    });
  });
  it("throws on transport errors and oversized files so the queue settles failed", async () => {
    await withTempVault(async (vault) => {
      let threw = false;
      try {
        const { board } = fakePdfBoard({ fetchError: new Error("页面内 PDF 抓取未返回结果（脚本未执行或页面已跳转）") });
        await registry.runAsync(vault, "rss.fetch_pdf", { pdf_url: "https://example.org/x.pdf" }, { dryRun: false, confirmed: true, live: { board } });
      } catch (e) { threw = true; assert.match(e.message, /未返回结果/); }
      assert.ok(threw);
      threw = false;
      try {
        const { board } = fakePdfBoard({ fetched: { status: 200, contentType: "application/pdf", finalUrl: "", size: 60 * 1024 * 1024, tooLarge: true, error: null, bytes: [] } });
        await registry.runAsync(vault, "rss.fetch_pdf", { pdf_url: "https://example.org/x.pdf" }, { dryRun: false, confirmed: true, live: { board } });
      } catch (e) { threw = true; assert.match(e.message, /pdf_too_large/); }
      assert.ok(threw);
    });
  });
  it("disposes the hidden webview even when the fetch throws", async () => {
    await withTempVault(async (vault) => {
      const { board } = fakePdfBoard({ fetchError: new Error("boom") });
      let threw = false;
      try { await registry.runAsync(vault, "rss.fetch_pdf", { pdf_url: "https://example.org/x.pdf" }, { dryRun: false, confirmed: true, live: { board } }); }
      catch (e) { threw = true; assert.match(e.message, /boom/); }
      assert.ok(threw);
      assert.ok(board.disposed, "webview must be disposed on failure too");
    });
  });
});

// ---------------------------------------------------------------------------
// main.js fetchPdfBytesViaWebview 传输层的 bundle 守卫。2026-08-19 真实故障：
// 页面内 btoa 分块用了 32768（% 3 = 2），btoa 给每块末尾补的 "=" 出现在
// 拼接串中间，atob 直接拒绝——整块 PDF 编码全废。这层逻辑在 main.js 里、
// fake board 测试覆盖不到，所以直接守着 bundle 本身。
// ---------------------------------------------------------------------------
describe("main.js fetchPdfBytesViaWebview transport (bundle guard)", () => {
  const fs = require("fs"), path = require("path");
  const bundle = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const chunkSize = () => {
    const m = /off \+= (\d+)\) b64 \+= btoa/.exec(bundle);
    assert.ok(m, "fetchPdfBytesViaWebview 的页面内分块循环必须存在于 main.js");
    return Number(m[1]);
  };
  it("chunks in-page btoa at a multiple of 3", () => {
    assert.eq(chunkSize() % 3, 0, "btoa chunk size must be a multiple of 3, otherwise '=' padding lands mid-string and atob rejects everything");
  });
  it("reassembled length is verified before decoding", () => {
    assert.match(bundle, /PDF 分块传输不完整/);
  });
  it("the chunked encoding round-trips losslessly with the bundle's own chunk size", () => {
    const size = chunkSize();
    const bytes = require("crypto").randomBytes(100001); // 故意取非 3 的倍数长度
    let b64 = "";
    for (let off = 0; off < bytes.length; off += size) b64 += bytes.subarray(off, off + size).toString("base64");
    const firstPad = b64.indexOf("=");
    assert.ok(firstPad === -1 || firstPad >= b64.length - 2, "padding must only ever appear at the very end of the assembled base64");
    assert.ok(Buffer.from(b64, "base64").equals(bytes), "assembled base64 must decode back to the original bytes");
  });
});
