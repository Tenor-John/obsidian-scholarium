'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const locations = [
  path.join(root, 'tests'),
  path.join(root, 'agent-canvas-demo', 'tests'),
];
const files = locations.flatMap((directory) => fs.existsSync(directory)
  ? fs.readdirSync(directory)
    .filter((name) => /^l2-.*\.test\.js$/i.test(name))
    .sort()
    .map((name) => path.join(directory, name))
  : []);

if (!files.length) {
  console.error('Release gate refused to run: no l2-*.test.js files were found.');
  process.exit(2);
}

console.log('Scholarium release gate (L2 only)');
for (const file of files) console.log(`  ${path.relative(root, file)}`);
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'inherit',
});
process.exit(result.status === null ? 1 : result.status);
