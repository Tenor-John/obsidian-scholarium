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
    input.autocomplete = 'off';
    /* 已配置时把掩码留在输入框里。
     *
     * 原来保存成功后直接 input.value = ''，字段看起来跟从没填过一样，用户没法
     * 判断到底存没存进去——尤其在校验静默失败的时候，这两种状态肉眼无法区分。
     * 现在：已配置 → 显示掩码（只读态）；点一下或点眼睛才进入编辑/查看。 */
    const setMasked = () => {
      input.type = 'password';
      input.value = item.configured ? item.masked : '';
      input.dataset.masked = item.configured ? 'true' : 'false';
      input.placeholder = item.configured ? '已配置（点此输入新值以替换）' : `粘贴 ${item.label} 的${item.envVar.includes('EMAIL') ? '邮箱' : '密钥'}`;
      eye.textContent = '👁';
      eye.title = item.configured ? '查看明文' : '尚未配置';
      eye.disabled = !item.configured;
    };
    // 掩码本身不是密钥，落在输入框里会被当成新值提交，所以聚焦即清空。
    input.addEventListener('focus', () => {
      if (input.dataset.masked === 'true') { input.value = ''; input.dataset.masked = 'false'; }
    });
    const eye = document.createElement('button');
    eye.className = 'button ghost';
    eye.type = 'button';
    eye.addEventListener('click', async () => {
      if (input.dataset.revealed === 'true') { setMasked(); input.dataset.revealed = 'false'; return; }
      eye.disabled = true;
      try {
        // 明文按需单取，不随列表一起下发。
        const data = await bridgeFetch('/v1/settings/credentials/reveal', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ envVar: item.envVar }),
        });
        input.type = 'text';
        input.value = data.value;
        input.dataset.masked = 'false';
        input.dataset.revealed = 'true';
        eye.textContent = '🙈';
        eye.title = '隐藏';
      } catch (error) { setStatus(`${item.label} 读取失败：${error.message}`); }
      finally { eye.disabled = false; }
    });
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
        // 不再清空成空白：重新加载后这张卡会以"已配置 + 掩码"的形态重建，
        // 用户能一眼确认确实存进去了。
        setStatus(`${item.label} 已保存到 bridge/.env。`);
        await loadCredentials();
        if (item.envVar === 'HF_TOKEN') await loadRagStatus();
      } catch (error) { setStatus(`${item.label} 保存失败：${error.message}`); }
      finally { save.disabled = false; }
    });
    const apply = document.createElement('a');
    apply.href = item.applyUrl;
    apply.target = '_blank';
    apply.rel = 'noopener noreferrer';
    apply.textContent = '去申请';
    row.append(input, eye, save, apply);
    setMasked();
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

  function ragStatusText(status) {
    if (!status) return 'RAG 状态不可用。';
    const token = status.hf_token_configured ? 'Hugging Face 已配置' : 'Hugging Face 未配置';
    const coverage = `${status.compatible_vectorized || 0}/${status.chunks || 0} chunks`;
    const percent = status.chunks ? `${Math.round(Number(status.coverage || 0) * 100)}%` : '0%';
    const stale = status.stale_vectorized ? `；另有 ${status.stale_vectorized} 个旧模型向量待替换` : '';
    return `${token}；当前模型 ${status.configured_model || '未知'}；向量覆盖 ${coverage}（${percent}）${stale}。默认查询使用混合检索，无可用向量时会明确降级 BM25。`;
  }

  async function loadRagStatus() {
    const element = $('#settingsRagStatus');
    if (!element) return;
    element.textContent = '正在读取索引状态…';
    try {
      const response = await bridgeFetch('/v1/rag/status');
      element.textContent = ragStatusText(response.manifest);
    } catch (error) { element.textContent = `无法读取 RAG 状态：${error.message}`; }
  }

  $('#showSettingsCenter')?.addEventListener('click', () => {
    setStatus('');
    dialog.showModal();
    loadAgents();
    loadCredentials();
    loadRagStatus();
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
  $('#refreshRagStatus')?.addEventListener('click', loadRagStatus);
  $('#reindexRag')?.addEventListener('click', async (event) => {
    if (!window.confirm('这会调用 Hugging Face 云端额度，为全部缺失或旧模型 chunks 生成向量。继续吗？')) return;
    const button = event.currentTarget;
    button.disabled = true;
    setStatus('正在向量化现有语料；请勿关闭 Bridge…');
    try {
      const response = await bridgeFetch('/v1/rag/reindex', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const result = response.manifest;
      setStatus(`向量化完成：本次 ${result.vectorization.embedded} chunks，维度 ${result.vectorization.dimensions || '未知'}。`);
      await loadRagStatus();
    } catch (error) { setStatus(`向量化失败：${error.message}`); }
    finally { button.disabled = false; }
  });
  /* Graph keywords.
     ------------------------------------------------------------------------
     build_paper_graph.js matches entities with three hardcoded regexes for a
     photocatalysis vocabulary. Against this vault's gold-nanostar corpus they
     produced 512 edges of which 161 hung off the token "au", while HEPES,
     MOPS and nanostar never entered the graph at all. Adding those words to
     the regex table would repeat the mistake at the researcher's next
     project, so the list is configuration and, when unset, is derived from
     whatever corpus was actually indexed. Unset is the default and needs no
     interaction; this panel exists to override or freeze it. */
  let graphSuggestions = [];
  const parseKeywordInput = (raw) => String(raw || '')
    .split(/[,，\n\r;；]/).map((part) => part.trim()).filter(Boolean);

  const renderGraphKeywords = (payload) => {
    const box = $('#graphKeywordList');
    const source = $('#graphKeywordSource');
    const hint = $('#graphKeywordSuggestions');
    if (!box || !source) return;
    graphSuggestions = payload.suggestions || [];
    if (Array.isArray(payload.configured)) {
      box.value = payload.configured.join(', ');
      source.textContent = payload.configured.length
        ? `当前使用你固定的 ${payload.configured.length} 个关键词。`
        : '当前明确不使用额外关键词，只用内置领域正则。';
    } else {
      box.value = '';
      source.textContent = `当前自动从语料推导（${payload.corpus?.papers || 0} 篇 / ${payload.corpus?.chunks || 0} 块），本次会用 ${payload.effective?.length || 0} 个词。`;
    }
    // Candidates are ranked by how many distinct papers use them, so the head
    // of the list is the corpus's shared vocabulary rather than one paper's.
    hint.textContent = graphSuggestions.length
      ? `语料候选（按出现在多少篇论文里排序）：${graphSuggestions.slice(0, 12).map((item) => `${item.term}(${item.papers}篇)`).join('、')}${graphSuggestions.length > 12 ? ' …' : ''}`
      : (payload.corpus?.note || '语料里没有找到可建议的候选词。');
  };

  const loadGraphKeywords = async () => {
    try { renderGraphKeywords(await bridgeFetch('/v1/rag/graph/keywords')); }
    catch (error) {
      const source = $('#graphKeywordSource');
      if (source) source.textContent = `读取关键词失败：${error.message}`;
    }
  };

  const saveGraphKeywords = async (keywords) => {
    const payload = await bridgeFetch('/v1/rag/graph/keywords', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ keywords }),
    });
    await loadGraphKeywords();
    return payload;
  };

  $('#saveGraphKeywords')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const keywords = parseKeywordInput($('#graphKeywordList')?.value);
      const payload = await saveGraphKeywords(keywords);
      setStatus(keywords.length
        ? `已固定 ${payload.configured.length} 个关键词。`
        : '已设为不使用额外关键词（只用内置正则）。想恢复自动推导请点「恢复自动推导」。');
    } catch (error) { setStatus(`保存关键词失败：${error.message}`); }
    finally { button.disabled = false; }
  });

  $('#adoptGraphSuggestions')?.addEventListener('click', () => {
    if (!graphSuggestions.length) { setStatus('暂无可采纳的语料建议。'); return; }
    const box = $('#graphKeywordList');
    const existing = parseKeywordInput(box.value);
    const merged = [...new Set([...existing, ...graphSuggestions.map((item) => item.term)])];
    box.value = merged.join(', ');
    // Filled in but not saved: the candidate list contains author names and
    // journal abbreviations that survive the filters, and the researcher is
    // the only one who can tell those from real domain terms.
    setStatus(`已填入 ${merged.length} 个候选词，请删掉不需要的（作者名、期刊缩写等）后再点「保存关键词」。`);
  });

  $('#resetGraphKeywords')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const payload = await saveGraphKeywords(null);
      setStatus(`已恢复自动推导，本次会用 ${payload.effective.length} 个从语料推导的词。`);
    } catch (error) { setStatus(`恢复失败：${error.message}`); }
    finally { button.disabled = false; }
  });

  $('#previewRagGraph')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    setStatus('正在从 RAG chunks 预演知识图谱…');
    try {
      const response = await bridgeFetch('/v1/rag/graph', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ limit: 50 }) });
      const graph = response.manifest?.graph?.graph;
      const kw = response.keywords || {};
      const origin = { derived: '自动从语料推导', configured: '你固定的', request: '本次指定的', unavailable: '（读不到语料，未使用）' }[kw.source] || kw.source;
      setStatus(`知识图谱预演完成：${graph?.papers?.length || 0} 篇论文、${graph?.entities?.length || 0} 个实体、${graph?.edges?.length || 0} 条可定位 MENTIONS；关键词为${origin} ${kw.used?.length || 0} 个；未写入 Vault。`);
      await loadGraphKeywords();
    } catch (error) { setStatus(`知识图谱预演失败：${error.message}`); }
    finally { button.disabled = false; }
  });
})();
