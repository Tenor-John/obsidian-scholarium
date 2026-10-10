"use strict";
const { describe, it, assert } = require("./harness");
const S = require("../tools/schema-objects");
const A = require("../tools/evidence-agent-review");

const UID = "019fef48-5be0-786b-8da5-39a220613712";
const SOURCE = "019fef48-5be1-79a0-82ad-2770965f8be4";

function evidence(review) {
  return S.createObject("evidence", {
    claim: "Candidate claim", source_type: "paper", source_uid: SOURCE, target_uid: UID,
    created_by: "ai", verified_by_user: false, review_status: "pending",
    locator: { source_sha256: "a".repeat(64), anchor: "p0001", quote_hash: "b".repeat(32), original_url: "https://doi.org/10.1000/test" },
    ...(review ? { ai_review: review } : {}),
  }, { now: "2026-08-12T00:00:00.000Z" });
}

describe("agent evidence review drafts", () => {
  it("parses a strict recommendation without granting it review authority", () => {
    const parsed = A.parseReview('{"decision":"confirm","relation":"QUALIFIES","claim":"The quote narrows the hypothesis to visible illumination.","reason":"It directly states the stated illumination condition."}');
    const review = A.makeReview(parsed, { targetUid: UID, model: "deepseek:test", prompt: "review prompt", now: "2026-08-12T00:00:00.000Z" });
    const object = evidence(review);
    assert.eq(object.review_status, "pending");
    assert.eq(object.verified_by_user, false);
    assert.eq(object.ai_review.decision, "confirm");
    assert.eq(A.suggestedAction(object.ai_review), "confirm");
    assert.deepEq(S.validateObject(object), []);
    assert.deepEq(S.parseObject(S.serializeObject(object)).object.ai_review, object.ai_review, "the auditable AI draft must survive a Markdown round trip");
  });

  it("requires an auditable claim for both confirmation and a recommendation not to create", () => {
    let message = "";
    try { A.parseReview('{"decision":"confirm","relation":"","claim":"x","reason":"because"}'); } catch (error) { message = error.message; }
    assert.match(message, /relation/);
    message = "";
    try { A.parseReview('{"decision":"reject","relation":"","claim":"","reason":""}'); } catch (error) { message = error.message; }
    assert.match(message, /理由/);
    message = "";
    try { A.parseReview('{"decision":"reject","relation":"","claim":"","reason":"The material system is unrelated."}'); } catch (error) { message = error.message; }
    assert.match(message, /证据主张/);
    const rejected = A.parseReview('{"decision":"reject","relation":"","claim":"This result does not test the target wavelength, so it cannot establish the hypothesis.","reason":"The material system is unrelated."}');
    assert.match(rejected.claim, /does not test/);
    assert.eq(A.suggestedAction(rejected), "reject");
  });

  it("keeps an uncertain review relation-free but preserves its neutral result summary", () => {
    const uncertain = A.parseReview('{"decision":"uncertain","relation":"","claim":"The result block describes a comparison but reports no measured outcome for the hypothesis.","reason":"The quoted text is an experimental plan rather than a result."}');
    assert.eq(uncertain.relation, "");
    assert.match(uncertain.claim, /describes a comparison/);
    assert.eq(A.suggestedAction(uncertain), "");
    let message = "";
    try { A.parseReview('{"decision":"uncertain","relation":"","claim":"","reason":"More data are needed."}'); } catch (error) { message = error.message; }
    assert.match(message, /中性结果摘要/);
  });
});
