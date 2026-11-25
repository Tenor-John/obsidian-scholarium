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

test('[L2] GBK Chinese CSV uses the bundled plot Skills directly without normalization', async () => {
  const sourceBytes = Buffer.from('yrG85Ci31tbTKSzQxbrF1rUozqK3/CkNCjAuMDAwNiwtNA0KMC4wMDE4LC02DQowLjAwMzAsLTgNCg==', 'base64');
  let workspace;
  let sourcePath;
  const harness = await startBridge({
    config(scratch) {
      workspace = path.join(scratch, 'vault');
      fs.mkdirSync(path.join(workspace, 'Materials'), { recursive: true });
      sourcePath = path.join(workspace, 'Materials', 'chinese-gbk.CSV');
      fs.writeFileSync(sourcePath, sourceBytes);
      // Simulate an adopted profile that still lists an older runtime first.
      // The unified route must not execute these same-named stale scripts.
      const oldSkills = path.join(scratch, 'old-skills');
      for (const name of ['sch-data-plot', 'sch-data-profile-audit']) {
        const target = path.join(oldSkills, name);
        fs.cpSync(path.join(__dirname, '..', 'skills', name), target, { recursive: true });
        const runner = name === 'sch-data-plot' ? 'generate_plot.py' : 'profile_audit.py';
        fs.writeFileSync(path.join(target, 'scripts', runner), "import sys\nsys.stderr.write('stale skill selected')\nraise SystemExit(97)\n", 'utf8');
      }
      return { workspaceRoot: workspace, allowedRoots: [workspace], skillDirectories: [oldSkills] };
    },
  });
  const context = { workspace, output_root: 'Materials', researcher_confirmed: true };
  try {
    const inspected = await harness.json('/v1/plot-tools/inspect_dataset', {
      method: 'POST',
      body: { arguments: { dataset_path: 'Materials\\chinese-gbk.CSV', sample_rows: 1 }, context },
    });
    assert.equal(inspected.status, 200, inspected.text);
    assert.equal(inspected.body.observation.status, 'success', inspected.text);
    assert.equal(inspected.body.observation.dataset.encoding, 'GB18030');
    assert.deepEqual(inspected.body.observation.columns.map((column) => column.name), ['时间(分钟)', '信号值(微伏)']);

    const rendered = await harness.json('/v1/plot-tools/render_plot', {
      method: 'POST',
      body: {
        arguments: {
          dataset_path: 'Materials\\chinese-gbk.CSV',
          recipe: { plot_kind: 'line', title: '冒烟测试', x_column: '时间(分钟)', y_columns: ['信号值(微伏)'], chart_style: {} },
        },
        context,
      },
    });
    assert.equal(rendered.status, 200, rendered.text);
    const observation = rendered.body.observation;
    assert.equal(observation.status, 'success', JSON.stringify(observation));
    assert.equal(observation.manifest_summary.title, '冒烟测试');
    assert.equal(observation.manifest_summary.series_list[0].id, 'series:信号值(微伏)');
    assert.equal(observation.column_mapping.status, 'verified');
    assert.equal(observation.manifest_path.includes('\\'), false);
    assert.deepEqual(fs.readFileSync(sourcePath), sourceBytes, 'the GBK source must remain byte-identical');
    assert.equal(fs.existsSync(path.join(workspace, 'Materials', '_normalized')), false);
  } finally { harness.stop(); }
});

test('[L2] unified plot tools render and incrementally revise with portable IDs and conflict safety', async () => {
  let workspace;
  const harness = await startBridge({
    config(scratch) {
      workspace = path.join(scratch, 'vault');
      fs.mkdirSync(path.join(workspace, 'Materials'), { recursive: true });
      fs.writeFileSync(path.join(workspace, 'Materials', 'rates.csv'), 'time,signal\n0,1.2\n1,2.4\n2,3.6\n', 'utf8');
      return { workspaceRoot: workspace, allowedRoots: [workspace] };
    },
  });
  const sourcePath = path.join(workspace, 'Materials', 'rates.csv');
  const sourceBefore = fs.readFileSync(sourcePath);
  const context = { workspace, output_root: 'Materials', researcher_confirmed: true };
  try {
    const inspected = await harness.json('/v1/plot-tools/inspect_dataset', {
      method: 'POST', body: { arguments: { dataset_path: 'Materials\\rates.csv', sample_rows: 2 }, context },
    });
    assert.equal(inspected.status, 200, inspected.text);
    assert.equal(inspected.body.observation.status, 'success');
    assert.equal(inspected.body.observation.dataset.path, 'Materials/rates.csv');
    assert.deepEqual(inspected.body.observation.sample, [{ time: '0', signal: '1.2' }, { time: '1', signal: '2.4' }]);

    const rendered = await harness.json('/v1/plot-tools/render_plot', {
      method: 'POST',
      body: {
        arguments: {
          dataset_path: 'Materials\\rates.csv',
          recipe: { plot_kind: 'line', title: 'Unified v1', x_column: 'time', y_columns: ['signal'], chart_style: { show_grid: true } },
        },
        context,
      },
    });
    assert.equal(rendered.status, 200, rendered.text);
    const v1 = rendered.body.observation;
    assert.equal(v1.status, 'success', JSON.stringify(v1));
    assert.equal(v1.current_version, 1);
    assert.equal(v1.manifest_path.includes('\\'), false);
    assert.equal(v1.plot_id, v1.manifest_path);
    assert.deepEqual(v1.manifest_summary.series_list, [{ id: 'series:signal', y_column: 'signal' }]);
    assert.equal(v1.column_mapping.status, 'verified');

    const revised = await harness.json('/v1/plot-tools/revise_plot', {
      method: 'POST',
      body: {
        arguments: {
          target_manifest_id: v1.target_manifest_id.replace(/\//g, '\\'),
          base_version: 1,
          revision_reason: 'L2 incremental style patch',
          patch: {
            series_updates: [{ id: 'series:signal', color: '#C57300' }],
            annotations_upsert: [{ id: 'baseline', type: 'hline', value: 0, label: 'zero' }],
          },
        },
        context,
      },
    });
    assert.equal(revised.status, 200, revised.text);
    const v2 = revised.body.observation;
    assert.equal(v2.status, 'success', JSON.stringify(v2));
    assert.equal(v2.current_version, 2);
    assert.equal(v2.plot_id, v1.plot_id);
    assert.equal(v2.audit.parent_manifest_id, v1.manifest_path);
    assert.equal(v2.audit.parent_version, 1);
    assert.notEqual(v2.manifest_path, v1.manifest_path);
    assert.deepEqual(v2.manifest_summary.series_list, [{ id: 'series:signal', y_column: 'signal', color: '#c57300' }]);
    assert.equal(v2.manifest_summary.annotations_list[0].id, 'baseline');
    const v2Manifest = JSON.parse(fs.readFileSync(path.join(workspace, v2.manifest_path), 'utf8'));
    assert.equal(v2Manifest.plot_contract.manifest_id, v2.manifest_path);
    assert.equal(v2Manifest.plot.chart_style.series_colors.signal, '#c57300');

    const plotContext = await harness.json('/v1/plot-tools/get_plot_context', {
      method: 'POST', body: { arguments: { target_manifest_id: v2.manifest_path }, context },
    });
    assert.equal(plotContext.body.observation.active.version, 2);
    assert.equal(plotContext.body.observation.versions.length, 2);

    const analysisRoot = path.join(workspace, 'Materials', '_analysis');
    const filesBeforeConflict = fs.readdirSync(analysisRoot).sort();
    const v2BytesBeforeConflict = fs.readFileSync(path.join(workspace, v2.manifest_path));
    const conflict = await harness.json('/v1/plot-tools/revise_plot', {
      method: 'POST',
      body: {
        arguments: {
          target_manifest_id: v2.manifest_path,
          base_version: 1,
          revision_reason: 'stale writer must not render',
          patch: { title: 'must not be written' },
        },
        context,
      },
    });
    assert.equal(conflict.status, 200, conflict.text);
    assert.equal(conflict.body.observation.status, 'error');
    assert.equal(conflict.body.observation.error.code, 'VERSION_CONFLICT');
    assert.equal(conflict.body.observation.current_version, 2);
    assert.deepEqual(fs.readdirSync(analysisRoot).sort(), filesBeforeConflict);
    assert.deepEqual(fs.readFileSync(path.join(workspace, v2.manifest_path)), v2BytesBeforeConflict);
    assert.deepEqual(fs.readFileSync(sourcePath), sourceBefore);
  } finally { harness.stop(); }
});
