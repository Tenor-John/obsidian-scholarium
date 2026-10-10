"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { describe, it, assert } = require("./harness");
const R = require("../tools/radar-vault-index");
function data() { return { aiApiKey: "must-not-leak", rssBoard: { articles: [
  { id: "10.1000/a", title: "Article A", link: "https://doi.org/10.1000/a", summary: "Abstract", radarScores: [{ projectId: "PRJ-001", priority: 80, feedback: "useful", feedbackAt: 1 }] },
  { id: "10.1000/b", title: "Article B", radarScores: [] },
] } }; }
describe("radar score Markdown index", () => {
  it("plans only scored or human-feedback articles and never serializes credentials", () => {
    const p = R.plan("ignored", data()); assert.eq(p.scanned_articles, 2); assert.eq(p.selected, 1);
    assert.eq(p.writes[0].record.article_id, "10.1000/a");
    assert.noMatch(R.markdown(p.writes[0].record), /must-not-leak/);
  });
  it("rebuilds a valid feedback baseline from Markdown alone", () => {
    const v = fs.mkdtempSync(path.join(os.tmpdir(), "sch-radar-"));
    const done = R.sync(v, data(), { dryRun: false }); assert.eq(done.written, 1);
    const rebuilt = R.rebuild(v); assert.eq(rebuilt.valid, true); assert.eq(rebuilt.articles.length, 1);
    const bench = R.benchmark(v); assert.eq(bench.feedback_count, 1); assert.eq(bench.feedback_counts.useful, 1); assert.eq(bench.ready_for_calibration, false);
  });
  it("retains previously synced records when a later RSS refresh prunes them", () => {
    const v = fs.mkdtempSync(path.join(os.tmpdir(), "sch-radar-history-"));
    R.sync(v, data(), { dryRun: false });
    const later = { rssBoard: { articles: [
      { id: "10.1000/c", title: "Article C", radarScores: [{ projectId: "PRJ-001", priority: 70 }] },
    ] } };
    const p = R.plan(v, later);
    assert.eq(p.selected, 1); assert.eq(p.existing_index_records, 1);
    assert.eq(p.retained_historical_records, 1);
    assert.eq(p.retained_historical_article_ids[0], "10.1000/a");
    const done = R.sync(v, later, { dryRun: false });
    assert.eq(done.written, 1); assert.eq(done.retained_historical_records, 1);
    assert.eq(R.rebuild(v).articles.length, 2);
  });
});
