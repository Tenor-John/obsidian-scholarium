"use strict";

const { sandbox, describe, it, assert } = require("./harness");

const { schExtractJsonReplyObject } = sandbox({
  fns: ["schExtractJsonReplyObject"],
});

describe("Research Weaver JSON reply parsing", () => {
  it("accepts a fenced reply after explanatory prose", () => {
    const parsed = schExtractJsonReplyObject(
      "I checked the constraints.\n```json\n{\"status\":\"questions\",\"summary\":\"Need controls\"}\n```",
      "status",
    );
    assert.eq(parsed.status, "questions");
    assert.eq(parsed.summary, "Need controls");
  });

  it("keeps braces and escaped backslashes inside JSON strings intact", () => {
    const expected = { status: "revise", summary: "Use C:\\data\\{raw} and quote: \\\"x\\\"" };
    const parsed = schExtractJsonReplyObject(`preface ${JSON.stringify(expected)} trailing text`, "status");
    assert.deepEq(parsed, expected);
  });

  it("skips unrelated or malformed brace-delimited text", () => {
    const parsed = schExtractJsonReplyObject(
      "Note {not valid JSON}; metadata {\"kind\":\"trace\"}; final {\"status\":\"ready\",\"audit\":{\"passed\":true}}",
      "status",
    );
    assert.eq(parsed.status, "ready");
    assert.eq(parsed.audit.passed, true);
  });

  it("requires the caller's expected reply field", () => {
    assert.eq(schExtractJsonReplyObject('{\"evidence_requests\":[]}', "status"), null);
    assert.deepEq(schExtractJsonReplyObject('{\"evidence_requests\":[]}', "evidence_requests"), { evidence_requests: [] });
  });
});
