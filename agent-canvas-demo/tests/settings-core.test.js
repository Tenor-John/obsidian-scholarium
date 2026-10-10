/* settings-core + 凭据端点测试：注册表完整性、掩码、.env 往返、
 * Bridge /v1/settings/credentials 三个端点的真实行为（临时目录隔离）。 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const core = require('../settings-core.js');
const { startBridge } = require('./helpers/bridge-harness.js');

test('credential registry: 每一项都回答三个问题（用途/降级/申请入口）', () => {
  assert.ok(core.CREDENTIAL_REGISTRY.length >= 5);
  for (const item of core.CREDENTIAL_REGISTRY) {
    assert.match(item.envVar, /^[A-Z][A-Z0-9_]*$/);
    assert.ok(item.label && item.purpose && item.fallback, `${item.envVar} 缺少说明`);
    assert.match(item.applyUrl, /^https:\/\//, `${item.envVar} 缺少 https 申请链接`);
    assert.ok(core.COST_LABEL[item.cost], `${item.envVar} 的 cost 无中文标签`);
    assert.equal(typeof item.validate, 'function');
  }
});

test('maskSecret 不泄露中间内容', () => {
  assert.equal(core.maskSecret(''), '');
  assert.equal(core.maskSecret('short'), '••••');
  const masked = core.maskSecret('abcd1234567890wxyz');
  assert.ok(masked.startsWith('abcd') && masked.endsWith('wxyz'));
  assert.ok(!masked.includes('1234567890'));
});

test('env 文件解析/序列化往返，注释与空行安全', () => {
  const raw = '# comment\n\nMINERU_API_KEY=abc123\n UNPAYWALL_EMAIL = a@b.cn \n';
  const entries = core.parseEnvFile(raw);
  assert.deepEqual(entries, { MINERU_API_KEY: 'abc123', UNPAYWALL_EMAIL: 'a@b.cn' });
  const round = core.parseEnvFile(core.serializeEnvFile(entries));
  assert.deepEqual(round, entries);
});

test('credentialStatus 标注来源与降级说明', () => {
  const status = core.credentialStatus(core.CREDENTIAL_REGISTRY, {
    MINERU_API_KEY: { value: 'a'.repeat(51), source: 'config' },
  });
  const mineru = status.find((s) => s.envVar === 'MINERU_API_KEY');
  assert.equal(mineru.configured, true);
  assert.equal(mineru.source, 'config');
  const scopus = status.find((s) => s.envVar === 'SCOPUS_API_KEY');
  assert.equal(scopus.configured, false);
  assert.ok(scopus.fallback.includes('开放数据源'));
});

test('Bridge 凭据端点：写入、掩码读取、迁移 legacy 密钥', async (t) => {
  // Port assigned by the OS. This used to hard-code 4521 and then sleep 1200ms
  // instead of waiting for readiness: a fixed port can hit a Windows excluded
  // range (EACCES, which no free-port probe detects) and a fixed sleep turns a
  // slow machine into a false failure.
  const harness = await startBridge({
    config: (scratch) => ({
      workspaceRoot: scratch,
      allowedRoots: [scratch],
      skillDirectories: [],
      scholarium: { enabled: false, vaultRoot: scratch, allowedActions: [] },
      fullTaskCategories: {},
      adapters: {},
      mineruApiKey: 'legacy-plaintext-key-0123456789abcdef',
    }),
  });
  t.after(() => harness.stop());
  const configPath = harness.configPath;
  const call = (p, opts = {}) => harness.json(p, opts).then((r) => r.body);

  // legacy config 密钥应能被读取但标注为 config 来源
  const before = await call('/v1/settings/credentials');
  const mineruBefore = before.credentials.find((c) => c.envVar === 'MINERU_API_KEY');
  assert.equal(mineruBefore.configured, true);
  assert.equal(mineruBefore.source, 'config');
  assert.ok(!JSON.stringify(before).includes('legacy-plaintext-key-0123456789abcdef'), '响应不得包含明文');

  // 写入新凭据（格式校验拦截坏值）
  const bad = await call('/v1/settings/credentials', { method: 'POST', body: JSON.stringify({ envVar: 'UNPAYWALL_EMAIL', value: 'not-an-email' }) });
  assert.ok(bad.error);
  const good = await call('/v1/settings/credentials', { method: 'POST', body: JSON.stringify({ envVar: 'UNPAYWALL_EMAIL', value: 'researcher@example.cn' }) });
  assert.equal(good.ok, true);
  assert.equal(good.masked, 'rese••••e.cn');

  // 未知 envVar 拒绝
  const unknown = await call('/v1/settings/credentials', { method: 'POST', body: JSON.stringify({ envVar: 'PATH', value: 'x'.repeat(30) }) });
  assert.ok(unknown.error);

  // 迁移：config 明文消失，.env 接手
  const migrated = await call('/v1/settings/credentials/migrate', { method: 'POST', body: '{}' });
  assert.equal(migrated.migrated.length, 1);
  const configAfter = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(configAfter.mineruApiKey, undefined);
  const after = await call('/v1/settings/credentials');
  const mineruAfter = after.credentials.find((c) => c.envVar === 'MINERU_API_KEY');
  assert.equal(mineruAfter.source, 'file');
});
