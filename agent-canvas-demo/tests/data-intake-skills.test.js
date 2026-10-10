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

test('data normalization writes only an immutable derived CSV and leaves the source byte-identical', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sch-data-normalize-'));
  try {
    const raw = path.join(workspace, 'Materials', 'instrument.txt');
    fs.mkdirSync(path.dirname(raw), { recursive: true });
    const original = Buffer.from('metadata\ntime;signal\n0;1.5\n1;2.5\n', 'utf8');
    fs.writeFileSync(raw, original);
    const result = run(
      path.join(ROOT, 'skills', 'sch-data-normalize', 'scripts', 'normalize_data.py'),
      workspace,
      { data_path: 'Materials/instrument.txt', header_row: 2 },
    );
    assert.equal(result.skill, 'sch-data-normalize');
    assert.equal(result.selection.delimiter, ';');
    assert.match(result.ready_for.data_path, /^Materials\/_normalized\/.+\/normalized\.csv$/);
    assert.ok(result.writes.every((item) => item.startsWith('Materials/_normalized/')));
    assert.deepEqual(fs.readFileSync(raw), original);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('a new chart revision records its selected parent manifest without overwriting it', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sch-data-plot-revision-'));
  try {
    const raw = path.join(workspace, 'Materials', 'plot.csv');
    fs.mkdirSync(path.dirname(raw), { recursive: true });
    fs.writeFileSync(raw, 'Time (min),Signal A,RatioPct\n0,1,20\n5,1.4,28\n10,1.2,24\n', 'utf8');
    const script = path.join(ROOT, 'skills', 'sch-data-plot', 'scripts', 'generate_plot.py');
    const base = run(script, workspace, {
      data_path: 'Materials/plot.csv', x_column: 'Time (min)', y_columns: ['Signal A'],
      plot_kind: 'line', title: 'Base chart', save_mode: 'new', chart_style: { theme: 'publication' },
    });
    const parent = base.outputs.find((item) => item.endsWith('plot-manifest.json'));
    const revision = run(script, workspace, {
      data_path: 'Materials/plot.csv', x_column: 'Time (min)', y_columns: ['Signal A'],
      plot_kind: 'line', title: 'Base chart', save_mode: 'new', target_manifest_path: parent,
      chart_style: { theme: 'dark', line_width: 3 },
    });
    const child = revision.outputs.find((item) => item.endsWith('plot-manifest.json'));
    assert.notEqual(child, parent, 'a new revision must not replace its parent directory');
    assert.equal(revision.revision.mode, 'new');
    assert.equal(revision.revision.target_manifest_path, parent);
    assert.equal(fs.existsSync(path.join(workspace, ...parent.split('/'))), true);
    assert.equal(fs.existsSync(path.join(workspace, ...child.split('/'))), true);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('an overwrite snapshots the prior manifest before replacing chart artifacts', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sch-data-plot-overwrite-'));
  try {
    const raw = path.join(workspace, 'Materials', 'plot.csv');
    fs.mkdirSync(path.dirname(raw), { recursive: true });
    fs.writeFileSync(raw, 'Time (min),Signal A\n0,1\n5,1.4\n10,1.2\n', 'utf8');
    const script = path.join(ROOT, 'skills', 'sch-data-plot', 'scripts', 'generate_plot.py');
    const base = run(script, workspace, {
      data_path: 'Materials/plot.csv', x_column: 'Time (min)', y_columns: ['Signal A'],
      plot_kind: 'line', title: 'Original', save_mode: 'new', chart_style: { theme: 'publication' },
    });
    const target = base.outputs.find((item) => item.endsWith('plot-manifest.json'));
    const original = fs.readFileSync(path.join(workspace, ...target.split('/')), 'utf8');
    const overwritten = run(script, workspace, {
      data_path: 'Materials/plot.csv', x_column: 'Time (min)', y_columns: ['Signal A'],
      plot_kind: 'line', title: 'Updated', save_mode: 'overwrite', target_manifest_path: target,
      chart_style: { theme: 'dark', line_width: 3 },
    });
    const snapshot = overwritten.revision.pre_overwrite_manifest_snapshot;
    assert.match(snapshot, /^Materials\/_analysis\/.+\/plot-manifest\.pre-overwrite-.+\.json$/);
    assert.equal(fs.readFileSync(path.join(workspace, ...snapshot.split('/')), 'utf8'), original);
    assert.ok(overwritten.writes.includes(snapshot));
    assert.equal(overwritten.revision.mode, 'overwrite');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('Bridge registers read-only data intake plus the bounded structural normalizer', () => {
  const server = fs.readFileSync(path.join(ROOT, 'bridge', 'server.js'), 'utf8');
  for (const skill of ['sch-data-normalize', 'sch-data-profile-audit', 'sch-data-classifier', 'sch-data-cleaning-plan']) {
    assert.match(server, new RegExp(`'${skill}'\\s*:`));
  }
  assert.doesNotMatch(server, /'sch-data-transform-runner'\\s*:/);
  assert.doesNotMatch(server, /'sch-ai-script-runner'\\s*:/);
});
