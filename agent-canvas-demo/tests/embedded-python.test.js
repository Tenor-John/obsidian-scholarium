'use strict';
/*
 * Guards the JS-hosting-Python seam in skills/.
 *
 * scansci_download.js keeps its Python in a JS template literal. A backtick
 * anywhere in that Python — including inside a comment — closes the literal
 * early and the rest of the file is parsed as JavaScript. It has broken the
 * download step twice, both times from a comment like:
 *
 *     # batch_download's `done` counts resumed identifiers too
 *
 * and both times the failure surfaced only at runtime, as
 * "SyntaxError: Unexpected identifier 'done'" inside the pipeline's step 5.
 * npm run check did not catch it because it only covered the four top-level
 * files, never skills/.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const SKILLS = path.join(__dirname, '..', 'skills');

function skillScripts(ext) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== '__pycache__') walk(target); }
      else if (entry.isFile() && entry.name.endsWith(ext)) out.push(target);
    }
  };
  if (fs.existsSync(SKILLS)) walk(SKILLS);
  return out;
}

// Every `const X = \`...\`` block in a skill script, with its contents.
function templateLiterals(source) {
  const blocks = [];
  const re = /const\s+(\w+)\s*=\s*`/g;
  let match;
  while ((match = re.exec(source)) !== null) {
    const start = re.lastIndex;
    const end = source.indexOf('`', start);
    if (end === -1) continue;
    blocks.push({ name: match[1], body: source.slice(start, end), start, end });
    re.lastIndex = end + 1;
  }
  return blocks;
}

test('skill scripts parse as JavaScript', () => {
  for (const file of skillScripts('.js')) {
    const run = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.strictEqual(run.status, 0, `${path.relative(SKILLS, file)} failed --check:\n${run.stderr}`);
  }
});

// Deliberately NOT scoped to "inside the template literal": once a stray
// backtick exists, the literal's real end is unknowable — a scan that stops at
// the first backtick simply truncates the block and reports it clean, which is
// how an earlier version of this test passed on a file that would not parse.
// A backtick in a Python comment line is the hazard, wherever it sits.
test('no backtick in a Python comment line', () => {
  for (const file of skillScripts('.js')) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((text, index) => {
      if (!/^\s*#/.test(text) || !text.includes('`')) return;
      assert.fail(
        `${path.relative(SKILLS, file)}:${index + 1} — backtick in a Python comment closes the `
        + `host JS template literal early. Use straight quotes.\n    ${text.trim()}`
      );
    });
  }
});

test('embedded Python compiles', (t) => {
  const python = ['python', 'python3', process.env.SCANSCI_PYTHON].filter(Boolean)
    .find((exe) => spawnSync(exe, ['-c', 'import sys'], { encoding: 'utf8' }).status === 0);
  if (!python) return t.skip('no Python interpreter on PATH');

  for (const file of skillScripts('.js')) {
    const source = fs.readFileSync(file, 'utf8');
    for (const block of templateLiterals(source)) {
      if (!/^\s*(import|from|def )/m.test(block.body)) continue;
      const tmp = path.join(require('node:os').tmpdir(), `embedded-${path.basename(file)}-${block.name}.py`);
      fs.writeFileSync(tmp, block.body, 'utf8');
      try {
        execFileSync(python, ['-m', 'py_compile', tmp], { encoding: 'utf8' });
      } catch (error) {
        assert.fail(`${path.relative(SKILLS, file)}: embedded Python in "${block.name}" `
          + `does not compile:\n${error.stderr || error.message}`);
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
  }
});

test('standalone skill Python compiles', (t) => {
  const python = ['python', 'python3', process.env.SCANSCI_PYTHON].filter(Boolean)
    .find((exe) => spawnSync(exe, ['-c', 'import sys'], { encoding: 'utf8' }).status === 0);
  if (!python) return t.skip('no Python interpreter on PATH');

  for (const file of skillScripts('.py')) {
    const run = spawnSync(python, ['-m', 'py_compile', file], { encoding: 'utf8' });
    assert.strictEqual(run.status, 0, `${path.relative(SKILLS, file)} failed py_compile:\n${run.stderr}`);
  }
});

test('silent scansci batches delegate the serial publisher-browser phase', () => {
  const source = fs.readFileSync(path.join(SKILLS, 'scansci-institutional', 'scripts', 'scansci_download.js'), 'utf8');
  assert.match(source, /if not _allow_browser and hasattr\(_sources_module, "_batch_institutional_phase"\)/);
  assert.match(source, /publisher_phase2=delegated_to_scholarium_fallback/);
  // The existing source policy is intentionally not rewritten by the scheduler fix.
  assert.match(source, /scihub_enabled=False/);
});

test('persistent browser download uses a bounded worker pool and isolated progress files', () => {
  const source = fs.readFileSync(path.join(SKILLS, 'paper-downloader', 'scripts', 'browser_downloader.js'), 'utf8');
  assert.match(source, /Math\.min\(3, Number\(input\.browser_workers\) \|\| 2\)/);
  assert.match(source, /Promise\.all\(Array\.from/);
  assert.match(source, /input\.progress_file/);
});

// M2 scope, not M1: this asserts the iframe\u2194plugin download-completion postMessage
// bridge, half of which lives in the *host* plugin bundle (main.js), not in
// agent-canvas-demo. M1 intentionally ships only a minimal mount (theme sync +
// launcher/health-check, see src/research-weaver-mount.ts) and does not yet wire this
// message channel into the host — see the migration map, sections 4-5, and M2. The
// agent-canvas-demo side (bridge-ui.js) already implements its half; re-enable this once
// the host-side listener lands in src/.
test('manual literature acquisition returns its PDF to the originating Pipeline', { skip: 'M2: host-side postMessage listener not yet in src/ (see migration map, sections 4-5)' }, () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'bridge-ui.js'), 'utf8');
  const hostBundle = fs.readFileSync(path.join(__dirname, '..', '..', 'main.js'), 'utf8');
  assert.match(ui, /scholarium:manual-download-completed/);
  assert.match(ui, /resumePipelineFromHistory/);
  assert.match(hostBundle, /scholarium:manual-download-completed/);
  assert.match(hostBundle, /pipelineRunId/);
});
