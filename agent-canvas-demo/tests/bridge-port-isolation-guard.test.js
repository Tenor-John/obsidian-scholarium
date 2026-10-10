"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TESTS_DIR = __dirname;

// Assembled from parts on purpose: this guard scans every *.test.js file in
// this directory, including itself, so writing the marker literally here would
// be the one occurrence it is looking for.
const EXEMPTION_MARKER = ['PORT', 'HARNESS', 'EXEMPT'].join('-');

// Same reason, and a stricter one: the sweep below matches any occurrence of
// this token, so a literal here would make the guard report itself. The older
// `function\s+freePort\s*\(` pattern escaped this by accident — the backslash
// in the source stopped it matching its own text — which is not a property
// worth relying on.
const FREE_PORT_HELPER = ['free', 'Port'].join('');
const FREE_PORT_PATTERN = new RegExp(`\\b${FREE_PORT_HELPER}\\b`);

function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

test('Bridge endpoint tests use the OS-assigned port harness', () => {
  const violations = [];
  for (const filename of fs.readdirSync(TESTS_DIR).filter((name) => name.endsWith('.test.js'))) {
    const source = fs.readFileSync(path.join(TESTS_DIR, filename), 'utf8');
    const executable = withoutComments(source);
    const findings = [
      ['pid-derived port', /process\.pid\s*%/],
      ['fixed four-digit PORT', /const\s+PORT\s*=\s*\d{4}\b/],
      // Any reference at all, not just the declaration: a helper imported or
      // copied in under a different shape is the same TOCTOU window.
      [`${FREE_PORT_HELPER} TOCTOU helper`, FREE_PORT_PATTERN],
    ].filter(([, pattern]) => pattern.test(executable)).map(([label]) => label);

    if (findings.length === 0) continue;
    violations.push(`${filename}: ${findings.join(', ')}`);
  }

  assert.deepEqual(
    violations,
    [],
    'Bridge endpoint tests must use tests/helpers/bridge-harness.js. Fixed or derived ports can land in Windows excluded-port ranges (EACCES, not EADDRINUSE, so free-port checks cannot detect it); derived ranges can also hit a developer\'s live Bridge/canvas and silently test the real vault; and a free-port probe closes an OS-assigned socket before the child can bind it. The launcher now reports the ports it actually bound over IPC (docs/runtime-port-consistency-2026-09-17.md), so every test can use port 0 and there are no exemptions left.',
  );
});

/* The exemption mechanism this guard used to carry is gone, and it must not
   come back. A marker-based escape hatch is only as strong as the guard that
   honours it, and the obvious way to unblock a future violation is to write
   the marker into the offending file — so the marker itself is now forbidden.
   Asserted separately from the sweep above so that reintroducing it fails with
   the actual reason rather than as an unexplained violation. */
test('no test file may reinstate the free-port exemption marker', () => {
  const offenders = fs.readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith('.test.js'))
    .filter((name) => fs.readFileSync(path.join(TESTS_DIR, name), 'utf8').includes(EXEMPTION_MARKER));

  assert.deepEqual(
    offenders,
    [],
    `${EXEMPTION_MARKER} is a retired escape hatch: the launcher now reports the ports it actually bound, so port 0 is always available and nothing needs exempting. Delete the marker and use tests/helpers/bridge-harness.js.`,
  );
});
