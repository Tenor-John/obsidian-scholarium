"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMarkdown } = require('../chat-markdown-core.js');

test('chat Markdown renders a headed table with inline code and Unicode scientific symbols', () => {
  const html = renderMarkdown('说明：电解质如下。\n\n| 位置 | 处理 |\n| --- | --- |\n| 电解质 | `0.5 M Na₂SO₄` |');
  assert.match(html, /<thead><tr><th>位置<\/th><th>处理<\/th><\/tr><\/thead>/);
  assert.match(html, /<code>0\.5 M Na₂SO₄<\/code>/);
  assert.doesNotMatch(html, /\| --- \|/);
});

test('chat Markdown preserves ordinary symbols but never interprets reply HTML', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> → ΔE < 0; **结论**');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; → ΔE &lt; 0;/);
  assert.match(html, /<strong>结论<\/strong>/);
  assert.doesNotMatch(html, /<img/);
});

test('chat Markdown supports generic code fences without executing their content', () => {
  const html = renderMarkdown('```json\n{"x":"<unsafe>"}\n```');
  assert.match(html, /<pre class="wv-chat-code"><code>\{&quot;x&quot;:&quot;&lt;unsafe&gt;&quot;\}<\/code><\/pre>/);
});
