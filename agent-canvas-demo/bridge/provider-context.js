'use strict';
// Provider identity comes from cc-switch local state, never from a model reply.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function untrusted(reason) {
  return { source: 'cc-switch', trust: 'untrusted', providerId: null, label: '来源无法独立确认', route: '按第三方链路处理', reason: String(reason || 'provider state unavailable') };
}

function contextFromRecords(settings, provider) {
  if (!settings || typeof settings !== 'object') return untrusted('cc-switch settings unreadable');
  if (settings.enableClaudePluginIntegration !== true) return untrusted('cc-switch Claude integration is disabled');
  const providerId = String(settings.currentProviderClaude || '');
  if (!providerId || !provider || provider.id !== providerId || provider.app_type !== 'claude') return untrusted('selected Claude provider is absent from cc-switch database');
  const official = provider.id === 'claude-official' && String(provider.category || '').toLowerCase() === 'official';
  return {
    source: 'cc-switch', trust: official ? 'official-provider' : 'third-party', providerId,
    label: String(provider.name || providerId).slice(0, 120),
    route: settings.enableLocalProxy === true ? 'cc-switch 本地代理' : 'cc-switch provider 路由', reason: null,
  };
}

function queryProvider(dbPath, providerId, command = process.env.CC_SWITCH_SQLITE_COMMAND || 'sqlite3') {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(providerId)) return null;
  const sql = `SELECT id, app_type, name, category FROM providers WHERE app_type='claude' AND id='${providerId}' LIMIT 1;`;
  const result = spawnSync(command, ['-json', dbPath, sql], { encoding: 'utf8', windowsHide: true, timeout: 1500 });
  if (result.error || result.status !== 0) return null;
  try { const rows = JSON.parse(result.stdout || '[]'); return Array.isArray(rows) ? rows[0] || null : null; } catch { return null; }
}

function readCcSwitchProvider(options = {}) {
  const home = options.home || process.env.CC_SWITCH_HOME || path.join(process.env.USERPROFILE || os.homedir(), '.cc-switch');
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(home, 'settings.json'), 'utf8'));
    const id = String(settings.currentProviderClaude || '');
    const provider = typeof options.queryProvider === 'function' ? options.queryProvider(path.join(home, 'cc-switch.db'), id) : queryProvider(path.join(home, 'cc-switch.db'), id, options.sqliteCommand);
    return contextFromRecords(settings, provider);
  } catch (error) { return untrusted(error.code || error.message); }
}

module.exports = { readCcSwitchProvider, contextFromRecords, untrusted };
