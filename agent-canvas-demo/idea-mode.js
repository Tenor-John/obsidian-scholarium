/* idea-mode.js — Idea 模式入口 UI（M2）。
 *
 * 流程：主题 → /v1/literature/search 真实检索 → 本机 Agent 综合（只读）→
 * 候选问题/假设勾选卡 → /v1/drafts/batch 预览 → 确认写入。全程两段确认，
 * 不确认一个字节都不会落盘；落盘的笔记一律 created_by: ai /
 * review_status: pending，等待研究者审阅后才算数。
 *
 * 依赖 bridge-ui.js 暴露的全局：bridgeFetch, zhiyanBridge, connectBridge,
 * rehearsalAgent, waitTask, scholariumStateFetch, safeHtml, workspaceRoot。
 * 检索与综合两步可通过 window.weaverIdeaMode._search / _synthesize 注入替身
 * （端到端测试用，避免真实外网与真实 Agent）。
 */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const entryBtn = $('#ideaModeBtn');
  if (!entryBtn) return;

  const Core = () => window.weaverIdeaModeCore;

  /* ------------------------------------------------------------ dialog -- */

  function ensureDialog() {
    let dialog = $('#ideaModeDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'ideaModeDialog';
    dialog.className = 'registry-dialog pipeline-topic-dialog idea-mode-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="pipeline-topic-form" onsubmit="return false">
        <div class="run-header">
          <div><span class="eyebrow">IDEA MODE</span><h2>Idea 侦察：检索 → 总结 → 候选笔记</h2></div>
          <button type="button" class="pipeline-topic-close" aria-label="关闭">×</button>
        </div>
        <div class="pipeline-topic-body">
          <label>想侦察的主题<textarea id="ideaTopicInput" rows="3" placeholder="例如：单原子光催化剂中金属-载体强相互作用对 CO2 还原选择性的影响"></textarea></label>
          <label>检索记录上限
            <select id="ideaRecordCount">
              <option value="10">10 条（快）</option>
              <option value="20" selected>20 条（均衡）</option>
              <option value="30">30 条（全面但慢）</option>
            </select>
          </label>
          <p class="wv-faint">先用真实检索拿到记录，再让 Agent 只基于这些记录综合。产出只是草稿：问题/假设笔记全部标记 created_by: ai、review_status: pending，写入前你要逐条勾选并两次确认。</p>
          <div class="idea-mode-status wv-faint" id="ideaModeStatus"></div>
          <div class="idea-mode-results" id="ideaModeResults" hidden></div>
        </div>
        <footer class="pipeline-topic-actions">
          <button type="button" class="button ghost idea-cancel">取消</button>
          <button type="button" class="button primary" id="ideaRunBtn">开始侦察</button>
          <button type="button" class="button primary" id="ideaPreviewBtn" hidden>预览选中笔记</button>
          <button type="button" class="button primary" id="ideaCommitBtn" hidden>确认写入</button>
        </footer>
      </form>`;
    document.body.appendChild(dialog);
    return dialog;
  }

  let busy = false;
  let state = {
    topic: '', records: [], summary: '', hotspots: [], gaps: [],
    questions: [], hypotheses: [],
    batchId: null, paths: [],
  };

  const status = (text) => { const el = $('#ideaModeStatus'); if (el) el.innerHTML = text; };
  const toast = (text) => window.researchWeaver?.toast?.(text);

  function setPhase(phase) {
    $('#ideaRunBtn').hidden = phase !== 'input';
    $('#ideaPreviewBtn').hidden = phase !== 'proposal';
    $('#ideaCommitBtn').hidden = phase !== 'preview';
    $('#ideaRunBtn').disabled = busy;
    $('#ideaPreviewBtn').disabled = busy;
    $('#ideaCommitBtn').disabled = busy;
  }

  /* ----------------------------------------------------------- pipeline -- */

  async function realSearch(topic, limit) {
    const response = await bridgeFetch('/v1/literature/search', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: workspaceRoot, query: topic }),
    });
    return (response.manifest?.records || []).slice(0, limit);
  }

  async function ragLookup(topic) {
    const response = await bridgeFetch('/v1/rag/query', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: topic, k: 5 }),
    });
    return response.manifest?.results || [];
  }

  async function realSynthesize(topic, records, corpus = []) {
    const agentId = rehearsalAgent();
    if (!agentId) throw new Error('没有可用的已安装 Agent CLI。');
    const prompt = Core().buildIdeaPrompt({ topic, records, corpus });
    const created = await bridgeFetch('/v1/tasks', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId, cwd: workspaceRoot, prompt, permission: 'read', execute: true }),
    });
    if (!created?.id) throw new Error('Bridge 未返回任务 ID。');
    return waitTask(created.id);
  }

  async function runRecon() {
    const topic = ($('#ideaTopicInput')?.value || '').trim();
    if (!topic) { status('<span class="error">请先写明要侦察的主题。</span>'); return; }
    if (!zhiyanBridge.online) { await connectBridge(true); if (!zhiyanBridge.online) { status('<span class="error">Bridge 未连接。</span>'); return; } }
    const limit = Number($('#ideaRecordCount')?.value) || 20;
    busy = true; setPhase('input');
    state = { topic, records: [], summary: '', hotspots: [], gaps: [], questions: [], hypotheses: [], batchId: null, paths: [] };
    try {
      status('第 1/3 步：正在检索开放文献…');
      const search = window.weaverIdeaMode._search || realSearch;
      state.records = await search(topic, limit);
      if (!state.records.length) { status('<span class="error">检索没有命中任何记录，换个主题写法试试。</span>'); return; }

      status(`第 2/3 步：检索到 ${state.records.length} 条在线记录，正在查你的文献库…`);
      let corpus = [];
      try { corpus = await ragLookup(topic); } catch { /* RAG 不可用时只用在线记录综合 */ }
      status(`第 2/3 步：${state.records.length} 条在线记录 + 文献库命中 ${corpus.length} 段，Agent 正在综合（可能需要几分钟）…`);
      const synthesize = window.weaverIdeaMode._synthesize || realSynthesize;
      const raw = await synthesize(topic, state.records, corpus);

      status('第 3/3 步：校验综合结果…');
      const parsed = Core().parseIdeaReply(raw);
      if (!parsed.ok) {
        status(`<span class="error">综合结果未通过校验：${safeHtml(parsed.error)}</span>`);
        return;
      }
      state.summary = parsed.summary;
      state.hotspots = parsed.hotspots || [];
      state.gaps = parsed.gaps || [];
      state.questions = parsed.questions.map((q) => ({ ...q, checked: true }));
      state.hypotheses = parsed.hypotheses.map((h) => ({ ...h, checked: true }));
      renderProposal(parsed.dropped || []);
      setPhase('proposal');
      status(`综合完成：${state.questions.length} 个问题 · ${state.hypotheses.length} 条假设。勾选后要预览笔记。`);
    } catch (error) {
      status(`<span class="error">侦察失败：${safeHtml(error.message)}</span>`);
    } finally {
      busy = false; setPhase($('#ideaModeResults').hidden ? 'input' : (state.batchId ? 'preview' : 'proposal'));
    }
  }

  /* ----------------------------------------------------------- proposal -- */

  function itemRow(kind, index, item) {
    return `<label class="idea-item">
      <input type="checkbox" data-kind="${kind}" data-index="${index}" ${item.checked ? 'checked' : ''} />
      <span class="idea-item-body"><b>${safeHtml(item.statement)}</b>${item.note ? `<small>${safeHtml(item.note)}</small>` : ''}</span>
    </label>`;
  }

  function renderProposal(dropped) {
    const box = $('#ideaModeResults');
    const q = state.questions.map((item, i) => itemRow('q', i, item)).join('');
    const h = state.hypotheses.map((item, i) => itemRow('h', i, item)).join('');
    const chips = (list) => list.map((s) => `<span class="idea-chip">${safeHtml(s)}</span>`).join('');
    box.innerHTML = `
      <div class="idea-summary"><b>侦察总结</b><p>${safeHtml(state.summary)}</p></div>
      ${state.hotspots.length ? `<div class="idea-summary"><b>研究热点</b><div class="idea-chip-row">${chips(state.hotspots)}</div></div>` : ''}
      ${state.gaps.length ? `<div class="idea-summary"><b>明显空白点</b><div class="idea-chip-row">${chips(state.gaps)}</div></div>` : ''}
      <p class="wv-faint">这次综合会先落一张 Idea 卡片（可在「Idea 卡片」标签页浏览/搁置），下面勾选的问题/假设会作为草稿笔记一起写入。</p>
      ${dropped.length ? `<p class="wv-faint">${dropped.map(safeHtml).join('；')}</p>` : ''}
      ${q ? `<div class="wv-sect-label">候选问题（${state.questions.length}）</div>${q}` : ''}
      ${h ? `<div class="wv-sect-label">候选假设（${state.hypotheses.length}）</div>${h}` : ''}`;
    box.hidden = false;
    box.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const list = cb.dataset.kind === 'q' ? state.questions : state.hypotheses;
        list[Number(cb.dataset.index)].checked = cb.checked;
      });
    });
  }

  /* ------------------------------------------------- preview and commit -- */

  async function collectExistingIds() {
    const ids = [];
    const list = (await scholariumStateFetch('project.list')).result || { projects: [] };
    for (const p of list.projects || []) {
      try {
        const detail = (await scholariumStateFetch('project.get', { display_id: p.display_id })).result;
        for (const x of detail.hypotheses || []) ids.push(x.display_id);
        for (const x of detail.questions || []) ids.push(x.display_id);
      } catch { /* 单个课题读取失败不阻塞编号分配 */ }
    }
    try {
      const ideaList = (await scholariumStateFetch('idea.list')).result || { ideas: [] };
      for (const idea of ideaList.ideas || []) ids.push(idea.display_id);
    } catch { /* idea.list 不可用（例如白名单未刷新）时不阻塞编号分配，只是可能撞号后走 409 重试 */ }
    return ids.filter(Boolean);
  }

  // 每次侦察恒生成一张 Idea 卡片；勾选的问题/假设作为同一批次一起写入，
  // 整批原子提交——不存在"卡片写了、草稿没写"的中间态。
  function selectedItems(existingIds) {
    const core = Core();
    const card = core.buildIdeaCard({
      topic: state.topic,
      summary: state.summary,
      hotspots: state.hotspots,
      gaps: state.gaps,
      records: state.records,
      existingIds,
    });
    const notes = core.buildIdeaNotes({
      topic: state.topic,
      summary: state.summary,
      questions: state.questions.filter((q) => q.checked),
      hypotheses: state.hypotheses.filter((h) => h.checked),
      existingIds: [...existingIds, card.displayId],
      records: state.records,
    });
    return [{ path: card.path, content: card.content }, ...notes];
  }

  async function previewNotes() {
    const items0 = selectedItems(await collectExistingIds());
    if (!items0.length) { status('<span class="error">没有勾选任何问题或假设。</span>'); return; }
    busy = true; setPhase('proposal');
    try {
      status('正在生成笔记预览（整批校验，任一冲突即整批拒绝）…');
      let res = await bridgeFetch('/v1/drafts/batch', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ base: 'scholarium-vault', items: items0 }),
      }).catch(async (err) => {
        // 编号撞车（409）：重新收集编号再试一次
        if (!/already exists|409/.test(err.message)) throw err;
        const retry = selectedItems(await collectExistingIds());
        return bridgeFetch('/v1/drafts/batch', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ base: 'scholarium-vault', items: retry }),
        });
      });
      state.batchId = res.id;
      state.paths = (res.items || []).map((item) => item.path);
      const box = $('#ideaModeResults');
      box.innerHTML = `<div class="idea-summary"><b>预览通过，将写入 ${state.paths.length} 个笔记：</b>
        <ul class="idea-paths">${state.paths.map((p) => `<li class="wv-mono">${safeHtml(p)}</li>`).join('')}</ul>
        <p class="wv-faint">确认后整批写入（全部成功或全部不写）。写入后仍需你在笔记里逐条审阅并把 review_status 改为 confirmed。</p></div>`;
      box.hidden = false;
      setPhase('preview');
      status('预览就绪。确认写入前可以再回到上一步修改勾选。');
    } catch (error) {
      status(`<span class="error">预览被拒绝：${safeHtml(error.message)}</span>`);
    } finally { busy = false; setPhase(state.batchId ? 'preview' : 'proposal'); }
  }

  async function commitNotes() {
    if (!state.batchId) return;
    busy = true; setPhase('preview');
    try {
      await bridgeFetch(`/v1/drafts/batch/${state.batchId}/commit`, { method: 'POST' });
      toast(`Idea 笔记已写入 ${state.paths.length} 个文件（含 1 张 Idea 卡片），等待你的审阅。`);
      $('#ideaModeDialog')?.close();
      window.weaverIdeaTree?.refresh?.();
      window.weaverIdeaList?.refresh?.();
      state = { topic: '', records: [], summary: '', hotspots: [], gaps: [], questions: [], hypotheses: [], batchId: null, paths: [] };
    } catch (error) {
      status(`<span class="error">写入失败（整批已回滚，未留下半个批次）：${safeHtml(error.message)}</span>`);
    } finally { busy = false; setPhase('preview'); }
  }

  /* -------------------------------------------------------------- wiring -- */

  entryBtn.addEventListener('click', () => {
    const dialog = ensureDialog();
    // 每次打开都回到输入阶段，但保留上次主题方便微调后再跑。
    $('#ideaModeResults').hidden = true;
    status('');
    state.batchId = null;
    setPhase('input');
    dialog.showModal();
    $('#ideaTopicInput')?.focus();
    dialog.querySelector('.pipeline-topic-close').onclick = () => dialog.close();
    dialog.querySelector('.idea-cancel').onclick = () => dialog.close();
    $('#ideaRunBtn').onclick = runRecon;
    $('#ideaPreviewBtn').onclick = previewNotes;
    $('#ideaCommitBtn').onclick = commitNotes;
  });

  window.weaverIdeaMode = { _search: null, _synthesize: null };
})();
