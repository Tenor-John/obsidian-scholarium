"use strict";
/**
 * Zero-dependency test harness for the built main.js bundle.
 *
 * There is no TypeScript source or build chain in this repo yet, so these tests
 * work by locating a function/method inside the bundle by its signature,
 * brace-matching its body, and evaluating it in isolation. That means the tests
 * exercise the CODE THAT ACTUALLY SHIPS, not a reimplementation.
 *
 * When the bundle is eventually rebuilt from TypeScript, replace the extraction
 * layer with real imports; the assertions below should keep working unchanged.
 */
const fs = require("fs");
const path = require("path");

const MAIN = path.join(__dirname, "..", "main.js");
let _src = null;
function source() {
  if (_src === null) _src = fs.readFileSync(MAIN, "utf8");
  return _src;
}

/** Return the `{ ... }` block that follows `signature`, brace-matched. */
function block(signature) {
  const src = source();
  const i = src.indexOf(signature);
  if (i < 0) throw new Error("signature not found in main.js: " + signature);
  let depth = 0;
  let j = src.indexOf("{", i);
  if (j < 0) throw new Error("no block after: " + signature);
  const start = j;
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, j + 1);
    }
  }
  throw new Error("unbalanced braces after: " + signature);
}

/** Body of the block, without the outer braces. */
function body(signature) {
  const b = block(signature);
  return b.slice(1, -1);
}

/** Identifiers like `$s` / `$r` contain regex metacharacters. */
function esc(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The whole `function name(...) {...}` declaration text. */
function decl(name) {
  const src = source();
  const m = new RegExp("function\\s+" + esc(name) + "\\s*\\(").exec(src);
  if (!m) throw new Error("function not found: " + name);
  let depth = 0;
  let j = src.indexOf("{", m.index);
  if (j < 0) throw new Error("no body for function " + name);
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) return src.slice(m.index, j + 1);
    }
  }
  throw new Error("unbalanced braces in function " + name);
}

/**
 * Build a sandbox containing the named top-level `function` declarations plus
 * any number of standalone methods, and return them as callables.
 *
 *   sandbox({ fns: ["je", "be"], methods: { slugTag: ["t"] } })
 */
function sandbox(spec) {
  const fns = spec.fns || [];
  const methods = spec.methods || {};
  const vars = spec.vars || [];
  let code = "";
  for (const n of fns) code += decl(n) + "\n";
  for (const v of vars) {
    const m = new RegExp("var\\s+" + esc(v) + "\\s*=\\s*[^;]+;").exec(source());
    if (!m) throw new Error("var not found: " + v);
    code += m[0] + "\n";
  }
  const names = [...fns];
  for (const [name, params] of Object.entries(methods)) {
    const sig = name + "(" + params.join(", ") + ") {";
    code +=
      "const " + name + " = function(" + params.join(",") + ") {" + body(sig) + "};\n";
    names.push(name);
  }
  code += "return {" + names.join(",") + "};";
  // The bundle runs in an Electron renderer where `require` is global. A plain
  // `new Function` body sees only globals, so inject it to keep the sandbox
  // faithful; otherwise crypto-backed code silently takes its fallback path.
  const obj = new Function("require", code)(require);
  // methods use `this` for sibling helpers -> bind them to the sandbox itself
  for (const name of Object.keys(methods)) obj[name] = obj[name].bind(obj);
  return obj;
}

/* ------------------------------------------------------------------ */
/* tiny test runner                                                     */
/* ------------------------------------------------------------------ */
const suites = [];
let current = null;
let passed = 0;
const failures = [];

function describe(name, fn) {
  current = { name, tests: [] };
  suites.push(current);
  fn();
  current = null;
}
function it(name, fn) {
  if (!current) throw new Error("it() outside describe()");
  current.tests.push({ name, fn });
}

function fmt(v) {
  if (typeof v === "string") return JSON.stringify(v);
  try {
    return JSON.stringify(v);
  } catch (e) {
    return String(v);
  }
}
const assert = {
  eq(actual, expected, msg) {
    if (actual !== expected)
      throw new Error(
        (msg ? msg + ": " : "") + "expected " + fmt(expected) + " got " + fmt(actual),
      );
  },
  deepEq(actual, expected, msg) {
    const a = JSON.stringify(actual),
      b = JSON.stringify(expected);
    if (a !== b)
      throw new Error((msg ? msg + ": " : "") + "expected " + b + " got " + a);
  },
  ok(v, msg) {
    if (!v) throw new Error(msg || "expected truthy, got " + fmt(v));
  },
  notOk(v, msg) {
    if (v) throw new Error(msg || "expected falsy, got " + fmt(v));
  },
  match(str, re, msg) {
    if (!re.test(str))
      throw new Error(
        (msg ? msg + ": " : "") + "expected to match " + re + " in " + fmt(String(str).slice(0, 200)),
      );
  },
  noMatch(str, re, msg) {
    if (re.test(str))
      throw new Error(
        (msg ? msg + ": " : "") + "expected NOT to match " + re + " in " + fmt(String(str).slice(0, 200)),
      );
  },
  // Node's assertion spelling is convenient for tests shared with source-side
  // suites.  Keep the original short names above, but make this tiny harness a
  // faithful enough subset that a deployment test cannot go green in one suite
  // merely because its assertion API is different in the other.
  equal(actual, expected, msg) {
    return this.eq(actual, expected, msg);
  },
  deepEqual(actual, expected, msg) {
    return this.deepEq(actual, expected, msg);
  },
  throws(fn, expected, msg) {
    let thrown = null;
    try {
      fn();
    } catch (error) {
      thrown = error;
    }
    if (!thrown) throw new Error(msg || "expected function to throw");
    if (expected instanceof RegExp && !expected.test(String(thrown.message || thrown))) {
      throw new Error((msg ? msg + ": " : "") + "expected error to match " + expected + ", got " + String(thrown.message || thrown));
    }
    return thrown;
  },
};

// async so a test function that returns a Promise (an `async () => {...}`
// body, needed once rss.* actions showed up with awaited handlers) is
// actually awaited before it counts as passed. Awaiting a plain synchronous
// return value is a no-op, so every existing sync test keeps working
// unchanged; run.js must `await run()` for this to have any effect.
async function run() {
  for (const s of suites) {
    console.log("\n" + s.name);
    for (const t of s.tests) {
      try {
        await t.fn();
        passed++;
        console.log("  ✓ " + t.name);
      } catch (e) {
        failures.push({ suite: s.name, test: t.name, err: e });
        console.log("  ✗ " + t.name);
        console.log("      " + e.message);
      }
    }
  }
  console.log(
    "\n" + "-".repeat(60) + "\n" + passed + " passed, " + failures.length + " failed",
  );
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log("  " + f.suite + " > " + f.test);
    process.exitCode = 1;
  }
  return failures.length === 0;
}

module.exports = { source, block, body, decl, sandbox, describe, it, assert, run, MAIN };
