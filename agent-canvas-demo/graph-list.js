/* graph-list.js — 知识图谱标签页：执行追踪器右栏第五个 tab。
 *
 * 只读：列出某课题已发布的历次知识图谱版本（GET /v1/knowledge-graph/
 * publish/list），点击「打开图谱」/「查看报告」直接在新标签页里打开渲染好
 * 的自包含 HTML / Markdown 报告（GET /v1/knowledge-graph/publish/file）——
 * 不用再去 Obsidian 左侧文件树里翻 knowledge-graph/runs/<uuid>/。
 *
 * 不新增任何写入路径：草案生成/审核仍然只走 graph-review-ui.js 的「知识图谱
 * 审核发布」弹窗；这里只读已经落盘的 commit 记录。项目选择器的写法照抄
 * idea-tree.js 的 #ideaTreeProject 模式，卡片列表的写法照抄 idea-list.js。
 */
(() => {
  const $ = (selector) => document.querySelector(selector);

  const cardsEl = $('#graphListCards');
  const overlayEl = $('#graphListOverlay');
  const projectSelect = $('#graphListProject');
  const refreshBtn = $('#graphListRefresh');
  if (!cardsEl) return;

  const esc = (value) =>
    String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let loaded = false;
  let loading = false;

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

  async function loadProjects() {
    if (!zhiyanBridge.online) {
      showOverlay('Bridge 未连接。先点左下角「检查本机 Bridge」，再回来刷新。');
      return;
    }
    showOverlay('正在读取课题注册表…');
    try {
      const list = (await stateFetch('project.list')).result || { projects: [] };
      const projects = list.projects || [];
      const previous = projectSelect.value;
      projectSelect.innerHTML = projects.length
        ? projects.map((p) => `<option value="${esc(p.display_id)}">${esc(p.display_id)} · ${esc(p.title || '未命名课题')}</option>`).join('')
        : '<option value="">（注册表为空）</option>';
      if (!projects.length) { showOverlay('课题注册表为空：Research/Projects/ 下还没有 schema-v1 课题对象。'); return; }
      if (previous && projects.some((p) => p.display_id === previous)) projectSelect.value = previous;
      await loadRuns(projectSelect.value);
    } catch (error) {
      showOverlay(`知识图谱列表读取失败：${error.message}`, true);
    }
  }

  async function loadRuns(displayId) {
    if (!displayId) return;
    showOverlay('正在读取已发布版本…');
    try {
      const { runs } = await bridgeFetch(`/v1/knowledge-graph/publish/list?project_display_id=${encodeURIComponent(displayId)}`);
      if (!runs.length) {
        showOverlay('该课题还没有已发布的知识图谱版本。用课题卡片上的「知识图谱审核发布」生成草案，审核通过并确认发布后会出现在这里。');
        return;
      }
      render(runs);
      hideOverlay();
    } catch (error) {
      showOverlay(`已发布版本读取失败：${error.message}`, true);
    }
  }

  function formatTime(iso) {
    try { return new Date(iso).toLocaleString('zh-CN'); } catch { return iso || ''; }
  }

  function render(runs) {
    cardsEl.innerHTML = runs.map((run) => `
      <article class="idea-list-card" data-id="${esc(run.id)}">
        <div class="idea-list-card-head">
          <b>${esc(formatTime(run.publishedAt))}</b>
          <span class="wv-faint wv-mono">${esc(run.nodeCount ?? '?')} 节点 · ${esc(run.edgeCount ?? '?')} 关系</span>
        </div>
        ${run.warnings?.length ? `<p class="wv-faint">质量警告：${run.warnings.map(esc).join('；')}</p>` : ''}
        <div class="idea-list-card-foot">
          <span class="wv-faint wv-mono">${esc(run.targetDir || '')}</span>
          <span class="idea-list-actions">
            <button type="button" class="wv-linkbtn graph-list-open" data-id="${esc(run.id)}" data-kind="html">打开图谱</button>
            <button type="button" class="wv-linkbtn graph-list-open" data-id="${esc(run.id)}" data-kind="report">查看报告</button>
          </span>
        </div>
      </article>`).join('');
    cardsEl.querySelectorAll('.graph-list-open').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.open(`${zhiyanBridge.url}/v1/knowledge-graph/publish/file?run_id=${encodeURIComponent(btn.dataset.id)}&kind=${encodeURIComponent(btn.dataset.kind)}`, '_blank');
      });
    });
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    try { await loadProjects(); } finally { loading = false; }
  }

  projectSelect?.addEventListener('change', () => loadRuns(projectSelect.value));
  refreshBtn?.addEventListener('click', refresh);

  window.weaverGraphList = {
    ensureLoaded() {
      if (loaded) return;
      loaded = true;
      refresh();
    },
    refresh,
  };
})();
