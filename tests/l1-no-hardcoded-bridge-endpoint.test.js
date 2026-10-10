"use strict";

/**
 * L1 build guard: the release candidate must not ship a hardcoded loopback
 * Bridge endpoint, and must not walk a 4173..4178 candidate list.
 *
 * STATUS OF THE CURRENT CANDIDATE — EXPECTED RED, DO NOT SILENCE.
 * ---------------------------------------------------------------------
 * The frozen deployment candidate `main.js`
 * (SHA-256 160e10f085a93e16b9966820cfb1872f9fb7dafb8ad437f3794fabd8abe329c0)
 * FAILS the first assertion below at line 34264:
 *
 *     var Md = "http://127.0.0.1:4173/bridge",
 *
 * That constant is assigned once and never re-assigned, and all 24
 * `bridgeFetch` call sites resolve their base from it, while the runtime the
 * plugin launches binds an OS-assigned port and reports it over IPC. The
 * failure recorded here is the release blocker itself, not a broken test.
 *
 * The fix belongs in whatever repository owns the bundle's source; the
 * deployment checkout has none (no `src/`, no `package.json`, no esbuild
 * config — see `docs/audits/deployed-4173-reachability-2026-09-24.md`), so this
 * guard is deliberately written to be pointed at any candidate:
 *
 *     SCHOLARIUM_CANDIDATE=/path/to/main.js node --test tests/l1-no-hardcoded-bridge-endpoint.test.js
 *
 * It must not be made green by deleting the check, by widening the 4173
 * allowance, or by editing `main.js` in place.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const guard = require("../tools/bridge-endpoint-guard.js");

const ROOT = path.join(__dirname, "..");
const CANDIDATE = process.env.SCHOLARIUM_CANDIDATE
  ? path.resolve(process.env.SCHOLARIUM_CANDIDATE)
  : path.join(ROOT, "main.js");

/** The dynamic mechanism, written the way a fixed bundle would contain it. */
const FIXED_FIXTURE = [
  'child.on("message", (message) => {',
  '  if (message?.type === "listening") {',
  "    ports.canvasPort = Number(message.canvasPort);",
  "    ports.bridgePort = Number(message.bridgePort);",
  "  }",
  "});",
  "const base = `http://127.0.0.1:${ports.canvasPort}/bridge`;",
].join("\n");

test("[L1] the candidate ships no hardcoded 4173 Bridge base and no 4173..4178 scan", () => {
  assert.equal(fs.existsSync(CANDIDATE), true, `candidate bundle not found: ${CANDIDATE}`);
  const source = fs.readFileSync(CANDIDATE, "utf8");
  const result = guard.auditBundle(source);
  assert.equal(
    result.ok,
    true,
    "release candidate fails the Bridge endpoint guard:\n" + guard.formatReport(result),
  );
});

test("[L1] guard locates the hardcoded Bridge base in the frozen candidate", () => {
  // The red proof, kept as its own assertion so the failure names the defect
  // and its line instead of only reporting `ok === false`. This test is
  // expected to disappear (or invert) once the fixed bundle is published.
  const frozen = path.join(ROOT, "main.js");
  if (!fs.existsSync(frozen)) return;
  const result = guard.auditBundle(fs.readFileSync(frozen, "utf8"));
  const hit = result.violations.find(
    (violation) => violation.id === guard.FATAL_HARDCODED_4173_BRIDGE,
  );
  assert.ok(hit, "the frozen candidate is expected to still contain the hardcoded 4173 Bridge base");
  assert.equal(hit.hits[0].line, 34264);
  assert.match(hit.hits[0].text, /var Md = "http:\/\/127\.0\.0\.1:4173\/bridge"/);
});

test("[L1] guard rejects a synthesized 4173..4178 candidate scan", () => {
  const source = [
    FIXED_FIXTURE,
    'const BRIDGE_CANDIDATES = ["http://127.0.0.1:4173", "http://127.0.0.1:4174",',
    '  "http://127.0.0.1:4175", "http://127.0.0.1:4176", "http://127.0.0.1:4177",',
    '  "http://127.0.0.1:4178"];',
  ].join("\n");
  const result = guard.auditBundle(source);
  assert.equal(result.ok, false);
  const ids = result.violations.map((violation) => violation.id);
  assert.ok(ids.includes(guard.FATAL_LOOPBACK_PORT_SCAN));
  assert.deepEqual(result.scannedPorts, [4173, 4174, 4175, 4176, 4177, 4178]);
});

test("[L1] guard rejects a `localhost` Bridge base", () => {
  const result = guard.auditBundle(`${FIXED_FIXTURE}\nconst alt = "http://localhost:4173/bridge";`);
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.id === guard.FATAL_LOCALHOST_BRIDGE));
});

test("[L1] guard refuses a bundle that simply deleted every loopback literal", () => {
  // Deleting the hardcoded URL without wiring the reported port is strictly
  // worse than the defect: nothing would be able to reach the Bridge. The
  // positive control must reject that shape.
  const result = guard.auditBundle("var Md = null;\nasync function bridgeFetch(t){ return fetch(t); }");
  assert.equal(result.ok, false);
  const violation = result.violations.find(
    (entry) => entry.id === guard.FATAL_MISSING_DYNAMIC_WIRING,
  );
  assert.ok(violation, "a bundle with no reported-port wiring must be refused");
  assert.match(violation.detail, /listening/);
});

test("[L1] guard accepts a bundle that resolves the endpoint from the reported canvas port", () => {
  const result = guard.auditBundle(FIXED_FIXTURE);
  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
});

test("[L1] guard only advises on the bare migration origin, never fails on it", () => {
  // `http://127.0.0.1:4173` with no `/bridge` is the legacy browser-state
  // migration source. It is a hardcoded origin worth reporting, but it is not
  // a Bridge endpoint and its absence is a no-op, so it must not fail a release.
  const result = guard.auditBundle(
    `${FIXED_FIXTURE}\nconst sourceOrigin = "http://127.0.0.1:4173";`,
  );
  assert.equal(result.ok, true, "the migration origin must not fail the guard");
  assert.ok(result.advisories.some((entry) => entry.id === guard.ADVISORY_BARE_4173_ORIGIN));
});
