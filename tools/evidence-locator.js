"use strict";
/**
 * Build a §6 evidence locator from a passage the researcher selected.
 *
 * The four locator fields are required precisely because they are the only
 * thing that lets a citation survive a publisher redesign. A form with four
 * text inputs would satisfy the letter of §6 and defeat its purpose: whatever
 * is typed there is unverified, and an anchor nobody checked is a link into
 * nothing. So the locator is derived from the selection instead of entered,
 * and every field is checked against the archive before an Evidence object is
 * allowed to exist.
 *
 * The verification chain:
 *
 *   quote ⊂ anchor text        the passage really comes from that anchor
 *   sha256(anchor text)[0..32] == meta.anchors[].hash
 *                              the archive agrees with itself
 *   sha256(source.raw.html)    == Paper.source_raw_sha256
 *                              the bytes are the ones the Paper was built from
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const S = require("./schema-objects");
const Experiments = require("./experiment-store");

/* The bundle assigns anchors like this (main.js ~20043):
     let l = (a.textContent || "").replace(/\s+/g, " ").trim();
     hash: this.schHash(l).slice(0, 32)
   `schHash` is sha256 hex. Reproducing both exactly is what makes a recomputed
   hash comparable to the stored one; guessing MD5 from the 32-character length
   would have produced a checker that always disagreed. */
const normalizeAnchorText = (s) => String(s == null ? "" : s).replace(/\s+/g, " ").trim();
const anchorHash = (s) => crypto.createHash("sha256").update(normalizeAnchorText(s), "utf8").digest("hex").slice(0, 32);
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    const key = e.toLowerCase();
    if (ENTITIES[key]) return ENTITIES[key];
    if (/^#x/i.test(e)) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (/^#/.test(e)) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return m;
  });
}

/** Matched ranges of one tag, depth-counted so an unclosed tag elsewhere in the
 *  document cannot corrupt them. */
function tagRanges(html, tag) {
  const re = new RegExp("<(/?)" + tag + "(?=[\\s/>])", "gi");
  const out = [];
  let depth = 0, start = -1, m;
  while ((m = re.exec(html))) {
    if (m[1] === "/") { if (depth > 0 && --depth === 0) out.push([start, m.index]); }
    else { if (depth === 0) start = m.index; depth++; }
  }
  return out;
}

const CHROME_TAGS = ["nav", "footer", "header", "aside"];
const BODY_TAGS = ["article", "main"];

/**
 * Where each anchor sits: article body, page furniture, or unknown.
 *
 * `unknown` is not a soft "probably chrome". Nature wraps its article in
 * <article>/<main>; ACS ships neither — its pages are 2,830 divs with no
 * semantic container at all, so every real paragraph there classifies as
 * unknown. Treating unknown as chrome would block evidence on a third of this
 * vault's papers. Absence of a container is not evidence of non-content, the
 * same way absence of a search hit is not evidence of a research gap.
 */
function anchorRegions(cleanHtml) {
  const chrome = CHROME_TAGS.flatMap((t) => tagRanges(cleanHtml, t));
  const body = BODY_TAGS.flatMap((t) => tagRanges(cleanHtml, t));
  const inAny = (rs, i) => rs.some(([a, b]) => i > a && i < b);
  const out = new Map();
  const re = /data-sch-anchor="([^"]+)"/g;
  let m;
  while ((m = re.exec(cleanHtml)))
    out.set(m[1], inAny(chrome, m.index) ? "chrome" : inAny(body, m.index) ? "body" : "unknown");
  return out;
}

/** The visible text of the element carrying `anchorId`. */
function extractAnchorText(cleanHtml, anchorId) {
  const at = cleanHtml.indexOf('data-sch-anchor="' + anchorId + '"');
  if (at < 0) return null;
  const open = cleanHtml.lastIndexOf("<", at);
  const name = /^<([a-z0-9]+)/i.exec(cleanHtml.slice(open, at));
  if (!name) return null;
  const tag = name[1];
  const gt = cleanHtml.indexOf(">", at);
  if (gt < 0) return null;

  const re = new RegExp("<(/?)" + tag + "(?=[\\s/>])", "gi");
  re.lastIndex = gt;
  let depth = 1, m, end = -1;
  while ((m = re.exec(cleanHtml))) {
    if (m[1] === "/") { if (--depth === 0) { end = m.index; break; } } else depth++;
  }
  if (end < 0) return null;
  /* Tags are removed, not replaced by a space. `textContent` concatenates
     descendant text nodes with nothing between them, so `foo<em>bar</em>baz`
     is "foobarbaz". Substituting a space produced "foo bar baz" and disagreed
     with the stored hash on 36% of anchors — every one of them a paragraph
     rich enough to contain inline markup, which is to say every paragraph
     worth quoting. */
  return normalizeAnchorText(decodeEntities(
    cleanHtml.slice(gt + 1, end).replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "")));
}

/** Everything about one archived paper that a locator needs. */
function loadArchive(vault, paperPath) {
  const notePath = path.join(vault, ...paperPath.split("/"));
  const { object } = S.parseObject(fs.readFileSync(notePath, "utf8"));
  if (object.type !== "paper") throw new Error("不是 Paper：" + paperPath);
  const archive = String(object.source_archive_path || "");
  if (!archive) throw new Error("Paper 缺少 source_archive_path：" + paperPath);
  const dir = path.join(vault, ...archive.split("/"));
  const cleanPath = path.join(dir, "source.clean.html");
  const metaPath = path.join(dir, "source.meta.json");
  for (const p of [cleanPath, metaPath])
    if (!fs.existsSync(p)) throw new Error("归档缺失：" + path.relative(vault, p));
  return {
    paper: object,
    dir,
    clean: fs.readFileSync(cleanPath, "utf8"),
    meta: JSON.parse(fs.readFileSync(metaPath, "utf8")),
  };
}

/**
 * Anchors a researcher may actually quote, with the reason for each exclusion.
 * Chrome is excluded; unknown is offered but marked.
 */
function quotableAnchors(archive) {
  const regions = anchorRegions(archive.clean);
  return (archive.meta.anchors || []).map((a) => ({
    id: a.id,
    tag: a.tag,
    len: a.len,
    head: a.head,
    region: regions.get(a.id) || "unknown",
    quotable: (regions.get(a.id) || "unknown") !== "chrome",
  }));
}

/**
 * Derive a §6 locator, refusing rather than guessing.
 *
 * Returns { locator, region, anchorText } or throws with the specific failure.
 */
function buildLocator(archive, anchorId, quote) {
  const stored = (archive.meta.anchors || []).find((a) => a.id === anchorId);
  if (!stored) throw new Error("锚点不在归档锚点表中：" + anchorId);

  const region = anchorRegions(archive.clean).get(anchorId) || "unknown";
  if (region === "chrome")
    throw new Error("该锚点位于页面框架（导航/页脚/广告），不是正文：" + anchorId);

  const text = extractAnchorText(archive.clean, anchorId);
  if (text === null) throw new Error("无法从 clean.html 取出锚点文本：" + anchorId);

  // The archive must agree with itself before anything is built on it.
  if (anchorHash(text) !== String(stored.hash))
    throw new Error("锚点文本与归档记录的哈希不一致，归档可能已被改动：" + anchorId);

  const wanted = normalizeAnchorText(quote);
  if (!wanted) throw new Error("引文为空");
  if (!text.includes(wanted))
    throw new Error("引文不在该锚点文本内，拒绝生成 locator：" + anchorId);

  const url = String(archive.paper.source || "");
  if (!url) throw new Error("Paper 缺少 source（original_url）");
  const sourceSha = String(archive.paper.source_raw_sha256 || archive.paper.source_clean_sha256 || "");
  if (!/^[0-9a-f]{64}$/i.test(sourceSha)) throw new Error("Paper 缺少可用的 source_sha256");

  return {
    locator: {
      source_sha256: sourceSha,
      anchor: anchorId,
      // The hash of the anchor's text, not of the selection: §6 wants the span
      // re-locatable after DOM drift, and the anchor is what survives it.
      quote_hash: String(stored.hash),
      original_url: url,
    },
    region,
    anchorText: text,
  };
}

/** Confirm a Paper's archived bytes are still the ones it was built from. */
function verifyArchiveIntegrity(archive) {
  const rawPath = path.join(archive.dir, "source.raw.html");
  if (!fs.existsSync(rawPath)) return { ok: false, reason: "source.raw.html 缺失" };
  const actual = sha256(fs.readFileSync(rawPath));
  const claimed = String(archive.paper.source_raw_sha256 || "");
  return actual === claimed ? { ok: true } : { ok: false, reason: "raw 哈希与 Paper 记录不一致" };
}

/** Build §6 locator fields from a hash-bound local-PDF sidecar. */
function buildPdfLocator(vault, sidecar, anchorId, quote) {
  if (!sidecar || sidecar.kind !== "scholarium-pdf-anchor-sidecar") throw new Error("not_pdf_sidecar");
  if (sidecar.evidence_locator_status !== "ready") throw new Error("pdf_locator_not_ready");
  const source = path.resolve(vault, ...String(sidecar.source_path || "").split("/"));
  const root = path.resolve(vault);
  if (!source.startsWith(root + path.sep) || !fs.existsSync(source)) throw new Error("pdf_source_missing");
  if (sha256(fs.readFileSync(source)) !== String(sidecar.source_sha256 || "")) throw new Error("pdf_source_hash_mismatch");
  const anchor = (sidecar.anchors || []).find((item) => item.id === anchorId);
  if (!anchor) throw new Error("pdf_anchor_missing:" + anchorId);
  const text = normalizeAnchorText(anchor.text);
  const quoteHash = String(anchor.quote_hash || anchor.text_hash || "");
  if (anchorHash(text) !== quoteHash) throw new Error("pdf_anchor_hash_mismatch:" + anchorId);
  const wanted = normalizeAnchorText(quote);
  if (!wanted || !text.includes(wanted)) throw new Error("pdf_quote_not_in_anchor:" + anchorId);
  if (!String(sidecar.original_url || "").trim()) throw new Error("pdf_original_url_missing");
  return { locator: { source_sha256: sidecar.source_sha256, anchor: anchorId, quote_hash: quoteHash, original_url: sidecar.original_url }, region: "pdf_text", anchorText: text };
}

/**
 * Create an Evidence object from a selection. `verified_by_user` stays false:
 * §4.5 keeps unconfirmed evidence out of formal state, and building it is not
 * confirming it.
 */
function createEvidenceFromQuote(archive, options) {
  const { anchorId, quote, claim, targetUid, relation, createdBy, candidateOnly } = options;
  const { locator, region } = buildLocator(archive, anchorId, quote);
  const evidence = S.createObject("evidence", {
    ...(claim ? { claim } : {}),
    source_type: "paper",
    source_uid: archive.paper.uid,
    ...(targetUid ? { target_uid: targetUid } : {}),
    ...(relation ? { relation } : {}),
    ...(candidateOnly ? { candidate_only: true } : {}),
    created_by: createdBy || "user",
    verified_by_user: false,
    quote: normalizeAnchorText(quote),
    anchor_region: region,
    locator,
  }, { existingDisplayIds: options.existingDisplayIds || [], now: options.now });
  return evidence;
}

function createEvidenceFromPdfSidecar(vault, paper, sidecar, options) {
  const { anchorId, quote, claim, targetUid, relation, createdBy, candidateOnly } = options;
  const { locator, region } = buildPdfLocator(vault, sidecar, anchorId, quote);
  if (!paper || paper.type !== "paper") throw new Error("pdf_evidence_requires_paper");
  return S.createObject("evidence", {
    ...(claim ? { claim } : {}), source_type: "paper", source_uid: paper.uid,
    ...(targetUid ? { target_uid: targetUid } : {}), ...(relation ? { relation } : {}),
    ...(candidateOnly ? { candidate_only: true } : {}),
    created_by: createdBy || "user", verified_by_user: false,
    quote: normalizeAnchorText(quote), anchor_region: region, locator,
  }, { existingDisplayIds: options.existingDisplayIds || [], now: options.now });
}

/** Create a pending Evidence from one stable Experiment result block. */
function createEvidenceFromExperiment(record, options) {
  const { anchorId, quote, claim, targetUid, relation, createdBy, aiReview } = options;
  const built = Experiments.buildLocator(record, anchorId, quote);
  return S.createObject("evidence", {
    claim: String(claim || "").trim(),
    source_type: "experiment", source_uid: record.object.uid,
    ...(targetUid ? { target_uid: targetUid } : {}),
    ...(relation ? { relation } : {}),
    ...(aiReview ? { ai_review: aiReview } : {}),
    created_by: createdBy || "user", verified_by_user: false,
    quote: built.quote, anchor_region: "experiment_result", locator: built.locator,
  }, { existingDisplayIds: options.existingDisplayIds || [], now: options.now });
}

module.exports = {
  normalizeAnchorText, anchorHash, decodeEntities, tagRanges, anchorRegions,
  extractAnchorText, loadArchive, quotableAnchors, buildLocator,
  verifyArchiveIntegrity, buildPdfLocator, createEvidenceFromQuote, createEvidenceFromPdfSidecar,
  createEvidenceFromExperiment,
};
