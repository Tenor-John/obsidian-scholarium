"use strict";

const { block, describe, it, assert } = require("./harness");

describe("formal Weaver action confirmation", () => {
  it("does not submit structured action_requests directly from the agent turn", () => {
    const turn = block("runTheory(t, e, s, i, fm) {");
    assert.eq(/queue\.submit\(/.test(turn), false, "a model proposal must not enter the queue before a user click");
  });

  it("renders per-action confirmation and dry-runs before submitting", () => {
    const card = block("renderFormalActionRequests(t, e) {");
    assert.match(card, /逐项确认后才写入 Scholarium/);
    assert.match(card, /text: .*确认执行/);
    assert.match(card, /this\.confirmFormalActionRequest\(e, \w+\)/);
    const confirmation = block("confirmFormalActionRequest(t, e) {");
    assert.match(confirmation, /runAsync\([\s\S]{0,160}e\.type[\s\S]{0,200}dryRun: (?:!0|true)/);
    assert.match(confirmation, /queue\.submit\([\s\S]{0,160}e\.type[\s\S]{0,200}by: "agent:research-weaver-confirmed"/);
  });

  it("permits the four RSS proposals only through the confirmation-gated formal protocol", () => {
    const protocol = block("protocol(t, e, s) {");
    for (const action of ["rss.fetch_pdf", "rss.clip_url", "rss.set_article_score", "rss.mark_article"])
      assert.match(protocol, new RegExp(action.replace(".", "\\.")));
    assert.match(protocol, /只有研究员点击“确认执行”后才会进入 Scholarium 队列/);
  });
});
