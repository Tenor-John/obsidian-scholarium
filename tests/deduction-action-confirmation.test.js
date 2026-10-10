"use strict";

const { source, describe, it, assert } = require("./harness");

describe("formal Weaver action confirmation", () => {
  it("does not submit structured action_requests directly from the agent turn", () => {
    const src = source();
    const turn = src.slice(
      src.indexOf("async runTheory(t, e, s, i, fm) {"),
      src.indexOf("  async continueCliTurn(t, e, s, i) {"),
    );
    assert.eq(/queue\.submit\(/.test(turn), false, "a model proposal must not enter the queue before a user click");
  });

  it("renders per-action confirmation and dry-runs before submitting", () => {
    const src = source();
    const card = src.slice(
      src.indexOf("renderFormalActionRequests(t, e) {"),
      src.indexOf("  renderReplyMarkdown(t, e) {"),
    );
    assert.match(card, /逐项确认后才写入 Scholarium/);
    assert.match(card, /text: .*确认执行/);
    assert.match(card, /runAsync\(s\.vault, e\.type, i, \{ dryRun: !0/);
    assert.match(card, /queue\.submit\(s\.vault, e\.type, i, \{ by: "agent:research-weaver-confirmed" \}\)/);
  });

  it("permits the four RSS proposals only through the confirmation-gated formal protocol", () => {
    const src = source();
    const protocol = src.slice(src.indexOf("  protocol(t, e, s) {"), src.indexOf("  async bridgeState() {"));
    for (const action of ["rss.fetch_pdf", "rss.clip_url", "rss.set_article_score", "rss.mark_article"])
      assert.match(protocol, new RegExp(action.replace(".", "\\.")));
    assert.match(protocol, /只有研究员点击“确认执行”后才会进入 Scholarium 队列/);
  });
});
