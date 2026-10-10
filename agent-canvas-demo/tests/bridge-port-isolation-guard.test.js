"use strict";

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const TESTS_DIR = __dirname;
const LOCAL_LAUNCHER = 'local-launcher.test.js';
const LOCAL_LAUNCHER_EXEMPTION = 'PORT-HARNESS-EXEMPT: freePort remains only until the documented runtime';

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
      ['freePort TOCTOU helper', /function\s+freePort\s*\(/],
    ].filter(([, pattern]) => pattern.test(executable)).map(([label]) => label);

    if (findings.length === 0) continue;
    const allowedLocalLauncherExemption = filename === LOCAL_LAUNCHER
      && findings.length === 1
      && findings[0] === 'freePort TOCTOU helper'
      && source.includes(LOCAL_LAUNCHER_EXEMPTION)
      && source.includes('runtime-port-consistency-2026-09-17.md')
      && source.includes('25d4696');
    if (!allowedLocalLauncherExemption) violations.push(`${filename}: ${findings.join(', ')}`);
  }

  assert.deepEqual(
    violations,
    [],
    'Bridge endpoint tests must use tests/helpers/bridge-harness.js. Fixed or derived ports can land in Windows excluded-port ranges (EACCES, not EADDRINUSE, so free-port checks cannot detect it); derived ranges can also hit a developer\'s live Bridge/canvas and silently test the real vault; and freePort() closes an OS-assigned socket before the child can bind it. local-launcher.test.js is the sole documented exemption until runtime-port-consistency-2026-09-17.md (25d4696) is implemented.',
  );
});
