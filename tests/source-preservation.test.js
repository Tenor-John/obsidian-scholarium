"use strict";
/**
 * Source preservation (v2.0 §23): raw response is archived immutably, a clean
 * derivative carries locally-stable anchors, and Markdown is only the human
 * layer. Citations must be re-locatable from source_sha256 + anchor id + text
 * hash, never from a publisher CSS selector that will change.
 */
const { sandbox, describe, it, assert } = require("./harness");

// buildCleanHtml needs a DOM; Obsidian runs in Electron, node does not.
// Provide a minimal DOMParser good enough for the anchor logic.
const hasDom = typeof global.DOMParser === "function";

const S = sandbox({
  methods: {
    schHash: ["t"],
    sourceCaptureAssessment: ["t", "e"],
  },
});

describe("content hashing", () => {
  it("is a real sha256 when crypto is available", () => {
    const h = S.schHash("abc");
    assert.eq(
      h,
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      "sha256('abc')",
    );
  });

  it("is stable and content-sensitive", () => {
    assert.eq(S.schHash("hello"), S.schHash("hello"));
    assert.ok(S.schHash("hello") !== S.schHash("hellp"));
  });

  it("handles empty and null without throwing", () => {
    assert.ok(S.schHash("").length > 0);
    assert.ok(S.schHash(null).length > 0);
  });

  it("does not collide across many near-identical strings", () => {
    const seen = new Set();
    for (let i = 0; i < 3000; i++) seen.add(S.schHash("span-" + i));
    assert.eq(seen.size, 3000);
  });
});

describe("clean html contract (static analysis of the shipped source)", () => {
  const { source } = require("./harness");
  const src = source();
  const body = src.slice(
    src.indexOf("buildCleanHtml(t, e) {"),
    src.indexOf("async saveSourceSnapshots"),
  );

  it("strips executable and styling nodes", () => {
    for (const tag of ["script", "style", "noscript", "iframe", "object", "embed"])
      assert.match(body, new RegExp(tag), "must remove <" + tag + ">");
  });

  it("strips inline event handlers and javascript: hrefs", () => {
    assert.match(body, /\^on/, "on* attribute removal");
    assert.match(body, /javascript:/, "javascript: href removal");
  });

  it("injects a <base> so relative URLs stay resolvable", () => {
    assert.match(body, /createElement\("base"\)/);
  });

  it("uses a local anchor attribute, not publisher selectors", () => {
    assert.match(body, /data-sch-anchor/);
  });

  it("records a text hash per anchor so spans survive DOM drift", () => {
    assert.match(body, /hash:\s*this\.schHash/);
  });

  it("caps anchors so a pathological page cannot blow up the manifest", () => {
    assert.match(body, /5e3|5000/);
  });
});

describe("source capture classification", () => {
  const full = { anchors: Array.from({ length: 20 }, () => ({})) };

  it("marks publisher verification pages as retryable challenges", () => {
    assert.deepEq(S.sourceCaptureAssessment("<title>Client Challenge</title>", full), {
      captureState: "challenge",
      backfillStatus: "suspect",
      retryable: true,
      reason: "publisher_challenge",
    });
  });

  it("does not promote a short or paywalled page to saved", () => {
    assert.eq(S.sourceCaptureAssessment("article", { anchors: [] }).backfillStatus, "suspect");
    assert.eq(
      S.sourceCaptureAssessment("Subscribe to journal", full).captureState,
      "suspect",
    );
  });

  it("promotes only a substantial non-challenge page", () => {
    assert.deepEq(S.sourceCaptureAssessment("<article>paper body</article>", full), {
      captureState: "verified",
      backfillStatus: "saved",
      retryable: false,
      reason: "",
    });
  });
});

describe("provenance metadata contract", () => {
  const { source } = require("./harness");
  const src = source();
  const body = src.slice(
    src.indexOf("async saveSourceSnapshots(t, e, s, i, r = {}) {"),
    src.indexOf("extractCitationMeta(t, e) {"),
  );

  it("records everything a citation needs to be re-located", () => {
    for (const field of [
      "schema_version",
      "url",
      "final_url",
      "fetched_at",
      "capture_method",
      "http_status",
      "content_type",
      "sha256",
      "anchor_count",
      "anchors",
    ])
      assert.match(body, new RegExp(field), "missing " + field);
  });

  it("writes all three layers", () => {
    for (const f of ["source.raw.html", "source.clean.html", "source.meta.json"])
      assert.match(body, new RegExp(f.replace(/\./g, "\\.")), "missing " + f);
  });

  it("declares honestly which layer the markdown came from", () => {
    assert.match(body, /markdown_source/, "provenance mismatch must be recorded, not hidden");
  });

  it("archives an earlier source attempt before replacing the canonical files", () => {
    assert.match(src, /archivePreviousSourceSnapshot/);
    assert.match(src, /source-attempts/);
  });
});

describe("backfill conservation contract", () => {
  const { source } = require("./harness");
  const src = source();
  const body = src.slice(
    src.indexOf("async backfillSourceHtml() {"),
    src.indexOf("async saveSourceSnapshots"),
  );

  it("classifies every folder into an explicit outcome", () => {
    for (const st of ["saved", "skipped_existing", "failed", "no_url", "suspect"])
      assert.match(body, new RegExp('"' + st + '"|' + st + ':'), "missing status " + st);
  });

  it("asserts conservation rather than trusting the loop", () => {
    assert.match(body, /conservation/);
    assert.match(body, /folders_total/);
  });

  it("retries an existing suspect source instead of treating any raw file as complete", () => {
    assert.match(body, /canSkipVerifiedSource/);
    assert.match(body, /sourceCaptureAssessment/);
    assert.match(body, /loadUrlInVisibleWebview/);
  });

  it("gives every scanned folder a terminal state even when the batch exits early", () => {
    // A manifest claiming folders_total=29 while listing 2 entries is not an
    // audit artefact. On early exit the untouched folders must still land in
    // one of the five statuses, tagged not_reached and retryable.
    assert.match(body, /not_reached/);
    assert.match(body, /S0\.has|seen\.has|\.has\(n\.path\)/, "must diff scanned folders against entries");
    assert.match(body, /i\.length === s\.length/, "conservation must also require one entry per folder");
  });

  it("tags every failure with a reason and retry flag", () => {
    for (const reason of ["batch_ended_by_user", "capture_error", "missing_source_url", "not_reached"])
      assert.match(body, new RegExp(reason), "missing reason " + reason);
    const failedBranches = body.match(/status = "failed"/g) || [];
    const retryFlags = body.match(/retryable = !\d|retryable: !\d/g) || [];
    assert.ok(
      retryFlags.length >= failedBranches.length,
      "every failed branch needs a retryable flag: " +
        failedBranches.length + " failures vs " + retryFlags.length + " flags",
    );
  });

  it("reports attempted and not-reached separately from conservation", () => {
    assert.match(body, /folders_attempted/);
    assert.match(body, /folders_not_reached/);
    assert.match(body, /completed:/, "early exit is a separate fact from bookkeeping integrity");
  });

  it("always writes a manifest", () => {
    assert.match(body, /_source-backfill-/);
    assert.match(body, /toISOString\(\)\.replace/);
    assert.noMatch(body, /toISOString\(\)\.slice\(0, 10\)/, "a same-day rerun must not overwrite an earlier manifest");
  });

  it("disposes the review webview even when capture throws", () => {
    assert.match(body, /finally\s*\{[\s\S]{0,80}dispose/);
  });

  it("keeps an institutional login recoverable in the visible review window", () => {
    const src = source();
    const dialog = src.slice(
      src.indexOf("async loadUrlInVisibleWebview(t, e = 18e4, s = {}) {"),
      src.indexOf("async backfillSourceHtml() {"),
    );
    for (const capability of ["刷新页面", "返回上一页", "reloadIgnoringCache", "canGoBack", "new-window", "loadURL"])
      assert.match(dialog, new RegExp(capability.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("reuses one persistent research-browser session without a provider-specific login command", () => {
    const src = source();
    const dialog = src.slice(
      src.indexOf("async loadUrlInVisibleWebview(t, e = 18e4, s = {}) {"),
      src.indexOf("async backfillSourceHtml() {"),
    );
    assert.match(dialog, /persist:scholarium-research-browser/);
    assert.noMatch(src, /login-institution-for-source-capture/);
    assert.noMatch(src, /loginSourceInstitution/);
  });

  it("does not misreport redirects or failed child frames as a failed article page", () => {
    const src = source();
    const dialog = src.slice(
      src.indexOf("async loadUrlInVisibleWebview(t, e = 18e4, s = {}) {"),
      src.indexOf("async backfillSourceHtml() {"),
    );
    assert.match(dialog, /b === -3/);
    assert.match(dialog, /m\.isMainFrame === !1/);
    assert.match(dialog, /页面正在跳转，请稍候/);
  });

  // Six WebVPN quick-jump tests were removed in favour of the test below.
  // They pinned one university's portal DOM as a contract; the capture path
  // is now institution-agnostic, so asserting that behaviour would block the
  // very generalisation it was meant to protect.
  it("keeps the source-capture path institution-agnostic", () => {
    // This plugin has to work at any university. Access can be campus IP,
    // EZproxy, OpenAthens, Shibboleth/CARSI or a WebVPN portal - the capture
    // path must not know or care. It opens the publisher URL in a persistent
    // browser session and lets the user authenticate however their institution
    // works. An earlier version hardcoded one university's WebVPN portal and
    // scraped its quick-jump widget; this test now pins the inverse.
    const src = source();
    const dialog = src.slice(
      src.indexOf("async loadUrlInVisibleWebview(t, e = 18e4, s = {}) {"),
      src.indexOf("async backfillSourceHtml() {"),
    );
    for (const institutionSpecific of [
      "wvpn.ustc.edu.cn",
      "via_webvpn",
      "USTC",
      "快速跳转",
    ])
      assert.noMatch(
        dialog,
        new RegExp(institutionSpecific.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
        "source capture must not hardcode " + institutionSpecific,
      );
    // what it must keep: a persistent session, and user-driven navigation
    for (const contract of [
      "persist:scholarium-research-browser",
      "SCHOLARIUM_SOURCE_WINDOW_CLOSED",
      "keydown",
      "reloadIgnoringCache",
    ])
      assert.match(dialog, new RegExp(contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const body = src.slice(
      src.indexOf("async backfillSourceHtml() {"),
      src.indexOf("async saveSourceSnapshots"),
    );
    assert.match(body, /loadUrlInVisibleWebview\(a\.url, 6e5, \{ mode: "research-browser" \}\)/);
    assert.noMatch(body, /loadUrlInVisibleWebview\(a\.url, 18e4, \{ via_webvpn: !0 \}\)/);
    assert.match(body, /SCHOLARIUM_SOURCE_WINDOW_CLOSED/);
  });

  it("makes every new full-text note explicitly track source preservation", () => {
    const src = source();
    const saveBundle = src.slice(
      src.indexOf("async saveClipBundle(t, e, x, M) {"),
      src.indexOf("async updateClipSourcePreservation"),
    );
    assert.match(saveBundle, /source_preservation:\s*["']pending["']/);
    assert.match(saveBundle, /source_preservation_reason:\s*["']archive_not_completed["']/);
    assert.match(saveBundle, /source_preservation_retryable: true/);

    const updater = src.slice(
      src.indexOf("async updateClipSourcePreservation"),
      src.indexOf("async saveSummaryNote"),
    );
    for (const field of [
      "source_preservation",
      "source_preservation_reason",
      "source_preservation_retryable",
      "source_preservation_updated_at",
    ]) assert.match(updater, new RegExp(field));
    assert.match(updater, /processFrontMatter/);

    const capture = src.slice(
      src.indexOf("async clipAndSummarize(t, e, s, opts = {}) {"),
      src.indexOf("async addFeed(t) {"),
    );
    assert.match(capture, /status: "failed"/);
    assert.match(capture, /status: Se/);
    assert.match(capture, /archive_write_failed:/);
    assert.match(capture, /正文笔记仍为 pending/);
  });

  it("treats a migrated Paper as the full text for its original clip folder", () => {
    const src = source();
    const finder = src.slice(
      src.indexOf("findMigratedClipForArchive(t) {"),
      src.indexOf("schHash(t) {"),
    );
    assert.match(finder, /source_archive_path/);
    assert.match(finder, /getMarkdownFiles\(\)/);
    assert.match(finder, /!f && v && \(f = this\.findMigratedClipForArchive\(p\.path\)\)/);
  });

  it("uses the same persistent browser partition for direct capture and inline reading", () => {
    const src = source();
    const body = src.slice(
      src.indexOf("async backfillSourceHtml() {"),
      src.indexOf("async saveSourceSnapshots"),
    );
    assert.match(body, /loadUrlInVisibleWebview\(a\.url, 6e5, \{ mode: "research-browser" \}\)/);
    const inline = src.slice(src.indexOf("renderInlineWeb(t, e) {"), src.indexOf("async grabPageMeta"));
    assert.match(inline, /partition", "persist:scholarium-research-browser/);
  });

  it("lets the user close one page or end a batch without falsely completing it", () => {
    const src = source();
    const dialog = src.slice(
      src.indexOf("async loadUrlInVisibleWebview(t, e = 18e4, s = {}) {"),
      src.indexOf("async backfillSourceHtml() {"),
    );
    assert.match(dialog, /SCHOLARIUM_SOURCE_BACKFILL_CANCELLED/);

    const body = src.slice(
      src.indexOf("async backfillSourceHtml() {"),
      src.indexOf("async saveSourceSnapshots"),
    );
    assert.match(body, /folders_not_reached/);
    assert.match(body, /completed:\s*!n2/, "early exit must still be recorded as incomplete");
    // conservation used to be gated on !n2, which meant an early exit reported
    // conservation:false instead of accounting for the folders it skipped.
    // Ending a batch early is now honestly recorded via completed/not_reached
    // while the five counts still have to add up.
    assert.noMatch(body, /conservation:\s*!n2/, "conservation must not simply be waived on early exit");
  });
});
