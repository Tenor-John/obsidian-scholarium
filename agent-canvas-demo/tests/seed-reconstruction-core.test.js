"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../seed-reconstruction-core.js");
const S = require("../../tools/schema-objects.js");

const PROJECT = {
  uid: "01927d3f-8a41-7c62-b5e0-9f3a2c1d4e5b", display_id: "PRJ-002",
  schema_version: 1, type: "project", created_at: "2026-08-20T00:00:00.000Z", updated_at: "2026-08-20T00:00:00.000Z",
  title: "CeO2 壳厚对 Au@CeO2 可见光析氢活性的影响", status: "active",
};
const HYP_UID = "01a01f23-7857-73fc-8d4e-a2076b355e40";

test("identityGateCheck accepts matching, normalized Project title vs topic.json name", () => {
  const ok = Core.identityGateCheck({ projectTitle: "CeO2 壳厚对 Au@CeO2 可见光析氢活性的影响", topicName: "CeO2壳厚对Au@CeO2可见光析氢活性的影响" });
  assert.equal(ok.ok, true);
});

test("identityGateCheck treats Unicode formula subscripts and ASCII digits as the same title", () => {
  const ok = Core.identityGateCheck({ projectTitle: "CeO₂ 壳厚对 Au@CeO₂ 可见光析氢活性的影响", topicName: "CeO2壳厚对Au@CeO2可见光析氢活性的影响" });
  assert.equal(ok.ok, true);
});

test("identityGateCheck blocks a PRJ/workspace mismatch (the PRJ-004/PRJ-002 cwd bug)", () => {
  const bad = Core.identityGateCheck({ projectTitle: "CeO2 壳厚对 Au@CeO2 可见光析氢活性的影响", topicName: "验收测试用临时课题" });
  assert.equal(bad.ok, false);
  assert.match(bad.reasons[0], /不一致/);
});

function discoveryReply(overrides = {}) {
  return JSON.stringify({
    candidates: [{
      doi: "10.1016/J.APCATB.2021.119947", title: "Insightful understanding...", journal: "Applied Catalysis B: Environmental",
      issn: "0926-3373", year: 2021, authors: ["Dung Van Dao"], relation_to_seed: "cited_by",
      source_query: "Semantic Scholar citations for 10.1039/D0TA00811G", source_response_excerpt: "DOI: 10.1016/J.APCATB.2021.119947; title: Insightful understanding...",
      tentative_relevance: "direct_evidence", relevance_reason: "same core-shell system, shell-thickness gradient",
      ...overrides,
    }],
  });
}

test("parseCandidateDiscoveryReply accepts a candidate with real DOI + source query + excerpt", () => {
  const parsed = Core.parseCandidateDiscoveryReply(discoveryReply());
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.candidates.length, 1);
  assert.equal(parsed.value.candidates[0].doi, "10.1016/J.APCATB.2021.119947");
});

test("parseCandidateDiscoveryReply rejects a source endpoint that was not recorded in this run's manifest", () => {
  const parsed = Core.parseCandidateDiscoveryReply(discoveryReply(), { allowedSourceQueries: ["https://api.crossref.org/works/10.1039%2Fd0ta00811g"] });
  assert.equal(parsed.ok, false);
  const accepted = Core.parseCandidateDiscoveryReply(discoveryReply({
    source_query: "https://api.crossref.org/works/10.1039%2Fd0ta00811g",
    source_response_excerpt: "DOI: 10.1016/J.APCATB.2021.119947; authors: Dao",
  }), { allowedSourceQueries: ["https://api.crossref.org/works/10.1039%2Fd0ta00811g"] });
  assert.equal(accepted.ok, true);
});

test("parseCandidateDiscoveryReply hydrates bibliographic fields from the recorded manifest instead of trusting Agent completions", () => {
  const endpoint = "https://api.crossref.org/works/10.1039%2Fd0ta00811g";
  const parsed = Core.parseCandidateDiscoveryReply(discoveryReply({
    title: "model-invented title", journal: "model-invented journal", authors: ["model-invented author"], year: 2099,
    source_query: endpoint, source_response_excerpt: "DOI: 10.1016/J.APCATB.2021.119947; title: (empty); authors: Dao",
  }), { allowedSourceQueries: [endpoint], sourceManifest: [{ endpoint, references: [{
    doi: "10.1016/J.APCATB.2021.119947", title: "", journal: "Applied Catalysis B", authors: "Dao", year: 2021,
  }] }] });
  assert.equal(parsed.ok, true);
  const candidate = parsed.value.candidates[0];
  assert.equal(candidate.title, "");
  assert.equal(candidate.journal, "Applied Catalysis B");
  assert.deepEqual(candidate.authors, ["Dao"]);
  assert.equal(candidate.year, 2021);
});

test("parseCandidateDiscoveryReply drops a title-less non-author match even when the Agent labels it methodology", () => {
  const endpoint = "https://api.crossref.org/works/10.1039%2Fd0ta00811g";
  const parsed = Core.parseCandidateDiscoveryReply(discoveryReply({
    source_query: endpoint, source_response_excerpt: "DOI: 10.1016/J.APCATB.2021.119947; authors: Other",
    tentative_relevance: "methodology_reference",
  }), { allowedSourceQueries: [endpoint], sourceManifest: [{ endpoint, work: { authors: ["Dung Van Dao"] }, references: [{
    doi: "10.1016/J.APCATB.2021.119947", title: "", journal: "Journal", authors: "Other", year: 2021,
  }] }] });
  assert.equal(parsed.ok, false);
});

test("enrichCandidatesWithCrossrefMetadata uses a Bridge-fetched work record instead of model-completed metadata", () => {
  const [candidate] = Core.enrichCandidatesWithCrossrefMetadata([{
    doi: "10.1039/c9ta09333h", title: "", journal: "J. Mater. Chem. A", authors: ["Dao"], year: 2019,
  }], [{
    doi: "10.1039/c9ta09333h",
    manifest: {
      endpoint: "https://api.crossref.org/works/10.1039%2Fc9ta09333h", fetched_at: "2026-09-01T00:00:00.000Z",
      work: { doi: "10.1039/c9ta09333h", title: "Pt-loaded Au@CeO2 core-shell nanocatalysts", journal: "Journal of Materials Chemistry A", issn: ["2050-7488"], authors: ["Dung Van Dao"], year: 2019 },
    },
  }]);
  assert.equal(candidate.title, "Pt-loaded Au@CeO2 core-shell nanocatalysts");
  assert.equal(candidate.journal, "Journal of Materials Chemistry A");
  assert.deepEqual(candidate.authors, ["Dung Van Dao"]);
  assert.equal(candidate.issn, "2050-7488");
  assert.equal(candidate.metadata_status, "enriched");
  assert.match(candidate.relevance_reason, /仅因同作者链/);
});

test("enrichCandidatesWithCrossrefMetadata leaves a failed title lookup explicitly non-reviewable", () => {
  const [candidate] = Core.enrichCandidatesWithCrossrefMetadata([{ doi: "10.1016/j.jcat.2019.07.054", title: "" }], [{
    doi: "10.1016/j.jcat.2019.07.054", error: "Crossref returned HTTP 503",
  }]);
  assert.equal(candidate.title, "");
  assert.equal(candidate.metadata_status, "unavailable");
  assert.match(candidate.metadata_error, /503/);
});

test("parseCandidateDiscoveryReply rejects a candidate with no source query/excerpt (source gate)", () => {
  const parsed = Core.parseCandidateDiscoveryReply(JSON.stringify({ candidates: [{ doi: "10.1016/J.APCATB.2021.119947", title: "x" }] }));
  assert.equal(parsed.ok, false);
  assert.match(parsed.error, /来源门/);
});

test("parseCandidateDiscoveryReply rejects a candidate whose doi does not look like a DOI (no fabrication)", () => {
  const parsed = Core.parseCandidateDiscoveryReply(discoveryReply({ doi: "made-up-not-a-doi" }));
  assert.equal(parsed.ok, false);
});

test("parseCandidateDiscoveryReply accepts an explicit empty result as an honest budget-limited outcome", () => {
  const parsed = Core.parseCandidateDiscoveryReply(JSON.stringify({ candidates: [] }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.candidates, []);
  assert.equal(parsed.value.empty_result, true);
});

test("checkJournalWhitelist classifies whitelist/blacklist/unknown deterministically", () => {
  const whitelistData = { byIssn: { "0926-3373": { tier: "JCR Q1" } }, blacklistNames: ["Some Warned Journal"] };
  const [a, b, c] = Core.checkJournalWhitelist([
    { doi: "d1", issn: "0926-3373", journal: "Applied Catalysis B" },
    { doi: "d2", issn: "0000-0000", journal: "Some Warned Journal" },
    { doi: "d3", issn: "0000-0001", journal: "Unlisted Journal" },
  ], whitelistData);
  assert.equal(a.whitelistStatus, "whitelist");
  assert.equal(a.whitelistTier, "JCR Q1");
  assert.equal(b.whitelistStatus, "blacklist");
  assert.equal(c.whitelistStatus, "unknown");
});

const ADMITTED_INPUTS = [{ doi: "10.1016/J.APCATB.2021.119947", path: "literature/downloaded-pdfs/Dao2021.pdf", sha256: "9cf92e142b721abc90dee840103e4f8629f6ef72dcbfb24b0769078bede4c4ff" }];

function contentReply(overrides = {}) {
  return JSON.stringify({
    papers: [{
      doi: "10.1016/J.APCATB.2021.119947", suggested_role: "direct_evidence", role_reason: "shell-thickness gradient + HER data",
      findings: [{
        quote: "the hydrogen evolution rate of the Au@CeO2-18 photocatalyst (4.05 umol mg-1 h-1) is much higher than...",
        anchor: "3.4 Photocatalytic HER performance, Fig. 6b",
        target_hypothesis_uid: HYP_UID, relation: "QUALIFIES", claim: "non-monotonic shell-thickness/HER relation",
        confound_note: "BET surface area increases monotonically while activity does not", insufficient_evidence: false, insufficient_reason: "",
        ...overrides,
      }],
    }],
  });
}

test("parseContentAdmissionReply accepts a finding with locatable quote + known hypothesis uid", () => {
  const parsed = Core.parseContentAdmissionReply(contentReply(), { admittedInputs: ADMITTED_INPUTS, existingHypothesisUids: [HYP_UID] });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.papers[0].findings.length, 1);
});

test("parseContentAdmissionReply rejects a DOI outside this round's admitted_inputs (never scans old downloaded-pdfs)", () => {
  const raw = contentReply().replace("10.1016/J.APCATB.2021.119947", "10.9999/not-admitted-this-round");
  const parsed = Core.parseContentAdmissionReply(raw, { admittedInputs: ADMITTED_INPUTS, existingHypothesisUids: [HYP_UID] });
  assert.equal(parsed.ok, false);
});

test("parseContentAdmissionReply drops a finding that cites a hypothesis uid that does not exist, but keeps the paper itself", () => {
  const parsed = Core.parseContentAdmissionReply(contentReply({ target_hypothesis_uid: "01a00000-0000-7000-8000-000000000000" }), { admittedInputs: ADMITTED_INPUTS, existingHypothesisUids: [HYP_UID] });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.papers.length, 1);
  assert.equal(parsed.value.papers[0].findings.length, 0); // the offending finding was the only one, and it's dropped — not the whole paper
});

test("parseContentAdmissionReply drops a finding with no quote/anchor unless explicitly marked insufficient_evidence", () => {
  const parsed = Core.parseContentAdmissionReply(contentReply({ quote: "", anchor: "" }), { admittedInputs: ADMITTED_INPUTS, existingHypothesisUids: [HYP_UID] });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.value.papers[0].findings.length, 0);
  const okInsufficient = Core.parseContentAdmissionReply(contentReply({ quote: "", anchor: "", insufficient_evidence: true, insufficient_reason: "no clean single-variable comparison" }), { admittedInputs: ADMITTED_INPUTS, existingHypothesisUids: [HYP_UID] });
  assert.equal(okInsufficient.ok, true);
});

test("buildReviewPackage assembles an editable, non-vault structure with dedup hints attached", () => {
  const contentFindings = Core.parseContentAdmissionReply(contentReply(), { admittedInputs: ADMITTED_INPUTS, existingHypothesisUids: [HYP_UID] }).value;
  const pkg = Core.buildReviewPackage({
    discovery: { candidates: Core.parseCandidateDiscoveryReply(discoveryReply()).value.candidates }, contentFindings, admittedInputs: ADMITTED_INPUTS,
    dedupHits: { papers: {}, evidence: [] },
    existingHypotheses: [{ uid: HYP_UID, display_id: "HYP-006", statement: "..." }],
  });
  assert.equal(pkg.papers[0].doi, "10.1016/J.APCATB.2021.119947");
  assert.equal(pkg.papers[0].title, "Insightful understanding...");
  assert.equal(pkg.papers[0].journal, "Applied Catalysis B: Environmental");
  assert.deepEqual(pkg.papers[0].authors, ["Dung Van Dao"]);
  assert.equal(pkg.papers[0].findings[0].target_hypothesis_display_id, "HYP-006");
  assert.equal(pkg.papers[0].existing_paper, null);
});

test("an Agent-excluded paper is shown for researcher review but is not preselected for admission", () => {
  assert.equal(Core.defaultPaperIncluded({ suggested_role: "direct_evidence", existing_paper: null }), true);
  assert.equal(Core.defaultPaperIncluded({ suggested_role: "methodology_reference", existing_paper: null }), true);
  assert.equal(Core.defaultPaperIncluded({ suggested_role: "exclude", existing_paper: null }), false);
  assert.equal(Core.defaultPaperIncluded({ suggested_role: "direct_evidence", existing_paper: { display_id: "PAPER-001" } }), false);
});

test("buildAdmissionDrafts only builds items the researcher checked, and produces schema-valid Paper/Evidence/Decision", () => {
  let n = 200;
  const selections = {
    papers: [{ include: true, doi: "10.1016/J.APCATB.2021.119947", title: "Insightful understanding...", journal: "Applied Catalysis B: Environmental", year: 2021, authors: ["Dung Van Dao"], tags: ["shell-thickness"], notes: "" }],
    evidence: [{
      include: true, source_doi: "10.1016/J.APCATB.2021.119947", target_hypothesis_uid: HYP_UID, relation: "QUALIFIES",
      claim: "non-monotonic shell-thickness/HER relation", limitations: "surface area not normalized", conditions: "Xe lamp >420nm",
      strength: 2, quote: "the hydrogen evolution rate of the Au@CeO2-18 photocatalyst...", anchor: "3.4, Fig. 6b",
      quote_hash: "7f81279e1c524c11cc12a781390cdd75c17b9cf4cdbb81008e99209e9788d46b",
    }],
    decision: { include: true, title: "PRJ-002 种子重建准入", decision: "准入 1 篇 Paper、1 条待审 Evidence", rationale: "内容准入分析通过", trigger_condition: "研究者确认或驳回 Evidence 后更新" },
  };
  const built = Core.buildAdmissionDrafts({
    project: PROJECT, selections, at: "2026-09-01T00:00:00.000Z", uidFn: () => S.uuidV7(n++),
    admittedInputs: ADMITTED_INPUTS, existingHypothesisIds: [HYP_UID],
  });
  assert.equal(built.items.length, 3);
  assert.equal(built.paperCount, 1);
  assert.equal(built.evidenceCount, 1);
  const paper = S.parseObject(built.items[0].content).object;
  const evidence = S.parseObject(built.items[1].content).object;
  const decision = S.parseObject(built.items[2].content).object;
  assert.deepEqual(S.validateObject(paper), []);
  assert.deepEqual(S.validateObject(evidence), []);
  assert.deepEqual(S.validateObject(decision), []);
  assert.equal(paper.review_status, "pending");
  assert.equal(paper.verified_by_user, false);
  assert.equal(evidence.review_status, "pending");
  assert.equal(evidence.verified_by_user, false);
  assert.equal(evidence.source_uid, paper.uid);
  assert.equal(evidence.target_uid, HYP_UID);
});

test("buildAdmissionDrafts drops evidence for a paper the researcher did not check", () => {
  let n = 300;
  const selections = {
    papers: [{ include: false, doi: "10.1016/J.APCATB.2021.119947", title: "x" }],
    evidence: [{ include: true, source_doi: "10.1016/J.APCATB.2021.119947", target_hypothesis_uid: HYP_UID, relation: "QUALIFIES", claim: "x", quote: "q", anchor: "a", quote_hash: "h".repeat(64) }],
  };
  assert.throws(() => Core.buildAdmissionDrafts({ project: PROJECT, selections, uidFn: () => S.uuidV7(n++), admittedInputs: ADMITTED_INPUTS, existingHypothesisIds: [HYP_UID] }), /没有任何一项被勾选/);
});

test("buildAdmissionDrafts refuses a selected DOI that is already a Paper, even if a caller bypasses the disabled review checkbox", () => {
  const selections = { papers: [{ include: true, doi: "10.1016/J.APCATB.2021.119947", title: "x" }], evidence: [] };
  assert.throws(() => Core.buildAdmissionDrafts({
    project: PROJECT, selections, admittedInputs: ADMITTED_INPUTS, existingHypothesisIds: [HYP_UID],
    existingPaperDois: ["10.1016/j.apcatb.2021.119947"],
  }), /已有 Paper/);
});

test("buildAdmissionDrafts never writes into a Hypothesis's supporting/contradicting arrays itself", () => {
  const built = Core.buildAdmissionDrafts({
    project: PROJECT,
    selections: { papers: [{ include: true, doi: "10.1016/J.APCATB.2021.119947", title: "x" }], evidence: [] },
    uidFn: () => S.uuidV7(400), admittedInputs: ADMITTED_INPUTS, existingHypothesisIds: [HYP_UID],
  });
  for (const item of built.items) assert.doesNotMatch(item.content, /supporting_evidence:\s*\n\s*-/);
});

test("buildGraphManifest records exactly this round's DOIs/paths/hashes and generated uids, nothing from history", () => {
  const manifest = Core.buildGraphManifest({ admittedInputs: ADMITTED_INPUTS, paperUids: ["p1"], evidenceUids: ["e1"], runId: "run-1", project: PROJECT });
  assert.equal(manifest.inputs.length, 1);
  assert.equal(manifest.inputs[0].doi, ADMITTED_INPUTS[0].doi);
  assert.deepEqual(manifest.paper_uids, ["p1"]);
  assert.deepEqual(manifest.evidence_uids, ["e1"]);
});

test("buildCandidateDiscoveryPrompt and buildContentAdmissionPrompt state the read-only / no-fabrication / path-scope rules", () => {
  const p1 = Core.buildCandidateDiscoveryPrompt({ project: PROJECT, seeds: ["10.1039/D0TA00811G"], sourceManifest: [{
    source: "crossref", endpoint: "https://api.crossref.org/works/10.1039%2Fd0ta00811g", seed_doi: "10.1039/d0ta00811g",
    references: [{ doi: "10.1016/j.jcat.2019.07.054", title: "A method-chain paper", journal: "J. Catalysis", authors: "Dao", year: 2019 }],
  }] });
  assert.match(p1, /只读权限/);
  assert.match(p1, /不得调用 WebFetch、WebSearch/);
  assert.match(p1, /Bridge 刚刚从 Crossref/);
  assert.match(p1, /api\.crossref\.org\/works/);
  assert.match(p1, /10\.1016\/j\.jcat\.2019\.07\.054/);
  assert.match(p1, /methodology_reference/);
  assert.match(p1, /不能补写训练记忆/);
  const p2 = Core.buildContentAdmissionPrompt({ project: PROJECT, admittedInputs: ADMITTED_INPUTS, existingHypotheses: [{ uid: HYP_UID, display_id: "HYP-006", statement: "..." }] });
  assert.match(p2, /严禁扫描或读取 literature\/downloaded-pdfs\//);
  assert.match(p2, /HYP-006/);
});
