'use strict';
/* Every Skill script that writes to stdout must force UTF-8 there.
 *
 * Why this is a guard and not a style note: Python on a Chinese Windows install
 * defaults stdout to GBK. A script can render its output, write every artefact
 * to disk, and then die on the final print because one character - a degree
 * sign in a column heading was the real case - is outside that code page. The
 * Bridge sees a non-zero exit and reports failure for work that actually
 * succeeded, which reached the panel as an unexplained "Failed to fetch" while
 * the chart sat correctly on disk. Nothing about the symptom points at
 * encoding, and it only appears on data that happens to contain such a
 * character, so it survives every test written on ASCII fixtures.
 *
 * 26 of the 31 scripts already did this before the guard existed: it records a
 * convention this codebase had already settled on, and stops the next script
 * from being the one that forgets.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SKILLS = path.join(__dirname, '..', 'skills');
const RECONFIGURES_STDOUT = /sys\.stdout\.reconfigure\s*\(\s*encoding\s*=\s*["']utf-8["']\s*\)/;
const WRITES_STDOUT = /^\s*(print\s*\(|sys\.stdout\.write\s*\()/m;

// Local development scripts that are never invoked through the Bridge, so their
// output never becomes a skill result. Listed explicitly rather than matched by
// pattern, so adding one is a deliberate act.
const NOT_BRIDGE_INVOKED = new Set([
  'zrl-knowledge-graph/scripts/test_render_graph_dry_run_and_versioned_output.py',
  'zrl-knowledge-graph/scripts/test_render_graph_supported_threshold.py',
]);

function pythonScripts(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) pythonScripts(full, out);
    else if (entry.name.endsWith('.py')) out.push(full);
  }
  return out;
}

test('every Bridge-invoked Skill script forces UTF-8 on stdout', () => {
  const offenders = [];
  let checked = 0;
  for (const file of pythonScripts(SKILLS)) {
    const relative = path.relative(SKILLS, file).replace(/\\/g, '/');
    if (NOT_BRIDGE_INVOKED.has(relative)) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (!WRITES_STDOUT.test(source)) continue;
    checked += 1;
    if (!RECONFIGURES_STDOUT.test(source)) offenders.push(relative);
  }

  assert.ok(checked > 20, `expected to inspect the whole skills tree, only saw ${checked} scripts`);
  assert.deepEqual(offenders, [], [
    'These Skill scripts print but do not force UTF-8 on stdout:',
    ...offenders.map((name) => `  - ${name}`),
    '',
    'On a Chinese Windows console stdout defaults to GBK, so any character',
    'outside that code page raises UnicodeEncodeError after the script has',
    'already written its results to disk. The Bridge then reports a failure',
    'for work that succeeded. Add this after the imports:',
    '',
    '    if hasattr(sys.stdout, "reconfigure"):',
    '        sys.stdout.reconfigure(encoding="utf-8")',
    '',
    'If the script is only ever run by hand and never through the Bridge, add',
    'it to NOT_BRIDGE_INVOKED in this file instead, so the exemption is explicit.',
  ].join('\n'));
});

test('the guard actually detects a script that is missing the call', () => {
  // A guard that has never gone red cannot be trusted to go red.
  const unguarded = 'import sys\nimport json\n\nprint(json.dumps({"a": 1}))\n';
  assert.ok(WRITES_STDOUT.test(unguarded));
  assert.equal(RECONFIGURES_STDOUT.test(unguarded), false);

  const guarded = 'import sys\n\nif hasattr(sys.stdout, "reconfigure"):\n    sys.stdout.reconfigure(encoding="utf-8")\n\nprint("ok")\n';
  assert.ok(RECONFIGURES_STDOUT.test(guarded));

  // A script that never prints is out of scope rather than an offender.
  assert.equal(WRITES_STDOUT.test('import sys\n\ndef helper():\n    return 1\n'), false);

  // The call must name utf-8: reconfiguring to something else is not a fix.
  assert.equal(RECONFIGURES_STDOUT.test('sys.stdout.reconfigure(encoding="gbk")'), false);
});
