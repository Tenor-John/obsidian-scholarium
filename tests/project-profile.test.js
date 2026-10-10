"use strict";
/**
 * Project Profile v2 round-trip: form state -> frontmatter -> parse -> merge.
 * The four array fields added in v2 (hypotheses / current_problems /
 * methods_needed / excluded_topics) are what the literature radar uses to
 * decide "supports" vs "contradicts", so losing them silently is expensive.
 */
const { source, sandbox, describe, it, assert } = require("./harness");

const P = sandbox({
  fns: [
    "je", "be", "it", "vt", "yo", "st", "fs", "Lr", "schUnquote",
    "$s", "Br", "Mr", "$r", "bi", "bo", "wo", "schProfileList", "Hd",
  ],
  vars: ["Vr"],
});

const CTX = { projectId: "PRJ-001", title: "Plasmonic photocatalysis" };
const NEW_FIELDS = ["hypotheses", "currentProblems", "methodsNeeded", "excludedTopics"];

function filled() {
  const p = P.$s(CTX);
  p.thesis = "How LSPR excitation affects carrier dynamics";
  p.primarySystem = "Au/BiVO4";
  p.wavelengths = ["400 nm", "550 nm"];
  p.tags = ["LSPR"];
  p.hypotheses = ["H1: hot-electron injection dominates", "H2: interface states inert"];
  p.currentProblems = ["mechanism unclear", "no fsTAS access"];
  p.methodsNeeded = ["fsTAS"];
  p.excludedTopics = ["pure thermal catalysis"];
  return p;
}

describe("project profile v2", () => {
  it("prefers a migrated Project while retaining its legacy project id", () => {
    const src = source();
    assert.match(src, /u\.type === "project"/);
    assert.match(src, /migration_source_path/);
    assert.match(src, /includes\("\/Projects\/" \+ n \+ "\/"\)/);
    assert.match(src, /profilePath: o \? o\.path/);
  });

  it("provides a quick project creator with an editable profile skeleton", () => {
    const src = source();
    assert.match(src, /text: "\+ \\u65B0\\u5EFA\\u8BFE\\u9898"/);
    assert.match(src, /createFolder\("Research\/Projects"\)/);
    assert.match(src, /Research\/ProjectProfiles\//);
    assert.match(src, /create\(w \+ "\/profile-v0\.md"/);
    assert.match(src, /schema_version: 1/);
    assert.match(src, /artifact: \\"project_profile\\"/);
    assert.match(src, /activeProjectId: g/);
  });

  it("lets the experiment list assign one or many records to a project", () => {
    const src = source();
    assert.match(src, /renderExperimentAssignmentActions\(e\)/);
    assert.match(src, /openExperimentProjectAssignment\(e\)/);
    assert.match(src, /assignExperimentsToProject\(e, s\)/);
    assert.match(src, /processFrontMatter\(a\.file/);
    assert.match(src, /delete l\.project_id/);
  });

  it("uses the migrated Project display id instead of exposing its legacy profile id", () => {
    const src = source();
    assert.match(src, /s\(a\.display_id \|\| n\.basename, a\.title \|\| n\.basename\)/);
    assert.match(src, /Research\\\/Projects\\\/\(\[\^\/\]\+\)\\\.md/);
  });

  it("keeps the experiment-board project picker in a stable id order", () => {
    const src = source();
    assert.match(src, /schStableProjectToolbarRenderer/);
    assert.match(src, /filter\(\(f\) => f\.id\.toUpperCase\(\) !== "UNCLASSIFIED"\)/);
    assert.match(src, /localeCompare\(g\.id, void 0, \{ numeric: !0, sensitivity: "base" \}\)/);
    assert.match(src, /let b = c\.get\("UNCLASSIFIED"\)/);
  });

  it("keeps batch selection and its confirmation action visibly actionable", () => {
    const src = source();
    assert.match(src, /exp-item-project-check/);
    assert.match(src, /exp-project-assign-confirm/);
    assert.match(src, /text: "\u9000\u51FA\u6279\u91CF"/);
  });

  it("uses fixed selection and delete actions instead of a hover-only batch mode", () => {
    const src = source();
    assert.match(src, /qe\.renderExpListItem = function \(e, s\)/);
    assert.match(src, /cls: "exp-item-actions"/);
    assert.match(src, /cls: "exp-item-select-btn"/);
    assert.match(src, /this\.allExperiments\.filter\(\(a\) =>/);
  });

  it("writes the selected project id from both manual and AI-created experiments", () => {
    const src = source();
    assert.match(src, /project_id: \$\{q\}/);
    assert.match(src, /project_id: \$\{this\.yamlQuote\(this\.projectId\)\}/);
    assert.match(src, /this\.getExperimentProjectIdForCreation\(\)/);
  });

  it("provides a manual research-learning note template tied to the active project", () => {
    const src = source();
    assert.match(src, /createNewResearchLearningNote\(\)/);
    assert.match(src, /type: research-learning/);
    assert.match(src, /status: study/);
    assert.match(src, /project_id: \$\{i\}/);
    assert.match(src, /onclick = \(\) => this\.createNewResearchLearningNote\(\)/);
  });
  it("defaults the new fields to empty arrays", () => {
    const p = P.$s(CTX);
    for (const f of NEW_FIELDS) assert.deepEq(p[f], [], f);
  });

  it("round-trips every new field through frontmatter", () => {
    const p = filled();
    const back = P.Mr(CTX, P.Lr(P.bo(p)));
    for (const f of NEW_FIELDS) assert.deepEq(back[f], p[f], f);
  });

  it("round-trips values containing colons and quotes", () => {
    const p = P.$s(CTX);
    p.hypotheses = ['H1: A "dominates" B', "H2: x:y ratio matters"];
    const back = P.Mr(CTX, P.Lr(P.bo(p)));
    assert.deepEq(back.hypotheses, p.hypotheses);
  });

  it("does not accumulate backslashes across repeated saves", () => {
    // vt() JSON-escapes on write; if the reader does not unescape, every save
    // adds another level and the hypothesis text degrades permanently.
    let p = P.$s(CTX);
    p.hypotheses = ['H1: A "dominates" B'];
    for (let i = 0; i < 5; i++) p = P.Mr(CTX, P.Lr(P.bo(p)));
    assert.deepEq(p.hypotheses, ['H1: A "dominates" B'], "escaping accumulated");
  });

  it("preserves backslashes in values (e.g. LaTeX)", () => {
    const p = P.$s(CTX);
    p.hypotheses = ["rate \\propto I^2"];
    assert.deepEq(P.Mr(CTX, P.Lr(P.bo(p))).hypotheses, ["rate \\propto I^2"]);
  });

  it("writes profile_version 2", () => {
    assert.match(P.bo(filled()), /profile_version:\s*2/);
  });

  it("treats a profile carrying only hypotheses as populated", () => {
    const p = P.$s(CTX);
    p.hypotheses = ["H1: something falsifiable"];
    assert.ok(P.Br(p), "hasProfile must be true so the radar will score");
  });

  it("treats a genuinely empty profile as unpopulated", () => {
    assert.notOk(P.Br(P.$s(CTX)));
  });

  it("does not lose new fields when merging sources", () => {
    const merged = P.$r(P.$s(CTX), P.Mr(CTX, P.Lr(P.bo(filled()))));
    assert.eq(merged.hypotheses.length, 2);
    assert.eq(merged.excludedTopics.length, 1);
  });

  it("does not let a later empty source clobber a populated one", () => {
    const merged = P.$r(filled(), P.$s(CTX));
    assert.eq(merged.hypotheses.length, 2, "empty source overwrote real data");
  });

  it("exposes the new fields to the editor form", () => {
    const form = P.bi(filled());
    for (const f of NEW_FIELDS) assert.ok(Array.isArray(form[f]) && form[f].length, f);
  });

  it("renders the new fields into the human-readable summary", () => {
    const md = P.wo(filled());
    assert.match(md, /当前假设/);
    assert.match(md, /hot-electron injection dominates/);
    assert.match(md, /明确排除的方向/);
  });

  it("omits empty sections from the summary", () => {
    assert.noMatch(P.wo(P.$s(CTX)), /当前假设/);
  });

  it("accepts legacy v1 frontmatter without the new keys", () => {
    const legacy = `---\ntitle: "old"\nthesis: "t"\nprimary_system: "Au"\n---\n`;
    const back = P.Mr(CTX, P.Lr(legacy));
    for (const f of NEW_FIELDS) assert.deepEq(back[f], [], f);
    assert.ok(back.hasProfile, "v1 profiles must keep working");
  });
});
