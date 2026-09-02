"use strict";
// 2026-08-28 发布冲刺项4 P2（清单缺陷#6，项3实测两次建主题各错焦一次）：
// 新建研究主题弹窗打开时，焦点应该落在"主题名称"输入框（.rtd-name），不是
// 下面的"Pipeline 检索主题"描述框（.rtd-goal）——否则研究员第一次打字会
// 打进错误的字段。修法是双保险：declarative 的 autofocus 属性 + 用
// requestAnimationFrame 把手动 focus()/select() 挪到下一帧，跑在浏览器对
// 刚 showModal() 的 <dialog> 做的内部初始焦点处理之后，而不是和它抢跑。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

test('the topic-name input declares autofocus (declarative first line of defense)', () => {
  const inputMatch = /<input class="rtd-name"[^>]*>/.exec(source);
  assert.ok(inputMatch, '.rtd-name input must exist');
  assert.match(inputMatch[0], /\bautofocus\b/);
});

test('askResearchTopic defers focus()/select() to the next frame instead of racing showModal()\'s own focus handling', () => {
  const start = source.indexOf('dialog.showModal();');
  assert.ok(start >= 0, 'showModal() call must exist');
  const block = source.slice(start, start + 500);
  assert.match(block, /requestAnimationFrame\(\(\) => \{ nameInput\.focus\(\); nameInput\.select\(\); \}\)/);
  // The old bare, synchronous call (no rAF wrapper) must be gone — that's
  // exactly the race the fix removes.
  assert.doesNotMatch(block, /showModal\(\);\s*\n\s*nameInput\.focus\(\);\s*\n\s*nameInput\.select\(\);/);
});
