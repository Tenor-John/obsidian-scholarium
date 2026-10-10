"use strict";
/**
 * Research Radar scoring maths + the profile fingerprint that decides when a
 * score becomes stale. The weighting is 0.45 fit / 0.25 gain / 0.20 action /
 * 0.10 evidence, renormalised over the first three when evidence is unscored.
 */
const { sandbox, describe, it, assert } = require("./harness");

const S = sandbox({
  fns: ["schRssScoreCandidates"],
  methods: {
    normalizeRadarScore: ["t", "e", "s", "K"],
    profileFingerprint: ["t"],
  },
});

const PROFILE = { projectId: "PRJ-001", version: "abc-1", title: "T" };
const flat = (v) => ({
  fit_dimensions: { question: v, object: v, method: v, mechanism: v, goal: v },
  information_gain: v,
  actionability: v,
  exploration_value: v,
});
const ev = (v) => ({
  controls: v,
  quantification: v,
  reproducibility: v,
  limitations: v,
  availability: v,
});

describe("radar scoring", () => {
  it("queues every pending article in the selected RSS source, without a hidden cap", () => {
    const articles = Array.from({ length: 37 }, (_, i) => ({
      id: "a" + i,
      feedId: "acs",
      published: i,
    })).concat([
      { id: "other", feedId: "other", published: 99 },
      { id: "fresh-score", feedId: "acs", published: 100 },
      { id: "stale-score", feedId: "acs", published: 101 },
    ]);
    const queued = S.schRssScoreCandidates(articles, "acs", (article) =>
      article.id === "fresh-score" ? { stale: false } : article.id === "stale-score" ? { stale: true } : null,
    );
    assert.eq(queued.length, 38, "all pending and stale items from the feed must be queued");
    assert.eq(queued[0].id, "stale-score", "newest pending work runs first");
    assert.notOk(queued.some((article) => article.id === "other"));
    assert.notOk(queued.some((article) => article.id === "fresh-score"));
  });

  it("fast screening leaves evidence unscored", () => {
    const r = S.normalizeRadarScore(flat(5), PROFILE, "title_abstract", "abstract");
    assert.eq(r.evidenceQuality, null, "evidence must be null without full text");
    assert.eq(r.evidenceDimensions, null);
  });

  it("renormalises weights so a perfect fast score reaches 100, not 90", () => {
    const r = S.normalizeRadarScore(flat(5), PROFILE, "title_abstract", "abstract");
    assert.eq(r.priority, 100);
    assert.eq(r.tier, "high");
  });

  it("scales linearly below the ceiling", () => {
    assert.eq(S.normalizeRadarScore(flat(4), PROFILE, "title_abstract").priority, 80);
    assert.eq(S.normalizeRadarScore(flat(3), PROFILE, "title_abstract").priority, 60);
  });

  it("deep review averages the five evidence sub-scores", () => {
    const r = S.normalizeRadarScore(
      { ...flat(5), evidence_dimensions: ev(5) },
      PROFILE,
      "deep_review",
      "local_note",
    );
    assert.eq(r.evidenceQuality, 100);
    assert.eq(r.priority, 100);
    assert.deepEq(r.evidenceDimensions, ev(5));
  });

  it("lets weak evidence pull a perfect-fit paper down", () => {
    const r = S.normalizeRadarScore(
      {
        ...flat(5),
        evidence_dimensions: {
          controls: 0,
          quantification: 1,
          reproducibility: 0,
          limitations: 2,
          availability: 0,
        },
      },
      PROFILE,
      "deep_review",
      "local_note",
    );
    assert.eq(r.evidenceQuality, 12);
    assert.ok(r.priority < 95 && r.priority > 85, "got " + r.priority);
  });

  it("ignores evidence_dimensions supplied during fast screening", () => {
    const r = S.normalizeRadarScore(
      { ...flat(5), evidence_dimensions: ev(5) },
      PROFILE,
      "title_abstract",
      "abstract",
    );
    assert.eq(r.evidenceQuality, null, "fast screening cannot judge evidence");
  });

  it("clamps out-of-range model output", () => {
    const r = S.normalizeRadarScore(
      { ...flat(99), information_gain: -3 },
      PROFILE,
      "title_abstract",
    );
    assert.ok(r.priority <= 100 && r.priority >= 0, "got " + r.priority);
    assert.eq(r.informationGain, 0);
  });

  it("survives a completely empty model response", () => {
    const r = S.normalizeRadarScore({}, PROFILE, "title_abstract");
    assert.eq(r.priority, 0);
    assert.eq(r.tier, "low");
  });

  it("records provenance for auditability", () => {
    const r = S.normalizeRadarScore(flat(4), PROFILE, "deep_review", "local_note");
    assert.eq(r.sourceKind, "local_note");
    assert.eq(r.basis, "deep_review");
    assert.eq(r.projectVersion, "abc-1");
    assert.eq(r.rubricVersion, "research-radar-v2");
  });
});

describe("profile fingerprint", () => {
  const base = `---
title: "P"
thesis: "LSPR drives carrier dynamics"
hypotheses:
  - "H1: hot electron injection dominates"
last_updated: 2026-08-08
profile_version: 2
progress: 40
---
body text`;

  it("is stable when only volatile bookkeeping fields change", () => {
    const a = S.profileFingerprint(base);
    const b = S.profileFingerprint(
      base.replace("2026-08-08", "2026-09-01").replace("progress: 40", "progress: 75"),
    );
    assert.eq(a, b, "saving the profile must not invalidate every score");
  });

  it("is stable across whitespace and CRLF churn", () => {
    assert.eq(
      S.profileFingerprint(base),
      S.profileFingerprint(base.replace(/\n/g, "\r\n").replace(/: /g, ":  ")),
    );
  });

  it("changes when a hypothesis changes", () => {
    assert.ok(
      S.profileFingerprint(base) !==
        S.profileFingerprint(base.replace("hot electron injection", "interface states")),
      "a semantic edit must invalidate scores",
    );
  });

  it("changes when the thesis changes", () => {
    assert.ok(
      S.profileFingerprint(base) !==
        S.profileFingerprint(base.replace("carrier dynamics", "surface plasmon decay")),
    );
  });

  it("does not collide across a large set of near-identical profiles", () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i++)
      seen.add(S.profileFingerprint(base.replace("H1:", "H" + i + ":")));
    assert.eq(seen.size, 5000, "fingerprint collision");
  });

  it("handles an empty profile without throwing", () => {
    assert.eq(S.profileFingerprint(""), "empty");
    assert.eq(S.profileFingerprint(null), "empty");
  });
});
