"use strict";
// 2026-08-28 发布冲刺项4 P2 命名/文案修复（清单缺陷#5，项3实测发现）：
// 「课题注册表」区的按钮显示为"回扫预演"，但它实际触发的是 P7 闭环回扫的
// 只读*结算*预演（捞出已出结论但未结算的实验，产出假设结算建议草稿），
// 和 M4 的 workspace.rescan_pending 全量回扫是完全不同的两个功能——两者
// 都被随口叫做"回扫"，研究员点这个按钮很容易以为是在触发/复查 M4 回扫，
// 或者以为按钮坏了。改名为"结算预演"，去掉"回扫"这个和 M4 撞车的词，
// 同时统一 idea-tree.js 假设详情卡上的同名按钮与提示文案。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ideaTreeSource = fs.readFileSync(path.join(__dirname, '..', 'idea-tree.js'), 'utf8');
const bridgeUiSource = fs.readFileSync(path.join(__dirname, '..', 'bridge-ui.js'), 'utf8');

test('the project-registry P7 rehearsal button reads "结算预演", not "回扫预演"', () => {
  const buttonMatch = /<button[^>]*id="runRehearsal"[^>]*>([^<]*)<\/button>/.exec(indexHtml);
  assert.ok(buttonMatch, 'runRehearsal button must exist');
  assert.equal(buttonMatch[1], '结算预演');
  // Its title attribute must still accurately describe the P7 settlement
  // rehearsal — the rename only fixes the short label, not the detailed tooltip.
  assert.match(indexHtml, /id="runRehearsal"[^>]*title="[^"]*P7[^"]*结算/);
});

test('the per-hypothesis rehearsal button and its toast also say "结算预演", not "回扫预演"', () => {
  assert.match(ideaTreeSource, /对该假设运行结算预演/);
  assert.match(ideaTreeSource, /正在为 \$\{id\} 运行结算预演/);
  assert.doesNotMatch(ideaTreeSource, /回扫预演/);
});

test('no user-facing "回扫预演" label remains in the P7 rehearsal wiring (bridge-ui.js)', () => {
  assert.doesNotMatch(bridgeUiSource, /回扫预演/);
});
