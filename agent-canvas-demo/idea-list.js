/* idea-list.js — Idea 卡片列表页（M2 §5.1/§7.1）：右栏第四个 tab。
 *
 * 消费只读 idea.list（GET /v1/scholarium/state?action=idea.list），一张卡
 * 一个 schema-v1 idea 对象的摘要。唯一的写操作是"搁置"/"重新探索"，直接调
 * POST /v1/ideas/:displayId/status handles exploring<->shelved. M3 adds a
 * separate preview->commit transaction for promotion because creating the
 * PRJ, profile v0 and backlink must be all-or-nothing.
 */
(() => {
  const $ = (selector) => document.querySelector(selector);

  const cardsEl = $('#ideaListCards');
  const overlayEl = $('#ideaListOverlay');
  const filtersEl = $('#ideaListFilters');
  const refreshBtn = $('#ideaListRefresh');
  if (!cardsEl) return;

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  const STATUS_LABEL = { exploring: '探索中', promoted: '已升级', shelved: '已搁置' };

  let loaded = false;
  let loading = false;
  let ideas = [];
  let activeFilter = 'all';

  function stateFetch(action, input) {
    const query = new URLSearchParams({ action });
    if (input) query.set('input', JSON.stringify(input));
    return bridgeFetch(`/v1/scholarium/state?${query.toString()}`);
  }

  function showOverlay(text, isError = false) {
    overlayEl.textContent = text;
    overlayEl.classList.toggle('error', isError);
    overlayEl.hidden = false;
    cardsEl.hidden = true;
  }

  function hideOverlay() {
    overlayEl.hidden = true;
    cardsEl.hidden = false;
  }

  async function load() {
    if (!zhiyanBridge.online) {
      showOverlay('Bridge 未连接。先点左下角「检查本机 Bridge」，再回来刷新。');
      return;
    }
    showOverlay('正在读取 Idea 卡片…');
    try {
      const res = (await stateFetch('idea.list')).result || { ideas: [] };
      ideas = res.ideas || [];
      if (!ideas.length) { showOverlay('还没有 Idea 卡片。用「新 Idea」侦察一个主题，综合完成后会在这里先落一张卡片。'); return; }
      render();
      hideOverlay();
    } catch (error) {
      showOverlay(`Idea 卡片读取失败：${error.message}`, true);
    }
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    try { await load(); } finally { loading = false; }
  }

  function matches(idea) {
    return activeFilter === 'all' || idea.status === activeFilter;
  }

  function render() {
    const visible = ideas.filter(matches);
    if (!visible.length) {
      cardsEl.innerHTML = `<p class="wv-empty">没有符合筛选条件的 Idea 卡片。</p>`;
      return;
    }
    cardsEl.innerHTML = visible.map((idea) => {
      const chips = (list, cls) => (list || []).slice(0, 6).map((s) => `<span class="idea-chip ${cls}">${esc(s)}</span>`).join('');
      const canToggle = idea.status === 'exploring' || idea.status === 'shelved';
      const toggleTo = idea.status === 'shelved' ? 'exploring' : 'shelved';
      const toggleLabel = idea.status === 'shelved' ? '重新探索' : '搁置';
      const promote = idea.status === 'exploring'
        ? `<button class="wv-linkbtn idea-list-promote" data-id="${esc(idea.display_id)}">升级为课题</button>`
        : (idea.status === 'promoted' ? `<span class="idea-promoted-link">${esc(idea.promoted_to || '已创建课题')}</span>` : '');
      return `
        <article class="idea-list-card" data-id="${esc(idea.display_id)}">
          <div class="idea-list-card-head">
            <b>${esc(idea.title)}</b>
            <span class="idea-status-badge idea-status-${esc(idea.status)}">${esc(STATUS_LABEL[idea.status] || idea.status)}</span>
          </div>
          <p class="wv-faint idea-list-card-summary">${esc(idea.summary)}</p>
          ${idea.hotspots?.length ? `<div class="idea-chip-row">${chips(idea.hotspots, 'idea-chip-hotspot')}</div>` : ''}
          ${idea.gaps?.length ? `<div class="idea-chip-row">${chips(idea.gaps, 'idea-chip-gap')}</div>` : ''}
          ${idea.key_papers?.length ? `<p class="wv-faint wv-mono idea-list-card-papers">关键文献：${idea.key_papers.map(esc).join(' · ')}</p>` : ''}
          <div class="idea-list-card-foot">
            <span class="wv-faint wv-mono">${esc(idea.display_id)} · ${esc(idea.path)}</span>
            <span class="idea-list-actions">${promote}${canToggle ? `<button class="wv-linkbtn idea-list-toggle" data-to="${toggleTo}" data-id="${esc(idea.display_id)}">${toggleLabel}</button>` : ''}</span>
          </div>
        </article>`;
    }).join('');
    cardsEl.querySelectorAll('.idea-list-toggle').forEach((btn) => {
      btn.addEventListener('click', () => setStatus(btn.dataset.id, btn.dataset.to, btn));
    });
    cardsEl.querySelectorAll('.idea-list-promote').forEach((btn) => {
      btn.addEventListener('click', () => promoteIdea(btn.dataset.id, btn));
    });
  }

  function ensurePromoteDialog() {
    let dialog = $('#ideaPromoteDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'ideaPromoteDialog';
    dialog.className = 'pipeline-topic-dialog idea-promote-dialog';
    dialog.innerHTML = `<form method="dialog" class="pipeline-topic-body">
      <header><div><span class="eyebrow">M3 · P0</span><h2>升级为正式课题</h2></div><button type="button" class="pipeline-topic-close" aria-label="关闭">×</button></header>
      <p class="wv-faint">以下内容将写入课题画像 v0。提交前还会展示 PRJ 编号和实际文件路径。</p>
      <label>课题标题<input name="title" maxlength="300" required></label>
      <label>核心研究问题<textarea name="research_question" rows="3" maxlength="600" required></textarea></label>
      <label>研究边界：要做什么<textarea name="boundaries_do" rows="3" placeholder="每行一项"></textarea></label>
      <label>研究边界：明确不做什么<textarea name="boundaries_dont" rows="3" placeholder="每行一项"></textarea></label>
      <label>已知约束<textarea name="constraints" rows="3" placeholder="仪器、经费、时间；每行一项"></textarea></label>
      <label>成功标准<textarea name="success_criteria" rows="3" maxlength="800" required></textarea></label>
      <footer><button type="button" class="button ghost idea-promote-cancel">取消</button><button type="submit" class="button primary">生成升级预览</button></footer>
    </form>`;
    document.body.appendChild(dialog);
    return dialog;
  }

  function collectPromotionProfile(idea) {
    const dialog = ensurePromoteDialog();
    const form = dialog.querySelector('form');
    form.elements.title.value = idea.title || '';
    form.elements.research_question.value = idea.title || '';
    form.elements.boundaries_do.value = (idea.hotspots || []).join('\n');
    form.elements.boundaries_dont.value = '';
    form.elements.constraints.value = '';
    form.elements.success_criteria.value = '在进入实验设计前补充可量化、可证伪的成功标准。';
    return new Promise((resolve) => {
      const finish = (value) => { cleanup(); if (dialog.open) dialog.close(); resolve(value); };
      const submit = (event) => {
        event.preventDefault();
        const lines = (name) => form.elements[name].value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        finish({
          title: form.elements.title.value.trim(),
          research_question: form.elements.research_question.value.trim(),
          boundaries_do: lines('boundaries_do'), boundaries_dont: lines('boundaries_dont'),
          constraints: lines('constraints'), success_criteria: form.elements.success_criteria.value.trim(),
        });
      };
      const cancel = () => finish(null);
      const cleanup = () => {
        form.removeEventListener('submit', submit);
        dialog.querySelector('.pipeline-topic-close').removeEventListener('click', cancel);
        dialog.querySelector('.idea-promote-cancel').removeEventListener('click', cancel);
        dialog.removeEventListener('cancel', cancel);
      };
      form.addEventListener('submit', submit);
      dialog.querySelector('.pipeline-topic-close').addEventListener('click', cancel);
      dialog.querySelector('.idea-promote-cancel').addEventListener('click', cancel);
      dialog.addEventListener('cancel', cancel);
      dialog.showModal();
      form.elements.title.focus();
    });
  }

  async function promoteIdea(displayId, btn) {
    const idea = ideas.find((item) => item.display_id === displayId);
    if (!idea) return;
    const profile = await collectPromotionProfile(idea);
    if (!profile) return;
    btn.disabled = true;
    btn.textContent = '生成预览…';
    try {
      const preview = await bridgeFetch(`/v1/ideas/${encodeURIComponent(displayId)}/promote/preview`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ profile }),
      });
      if (preview.alreadyPromoted) { await refresh(); return; }
      const message = `将执行一次原子升级：\n\n${displayId} → ${preview.project.display_id}\n课题：${preview.paths.project}\n画像：${preview.paths.profile}\n\n确认后会同时创建两个文件并回填 Idea；任何一步失败都会回滚。是否继续？`;
      if (!window.confirm(message)) return;
      btn.textContent = '正在升级…';
      const committed = await bridgeFetch(`/v1/ideas/${encodeURIComponent(displayId)}/promote/commit`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ previewId: preview.id }),
      });
      window.researchWeaver?.toast?.(`${displayId} 已升级为 ${committed.project.display_id}，课题画像 v0 已创建。`);
      await refresh();
      window.dispatchEvent(new CustomEvent('scholarium:project-created', { detail: committed.project }));
    } catch (error) {
      window.researchWeaver?.toast?.(`升级课题失败：${error.message}`);
    } finally {
      if (btn.isConnected) { btn.disabled = false; btn.textContent = '升级为课题'; }
    }
  }

  async function setStatus(displayId, target, btn) {
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '处理中…';
    try {
      await bridgeFetch(`/v1/ideas/${encodeURIComponent(displayId)}/status`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: target }),
      });
      await refresh();
    } catch (error) {
      window.researchWeaver?.toast?.(`更新状态失败：${error.message}`);
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  filtersEl?.querySelectorAll('.wv-filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      filtersEl.querySelectorAll('.wv-filter-pill').forEach((p) => p.classList.remove('is-active'));
      pill.classList.add('is-active');
      activeFilter = pill.dataset.filter || 'all';
      if (ideas.length) render();
    });
  });

  refreshBtn?.addEventListener('click', refresh);

  window.weaverIdeaList = {
    ensureLoaded() {
      if (loaded) return;
      loaded = true;
      refresh();
    },
    refresh,
  };
})();
