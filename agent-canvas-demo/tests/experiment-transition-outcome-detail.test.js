"use strict";
// 2026-08-28 发布冲刺项4 P1（项3实测发现，交付清单第4类第2项）：
// executeScholariumActions() 结算面板时，所有 completed 状态的动作一律不带
// detail——这对队列动作是对的（detail 是一坨原始 result JSON，标签已经够
// 用），但 experiment.transition 的 detail 是专门拼好的人话
// （`${from} → ${to}`，或并发去重时的 `${from} 未变化（已经是该状态）`），
// 被同一条规则一起吞掉，导致一次真实推进和一次因为状态已被别的操作提前
// 推进而产生的 noop，在聊天里长得一模一样，都只显示"✔ 已生效
// experiment.transition"。这份测试锁定修复：只放行这一个动作的 detail，
// 不改变其它动作（如 workspace.timeblock_add）completed 时的展示方式。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'shell-ui.js'), 'utf8');

test('completed experiment.transition outcomes show their detail (from→to, or the noop notice), not just the bare label', () => {
  const start = source.indexOf("message.actionsState = 'settled';");
  assert.ok(start >= 0, 'settlement block must exist');
  const block = source.slice(start, start + 1200);
  assert.match(block, /showCompletedDetail/);
  assert.match(block, /'experiment\.transition'/);
  // The suppression must be conditional on the action, not a blanket
  // "completed => no detail" rule any more.
  assert.doesNotMatch(block, /o\.status === 'completed' \? '' :/);
});

test('other completed actions (e.g. queue-based ones) still suppress their raw-JSON detail by default', () => {
  const start = source.indexOf("message.actionsState = 'settled';");
  const block = source.slice(start, start + 1200);
  // The Set only names experiment.transition; no other action name is added
  // to the allow-list, so e.g. workspace.timeblock_add stays suppressed.
  const setMatch = /showCompletedDetail\s*=\s*new Set\(\[([^\]]*)\]\)/.exec(block);
  assert.ok(setMatch, 'showCompletedDetail must be defined as a Set literal');
  assert.equal(setMatch[1].trim(), "'experiment.transition'");
});

// 2026-08-28 发布冲刺项4 P1（交付清单第4类第2项）：the "Obsidian 未打开/
// 开关未开" diagnostic hint used to be appended unconditionally to every
// settlement message, including ones where every failure already had an
// explicit, unrelated server-side reason (e.g. a schema validation error
// naming the missing field) — misleading the researcher into checking the
// wrong thing. It must now only appear when at least one outcome is
// genuinely ambiguous (timeout/unknown), not for a plain 'failed' outcome.
test('the "Obsidian not open / action toggle off" hint is conditional on an ambiguous (timeout/unknown) outcome, not appended unconditionally', () => {
  const start = source.indexOf("message.actionsState = 'settled';");
  const block = source.slice(start, start + 2000);
  assert.match(block, /hasAmbiguousOutcome/);
  assert.match(block, /o\.status === 'timeout' \|\| o\.status === 'unknown'/);
  assert.match(block, /ambiguousHint/);
  // The old unconditional concatenation must be gone: the hint string may
  // only be reached through the conditional variable, never appended as a
  // literal suffix directly onto the joined lines.
  assert.doesNotMatch(block, /lines\.join\('\\n'\) \+ '\\n（可切到对应面板查看/);
});

// 2026-08-28 发布冲刺项4 P2（清单缺陷#4）：settlement lines used to print the
// raw action identifier (`experiment.transition`, `workspace.timeblock_add`)
// straight into the chat — a developer-facing name, not something a
// researcher should have to decode. ACTION_LABEL already exists for the
// confirmation card (rendered before the researcher clicks confirm); this
// locks in that the settlement line (rendered after) reuses the exact same
// map, so an action never wears two different names across the two moments.
test('settlement lines translate the action identifier through ACTION_LABEL instead of printing it raw', () => {
  const start = source.indexOf("message.actionsState = 'settled';");
  const block = source.slice(start, start + 1200);
  assert.match(block, /ACTION_LABEL\[o\.action\] \|\| o\.action/);
  assert.doesNotMatch(block, /\$\{label\[o\.status\] \|\| o\.status\} \$\{o\.action\}/);
});

test('ACTION_LABEL is defined once and reused for both the confirmation card and the settlement line', () => {
  const definitionCount = (source.match(/const ACTION_LABEL = \{/g) || []).length;
  assert.equal(definitionCount, 1, 'ACTION_LABEL must not be duplicated into a second map');
  const usages = source.match(/ACTION_LABEL\[/g) || [];
  assert.ok(usages.length >= 2, `expected ACTION_LABEL to be read at least twice (card + settlement), found ${usages.length}`);
});
