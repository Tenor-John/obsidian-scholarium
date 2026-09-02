'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { contextFromRecords, readCcSwitchProvider } = require('../bridge/provider-context.js');

test('cc-switch provider identity is classified from settings plus database record, not model output', () => {
  const settings = { enableClaudePluginIntegration: true, enableLocalProxy: true, currentProviderClaude: 'deepseek-id' };
  const context = contextFromRecords(settings, { id: 'deepseek-id', app_type: 'claude', name: 'DeepSeek', category: 'cn_official' });
  assert.equal(context.trust, 'third-party');
  assert.equal(context.label, 'DeepSeek');
  assert.equal(context.route, 'cc-switch 本地代理');
});

test('only cc-switch official provider record gets official-provider label', () => {
  const settings = { enableClaudePluginIntegration: true, enableLocalProxy: true, currentProviderClaude: 'claude-official' };
  assert.equal(contextFromRecords(settings, { id: 'claude-official', app_type: 'claude', name: 'Claude Official', category: 'official' }).trust, 'official-provider');
  assert.equal(contextFromRecords(settings, { id: 'other', app_type: 'claude', name: 'Pretends Official', category: 'official' }).trust, 'untrusted');
});

test('unreadable, disabled, or database-missing cc-switch state fails closed', () => {
  assert.equal(contextFromRecords({ enableClaudePluginIntegration: false }, null).trust, 'untrusted');
  assert.equal(contextFromRecords({ enableClaudePluginIntegration: true, currentProviderClaude: 'missing' }, null).trust, 'untrusted');
  const missing = readCcSwitchProvider({ home: 'Z:/definitely-not-present' });
  assert.equal(missing.trust, 'untrusted');
});
