'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), 'utf8');
}

function extensionsFromRegex(source, functionName) {
  const body = source.match(new RegExp(`function ${functionName}\\(item\\) \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(body, `could not extract ${functionName} body`);
  const extensions = body[1].match(/csv\|tsv(?:\|txt\|dat)?/i);
  assert.ok(extensions, `could not extract ${functionName} extension route`);
  return extensions[0].toLowerCase().split('|').sort();
}

function extensionsFromJsSet(source, constantName) {
  const match = source.match(new RegExp(`const ${constantName} = new Set\\(\\[([^\\]]+)\\]\\)`));
  assert.ok(match, `could not extract ${constantName}`);
  return [...match[1].matchAll(/["']\.([a-z0-9]+)["']/gi)].map((item) => item[1].toLowerCase()).sort();
}

function extensionsFromPythonSet(source, constantName) {
  const match = source.match(new RegExp(`${constantName}\\s*=\\s*\\{([^}]+)\\}`));
  assert.ok(match, `could not extract ${constantName}`);
  return [...match[1].matchAll(/["']\.([a-z0-9]+)["']/gi)].map((item) => item[1].toLowerCase()).sort();
}

test('[L1] native plot route, Weaver plot route, and plot executor advertise the same suffixes', () => {
  const main = read('main.js');
  const actions = read('agent-canvas-demo/chat-actions-core.js');
  const plotter = read('agent-canvas-demo/skills/sch-data-plot/scripts/generate_plot.py');
  const nativeRoute = extensionsFromRegex(main, 'schMaterialIsPlotData');
  const weaverRoute = extensionsFromJsSet(actions, 'PLOT_SUFFIXES');
  const executor = extensionsFromPythonSet(plotter, 'SUPPORTED_SUFFIXES');
  assert.deepEqual(nativeRoute, ['csv', 'dat', 'tsv', 'txt']);
  assert.deepEqual(weaverRoute, nativeRoute, 'Weaver must not hide a format the native material route advertises');
  assert.deepEqual(executor, nativeRoute, 'the independent executor must accept every routed suffix');
});

test('[L1] normalization route remains equal to the normalizer executor', () => {
  const actions = read('agent-canvas-demo/chat-actions-core.js');
  const normalizer = read('agent-canvas-demo/skills/sch-data-normalize/scripts/normalize_data.py');
  assert.deepEqual(
    extensionsFromJsSet(actions, 'NORMALIZE_SUFFIXES'),
    extensionsFromPythonSet(normalizer, 'SUPPORTED_SUFFIXES'),
  );
});
