"use strict";
/**
 * Deterministic evidence-candidate retrieval.
 *
 * This is intentionally retrieval, not a scientific judge. It ranks archived
 * body anchors by lexical overlap with a Hypothesis and may materialise those
 * anchors only as `created_by: ai`, `review_status: pending` Evidence. It never
 * assigns a relation, confirms an Evidence, or writes a formal relation.
 *
 *   node tools/evidence-proposer.js --vault <path> --hypothesis <uuid>
 */
const path = require("path");
const S = require("./schema-objects");
const H = require("./hypothesis-store");
const L = require("./evidence-locator");
const Pdf = require("./pdf-source-registry");

const EN_STOP = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "than", "have", "has", "are", "was", "were",
  "using", "used", "use", "between", "under", "over", "through", "their", "these", "those", "which", "while",
]);
const CHEM_SHORT = new Set(["ag", "al", "au", "bi", "cd", "co", "cu", "fe", "ni", "pt", "ti", "zn"]);
const ZH_STOP = new Set(["研究", "实验", "条件", "结果", "方法", "过程", "影响", "通过", "可以", "进行", "一个", "以及"]);
const DEFAULT_LIMIT = 10;

function terms(text) {
  const source = String(text || "").toLowerCase();
  const out = new Set();
  for (const token of source.match(/[a-z][a-z0-9-]{1,}/g) || [])
    if (!EN_STOP.has(token) && (token.length >= 3 || CHEM_SHORT.has(token))) out.add(token);
  for (const run of source.match(/[\u4e00-\u9fff]{2,}/g) || []) {
    if (!ZH_STOP.has(run)) out.add(run);
    for (let i = 0; i < run.length - 1; i++) {
      const bigram = run.slice(i, i + 2);
      if (!ZH_STOP.has(bigram)) out.add(bigram);
    }
  }
  return out;
}

function hypothesisTerms(hypothesis) {
  return terms([
    hypothesis.statement,
    ...(Array.isArray(hypothesis.assumptions) ? hypothesis.assumptions : []),
    ...(Array.isArray(hypothesis.alternative_explanations) ? hypothesis.alternative_explanations : []),
  ].join("\n"));
}

function makeQuery(phrases, conceptGroups = []) {
  const safe = [...new Set((phrases || []).map((p) => String(p).trim()).filter(Boolean))];
  const groups = (conceptGroups || []).map((group) => ({
    label: String(group.label || "concept"),
    terms: [...new Set((group.terms || []).map((term) => String(term).trim()).filter(Boolean))],
    required: group.required === true,
  })).filter((group) => group.terms.length);
  return { phrases: safe, terms: terms(safe.join("\n")), concept_groups: groups };
}

function containsPhrase(text, phrase) {
  const source = String(text || "").toLowerCase().replace(/\s+/g, " ");
  const needle = String(phrase || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "i").test(source);
}

function overlap(query, text) {
  // A Set is accepted for the original deterministic baseline; query packs use
  // { terms, phrases } and earn an auditable bonus for an exact multiword hit.
  const q = query instanceof Set ? { terms: query, phrases: [] } : query;
  const anchorTerms = terms(text);
  const matched = [...q.terms].filter((term) => anchorTerms.has(term));
  const compact = String(text || "").toLowerCase().replace(/\s+/g, " ");
  const matchedPhrases = (q.phrases || []).filter((phrase) => {
    const p = String(phrase).toLowerCase().replace(/\s+/g, " ").trim();
    return p.split(/\s+/).length >= 2 && compact.includes(p);
  });
  const matchedConceptGroups = (q.concept_groups || []).flatMap((group) => {
    const hits = group.terms.filter((phrase) => containsPhrase(text, phrase));
    return hits.length ? [{ label: group.label, required: group.required === true, matched: hits }] : [];
  });
  // The fractional part favours a focussed anchor when hit counts tie, but
  // never hides the observable hit count used to audit the rank.
  return {
    matched,
    matched_phrases: matchedPhrases,
    matched_concept_groups: matchedConceptGroups,
    matched_required_concept_groups: matchedConceptGroups.filter((group) => group.required),
    matched_optional_concept_groups: matchedConceptGroups.filter((group) => !group.required),
    score: matchedConceptGroups.length * 3 + matchedPhrases.length * 2 + matched.length / Math.max(100, anchorTerms.size * 100),
  };
}

/** A model pack must retain its discriminating backbone, not merely two broad terms. */
function passesConceptGate(query, ranked) {
  const groups = query.concept_groups || [];
  if (!groups.length)
    return ranked.matched.length >= 2 || ranked.matched_phrases.length > 0;
  const required = groups.filter((group) => group.required === true);
  if (!required.length)
    // Existing saved packs predate `required`; preserve their conservative
    // two-group semantics rather than changing historical retrieval silently.
    return ranked.matched_concept_groups.length >= 2;
  const matchedLabels = new Set(ranked.matched_concept_groups.map((group) => group.label));
  if (!required.every((group) => matchedLabels.has(group.label))) return false;
  const optional = groups.filter((group) => !group.required);
  return !optional.length || ranked.matched_optional_concept_groups.length >= 1;
}

function evidenceKey(object) {
  const locator = object.locator || {};
  return [object.source_uid || "", locator.anchor || "", object.target_uid || ""].join("\u0000");
}

function existingEvidenceKeys(vault) {
  return new Set(H.loadAll(vault, "evidence").map((entry) => evidenceKey(entry.object)));
}

function existingPdfEvidenceKeys(vault) {
  const papers = new Map(S.readVaultObjects(vault)
    .filter((entry) => entry.object.type === "paper" && entry.object.source_pdf_sha256)
    .map((entry) => [entry.object.uid, String(entry.object.source_pdf_sha256)]));
  return new Set(H.loadAll(vault, "evidence").flatMap((entry) => {
    const sourceSha = papers.get(entry.object.source_uid);
    const anchor = entry.object.locator?.anchor;
    return sourceSha && anchor && entry.object.target_uid ? [[sourceSha, anchor, entry.object.target_uid].join("\u0000")] : [];
  }));
}

function quoteExcerpt(text, max = 900) {
  const compact = L.normalizeAnchorText(text);
  return compact.length <= max ? compact : compact.slice(0, max).trim();
}

/** Rank previously unproposed body anchors for one Hypothesis. This does not write. */
function proposeForHypothesis(vault, hypothesisUid, options = {}) {
  // Human review throughput is the system constraint. A caller cannot bypass
  // the same ten-item batch bound through the CLI or a future UI.
  const limit = Math.max(1, Math.min(Number(options.limit) || DEFAULT_LIMIT, DEFAULT_LIMIT));
  const hypothesisEntry = H.loadAll(vault, "hypothesis").find((entry) => entry.object.uid === hypothesisUid);
  if (!hypothesisEntry) throw new Error("找不到 Hypothesis：" + hypothesisUid);
  const query = options.queryPhrases
    ? makeQuery(options.queryPhrases, options.queryConceptGroups)
    : makeQuery([...hypothesisTerms(hypothesisEntry.object)]);
  if (!query.terms.size) throw new Error("Hypothesis 没有可检索的陈述、假设前提或替代解释");
  if (options.queryPhrases && query.concept_groups.length < 2)
    throw new Error("词包缺少至少两组必要概念；请重新生成词包，避免泛词命中进入人工队列。");
  const seen = existingEvidenceKeys(vault);
  const seenPdf = existingPdfEvidenceKeys(vault);
  const papers = S.readVaultObjects(vault).filter((entry) => entry.object.type === "paper");
  const candidates = [], skipped = [];
  for (const paperEntry of papers) {
    let archive;
    try {
      archive = L.loadArchive(vault, paperEntry.path);
      const integrity = L.verifyArchiveIntegrity(archive);
      if (!integrity.ok) { skipped.push({ paper_uid: paperEntry.object.uid, reason: integrity.reason }); continue; }
    } catch (error) {
      skipped.push({ paper_uid: paperEntry.object.uid, reason: error.message || String(error) });
      continue;
    }
    for (const anchor of L.quotableAnchors(archive)) {
      if (!anchor.quotable || anchor.len < 80) continue;
      const key = [paperEntry.object.uid, anchor.id, hypothesisUid].join("\u0000");
      if (seen.has(key)) continue; // confirmed, pending, and rejected all suppress repeats.
      const text = L.extractAnchorText(archive.clean, anchor.id);
      if (!text) continue;
      const ranked = overlap(query, text);
      // Retain the conjunction the hypothesis expresses. Generic overlap
      // (light / surface / transfer) is not a research-relevant connection.
      // A query pack therefore requires two essential concept groups; the
      // legacy deterministic baseline remains usable without a pack.
      if (!passesConceptGate(query, ranked)) continue;
      try {
        // Validate the real stored anchor hash before showing it to a person.
        L.buildLocator(archive, anchor.id, quoteExcerpt(text));
      } catch (error) {
        skipped.push({ paper_uid: paperEntry.object.uid, anchor: anchor.id, reason: error.message || String(error) });
        continue;
      }
      candidates.push({
        paper_uid: paperEntry.object.uid,
        paper_path: paperEntry.path,
        paper_display_id: paperEntry.object.display_id,
        anchor: anchor.id,
        anchor_region: anchor.region,
        quote: quoteExcerpt(text),
        matched_terms: ranked.matched.sort(),
        matched_phrases: ranked.matched_phrases.sort(),
        matched_concept_groups: ranked.matched_concept_groups,
        matched_required_concept_groups: ranked.matched_required_concept_groups,
        matched_optional_concept_groups: ranked.matched_optional_concept_groups,
        score: ranked.score,
        query_pack_path: options.queryPackPath || "",
      });
    }
  }
  const pdf = Pdf.loadReadySidecars(vault);
  for (const item of pdf.ready) {
    const sidecar = item.sidecar;
    const paper = Pdf.findPaperForSidecar(vault, sidecar);
    for (const anchor of sidecar.anchors || []) {
      const key = [sidecar.source_sha256, anchor.id, hypothesisUid].join("\u0000");
      if (seenPdf.has(key) || Number(anchor.char_count || 0) < 80) continue;
      const text = L.normalizeAnchorText(anchor.text);
      const ranked = overlap(query, text);
      if (!passesConceptGate(query, ranked)) continue;
      try { L.buildPdfLocator(vault, sidecar, anchor.id, quoteExcerpt(text)); }
      catch (error) { skipped.push({ source_kind: "pdf", sidecar_path: item.sidecar_path, anchor: anchor.id, reason: error.message || String(error) }); continue; }
      candidates.push({
        source_kind: "pdf", source_pdf_sha256: sidecar.source_sha256, sidecar_path: item.sidecar_path,
        paper_uid: paper?.object.uid || "", paper_path: paper?.path || "",
        paper_display_id: paper?.object.display_id || (sidecar.doi ? "PDF · " + sidecar.doi : "PDF source"),
        anchor: anchor.id, anchor_region: "pdf_text", quote: quoteExcerpt(text),
        matched_terms: ranked.matched.sort(), matched_phrases: ranked.matched_phrases.sort(),
        matched_concept_groups: ranked.matched_concept_groups, score: ranked.score,
        matched_required_concept_groups: ranked.matched_required_concept_groups,
        matched_optional_concept_groups: ranked.matched_optional_concept_groups,
        query_pack_path: options.queryPackPath || "",
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.matched_terms.length - a.matched_terms.length || a.paper_path.localeCompare(b.paper_path) || a.anchor.localeCompare(b.anchor));
  return {
    hypothesis_uid: hypothesisUid,
    query_terms: [...query.terms].sort(),
    query_phrases: query.phrases,
    query_concept_groups: query.concept_groups,
    scanned_papers: papers.length,
    scanned_pdf_sources: pdf.ready.length,
    skipped_pdf_sources: pdf.skipped,
    skipped,
    candidates: candidates.slice(0, limit),
    available: candidates.length,
    limit,
  };
}

/** Explicitly materialise ranked candidates; never called by retrieval itself. */
function createProposals(vault, hypothesisUid, options = {}) {
  const proposal = proposeForHypothesis(vault, hypothesisUid, options);
  const existing = H.loadAll(vault, "evidence").map((entry) => entry.object.display_id);
  const created = [];
  let registeredPdfPapers = 0;
  for (const candidate of proposal.candidates) {
    const common = {
      anchorId: candidate.anchor,
      quote: candidate.quote,
      targetUid: hypothesisUid,
      createdBy: "ai",
      candidateOnly: true,
      existingDisplayIds: existing,
    };
    let evidence;
    if (candidate.source_kind === "pdf") {
      const loaded = Pdf.loadReadySidecar(vault, candidate.sidecar_path);
      loaded.sidecar.sidecar_path = loaded.sidecar_path;
      const registered = Pdf.ensurePaperForSidecar(vault, loaded.sidecar);
      if (registered.created) registeredPdfPapers++;
      evidence = L.createEvidenceFromPdfSidecar(vault, registered.entry.object, loaded.sidecar, common);
      candidate.paper_uid = registered.entry.object.uid;
      candidate.paper_path = registered.entry.path;
      candidate.paper_display_id = registered.entry.object.display_id;
    } else {
      const archive = L.loadArchive(vault, candidate.paper_path);
      evidence = L.createEvidenceFromQuote(archive, common);
    }
    const body = [
      "# 候选提议依据", "",
      "该 Evidence 是仅检索候选：它有可复核出处，但尚无科研主张；须由 AI 初审或研究者写出可核对的主张后才可确认。",
      "", "- 匹配词项：" + candidate.matched_terms.join("、"),
      "- 匹配短语：" + (candidate.matched_phrases.join("、") || "无"),
      "- 命中的必需概念组：" + (candidate.matched_required_concept_groups || []).map((group) => `${group.label} (${group.matched.join(" / ")})`).join("；"),
      "- 命中的可选概念组：" + (candidate.matched_optional_concept_groups || []).map((group) => `${group.label} (${group.matched.join(" / ")})`).join("；"),
      "- 检索词包：" + (candidate.query_pack_path || "未使用 LLM 词包"),
      "- 检索分数：" + candidate.score.toFixed(4),
    ].join("\n");
    H.saveObject(vault, {
      ...evidence,
      ...(candidate.query_pack_path ? { retrieval_query_pack_path: candidate.query_pack_path } : {}),
      retrieval_matched_terms: candidate.matched_terms,
      retrieval_matched_phrases: candidate.matched_phrases,
      retrieval_matched_concept_groups: candidate.matched_concept_groups,
      retrieval_matched_required_concept_groups: candidate.matched_required_concept_groups,
      retrieval_matched_optional_concept_groups: candidate.matched_optional_concept_groups,
    }, body + "\n");
    existing.push(evidence.display_id);
    created.push({ evidence_uid: evidence.uid, display_id: evidence.display_id, ...candidate });
  }
  return { ...proposal, created, registered_pdf_papers: registeredPdfPapers };
}

/** Calibration signal: only reviewed AI candidates belong in the denominator. */
function aiPrecision(vault) {
  const ai = H.loadAll(vault, "evidence").filter((entry) => entry.object.created_by === "ai");
  const confirmed = ai.filter((entry) => entry.object.review_status === "confirmed" || (entry.object.review_status === undefined && entry.object.verified_by_user)).length;
  const rejected = ai.filter((entry) => entry.object.review_status === "rejected").length;
  const pending = ai.length - confirmed - rejected;
  const reviewed = confirmed + rejected;
  return { proposed: ai.length, confirmed, rejected, pending, reviewed, precision: reviewed ? confirmed / reviewed : null };
}

function main() {
  const args = process.argv;
  const vaultAt = args.indexOf("--vault"), hypothesisAt = args.indexOf("--hypothesis");
  if (vaultAt < 0 || hypothesisAt < 0) throw new Error("用法：--vault <path> --hypothesis <uuid> [--limit 10] [--create]");
  const limitAt = args.indexOf("--limit");
  const vault = path.resolve(args[vaultAt + 1]);
  const options = { limit: limitAt >= 0 ? Number(args[limitAt + 1]) : DEFAULT_LIMIT };
  const result = args.includes("--create") ? createProposals(vault, args[hypothesisAt + 1], options) : proposeForHypothesis(vault, args[hypothesisAt + 1], options);
  process.stdout.write(JSON.stringify({ ...result, ai_precision: aiPrecision(vault) }, null, 2) + "\n");
}
if (require.main === module) main();

module.exports = { terms, hypothesisTerms, makeQuery, overlap, passesConceptGate, evidenceKey, existingEvidenceKeys, existingPdfEvidenceKeys, proposeForHypothesis, createProposals, aiPrecision };
