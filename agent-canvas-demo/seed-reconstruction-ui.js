/* seed-reconstruction-ui.js — "从种子重建 P1" 弹窗编排。
 *
 * Agent 的职责止于交付审阅包；本文件负责把这份运行时数据渲染成可逐项编辑
 * 的界面，研究者勾选/编辑之后才在本地调用 seed-reconstruction-core.js 的纯
 * 函数构造 schema-v1 草稿，再走已有的 /v1/drafts/batch 预览确认原子提交。
 * 全程只复用已有端点：/v1/tasks（只读派发）、/v1/full-tasks/preview|dispatch
 * （fetch_and_attach_pdf，唯一 full 类别）、/v1/drafts/batch；本文件新增的
 * /v1/seed-reconstruction* 端点只做运行记录记账，不参与任何派发或写入决策。
 */
(() => {
  const Core = () => window.weaverSeedReconstructionCore;

  function selectedReadAgent() {
    // 只读候选发现/内容分析必须钉死在朴素只读适配器（claude/codex）上，不能
    // 落到 claude-research（带 Bash/Write，边界更宽）或任何 -full 适配器。
    // `installed` 只说明命令路径存在，不能说明该 CLI 当前的登录/模型配置
    // 可用。此机的 Claude CLI 可能被第三方模型环境变量接管而在真正派发时
    // 失败；Codex 是同样受限的只读适配器，且与 Bridge 的 JSON 输出契约已
    // 验证，因此优先用它。Claude 仍作为 Codex 未安装时的保守回退。
    for (const id of ['codex', 'claude']) {
      const agent = zhiyanBridge.agents.find((a) => a.id === id && a.installed);
      if (agent) return agent.id;
    }
    return null;
  }

  async function project(displayId) {
    return (await scholariumStateFetch('project.get', { display_id: displayId })).result;
  }

  function ensureDialog() {
    let dialog = document.querySelector('#seedReconstructDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'seedReconstructDialog';
    dialog.className = 'registry-dialog pipeline-topic-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="pipeline-topic-form" onsubmit="return false">
        <div class="run-header">
          <div><span class="eyebrow">SEED RECONSTRUCTION · P1</span><h2>从种子重建 P1</h2></div>
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

  function toast(message) { window.researchWeaver?.toast?.(message); }
  // safeHtml is intentionally text-node oriented in the legacy UI. The new
  // review form puts Agent-discovered bibliographic fields in HTML attributes,
  // which also need quote escaping so a title can never break out of value="".
  function safeAttr(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  /* ---------- 阶段 0：项目绑定确认（身份门） ---------- */

  async function openSeedReconstructionDialog(displayId, prefillDoi) {
    const dialog = ensureDialog();
    dialog.showModal();
    const state = { displayId, run: null, project: null, candidates: [], admittedInputs: [], contentPapers: [] };
    setStage(dialog, '<p class="wv-faint">正在核对课题与工作区身份…</p>', '');
    try {
      state.project = await project(displayId);
    } catch (error) {
      setStage(dialog, `<p class="error">读取课题失败：${safeHtml(error.message)}</p>`, '<button type="button" class="button ghost" data-action="close">关闭</button>');
      dialog.querySelector('[data-action="close"]').onclick = () => dialog.close();
      return;
    }
    setStage(dialog, `
      <p>课题：<b>${safeHtml(state.project.project?.display_id || displayId)}</b> · ${safeHtml(state.project.project?.title || '')}</p>
      <p class="wv-faint">工作区：<span class="wv-mono">${safeHtml(workspaceRoot)}</span></p>
      <label>种子 DOI（可多个，每行一个）<textarea id="seedDoiInput" rows="3" placeholder="10.1039/D0TA00811G">${safeHtml(prefillDoi || '')}</textarea></label>
      <p class="wv-faint">提交后 Bridge 会核对课题标题与工作区 topic.json 的 name 是否一致；不一致直接阻断，不派发任何 Agent 任务。</p>
    `, `
      <button type="button" class="button ghost" data-action="cancel">取消</button>
      <button type="button" class="button primary" data-action="start">开始候选发现</button>
    `);
    dialog.querySelector('[data-action="cancel"]').onclick = () => dialog.close();
    dialog.querySelector('[data-action="start"]').onclick = async () => {
      const seeds = String(dialog.querySelector('#seedDoiInput').value || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (!seeds.length) return toast('请至少填写一个种子 DOI。');
      const startBtn = dialog.querySelector('[data-action="start"]');
      startBtn.disabled = true; startBtn.textContent = '核对身份中…';
      try {
        state.run = await bridgeFetch('/v1/seed-reconstruction', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project_uid: state.project.project.uid, project_display_id: state.project.project.display_id, project_title: state.project.project.title, workspace: workspaceRoot, seeds }),
        });
        await runDiscovery(dialog, state);
      } catch (error) {
        setStage(dialog, `<p class="error">身份门未通过：${safeHtml(error.message)}</p>${error.reasons ? `<ul>${error.reasons.map((r) => `<li>${safeHtml(r)}</li>`).join('')}</ul>` : ''}`, '<button type="button" class="button ghost" data-action="close">关闭</button>');
        dialog.querySelector('[data-action="close"]').onclick = () => dialog.close();
      } finally { startBtn.disabled = false; startBtn.textContent = '开始候选发现'; }
    };
  }

  /* ---------- 阶段 A/B：候选发现 + 白名单判定 ---------- */

  async function runDiscovery(dialog, state) {
    const agentId = selectedReadAgent();
    if (!agentId) throw new Error('没有可用的只读本地 Agent（claude/codex）。');
    // Agent-side WebFetch can be subject to an enterprise safe-domain policy.
    // Fetch the fixed Crossref source here through the local Bridge instead:
    // it is L0 (GET-only), bounded to a DOI and recorded on the run.  The
    // Agent still performs the relevance judgment, but never has to claim an
    // external source it could not actually reach.
    setStage(dialog, '<p class="wv-faint">正在读取 Crossref 种子引用清单（只读，不会下载或写入课题）…</p>', '');
    const sourceManifest = [];
    for (const seed of state.run.seeds) {
      sourceManifest.push(await bridgeFetch(`/v1/literature/crossref/works/${encodeURIComponent(seed)}`));
    }
    state.run = await bridgeFetch(`/v1/seed-reconstruction/${state.run.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source_manifest: sourceManifest }),
    });
    setStage(dialog, '<p class="wv-faint">Agent 正在根据已记录的 Crossref 来源清单初筛候选…</p>', '');
    const prompt = Core().buildCandidateDiscoveryPrompt({ project: state.project.project, seeds: state.run.seeds, sourceManifest });
    const created = await bridgeFetch('/v1/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId, cwd: workspaceRoot, prompt, permission: 'read', execute: true }) });
    state.discoveryTaskId = created.id;
    state.run = await bridgeFetch(`/v1/seed-reconstruction/${state.run.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source_task_id: created.id }) });
    const raw = await waitTask(created.id);
    const parsed = Core().parseCandidateDiscoveryReply(raw, { allowedSourceQueries: sourceManifest.map((source) => source.endpoint), sourceManifest });
    if (!parsed.ok) throw new Error(parsed.error);
    // The seed's Crossref references may contain only DOI/author. A DOI without
    // a title is not reviewable, so resolve each *already source-gated* candidate
    // through the same fixed-origin L0 endpoint before showing any download box.
    // This is intentionally bounded by the candidate cap (12), never gives the
    // Agent network access, and records both successes and honest failures.
    setStage(dialog, `<p class="wv-faint">正在补全 ${parsed.value.candidates.length} 条候选的 Crossref 题名与期刊元数据（只读）…</p>`, '');
    const metadataResults = [];
    for (const candidate of parsed.value.candidates) {
      try {
        const manifest = await bridgeFetch(`/v1/literature/crossref/works/${encodeURIComponent(candidate.doi)}`);
        metadataResults.push({ doi: candidate.doi, manifest });
      } catch (error) {
        metadataResults.push({ doi: candidate.doi, error: error.message || 'Crossref 元数据读取失败' });
      }
    }
    const enriched = Core().enrichCandidatesWithCrossrefMetadata(parsed.value.candidates, metadataResults);
    const { candidates } = await bridgeFetch('/v1/literature/whitelist-check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidates: enriched }) });
    state.candidates = candidates;
    const metadataManifest = metadataResults.filter((result) => result.manifest).map((result) => result.manifest);
    state.run = await bridgeFetch(`/v1/seed-reconstruction/${state.run.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ candidates, metadata_manifest: metadataManifest, status: 'candidates-ready' }) });
    renderCandidateSelection(dialog, state);
  }

  function candidateRowHtml(c, i) {
    const tag = c.whitelistStatus === 'whitelist' ? `<span class="lit-tag ok">✅ ${safeHtml(c.whitelistTier || '白名单')}</span>`
      : c.whitelistStatus === 'blacklist' ? '<span class="lit-tag error">❌ 黑名单</span>' : '<span class="lit-tag">⚠️ 未收录</span>';
    const reviewable = Boolean(String(c.title || '').trim());
    const metadata = reviewable
      ? '<span class="lit-tag ok">Crossref 题名已核对</span>'
      : `<span class="lit-tag error">不可下载：Crossref 未提供题名${c.metadata_error ? `（${safeHtml(c.metadata_error)}）` : ''}</span>`;
    const checked = c.whitelistStatus === 'whitelist' && c.tentative_relevance === 'direct_evidence' ? 'checked' : '';
    return `<tr>
      <td><input type="checkbox" data-candidate="${i}" ${checked} ${c.whitelistStatus === 'blacklist' || !reviewable ? 'disabled' : ''}></td>
      <td>${safeHtml(c.title || c.doi)}<br><span class="wv-mono wv-faint">${safeHtml(c.doi)}</span></td>
      <td>${safeHtml(c.journal || '')}<br>${tag}<br>${metadata}</td>
      <td>${safeHtml(c.tentative_relevance)}<br><span class="wv-faint">${safeHtml(c.relevance_reason)}</span></td>
      <td class="wv-faint">${safeHtml(c.source_query)}</td>
    </tr>`;
  }

  function renderCandidateSelection(dialog, state) {
    if (!state.candidates.length) {
      setStage(dialog, `
        <p>本轮在受限检索预算内没有找到附带可核查来源的候选。</p>
        <p class="wv-faint">这不是准入失败，也不会下载或写入任何内容。可换种子 DOI、补充一个明确的引用来源后再试。</p>
      `, '<button type="button" class="button primary" data-action="close">结束</button>');
      dialog.querySelector('[data-action="close"]').onclick = () => dialog.close();
      return;
    }
    const rows = state.candidates.map(candidateRowHtml).join('');
    setStage(dialog, `
      <p class="wv-faint">候选来自种子文献的引用网络，均附带检索来源与摘录（来源门）。Bridge 已逐篇补全 Crossref 题名；题名仍缺失的条目不可下载。黑名单期刊也不可勾选。</p>
      <table class="wv-registry-table"><thead><tr><th></th><th>标题/DOI</th><th>期刊/白名单</th><th>初筛</th><th>检索来源</th></tr></thead><tbody>${rows}</tbody></table>
    `, `
      <button type="button" class="button ghost" data-action="cancel">取消</button>
      <button type="button" class="button primary" data-action="fetch">下载勾选项（逐篇走 full 车道）</button>
    `);
    dialog.querySelector('[data-action="cancel"]').onclick = () => dialog.close();
    dialog.querySelector('[data-action="fetch"]').onclick = async () => {
      const selected = [...dialog.querySelectorAll('[data-candidate]:checked')].map((el) => state.candidates[Number(el.dataset.candidate)]);
      if (!selected.length) return toast('请至少勾选一项。');
      state.run = await bridgeFetch(`/v1/seed-reconstruction/${state.run.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ selected_dois: selected.map((c) => c.doi), status: 'downloading' }) });
      await runDownloads(dialog, state, selected);
    };
  }

  /* ---------- 阶段 C：逐篇 fetch_and_attach_pdf（唯一 full 类别，逐篇 preview→confirm→dispatch） ---------- */

  async function runDownloads(dialog, state, selected) {
    const downloads = [];
    for (const candidate of selected) {
      setStage(dialog, `<p class="wv-faint">正在处理 ${safeHtml(candidate.doi)}（${downloads.length + 1}/${selected.length}）…</p><ul>${downloads.map((d) => `<li>${safeHtml(d.doi)} — ${safeHtml(d.status)}</li>`).join('')}</ul>`, '');
      try {
        const promptText = `${candidate.doi}（${candidate.title}, ${(candidate.authors || []).join('; ')} ${candidate.year || ''}）`;
        const previewBody = window.weaverFullLaneCore.buildFetchAndAttachPreviewBody({ workspace: workspaceRoot, prompt: promptText });
        const preview = await bridgeFetch('/v1/full-tasks/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(previewBody) });
        if (!confirm(`即将对 ${candidate.doi} 派发 fetch_and_attach_pdf（唯一 full 类别）：\n联网：${preview.network ? '是' : '否'}\n写入范围：${preview.pathScope}/\n计划工具：${(preview.plannedTools || []).join(', ')}（无 Write）\n\n确认派发？`)) {
          downloads.push({ doi: candidate.doi, status: 'skipped_by_user' });
          continue;
        }
        const dispatchBody = window.weaverFullLaneCore.buildFetchAndAttachDispatchBody({ previewId: preview.id, category: preview.category, workspace: workspaceRoot, prompt: promptText });
        const dispatched = await bridgeFetch('/v1/full-tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(dispatchBody) });
        const run = await pollFullTask(dispatched.id);
        if (run.status === 'completed' && run.download) {
          downloads.push({ doi: candidate.doi, status: 'downloaded', path: run.download.path, sha256: run.download.sha256, fullTaskId: dispatched.id });
        } else {
          downloads.push({ doi: candidate.doi, status: run.status || 'failed', reason: run.failureMessage || run.landing?.reason || '未获得已校验 PDF', fullTaskId: dispatched.id });
        }
      } catch (error) {
        downloads.push({ doi: candidate.doi, status: 'failed', reason: error.message });
      }
    }
    state.run = await bridgeFetch(`/v1/seed-reconstruction/${state.run.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ downloads, status: 'downloads-done' }) });
    // admitted_inputs 严格 = 本轮下载门通过的 PDF；失败/跳过项留在 downloads 报告里，不进入后续任何阶段。
    state.admittedInputs = downloads.filter((d) => d.status === 'downloaded').map((d) => ({ doi: d.doi, path: d.path, sha256: d.sha256 }));
    state.run = await bridgeFetch(`/v1/seed-reconstruction/${state.run.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ admitted_inputs: state.admittedInputs }) });
    renderDownloadReport(dialog, state, downloads);
  }

  async function pollFullTask(id) {
    for (let attempt = 0; attempt < 400; attempt++) {
      const run = await bridgeFetch(`/v1/full-tasks/${id}`);
      if (['completed', 'completed-with-violations', 'failed', 'cancelled', 'interrupted'].includes(run.status)) return run;
      await new Promise((resolve) => setTimeout(resolve, 900));
    }
    throw new Error('等待 full-task 超时');
  }

  function renderDownloadReport(dialog, state, downloads) {
    const rows = downloads.map((d) => `<tr><td class="wv-mono">${safeHtml(d.doi)}</td><td>${safeHtml(d.status)}</td><td class="wv-faint">${safeHtml(d.reason || d.path || '')}</td></tr>`).join('');
    setStage(dialog, `
      <p class="wv-faint">下载门结果——只有 status=downloaded 的条目会进入内容准入分析；失败或密码保护项停在这里，不会混入后续输入。</p>
      <table class="wv-registry-table"><thead><tr><th>DOI</th><th>状态</th><th>详情</th></tr></thead><tbody>${rows}</tbody></table>
    `, `
      <button type="button" class="button ghost" data-action="cancel">结束（不继续）</button>
      <button type="button" class="button primary" data-action="content" ${state.admittedInputs.length ? '' : 'disabled'}>对已下载 PDF 做内容准入分析</button>
    `);
    dialog.querySelector('[data-action="cancel"]').onclick = () => dialog.close();
    dialog.querySelector('[data-action="content"]').onclick = () => runContentAdmission(dialog, state);
  }

  /* ---------- 阶段 D：内容准入分析（只读，严格限定于本轮 admitted_inputs） ---------- */

  async function runContentAdmission(dialog, state) {
    const agentId = selectedReadAgent();
    setStage(dialog, '<p class="wv-faint">Agent 正在只读分析本轮下载的精确 PDF 清单（不扫描历史 downloaded-pdfs/）…</p>', '');
    const allIds = (await scholariumStateFetch('research.ids', { types: ['hypothesis', 'paper', 'evidence', 'decision'] })).result?.ids || {};
    const existingHypotheses = (state.project.hypotheses || []).map((h) => ({ uid: h.uid, display_id: h.display_id, statement: h.statement }));
    const prompt = Core().buildContentAdmissionPrompt({ project: state.project.project, admittedInputs: state.admittedInputs, existingHypotheses });
    const created = await bridgeFetch('/v1/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId, cwd: workspaceRoot, prompt, permission: 'read', execute: true }) });
    state.contentTaskId = created.id;
    state.run = await bridgeFetch(`/v1/seed-reconstruction/${state.run.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source_task_id: created.id }) });
    const raw = await waitTask(created.id);
    const parsed = Core().parseContentAdmissionReply(raw, { admittedInputs: state.admittedInputs, existingHypothesisUids: existingHypotheses.map((h) => h.uid) });
    if (!parsed.ok) { toast(parsed.error); return renderDownloadReport(dialog, state, state.run.downloads); }
    state.contentPapers = parsed.value.papers;
    state.existingHypotheses = existingHypotheses;
    state.allIds = allIds;
    const dedup = await checkDedup(state);
    state.dedup = dedup;
    state.reviewPackage = Core().buildReviewPackage({ discovery: { candidates: state.candidates }, contentFindings: parsed.value, admittedInputs: state.admittedInputs, dedupHits: dedup, existingHypotheses });
    renderReviewPackage(dialog, state);
  }

  async function checkDedup(state) {
    // 真正按 DOI 查 vault；若这个 L0 查询失败就停止在审阅包之前，不能退化为
    // “假装没撞到”的空结果。
    return bridgeFetch('/v1/seed-reconstruction/dedup', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dois: state.admittedInputs.map((input) => input.doi) }),
    });
  }

  /* ---------- 审阅包：逐项可编辑，Agent 只提供建议，写不写、写成什么由研究者决定 ---------- */

  function renderReviewPackage(dialog, state) {
    const cards = state.reviewPackage.papers.map((p, pi) => {
      const findingsHtml = p.findings.map((f, fi) => `
        <div class="wv-action-card" data-finding="${pi}:${fi}">
          <label><input type="checkbox" data-finding-include ${f.insufficient_evidence ? 'disabled' : 'checked'}> 纳入这条 Evidence</label>
          ${f.insufficient_evidence ? `<p class="wv-faint">证据不足：${safeHtml(f.insufficient_reason || '未提供可定位引用')}；本轮可保留 Paper，但不会生成 Evidence。</p>` : ''}
          <p class="wv-faint">建议关系：<select data-finding-relation>
            ${['SUPPORTS', 'CONTRADICTS', 'QUALIFIES', 'INCONCLUSIVE'].map((r) => `<option value="${r}" ${f.relation === r ? 'selected' : ''}>${r}</option>`).join('')}
          </select></p>
          <label>目标假设<select data-finding-target>${[`<option value="">不创建 Evidence</option>`].concat(state.existingHypotheses.map((h) => `<option value="${safeAttr(h.uid)}" ${h.uid === f.target_hypothesis_uid ? 'selected' : ''}>${safeHtml(h.display_id)} · ${safeHtml(h.statement || '')}</option>`)).join('')}</select></label>
          <label>主张<textarea data-finding-claim rows="2">${safeHtml(f.claim)}</textarea></label>
          <label>原文引用<textarea data-finding-quote rows="2">${safeHtml(f.quote)}</textarea></label>
          <label>定位<input type="text" data-finding-anchor value="${safeHtml(f.anchor)}"></label>
          <label>限制/混杂说明<textarea data-finding-limitations rows="2">${safeHtml(f.confound_note)}</textarea></label>
          ${f.existing_evidence ? `<p class="wv-faint">⚠️ 已存在类似 Evidence：${safeHtml(f.existing_evidence.display_id || '')}（只读，不会被本流程修改）</p>` : ''}
        </div>`).join('') || '<p class="wv-faint">未生成可定位的 Evidence（可能标记为 insufficient_evidence）。</p>';
      return `<section class="wv-action-card" data-paper="${pi}">
        <h3><label><input type="checkbox" data-paper-include ${p.existing_paper ? 'disabled' : ''} ${Core().defaultPaperIncluded(p) ? 'checked' : ''}> ${safeHtml(p.doi)}</label></h3>
        <p class="wv-faint">Agent 建议角色：${safeHtml(p.suggested_role)} — ${safeHtml(p.role_reason)}</p>
        <p class="wv-faint">候选来源：${safeHtml(p.source_query || '未提供')}<br>${safeHtml(p.source_response_excerpt || '')}</p>
        <label>标题<input type="text" data-paper-title value="${safeAttr(p.title)}"></label>
        <label>期刊<input type="text" data-paper-journal value="${safeAttr(p.journal)}"></label>
        <label>年份<input type="number" data-paper-year value="${safeAttr(p.year || '')}"></label>
        <label>作者（逗号分隔）<input type="text" data-paper-authors value="${safeAttr((p.authors || []).join(', '))}"></label>
        <label>标签<input type="text" data-paper-tags placeholder="逗号分隔"></label>
        <label>备注<textarea data-paper-notes rows="2"></textarea></label>
        ${p.existing_paper ? `<p class="wv-faint">⚠️ 已存在 Paper：${safeHtml(p.existing_paper.display_id || '')}（仅查看/跳过；本流程不会覆盖、迁移或再建重复 Paper）</p>` : ''}
        ${findingsHtml}
      </section>`;
    }).join('');
    setStage(dialog, `
      <p class="wv-faint">逐项勾选/编辑；未勾选的项不会生成任何文件。研究者的编辑会覆盖 Agent 的原始建议。</p>
      ${cards}
      <label><input type="checkbox" id="decisionInclude" checked> 同时生成一条 Decision 记录本轮准入范围与理由</label>
      <label>Decision 标题<input type="text" id="decisionTitle" value="${safeHtml(state.project.project.display_id)} 种子文献重建准入"></label>
      <label>Decision 理由<textarea id="decisionRationale" rows="3"></textarea></label>
    `, `
      <button type="button" class="button ghost" data-action="cancel">取消</button>
      <button type="button" class="button primary" data-action="preview">生成 P1 草案预览</button>
    `);
    dialog.querySelector('[data-action="cancel"]').onclick = () => dialog.close();
    dialog.querySelector('[data-action="preview"]').onclick = () => previewDrafts(dialog, state);
  }

  async function computeQuoteHash(text) {
    try {
      const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch { return ''; }
  }

  async function collectSelections(dialog, state) {
    const papers = [];
    const evidence = [];
    for (const paperEl of dialog.querySelectorAll('[data-paper]')) {
      const pi = Number(paperEl.dataset.paper);
      const p = state.reviewPackage.papers[pi];
      const include = paperEl.querySelector('[data-paper-include]').checked;
      papers.push({
        include, doi: p.doi,
        title: paperEl.querySelector('[data-paper-title]').value,
        journal: paperEl.querySelector('[data-paper-journal]').value,
        year: paperEl.querySelector('[data-paper-year]').value,
        authors: String(paperEl.querySelector('[data-paper-authors]').value || '').split(',').map((s) => s.trim()).filter(Boolean),
        tags: String(paperEl.querySelector('[data-paper-tags]').value || '').split(',').map((s) => s.trim()).filter(Boolean),
        notes: paperEl.querySelector('[data-paper-notes]').value,
      });
      for (const fEl of paperEl.querySelectorAll('[data-finding]')) {
        if (!include) continue;
        const finc = fEl.querySelector('[data-finding-include]').checked;
        if (!finc) continue;
        const [, fi] = fEl.dataset.finding.split(':').map(Number);
        const f = p.findings[fi];
        const quote = fEl.querySelector('[data-finding-quote]').value;
        evidence.push({
          include: true, source_doi: p.doi, target_hypothesis_uid: fEl.querySelector('[data-finding-target]').value,
          relation: fEl.querySelector('[data-finding-relation]').value,
          claim: fEl.querySelector('[data-finding-claim]').value,
          limitations: fEl.querySelector('[data-finding-limitations]').value,
          conditions: '', strength: 2, quote, anchor: fEl.querySelector('[data-finding-anchor]').value,
          quote_hash: await computeQuoteHash(quote),
        });
      }
    }
    const decision = {
      include: dialog.querySelector('#decisionInclude').checked,
      title: dialog.querySelector('#decisionTitle').value,
      decision: '', rationale: dialog.querySelector('#decisionRationale').value, trigger_condition: '',
    };
    return { papers, evidence, decision };
  }

  async function previewDrafts(dialog, state) {
    const selections = await collectSelections(dialog, state);
    let built;
    try {
      built = Core().buildAdmissionDrafts({
        project: state.project.project, selections, admittedInputs: state.admittedInputs,
        existingHypothesisIds: state.existingHypotheses.map((h) => h.uid),
        existingPaperIds: state.allIds.paper || [], existingPaperDois: Object.keys(state.dedup?.papers || {}),
        existingEvidenceIds: state.allIds.evidence || [], existingDecisionIds: state.allIds.decision || [],
      });
    } catch (error) { return toast(error.message); }
    setStage(dialog, `
      <p class="wv-faint">即将新建 ${built.items.length} 个文件（${built.paperCount} 篇 Paper、${built.evidenceCount} 条 Evidence${built.decisionUid ? '、1 条 Decision' : ''}），均为 created_by: ai、review_status: pending，不写入任何 Hypothesis 的 supporting_evidence/contradicting_evidence。</p>
      <ul>${built.items.map((i) => `<li class="wv-mono">${safeHtml(i.path)}</li>`).join('')}</ul>
    `, `
      <button type="button" class="button ghost" data-action="back">返回编辑</button>
      <button type="button" class="button primary" data-action="commit">预览并确认写入</button>
    `);
    dialog.querySelector('[data-action="back"]').onclick = () => renderReviewPackage(dialog, state);
    dialog.querySelector('[data-action="commit"]').onclick = async () => {
      try {
        const preview = await bridgeFetch('/v1/drafts/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ base: 'scholarium-vault', sourceTaskId: state.contentTaskId || state.discoveryTaskId, items: built.items }) });
        if (!confirm(`将原子写入 ${built.items.length} 个新文件，确认吗？`)) return;
        await bridgeFetch(`/v1/drafts/batch/${preview.id}/commit`, { method: 'POST' });
        state.run = await bridgeFetch(`/v1/seed-reconstruction/${state.run.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ draft_batch_id: preview.id, status: 'admitted' }) });
        toast(`已写入 ${built.items.length} 个文件（均为 pending，待研究者逐条确认）。`);
        renderCompletion(dialog, built);
      } catch (error) { toast(`准入失败：${error.message}`); }
    };
  }

  /* P2 版本化图谱尚未接到既有图谱管线。不能用一个 input-manifest 冒充图谱
   * 生成，更不能在没有 preview→confirm 的情况下额外写文件；P1 准入完成后
   * 明确停在这里，等 P2 具备真实生成器和独立验收后再开放。 */
  function renderCompletion(dialog, built) {
    setStage(dialog, `
      <p>P1 准入已完成：新建对象均保持 <span class="wv-mono">review_status: pending</span>，仍可在 Scholarium 中继续人工审阅。</p>
      <p class="wv-faint">P2 版本化知识图谱尚未接入真实图谱生成器，因此本轮不会创建 manifest 或任何图谱占位文件，也不会覆盖当前图谱。</p>
    `, `
      <button type="button" class="button primary" data-action="close">结束</button>
    `);
    dialog.querySelector('[data-action="close"]').onclick = () => dialog.close();
  }

  window.weaverSeedReconstruction = { openSeedReconstructionDialog };
})();
