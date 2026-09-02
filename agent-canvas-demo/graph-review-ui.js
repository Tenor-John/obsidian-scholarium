/* graph-review-ui.js — 知识图谱审核发布车道。
 *
 * Agent 只负责交付一份 GraphDraft（语义抽取 + 只读投影合并，不写任何文件）；
 * 研究者在这个弹窗里逐节点/逐边编辑、勾选，确认后才走版本化 preview→confirm
 * 发布。全程复用已有机制：
 *   - 语义抽取：bridge-ui.js 已有的 requestAgentKnowledgeGraph()（只读 Agent
 *     调用 + knowledge-graph-core.js 的 parseGraphReply），不改动。
 *   - 只读投影：graph-projection-core.js 的 buildProjectGraphProjection()。
 *   - 校验预览：render_graph.py 的 --dry-run 模式，通过既有 /v1/skill-runs
 *     机制派发——不在浏览器里重新实现一遍 quote 校验。
 *   - 版本化发布：新增的 /v1/knowledge-graph/publish/preview|:id/commit
 *     两段绑定（不是 /v1/drafts/batch，产物不是 schema-v1 的 .md 对象）。
 * 不新增权限车道、不新增 vault schema 类型。
 */
(() => {
  const ProjectionCore = () => window.weaverGraphProjectionCore;

  function toast(message) { window.researchWeaver?.toast?.(message); }

  function ensureDialog() {
    let dialog = document.querySelector('#graphReviewDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'graphReviewDialog';
    dialog.className = 'registry-dialog pipeline-topic-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="pipeline-topic-form" onsubmit="return false">
        <div class="run-header">
          <div><span class="eyebrow">GRAPH REVIEW · P2</span><h2>知识图谱审核发布</h2></div>
          <button type="button" class="pipeline-topic-close" aria-label="关闭">×</button>
        </div>
        <div class="pipeline-topic-body" data-body></div>
        <footer class="pipeline-topic-actions" data-actions></footer>
      </form>`;
    document.body.appendChild(dialog);
    dialog.querySelector('.pipeline-topic-close').onclick = () => dialog.close();
    return dialog;
  }

  function setStage(dialog, html, actionsHtml) {
    dialog.querySelector('[data-body]').innerHTML = html;
    dialog.querySelector('[data-actions]').innerHTML = actionsHtml;
  }

  function safeAttr(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  /* dry-run 审核弹窗是只读、交互式的：不能让它被 Agent 的长任务卡住。
   * requestAgentKnowledgeGraph() 内部复用 bridge-ui.js 的 waitTask()，那是
   * 为多阶段工作流设计的 15 分钟安全窗口，对这里的“先看一眼投影”场景太长。
   * 用 Promise.race 加一层本弹窗专属的短超时；原始请求仍在后台跑完（只读，
   * 不写文件，无副作用可言），只是审核流程不再等它。超时和失败一样，都走
   * 同一条“降级为纯 Project/EXP 投影”的路径，不阻塞、不新增状态分支。 */
  const SEMANTIC_EXTRACTION_TIMEOUT_MS = 60000;

  function withTimeout(promise, ms, message) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
    ]);
  }

  /* 自带的轻量 skill-run 轮询：不复用 bridge-ui.js 的 runPipelineSkill()，
   * 因为那个函数绑定了 activeRunControl/运行对话框那一整套"运行中"面板状态，
   * 本弹窗是独立的简单 <dialog>，不应该、也不需要牵扯那套单例状态。 */
  async function dispatchSkillRun(slug, payload) {
    const skills = (await bridgeFetch('/v1/skills')).skills;
    const skillId = pipelineSkillId(skills, slug);
    const created = await bridgeFetch('/v1/skill-runs', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillId, workspace: workspaceRoot, input: JSON.stringify(payload) }),
    });
    for (let attempt = 0; attempt < 200; attempt++) {
      const run = await bridgeFetch(`/v1/skill-runs/${created.id}`);
      if (run.status === 'completed') return run.output;
      if (run.status === 'failed') throw new Error(run.error || `${slug} 执行失败`);
      if (run.status === 'cancelled') throw new Error(`${slug} 已取消`);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error(`等待 ${slug} 超时`);
  }

  async function project(displayId) {
    return (await scholariumStateFetch('project.get', { display_id: displayId })).result;
  }

  /* ---------- 阶段 0：来源包（证据卡语义抽取 + Project/EXP 只读投影） ---------- */

  async function openGraphReviewDialog(displayId) {
    const dialog = ensureDialog();
    dialog.showModal();
    const state = { displayId, project: null, graphDraft: null, dryRunGraph: null };
    setStage(dialog, '<p class="wv-faint">正在读取课题…</p>', '');
    try {
      state.project = await project(displayId);
    } catch (error) {
      setStage(dialog, `<p class="error">读取课题失败：${safeHtml(error.message)}</p>`, '<button type="button" class="button ghost" data-action="close">关闭</button>');
      dialog.querySelector('[data-action="close"]').onclick = () => dialog.close();
      return;
    }
    setStage(dialog, `
      <p>课题：<b>${safeHtml(state.project.project?.display_id || displayId)}</b> · ${safeHtml(state.project.project?.title || '')}</p>
      <p class="wv-faint">将读取受限来源包（本课题证据卡 + 已存在的 Project/Experiment 只读投影），派发只读 Agent 生成图谱草案；此步骤不写入任何文件。</p>
    `, `
      <button type="button" class="button ghost" data-action="cancel">取消</button>
      <button type="button" class="button primary" data-action="start">生成图谱草案</button>
    `);
    dialog.querySelector('[data-action="cancel"]').onclick = () => dialog.close();
    dialog.querySelector('[data-action="start"]').onclick = async () => {
      const startBtn = dialog.querySelector('[data-action="start"]');
      startBtn.disabled = true; startBtn.textContent = '生成中…';
      try {
        await buildDraft(dialog, state);
      } catch (error) {
        toast(`图谱草案生成失败：${error.message}`);
      } finally { startBtn.disabled = false; startBtn.textContent = '生成图谱草案'; }
    };
  }

  async function buildDraft(dialog, state) {
    const question = state.project.project?.research_question || state.project.project?.thesis || state.project.project?.title || '';

    /* 之前这里直接把 cards 传 null：语义抽取 prompt 里的"本轮证据卡片"永远是
     * 空数组，Agent 完全看不到文献流水线已经抓取并做成 literature/evidence-
     * cards 的论文摘录，只能凭课题标题/问题空想。/v1/knowledge-graph/evidence
     * 这个只读接口本来就是为这个场景准备的（generateSemanticKnowledgeGraph()
     * 已经在用），这里补上同样的检索，语义抽取才有真实来源可引。 */
    setStage(dialog, '<p class="wv-faint">正在检索本课题相关的文献证据卡片（只读，来自文献流水线已生成的 literature/evidence-cards）…</p>', '');
    let evidenceCards = [];
    try {
      const evidence = await bridgeFetch(`/v1/knowledge-graph/evidence?query=${encodeURIComponent(question)}`);
      evidenceCards = Array.isArray(evidence.cards) ? evidence.cards : [];
    } catch (error) {
      toast(`文献证据卡检索失败，语义抽取将仅依据课题问题本身：${error.message}`);
    }

    setStage(dialog, `<p class="wv-faint">Agent 正在只读分析${evidenceCards.length ? `${evidenceCards.length} 张文献证据卡片 + ` : ''}课题信息（不写入任何文件；最多等待 ${SEMANTIC_EXTRACTION_TIMEOUT_MS / 1000}s，超时自动降级为只读投影）…</p>`, '');
    let semanticGraph = null;
    try {
      semanticGraph = await withTimeout(
        requestAgentKnowledgeGraph(question, evidenceCards),
        SEMANTIC_EXTRACTION_TIMEOUT_MS,
        `语义抽取超过 ${SEMANTIC_EXTRACTION_TIMEOUT_MS / 1000}s 未返回`,
      );
    } catch (error) {
      toast(`语义抽取超时/失败，仅使用课题自身的 Project/Experiment 投影：${error.message}`);
    }

    setStage(dialog, '<p class="wv-faint">正在读取本课题已有的 Project/Experiment 对象（只读投影）…</p>', '');
    const objects = await bridgeFetch(`/v1/knowledge-graph/project-objects?display_id=${encodeURIComponent(state.displayId)}`);
    const projection = ProjectionCore().buildProjectGraphProjection({ project: objects.project, experiments: objects.experiments });
    const merged = ProjectionCore().mergeGraphDrafts(semanticGraph || {}, projection);
    if (!merged.nodes.length) {
      setStage(dialog, '<p>没有可用于生成图谱的节点——既没有语义抽取结果，本课题也没有已结题的 Experiment 记录。</p>', '<button type="button" class="button primary" data-action="close">结束</button>');
      dialog.querySelector('[data-action="close"]').onclick = () => dialog.close();
      return;
    }
    state.graphDraft = merged;

    setStage(dialog, '<p class="wv-faint">正在对草案做只读校验预览（复用渲染器的引文核验，不写入任何文件）…</p>', '');
    const dryRun = await dispatchSkillRun('zrl-knowledge-graph', { graph: merged, dry_run: true, title: merged.title || `${state.project.project?.display_id} 知识图谱` });
    // dispatchSkillRun() returns the Bridge skill-run envelope
    // ({ skill, manifest }), not the renderer manifest directly.
    state.dryRunGraph = dryRun.manifest?.graph;
    if (!state.dryRunGraph) throw new Error('图谱渲染器未返回可审核的 graph 草案');
    renderReviewCards(dialog, state);
  }

  /* ---------- 审阅卡：逐节点/逐边可编辑，Agent 只提供建议 ---------- */

  function renderReviewCards(dialog, state) {
    const graph = state.dryRunGraph;
    const nodeRows = graph.nodes.map((n, i) => `
      <tr data-node="${i}">
        <td><input type="checkbox" data-node-include checked></td>
        <td><input type="text" data-node-label value="${safeAttr(n.label)}"></td>
        <td class="wv-mono">${safeHtml(n.type)}</td>
        <td class="wv-faint">${safeHtml((n.source_refs || []).join(', '))}</td>
      </tr>`).join('');
    const edgeCards = graph.edges.map((e, i) => {
      const source = graph.nodes.find((n) => n.id === e.source);
      const target = graph.nodes.find((n) => n.id === e.target);
      const statusTag = e.review_status === 'supported' ? '<span class="lit-tag ok">✅ supported（quote 已核验）</span>' : '<span class="lit-tag">⚠️ inferred</span>';
      const evidenceLines = (e.evidence || []).map((ev) => `<div class="wv-faint">${safeHtml(ev.source_path || '')}${ev.locator ? ' · ' + safeHtml(ev.locator) : ''}${ev.quote ? '：“' + safeHtml(ev.quote) + '”' : ''}</div>`).join('');
      return `<div class="wv-action-card" data-edge="${i}">
        <p><label><input type="checkbox" data-edge-include checked> ${safeHtml(source?.label || e.source)} → ${safeHtml(target?.label || e.target)}</label> ${statusTag}</p>
        <label>关系<select data-edge-relation>
          ${['contains','prepared_from','treated_by','under_condition','forms','changes','enables','inhibits','measured_by','correlates_with','supports','contradicts','tests','instance_of'].map((r) => `<option value="${r}" ${e.relation === r ? 'selected' : ''}>${r}</option>`).join('')}
        </select></label>
        <label>置信度 <input type="number" data-edge-confidence min="0" max="1" step="0.05" value="${safeAttr(e.confidence ?? 0.5)}"></label>
        ${evidenceLines || '<p class="wv-faint">无来源摘录（等待研究者判断）</p>'}
      </div>`;
    }).join('');
    setStage(dialog, `
      <p class="wv-faint">review_status 由渲染器对每条边的 quote 做过真实核验，直接反映最终发布结果——不是研究者需要另外验证的猜测。取消勾选可整条排除；节点标签、边的关系/置信度可编辑。</p>
      ${graph.warnings?.length ? `<div class="wv-faint">质量警告：${graph.warnings.map(safeHtml).join('；')}</div>` : ''}
      <table class="wv-registry-table"><thead><tr><th></th><th>节点</th><th>类型</th><th>来源</th></tr></thead><tbody>${nodeRows}</tbody></table>
      ${edgeCards}
    `, `
      <button type="button" class="button ghost" data-action="cancel">取消</button>
      <button type="button" class="button primary" data-action="preview">生成发布预览</button>
    `);
    dialog.querySelector('[data-action="cancel"]').onclick = () => dialog.close();
    dialog.querySelector('[data-action="preview"]').onclick = () => previewPublish(dialog, state);
  }

  function collectGraphSelections(dialog, state) {
    const graph = state.dryRunGraph;
    const includedNodeIds = new Set();
    const nodes = [];
    dialog.querySelectorAll('[data-node]').forEach((row) => {
      const i = Number(row.dataset.node);
      const include = row.querySelector('[data-node-include]').checked;
      const original = graph.nodes[i];
      if (!include) return;
      includedNodeIds.add(original.id);
      nodes.push({ ...original, label: row.querySelector('[data-node-label]').value || original.label });
    });
    const edges = [];
    dialog.querySelectorAll('[data-edge]').forEach((card) => {
      const i = Number(card.dataset.edge);
      const include = card.querySelector('[data-edge-include]').checked;
      const original = graph.edges[i];
      if (!include) return;
      if (!includedNodeIds.has(original.source) || !includedNodeIds.has(original.target)) return; // 端点被排除，边不能孤悬
      edges.push({
        ...original,
        relation: card.querySelector('[data-edge-relation]').value,
        confidence: Math.max(0, Math.min(1, Number(card.querySelector('[data-edge-confidence]').value) || 0)),
      });
    });
    return { title: graph.title, research_question: graph.research_question, summary: graph.summary, nodes, edges, warnings: graph.warnings || [] };
  }

  async function previewPublish(dialog, state) {
    const selections = collectGraphSelections(dialog, state);
    if (!selections.nodes.length) return toast('至少保留一个节点。');
    setStage(dialog, `<p class="wv-faint">正在生成发布预览…</p>`, '');
    try {
      const preview = await bridgeFetch('/v1/knowledge-graph/publish/preview', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace: workspaceRoot, project_display_id: state.displayId, graph: selections }),
      });
      state.publishPreview = preview;
      setStage(dialog, `
        <p>即将发布：${preview.nodeCount} 个节点、${preview.edgeCount} 条关系。</p>
        <p class="wv-faint">写入 <span class="wv-mono">${safeHtml(preview.targetDir)}/</span>（knowledge_graph.json/.html/-report.md），不会覆盖当前的 knowledge-graph/knowledge_graph.json；"提升为当前图谱"不在本次流程范围内，需另外手动处理。</p>
      `, `
        <button type="button" class="button ghost" data-action="back">返回编辑</button>
        <button type="button" class="button primary" data-action="commit">确认发布</button>
      `);
      dialog.querySelector('[data-action="back"]').onclick = () => renderReviewCards(dialog, state);
      dialog.querySelector('[data-action="commit"]').onclick = async () => {
        if (!confirm(`将写入 ${preview.targetDir}/ 下的三个文件，确认吗？`)) return;
        try {
          const record = await bridgeFetch(`/v1/knowledge-graph/publish/${preview.id}/commit`, { method: 'POST' });
          toast(`已发布版本化图谱：${record.targetDir}`);
          renderCompletion(dialog, record);
        } catch (error) { toast(`发布失败：${error.message}`); }
      };
    } catch (error) { toast(`生成预览失败：${error.message}`); }
  }

  function renderCompletion(dialog, record) {
    setStage(dialog, `
      <p>已发布版本化图谱：<span class="wv-mono">${safeHtml(record.targetDir)}/</span></p>
      <p class="wv-faint">${record.nodeCount} 个节点、${record.edgeCount} 条关系；当前 knowledge-graph/knowledge_graph.json（若存在）未被覆盖。</p>
    `, `<button type="button" class="button primary" data-action="close">结束</button>`);
    dialog.querySelector('[data-action="close"]').onclick = () => dialog.close();
  }

  window.weaverGraphReview = { openGraphReviewDialog };
})();
