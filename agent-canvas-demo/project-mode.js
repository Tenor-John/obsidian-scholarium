/* project-mode.js — M3 manual P1-P5 entry points attached to the M1 project
 * registry. P1-P2 reuses the verified literature Pipeline. P3-P5 asks the
 * selected local Agent for bounded JSON, builds schema-valid drafts locally,
 * then uses the existing all-or-nothing drafts/batch confirmation channel. */
(() => {
  const Core = () => window.weaverProjectModeCore;

  function selectedAgent() {
    const selected = window.weaverOrchestrator?.getSelectedAgent?.();
    if (selected && zhiyanBridge.agents.some((a) => a.id === selected && a.installed)) return selected;
    return zhiyanBridge.agents.find((a) => a.id === 'codex' && a.installed)?.id || zhiyanBridge.agents.find((a) => a.installed)?.id || null;
  }

  async function project(displayId) {
    return (await scholariumStateFetch('project.get', { display_id: displayId })).result;
  }

  async function resumablePipelineForProject(project) {
    const history = await bridgeFetch('/v1/history');
    const candidates = (history.pipelines || [])
      .filter((run) => run.resumable && run.workspace === workspaceRoot && String(run.title || '').includes(project.title || ''))
      .sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
    if (!candidates.length) return null;
    const parent = await bridgeFetch(`/v1/pipeline-runs/${encodeURIComponent(candidates[0].id)}`);
    const paths = parent.artifacts?.downloadedPaths || [];
    return paths.length ? parent : null;
  }

  async function runP1P2(displayId, button) {
    button.disabled = true; button.textContent = '准备 Pipeline…';
    try {
      const data = await project(displayId);
      const topic = data.project.research_question || data.project.thesis || data.project.title;
      window.researchWeaver.taskGoal.value = topic;
      const resumable = await resumablePipelineForProject(data.project);
      if (resumable) {
        const pdfCount = resumable.artifacts.downloadedPaths.length;
        const message = `${displayId} 找到一批同工作区的可恢复文献资产：\n\n` +
          `历史运行：${resumable.title}\nPDF：${pdfCount} 篇（路径已由 Bridge 记录）\n恢复点：第 6 步 nature-reader\n\n` +
          '确认后仅复用这批精确 PDF，重建证据卡、文献笔记和 P2 知识图谱；不会重新检索或下载，也不会进入 P3–P5。取消则改走新的 P1 检索。是否复用？';
        if (window.confirm(message)) {
          if (typeof window.resumeScholariumPipelineFromHistory !== 'function') throw new Error('历史 P2 恢复模块未加载；请重载面板后重试');
          button.textContent = '从历史 PDF 恢复 P2…';
          await window.resumeScholariumPipelineFromHistory(resumable);
          window.researchWeaver.toast(`${displayId} 已从受控历史 PDF 恢复到 P2。`);
          return;
        }
      }
      button.textContent = 'Pipeline 运行中…';
      const result = await window.runScholariumResearchPipeline({ topic, stopAfterGraph: true, project: { uid: data.project.uid, display_id: displayId } });
      if (result) window.researchWeaver.toast(`${displayId} 的 P1 文献建档与 P2 知识图谱已完成；确认保留产出后可生成 P3-P5 草案。`);
    } catch (error) {
      window.researchWeaver.toast(`P1-P2 运行失败：${error.message}`);
    } finally { button.disabled = false; button.textContent = '运行 P1–P2 文献与图谱'; }
  }

  async function runP3P5(displayId, button) {
    const agentId = selectedAgent();
    if (!agentId) return window.researchWeaver.toast('没有可用的本地 Agent；请先连接 Bridge 并选择 Codex/Claude。');
    button.disabled = true; button.textContent = '读取课题…';
    try {
      const data = await project(displayId);
      const prompt = Core().buildProjectPlanPrompt(data);
      button.textContent = 'Agent 正在规划…';
      const created = await bridgeFetch('/v1/tasks', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId, cwd: workspaceRoot, prompt, permission: 'read', execute: true }),
      });
      const raw = await waitTask(created.id);
      const parsed = Core().parseProjectPlanReply(raw);
      if (!parsed.ok) throw new Error(parsed.error);
      const allIds = (await scholariumStateFetch('research.ids', { types: ['hypothesis', 'experiment'] })).result?.ids || {};
      const built = Core().buildProjectDrafts({
        project: data.project, parsed,
        existingHypothesisIds: allIds.hypothesis || [],
        existingExperimentIds: allIds.experiment || [],
      });
      button.textContent = '生成写入预览…';
      const preview = await bridgeFetch('/v1/drafts/batch', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ base: 'scholarium-vault', items: built.items }),
      });
      const message = `${displayId} 的首圈草案已经生成：\n\n假设 ${built.hypotheses.length} 条\n实验 ${built.experiments.length} 个\n周计划 ${built.week}\n共写入 ${built.items.length} 个 Markdown 文件\n\n这些内容全部保持 AI 草案/提议状态，不会自动确认 Evidence、启动实验或提交博士工作台。是否写入？`;
      if (!window.confirm(message)) return;
      button.textContent = '正在原子写入…';
      await bridgeFetch(`/v1/drafts/batch/${preview.id}/commit`, { method: 'POST' });
      window.researchWeaver.toast(`${displayId} 的 P3 假设、P4 实验与 P5 周计划草案已写入。`);
      window.dispatchEvent(new CustomEvent('scholarium:project-created', { detail: data.project }));
    } catch (error) {
      window.researchWeaver.toast(`P3-P5 生成失败：${error.message}`);
    } finally { button.disabled = false; button.textContent = '生成 P3–P5 首圈草案'; }
  }

  /* 只读：找这个课题最近一次发布的知识图谱版本，直接在新标签页里打开渲染
   * 好的自包含 HTML 报告——不需要再去 Obsidian 左侧文件树里翻
   * knowledge-graph/runs/<uuid>/ 才能看。列表和打开都走 Bridge 的只读接口
   * （/v1/knowledge-graph/publish/list、/file），不新增任何写入路径。 */
  async function openLatestGraphRun(displayId, button) {
    const original = button.textContent;
    button.disabled = true; button.textContent = '查找已发布版本…';
    try {
      const { runs } = await bridgeFetch(`/v1/knowledge-graph/publish/list?project_display_id=${encodeURIComponent(displayId)}`);
      if (!runs.length) {
        window.researchWeaver.toast(`${displayId} 还没有已发布的知识图谱版本；请先用「知识图谱审核发布」生成。`);
        return;
      }
      window.open(`${zhiyanBridge.url}/v1/knowledge-graph/publish/file?run_id=${encodeURIComponent(runs[0].id)}&kind=html`, '_blank');
    } catch (error) {
      window.researchWeaver.toast(`打开知识图谱失败：${error.message}`);
    } finally { button.disabled = false; button.textContent = original; }
  }

  document.querySelector('#projectRegistryList')?.addEventListener('click', (event) => {
    const p12 = event.target.closest('.project-mode-p12');
    if (p12) { event.stopPropagation(); runP1P2(p12.dataset.project, p12); return; }
    const p35 = event.target.closest('.project-mode-p35');
    if (p35) { event.stopPropagation(); runP3P5(p35.dataset.project, p35); return; }
    const seed = event.target.closest('.project-mode-seed-reconstruct');
    if (seed) { event.stopPropagation(); window.weaverSeedReconstruction?.openSeedReconstructionDialog(seed.dataset.project, seed.dataset.seedDoi || ''); return; }
    const graphReview = event.target.closest('.project-mode-graph-review');
    if (graphReview) { event.stopPropagation(); window.weaverGraphReview?.openGraphReviewDialog(graphReview.dataset.project); return; }
    const graphOpen = event.target.closest('.project-mode-graph-open');
    if (graphOpen) { event.stopPropagation(); openLatestGraphRun(graphOpen.dataset.project, graphOpen); }
  });

  window.weaverProjectMode = { runP1P2, runP3P5 };
})();
