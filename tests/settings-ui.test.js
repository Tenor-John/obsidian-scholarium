"use strict";

const { source, describe, it, assert } = require("./harness");

describe("settings UI", () => {
  it("places the editable system prompt directly below its heading", () => {
    const src = source();
    const heading = src.indexOf("System Prompt");
    const textarea = src.indexOf("scholarium-prompt-textarea");
    const imageSection = src.indexOf('setName("\\u56FE\\u7247\\u8BC6\\u522B');
    assert.ok(heading >= 0, "missing system-prompt heading");
    assert.ok(textarea > heading, "missing prompt textarea after its heading");
    assert.ok(imageSection > textarea, "prompt textarea must precede the next settings section");
  });

  it("persists prompt edits and provides an accessible reset control", () => {
    const src = source();
    assert.match(src, /this\.plugin\.settings\.aiSystemPrompt = g\.value/);
    assert.match(src, /await this\.plugin\.saveSettings\(\)/);
    assert.match(src, /aria-label", "AI 提示词/);
    assert.match(src, /\\u6062\\u590D\\u9ED8\\u8BA4\\u63D0\\u793A\\u8BCD/);
  });
});
