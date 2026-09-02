const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PYTHON = process.env.PYTHON || 'python';

function run(script, workspace, input) {
  const result = spawnSync(PYTHON, [script, workspace, JSON.stringify(input)], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('data intake skills only inspect a CSV and emit a reviewable plan', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sch-data-intake-'));
  const raw = path.join(workspace, 'Materials', 'demo', '01_raw_data', 'raw.csv');
  fs.mkdirSync(path.dirname(raw), { recursive: true });
  const original = 'sample,rate,conversion\nA,0.10,50\nB,,55\nC,9.50,65\n';
  fs.writeFileSync(raw, original, 'utf8');
  const rel = path.relative(workspace, raw).replaceAll('\\', '/');

  const profile = run(path.join(ROOT, 'skills', 'sch-data-profile-audit', 'scripts', 'profile_audit.py'), workspace, { data_path: rel });
  const classifier = run(path.join(ROOT, 'skills', 'sch-data-classifier', 'scripts', 'data_classifier.py'), workspace, { manifest: profile, data_path: rel });
  const plan = run(path.join(ROOT, 'skills', 'sch-data-cleaning-plan', 'scripts', 'cleaning_plan.py'), workspace, profile);

  assert.equal(profile.input.rows, 3);
  assert.equal(profile.writes.length, 0);
  assert.equal(classifier.requires_confirmation, true);
  assert.equal(classifier.writes.length, 0);
  assert.equal(plan.plan.requires_confirmation, true);
  assert.equal(plan.writes.length, 0);
  assert.equal(fs.readFileSync(raw, 'utf8'), original);
});

test('Bridge registers only the read-only data intake skills', () => {
  const server = fs.readFileSync(path.join(ROOT, 'bridge', 'server.js'), 'utf8');
  for (const skill of ['sch-data-profile-audit', 'sch-data-classifier', 'sch-data-cleaning-plan']) {
    assert.match(server, new RegExp(`'${skill}'\\s*:`));
  }
  assert.doesNotMatch(server, /'sch-data-transform-runner'\\s*:/);
  assert.doesNotMatch(server, /'sch-ai-script-runner'\\s*:/);
});
