"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { describe, it, assert } = require("./harness");
const S = require("../tools/schema-objects");
const H = require("../tools/hypothesis-store");
const L = require("../tools/evidence-locator");
const P = require("../tools/evidence-proposer");
const Q = require("../tools/evidence-query-expansion");

const NOW = "2026-08-11T00:00:00.000Z";
const PROJECT = "019fef48-5be0-786b-8da5-39a220613712";
const PAPER = "019fef48-5be1-79a0-82ad-2770965f8be4";
const sha = (x) => crypto.createHash("sha256").update(x, "utf8").digest("hex");
const CONCEPT_GROUPS = [
  { label: "gold", terms: ["gold nanoparticle", "Au nanoparticle"], required: true },
  { label: "bivo4", terms: ["BiVO4", "bismuth vanadate"], required: true },
  { label: "charge transfer", terms: ["interfacial charge transfer"], required: false },
];

function fixture() {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), "sch-propose-"));
  const h = S.createObject("hypothesis", {
    project_uid: PROJECT,
    statement: "Surface charge transfer at a BiVO4 interface increases visible-light activity.",
    assumptions: ["A BiVO4 interface is present"],
  }, { now: NOW });
  H.saveObject(v, h);
  const b1 = "Surface charge transfer at the BiVO4 interface increases visible-light catalytic activity and improves selectivity in this experiment.";
  const b2 = "Visible-light activity increases when the BiVO4 interface promotes charge transfer across the catalyst surface.";
  const nav = "BiVO4 visible light activity navigation";
  const clean = `<html><body><nav><p data-sch-anchor="n1">${nav}</p></nav><article><p data-sch-anchor="b1">${b1}</p><p data-sch-anchor="b2">${b2}</p></article></body></html>`;
  const raw = "<html>raw archive bytes</html>";
  const archivePath = "WebClips/proposal-fixture";
  const archiveDir = path.join(v, ...archivePath.split("/"));
  fs.mkdirSync(archiveDir, { recursive: true });
  fs.writeFileSync(path.join(archiveDir, "source.raw.html"), raw, "utf8");
  fs.writeFileSync(path.join(archiveDir, "source.clean.html"), clean, "utf8");
  fs.writeFileSync(path.join(archiveDir, "source.meta.json"), JSON.stringify({ anchors: [
    { id: "n1", tag: "p", len: nav.length, hash: L.anchorHash(nav), head: nav },
    { id: "b1", tag: "p", len: b1.length, hash: L.anchorHash(b1), head: b1.slice(0, 40) },
    { id: "b2", tag: "p", len: b2.length, hash: L.anchorHash(b2), head: b2.slice(0, 40) },
  ] }), "utf8");
  const paper = S.createObject("paper", {
    title: "Archived paper", source: "https://example.org/paper", source_archive_path: archivePath,
    source_raw_sha256: sha(raw),
  }, { now: NOW });
  const paperPath = path.join(v, "Research", "Papers", "PAPER-001.md");
  fs.mkdirSync(path.dirname(paperPath), { recursive: true });
  fs.writeFileSync(paperPath, S.serializeObject({ ...paper, uid: PAPER }), "utf8");
  return { v, h, paper: { ...paper, uid: PAPER }, b1, b2 };
}

function pdfFixture() {
  const data = fixture();
  const text = Array(12).fill("Gold nanoparticle on BiVO4 with interfacial charge transfer improves visible-light catalytic activity.").join(" ");
  const sourcePath = "literature/pdf-fixture.pdf";
  const source = path.join(data.v, ...sourcePath.split("/"));
  fs.mkdirSync(path.dirname(source), { recursive: true });
  const bytes = Buffer.from("%PDF fixture bytes", "utf8");
  fs.writeFileSync(source, bytes);
  const sourceSha = crypto.createHash("sha256").update(bytes).digest("hex");
  const anchor = { id: "p0001", text, text_hash: L.anchorHash(text), quote_hash: L.anchorHash(text), char_count: text.length };
  const sidecarDir = path.join(data.v, ".scholarium", "pdf-sidecars");
  fs.mkdirSync(sidecarDir, { recursive: true });
  fs.writeFileSync(path.join(sidecarDir, sourceSha + ".json"), JSON.stringify({
    kind: "scholarium-pdf-anchor-sidecar", schema_version: 2,
    source_path: sourcePath, source_sha256: sourceSha, original_url: "https://doi.org/10.1000/pdf-fixture", doi: "10.1000/pdf-fixture",
    evidence_locator_status: "ready", anchors: [anchor], extracted_text_sha256: sha(text),
  }), "utf8");
  return { ...data, text, sourceSha };
}

describe("deterministic evidence proposals", () => {
  it("ranks only body anchors with lexical overlap and obeys the cap", () => {
    const { v, h } = fixture();
    const r = P.proposeForHypothesis(v, h.uid, { limit: 1 });
    assert.eq(r.candidates.length, 1);
    assert.eq(r.candidates[0].anchor_region, "body");
    assert.notOk(r.candidates.some((x) => x.anchor === "n1"), "navigation must never be proposed");
    assert.ok(r.candidates[0].matched_terms.includes("bivo4"));
    assert.eq(P.proposeForHypothesis(v, h.uid, { limit: 999 }).limit, 10, "review batch size is a hard upper bound");
  });

  it("uses the full Paper × anchor × Hypothesis key across every review state", () => {
    const { v, h, paper, b1 } = fixture();
    const archive = L.loadArchive(v, "Research/Papers/PAPER-001.md");
    const existing = L.createEvidenceFromQuote(archive, {
      anchorId: "b1", quote: b1, claim: "Existing manual candidate", targetUid: h.uid, createdBy: "user",
    });
    H.saveObject(v, existing);
    let r = P.proposeForHypothesis(v, h.uid, { limit: 10 });
    assert.notOk(r.candidates.some((x) => x.paper_uid === paper.uid && x.anchor === "b1"));
    const made = P.createProposals(v, h.uid, { limit: 10 });
    assert.eq(made.created.length, 1);
    const ai = H.loadAll(v, "evidence").find((e) => e.object.created_by === "ai").object;
    assert.eq(ai.review_status, "pending");
    assert.eq(ai.candidate_only, true, "retrieval must never fabricate a placeholder scientific claim");
    assert.eq(ai.claim, undefined, "a candidate has no claim until AI review or a researcher writes one");
    assert.eq(ai.relation, undefined, "retrieval must not impersonate a scientific relation judgement");
    assert.ok(Array.isArray(ai.retrieval_matched_terms));
    let confirmation = "";
    try { H.confirmEvidence(v, ai.uid, { now: NOW }); } catch (error) { confirmation = error.message; }
    assert.match(confirmation, /candidate_only/, "a retrieval-only candidate must not bypass the claim gate through a direct confirm call");
    H.rejectEvidence(v, ai.uid, "Lexical overlap alone is not relevant.", { now: NOW });
    r = P.proposeForHypothesis(v, h.uid, { limit: 10 });
    assert.eq(r.candidates.length, 0, "a rejected candidate is a durable dedupe key");
  });

  it("requires two literal concept groups instead of proposing every mention of one material", () => {
    const { v, h } = fixture();
    const r = P.proposeForHypothesis(v, h.uid, {
      queryPhrases: ["BiVO4", "gold nanoparticle", "interfacial charge transfer"],
      queryConceptGroups: CONCEPT_GROUPS,
    });
    assert.eq(r.candidates.length, 0, "a BiVO4-only anchor is not enough to create human review work");
  });

  it("ranks a paragraph only when it contains two auditable concept groups", () => {
    const query = P.makeQuery(["gold nanoparticle", "BiVO4", "interfacial charge transfer"], CONCEPT_GROUPS);
    const ranked = P.overlap(query, "Au nanoparticle deposition on BiVO4 improves interfacial charge transfer.");
    assert.deepEq(ranked.matched_concept_groups.map((group) => group.label), ["gold", "bivo4", "charge transfer"]);
    assert.ok(ranked.score >= 9, "concept-group hits dominate generic token overlap");
  });

  it("requires every marked required group plus an independent optional group", () => {
    const query = P.makeQuery(["gold nanoparticle", "BiVO4", "interfacial charge transfer"], CONCEPT_GROUPS);
    const missingOptional = P.overlap(query, "Gold nanoparticle deposition on BiVO4 was measured.");
    assert.notOk(P.passesConceptGate(query, missingOptional), "two required materials alone do not establish the fuller proposition");
    const missingRequired = P.overlap(query, "BiVO4 improves interfacial charge transfer.");
    assert.notOk(P.passesConceptGate(query, missingRequired), "a broad material plus mechanism cannot bypass a required material");
    const complete = P.overlap(query, "Gold nanoparticle deposition on BiVO4 improves interfacial charge transfer.");
    assert.ok(P.passesConceptGate(query, complete));
    assert.deepEq(complete.matched_required_concept_groups.map((group) => group.label), ["gold", "bivo4"]);
    assert.deepEq(complete.matched_optional_concept_groups.map((group) => group.label), ["charge transfer"]);
  });

  it("refuses a legacy LLM pack without essential concept groups", () => {
    const { v, h } = fixture();
    let message = "";
    try { P.proposeForHypothesis(v, h.uid, { queryPhrases: ["BiVO4", "gold nanoparticle"] }); } catch (error) { message = error.message; }
    assert.match(message, /至少两组必要概念/);
  });

  it("reports AI precision only from reviewed proposals", () => {
    const { v, h } = fixture();
    const made = P.createProposals(v, h.uid, { limit: 1 });
    const ai = H.loadAll(v, "evidence").find((e) => e.object.uid === made.created[0].evidence_uid).object;
    assert.deepEq(P.aiPrecision(v), { proposed: 1, confirmed: 0, rejected: 0, pending: 1, reviewed: 0, precision: null });
    H.rejectEvidence(v, ai.uid, "Not relevant.", { now: NOW });
    const stats = P.aiPrecision(v);
    assert.eq(stats.confirmed, 0);
    assert.eq(stats.rejected, 1);
    assert.eq(stats.precision, 0);
  });

  it("searches only locator-ready PDF sidecars and registers their Paper only on explicit proposal creation", () => {
    const { v, h, sourceSha } = pdfFixture();
    const options = { queryPhrases: ["gold nanoparticle", "BiVO4", "interfacial charge transfer"], queryConceptGroups: CONCEPT_GROUPS };
    const preview = P.proposeForHypothesis(v, h.uid, options);
    const candidate = preview.candidates.find((item) => item.source_kind === "pdf");
    assert.ok(candidate, "a ready PDF sidecar must participate in read-only retrieval");
    assert.eq(candidate.paper_uid, "", "preview must not create a Paper");
    assert.eq(preview.scanned_pdf_sources, 1);
    const made = P.createProposals(v, h.uid, options);
    assert.eq(made.registered_pdf_papers, 1);
    const evidence = H.loadAll(v, "evidence").find((entry) => entry.object.locator?.source_sha256 === sourceSha).object;
    const paper = S.readVaultObjects(v).find((entry) => entry.object.uid === evidence.source_uid).object;
    assert.eq(paper.source_pdf_sha256, sourceSha);
    assert.eq(evidence.locator.original_url, "https://doi.org/10.1000/pdf-fixture");
    assert.notOk(S.validateVault(v).problems.some((problem) => /source_uid/.test(problem.message)), "PDF evidence may not leave an unresolved source_uid");
  });
});

describe("LLM query-expansion artifacts", () => {
  it("accepts a small English-only JSON term pack and persists its audit trail", () => {
    const { v, h } = fixture();
    const prompt = Q.promptForExpansion(h);
    const parsed = Q.parseExpansion(JSON.stringify({
      terms: ["gold nanoparticle", "bismuth vanadate", "interfacial charge transfer", "visible light photocatalysis"],
      concept_groups: CONCEPT_GROUPS,
      rationale: "Maps materials and mechanism into English retrieval phrases.",
    }));
    const saved = Q.saveQueryPack(v, h, parsed, { now: NOW, generator: "openai:test", prompt });
    const file = path.join(v, ...saved.path.split("/"));
    const back = S.parseObject(fs.readFileSync(file, "utf8"));
    assert.eq(back.object.artifact, "evidence_query_expansion");
    assert.deepEq(back.object.terms, parsed.terms);
    assert.deepEq(back.object.concept_groups, parsed.concept_groups);
    assert.match(back.body, /只记录检索扩展/);
    assert.match(back.object.prompt_sha256, /^[a-f0-9]{64}$/);
  });

  it("refuses prose, Chinese output, and oversized term packs", () => {
    let message = "";
    try { Q.parseExpansion("not JSON"); } catch (e) { message = e.message; }
    assert.match(message, /JSON/);
    message = "";
    try { Q.parseExpansion(JSON.stringify({ terms: ["中文词", "bivo4", "gold nanoparticle", "charge transfer", "visible light"] })); } catch (e) { message = e.message; }
    assert.match(message, /英文检索短语/);
    message = "";
    try { Q.parseExpansion(JSON.stringify({ terms: Array.from({ length: 21 }, (_, i) => "english phrase " + i) })); } catch (e) { message = e.message; }
    assert.match(message, /超过/);
    const incomplete = Q.parseExpansion(JSON.stringify({ terms: ["bivo4", "gold nanoparticle", "charge transfer", "visible light"], concept_groups: [{ label: "only", terms: ["BiVO4"] }] }));
    assert.eq(incomplete.concept_groups.length, 1, "a format-compatible but incomplete group list is completed from the hypothesis, not rejected outright");
  });

  it("extracts one complete pack from fenced prose without consuming later braces", () => {
    const text = [
      "Here is the requested pack:",
      "```json",
      '{"terms":["gold nanoparticle","bismuth vanadate","interfacial charge transfer","visible light photocatalysis"],"concept_groups":[{"label":"gold","terms":["gold nanoparticle"]},{"label":"bivo4","terms":["bismuth vanadate"]}],"rationale":"English retrieval only."}',
      "```",
      "Do not use this illustrative object: {not JSON}.",
    ].join("\n");
    const parsed = Q.parseExpansion(text);
    assert.deepEq(parsed.terms, ["gold nanoparticle", "bismuth vanadate", "interfacial charge transfer", "visible light photocatalysis"]);
    assert.eq(parsed.concept_groups.length, 2);
  });

  it("derives conservative groups from literal hypothesis signatures when an LLM omits them", () => {
    const hypothesis = {
      statement: "AuNP on BiVO4 with Pt is evaluated at 540nm and 365nm.",
      assumptions: [], alternative_explanations: [],
    };
    const parsed = Q.ensureConceptGroups({
      terms: ["gold nanoparticle bivo4", "pt cocatalyst bivo4", "dual wavelength photocatalysis", "charge transfer"],
      concept_groups: [], rationale: "legacy term-only output",
    }, hypothesis);
    assert.eq(parsed.concept_group_source, "deterministic_fallback");
    assert.deepEq(parsed.concept_groups.map((group) => group.label), ["540 nm", "365 nm", "aunp", "bivo4", "pt"]);
    const fallback = Q.fallbackExpansion(hypothesis);
    assert.eq(fallback.concept_group_source, "deterministic_fallback_after_llm_format_failure");
    assert.ok(fallback.terms.includes("aunp"));
    assert.ok(fallback.terms.includes("540 nm"));
    assert.ok(fallback.concept_groups.every((group) => group.required), "a no-LLM fallback must not guess which condition is optional");
  });

  it("requires an explicit discriminating group from an LLM pack", () => {
    const hypothesis = { statement: "AuNP on BiVO4 with Pt under 540 nm and 365 nm." };
    let message = "";
    try { Q.ensureConceptGroups({ terms: ["gold nanoparticle", "BiVO4", "platinum", "dual wavelength"], concept_groups: CONCEPT_GROUPS.map((group) => ({ ...group, required: false })) }, hypothesis); }
    catch (error) { message = error.message; }
    assert.match(message, /required/);
    const parsed = Q.ensureConceptGroups({ terms: ["gold nanoparticle", "BiVO4", "platinum", "dual wavelength"], concept_groups: CONCEPT_GROUPS }, hypothesis);
    assert.eq(parsed.concept_group_source, "model");
  });

  it("reads both string and content-block OpenAI-compatible responses", () => {
    const raw = '{"terms":["gold nanoparticle","bismuth vanadate","interfacial charge transfer","visible light photocatalysis"]}';
    assert.eq(Q.responseText(raw), raw);
    assert.eq(Q.responseText([{ type: "text", text: raw }]), raw);
    assert.eq(Q.responseText([{ type: "text", content: raw }]), raw);
  });

  it("reads Anthropic, Chat Completions, and Responses API envelopes", () => {
    const raw = '{"terms":["gold nanoparticle","bismuth vanadate","interfacial charge transfer","visible light photocatalysis"]}';
    assert.eq(Q.apiResponseText({ content: [{ type: "text", text: raw }] }), raw);
    assert.eq(Q.apiResponseText({ choices: [{ message: { content: [{ type: "text", text: raw }] } }] }), raw);
    assert.eq(Q.apiResponseText({ output: [{ type: "message", content: [{ type: "output_text", text: raw }] }] }), raw);
  });
});
