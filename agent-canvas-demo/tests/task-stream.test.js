'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { streamTaskAdapter, resumeTaskAdapter } = require('../bridge/task-stream');

test('standard Claude JSON adapter streams without changing its permissions', () => {
  const adapter = { args: ['-p', '--output-format', 'json', '--tools', 'Read,Grep', '--strict-mcp-config'], sandboxed: true };
  const upgraded = streamTaskAdapter('claude', adapter);
  assert.deepEqual(upgraded.args, ['-p', '--output-format', 'stream-json', '--tools', 'Read,Grep', '--strict-mcp-config', '--verbose']);
  assert.equal(upgraded.sandboxed, true);
  assert.equal(adapter.args[2], 'json');
});

test('resumption uses the saved session and keeps the read-only options', () => {
  const id = '12345678-1234-1234-1234-123456789abc';
  const claude = { args: ['-p', '--tools', 'Read', '--strict-mcp-config'] };
  assert.deepEqual(resumeTaskAdapter('claude', claude, id).args, [...claude.args, '--resume', id]);
  const codex = { args: ['exec', '--sandbox', 'read-only', '--json', '-'] };
  assert.deepEqual(resumeTaskAdapter('codex', codex, id).args, ['exec', '--sandbox', 'read-only', '--json', 'resume', id, '-']);
  assert.throws(() => resumeTaskAdapter('claude', claude, 'invalid'));
  assert.throws(() => resumeTaskAdapter('other', claude, id));
});

test('other agents and custom output formats remain unchanged', () => {
  const adapter = { args: ['--output-format', 'text'] };
  assert.equal(streamTaskAdapter('claude', adapter), adapter);
  assert.equal(streamTaskAdapter('codex', adapter), adapter);
});
