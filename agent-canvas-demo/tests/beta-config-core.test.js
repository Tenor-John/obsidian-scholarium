'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../beta-config-core.js');

test('Beta config defaults to explicit local-CLI opt-in and contains no credential surface', () => {
  const value = config.defaultBetaConfig();
  assert.deepEqual(value, {
    schemaVersion: 1,
    vaultRoot: null,
    execution: { enabled: false, preferredCli: 'auto' },
  });
  assert.deepEqual(config.validateBetaConfig(value), { ok: true, errors: [] });
  assert.deepEqual(config.executionStateForConfig(value, ['claude']), {
    mode: 'manual-skills', reason: 'local CLI execution has not been explicitly enabled',
  });
});

test('Beta config rejects API keys, proxy settings, tokens and unknown future fields', () => {
  for (const extra of [
    { aiApiKey: 'sk-not-allowed' },
    { mineruApiKey: 'not-allowed' },
    { token: 'not-a-beta-user-setting' },
    { ccSwitchHome: 'C:\\proxy' },
    { execution: { enabled: false, preferredCli: 'auto', apiKey: 'not-allowed' } },
  ]) {
    const value = { ...config.defaultBetaConfig('C:\\ResearchVault'), ...extra };
    const result = config.validateBetaConfig(value);
    assert.equal(result.ok, false, JSON.stringify(extra));
  }
});

test('Beta config accepts only an explicit local CLI and degrades to manual skills when absent', () => {
  const value = config.defaultBetaConfig('C:\\ResearchVault');
  value.execution = { enabled: true, preferredCli: 'codex' };
  assert.deepEqual(config.executionStateForConfig(value, []), {
    mode: 'manual-skills', reason: 'the selected local CLI is unavailable',
  });
  assert.deepEqual(config.executionStateForConfig(value, ['claude', 'codex']), {
    mode: 'local-cli', cli: 'codex', reason: null,
  });
  assert.deepEqual(config.providerDisclosure(config.executionStateForConfig(value, ['codex'])), {
    source: 'local-cli', trust: 'user-managed-cli', providerId: 'codex',
    label: '本机 Codex CLI', route: '本机已登录 CLI', reason: null,
  });
});

test('auto selection enables a detected CLI when the complete config explicitly opts in', () => {
  const value = config.defaultBetaConfig('C:\\ResearchVault');
  value.execution.enabled = true;
  assert.deepEqual(config.executionStateForConfig(value, ['claude']), {
    mode: 'local-cli', cli: 'claude', reason: null,
  });
});

test('Beta runtime profiles are stable opaque identifiers rather than Vault path directory names', () => {
  const first = config.profileIdForVault('C:\\ResearchVault');
  assert.equal(first, config.profileIdForVault('c:\\researchvault'));
  assert.match(first, /^[a-f0-9]{20}$/);
  assert.ok(!first.includes('ResearchVault'));
  assert.throws(() => config.profileIdForVault('Materials'), /absolute local path/);
});
