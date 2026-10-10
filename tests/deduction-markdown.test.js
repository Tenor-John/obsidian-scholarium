"use strict";

const { source, describe, it, assert } = require("./harness");

describe("deduction reply markdown", () => {
  it("renders both ordinary and formal agent replies through Obsidian MarkdownRenderer", () => {
    const src = source();
    const reply = src.slice(
      src.indexOf("renderAgentReply(t, e) {"),
      src.indexOf("  renderEvidenceLogEntry(t, e) {"),
    );
    assert.match(reply, /this\.renderReplyMarkdown\(s, e\.summary \|\| ""\)/);
    assert.match(reply, /this\.renderReplyMarkdown\([\s\S]*?e\.summary \|\|/);
    assert.match(reply, /cls: "deduction-markdown markdown-rendered"/);
    assert.match(reply, /Ge\.MarkdownRenderer\.render\(/);
  });

  it("uses an Obsidian component and keeps a readable plain-text fallback", () => {
    const src = source();
    const helper = src.slice(
      src.indexOf("renderReplyMarkdown(t, e) {"),
      src.indexOf("  renderEvidenceLogEntry(t, e) {"),
    );
    assert.match(helper, /new Ge\.Component\(\)/);
    assert.match(helper, /this\.replyMarkdownComponent\.load\(\)/);
    assert.match(helper, /Promise\.resolve\([\s\S]*?\.catch\(\(\) =>/);
    assert.match(helper, /i\.createEl\("pre", \{ text: s \}\)/);
  });

  it("does not let legacy white-space rules suppress Markdown layout", () => {
    const css = require("fs").readFileSync(
      require("path").join(__dirname, "..", "styles.css"),
      "utf8",
    );
    assert.match(css, /\.deduction-message \.deduction-markdown p \{ white-space: normal;/);
    assert.match(css, /\.deduction-message \.deduction-markdown :is\(ul, ol\)/);
    assert.match(css, /\.deduction-message \.deduction-markdown blockquote/);
    assert.match(css, /\.deduction-message \.deduction-markdown table/);
  });
});
