"use strict";
// Handlers for the agent-triggerable RSS actions
// (rss.refresh_feed / rss.score_feed / rss.clip_high_score / rss.clip_url /
// rss.fetch_pdf).
//
// Each one wraps an EXISTING RssFeedBoard method instead of inventing a
// parallel write path: refreshOneFeed, scoreNewArticles and
// autoClipHighScoredArticles already ship in main.js and are exercised today
// by the RSS panel UI. `live` is the only new surface, and it is duck-typed
// on purpose so tests can pass a fake board without loading Obsidian:
//
//   live = {
//     board: {
//       data: { feeds: [...], articles: [...] },
//       selectedFeedId, refreshOneFeed(feed), scoreNewArticles(),
//       currentRadarScore(article), autoClipHighScoredArticles(articles),
//     },
//     settings: { rssAutoCaptureEnabled, rssAutoCaptureMinScore, rssAutoCaptureMaxPerBatch },
//   }
//
// In production `live.board` is `window.__scholariumRssBoard` (only set
// while the Scholarium dashboard view is open) and `live.settings` is
// `plugin.settings`. See docs/bridge-control-plane.md for the onload() wiring
// that supplies it. tools/action-registry.js still owns dry-run gating,
// confirmation, the L0-L3 policy check and the audit manifest; these
// handlers only ever run inside that.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function requireLive(live, dryRun) {
  if (live && live.board) return live;
  if (dryRun) return null; // dry-run without a live board: validate input only
  throw new Error("scholarium_live_context_required");
}

function findFeed(board, feedId) {
  const feed = (board.data.feeds || []).find((f) => f.id === feedId);
  if (!feed) throw new Error("feed_not_found:" + feedId);
  return feed;
}

function needsScore(board, article) {
  const score = board.currentRadarScore(article);
  return !score || score.stale;
}

async function refreshFeed(vault, input, options, live) {
  const feedId = String(input.feed_id || "");
  if (!feedId) throw new Error("feed_id_required");
  const ctx = requireLive(live, options.dryRun);
  if (!ctx) return { feed_id: feedId, mode: "dry_run_no_live_context" };
  const feed = findFeed(ctx.board, feedId);
  const before = (ctx.board.data.articles || []).filter((a) => a.feedId === feedId).length;
  if (options.dryRun) {
    return { feed_id: feedId, feed_title: feed.title, cached_articles: before, last_fetched: feed.lastFetched || null };
  }
  await ctx.board.refreshOneFeed(feed);
  const after = (ctx.board.data.articles || []).filter((a) => a.feedId === feedId).length;
  return {
    feed_id: feedId, feed_title: feed.title,
    articles_before: before, articles_after: after,
    new_articles: Math.max(0, after - before),
    feed_error: feed.error || null,
  };
}

async function scoreFeed(vault, input, options, live) {
  const feedId = String(input.feed_id || "");
  if (!feedId) throw new Error("feed_id_required");
  const ctx = requireLive(live, options.dryRun);
  if (!ctx) return { feed_id: feedId, mode: "dry_run_no_live_context" };
  const feed = findFeed(ctx.board, feedId);
  const candidates = (ctx.board.data.articles || [])
    .filter((a) => a.feedId === feedId)
    .filter((a) => needsScore(ctx.board, a));
  if (options.dryRun) {
    return { feed_id: feedId, feed_title: feed.title, candidates: candidates.length };
  }
  if (!candidates.length) {
    return { feed_id: feedId, feed_title: feed.title, candidates_before: 0, scored: 0, unscored_remaining: 0 };
  }
  // scoreNewArticles() reads this.selectedFeedId rather than taking a
  // parameter (it is the same method the RSS panel's "评分新文章" button
  // calls). Point it at the requested feed for the duration of this run
  // only, then restore whatever the researcher had selected in the UI.
  const previousSelected = ctx.board.selectedFeedId;
  ctx.board.selectedFeedId = feedId;
  try { await ctx.board.scoreNewArticles(); }
  finally { ctx.board.selectedFeedId = previousSelected; }
  const remaining = candidates.filter((a) => needsScore(ctx.board, a)).length;
  return {
    feed_id: feedId, feed_title: feed.title,
    candidates_before: candidates.length,
    scored: candidates.length - remaining,
    unscored_remaining: remaining,
    // scoreNewArticles() also runs radar cache pruning and, if
    // rssAutoCaptureEnabled is on, auto-clips newly high-scored articles as
    // an existing chained side effect. Surfaced here so the caller isn't
    // surprised by writes it did not explicitly ask this action for.
    note: "scoreNewArticles() also prunes the zero-score cache and, if rssAutoCaptureEnabled is on in Scholarium settings, auto-clips newly high-scoring articles.",
  };
}

async function clipHighScore(vault, input, options, live) {
  const feedId = String(input.feed_id || "");
  if (!feedId) throw new Error("feed_id_required");
  const ctx = requireLive(live, options.dryRun);
  if (!ctx) return { feed_id: feedId, mode: "dry_run_no_live_context" };
  const settings = ctx.settings || {};
  // Respect the researcher's own auto-capture switch rather than bypassing
  // it. An agent-triggered run and a UI-triggered run share one gate.
  if (!settings.rssAutoCaptureEnabled) {
    return { feed_id: feedId, enabled: false, note: "rssAutoCaptureEnabled is off in Scholarium settings; turn it on there before running this action." };
  }
  const feed = findFeed(ctx.board, feedId);
  const threshold = Math.max(0, Math.min(100, Number(settings.rssAutoCaptureMinScore ?? 70)));
  const pool = (ctx.board.data.articles || [])
    .filter((a) => a.feedId === feedId)
    .filter((a) => {
      const score = ctx.board.currentRadarScore(a);
      return !!(a.link && score && Number(score.priority) >= threshold);
    });
  if (options.dryRun) {
    return { feed_id: feedId, feed_title: feed.title, enabled: true, threshold, qualifying_articles: pool.length };
  }
  const result = await ctx.board.autoClipHighScoredArticles(pool);
  return { feed_id: feedId, feed_title: feed.title, threshold, ...result };
}

// rss.clip_url：从任意 URL 抓取全文存 md。立项动机是织研者 full 车道的
// landing 结局（fetch_and_attach_pdf 确认无 OA 版本，只报告出版方着陆页）——
// 用户没有 WebClip，而 RSS 阅读器里那套"打开文献窗口→按键抓取全文"正是
// 为这种页面写的。这里复用的是同一条路径的无人值守变体：
// loadUrlInHiddenWebview + clipAndSummarize，和 autoClipHighScoredArticles
// 逐篇处理时走的代码一模一样——同一套验证页/付费墙检测
// （sourceCaptureAssessment）、同一套 clip + 文献总结双笔记落盘、同一个
// findExistingClip 去重。不新造任何写路径。
//
// 与 autoClip 的两处刻意差异：
// 1. 不看 radar 分数、不看 rssAutoCaptureEnabled 开关——这个动作本身就是
//    用户（或 Agent 经用户确认后）对"这一篇"的明确指令，不是批量策略。
// 2. 验证页/付费墙不抛出 failed，而是返回 status: "needs_interaction"——
//    这不是系统故障，是"需要用户在文献订阅窗口里打开该页、过验证后手动
//    抓取"的合法结局，面板会据此给出引导而不是报错。
async function clipUrl(vault, input, options, live) {
  const url = String(input.url || "").trim();
  if (!/^https?:\/\/\S+$/i.test(url)) throw new Error("url_must_be_http:" + (url ? url.slice(0, 80) : "(empty)"));
  const title = String(input.title || "").trim().slice(0, 200);
  const ctx = requireLive(live, options.dryRun);
  if (!ctx) return { url, title: title || null, mode: "dry_run_no_live_context" };
  // 伪 article：只提供 clipAndSummarize / findExistingClip /
  // saveSummaryNote 实际读取的字段（title/link/author/affiliations）。
  // 不进 board.data.articles——它不是 RSS 条目，不该出现在订阅面板里。
  const article = { id: "clip-url", title: title || url, link: url, author: "", affiliations: [] };
  const existing = typeof ctx.board.findExistingClip === "function" ? ctx.board.findExistingClip(article) : null;
  if (options.dryRun) {
    return {
      url, title: title || null,
      existing_clip: existing && existing.clip ? existing.clip.path : null,
      existing_summary: existing && existing.summary ? existing.summary.path : null,
    };
  }
  if (existing && existing.clip && existing.summary) {
    return { url, status: "skipped_existing", clip_note_path: existing.clip.path, summary_note_path: existing.summary.path };
  }
  if (typeof ctx.board.loadUrlInHiddenWebview !== "function" || typeof ctx.board.clipAndSummarize !== "function") {
    throw new Error("live_board_missing_clip_methods");
  }
  const handle = await ctx.board.loadUrlInHiddenWebview(url, 90000);
  try {
    // 与 autoClipHighScoredArticles 相同的节奏：did-finish-load 之后等
    // 1.2s 让懒加载/挑战页跳转落定，再由 clipAndSummarize 做权威判定。
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const dummyButton = { innerHTML: "", setAttribute() {}, removeAttribute() {} };
    const result = await ctx.board.clipAndSummarize(handle.webview, article, dummyButton, { throwOnError: true, openResult: false, quiet: true });
    return {
      url,
      status: (result && result.status) || "completed",
      clip_note_path: article.clipNotePath || (result && result.clip && result.clip.path) || "",
      summary_note_path: article.summaryNotePath || (result && result.summary && result.summary.path) || "",
    };
  } catch (error) {
    const message = String((error && error.message) || error);
    // 与 autoClip 同款判定：验证页/付费墙/未登录 = 需要人工介入的合法结局。
    if (/验证页|可验证的论文正文|付费墙|未登录|登录/i.test(message)) {
      return { url, status: "needs_interaction", detail: message };
    }
    throw error;
  } finally {
    if (handle && typeof handle.dispose === "function") handle.dispose();
  }
}

// rss.fetch_pdf：经隐藏 webview 的浏览器会话下载 PDF 并落盘
// literature/downloaded-pdfs/。立项动机（2026-08-19 真实故障）：Bridge 后台
// 下载被出版方反爬拦在门外——Elsevier 对数据中心出口 IP 整体 403 挑战页，
// 换 UA/换 URL 变体都无效；而同一个地址在「文献订阅」那个已登录 WebVPN 的
// 浏览器会话（persist:scholarium-research-browser 分区，Cookie 共享）里是
// 能拿到的。这个动作就是把"浏览器身份"借给下载用。
//
// 职责划分与 clipUrl 相同：本 handler 只做校验/去重/落盘策略，Electron 的
// 页面内 fetch + base64 分块传输由 board.fetchPdfBytesViaWebview 实现
// （main.js，与 loadUrlInHiddenWebview 同处）。校验与去重语义和
// bridge/server.js 的 fetchPdfBytes + savePdfWithDedup 逐条对齐——512B–
// 50MB、%PDF 魔数、sha256 同名去重、同名不同字节存 variant——两条下载路径
// 一套规矩，谁也不比谁宽松。
//
// 输入：pdf_url（必填，PDF 地址）；page_url（可选，在隐藏 webview 里加载的
// 同站页面，只为建立带 Cookie 的同源页面上下文，默认取 pdf_url 的站点根）；
// file_name / title（可选）。
//
// 结局设计同 clipUrl：HTTP 401/403 或取回的不是 PDF（验证页/登录页 HTML）
// 不抛 failed，而是 status: "needs_interaction"——"先去文献订阅窗口登录
// WebVPN 再重试"是合法结局，不是系统故障。
const PDF_MIN_BYTES = 512;
const PDF_MAX_BYTES = 50 * 1024 * 1024;

// 与 bridge/server.js agentPdfFilename() 同一套清洗规则：Agent/用户给的
// 名字和 URL  basename 都不可信，只保留安全字符，强制 .pdf 后缀。
function sanitizePdfFilename(suggested, url) {
  const clean = (name) => {
    const base = String(name || "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 110);
    if (!base) return null;
    return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
  };
  let urlBase = null;
  try { urlBase = path.basename(new URL(url).pathname); } catch { /* fall through */ }
  return clean(suggested) || clean(urlBase) || "browser-session-fetch.pdf";
}

// 与 bridge/server.js savePdfWithDedup() 同一套语义：同名同字节 =
// already_present（不重复保存）；同名不同字节 = 真实变体，存
// .variant-<sha8>.pdf 并如实报告；否则正常落盘。
function savePdfWithDedup(vaultRoot, folder, filename, bytes, fields) {
  fs.mkdirSync(folder, { recursive: true });
  const digest = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
  const sha256 = digest(bytes);
  const describe = (savedPath, status) => ({
    path: path.relative(vaultRoot, savedPath).replace(/\\/g, "/"),
    bytes: bytes.length, sha256, download_status: status,
    source_url: fields.source_url, downloaded_at: new Date().toISOString(),
  });
  const target = path.join(folder, filename);
  if (fs.existsSync(target)) {
    let existing = null;
    try { existing = fs.readFileSync(target); } catch { /* fall through to variant */ }
    if (existing && digest(existing) === sha256) return describe(target, "already_present");
    const variant = path.join(folder, `${path.parse(filename).name}.variant-${sha256.slice(0, 8)}.pdf`);
    if (fs.existsSync(variant)) return describe(variant, "already_present");
    fs.writeFileSync(variant, bytes);
    return describe(variant, "variant_saved");
  }
  fs.writeFileSync(target, bytes);
  return describe(target, "downloaded");
}

async function fetchPdf(vault, input, options, live) {
  const pdfUrl = String(input.pdf_url || "").trim();
  if (!/^https?:\/\/\S+$/i.test(pdfUrl)) throw new Error("url_must_be_http:" + (pdfUrl ? pdfUrl.slice(0, 80) : "(empty)"));
  const title = String(input.title || "").trim().slice(0, 200);
  let pageUrl = String(input.page_url || "").trim();
  if (pageUrl && !/^https?:\/\/\S+$/i.test(pageUrl)) throw new Error("page_url_must_be_http:" + pageUrl.slice(0, 80));
  if (!pageUrl) {
    // 加载站点根页只为建立同源页面上下文（fetch 才能带该站 Cookie 且不被
    // CORS 拦）。根页 404 也算 did-finish-load，不影响用途。
    try { pageUrl = new URL(pdfUrl).origin + "/"; } catch { pageUrl = pdfUrl; }
  }
  const filename = sanitizePdfFilename(input.file_name, pdfUrl);
  const ctx = requireLive(live, options.dryRun);
  if (!ctx) return { pdf_url: pdfUrl, page_url: pageUrl, file_name: filename, title: title || null, mode: "dry_run_no_live_context" };
  if (options.dryRun) {
    return { pdf_url: pdfUrl, page_url: pageUrl, file_name: filename, title: title || null, target_folder: "literature/downloaded-pdfs" };
  }
  if (typeof ctx.board.loadUrlInHiddenWebview !== "function" || typeof ctx.board.fetchPdfBytesViaWebview !== "function") {
    throw new Error("live_board_missing_pdf_methods");
  }
  const handle = await ctx.board.loadUrlInHiddenWebview(pageUrl, 90000);
  try {
    // 与 clipUrl 相同的节奏：did-finish-load 之后等 1.2s 让跳转/挑战页落定。
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const fetched = await ctx.board.fetchPdfBytesViaWebview(handle.webview, pdfUrl);
    if (fetched.error) throw new Error("browser_fetch_failed:" + fetched.error);
    if (fetched.tooLarge) throw new Error("pdf_too_large:" + fetched.size);
    if (fetched.status === 401 || fetched.status === 403) {
      return {
        pdf_url: pdfUrl, status: "needs_interaction",
        detail: `浏览器会话取回 HTTP ${fetched.status}——通常需要先在「文献订阅」窗口登录 WebVPN/机构访问；登录后重试本动作即可。`,
      };
    }
    if (fetched.status && fetched.status >= 400) throw new Error("browser_fetch_http_" + fetched.status);
    const bytes = Buffer.from(fetched.bytes || []);
    if (bytes.length < PDF_MIN_BYTES || bytes.length > PDF_MAX_BYTES) throw new Error("pdf_size_out_of_bounds:" + bytes.length);
    if (!bytes.subarray(0, 4).equals(Buffer.from("%PDF"))) {
      return {
        pdf_url: pdfUrl, status: "needs_interaction",
        detail: "浏览器会话取回的不是 PDF（很可能是验证页/登录页 HTML）。请在「文献订阅」窗口打开该文献页、完成登录或验证后重试。",
      };
    }
    const saved = savePdfWithDedup(vault, path.join(vault, "literature", "downloaded-pdfs"), filename, bytes, { source_url: fetched.finalUrl || pdfUrl });
    return {
      pdf_url: pdfUrl, title: title || null,
      status: saved.download_status === "already_present" ? "skipped_existing" : "completed",
      ...saved,
    };
  } finally {
    if (handle && typeof handle.dispose === "function") handle.dispose();
  }
}

// rss.set_article_score：agent（经用户确认后）直接改一篇文章的 radar 评分。
// 写入的 relevance 形状与 scoreNewArticles 产出的保持一致（overallScore /
// confidence / reason / dimensions / scoredAt），但 model 固定标
// "agent-override"、basis 固定标 "manual_agent"——面板和后续审计要能一眼
// 区分"模型打的"和"agent 代表用户改的"，两者绝不可混淆。article 的查找、
// 落盘走 board.data + board.save()，与 UI 上手动操作同一条路径。
function findArticle(board, articleId) {
  const article = (board.data.articles || []).find((a) => a.id === articleId);
  if (!article) throw new Error("article_not_found:" + articleId);
  return article;
}

async function setArticleScore(vault, input, options, live) {
  const articleId = String(input.article_id || "");
  if (!articleId) throw new Error("article_id_required");
  const score = Number(input.overall_score ?? input.score);
  if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error("overall_score_required:0-100");
  const reason = String(input.reason || "").trim().slice(0, 500);
  if (!reason) throw new Error("reason_required:评分修改必须给出理由，供日后审计");
  const ctx = requireLive(live, options.dryRun);
  if (!ctx) return { article_id: articleId, overall_score: score, reason, mode: "dry_run_no_live_context" };
  const article = findArticle(ctx.board, articleId);
  const before = article.relevance && Number.isFinite(Number(article.relevance.overallScore)) ? Number(article.relevance.overallScore) : null;
  if (options.dryRun) {
    return { article_id: articleId, title: article.title || null, score_before: before, score_after: score, reason };
  }
  const previous = article.relevance && typeof article.relevance === "object" ? article.relevance : {};
  article.relevance = {
    ...previous,
    overallScore: score,
    confidence: "manual",
    reason,
    model: "agent-override",
    basis: "manual_agent",
    scoredAt: new Date().toISOString(),
  };
  await ctx.board.save();
  return { article_id: articleId, title: article.title || null, score_before: before, score_after: score, reason };
}

// rss.mark_article：标已读/未读、收藏/取消收藏。字段名与 RSS 面板 UI 的
// 开关完全一致（article.read / article.starred，见 main.js 的点击处理），
// 保存同样走 board.save()。
async function markArticle(vault, input, options, live) {
  const articleId = String(input.article_id || "");
  if (!articleId) throw new Error("article_id_required");
  const patch = {};
  if (input.read !== undefined) patch.read = !!input.read;
  if (input.starred !== undefined) patch.starred = !!input.starred;
  if (!Object.keys(patch).length) throw new Error("nothing_to_mark:至少给 read 或 starred 之一");
  const ctx = requireLive(live, options.dryRun);
  if (!ctx) return { article_id: articleId, patch, mode: "dry_run_no_live_context" };
  const article = findArticle(ctx.board, articleId);
  if (options.dryRun) return { article_id: articleId, title: article.title || null, patch };
  Object.assign(article, patch);
  await ctx.board.save();
  return { article_id: articleId, title: article.title || null, read: !!article.read, starred: !!article.starred };
}

module.exports = { refreshFeed, scoreFeed, clipHighScore, clipUrl, fetchPdf, setArticleScore, markArticle, sanitizePdfFilename, savePdfWithDedup };
