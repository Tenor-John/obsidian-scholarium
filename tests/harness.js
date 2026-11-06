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

/** Return the `{ ... }` block that follows `signature`, brace-matched.
 *
 * Esbuild may rename formal parameters to avoid cross-module collisions (for
 * example `t` -> `t11`) even with minification disabled.  The historical tests
 * specify the old public/extraction signature, so normalize only those formal
 * parameters back to the requested names.  This is a semantics-preserving test
 * adapter: the shipped method body is still the body being evaluated. */
function block(signature) {
  const src = source();
  let i = src.indexOf(signature);
  let parameterRenames = [];
  if (i < 0) {
    const match = /^([A-Za-z_$][\w$]*)\(([^)]*)\) \{$/.exec(signature);
    if (!match) throw new Error("signature not found in main.js: " + signature);
    const method = new RegExp("(?:^|\\n)\\s*(?:async\\s+)?" + esc(match[1]) + "\\(([^)]*)\\) \\{");
    const located = method.exec(src);
    if (!located) throw new Error("signature not found in main.js: " + signature);
    i = located.index + located[0].lastIndexOf(located[0].trimStart());
    const expected = match[2].split(",").map((name) => name.trim()).filter(Boolean);
    const actual = located[1].split(",").map((name) => name.trim()).filter(Boolean);
    if (expected.length !== actual.length) {
      throw new Error("parameter count changed in main.js: " + signature + " -> " + located[1]);
    }
    const parameterName = (parameter) => /^\s*([A-Za-z_$][\w$]*)/.exec(parameter)?.[1];
    parameterRenames = actual.map((name, index) => [parameterName(name), parameterName(expected[index])]);
    if (parameterRenames.some(([from, to]) => !from || !to)) {
      throw new Error("unsupported parameter list in main.js: " + signature + " -> " + located[1]);
    }
  }
  let depth = 0;
  // Default parameters such as `options = {}` contain braces of their own.
  // Start at the method body's `) {`, not at the first brace after the name.
  const bodyMarker = src.indexOf(") {", i);
  let j = bodyMarker < 0 ? -1 : bodyMarker + 2;
  if (j < 0) throw new Error("no block after: " + signature);
  const start = j;
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) {
        let extracted = src.slice(start, j + 1);
        for (const [actual, expected] of parameterRenames) {
          if (actual !== expected) extracted = extracted.replace(new RegExp("(?<![\\w$])" + esc(actual) + "(?![\\w$])", "g"), expected);
        }
        return extracted;
      }
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

/** Locate a top-level function, allowing esbuild's numeric collision suffix.
 * Recovered release modules occur after their third-party dependencies, so the
 * last same-root declaration is the reviewed implementation rather than an
 * unrelated dependency helper such as `be` / `be3`. */
function declaration(name) {
  const src = source();
  const pattern = new RegExp("function\\s+" + esc(name) + "\\d*\\s*\\(", "g");
  let m;
  let found = null;
  while ((m = pattern.exec(src))) found = m;
  if (!found) throw new Error("function not found: " + name);
  const actual = /^function\s+([A-Za-z_$][\w$]*)/.exec(found[0])[1];
  let depth = 0;
  let j = src.indexOf("{", found.index);
  if (j < 0) throw new Error("no body for function " + name);
  for (; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) return { code: src.slice(found.index, j + 1), actual };
    }
  }
  throw new Error("unbalanced braces in function " + name);
}

/** The whole `function name(...) {...}` declaration text. */
function decl(name) {
  const found = declaration(name);
  return found.code.replace(new RegExp("(?<![\\w$])" + esc(found.actual) + "(?![\\w$])", "g"), name);
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
  const renames = [];
  let code = "";
  for (const n of fns) {
    const found = declaration(n);
    code += found.code + "\n";
    renames.push([found.actual, n]);
  }
  for (const v of vars) {
    const pattern = new RegExp("var\\s+" + esc(v) + "\\d*\\s*=\\s*[^;]+;", "g");
    let m;
    let found = null;
    while ((m = pattern.exec(source()))) found = m;
    if (!found) throw new Error("var not found: " + v);
    const actual = /^var\s+([A-Za-z_$][\w$]*)/.exec(found[0])[1];
    code += found[0] + "\n";
    renames.push([actual, v]);
  }
  const names = [...fns];
  for (const [name, params] of Object.entries(methods)) {
    const sig = name + "(" + params.join(", ") + ") {";
    code +=
      "const " + name + " = function(" + params.join(",") + ") {" + body(sig) + "};\n";
    names.push(name);
  }
  for (const [actual, expected] of renames) {
    if (actual !== expected) code = code.replace(new RegExp("(?<![\\w$])" + esc(actual) + "(?![\\w$])", "g"), expected);
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
  if (typeof v === "string") {
    const preview = v.length > 500 ? v.slice(0, 500) + `… <${v.length} chars>` : v;
    return JSON.stringify(preview);
  }
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
  const filter = process.env.SCH_TEST_FILTER ? new RegExp(process.env.SCH_TEST_FILTER, "i") : null;
  if (filter) console.log("Test filter: " + filter);
  for (const s of suites) {
    const tests = filter ? s.tests.filter((t) => filter.test(`${s.name} > ${t.name}`)) : s.tests;
    if (!tests.length) continue;
    console.log("\n" + s.name);
    for (const t of tests) {
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
