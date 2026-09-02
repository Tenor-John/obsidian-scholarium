/* settings-ui.js — 设置中心对话框：Agent 接入状态 + API 钥匙串。
 * 数据全部来自 Bridge：/v1/agents 与 /v1/settings/credentials；
 * 凭据展示永远只有掩码，明文只在用户粘贴进输入框的瞬间存在于内存。 */
(function () {
  const $ = (sel) => document.querySelector(sel);
  const core = window.weaverSettingsCore;

  // 各 Agent CLI 的安装/登录指引（与本机是否已检测到无关，永远展示入口）。
  const AGENT_GUIDES = {
    codex: { label: 'Codex CLI', guide: 'https://developers.openai.com/codex/cli' },
    claude: { label: 'Claude Code（只读）', guide: 'https://docs.anthropic.com/en/docs/claude-code/overview' },
    'claude-research': { label: 'Claude Code · 科研车道', guide: 'https://docs.anthropic.com/en/docs/claude-code/overview' },
    'claude-full': { label: 'Claude Code · 完整权限车道', guide: '' },
    'codex-full': { label: 'Codex · 完整权限车道', guide: '' },
    'opencode-full': { label: 'OpenCode · 完整权限车道', guide: '' },
    opencode: { label: 'OpenCode', guide: 'https://opencode.ai/docs/' },
    hermes: { label: 'Hermes', guide: '' },
    openclaw: { label: 'OpenClaw', guide: '' },
  };

  const dialog = $('#settingsCenterDialog');
  if (!dialog || !core) return;

  function setStatus(text) { const el = $('#settingsCenterStatus'); if (el) el.textContent = text; }

  function agentRow(agent) {
    const guide = AGENT_GUIDES[agent.id] || { label: agent.id, guide: '' };
    const row = document.createElement('div');
    row.className = 'wv-action-row';
    const name = document.createElement('code');
    name.textContent = guide.label;
    const detail = document.createElement('span');
    detail.className = 'wv-action-detail';
    const state = agent.available ? '已检测到，可用' : '未检测到';
    detail.textContent = `${state}${agent.sandboxed ? '（只读沙箱）' : ''}${agent.permission === 'full' ? '（完整权限车道）' : ''}`;
    row.append(name, detail);
    if (!agent.available && guide.guide) {
      const link = document.createElement('a');
      link.href = guide.guide;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '安装与登录指引';
      row.appendChild(link);
    }
    return row;
  }

  function credentialCard(item) {
    const card = document.createElement('div');
    card.className = 'agent-result';
    const head = document.createElement('div');
    head.innerHTML = `<b></b> <span class="wv-faint"></span>`;
    head.querySelector('b').textContent = item.label;
    head.querySelector('span').textContent = ` ${item.costLabel}`;
    card.appendChild(head);

    const purpose = document.createElement('p');
    purpose.className = 'wv-faint';
    purpose.textContent = item.purpose;
    card.appendChild(purpose);

    const state = document.createElement('p');
    state.textContent = item.configured
      ? `已配置：${item.masked}（来源：${{ env: '环境变量', file: 'bridge/.env', config: 'bridge.config.json 遗留明文，建议点下方「迁移遗留明文密钥」' }[item.source] || item.source}）`
      : `未配置。${item.fallback}`;
    card.appendChild(state);

    const row = document.createElement('div');
    row.className = 'wv-action-row';
    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = item.configured ? '粘贴新值以替换' : `粘贴 ${item.label} 的${item.envVar.includes('EMAIL') ? '邮箱' : '密钥'}`;
    input.autocomplete = 'off';
    const save = document.createElement('button');
    save.className = 'button primary';
    save.textContent = '保存';
    save.addEventListener('click', async () => {
      const value = input.value.trim();
      const verdict = core.CREDENTIAL_REGISTRY.find((c) => c.envVar === item.envVar).validate(value);
      if (verdict !== true) { setStatus(`${item.label}：${verdict}`); return; }
      save.disabled = true;
      try {
        await bridgeFetch('/v1/settings/credentials', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ envVar: item.envVar, value }),
        });
        input.value = '';
        setStatus(`${item.label} 已保存到 bridge/.env。`);
        await loadCredentials();
      } catch (error) { setStatus(`${item.label} 保存失败：${error.message}`); }
      finally { save.disabled = false; }
    });
    const apply = document.createElement('a');
    apply.href = item.applyUrl;
    apply.target = '_blank';
    apply.rel = 'noopener noreferrer';
    apply.textContent = '去申请';
    row.append(input, save, apply);
    card.appendChild(row);
    return card;
  }

  async function loadAgents() {
    const list = $('#settingsAgentList');
    list.innerHTML = '';
    try {
      const { agents } = await bridgeFetch('/v1/agents');
      for (const agent of agents) list.appendChild(agentRow(agent));
      if (!agents.length) list.textContent = 'Bridge 未报告任何 Agent 适配器。';
    } catch (error) {
      list.textContent = `无法读取 Agent 状态：${error.message}（Bridge 未连接？）`;
    }
  }

  async function loadCredentials() {
    const list = $('#settingsCredentialList');
    list.innerHTML = '';
    try {
      const { credentials } = await bridgeFetch('/v1/settings/credentials');
      for (const item of credentials) list.appendChild(credentialCard(item));
    } catch (error) {
      list.textContent = `无法读取凭据状态：${error.message}（Bridge 未连接或版本过旧？）`;
    }
  }

  $('#showSettingsCenter')?.addEventListener('click', () => {
    setStatus('');
    dialog.showModal();
    loadAgents();
    loadCredentials();
  });
  $('#closeSettingsCenter')?.addEventListener('click', () => dialog.close());
  $('#migrateLegacySecrets')?.addEventListener('click', async () => {
    try {
      const result = await bridgeFetch('/v1/settings/credentials/migrate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      setStatus(result.migrated.length
        ? `已迁移 ${result.migrated.length} 项：${result.migrated.map((m) => m.envVar).join('、')}。bridge.config.json 中对应明文已清除。`
        : '没有发现遗留明文密钥，无需迁移。');
      await loadCredentials();
    } catch (error) { setStatus(`迁移失败：${error.message}`); }
  });
})();
