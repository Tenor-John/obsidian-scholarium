"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('the generated dashboard keeps the native deduction loading/error path and has no false empty-panel override', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(source, /研究推演室渲染超时（15s）/);
  assert.match(source, /研究推演室加载失败/);
  assert.doesNotMatch(source, /__deductionBlankScreenGuard207/);
  assert.doesNotMatch(source, /deduction panel rendered empty/);
  assert.doesNotMatch(source, /plugins\/scholarium\/deduction-debug\.log/);
});
