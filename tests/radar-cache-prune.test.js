"use strict";
const { describe, it, assert } = require("./harness");
const P = require("../tools/radar-cache-prune");
function data(rows) { return { rssBoard: { articles: rows } }; }
function zero(id, extra = {}) { return { id, radarScores: [{ projectId: "PRJ-001", priority: 0 }], ...extra }; }
describe("RSS zero-score cache cleanup", () => {
  it("plans only confirmed-zero rows with no user signal", () => {
    const p = P.plan(data([
      zero("remove"), zero("star", { starred: true }), zero("read", { isRead: true }),
      zero("feedback", { radarScores: [{ projectId: "PRJ-001", priority: 0, feedback: "keep" }] }),
      { id: "positive", radarScores: [{ projectId: "PRJ-001", priority: 1 }] }, { id: "new" },
    ]));
    assert.eq(p.removable_count, 1); assert.eq(p.removable_article_ids[0], "remove");
    assert.eq(p.retained_by_reason.human_feedback, 1); assert.eq(p.retained_by_reason.unscored, 1);
  });
  it("requires an unchanged cache plan before deleting and never touches the score index", () => {
    const d = data([zero("remove"), { id: "keep", radarScores: [{ priority: 5 }] }]);
    const p = P.plan(d); const done = P.execute(d, p);
    assert.eq(done.removed, 1); assert.eq(d.rssBoard.articles.length, 1); assert.eq(d.rssBoard.articles[0].id, "keep");
  });
  it("refuses a stale approval when RSS changed after preview", () => {
    const d = data([zero("remove")]); const p = P.plan(d); d.rssBoard.articles.push(zero("later"));
    let error = null; try { P.execute(d, p); } catch (caught) { error = caught; }
    assert.ok(error); assert.match(error.message, /radar_cache_changed_replan_required/);
  });
});
