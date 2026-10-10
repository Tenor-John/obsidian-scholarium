'use strict';

/*
 * Beta's user configuration is deliberately smaller than bridge.config.json.
 * It contains a Vault selection and an explicit local-CLI consent only. The
 * Bridge bearer token, adapter paths, detection output and audit files belong
 * to the local runtime profile, never to this user-editable document.
 */
const crypto = require('node:crypto');
const path = require('node:path');

const BETA_CONFIG_VERSION = 1;
const CLI_CHOICES = new Set(['auto', 'claude', 'codex']);
const CONFIG_KEYS = new Set(['schemaVersion', 'vaultRoot', 'execution']);
const EXECUTION_KEYS = new Set(['enabled', 'preferredCli']);

function defaultBetaConfig(vaultRoot = null) {
  return {
    schemaVersion: BETA_CONFIG_VERSION,
    vaultRoot,
    execution: { enabled: false, preferredCli: 'auto' },
  };
}

function profileIdForVault(vaultRoot) {
  const root = String(vaultRoot || '');
  if (!root || !path.isAbsolute(root)) throw new Error('vaultRoot must be an absolute local path');
  // A profile id is safe to expose in UI/log paths; the Vault path itself is
  // never used as a directory name or sent to an external provider.
  return crypto.createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 20);
}

function validateBetaConfig(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, errors: ['configuration must be an object'] };

  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.has(key)) errors.push(`unknown or disallowed top-level field: ${key}`);
  }
  if (value.schemaVersion !== BETA_CONFIG_VERSION) errors.push(`schemaVersion must be ${BETA_CONFIG_VERSION}`);
  if (value.vaultRoot !== null && (typeof value.vaultRoot !== 'string' || !path.isAbsolute(value.vaultRoot))) {
    errors.push('vaultRoot must be null or an absolute local path');
  }
  if (!value.execution || typeof value.execution !== 'object' || Array.isArray(value.execution)) {
    errors.push('execution must be an object');
  } else {
    for (const key of Object.keys(value.execution)) {
      if (!EXECUTION_KEYS.has(key)) errors.push(`unknown or disallowed execution field: ${key}`);
    }
    if (typeof value.execution.enabled !== 'boolean') errors.push('execution.enabled must be boolean');
    if (!CLI_CHOICES.has(value.execution.preferredCli)) errors.push('execution.preferredCli must be auto, claude, or codex');
  }
  return { ok: errors.length === 0, errors };
}

// This function intentionally takes the complete Beta configuration, not the
// nested `execution` object. It validates the whole contract before allowing a
// CLI to run, so callers cannot bypass a malformed vault/profile selection.
function executionStateForConfig(config, detectedCli = []) {
  const valid = validateBetaConfig(config);
  if (!valid.ok) return { mode: 'blocked', reason: valid.errors.join('; ') };
  const detected = new Set((Array.isArray(detectedCli) ? detectedCli : []).filter((item) => CLI_CHOICES.has(item) && item !== 'auto'));
  if (!config.execution.enabled) return { mode: 'manual-skills', reason: 'local CLI execution has not been explicitly enabled' };
  const preferred = config.execution.preferredCli;
  const cli = preferred === 'auto'
    ? ['claude', 'codex'].find((item) => detected.has(item)) || null
    : (detected.has(preferred) ? preferred : null);
  if (!cli) return { mode: 'manual-skills', reason: 'the selected local CLI is unavailable' };
  return { mode: 'local-cli', cli, reason: null };
}

function providerDisclosure(state) {
  if (state?.mode === 'local-cli') {
    const label = state.cli === 'codex' ? '本机 Codex CLI' : '本机 Claude CLI';
    return { source: 'local-cli', trust: 'user-managed-cli', providerId: state.cli, label, route: '本机已登录 CLI', reason: null };
  }
  return { source: 'none', trust: 'unavailable', providerId: null, label: '未启用本机 Agent', route: '仅本地技能', reason: state?.reason || 'local CLI execution unavailable' };
}

module.exports = {
  BETA_CONFIG_VERSION,
  defaultBetaConfig,
  profileIdForVault,
  validateBetaConfig,
  executionStateForConfig,
  providerDisclosure,
};
