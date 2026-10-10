"use strict";
/**
 * Guards against the failure modes that a 36k-line hand-patched bundle is
 * prone to. These caught a real bug: a helper named `xr` silently overrode an
 * existing sRGB function of the same name, breaking theme contrast. `node
 * --check` cannot see that class of error.
 */
const { source, describe, it, assert } = require("./harness");
const { execFileSync } = require("child_process");
const path = require("path");

describe("bundle integrity", () => {
  it("parses as valid JavaScript", () => {
    execFileSync(process.execPath, ["--check", path.join(__dirname, "..", "main.js")]);
  });

  it("has no duplicate top-level function declarations", () => {
    const seen = new Map();
    for (const m of source().matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm))
      seen.set(m[1], (seen.get(m[1]) || 0) + 1);
    const dup = [...seen].filter(([, n]) => n > 1).map(([n]) => n);
    assert.deepEq(dup, [], "duplicate declarations silently shadow each other");
  });

  it("has no duplicate top-level var declarations", () => {
    const seen = new Map();
    for (const m of source().matchAll(/^var\s+([A-Za-z_$][\w$]*)\s*=/gm))
      seen.set(m[1], (seen.get(m[1]) || 0) + 1);
    const dup = [...seen].filter(([, n]) => n > 1).map(([n]) => n);
    assert.deepEq(dup, [], "duplicate var declarations");
  });

  it("keeps every class method name unique within each class body", () => {
    const KEYWORDS = new Set([
      "if", "for", "while", "switch", "catch", "return", "function",
      "typeof", "do", "else", "try", "new", "delete", "in", "of", "await",
    ]);
    const src = source();
    const dups = [];
    // brace-match each `class {` body rather than guessing where it ends
    for (const m of src.matchAll(/\bclass\s*(?:[A-Za-z_$][\w$]*\s*)?\{/g)) {
      let depth = 0,
        j = src.indexOf("{", m.index),
        end = -1;
      for (let k = j; k < src.length; k++) {
        if (src[k] === "{") depth++;
        else if (src[k] === "}") {
          depth--;
          if (depth === 0) {
            end = k;
            break;
          }
        }
      }
      if (end < 0) continue;
      const bodyText = src.slice(j + 1, end);
      // only members at the class's own indentation level
      const names = new Map();
      for (const d of bodyText.matchAll(/^\s{4}(?:async\s+)?([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) {
        const n = d[1];
        if (KEYWORDS.has(n) || n === "constructor") continue;
        names.set(n, (names.get(n) || 0) + 1);
      }
      for (const [n, c] of names) if (c > 1) dups.push(n);
    }
    assert.deepEq([...new Set(dups)], [], "a duplicated method silently wins last");
  });

  it("declares the identifiers the newer features rely on", () => {
    for (const name of [
      "scholariumDeepSummarize",
      "schProfileList",
      "ScholariumDeepPrompt",
    ])
      assert.match(source(), new RegExp("(function|var)\\s+" + name + "\\b"), name);
  });
});
