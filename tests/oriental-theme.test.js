"use strict";

const fs = require("fs");
const path = require("path");
const { source, describe, it, assert } = require("./harness");

describe("学院墨韵 visual style", () => {
  it("keeps both visual styles visible, opt-in, and persists the selected setting", () => {
    const src = source();
    assert.match(src, /visualStyle:\s*"default"/);
    assert.match(src, /key:\s*"oriental"/);
    assert.match(src, /label:\s*"学院墨韵"/);
    assert.match(src, /sch-visual-style-picker/);
    assert.match(src, /s\.visualStyle = T === "oriental" \? "oriental" : "default"/);
    assert.match(src, /document\.querySelectorAll\("\.scholarium-root"\)/);
  });

  it("marks every themed Scholarium root with the selected visual style", () => {
    const src = source();
    assert.match(src, /e\.dataset\.visualStyle =/);
    assert.match(src, /this\.settings\.visualStyle === "oriental" \? "oriental" : "default"/);
  });

  it("scopes the palette to Scholarium and does not fetch remote fonts", () => {
    const css = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
    assert.match(css, /\.scholarium-root\[data-visual-style="oriental"\]/);
    assert.match(css, /\.theme-dark \.scholarium-root\[data-visual-style="oriental"\]/);
    assert.match(css, /--orient-primary:\s*#1B3A5C/);
    assert.match(css, /sch-visual-style-choice/);
    assert.noMatch(css, /@import\s+url\(/i);
    assert.noMatch(css, /fonts\.googleapis\.com/i);
  });
});
