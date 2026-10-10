'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startBridge } = require('./helpers/bridge-harness');
const { sandbox } = require('../../tests/harness');

const pluginRoute = sandbox({ fns: ['schMaterialIsPlotData', 'schMaterialDelimitedHeader'] });

async function runRealFile(name, contents, routedColumns = null) {
  assert.equal(pluginRoute.schMaterialIsPlotData({ path: `Materials/${name}` }), true);
  const suffix = path.extname(name).slice(1);
  const columns = routedColumns || pluginRoute.schMaterialDelimitedHeader(contents, suffix);
  assert.ok(columns.length >= 2, 'shipping bundle must expose at least two columns before routing');
  let workspace;
  const harness = await startBridge({
    config(scratch) {
      workspace = path.join(scratch, 'vault');
      fs.mkdirSync(path.join(workspace, 'Materials'), { recursive: true });
      fs.writeFileSync(path.join(workspace, 'Materials', name), contents, 'utf8');
      return { workspaceRoot: workspace, allowedRoots: [workspace] };
    },
  });
  try {
    const catalog = await harness.json('/v1/skills');
    assert.equal(catalog.status, 200, catalog.text);
    const skill = catalog.body.skills.find((entry) => entry.name === 'sch-data-plot');
    assert.ok(skill, 'real Bridge must discover sch-data-plot');
    const response = await harness.json('/v1/skills/run', {
      method: 'POST',
      body: {
        skillId: skill.id,
        workspace,
        input: JSON.stringify({
          data_path: `Materials/${name}`,
          x_column: columns[0],
          y_columns: [columns[1]],
          plot_kind: 'line',
          title: `L2 ${name}`,
        }),
      },
    });
    return { harness, workspace, response };
  } catch (error) {
    harness.stop();
    throw error;
  }
}

function assertPlotArtifacts(workspace, manifest, suffix, expectedDelimiter, skippedLines) {
  assert.equal(manifest.skill, 'sch-data-plot');
  assert.ok(manifest.source.path.endsWith(suffix));
  assert.equal(manifest.source.delimiter, expectedDelimiter);
  assert.equal(manifest.source.skipped_lines, skippedLines);
  for (const relative of manifest.outputs) {
    const target = path.join(workspace, relative);
    assert.ok(fs.existsSync(target), `expected output to exist: ${relative}`);
    assert.ok(fs.statSync(target).size > 0, `expected non-empty output: ${relative}`);
  }
  const svg = manifest.outputs.find((item) => item.endsWith('/plot.svg'));
  const report = manifest.outputs.find((item) => item.endsWith('/plot-report.md'));
  assert.match(fs.readFileSync(path.join(workspace, svg), 'utf8'), /<svg/);
  assert.match(fs.readFileSync(path.join(workspace, report), 'utf8'), /Separator:/);
}

test('[L2] real comment-prefixed TXT travels through the live Bridge and produces auditable chart artifacts', async () => {
  const run = await runRealFile('instrument.txt', '# instrument export\n% acquired locally\ntime\tsignal\n0\t1.2\n1\t2.4\n2\t3.6\n');
  try {
    assert.equal(run.response.status, 200, run.response.text);
    assertPlotArtifacts(run.workspace, run.response.body.manifest, '.txt', '\t', 2);
  } finally { run.harness.stop(); }
});

test('[L2] real whitespace DAT travels through the live Bridge and produces auditable chart artifacts', async () => {
  const run = await runRealFile('instrument.dat', '! exported by instrument\ntime signal\n0 4.0\n1 5.0\n2 6.0\n');
  try {
    assert.equal(run.response.status, 200, run.response.text);
    assertPlotArtifacts(run.workspace, run.response.body.manifest, '.dat', '\t', 1);
    assert.equal(run.response.body.manifest.source.delimiter_source, 'sniffed:whitespace-run');
  } finally { run.harness.stop(); }
});

test('[L2] ambiguous TXT is rejected before any chart artifact is written', async () => {
  const contents = 'time,group;signal\n0,a;1\n1,b;2\n';
  assert.throws(
    () => pluginRoute.schMaterialDelimitedHeader(contents, 'txt'),
    /歧义/,
    'the shipping UI must refuse the ambiguous header before offering a chart recipe',
  );
  const run = await runRealFile('ambiguous.txt', contents, ['time', 'signal']);
  try {
    assert.equal(run.response.status, 400, run.response.text);
    // Bridge currently bounds child stderr from the front, so a Windows path
    // may truncate the final word "ambiguous". The executor still identifies
    // the separator gate before writing; C owns the runtime diagnostic shape.
    assert.match(run.response.body.error, /sniff_table|column separator/i);
    assert.equal(fs.existsSync(path.join(run.workspace, 'Materials', '_analysis')), false);
  } finally { run.harness.stop(); }
});
