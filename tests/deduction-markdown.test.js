"use strict";

const { block, describe, it, assert } = require("./harness");

describe("deduction reply markdown", () => {
  it("renders both ordinary and formal agent replies through Obsidian MarkdownRenderer", () => {
    const reply = block("renderAgentReply(t, e) {");
    assert.match(reply, /this\.renderReplyMarkdown\(\w+, e\.summary \|\| ""\)/);
    assert.match(reply, /this\.renderReplyMarkdown\([\s\S]*?e\.summary \|\|/);
  });

  it("uses an Obsidian component and keeps a readable plain-text fallback", () => {
    const helper = block("renderReplyMarkdown(t, e) {");
    assert.match(helper, /cls: "deduction-markdown markdown-rendered"/);
    assert.match(helper, /Ge\d*\.MarkdownRenderer\.render\(/);
    assert.match(helper, /new Ge\d*\.Component\(\)/);
    assert.match(helper, /this\.replyMarkdownComponent\.load\(\)/);
    assert.match(helper, /Promise\.resolve\([\s\S]*?\.catch\(\(\) =>/);
    assert.match(helper, /\w+\.createEl\("pre", \{ text: \w+ \}\)/);
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
