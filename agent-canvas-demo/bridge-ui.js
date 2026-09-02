/* Browser talks only to the local launcher proxy; the Bridge token never reaches the page. */
const zhiyanBridge = { url: '/bridge', online: false, agents: [] };
window.zhiyanBridge = zhiyanBridge;
function requestedProfile(node) { return window.researchWeaver.profile(node.profileId); }
function runnableProfile(node) {
  const requested = requestedProfile(node);
  if (requested && zhiyanBridge.agents.some((agent) => agent.id === requested.adapterId && agent.installed)) return requested;
  return window.researchWeaver.profiles.find((profile) => profile.adapterId === 'codex' && zhiyanBridge.agents.some((agent) => agent.id === profile.adapterId && agent.installed))
    || window.researchWeaver.profiles.find((profile) => zhiyanBridge.agents.some((agent) => agent.id === profile.adapterId && agent.installed));
}
function fallbackDescription(plan) {
  return plan.map((node) => ({ node, requested: requestedProfile(node), executor: runnableProfile(node) }))
    .filter(({ requested, executor }) => requested && executor && requested.id !== executor.id)
    .map(({ node, requested, executor }) => `${node.name}：${requested.name} → ${executor.name}`);
}
const bridgeDot = document.querySelector('#bridgeDot');
const bridgeText = document.querySelector('#bridgeText');
const bridgeMeta = document.querySelector('#bridgeMeta');
const workspaceInput = document.querySelector('#workspaceRoot');
const workspaceStatus = document.querySelector('#workspaceStatus');
const chatProjectInput = document.querySelector('#chatProjectId');
let workspaceRoot = '';
let evidenceInventory = null;
let searchStrategy = null;
// Ground truth for the evidence cross-check in finalAcceptance(): which DOIs this run
// actually saw in a real OpenAlex search result, and which DOIs it actually downloaded
// and validated as a real PDF (see executeSkillNode's literature-search / download
// branches below). A DOI cited in the final report's 证据账本 that appears in neither
// set was not produced by this run's own retrieval — the agent likely wrote it from
// memory/training data rather than from something it actually looked up here.
let literatureEvidenceBase = { searchedDois: new Set(), downloadedDois: new Set(), downloadedRecords: [] };
function resetLiteratureEvidenceBase() { literatureEvidenceBase = { searchedDois: new Set(), downloadedDois: new Set(), downloadedRecords: [] }; }
function normalizeDoi(value) { const match = String(value || '').match(/10\.\d{4,9}\/[^\s"'()\]<>｜|]+/i); return match ? match[0].toLowerCase().replace(/[.,;、。]+$/, '') : null; }
const THEORY_MEMORY_STORE = 'research-weaver:research-theory-memory:v1';
let latestTheoryDossier = '';
function theoryMemoryKey() { return `${workspaceRoot}\n${window.researchWeaver.taskGoal.value.trim()}`; }
function loadTheoryMemory() { try { return JSON.parse(localStorage.getItem(THEORY_MEMORY_STORE) || '{}')[theoryMemoryKey()] || { turns: [], decisions: [], unresolved: [] }; } catch { return { turns: [], decisions: [], unresolved: [] }; } }
function saveTheoryMemory(memory) { let all = {}; try { all = JSON.parse(localStorage.getItem(THEORY_MEMORY_STORE) || '{}'); } catch {} all[theoryMemoryKey()] = { ...memory, updatedAt: new Date().toISOString() }; localStorage.setItem(THEORY_MEMORY_STORE, JSON.stringify(all)); }
function researchTheoryProtocol(dossier, memory, researcherMessage) { return `你是“科研论主 Agent”，唯一执行器是 Codex。你正在与研究员持续讨论一个课题，目标不是一次性给出貌似完整的答案，而是通过证据、追问、方案、自审计、修订的闭环帮助其推进课题。\n\n课题目标：${window.researchWeaver.taskGoal.value}\n工作区证据与检索/下载摘要：\n${dossier.slice(-18000)}\n\n历史记忆：\n${JSON.stringify(memory).slice(-12000)}\n\n研究员这次补充：\n${researcherMessage || '首次启动；先提出最能决定实验路线的高信息量问题。'}\n\n严格规则：\n1. 只将实际读取的本地文件、已读摘要或成功下载并读取的开放全文作为证据；元数据、DOI、检索命中必须标为线索或摘要级。\n2. 若关键约束缺失，最多提出 5 个可回答的问题，且不要假装方案已经验证。\n3. 每一版方案必须写明 H0/H1、替代解释、变量与对照、重复/统计、stop/go、风险与下一步。\n4. 对 CO2RR 需检查空白、碳源、碳平衡、光热和重复性；对其它课题等价地检查因果对照与可复现性。\n5. 先自审计；若证据/可行性/对照任何一项不通过，status 必须为 revise 或 questions，而非 ready。\n\n只输出 JSON（不得加 Markdown 代码块）：\n{"status":"questions|revise|ready","summary":"","questions":[{"question":"","why":""}],"hypotheses":{"h0":"","h1":"","alternatives":[]},"plan":{"primary_route":[],"controls":[],"measurements":[],"replication":"","analysis_rule":"","stop_go":[],"risks":[],"next_action":""},"audit":{"passed":false,"evidence_gaps":[],"feasibility_gaps":[],"revision_action":""},"memory_update":{"decisions":[],"unresolved":[]}}`; }
function parseTheoryReply(text) { const match = text.match(/\{[\s\S]*\}/); if (!match) return { status: 'questions', summary: text, questions: [{ question: '请补充课题目标、可用仪器/材料、约束条件与已有观察。', why: '无法从 Agent 输出中解析结构化科研论结果。' }], audit: { passed: false, evidence_gaps: ['输出格式未通过'], feasibility_gaps: [], revision_action: '重新回答' } }; try { return JSON.parse(match[0]); } catch { return { status: 'questions', summary: text, questions: [{ question: '请补充课题约束并继续。', why: '结构化响应解析失败。' }], audit: { passed: false, evidence_gaps: ['JSON 解析失败'], feasibility_gaps: [], revision_action: '重新回答' } }; } }
async function runResearchTheory(message = '', autoRevision = false) { const memory = loadTheoryMemory(); if (message) memory.turns.push({ role: 'researcher', content: message, at: new Date().toISOString() }); const profile = runnableProfile({ type: 'agent', profileId: 'research-theory-agent' }); if (!profile) throw new Error('No runnable local Agent CLI is available. Connect Bridge and ensure at least one CLI adapter is installed.'); const created = await bridgeFetch('/v1/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: profile.adapterId, cwd: workspaceRoot, prompt: researchTheoryProtocol(latestTheoryDossier, memory, message), permission: 'read', execute: true }) }); const raw = await waitTask(created.id); const reply = parseTheoryReply(raw); memory.turns.push({ role: 'research-theory', content: reply, at: new Date().toISOString() }); memory.decisions = [...new Set([...(memory.decisions || []), ...((reply.memory_update || {}).decisions || [])])].slice(-30); memory.unresolved = (reply.memory_update || {}).unresolved || reply.audit?.evidence_gaps || []; saveTheoryMemory(memory); if (!autoRevision && reply.status === 'revise' && !reply.audit?.passed) return runResearchTheory(`请按刚才自审计的缺口修订方案：${(reply.audit?.revision_action || '').slice(0, 1200)}`, true); return reply; }
function theoryList(items) { return Array.isArray(items) && items.length ? `<ul>${items.map((item) => `<li>${safeHtml(String(item))}</li>`).join('')}</ul>` : '<p class="theory-empty">未提供</p>'; }
function renderTheoryReply(reply) {
  const result = document.querySelector('#runResult');
  const auditText = (reply.audit?.evidence_gaps || []).concat(reply.audit?.feasibility_gaps || []).join('；') || reply.audit?.revision_action || '等待研究员补充关键信息。';
  const questions = (reply.questions || []).map((item, i) => `<article class="theory-question"><div class="theory-question-index">${i + 1}</div><div><h4>${safeHtml(item.question)}</h4><p>${safeHtml(item.why || '该问题将决定后续实验路线。')}</p><textarea data-theory-answer="${i}" placeholder="请在这里回答；可粘贴实验条件、文件路径或观察结果。"></textarea></div></article>`).join('');
  const plan = reply.plan ? `<details class="theory-plan"><summary><span>查看当前方案</span><small>主路线、对照、测量、统计与停止条件</small></summary><div class="theory-plan-grid"><section><h4>主路线</h4>${theoryList(reply.plan.primary_route)}</section><section><h4>关键对照</h4>${theoryList(reply.plan.controls)}</section><section><h4>测量与记录</h4>${theoryList(reply.plan.measurements)}</section><section><h4>停止 / 推进条件</h4>${theoryList(reply.plan.stop_go)}</section><section><h4>重复与统计</h4><p>${safeHtml(reply.plan.replication || '未提供')}</p><p>${safeHtml(reply.plan.analysis_rule || '')}</p></section><section><h4>风险与下一步</h4>${theoryList(reply.plan.risks)}<p><b>下一步：</b>${safeHtml(reply.plan.next_action || '未提供')}</p></section></div></details>` : '';
  const panel = document.createElement('section'); panel.className = 'agent-result research-theory-dialogue';
  panel.innerHTML = `<header class="theory-header"><div><span class="eyebrow">RESEARCH THEORY</span><h3>科研论下一步</h3></div><span class="theory-status ${reply.audit?.passed ? 'ready' : 'needs-input'}">${reply.audit?.passed ? '方案可进入执行前复核' : '需要你的回答'}</span></header><p class="theory-summary">${safeHtml(reply.summary || '科研论正在建立可验证的研究方案。')}</p><section class="theory-audit"><b>当前自审计</b><p>${safeHtml(auditText)}</p></section>${plan}<form class="theory-form">${questions || `<article class="theory-observation"><h4>记录新的实验观察或问题</h4><textarea data-theory-message placeholder="例如：第 2 批实验出现选择性下降；请据此修订方案。"></textarea></article>`}<footer><small>回答将写入本浏览器的项目记忆，并用于下一轮科研论审计。</small><button type="submit" class="button primary">${questions ? '提交回答，继续科研论' : '继续项目对话'}</button></footer></form>`;
  panel.querySelector('.theory-form').onsubmit = async (event) => { event.preventDefault(); const answers = [...panel.querySelectorAll('textarea')].map((field, i) => `问题 ${i + 1}：${field.value.trim()}`).filter(Boolean).join('\n'); if (!answers) return window.researchWeaver.toast('请先填写回答或实验观察。'); const button = panel.querySelector('button'); button.disabled = true; button.textContent = '科研论正在审计…'; try { const next = await runResearchTheory(answers); panel.remove(); renderTheoryReply(next); } catch (error) { window.researchWeaver.toast(`科研论对话失败：${error.message}`); button.disabled = false; button.textContent = '重试科研论'; } };
  result.appendChild(panel);
}
function bridgeStatus() { bridgeDot.classList.toggle('offline', !zhiyanBridge.online); bridgeText.textContent = zhiyanBridge.online ? '本机 Bridge 已连接' : '本机 Bridge 未连接'; bridgeMeta.textContent = zhiyanBridge.online ? `检测到 ${zhiyanBridge.agents.filter((agent) => agent.installed).length} 个可用 CLI · ${zhiyanBridge.agents.some((agent) => agent.executionEnabled) ? '可执行只读任务' : '执行已禁用'}` : '运行 npm start 后会自动连接本机 Agent'; }
async function bridgeFetch(path, options = {}) { const response = await fetch(zhiyanBridge.url + path, options); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `Bridge 请求失败 (${response.status})`); return payload; }
function showWorkspace(info) { workspaceRoot = info.root || ''; workspaceInput.value = workspaceRoot; const ready = Boolean(info.isDirectory); workspaceStatus.textContent = ready ? `已授权：${workspaceRoot}` : '课题工作区不可用；请选择存在的本地目录。'; workspaceStatus.className = `workspace-status ${ready ? 'ready' : 'error'}`; }
async function loadWorkspace() { const info = await bridgeFetch('/v1/workspace'); showWorkspace(info); return info; }

// --- 课题注册表侧栏：消费 M1 读通道 (GET /v1/scholarium/state) ------------
// project.list / project.get 都是 L0 只读动作，Bridge 直接同步返回（不经过
// Obsidian 插件的写队列），所以这里可以随时刷新，不需要 Obsidian 打开。
// 点击一个课题只是展开/收起它的结算详情，不会改写上面的 workspaceRoot——
// schema-v1 的课题注册表（跨整个 Vault）和 workspaceRoot（这里的"科研论"/
// 技能执行任务的本地读取边界，即 CLI 的 cwd）是两套不同的概念。
// 2026-08-26 更正（此前的旧注释误写"两者的映射留给 M4 做"）：读了
// docs/self-evolving-agent-design.md 后确认 M4 从未包含"工作目录 ↔
// schema-v1 课题"的映射规范，这个待办从一开始就不该记在 M4 名下。而这个
// 映射需求本身，已经在 research-chat-core.js / shell-ui.js 那条更新的
// "织研者对话"链路里，用另一套机制解决了：projectId 由研究员在每个聊天
// 主题的"关联课题"下拉框里显式选择、逐主题持久保存（window.researchWeaver.
// activeTopic.projectId），完全不依赖、也不从 workspaceRoot 反推——见
// shell-ui.js 里 sendChatMessage() 对 project.get/experiment.scan_outcomes/
// workspace.timeblock_drift_audit 的预取逻辑。这个侧栏（workspaceRoot 那条
// 更老的"科研论"技能执行路径）目前仍是纯浏览模式，没有、也不需要把
// workspaceRoot 反向映射回某个 PRJ——两条路径不共用同一套项目绑定机制，这
// 是有意的架构选择，不是遗留的未完成项。
const projectRegistryList = document.querySelector('#projectRegistryList');
let projectRegistry = { projects: [], total: 0 };
let selectedProjectDisplayId = null;
function scholariumStateFetch(action, input) { const query = new URLSearchParams({ action }); if (input) query.set('input', JSON.stringify(input)); return bridgeFetch(`/v1/scholarium/state?${query.toString()}`); }
function renderChatProjectBinding() {
  if (!chatProjectInput) return;
  const selected = window.researchWeaver?.activeTopic?.projectId || '';
  chatProjectInput.replaceChildren(new Option('未绑定课题（项目状态将标为未验证）', ''));
  for (const project of projectRegistry.projects || []) {
    chatProjectInput.add(new Option(`${project.display_id} · ${project.title || '未命名课题'}`, project.display_id));
  }
  chatProjectInput.value = [...chatProjectInput.options].some((option) => option.value === selected) ? selected : '';
}
function setChatProjectBinding() {
  const id = chatProjectInput?.value || '';
  window.researchWeaver?.setActiveTopicProjectId?.(id);
  window.researchWeaver?.toast(id ? `当前聊天已绑定 ${id}；后续每轮将预取该课题状态。` : '当前聊天未绑定 schema-v1 课题；项目状态将明确标为未验证。');
}
function renderProjectRegistryStatus(text, tone = '') { if (projectRegistryList) projectRegistryList.innerHTML = `<p class="wv-faint${tone ? ` ${tone}` : ''}">${safeHtml(text)}</p>`; }
function renderProjectRegistryList() {
  if (!projectRegistryList) return;
  if (!projectRegistry.projects.length) { renderProjectRegistryStatus('课题注册表为空：Research/Projects/ 下还没有 schema-v1 课题对象。'); return; }
  projectRegistryList.innerHTML = projectRegistry.projects.map((project) => {
    const pending = project.unsettled_experiments || 0;
    const badge = pending ? `<span class="wv-registry-badge">待结算 ${pending}</span>` : '';
    const selected = project.display_id === selectedProjectDisplayId ? ' is-selected' : '';
    const counts = project.counts || {};
    return `<div class="wv-registry-row${selected}" data-display-id="${safeHtml(project.display_id)}">
      <div class="wv-registry-row-head"><b class="wv-mono">${safeHtml(project.display_id)}</b><span class="wv-faint">${safeHtml(project.status || '')}${project.stage ? ' · ' + safeHtml(project.stage) : ''}</span></div>
      <div class="wv-registry-row-title">${safeHtml(project.title || '（无标题）')}</div>
      <div class="wv-registry-row-meta"><span class="wv-faint">假设 ${counts.hypotheses || 0} · 实验 ${counts.experiments || 0} · 证据 ${counts.evidence || 0}</span>${badge}</div>
      <div class="wv-registry-detail hidden" data-detail-for="${safeHtml(project.display_id)}"></div>
    </div>`;
  }).join('');
  projectRegistryList.querySelectorAll('.wv-registry-row').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('button')) return;
      toggleProjectDetail(row.dataset.displayId, row);
    });
  });
}
async function loadProjectRegistry() {
  if (!zhiyanBridge.online || !projectRegistryList) return;
  renderProjectRegistryStatus('正在读取课题注册表…');
  try { projectRegistry = (await scholariumStateFetch('project.list')).result || { projects: [], total: 0 }; renderProjectRegistryList(); renderChatProjectBinding(); }
  catch (error) { renderProjectRegistryStatus(`课题注册表读取失败：${error.message}`, 'error'); }
}
async function toggleProjectDetail(displayId, row) {
  const detail = row.querySelector('.wv-registry-detail');
  const wasSelected = selectedProjectDisplayId === displayId;
  projectRegistryList.querySelectorAll('.wv-registry-row').forEach((r) => { r.classList.remove('is-selected'); r.querySelector('.wv-registry-detail')?.classList.add('hidden'); });
  if (wasSelected) { selectedProjectDisplayId = null; return; }
  selectedProjectDisplayId = displayId;
  row.classList.add('is-selected');
  detail.classList.remove('hidden');
  detail.innerHTML = '<p class="wv-faint">正在读取课题详情…</p>';
  try { detail.innerHTML = renderProjectDetail((await scholariumStateFetch('project.get', { display_id: displayId })).result); }
  catch (error) { detail.innerHTML = `<p class="wv-faint error">课题详情读取失败：${safeHtml(error.message)}</p>`; }
}
function renderProjectDetail(data) {
  const rows = (data.hypotheses || []).map((h) => { const s = h.settlement || {}; return `<tr><td class="wv-mono">${safeHtml(h.display_id)}</td><td>${safeHtml(h.statement)}</td><td class="wv-mono">${s.supports || 0}/${s.contradicts || 0}/${s.qualifies || 0}/${s.pending || 0}/${s.rejected || 0}</td></tr>`; }).join('');
  return `<div class="wv-registry-detail-body">
    <p class="wv-faint">${safeHtml(data.project?.title || '')} · 假设 ${data.counts?.hypotheses || 0} · 实验 ${data.counts?.experiments || 0} · 证据 ${data.counts?.evidence || 0}</p>
    <div class="project-mode-actions">
      <button type="button" class="wv-linkbtn project-mode-p12" data-project="${safeHtml(data.project?.display_id || '')}">运行 P1–P2 文献与图谱</button>
      <button type="button" class="wv-linkbtn project-mode-p35" data-project="${safeHtml(data.project?.display_id || '')}">生成 P3–P5 首圈草案</button>
      <button type="button" class="wv-linkbtn project-mode-seed-reconstruct" data-project="${safeHtml(data.project?.display_id || '')}">从种子重建 P1（P2 待接入）</button>
      <button type="button" class="wv-linkbtn project-mode-graph-review" data-project="${safeHtml(data.project?.display_id || '')}">知识图谱审核发布</button>
      <button type="button" class="wv-linkbtn project-mode-graph-open" data-project="${safeHtml(data.project?.display_id || '')}">打开最新版本</button>
    </div>
    ${rows ? `<table class="wv-registry-table"><thead><tr><th>假设</th><th>陈述</th><th>支持/反驳/限定/待审/驳回</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="wv-faint">尚无关联假设。</p>'}
  </div>`;
}
document.querySelector('#refreshProjectRegistry')?.addEventListener('click', () => loadProjectRegistry());
window.addEventListener('scholarium:project-created', () => loadProjectRegistry());

// --- P7 闭环回扫 · 只读预演 (docs/self-evolving-agent-design.md §3) ---------
// 感知走 M1 读通道（scan_outcomes / project.get），推理走 /v1/tasks
// （permission:'read' + 已验证沙箱适配器），产出走 /v1/drafts 两段确认。
// 三条边界：不新增任何写动作；不落任何正式对象；幻觉防护在
// p7-rehearsal.js 的 parseRehearsalReply 里（白名单外的编号一律丢弃并记录）。
const rehearsalBox = document.querySelector('#rehearsalResult');
let rehearsalBusy = false;

function rehearsalStatus(html) {
  if (!rehearsalBox) return;
  rehearsalBox.hidden = false;
  rehearsalBox.innerHTML = html;
}

function rehearsalAgent() {
  // 与 shell-ui.js 的 chatProfile 同一优先级：编排器选中的 Agent 优先，
  // 回退到第一个已安装且已验证沙箱的适配器。Codex 的输出 Bridge 能解析成
  // finalMessage；其它适配器走事件流回退，均可用。
  const installed = (id) => zhiyanBridge.agents.some((a) => a.id === id && a.installed && a.executionEnabled !== false);
  const selected = window.weaverOrchestrator?.getSelectedAgent?.();
  if (selected && installed(selected)) return selected;
  if (installed('codex')) return 'codex';
  const first = (zhiyanBridge.agents || []).find((a) => a.installed && a.executionEnabled !== false);
  return first ? first.id : null;
}

async function readWorkspaceFile(relativePath) {
  const result = await bridgeFetch(`/v1/workspace-file?path=${encodeURIComponent(relativePath)}`);
  return result && result.exists ? String(result.content || '') : '';
}

async function runP7Rehearsal(scope = {}) {
  if (rehearsalBusy) return;
  if (!zhiyanBridge.online) { await connectBridge(true); if (!zhiyanBridge.online) { rehearsalStatus('<p class="wv-faint error">Bridge 未连接，无法预演。</p>'); return; } }
  const agentId = rehearsalAgent();
  if (!agentId) { rehearsalStatus('<p class="wv-faint error">没有可用的已安装 Agent CLI。</p>'); return; }
  const P7 = window.weaverP7Rehearsal;
  rehearsalBusy = true;
  try {
    rehearsalStatus('<p class="wv-faint">第 1/4 步：扫描未结算实验…</p>');
    const scan = (await scholariumStateFetch('experiment.scan_outcomes')).result;
    let awaiting = scan.awaiting_integration || [];
    // Idea 树入口可以只针对单条假设回扫：只留声明测试该假设的实验。
    if (scope.hypothesisId) {
      awaiting = awaiting.filter((e) => (e.tests_hypotheses || []).some((h) => h.display_id === scope.hypothesisId));
      if (!awaiting.length) {
        rehearsalStatus(`<p class="wv-faint">${safeHtml(scope.hypothesisId)} 没有待结算的实验（concluded 但未 integrated），该假设的账本暂时无事可做。</p>`);
        return;
      }
    }
    if (!awaiting.length) {
      rehearsalStatus('<p class="wv-faint">没有待结算的实验（concluded 但未 integrated）。结算预演无事可做——这本身就是闭环健康的好信号。</p>');
      return;
    }

    rehearsalStatus(`<p class="wv-faint">第 2/4 步：读取 ${awaiting.length} 个实验的完整结论与被测假设原文…</p>`);
    // project_display_id 是 M1 后加的字段；若读通道未返回它（旧版 research-state），
    // 退回全量课题扫描——宁可多读几个课题，也不能让 prompt 缺了假设陈述。
    let projectIds = [...new Set(awaiting.map((e) => e.project_display_id).filter(Boolean))];
    if (!projectIds.length)
      projectIds = (((await scholariumStateFetch('project.list')).result || {}).projects || []).map((p) => p.display_id);
    const hypothesisById = new Map(); // display_id -> { display_id, statement, status, settlement }
    for (const pid of projectIds) {
      const detail = (await scholariumStateFetch('project.get', { display_id: pid })).result;
      for (const h of detail.hypotheses || []) {
        const full = h.path ? await readWorkspaceFile(h.path) : '';
        hypothesisById.set(h.display_id, {
          display_id: h.display_id,
          statement: P7.extractFrontmatterField(full, 'statement') || h.statement,
          status: h.status,
          settlement: h.settlement,
        });
      }
    }
    const experiments = [];
    for (const e of awaiting) {
      const full = e.path ? await readWorkspaceFile(e.path) : '';
      experiments.push({
        display_id: e.display_id,
        title: e.title,
        conclusion: P7.extractFrontmatterField(full, 'conclusion') || e.conclusion_excerpt || '',
        tests: (e.tests_hypotheses || []).map((h) => h.display_id).filter(Boolean),
        data_origin: e.data_origin || null,
      });
    }
    const involvedHypIds = [...new Set(experiments.flatMap((e) => e.tests))];
    const hypotheses = involvedHypIds.map((id) => hypothesisById.get(id)).filter(Boolean);
    if (!hypotheses.length) { rehearsalStatus('<p class="wv-faint error">待结算实验没有可解析的被测假设，预演中止。</p>'); return; }
    const projectLabel = scope.projectId || projectIds.join('、') || '（未关联课题）';

    const scopeNote = scope.hypothesisId ? `范围：仅 ${scope.hypothesisId}（Idea 树入口）。\n` : '';
    if (!confirm(`${scopeNote}将对 ${experiments.length} 个未结算实验 × ${hypotheses.length} 条假设运行 P7 结算预演（${projectLabel}）。\n\nAgent（${agentId}）只读分析，产出结算建议草稿；不写入任何正式对象。是否继续？`)) { rehearsalStatus('<p class="wv-faint">已取消预演。</p>'); return; }

    rehearsalStatus(`<p class="wv-faint">第 3/4 步：${agentId} 正在结算分析（只读，可能需要几分钟）…</p>`);
    const prompt = P7.buildRehearsalPrompt({
      project: { display_id: projectLabel, title: '' },
      hypotheses, experiments,
    });
    const created = await bridgeFetch('/v1/tasks', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId, cwd: workspaceRoot, prompt, permission: 'read', execute: true }),
    });
    const raw = await waitTask(created.id);
    const known = { hypotheses: involvedHypIds, experiments: experiments.map((e) => e.display_id) };
    const parsed = P7.parseRehearsalReply(raw, known);
    if (!parsed.ok) { rehearsalStatus(`<p class="wv-faint error">${safeHtml(parsed.error)}。原始回复前 500 字：</p><pre class="wv-rehearsal-raw">${safeHtml(String(raw).slice(0, 500))}</pre>`); return; }

    rehearsalStatus(''); // cleared by render below
    renderRehearsalCard(parsed, { project: projectLabel, agent: agentId });
  } catch (error) {
    rehearsalStatus(`<p class="wv-faint error">预演失败：${safeHtml(error.message)}</p>`);
  } finally {
    rehearsalBusy = false;
  }
}

function renderRehearsalCard(parsed, meta) {
  const P7 = window.weaverP7Rehearsal;
  const rows = parsed.settlements.map((s) =>
    `<tr><td class="wv-mono">${safeHtml(s.hypothesis)}</td><td>${safeHtml(P7.VERDICT_LABEL[s.verdict] || s.verdict)}</td><td class="wv-mono">${safeHtml(s.based_on.join('、'))}</td><td>${safeHtml(s.reason)}</td></tr>`).join('');
  const dropped = parsed.dropped.length
    ? `<p class="wv-faint">幻觉防护丢弃 ${parsed.dropped.length} 条：${parsed.dropped.map((d) => safeHtml(d.why)).join('；')}</p>` : '';
  const spill = parsed.spillover.length
    ? `<p class="wv-faint">旁证 ${parsed.spillover.length} 条（结论指向未声明测试的假设，详见草稿）。</p>` : '';
  rehearsalBox.innerHTML = `<div class="wv-rehearsal-card">
    <div class="wv-rehearsal-head"><b>P7 结算预演建议</b><span class="wv-faint">${safeHtml(meta.project)} · ${safeHtml(meta.agent)} · 未写入任何正式对象</span></div>
    <table class="wv-registry-table"><thead><tr><th>假设</th><th>建议</th><th>依据</th><th>理由</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="wv-faint">无通过校验的建议</td></tr>'}</tbody></table>
    ${parsed.notes ? `<p class="wv-rehearsal-notes">${safeHtml(parsed.notes)}</p>` : ''}
    ${spill}${dropped}
    <div class="wv-rehearsal-actions"><button class="wv-btn wv-btn-sm" id="saveRehearsalDraft" type="button">存为建议笔记（需确认）</button></div>
  </div>`;
  document.querySelector('#saveRehearsalDraft')?.addEventListener('click', () => saveRehearsalDraft(parsed, meta));
}

async function saveRehearsalDraft(parsed, meta) {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const relative = `Research/_runs/p7-rehearsal/${stamp}.md`;
    const content = window.weaverP7Rehearsal.renderRehearsalMarkdown(parsed, { ...meta, at: new Date().toISOString() });
    const draft = await bridgeFetch('/v1/drafts', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ path: relative, content }),
    });
    if (!confirm(`建议笔记已生成预览（${draft.path}）。\n写入后仅是一份草稿笔记，不会改变任何假设账本。确认写入？`)) return;
    await bridgeFetch(`/v1/drafts/${draft.id}/commit`, { method: 'POST' });
    window.researchWeaver.toast(`建议笔记已写入 ${draft.path}`);
  } catch (error) {
    window.researchWeaver.toast(`建议笔记写入失败：${error.message}`);
  }
}

document.querySelector('#runRehearsal')?.addEventListener('click', () => runP7Rehearsal());
chatProjectInput?.addEventListener('change', setChatProjectBinding);
window.addEventListener('weaver:flow-changed', renderChatProjectBinding);
// Idea 树的假设详情卡通过这里按单条假设发起限定范围的结算预演。
window.weaverRehearsal = { run: runP7Rehearsal };
async function saveWorkspace() {
  if (!zhiyanBridge.online) { await connectBridge(); if (!zhiyanBridge.online) return; }
  const root = workspaceInput.value.trim();
  if (!root) return window.researchWeaver.toast('请先填写绝对路径。');
  try {
    showWorkspace(await bridgeFetch('/v1/workspace', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      // The Bridge creates a missing directory only for this explicit, user
      // initiated workspace-selection request.  It never creates one while
      // merely rendering or reading a topic.
      body: JSON.stringify({ root, createMissing: true })
    }));
    window.researchWeaver.toast('课题工作区已更新；缺失目录已创建（如有），后续任务仅能读取此目录。');
  } catch (error) {
    workspaceStatus.textContent = `无法设置课题目录：${error.message}`;
    workspaceStatus.className = 'workspace-status error';
  }
}
async function createResearchTopicFolder(name, workspace) {
  if (!zhiyanBridge.online) { await connectBridge(); if (!zhiyanBridge.online) throw new Error('本机 Bridge 未连接'); }
  const created = await bridgeFetch('/v1/research-topics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, workspace: workspace || workspaceInput.value.trim() }) });
  showWorkspace({ root: created.root, exists: true, isDirectory: true });
  return created;
}
window.createResearchTopicFolder = createResearchTopicFolder;
async function connectBridge(silent = false) { try { await bridgeFetch('/health'); zhiyanBridge.agents = (await bridgeFetch('/v1/agents')).agents; zhiyanBridge.online = true; await loadWorkspace(); await loadProjectRegistry(); const localSkills = await bridgeFetch('/v1/skills'); window.researchWeaver.importFileSkills(localSkills.skills); bridgeStatus(); window.dispatchEvent(new Event('bridge:agents')); if (!silent) window.researchWeaver.toast(`本机 Bridge 已连接：检测到 ${zhiyanBridge.agents.filter((agent) => agent.installed).length} 个 CLI 与 ${localSkills.skills.length} 个本机 Skill`); } catch (error) { zhiyanBridge.online = false; bridgeStatus(); if (!silent) window.researchWeaver.toast(`连接失败：${error.message}`); } }
function safeHtml(text) { return String(text || '').replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char])); }
function formatResult(text) { return safeHtml(text).replace(/\n/g, '<br>'); }
function addStep(title, detail, state = 'pending') { const row = document.createElement('div'); row.className = `run-step ${state === 'pending' ? 'pending' : ''}`; row.dataset.runState = state; row.innerHTML = `<i>${state === 'pending' ? '◌' : state === 'error' ? '!' : state === 'stopped' ? '×' : '✓'}</i><div><b>${safeHtml(title)}</b><br/><small>${safeHtml(detail)}</small></div>`; window.researchWeaver.steps.appendChild(row); schedulePipelineHistoryCheckpoint(); return row; }
function updateStep(row, detail, state = 'done') { row.classList.toggle('pending', state === 'pending'); row.dataset.runState = state; row.querySelector('i').textContent = state === 'pending' ? '◌' : state === 'error' ? '!' : state === 'stopped' ? '×' : '✓'; row.querySelector('small').textContent = detail; schedulePipelineHistoryCheckpoint(); }

// Turns window.weaverQueryLoop.runAuto()'s onProgress({phase, cycle, ...})
// callbacks into a Chinese status line for a step-tracker row.
function describeQueryLoopProgress(p) {
  const tag = `第 ${p.cycle}/${p.maxCycles} 轮`;
  switch (p.phase) {
    case 'build': return `${tag}：构建者（${p.agent}）正在写检索式…`;
    case 'search': return `${tag}：检索式已生成（${p.query}），正在多源并行检索…`;
    case 'critic': return `${tag}：质疑者（${p.agent}${p.shared ? ' · 同 CLI 双角色' : ''}）正在评分（命中 ${p.hits} 条）…`;
    case 'scored': {
      const b = p.breakdown || {};
      return `${tag}：${p.score} 分（相关性 ${b.relevance ?? '-'} /40 · 召回 ${b.recall ?? '-'} /25 · 可执行性 ${b.executability ?? '-'} /15 · 简洁度 ${b.simplicity ?? '-'} /20；阈值 ${p.threshold}）。`;
    }
    case 'accept': return `已达标：第 ${p.cycle} 轮 ${p.best.score} 分，循环收敛。检索式：${p.best.query}`;
    case 'exhausted': return `轮数用尽：已取历史最佳（第 ${p.best.cycle} 轮，${p.best.score} 分）。检索式：${p.best.query}`;
    default: return '正在处理…';
  }
}
// Drives window.weaverQueryLoop.runAuto() against an existing step-tracker
// row. 2026-08-18 重写：去掉了每秒重写的等待计时——那是"长条一直在闪"的
// 来源之一（每秒 textContent 变化 → MutationObserver → 摘要卡重建重播动画），
// 而且用户要的不是秒数，是"到第几轮了、在干什么、每轮检索式和评分"。现在：
// 步骤行只在阶段切换时更新（第几轮 · 构建/检索/评分），每轮评完分在该行
// 下方沉淀一条永久记录（轮次 · 分数 · 检索式），循环结束时行尾给出总结论。
async function runQueryLoopWithStepTicker(row, topic) {
  let currentQuery = '';
  let lastProgress = null;
  // 每轮结果沉淀列表，插在步骤行正下方（下一个 addStep 会自然排在它后面）。
  const logEl = document.createElement('div');
  logEl.className = 'ql-inline-log';
  row.insertAdjacentElement('afterend', logEl);
  updateStep(row, '正在连接 Bridge…', 'pending');
  try {
    return await window.weaverQueryLoop.runAuto(topic, {
      onProgress: (p) => {
        lastProgress = p;
        if (p.phase === 'search' && p.query) currentQuery = p.query;
        updateStep(row, describeQueryLoopProgress(p), 'pending');
        if (p.phase === 'scored') {
          const line = document.createElement('div');
          line.className = 'ql-inline-entry';
          const pass = p.score >= p.threshold;
          const b = p.breakdown || {};
          const penalties = (p.complexity?.penalties || []).map((item) => `${item.reason} -${item.points}`).join('；');
          line.innerHTML = `<b>第 ${p.cycle} 轮</b><span class="ql-score ${pass ? 'pass' : 'revise'}">${p.score} 分</span><span class="wv-mono ql-inline-query">${safeHtml(currentQuery)}</span><small>相关性 ${b.relevance ?? '-'} /40 · 召回 ${b.recall ?? '-'} /25 · 可执行性 ${b.executability ?? '-'} /15 · 简洁度 ${b.simplicity ?? '-'} /20${penalties ? `；复杂度扣分：${safeHtml(penalties)}` : ''}</small>`;
          logEl.appendChild(line);
        }
      },
    });
  } catch (error) {
    const phaseLabels = { build: '构建者生成检索式', search: '用真实文献进行多源检索', critic: '质疑者评分', scored: '汇总评分' };
    const cycle = lastProgress?.cycle ? `第 ${lastProgress.cycle}/${lastProgress.maxCycles} 轮` : '准备阶段';
    const phase = phaseLabels[lastProgress?.phase] || '自动打磨';
    const detail = `${cycle} · ${phase}失败：${error.message}`;
    const wrapped = new Error(detail);
    wrapped.queryLoopFailure = { cycle: lastProgress?.cycle || null, phase: lastProgress?.phase || 'prepare', query: currentQuery };
    throw wrapped;
  }
}
let activeRunControl = null;
let activePipelineHistoryId = null;
let pipelineHistoryTimer = null;
let pipelineArtifactTimer = null;
let activePipelineDownloadedPaths = new Set();

function pipelineHistorySteps() {
  return [...document.querySelectorAll('#runSteps .run-step')].map((row) => ({
    title: row.querySelector('b')?.textContent || '',
    detail: row.querySelector('small')?.textContent || '',
    state: row.dataset.runState || (row.classList.contains('pending') ? 'pending' : 'done'),
  }));
}

async function beginPipelineHistory(title, workspace, parentRunId = null) {
  const record = await bridgeFetch('/v1/pipeline-runs', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title, workspace, parentRunId }),
  });
  activePipelineHistoryId = record.id;
  activePipelineDownloadedPaths = new Set();
  return record;
}

async function checkpointPipelineHistory(extra = {}, explicitId = null) {
  const id = explicitId || activePipelineHistoryId;
  if (!id) return null;
  return bridgeFetch(`/v1/pipeline-runs/${id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ steps: pipelineHistorySteps(), ...extra }),
  });
}

function schedulePipelineHistoryCheckpoint() {
  if (!activePipelineHistoryId) return;
  clearTimeout(pipelineHistoryTimer);
  pipelineHistoryTimer = setTimeout(() => checkpointPipelineHistory({ status: 'running' }).catch(() => {}), 250);
}
function ensureRunControlBar() {
  let bar = document.querySelector('#runControlBar');
  if (!bar) {
    const tabs = document.querySelector('.wv-trackertabs');
    if (!tabs) return null;
    bar = document.createElement('div');
    bar.id = 'runControlBar';
    bar.className = 'wv-run-control is-idle';
    bar.innerHTML = '<span id="runControlStatus">空闲</span><div><button id="pauseRun" type="button" disabled>阶段间暂停</button><button id="stopRun" type="button" disabled>取消本次 Pipeline</button></div>';
    tabs.after(bar);
  }
  if (!bar.dataset.bound) {
    bar.dataset.bound = 'true';
    bar.querySelector('#stopRun').onclick = () => requestStopActiveRun();
    bar.querySelector('#pauseRun').onclick = () => togglePauseActiveRun();
  }
  return bar;
}
function renderRunControl() {
  const bar = ensureRunControlBar();
  if (!bar) return;
  const status = bar.querySelector('#runControlStatus');
  const stop = bar.querySelector('#stopRun');
  const pause = bar.querySelector('#pauseRun');
  const run = activeRunControl;
  const running = Boolean(run && run.status !== 'idle' && run.status !== 'done' && run.status !== 'stopped' && run.status !== 'error');
  bar.classList.toggle('is-idle', !running);
  bar.classList.toggle('is-paused', Boolean(run?.paused));
  status.textContent = run ? `${run.label} · ${run.paused ? '已暂停，等待继续' : run.stopRequested ? '正在取消当前任务' : run.statusText || '运行中'}` : '空闲';
  stop.disabled = !running;
  pause.disabled = !running || Boolean(run?.stopRequested);
  pause.textContent = run?.paused ? '继续' : '阶段间暂停';
}
function startRunControl(kind, label) {
  activeRunControl = { kind, label, status: 'running', statusText: '准备执行', stopRequested: false, paused: false, currentTaskId: null, currentSkillRunId: null, currentStepRow: null };
  renderRunControl();
  return activeRunControl;
}
function finishRunControl(status = 'done', statusText = '已完成') {
  const historyId = activePipelineHistoryId;
  if (historyId && activeRunControl?.kind === 'pipeline') {
    const persistedStatus = status === 'done' ? 'completed' : status === 'stopped' ? (activeRunControl.stopRequested ? 'cancelled' : 'stopped') : status === 'error' ? 'failed' : 'running';
    clearTimeout(pipelineHistoryTimer);
    checkpointPipelineHistory({ status: persistedStatus }, historyId).catch(() => {}).finally(() => {
      if (activePipelineHistoryId === historyId) activePipelineHistoryId = null;
      loadRunHistory().catch(() => {});
    });
  }
  if (activeRunControl) Object.assign(activeRunControl, { status, statusText, currentTaskId: null, currentSkillRunId: null, currentStepRow: null, paused: false });
  renderRunControl();
}
function setRunStatus(text, taskId = null) {
  if (!activeRunControl) return;
  activeRunControl.statusText = text;
  activeRunControl.currentTaskId = taskId;
  renderRunControl();
  schedulePipelineHistoryCheckpoint();
}
async function requestStopActiveRun() {
  if (!activeRunControl) return;
  activeRunControl.stopRequested = true;
  activeRunControl.paused = false;
  const skillRunId = activeRunControl.currentSkillRunId;
  const taskId = activeRunControl.currentTaskId;
  activeRunControl.statusText = skillRunId ? '正在取消当前 Skill' : taskId ? '正在取消当前 Agent task' : '将在当前阶段结束前停止';
  if (activeRunControl.currentStepRow) updateStep(activeRunControl.currentStepRow, '正在取消当前 Skill，请稍候…', 'pending');
  if (skillRunId) {
    try { await bridgeFetch(`/v1/skill-runs/${skillRunId}/cancel`, { method: 'POST' }); }
    catch (error) { window.researchWeaver?.toast?.(`取消当前 Skill 失败：${error.message}`); }
  } else if (taskId) {
    try { await bridgeFetch(`/v1/tasks/${taskId}/cancel`, { method: 'POST' }); }
    catch (error) { window.researchWeaver?.toast?.(`取消当前任务失败：${error.message}`); }
  }
  renderRunControl();
}
function togglePauseActiveRun() {
  if (!activeRunControl || activeRunControl.stopRequested) return;
  activeRunControl.paused = !activeRunControl.paused;
  activeRunControl.statusText = activeRunControl.paused ? '暂停于阶段间隙' : '继续运行';
  renderRunControl();
}
async function checkpointRunControl(label = '阶段') {
  if (!activeRunControl) return;
  if (activeRunControl.stopRequested) throw new Error('用户已停止运行。');
  while (activeRunControl.paused && !activeRunControl.stopRequested) {
    setRunStatus(`已暂停：${label}`);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  if (activeRunControl.stopRequested) throw new Error('用户已停止运行。');
}
async function waitTask(id) { for (let attempt = 0; attempt < 240; attempt++) { const task = await bridgeFetch(`/v1/tasks/${id}`); if (['completed', 'failed', 'cancelled'].includes(task.status)) { const final = task.events.filter((event) => event.type === 'result').at(-1); if (task.status !== 'completed') throw new Error(task.events.filter((event) => event.type === 'error').at(-1)?.text || `任务结束：${task.status}`); return final?.text || '任务完成，但未返回可展示结果。'; } await new Promise((resolve) => setTimeout(resolve, 900)); } throw new Error('等待 Agent 任务超时'); }
async function ensurePreflight(plan) { if (!zhiyanBridge.online) { await connectBridge(); if (!zhiyanBridge.online) throw new Error('本机 Bridge 未连接。'); } const workspace = await loadWorkspace(); if (!workspace.isDirectory) throw new Error('请先设置存在的课题工作区。'); const unavailable = plan.map((node) => ({ node, profile: window.researchWeaver.profile(node.profileId), agent: zhiyanBridge.agents.find((agent) => agent.id === node.ref) })).filter(({ profile, agent }) => !profile || !agent?.installed); if (unavailable.length) throw new Error(`以下 Profile 不可执行：${unavailable.map(({ node, profile }) => `${node.name}（${profile?.adapterId || '未绑定适配器'}）`).join('、')}。请安装对应 CLI 或在画布中替换节点。`); const restricted = plan.filter((node) => node.permission !== 'read'); if (restricted.length) throw new Error(`真实工作流当前仅允许只读节点：${restricted.map((node) => node.name).join('、')}。`); }
function agentPrompt(node, upstream) { const profile = window.researchWeaver.profile(node.profileId); const skill = window.researchWeaver.skill(node.skill); return `任务目标：${window.researchWeaver.taskGoal.value}\n\n允许读取的资料：${window.researchWeaver.taskContext.value}\n\n预期交付物：${window.researchWeaver.taskDeliverable.value}\n\nAgent Profile：${profile.name}\n角色边界：${node.role}\n\nSkill：${skill?.name || '未绑定'}\n任务协议：${skill?.instruction || '仅进行谨慎的只读分析。'}\n输出契约：${skill?.output || node.output}\n\n上游阶段结果（仅作参考，必须自行核对来源）：\n${upstream || '无'}\n\n工作区：${workspaceRoot}\n\n严格只读：不修改文件，不假设未读取资料的内容。输出时区分事实、推断和假设；列出实际读取的相对文件路径与证据位置；说明不确定性、替代解释和下一步验证。\n\n研究质量门（强制）：\n1. 未实际读取的论文、网页或工作区文件不得写成“事实”，不得虚构作者、页码、行号、图号、实验条件或性能数字。仅有 DOI/标题时标为“待核验线索”。\n2. 每个关键结论都必须在“证据账本”中对应一行：主张｜证据类型｜来源 DOI/URL｜定位信息｜读取状态（已读全文/已读摘要/仅线索）｜支持强度。\n3. 明确分开：直接证据、合理推断、未验证假设；不能把裸 Au、光热、光电化学或含额外活性位的体系外推为半导体负载形貌效应。\n4. 对机理主张必须列出至少一个替代解释及排除实验；对 CO₂ 还原结论必须说明碳源同位素、空白、碳平衡、光热与重复性是否已验证。\n5. 最后给出“不可下结论的部分”和带量化验收标准的下一步。`; }
async function executePlan(plan, title) { await ensurePreflight(plan); if (!confirm(`将按画布依赖顺序执行 ${plan.length} 个 Agent Profile。每个阶段只读本机课题工作区，不会自动写入文件。是否继续？`)) return; const { dialog, steps, result } = window.researchWeaver; dialog.showModal(); document.querySelector('#runTitle').textContent = title; steps.innerHTML = ''; result.classList.add('hidden'); const outputs = []; for (let index = 0; index < plan.length; index++) { const node = plan[index], profile = window.researchWeaver.profile(node.profileId), skill = window.researchWeaver.skill(node.skill); const row = addStep(`阶段 ${index + 1} · ${profile.name}`, `执行 Skill：${skill?.name || '未绑定 Skill'}`); try { const upstream = outputs.slice(-3).map((item) => `${item.name}: ${item.text}`).join('\n\n').slice(-12000); const created = await bridgeFetch('/v1/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: profile.adapterId, cwd: workspaceRoot, prompt: agentPrompt(node, upstream), permission: 'read', execute: true }) }); const text = await waitTask(created.id); outputs.push({ name: profile.name, skill: skill?.name || '未绑定 Skill', text }); updateStep(row, '阶段已完成；结果已交给下游阶段。'); } catch (error) { updateStep(row, error.message, 'error'); result.innerHTML = `<h3>工作流已安全停止</h3><p>阶段 ${index + 1} 未完成：${safeHtml(error.message)}</p>`; result.classList.remove('hidden'); return; } }
  result.innerHTML = `<h3>工作流审计结论</h3>${outputs.map((item, index) => `<section class="agent-result"><b>阶段 ${index + 1} · ${safeHtml(item.name)} / ${safeHtml(item.skill)}</b><p>${formatResult(item.text)}</p></section>`).join('')}<small>所有阶段均为只读执行；未自动写入课题笔记。</small>`; result.classList.remove('hidden'); }
async function runCurrentAgent() { const active = window.researchWeaver.getSelectedNode?.(); if (!active || active.type !== 'agent') return window.researchWeaver.toast('请先在画布中选择一个 Agent Profile 节点。'); startRunControl('agent', `Agent：${active.name}`); try { await executePlan([active], `运行 Profile：${active.name}`); finishRunControl('done', 'Agent 已结束'); } catch (error) { finishRunControl(activeRunControl?.stopRequested ? 'stopped' : 'error', error.message); window.researchWeaver.toast(error.message); } }
async function runWorkflow() { startRunControl('workflow', '真实工作流'); try { await executePlan(window.researchWeaver.workflowPlan(), '真实运行整个工作流'); finishRunControl('done', '工作流已结束'); } catch (error) { finishRunControl(activeRunControl?.stopRequested ? 'stopped' : 'error', error.message); window.researchWeaver.toast(error.message); } }
document.querySelector('#connectBridge').onclick = () => connectBridge(false); document.querySelector('#saveWorkspace').onclick = saveWorkspace; document.querySelector('#runCurrentAgent').onclick = runCurrentAgent; document.querySelector('#runWorkflow').onclick = runWorkflow; bridgeStatus(); connectBridge(true);
// Replace the short learner-demo polling window after this script has initialized.
// A literature synthesis can take several minutes, while the Bridge remains cancellable.
setTimeout(() => { waitTask = async (id) => { if (activeRunControl) activeRunControl.currentTaskId = id; renderRunControl(); for (let attempt = 0; attempt < 1000; attempt++) { await checkpointRunControl('等待 Agent 返回'); const task = await bridgeFetch(`/v1/tasks/${id}`); if (['completed', 'failed', 'cancelled'].includes(task.status)) { if (activeRunControl?.currentTaskId === id) activeRunControl.currentTaskId = null; renderRunControl(); const final = task.events.filter((event) => event.type === 'result').at(-1); if (task.status !== 'completed') throw new Error(task.events.filter((event) => event.type === 'error').at(-1)?.text || `Agent task ended: ${task.status}`); return final?.text || 'Agent completed without a displayable final message.'; } await new Promise((resolve) => setTimeout(resolve, 900)); } if (activeRunControl?.currentTaskId === id) activeRunControl.currentTaskId = null; renderRunControl(); throw new Error('Agent task exceeded the 15-minute safety window.'); }; }, 0);
function richMarkdown(source) { const esc = safeHtml(source); const inline = (value) => value.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>'); const lines = esc.split(/\r?\n/); let html = '', inList = false, inTable = false; const close = () => { if (inList) { html += '</ul>'; inList = false; } if (inTable) { html += '</tbody></table>'; inTable = false; } }; for (const raw of lines) { const line = raw.trim(); if (!line) { close(); continue; } if (/^\|.*\|$/.test(line)) { if (/^\|\s*:?-{2,}/.test(line)) continue; if (!inTable) { close(); html += '<table><tbody>'; inTable = true; } html += `<tr>${line.slice(1, -1).split('|').map((cell) => `<td>${inline(cell.trim())}</td>`).join('')}</tr>`; continue; } if (/^#{1,3}\s+/.test(line)) { close(); const level = Math.min(4, line.match(/^#+/)[0].length + 1); html += `<h${level}>${inline(line.replace(/^#+\s+/, ''))}</h${level}>`; continue; } if (/^[-*]\s+/.test(line)) { if (!inList) { close(); html += '<ul>'; inList = true; } html += `<li>${inline(line.replace(/^[-*]\s+/, ''))}</li>`; continue; } close(); html += `<p>${inline(line)}</p>`; } close(); return `<article class="markdown-report">${html}</article>`; }
function markdownInline(element) { return [...element.childNodes].map((child) => { if (child.nodeType === Node.TEXT_NODE) return child.textContent; if (child.tagName === 'STRONG') return `**${markdownInline(child)}**`; if (child.tagName === 'CODE') return `\`${markdownInline(child)}\``; if (child.tagName === 'A') return `[${markdownInline(child)}](${child.href})`; return markdownInline(child); }).join(''); }
function reportSectionToMarkdown(section) { const lines = []; const title = section.querySelector('h3'); if (title) lines.push(`## ${markdownInline(title)}`); for (const element of section.querySelectorAll('.markdown-report > *')) { if (/^H[1-4]$/.test(element.tagName)) lines.push(`${'#'.repeat(Math.min(4, Number(element.tagName.slice(1)) + 1))} ${markdownInline(element)}`); else if (element.tagName === 'P') lines.push(markdownInline(element)); else if (element.tagName === 'UL') lines.push([...element.querySelectorAll(':scope > li')].map((item) => `- ${markdownInline(item)}`).join('\n')); else if (element.tagName === 'TABLE') { const rows = [...element.querySelectorAll('tr')].map((row) => [...row.querySelectorAll('th,td')].map((cell) => markdownInline(cell).trim())); if (rows.length) { lines.push(`| ${rows[0].join(' | ')} |`); lines.push(`| ${rows[0].map(() => '---').join(' | ')} |`); lines.push(...rows.slice(1).map((row) => `| ${row.join(' | ')} |`)); } } } return lines.filter(Boolean).join('\n\n'); }
function proposalActions() { const result = document.querySelector('#runResult'); const accepted = result?.querySelector('.final-report[data-accepted="true"]'); if (!accepted || result.querySelector('.proposal-actions')) return; const actions = document.createElement('div'); actions.className = 'proposal-actions'; actions.innerHTML = '<button type="button" class="button ghost">生成已验收笔记提案</button><small>仅允许写入通过最终报告验收的综合结论；审计附录不会写入。</small>'; actions.querySelector('button').onclick = async () => { const content = `# Research Weaver 研究报告\n\n生成时间：${new Date().toLocaleString('zh-CN')}\n\n${reportSectionToMarkdown(accepted)}`; const target = prompt('保存路径（相对课题工作区，限 .md；不可覆盖已有文件）：', `agent-output/research-report-${new Date().toISOString().slice(0, 10)}.md`); if (!target) return; try { const draft = await bridgeFetch('/v1/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: target, content }) }); const preview = `将新建：${draft.path}\n有效至：${new Date(draft.expiresAt).toLocaleTimeString('zh-CN')}\n\n${draft.content.slice(0, 1200)}${draft.content.length > 1200 ? '\n…' : ''}`; if (!confirm(preview + '\n\n确认写入吗？')) return; await bridgeFetch(`/v1/drafts/${draft.id}/commit`, { method: 'POST' }); window.researchWeaver.toast(`已写入 ${draft.path}`); } catch (error) { window.researchWeaver.toast(`笔记提案失败：${error.message}`); } }; result.appendChild(actions); }
setTimeout(() => { formatResult = richMarkdown; new MutationObserver(proposalActions).observe(document.querySelector('#runResult'), { childList: true, subtree: true }); }, 0);
// Upgrade a graph from a visual checklist into an executable Skill → Agent pipeline.
let activeLiteratureSearch = null;
function executableSkillKind(node, skill) {
  const name = skill?.name || '';
  if (node.type !== 'skill') return null;
  if (node.skill === 'retrieve' || name === 'open-access-literature') return 'literature-search';
  if (node.skill === 'download-open-access') return 'open-access-download';
  if (node.skill === 'evidence' || name === 'research-source-inventory') return 'source-inventory';
  if (name === 'research-query-builder') return 'query-builder';
  if (node.skill === 'research-theory') return 'research-theory-handoff';
  return null;
}
async function executeSkillNode(node, skill, upstream) {
  const kind = executableSkillKind(node, skill);
  if (!kind) return null;
  if (kind === 'source-inventory') {
    const inventory = (await bridgeFetch('/v1/skills')).skills.find((item) => item.name === 'research-source-inventory');
    if (!inventory) throw new Error('research-source-inventory 工具未安装');
    const response = await bridgeFetch('/v1/skills/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skillId: inventory.id, workspace: workspaceRoot }) });
    evidenceInventory = response.manifest;
    return JSON.stringify({ stage: 'source-inventory', ...response.manifest }, null, 2);
  }
  if (kind === 'query-builder') {
    const builder = (await bridgeFetch('/v1/skills')).skills.find((item) => item.name === 'research-query-builder');
    if (!builder) throw new Error('research-query-builder 工具未安装');
    const response = await bridgeFetch('/v1/skills/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skillId: builder.id, workspace: workspaceRoot, input: window.researchWeaver.taskGoal.value }) });
    searchStrategy = response.manifest;
    return JSON.stringify({ stage: 'query-builder', ...response.manifest }, null, 2);
  }
  if (kind === 'literature-search') {
    const query = window.researchWeaver.taskGoal.value;
    const response = await bridgeFetch('/v1/literature/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace: workspaceRoot, query }) });
    activeLiteratureSearch = response;
    for (const record of (response.manifest?.records || [])) { const doi = normalizeDoi(record.doi); if (doi) literatureEvidenceBase.searchedDois.add(doi); }
    return JSON.stringify({ stage: 'openalex-discovery', search_id: response.id, ...response.manifest }, null, 2);
  }
  if (kind === 'research-theory-handoff') return JSON.stringify({ stage: 'research-theory-handoff', status: 'evidence dossier prepared; the single research-theory Agent will begin a persistent dialogue after this workflow.' }, null, 2);
  if (!activeLiteratureSearch) throw new Error('开放全文下载需要一个已完成的上游“课题检索”或 open-access-literature Skill 节点。');
  const candidates = (activeLiteratureSearch.manifest.records || []).filter((record) => record.is_oa && record.pdf_url).slice(0, 12);
  if (!candidates.length) throw new Error('强制下载质量门未通过：本次检索没有可验证的开放 PDF 候选。请调整检索式、增加同义词或由研究者提供合法可访问的全文后重试。');
  const saved = [], failed = [];
  for (const record of candidates) {
    try { saved.push(await bridgeFetch(`/v1/literature/${activeLiteratureSearch.id}/download`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ openalexId: record.openalex_id, confirm: true }) })); }
    catch (error) { failed.push({ title: record.title, doi: record.doi, reason: error.message }); }
  }
  if (!saved.length) throw new Error(`强制下载质量门未通过：已尝试 ${candidates.length} 个开放访问候选，但没有任何文件通过 PDF 验证。失败原因：${failed.map((item) => item.reason).filter(Boolean).slice(0, 3).join('；') || '未知'}`);
  for (const item of saved) { const doi = normalizeDoi(item.doi); if (doi) literatureEvidenceBase.downloadedDois.add(doi); literatureEvidenceBase.downloadedRecords.push({ doi, title: item.title, path: item.path }); }
  return JSON.stringify({ stage: 'open-access-download', mandatory: true, selected_candidates: candidates.length, saved, failed, note: 'Mandatory gate passed: at least one PDF was downloaded and validated before evidence analysis.' }, null, 2);
}

setTimeout(() => {
  const executorFor = (node) => window.researchWeaver.profile(node.profileId) || window.researchWeaver.profiles.find((profile) => profile.adapterId === 'codex') || window.researchWeaver.profiles[0];
  ensurePreflight = async (plan) => { if (!zhiyanBridge.online) { await connectBridge(); if (!zhiyanBridge.online) throw new Error('本机 Bridge 未连接。'); } const workspace = await loadWorkspace(); if (!workspace.isDirectory) throw new Error('请先设置存在的课题工作区。'); const unavailable = plan.filter((node) => !runnableProfile(node)); if (unavailable.length) throw new Error(`以下执行阶段没有可用的本机 Profile：${unavailable.map((node) => node.name).join('、')}`); };
  executePlan = async (plan, title) => { await ensurePreflight(plan); const skillCount = plan.filter((node) => node.type === 'skill').length; if (!confirm(`将执行 ${skillCount} 个 Skill 阶段与 ${plan.length - skillCount} 个 Agent 阶段。所有阶段均只读，结果沿画布连线传递。是否继续？`)) return; const { dialog, steps, result } = window.researchWeaver; dialog.showModal(); document.querySelector('#runTitle').textContent = title; steps.innerHTML = ''; result.classList.add('hidden'); const outputs = []; for (let index = 0; index < plan.length; index++) { const node = plan[index], profile = executorFor(node), skill = window.researchWeaver.skill(node.skill); const label = node.type === 'skill' ? `Skill 阶段 ${index + 1} · ${node.name}` : `Agent 阶段 ${index + 1} · ${profile.name}`; const row = addStep(label, `由 ${profile.name} 执行：${skill?.name || '未绑定 Skill'}`); try { const upstream = outputs.slice(-4).map((item) => `${item.name}: ${item.text}`).join('\n\n').slice(-16000); const runtimeNode = { ...node, profileId: profile.id, permission: 'read' }; const created = await bridgeFetch('/v1/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: profile.adapterId, cwd: workspaceRoot, prompt: agentPrompt(runtimeNode, upstream), permission: 'read', execute: true }) }); const text = await waitTask(created.id); outputs.push({ name: node.name, skill: skill?.name || '未绑定 Skill', text }); updateStep(row, '阶段已完成；结构化结果已传递给下游。'); } catch (error) { updateStep(row, error.message, 'error'); result.innerHTML = `<h3>工作流已安全停止</h3><p>${safeHtml(label)} 未完成：${safeHtml(error.message)}</p>`; result.classList.remove('hidden'); return; } } result.innerHTML = `<h3>工作流审计结论</h3>${outputs.map((item, index) => `<section class="agent-result"><b>阶段 ${index + 1} · ${safeHtml(item.name)} / ${safeHtml(item.skill)}</b>${formatResult(item.text)}</section>`).join('')}<small>Skill 与 Agent 均已实际执行；写入仍需单独确认。</small>`; result.classList.remove('hidden'); };
}, 0);

// The final Agent is a report editor and decision maker, not a fifth copy of the same scan.
// Intermediate output remains available as an audit appendix, while the learner sees one converged report first.
function finalSynthesisProtocol() {
  return `\n\n你是本工作流的最终综合 Agent。不要逐段复述上游输出，也不要把它们简单拼接。请解决上游矛盾，生成一份可供团队决策的正式“证据审计与实验路线决策报告”。\n\n必须严格使用以下结构：\n# 执行摘要\n用不超过 250 字回答：直接证据是否足够、推荐的唯一主路线、最大风险、何时应停止。\n## 研究问题与决策目标\n写出唯一、可证伪的问题，并给出 H0 与 H1。\n## 范围与边界\n明确光催化/光电催化、体系、产物与哪些相邻体系只能作为间接线索。\n## 检索与证据边界\n说明实际执行了什么检索；若没有真实数据库命中数，只能称“检索式设计”，不可伪装成系统检索结果。\n## 统一证据矩阵\n用一个 Markdown 表格，列为：路线｜体系存在性证据｜CO2RR 直接证据｜形貌因果证据｜读取状态｜主要混杂｜结论。A/B/C/D/U 必须评价同一个维度；未知用 U。\n## 核心发现与唯一主决策\n只保留一次优先级：首轮、备选、后续探索；解释为何不选择其它路线。\n## 分级实验漏斗与统计判定\n按 0级材料可控性、1级活性筛选、2级碳源与因果验证、3级机制确认组织。列出主要终点、协变量、批次/重复、判定规则。不要要求不可能完全同时匹配的变量；改为优先固定、实测协变量和统计控制。\n## 停止条件\n写出至少三条明确的 stop/go 条件。\n## 证据账本\n每条关键主张一行：主张｜来源 DOI/URL｜定位｜读取状态｜直接性｜限制。\n## 不可下结论的部分\n明确列出。\n## 参考文献与待核验线索\n完整条目与未核验线索分开。\n\n除上述最终报告外，不输出阶段日志、重复检索式或重复最低证据包。`;
}

function extractLedgerCitations(text) {
  const section = text.split(/##\s*证据账本/)[1];
  if (!section) return [];
  const body = section.split(/\n##\s/)[0] || section;
  return body.split('\n').map((line) => line.trim())
    .filter((line) => line && /｜|\|/.test(line) && /10\.\d{4,9}\//.test(line))
    .map((line) => ({ line, doi: normalizeDoi(line), readAll: /已读全文/.test(line) }))
    .filter((item) => item.doi);
}

// Ground-truth cross-check: a DOI the report claims as "已读全文" (fully read) must
// be one this run actually downloaded and PDF-validated; any other cited DOI must at
// least have appeared in this run's own OpenAlex search results. A DOI that appears
// in neither set was not produced by this run's own retrieval — most likely the agent
// wrote it from memory/training data rather than something it actually looked up here.
function crossCheckLedgerEvidence(text) {
  const citations = extractLedgerCitations(text);
  const unverifiedRead = [...new Set(citations.filter((item) => item.readAll && !literatureEvidenceBase.downloadedDois.has(item.doi)).map((item) => item.doi))];
  const unseen = [...new Set(citations.filter((item) => !item.readAll && !literatureEvidenceBase.searchedDois.has(item.doi) && !literatureEvidenceBase.downloadedDois.has(item.doi)).map((item) => item.doi))];
  const reasons = [];
  if (unverifiedRead.length) reasons.push(`证据账本标注“已读全文”，但本次运行未实际下载并验证该 PDF：${unverifiedRead.join('、')}`);
  if (unseen.length) reasons.push(`证据账本引用的 DOI 未出现在本次实际检索或下载结果中，疑似非本次运行获取：${unseen.join('、')}`);
  return reasons;
}

function finalAcceptance(text) {
  const required = ['执行摘要', '研究问题与决策目标', '范围与边界', '检索与证据边界', '统一证据矩阵', '核心发现与唯一主决策', '分级实验漏斗与统计判定', '停止条件', '证据账本', '不可下结论的部分', '参考文献与待核验线索'];
  const missing = required.filter((heading) => !text.includes(heading));
  const reasons = [...missing.map((heading) => `缺少章节：${heading}`)];
  if (!/读取状态/.test(text)) reasons.push('证据账本未明确读取状态');
  if (!/(DOI|https?:\/\/)/i.test(text)) reasons.push('缺少可追溯 DOI 或 URL');
  if (!/(H0|H₀)/.test(text) || !/(H1|H₁)/.test(text)) reasons.push('缺少 H0/H1');
  if (/阶段\s*[1-9]|阶段性输出|阶段日志/.test(text)) reasons.push('包含阶段草稿或运行日志，而非独立最终报告');
  const citationWarnings = (text.match(/相关报道|facet study|report\b|Nature Communications|Yoshii et al\.?/gi) || []).length;
  if (citationWarnings) reasons.push(`发现 ${citationWarnings} 处可能不可追溯的简称引用；应补全作者、题名、期刊、年份、DOI 与读取状态。`);
  if (!/未实际运行|未执行.*检索|命中数/i.test(text) && !/检索日期.*命中数/is.test(text)) reasons.push('未见可审计的检索日志或明确的“未执行”说明。');
  reasons.push(...crossCheckLedgerEvidence(text));
  return { accepted: reasons.length === 0, reasons };
}

function reportQualityGate(text, acceptance) {
  const notices = (acceptance || finalAcceptance(text)).reasons;
  const status = notices.length ? '需要人工复核（已阻止写入笔记）' : '结构完整，且证据账本 DOI 已通过本次检索/下载记录交叉核验';
  return `<aside class="quality-gate ${notices.length ? 'warning' : 'pass'}"><b>报告质量门：${status}</b>${notices.length ? `<ul>${notices.map((note) => `<li>${safeHtml(note)}</li>`).join('')}</ul>` : '<p>此检查不替代人工文献核验。</p>'}</aside>`;
}

async function repairFinalReport(text, failures) {
  const profile = window.researchWeaver.profiles.find((candidate) => candidate.adapterId === 'codex' && zhiyanBridge.agents.some((agent) => agent.id === 'codex' && agent.installed));
  if (!profile) throw new Error('无法执行最终报告返工：Codex Profile 不可用。');
  const prompt = `你是研究报告的终审编辑。以下草稿未通过机器验收：${failures.join('；')}。\n\n只输出一份完整、独立的最终报告，不要输出解释、阶段日志或任何“阶段 1/2/3”标题。严格遵循下列协议，并把未读来源标为“待核验线索”，不得捏造页码、行号、数值或实验结果。\n${finalSynthesisProtocol()}\n\n待返工草稿：\n${text}`;
  const created = await bridgeFetch('/v1/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: profile.adapterId, cwd: workspaceRoot, prompt, permission: 'read', execute: true }) });
  return waitTask(created.id);
}

setTimeout(() => {
  executePlan = async (plan, title) => {
    await ensurePreflight(plan);
    const skillCount = plan.filter((node) => node.type === 'skill').length;
    if (!plan.some((node) => node.type === 'skill' && node.skill === 'download-open-access')) throw new Error('科研论工作流必须包含“开放全文下载”节点；不下载并验证论文，系统不会生成研究方案。');
    const finalAgentIndex = plan.map((node, index) => node.type === 'agent' ? index : -1).filter((index) => index >= 0).at(-1);
    if (finalAgentIndex === undefined) throw new Error('工作流需要一个最终 Agent Profile 来综合证据。');
    const nonTheoryAgents = plan.filter((node) => node.type === 'agent' && node.profileId !== 'research-theory-agent');
    if (nonTheoryAgents.length) throw new Error('当前为科研论单 Agent 模式；请删除旧的多 Agent 节点，仅保留“科研论主 Agent”。');
    const downloads = plan.filter((node) => executableSkillKind(node, window.researchWeaver.skill(node.skill)) === 'open-access-download').length;
    const acquisitionNote = downloads ? `\n其中包含 ${downloads} 个“开放全文下载”Skill：它将从上游 OpenAlex 开放访问候选中下载最多 12 篇，并仅保存验证为 PDF 的文件到 literature/open-access/。` : '';
    if (!confirm(`将执行 ${skillCount} 个可执行 Skill 节点，并由 1 个科研论主 Agent（Codex）完成证据审计与持续对话。${acquisitionNote}\n\n是否继续？`)) return;
    const { dialog, steps, result } = window.researchWeaver;
    dialog.showModal(); document.querySelector('#runTitle').textContent = title; steps.innerHTML = ''; result.classList.add('hidden');
    resetLiteratureEvidenceBase();
    const outputs = [];
    for (let index = 0; index < plan.length; index++) {
        const node = plan[index];
        const orchestratorAdapter = window.weaverOrchestrator?.getSelectedAgent?.();
        const profile = (orchestratorAdapter
          ? window.researchWeaver.profiles.find((p) => p.adapterId === orchestratorAdapter)
          : null) || window.researchWeaver.profile('research-theory-agent');
        const requested = requestedProfile(node), skill = window.researchWeaver.skill(node.skill);
      const isFinal = index === finalAgentIndex;
        const label = isFinal ? `科研论主 Agent · ${profile.name}` : `Skill 节点 ${index + 1} · ${node.name}`;
        const row = addStep(label, isFinal ? '读取证据底座，开启科研论审计与对话' : `由本机可执行 Skill 完成：${skill?.name || '未绑定 Skill'}`);
      const upstream = outputs.slice(-4).map((item) => `${item.name}:\n${item.text}`).join('\n\n').slice(-18000);
      try {
        const toolKind = executableSkillKind(node, skill);
        if (toolKind) {
          const text = await executeSkillNode(node, skill, upstream);
          outputs.push({ name: node.name, skill: skill?.name || '未绑定 Skill', text, isFinal: false });
          updateStep(row, toolKind === 'open-access-download' ? 'Skill 已完成下载与 PDF 验证；结果已传递给下游。' : '本机 Skill 已实际执行；结构化结果已传递给下游。');
          continue;
        }
        const runtimeNode = { ...node, profileId: profile.id, permission: 'read' };
        const prompt = agentPrompt(runtimeNode, upstream) + (isFinal ? finalSynthesisProtocol() : '');
        const created = await bridgeFetch('/v1/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: profile.adapterId, cwd: workspaceRoot, prompt, permission: 'read', execute: true }) });
        const text = await waitTask(created.id);
        outputs.push({ name: node.name, skill: skill?.name || '未绑定 Skill', text, isFinal });
        updateStep(row, isFinal ? '最终决策报告已完成。' : '阶段已完成；结构化结果已传递给下游。');
      } catch (error) {
        const codexFallback = window.researchWeaver.profiles.find((candidate) => candidate.adapterId === 'codex' && zhiyanBridge.agents.some((agent) => agent.id === 'codex' && agent.installed));
        if (node.type !== 'skill' && profile.adapterId !== 'codex' && codexFallback) {
          try {
            updateStep(row, `${profile.name} 执行失败，正在由 Codex 透明重试：${error.message}`, 'pending');
            const runtimeNode = { ...node, profileId: codexFallback.id, permission: 'read' };
            const retryPrompt = `${agentPrompt(runtimeNode, upstream)}\n\n运行说明：原定 Profile「${profile.name}」在本机实际执行失败；你作为后备执行器，仅按原节点的 Skill 与角色边界完成任务。` + (isFinal ? finalSynthesisProtocol() : '');
            const retry = await bridgeFetch('/v1/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: 'codex', cwd: workspaceRoot, prompt: retryPrompt, permission: 'read', execute: true }) });
            const text = await waitTask(retry.id);
            outputs.push({ name: `${node.name}（由 Codex 后备执行）`, skill: skill?.name || '未绑定 Skill', text, isFinal });
            updateStep(row, '原 Profile 失败；Codex 后备执行已完成并传递给下游。');
            continue;
          } catch (fallbackError) { error = new Error(`${error.message}；Codex 后备执行也失败：${fallbackError.message}`); }
        }
        updateStep(row, error.message, 'error');
        const completed = outputs.length ? `<details class="partial-run" open><summary>保留已完成的 ${outputs.length} 个阶段性结果（不可作为最终结论）</summary>${outputs.map((item, itemIndex) => `<section class="partial-stage"><b>已完成阶段 ${itemIndex + 1} · ${safeHtml(item.name)} / ${safeHtml(item.skill)}</b>${formatResult(item.text)}</section>`).join('')}</details>` : '';
        result.innerHTML = `<h3>工作流已安全停止</h3><p>${safeHtml(label)} 未完成：${safeHtml(error.message)}</p><p>前序阶段结果仅供恢复运行与人工核验；未生成最终综合报告，也不会提供写入笔记的入口。</p>${completed}`;
        result.classList.remove('hidden'); return;
      }
    }
    const finalOutput = outputs.find((item) => item.isFinal) || outputs.at(-1);
    const appendix = outputs.filter((item) => item !== finalOutput);
    let acceptance = finalAcceptance(finalOutput.text);
    if (!acceptance.accepted) {
      const reviewRow = addStep('最终报告质量验收', `发现 ${acceptance.reasons.length} 项缺口，正在由 Codex 返工。`, 'pending');
      try { finalOutput.text = await repairFinalReport(finalOutput.text, acceptance.reasons); acceptance = finalAcceptance(finalOutput.text); updateStep(reviewRow, acceptance.accepted ? '返工后的最终报告通过结构与可追溯性验收。' : `返工后仍不合格：${acceptance.reasons.join('；')}`, acceptance.accepted ? 'done' : 'error'); }
      catch (error) { acceptance = { accepted: false, reasons: [...acceptance.reasons, `自动返工失败：${error.message}`] }; updateStep(reviewRow, acceptance.reasons.at(-1), 'error'); }
    }
    const acceptanceNotice = acceptance.accepted ? '<p><b>最终验收：通过。</b>该报告可生成待确认笔记提案；仍需研究者核验关键来源。</p>' : `<aside class="quality-gate warning"><b>最终验收：未通过，禁止写入笔记。</b><ul>${acceptance.reasons.map((reason) => `<li>${safeHtml(reason)}</li>`).join('')}</ul></aside>`;
    result.innerHTML = `<h3>证据底座与初步研究决策</h3><section class="agent-result final-report" data-accepted="${acceptance.accepted}"><b>科研论主 Agent · ${safeHtml(finalOutput.name)}</b>${formatResult(finalOutput.text)}${acceptanceNotice}${reportQualityGate(finalOutput.text, acceptance)}</section><details class="audit-appendix"><summary>展开 Skill 审计附录：${appendix.length} 个阶段性输出</summary>${appendix.map((item, index) => `<section class="agent-result"><b>附录阶段 ${index + 1} · ${safeHtml(item.name)} / ${safeHtml(item.skill)}</b>${formatResult(item.text)}</section>`).join('')}</details><small>科研论会保留本浏览器中的项目对话记忆；开放全文下载仅保存经确认且验证为 PDF 的文件。</small>`;
    result.classList.remove('hidden');
    latestTheoryDossier = outputs.map((item) => `${item.name}\n${item.text}`).join('\n\n').slice(-28000);
    try { renderTheoryReply(await runResearchTheory()); } catch (error) { result.insertAdjacentHTML('beforeend', `<aside class="quality-gate warning"><b>科研论对话未启动</b><p>${safeHtml(error.message)}</p></aside>`); }
  };
}, 30);

// Execute the first concrete, local Skill before a scientific workflow starts.
// This prevents an LLM from mistaking application code or earlier reports for
// literature/experiment evidence when the user selected the wrong workspace.
setTimeout(() => {
  const priorPreflight = ensurePreflight;
  const priorAgentPrompt = agentPrompt;
  agentPrompt = (node, upstream) => `${priorAgentPrompt(node, upstream)}\n\n本机资料盘点清单（只读工具实际生成）：\n${evidenceInventory ? JSON.stringify(evidenceInventory) : '未生成清单'}\n\n本机检索式策略（只读工具实际生成，尚未执行数据库检索）：\n${searchStrategy ? JSON.stringify(searchStrategy) : '未生成检索式'}`;
  ensurePreflight = async (plan) => {
    await priorPreflight(plan);
    const skills = await bridgeFetch('/v1/skills');
    const inventory = skills.skills.find((item) => item.name === 'research-source-inventory');
    if (!inventory) throw new Error('未找到 research-source-inventory 本机 Skill；请重新启动 Research Weaver。');
    const response = await bridgeFetch('/v1/skills/run', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ skillId: inventory.id, workspace: workspaceRoot })
    });
    evidenceInventory = response.manifest;
    const queryBuilder = skills.skills.find((item) => item.name === 'research-query-builder');
    if (queryBuilder) {
      const query = await bridgeFetch('/v1/skills/run', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ skillId: queryBuilder.id, workspace: workspaceRoot, input: window.researchWeaver.taskGoal.value })
      });
      searchStrategy = query.manifest;
    }
    const scientificTask = /课题|文献|实验|催化|CO2|CO₂|材料|证据/i.test(`${window.researchWeaver.taskGoal.value}\n${window.researchWeaver.taskContext.value}`);
    const hasAcquisitionSkill = plan.some((node) => ['retrieve', 'download-open-access'].includes(node.skill) || ['open-access-literature', 'open-access-download'].includes(window.researchWeaver.skill(node.skill)?.name));
    if (scientificTask && evidenceInventory.no_scientific_sources_found && !hasAcquisitionSkill) {
      throw new Error(`资料盘点未发现可用的论文、实验记录、参考文献导出或数据集（已扫描 ${evidenceInventory.files_scanned} 个文件）。请在画布中加入“课题检索”和“开放全文下载”Skill，或切换到已有资料的 Vault/项目目录；系统不会用程序代码或旧报告替代科学证据。`);
    }
  };
}, 60);

// OpenAlex matches `search=` against English titles and abstracts. Handing it a
// Chinese topic string returns zero hits over a perfectly successful HTTP 200 —
// which is precisely how "检索开放文献" looked broken while nothing was actually
// failing. So the topic is turned into a real Boolean query before the search.
const CJK_PATTERN = /[㐀-鿿぀-ヿ가-힯]/;

async function agentBooleanQuery(topic, draft) {
  const profile = window.researchWeaver.profiles.find((candidate) => candidate.adapterId === 'codex'
    && zhiyanBridge.agents.some((agent) => agent.id === 'codex' && agent.installed));
  if (!profile) return null;
  const prompt = `你是文献检索式工程师。把下面的研究主题转换成一个可直接用于 OpenAlex 的英文 Boolean 检索式。\n\n研究主题（可能是中文）：${topic}\n\n已有草稿（可能为空或仍含中文）：${draft || '（无）'}\n\n要求：\n1. 只用英文检索词；中文概念必须翻译成该领域的标准英文术语。\n2. 用 AND 连接概念块，块内用 OR，块要加圆括号。\n3. 不得使用通配符 * 或 ?（OpenAlex 会拒绝带通配符的引号短语）。\n4. 覆盖主题里出现的每一个核心概念，不要自行增加主题没有的限定。\n\n只输出一行，格式严格为：\nQUERY: <检索式>\n不要输出任何解释、Markdown 代码块或多余文字。`;
  const created = await bridgeFetch('/v1/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: profile.adapterId, cwd: workspaceRoot, prompt, permission: 'read', execute: true }) });
  const raw = await waitTask(created.id);
  const match = raw.match(/QUERY:\s*(.+)/i);
  const built = (match ? match[1] : (raw.split(/\r?\n/).find((line) => line.trim()) || '')).trim().replace(/^["'`]+|["'`]+$/g, '');
  return built && !CJK_PATTERN.test(built) ? built : null;
}

async function discoveryQuery(topic) {
  const notes = [];
  let query = '';
  try {
    const skills = (await bridgeFetch('/v1/skills')).skills;
    const built = await runPipelineSkill(skills, 'literature-search-query-builder', topic);
    const matrix = built.manifest?.concept_matrix || [];
    // The builder emits a single block literally named "topic" when it could not
    // recognise any concept — that is its way of saying "unparsed", and passing
    // it through would just resend the raw Chinese string.
    const recognised = matrix.some((block) => block.block !== 'topic');
    const candidate = String(built.manifest?.query_v0 || '').trim();
    if (candidate && recognised) { query = candidate; notes.push('literature-search-query-builder 生成'); }
    else notes.push('检索式生成器未识别出该主题中的概念');
  } catch (error) { notes.push(`检索式生成器不可用：${error.message}`); }

  if (!query || CJK_PATTERN.test(query)) {
    try {
      const translated = await agentBooleanQuery(topic, query);
      if (translated) { query = translated; notes.push('Codex 译为英文 Boolean 检索式'); }
      else notes.push('未找到可用的 Codex 适配器，无法自动翻译检索式');
    } catch (error) { notes.push(`Codex 构造检索式失败：${error.message}`); }
  }
  return { query, notes };
}

// Dropping the last AND-block is the cheapest honest way to widen a query that
// came back empty; anything smarter would be guessing at the researcher's intent.
function broadenQuery(query) {
  const blocks = query.match(/\([^()]*\)/g);
  if (!blocks || blocks.length < 2) return null;
  return blocks.slice(0, -1).join(' AND ');
}

// The result list lives in a 288px rail, so a card carries only what identifies
// a paper — title, authors, venue, DOI — plus tags derived from real metadata.
// The abstract is collapsed rather than truncated: a 400-character wall made the
// list unreadable, but silently discarding the rest would hide evidence.
// Note this is the abstract, deliberately not an LLM "summary": the search step
// has not read anything yet, and a generated summary here would be a fabrication.
function literatureCard(record) {
  const doi = String(record.doi || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  const doiHref = `https://doi.org/${encodeURI(doi).replace(/"/g, '%22')}`;
  const meta = [record.authors, record.year, record.venue].filter(Boolean).map((part) => safeHtml(String(part)));
  const abstract = String(record.abstract || '').replace(/\s+/g, ' ').trim();
  const tags = [];
  if (record.is_oa && record.pdf_url) tags.push('<span class="lit-tag lit-tag-oa">开放全文</span>');
  else if (record.is_oa) tags.push('<span class="lit-tag lit-tag-oa">开放访问</span>');
  else tags.push('<span class="lit-tag lit-tag-meta">仅元数据</span>');
  if (record.type) tags.push(`<span class="lit-tag">${safeHtml(record.type)}</span>`);
  if (record.oa_status && record.oa_status !== 'closed') tags.push(`<span class="lit-tag">${safeHtml(record.oa_status)}</span>`);
  if (typeof record.cited_by_count === 'number') tags.push(`<span class="lit-tag">被引 ${record.cited_by_count}</span>`);
  return `<article class="literature-card">`
    + `<b class="lit-title">${safeHtml(record.title || '无标题')}</b>`
    + `<div class="lit-meta">${meta.join(' · ') || '作者与期刊未提供'}</div>`
    + (doi ? `<a class="lit-doi" href="${doiHref}" target="_blank" rel="noreferrer">${safeHtml(doi)}</a>` : '<div class="lit-doi lit-doi-none">无 DOI</div>')
    + (abstract
      ? `<details class="lit-abstract"><summary>${safeHtml(abstract)}</summary><p>${safeHtml(abstract)}</p></details>`
      : '<div class="lit-abstract-none">未提供摘要</div>')
    + `<div class="lit-tags">${tags.join('')}</div>`
    + (record.is_oa && record.pdf_url ? `<button class="button ghost download-oa" data-openalex-id="${safeHtml(record.openalex_id)}">抓取并验证 PDF（full 车道）</button>` : '')
    + `</article>`;
}

// 检索结果卡片上「抓取并验证 PDF（full 车道）」按钮的统一接线——实时检索和
// 历史重开共用。设计稿 §9：full 车道每次派发必须经人工确认，所以这里只能
// 预填并打开对话框（用户再点"生成操作预览 → 确认并派发"），不能自动派发。
function wireOaDownloadButtons(container, records) {
  container.querySelectorAll('.download-oa').forEach((button) => {
    button.onclick = async () => {
      const record = (records || []).find((r) => String(r.openalex_id) === String(button.dataset.openalexId));
      const prefill = window.weaverFullLaneCore.buildFetchPromptFromRecord(record);
      try {
        if (!zhiyanBridge.online) await connectBridge();
        if (!zhiyanBridge.online) throw new Error('本机 Bridge 未连接。');
        if (!prefill) throw new Error('该记录缺少 DOI 和标题，无法预填。');
        openFullLaneDialog(prefill);
      } catch (error) { window.researchWeaver.toast(error.message); }
    };
  });
}

// Replaces the old two-native-prompt() flow (enter topic → then edit the
// generated query in a second prompt()) with one non-blocking dialog. The
// dialog only collects the topic now — query construction is no longer a
// manual "快速生成检索式"/"打磨检索式" button the researcher has to click and
// wait on inside a separate window. Confirming the topic kicks off the
// automatic builder/critic loop (window.weaverQueryLoop.runAuto) inline, in
// the same step tracker the search itself reports into — see the
// #searchLiterature click handler below.
function ensureSearchTopicDialog() {
  let dialog = document.querySelector('#searchTopicDialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'searchTopicDialog';
  dialog.className = 'registry-dialog pipeline-topic-dialog';
  dialog.innerHTML = `
    <form method="dialog" class="pipeline-topic-form" onsubmit="return false">
      <div class="run-header">
        <div><span class="eyebrow">LITERATURE SEARCH</span><h2>检索开放文献</h2></div>
        <button type="button" class="pipeline-topic-close" aria-label="关闭">×</button>
      </div>
      <div class="pipeline-topic-body">
        <label>检索主题（可用中文）<textarea id="searchTopicInput" rows="4"></textarea></label>
        <p class="wv-faint">确认后会自动用构建者/质疑者双 Agent 由简到繁打磨检索式（真实检索 + 分项评分，最多 3 轮且每轮只改一个组件），再据此查询各数据库。打磨过程会显示评分依据，不再只给一个不透明总分。</p>
      </div>
      <footer class="pipeline-topic-actions">
        <button type="button" class="button ghost search-topic-cancel">取消</button>
        <button type="button" class="button primary" id="searchTopicSubmitBtn">确认并开始检索</button>
      </footer>
    </form>`;
  document.body.appendChild(dialog);
  return dialog;
}

function confirmSearchTopic() {
  const dialog = ensureSearchTopicDialog();
  const topicInput = dialog.querySelector('#searchTopicInput');
  const submitBtn = dialog.querySelector('#searchTopicSubmitBtn');
  const close = dialog.querySelector('.pipeline-topic-close');
  const cancel = dialog.querySelector('.search-topic-cancel');

  topicInput.value = (window.researchWeaver?.taskGoal?.value || '').trim();

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      submitBtn.removeEventListener('click', onSubmit);
      close.removeEventListener('click', onCancel);
      cancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
      resolve(value);
    };
    const onCancel = (event) => { event?.preventDefault?.(); finish(null); };
    const onSubmit = () => {
      const topic = topicInput.value.trim();
      if (!topic) { window.researchWeaver?.toast?.('请先写明检索主题。'); topicInput.focus(); return; }
      finish({ topic });
    };
    submitBtn.addEventListener('click', onSubmit);
    close.addEventListener('click', onCancel);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
    topicInput.focus();
  });
}

// OpenAlex supplies discovery metadata; a file is written only after an
// explicit second confirmation and only when the response validates as a PDF.
document.querySelector('#searchLiterature').onclick = async () => {
  try {
    if (!zhiyanBridge.online) await connectBridge();
    if (!zhiyanBridge.online) throw new Error('本机 Bridge 未连接。');
    const workspace = await loadWorkspace();
    if (!workspace.isDirectory) throw new Error('请先设置存在的课题工作区。');
    const confirmedTopic = await confirmSearchTopic();
    if (!confirmedTopic) return;
    const topic = confirmedTopic.topic;
    const { dialog, steps, result } = window.researchWeaver;
    dialog.showModal(); document.querySelector('#runTitle').textContent = '开放文献检索';
    steps.innerHTML = ''; result.classList.add('hidden');

    // Query construction is now fully automatic: the builder/critic loop
    // runs inline against this step row (no separate window, no manual
    // "打磨检索式" click). If no Agent CLI is installed at all, fall back to
    // the deterministic heuristic drafter so the feature still works.
    const rowQuery = addStep('第 1 步 · 自动打磨检索式（双 Agent：构建者 + 质疑者）', '正在准备…');
    let query;
    try {
      const loopResult = await runQueryLoopWithStepTicker(rowQuery, topic);
      query = loopResult.query;
      updateStep(rowQuery, `第 ${loopResult.cycle} 轮，${loopResult.score} 分，检索式：${query}`);
    } catch (error) {
      updateStep(rowQuery, `自动打磨未完成（${error.message}），改用规则生成的检索式草稿。`, 'error');
      const drafted = await discoveryQuery(topic);
      query = drafted.query;
      if (!query) throw new Error(`未能生成检索式：${drafted.notes.join('；')}`);
      addStep('第 1 步（备用）· 规则生成检索式草稿', `检索式：${query}（${drafted.notes.join('；')}）`);
    }

    const rowSearch = addStep('第 2 步 · 多源元数据检索（OpenAlex / PubMed / Semantic Scholar / Scopus，各源已按自身语法自动改写检索式）', '正在检索…');
    const runSearch = (value) => bridgeFetch('/v1/literature/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace: workspaceRoot, query: value }) });
    let search = await runSearch(query);
    let usedQuery = query;
    if (!(search.manifest.records || []).length) {
      const wider = broadenQuery(query);
      if (wider) {
        updateStep(rowSearch, `原检索式 0 条；正在放宽后重试：${wider}`, 'pending');
        const retry = await runSearch(wider);
        if ((retry.manifest.records || []).length) { search = retry; usedQuery = wider; }
      }
    }
    const found = (search.manifest.records || []).length;
    const sourceBreakdown = (search.sources || []).map((s) => s.ok ? `${s.source} ${s.count}` : `${s.source} 失败`).join(' · ');
    updateStep(
      rowSearch,
      found
        ? `返回 ${found} 条记录（去重后）。${sourceBreakdown}。实际检索式：${usedQuery}`
        : `0 条。${sourceBreakdown || '各数据源均未返回结果'}；请确认检索式术语准确，或检查各数据源的 API key 是否已配置。`,
      found ? 'done' : 'error'
    );
    const records = search.manifest.records || [];
    const downloadable = records.filter((record) => record.is_oa && record.pdf_url);
    result.innerHTML = `<h3>检索结果（尚未作为科学证据）</h3><p>每条记录的「抓取」按钮会打开完整权限车道对话框并预填该文献信息——Agent 联网定位开放获取 PDF、Bridge 校验后保存到 <code>literature/downloaded-pdfs/</code>，你确认操作预览后才会派发；「下载全部」走旧的直接下载通道（无 Agent 参与），保存到 <code>literature/open-access/</code>。其他记录仅是 DOI/摘要线索。</p>${downloadable.length ? `<button class="button primary download-all-oa">下载全部 ${downloadable.length} 条开放访问候选</button>` : ''}<div class="literature-results">${records.map(literatureCard).join('')}</div><small>检索服务：${safeHtml(sourceBreakdown || 'OpenAlex / PubMed / Semantic Scholar / Scopus')}；原始主题：${safeHtml(topic)}；实际检索式：${safeHtml(usedQuery)}。</small>`;
    result.classList.remove('hidden');
    wireOaDownloadButtons(result, records);
    loadRunHistory(); // 本次检索已落盘，刷新历史列表
    result.querySelector('.download-all-oa')?.addEventListener('click', async (event) => {
      if (!confirm(`将逐条尝试下载 ${downloadable.length} 个开放访问候选，并仅保存验证为 PDF 的文件。可能有部分链接失效或返回非 PDF。是否继续？`)) return;
      const button = event.currentTarget; button.disabled = true; let saved = 0, failed = 0;
      for (const record of downloadable) {
        try { await bridgeFetch(`/v1/literature/${search.id}/download`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ openalexId: record.openalex_id, confirm: true }) }); saved++; }
        catch { failed++; }
        button.textContent = `下载中：成功 ${saved}，未保存 ${failed}`;
      }
      button.textContent = `批量下载结束：成功 ${saved}，未保存 ${failed}`;
      window.researchWeaver.toast(`开放访问批量下载完成：成功 ${saved}，未保存 ${failed}。现在可运行资料盘点与分析流程。`);
    });
  } catch (error) { window.researchWeaver.toast(`文献检索失败：${error.message}`); }
};

// --- One-click literature pipeline (research-pipeline.json) -------------------
// Drives the 12 bundled research Skills end to end through /v1/skills/run,
// threading each step's real output into the next step's input exactly as
// declared in research-pipeline.json, and enforcing that file's own stop_rules
// instead of inventing new behavior. Every step is a real local Skill run
// (Python scripts under skills/*/scripts), not a simulated/LLM-narrated result.
function pipelineSkillId(skills, slug) {
  // bridge.config.json's skillDirectories now scans several unrelated folders
  // (global .codex/skills, other vault paths, etc.) besides this pipeline's own
  // agent-canvas-demo/skills. A stray same-named SKILL.md elsewhere (different
  // script, missing script, or just a path Windows chokes on — this is how the
  // ENAMETOOLONG failure happened) must never silently win over the pipeline's
  // own bundled copy, so prefer a match that actually lives under this project.
  const needle = `/${String(slug).toLowerCase()}/skill.md`;
  const candidates = skills.filter((item) => String(item.id || '').toLowerCase().endsWith(needle));
  if (!candidates.length) throw new Error(`未找到本机 Skill：${slug}（请确认 Bridge 已扫描到 skills/${slug}）`);
  const preferred = candidates.find((item) => String(item.id || '').toLowerCase().includes('/agent-canvas-demo/skills/'));
  if (candidates.length > 1 && !preferred) {
    console.warn(`Pipeline: 多个同名 Skill "${slug}" 且都不在 agent-canvas-demo/skills 下，使用第一个匹配：${candidates[0].id}`);
  }
  return (preferred || candidates[0]).id;
}
async function runPipelineSkill(skills, slug, input, options = {}) {
  await checkpointRunControl(`准备运行 ${slug}`);
  setRunStatus(`正在运行 Skill：${slug}`);
  const created = await bridgeFetch('/v1/skill-runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skillId: pipelineSkillId(skills, slug), workspace: workspaceRoot, input: input || '' }) });
  if (activeRunControl) {
    activeRunControl.currentSkillRunId = created.id;
    activeRunControl.currentStepRow = options.row || null;
    renderRunControl();
  }
  try { return await pollSkillRun(created.id, slug, options); }
  finally {
    if (activeRunControl?.currentSkillRunId === created.id) {
      activeRunControl.currentSkillRunId = null;
      activeRunControl.currentStepRow = null;
    }
  }
}
// Poll async skill runs so a dead task can never show "运行中" forever:
// each poll proves the Bridge is alive, the run record proves the child
// process is alive, and lastOutputAt (stdout + downloader progress-file
// mtime, tracked server-side) separates "quiet but running" from "stuck".
// Downloads legitimately take 30-40 min, so the silence threshold is
// generous. See bridge/server.js "Async skill runs".
const SKILL_RUN_SILENCE_WARN_MS = 5 * 60 * 1000;
const SKILL_RUN_SILENCE_STOP_MS = 25 * 60 * 1000;
async function pollSkillRun(runId, slug, options = {}) {
  let pollFailures = 0;
  for (;;) {
    await checkpointRunControl(`运行 ${slug}`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    let run;
    try {
      run = await bridgeFetch(`/v1/skill-runs/${runId}`);
      pollFailures = 0;
    } catch (error) {
      pollFailures += 1;
      setRunStatus(`正在运行 Skill：${slug}（Bridge 连接异常，第 ${pollFailures} 次重试）`);
      if (pollFailures >= 3) throw new Error(`Bridge 连接中断，${slug} 已停止：无法确认任务状态，请勿假定它仍在运行。`);
      continue;
    }
    if (run.status === 'completed') { await checkpointRunControl(`${slug} 已完成`); return run.output; }
    if (run.status === 'failed') throw new Error(run.error || `${slug} 执行失败`);
    if (run.status === 'cancelled') throw new Error(`用户已取消 ${slug}。`);
    const elapsedMs = Date.now() - run.startedAt;
    const elapsedMin = Math.max(1, Math.round(elapsedMs / 60000));
    const elapsedText = elapsedMs < 60000 ? `${Math.max(1, Math.round(elapsedMs / 1000))} 秒` : `${elapsedMin} 分钟`;
    const silentMs = Date.now() - run.lastOutputAt;
    if (silentMs > SKILL_RUN_SILENCE_STOP_MS) {
      throw new Error(`${slug} 已停止：超过 ${Math.round(SKILL_RUN_SILENCE_STOP_MS / 60000)} 分钟无任何进展信号，判定为卡死（已运行 ${elapsedMin} 分钟）。请查看该 Skill 的日志后重跑。`);
    }
    const silentMin = Math.floor(silentMs / 60000);
    const progress = run.progress;
    const completed = Number.isFinite(progress?.completed) ? progress.completed : progress?.done;
    const countText = Number.isFinite(completed) && Number.isFinite(progress?.total)
      ? `${completed}/${progress.total}` : '';
    const currentFile = progress?.current_file || progress?.current;
    const currentText = currentFile ? `：${String(currentFile).slice(0, 100)}` : '';
    const phaseText = progress?.phase === 'finalizing_sources' ? ' · 并行来源已跑完，正在汇总' : '';
    const stateText = run.status === 'cancelling' ? '正在取消' : `正在运行 Skill：${slug}`;
    setRunStatus(`${stateText}${countText ? ` · ${countText}${currentText}${phaseText} · ${elapsedText}` : `（已运行 ${elapsedText}${silentMin >= SKILL_RUN_SILENCE_WARN_MS / 60000 ? `，已 ${silentMin} 分钟无输出` : ''}）`}`);
    if (options.row && countText) updateStep(options.row, `${run.status === 'cancelling' ? '正在取消' : progress?.phase === 'finalizing_sources' ? '正在汇总' : '正在并行获取'} ${countText}${currentText}`, 'pending');
  }
}
async function runPipelineSkillWithRetry(skills, slug, input, attempts = 2) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const output = await runPipelineSkill(skills, slug, input);
      if (!output?.manifest?.error) return output;
      lastError = new Error(output.manifest.error);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      try { await connectBridge(); } catch {}
    }
  }
  return { manifest: { error: lastError?.message || `${slug} failed after retry`, records: [] } };
}
let webvpnSessionOk = false;
try { webvpnSessionOk = sessionStorage.getItem('weaver.webvpn') === 'ok'; } catch {}
function updateWebvpnButton() {
  const btn = document.querySelector('#refreshWebvpn');
  if (!btn) return;
  if (webvpnSessionOk) {
    btn.classList.add('webvpn-ok');
    btn.innerHTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>已登录 WebVPN';
  } else {
    btn.classList.remove('webvpn-ok');
    btn.innerHTML = '<svg class="ic" viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>登录/刷新 WebVPN';
  }
}
updateWebvpnButton();
// mode=login runs detached, so its stdout is discarded by the Bridge. It writes
// the same manifest to Scholarium/runtime/webvpn-login-status.json; poll that
// through the read-only workspace-file endpoint to learn the real outcome.
// --- download progress bar ---------------------------------------------------
// scansci_download.js writes Scholarium/runtime/download-progress.json after
// every DOI. This only works because that skill is marked async:true in the
// Bridge's SKILL_RUNNERS — under spawnSync the Bridge's event loop is blocked
// for the whole batch and these polls would queue up unanswered until the end.
const DOWNLOAD_PROGRESS_PATH = 'Scholarium/runtime/download-progress.json';
// A downloader child can die (crash, get killed, lose its WebVPN session mid-run)
// without ever getting the chance to write a final status - the file is then
// left at status:"running" forever, and this poller previously had no way to
// tell that apart from a genuinely slow download. mtimeMs (added to
// /v1/workspace-file's response alongside this fix) is the file's own real
// last-write time, so "how long since this actually changed" needs no extra
// bookkeeping: it's just Date.now() - mtimeMs, checked fresh on every read,
// including the very first one after a page reload (a stale file is stale
// immediately, not just once the poller has watched it fail to move for a
// while). 3 minutes is generous relative to a single DOI attempt (the skills
// writing this file report one line per DOI processed) but far short of the
// scansci-institutional/paper-downloader child-process timeouts (40/30 min).
const DOWNLOAD_STALE_MS = 3 * 60 * 1000;
// Past this much silence on a status:"running" file, "maybe stopped" stops being
// a fair hedge - the downloader child is dead. Treated the same as a genuine
// terminal status from here down: the poller stops, and (matching the existing
// "do not resurrect a completed card on reload" rule below) it will not come
// back after a page reload either. 15min is generous relative to the 3min
// stale hedge but still well inside a single-page browsing session, so a truly
// slow-but-alive batch won't get silently buried before the user can see it.
const DOWNLOAD_DEAD_MS = 15 * 60 * 1000;
const downloadProgressStore = window.weaverDownloadProgress || (window.weaverDownloadProgress = { state: null, updatedAt: 0 });
downloadProgressStore.staleThresholdMs = DOWNLOAD_STALE_MS;
downloadProgressStore.deadThresholdMs = DOWNLOAD_DEAD_MS;
let downloadProgressPoller = null;
function publishDownloadProgress(state) {
  if (!state || typeof state !== 'object') return;
  downloadProgressStore.state = state;
  downloadProgressStore.updatedAt = Date.now();
  window.dispatchEvent(new CustomEvent('weaver:download-progress', { detail: state }));
}
window.addEventListener('weaver:download-progress', (event) => {
  if (!activePipelineHistoryId || !Array.isArray(event.detail?.downloaded_paths)) return;
  for (const item of event.detail.downloaded_paths) if (item) activePipelineDownloadedPaths.add(String(item));
  if (!activePipelineDownloadedPaths.size) return;
  clearTimeout(pipelineArtifactTimer);
  pipelineArtifactTimer = setTimeout(() => checkpointPipelineHistory({
    status: 'running', resumeFrom: 'nature-reader',
    artifacts: { downloadedPaths: [...activePipelineDownloadedPaths] },
  }).catch(() => {}), 300);
});
function withStaleness(state, mtimeMs) {
  const staleMs = state?.status === 'running' && typeof mtimeMs === 'number' ? Math.max(0, Date.now() - mtimeMs) : 0;
  return { ...state, __staleMs: staleMs };
}
function startDownloadProgressPolling() {
  if (downloadProgressPoller) return downloadProgressPoller;
  downloadProgressPoller = (async () => {
    for (;;) {
      try {
        const res = await bridgeFetch(`/v1/workspace-file?path=${encodeURIComponent(DOWNLOAD_PROGRESS_PATH)}`);
        if (res?.exists && res.content) {
          const state = JSON.parse(res.content);
          const withStale = withStaleness(state, res.mtimeMs);
          publishDownloadProgress(withStale);
          // A dead-but-still-"running" file never flips state.status on its own -
          // without the staleness check this loop would poll it every 1.2s forever.
          if ((state.status && state.status !== 'running') || withStale.__staleMs > DOWNLOAD_DEAD_MS) break;
        }
      } catch { /* transient Bridge/file update failures are retried */ }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  })().finally(() => { downloadProgressPoller = null; });
  return downloadProgressPoller;
}
async function restoreDownloadProgress() {
  try {
    const res = await bridgeFetch(`/v1/workspace-file?path=${encodeURIComponent(DOWNLOAD_PROGRESS_PATH)}`);
    if (!res?.exists || !res.content) return;
    const state = JSON.parse(res.content);
    const withStale = withStaleness(state, res.mtimeMs);
    publishDownloadProgress(withStale);
    // Dead-on-arrival (stale past DOWNLOAD_DEAD_MS on the very first read after a
    // reload): shell-ui.js's refreshDownloadProgress() treats this the same as a
    // real terminal status and will not resurrect the card, so there is nothing
    // left to poll for.
    if (state.status === 'running' && withStale.__staleMs <= DOWNLOAD_DEAD_MS) startDownloadProgressPolling();
  } catch { /* the Bridge may still be starting */ }
}
window.setTimeout(restoreDownloadProgress, 0);
function attachProgressBar(row) {
  let bar = row.querySelector('.wv-download-inline-progress');
  if (bar) return bar;
  const host = document.createElement('div');
  // Mark this separately from the tracker-header progress indicator.  shell-ui
  // ignores mutations below this node, so a DOI tick cannot rebuild the chat.
  host.className = 'wv-progress wv-download-inline-progress';
  host.style.cssText = 'margin-top:6px;display:flex;align-items:center;gap:8px;';
  host.innerHTML = '<div style="flex:1;height:6px;border-radius:3px;background:rgba(127,127,127,.25);overflow:hidden">'
    + '<div class="wv-progress-fill" style="height:100%;width:0%;background:currentColor;transition:width .3s"></div></div>'
    + '<small class="wv-progress-text" style="white-space:nowrap;opacity:.85"></small>';
  row.querySelector('div').appendChild(host);
  return host;
}
function renderProgress(row, state) {
  const host = attachProgressBar(row);
  const total = Number(state?.total) || 0;
  const done = Number(state?.done) || 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  host.querySelector('.wv-progress-fill').style.width = `${pct}%`;
  const current = String(state?.current || '').slice(0, 42);
  const skipped = Number(state?.skipped_or_resumed) || 0;
  const staleMs = Number(state?.__staleMs) || 0;
  const stale = staleMs > DOWNLOAD_STALE_MS;
  host.classList.toggle('wv-progress-stale', stale);
  const staleNote = stale ? ` · 已 ${Math.max(1, Math.round(staleMs / 60000))} 分钟没有更新，任务可能已经停止或崩溃` : '';
  const phaseNote = state?.phase === 'finalizing_sources' ? ' · 并行来源已完成，正在汇总结果' : '';
  host.querySelector('.wv-progress-text').textContent =
    `${done}/${total}（成功 ${Number(state?.downloaded) || 0}，失败 ${Number(state?.failed) || 0}`
    + `${skipped ? `，续传/跳过 ${skipped}` : ''}）${current ? ` · ${current}` : ''}${phaseNote}${staleNote}`;
}
// Polls until the caller's promise settles, then stops. Returns nothing; the
// row is updated in place.
function pollDownloadProgress(row, stopSignal, pollMs = 1500) {
  let stopped = false;
  // Anything written before this moment belongs to a previous run. The skill
  // deletes the file on startup, but that only helps if the skill starts at all
  // — when it failed to launch, the poller happily rendered the last run's
  // "34/75 (5 ok, 17 failed)" as if the new run were already underway.
  const startedAt = Date.now();
  const update = (event) => {
    const state = event.detail;
    if (!stopped && Number(state?.started_at) >= startedAt && row?.isConnected) renderProgress(row, state);
  };
  window.addEventListener('weaver:download-progress', update);
  stopSignal.then(() => { stopped = true; window.removeEventListener('weaver:download-progress', update); }, () => { stopped = true; window.removeEventListener('weaver:download-progress', update); });
  startDownloadProgressPolling();
}
const WEBVPN_LOGIN_STATUS_PATH = 'Scholarium/runtime/webvpn-login-status.json';
async function pollWebvpnLoginStatus(timeoutMs, pollMs = 2000) {
  const until = Date.now() + timeoutMs;
  let last = { status: 'running', logged_in: false };
  for (;;) {
    try {
      const res = await bridgeFetch(`/v1/workspace-file?path=${encodeURIComponent(WEBVPN_LOGIN_STATUS_PATH)}`);
      if (res?.exists && res.content) {
        const parsed = JSON.parse(res.content);
        last = parsed;
        if (parsed.status && parsed.status !== 'running') return parsed;
      }
    } catch { /* transient: the Bridge may be mid-request; keep polling */ }
    if (Date.now() >= until) return last;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
// The Bridge's health endpoint only proves that the process is alive.  A
// WebVPN login additionally writes its status/profile under the selected
// research workspace, which is guarded by allowedRoots.  Re-submit the exact
// workspace the UI just loaded before starting login so a long-running Bridge
// cannot retain an old allowedRoots list after the project directory changed.
async function synchronizeWorkspaceAuthorization() {
  const current = await loadWorkspace();
  if (!current.isDirectory || !current.root) {
    throw new Error('请先设置存在的课题工作区。');
  }
  const synchronized = await bridgeFetch('/v1/workspace', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ root: current.root })
  });
  showWorkspace(synchronized);
  return synchronized;
}
async function refreshWebvpnSession() {
  if (!zhiyanBridge.online) { await connectBridge(); if (!zhiyanBridge.online) throw new Error('本机 Bridge 未连接。'); }
  const workspace = await synchronizeWorkspaceAuthorization();
  if (!workspace.isDirectory) throw new Error('请先设置存在的课题工作区。');
  const skills = (await bridgeFetch('/v1/skills')).skills;
  const button = document.querySelector('#refreshWebvpn');
  const original = button?.innerHTML || '';
  if (button) { button.disabled = true; button.innerHTML = '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>等待 WebVPN 登录…'; }
  try {
    // Tier 1: fully automated CAS login (~/.scansci-pdf/webvpn_auto_login.py).
    // Runs synchronously and returns a verified result, so unlike mode=login
    // there is nothing to poll and nothing to guess.
    const auto = await runPipelineSkill(skills, 'paper-downloader', JSON.stringify({
      mode: 'auto_login',
      timeoutSec: 300
    }));
    const autoManifest = auto.manifest || {};
    if (autoManifest.logged_in) {
      webvpnSessionOk = true;
      try { sessionStorage.setItem('weaver.webvpn', 'ok'); } catch {}
      updateWebvpnButton();
      window.researchWeaver.toast('WebVPN 自动登录成功，会话已验证并同步给机构通道。');
      return;
    }
    window.researchWeaver.toast(`自动登录未成功（${autoManifest.status || 'unknown'}），改用手动浏览器登录…`);

    // Tier 2: manual browser login.
    const waitMs = 180000;
    const result = await runPipelineSkill(skills, 'paper-downloader', JSON.stringify({
      mode: 'login',
      url: 'https://wvpn.ustc.edu.cn/',
      waitMs
    }));
    const manifest = result.manifest || {};
    if (manifest.error) throw new Error(manifest.error.message || manifest.error.status || 'WebVPN 会话刷新失败');
    // The Bridge starts mode=login detached and returns 'login_started'
    // immediately, so this response says nothing about whether the researcher
    // actually signed in. Turning the button green here was the bug: it went
    // green before the CAS form had even rendered, then grey again after the
    // Pipeline failed. Poll the status file the login process writes instead.
    const login = await pollWebvpnLoginStatus(waitMs + 30000);
    if (!login.logged_in) {
      throw new Error(login.status === 'running'
        ? 'WebVPN 登录未在等待时间内完成；请在弹出的 Chrome 中登录后重试（登录成功后窗口会自动关闭）。'
        : `WebVPN 登录未成功（${login.status || 'unknown'}）：${login.next_step || 'WebVPN 门户仍被重定向到 CAS。'}`);
    }
    webvpnSessionOk = true;
    try { sessionStorage.setItem('weaver.webvpn', 'ok'); } catch {}
    updateWebvpnButton();
    const exported = login.scansci_session?.exported;
    window.researchWeaver.toast(exported
      ? 'WebVPN/CARSI 会话已验证，并已同步给 scansci-institutional 机构通道。'
      : 'WebVPN/CARSI 会话已验证；但机构通道 cookie 导出失败，第 5 步可能仍会回落到浏览器兜底。');
  } catch (error) {
    webvpnSessionOk = false;
    try { sessionStorage.removeItem('weaver.webvpn'); } catch {}
    updateWebvpnButton();
    throw error;
  } finally {
    if (button) { button.disabled = false; if (!webvpnSessionOk) button.innerHTML = original; }
  }
}
function compactPipelineRecords(records, limit) {
  return (records || []).slice(0, limit).map((record) => ({
    doi: record.doi || '', title: record.title || '', year: record.year || '', venue: record.venue || '',
    openalex_id: record.openalex_id || '', is_oa: Boolean(record.is_oa), pdf_url: record.pdf_url || '',
    landing_page_url: record.landing_page_url || '', abstract: String(record.abstract || '').slice(0, 1200)
  }));
}
function pipelineWorkspacePath(...parts) { return [workspaceRoot.replace(/[\\/]+$/, ''), ...parts].join('/'); }

// Mirrors export_dedupe.py's norm_doi(): the download tiers report DOIs in
// whatever shape their upstream gave them ("https://doi.org/10.x/y", "10.X/Y"),
// so tier 2 can only skip what tier 1 already fetched if both sides are keyed
// the same way.
function normalizeDoiKey(value) {
  return String(value || '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
}
// Same dedupe key as reference-export-dedupe (doi if present, else title), so
// the leftover list handed to tier 2 matches the record set tier 1 was given.
function dedupeRecordsForDownload(records) {
  const seen = new Set();
  const out = [];
  for (const rec of Array.isArray(records) ? records : []) {
    const doi = normalizeDoiKey(rec?.doi);
    const title = String(rec?.title || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const key = doi ? `doi:${doi}` : `title:${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
}

function buildManualDownloadQueue(records, attempts) {
  const successfulDois = new Set();
  const successfulUrls = new Set();
  const failuresByDoi = new Map();
  for (const item of Array.isArray(attempts) ? attempts : []) {
    const doi = normalizeDoiKey(item?.doi);
    const urls = [item?.url, item?.final_url, item?.page_url].filter(Boolean).map((value) => String(value).trim());
    if (item?.status === 'downloaded') {
      if (doi) successfulDois.add(doi);
      urls.forEach((url) => successfulUrls.add(url));
    } else if (doi && item?.status) failuresByDoi.set(doi, String(item.error || item.status));
  }
  return dedupeRecordsForDownload(records).flatMap((record) => {
    const doi = normalizeDoiKey(record?.doi);
    const urls = [record?.pdf_url, record?.landing_page_url, doi ? `https://doi.org/${doi}` : ''].filter(Boolean);
    if ((doi && successfulDois.has(doi)) || urls.some((url) => successfulUrls.has(url))) return [];
    const title = String(record?.title || doi || '待下载论文').trim();
    const url = String(record?.landing_page_url || record?.pdf_url || (doi ? `https://doi.org/${doi}` : '')).trim();
    if (!/^https?:\/\/\S+$/i.test(url)) return [];
    const id = doi ? `doi:${doi}` : `title:${title.toLowerCase().replace(/\s+/g, ' ')}`;
    return [{ id, title, doi, url, reason: failuresByDoi.get(doi) || '自动下载未成功' }];
  });
}

function publishManualDownloadQueue(items) {
  try {
    const pipelineRunId = activePipelineHistoryId || '';
    window.parent.postMessage({
      type: 'scholarium:set-manual-download-queue',
      items: (Array.isArray(items) ? items : []).map((item) => ({
        ...item, pipelineRunId, workspace: workspaceRoot,
      })),
    }, '*');
  } catch { /* standalone browser mode has no Obsidian host */ }
}

// PDF acquired in the Obsidian literature reader comes back through the host
// with the Pipeline run id that created the queue item.  Persist it immediately
// and debounce downstream resumes so several manually obtained papers are read
// together.  If the original Pipeline is still finishing its current batch,
// this waits instead of launching a competing reader/graph run.
const manualResumeQueue = new Map();
let manualResumeTimer = null;
async function flushManualResumeQueue() {
  if (activePipelineHistoryId || (activeRunControl && !['done', 'stopped', 'error', 'idle'].includes(activeRunControl.status))) {
    manualResumeTimer = window.setTimeout(flushManualResumeQueue, 1500);
    return;
  }
  const next = manualResumeQueue.entries().next();
  if (next.done) return;
  const [pipelineRunId, pathsSet] = next.value;
  manualResumeQueue.delete(pipelineRunId);
  const paths = [...pathsSet];
  try {
    const parent = await bridgeFetch(`/v1/pipeline-runs/${pipelineRunId}`);
    await resumePipelineFromHistory({
      ...parent,
      artifacts: { ...(parent.artifacts || {}), downloadedPaths: paths },
    });
  } catch (error) {
    window.researchWeaver.toast(`全文已保存，但自动续跑失败：${error.message}。可从历史 Pipeline 手动继续。`);
  } finally {
    if (manualResumeQueue.size) manualResumeTimer = window.setTimeout(flushManualResumeQueue, 800);
  }
}

window.addEventListener('message', async (event) => {
  if (event.source !== window.parent || event.data?.type !== 'scholarium:manual-download-completed') return;
  const item = event.data.item || {};
  const pipelineRunId = String(item.pipelineRunId || '');
  const pdfPath = String(item.path || '').replaceAll('\\', '/');
  if (!/^[\w-]+$/.test(pipelineRunId) || !/\.pdf$/i.test(pdfPath)) {
    window.researchWeaver.toast('全文已保存，但缺少原 Pipeline 标识；请从历史任务手动续跑。');
    return;
  }
  try {
    const parent = await bridgeFetch(`/v1/pipeline-runs/${pipelineRunId}`);
    const existing = Array.isArray(parent.artifacts?.downloadedPaths) ? parent.artifacts.downloadedPaths : [];
    const merged = [...new Set([...existing, pdfPath])];
    await bridgeFetch(`/v1/pipeline-runs/${pipelineRunId}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resumeFrom: 'nature-reader', artifacts: { downloadedPaths: merged } }),
    });
    if (!manualResumeQueue.has(pipelineRunId)) manualResumeQueue.set(pipelineRunId, new Set());
    manualResumeQueue.get(pipelineRunId).add(pdfPath);
    window.researchWeaver.toast(`全文已归档：${pdfPath}；将自动从第 6 步继续。`);
    clearTimeout(manualResumeTimer);
    manualResumeTimer = window.setTimeout(flushManualResumeQueue, 1200);
  } catch (error) {
    window.researchWeaver.toast(`全文已保存，但写入 Pipeline 恢复点失败：${error.message}`);
  }
});

// --- Pipeline settings panel -------------------------------------------------
// research-pipeline.json is documentation only; runResearchPipeline() never
// reads it at runtime. These are the knobs that ARE actually safe to expose as
// editable without restructuring the fixed 12-step data-threading (each step's
// output shape feeds the next in a specific, non-generic way — see the
// AskUserQuestion decision this was scoped against). Stored in localStorage so
// it persists across sessions without needing a Bridge round-trip.
const PIPELINE_SETTINGS_KEY = 'weaver.pipeline.settings.v1';
const PIPELINE_SETTINGS_DEFAULTS = {
  relevanceGateEnabled: true,
  lowRelevanceRatio: 0.6,
  minRecordsForGate: 8,
  tryQueryV1: true,
  tryAgentRefinement: true,
  // Step 1.2: let the selected Agent decompose the topic into a concept
  // matrix (topic-agnostic). Off → deterministic keyword-bank matrix only;
  // the formula-coverage safety net runs either way.
  agentConceptMatrix: true,
  extraSearchProviders: true,
  runDownloadStep: true,
  // Batch retrieval is always background-only. A visible browser is reserved
  // for the explicit WebVPN login button, where a human may need to solve CAS
  // or a captcha.
  downloadHeaded: false,
  compactRecordsLimit: 80
};
function loadPipelineSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(PIPELINE_SETTINGS_KEY) || '{}');
    return { ...PIPELINE_SETTINGS_DEFAULTS, ...saved, downloadHeaded: false };
  } catch { return { ...PIPELINE_SETTINGS_DEFAULTS }; }
}
function savePipelineSettings(settings) {
  try { localStorage.setItem(PIPELINE_SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}
function fillPipelineSettingsForm(settings) {
  document.querySelector('#psRelevanceGateEnabled').checked = settings.relevanceGateEnabled;
  document.querySelector('#psLowRelevanceRatio').value = settings.lowRelevanceRatio;
  document.querySelector('#psMinRecordsForGate').value = settings.minRecordsForGate;
  document.querySelector('#psTryQueryV1').checked = settings.tryQueryV1;
  document.querySelector('#psTryAgentRefinement').checked = settings.tryAgentRefinement;
  document.querySelector('#psAgentConceptMatrix').checked = settings.agentConceptMatrix;
  document.querySelector('#psExtraSearchProviders').checked = settings.extraSearchProviders;
  document.querySelector('#psRunDownloadStep').checked = settings.runDownloadStep;
  document.querySelector('#psDownloadHeaded').checked = false;
  document.querySelector('#psDownloadHeaded').disabled = true;
  document.querySelector('#psCompactRecordsLimit').value = settings.compactRecordsLimit;
}
function readPipelineSettingsForm() {
  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    relevanceGateEnabled: document.querySelector('#psRelevanceGateEnabled').checked,
    lowRelevanceRatio: clamp(document.querySelector('#psLowRelevanceRatio').value, 0, 1, PIPELINE_SETTINGS_DEFAULTS.lowRelevanceRatio),
    minRecordsForGate: clamp(document.querySelector('#psMinRecordsForGate').value, 1, 1000, PIPELINE_SETTINGS_DEFAULTS.minRecordsForGate),
    tryQueryV1: document.querySelector('#psTryQueryV1').checked,
    tryAgentRefinement: document.querySelector('#psTryAgentRefinement').checked,
    agentConceptMatrix: document.querySelector('#psAgentConceptMatrix').checked,
    extraSearchProviders: document.querySelector('#psExtraSearchProviders').checked,
    runDownloadStep: document.querySelector('#psRunDownloadStep').checked,
    downloadHeaded: false,
    compactRecordsLimit: clamp(document.querySelector('#psCompactRecordsLimit').value, 10, 200, PIPELINE_SETTINGS_DEFAULTS.compactRecordsLimit)
  };
}
(() => {
  const dialog = document.querySelector('#pipelineSettingsDialog');
  const openBtn = document.querySelector('#showPipelineSettings');
  const closeBtn = document.querySelector('#closePipelineSettings');
  const saveBtn = document.querySelector('#savePipelineSettings');
  const resetBtn = document.querySelector('#resetPipelineSettings');
  if (!dialog || !openBtn) return;
  openBtn.addEventListener('click', () => { fillPipelineSettingsForm(loadPipelineSettings()); dialog.showModal(); });
  closeBtn?.addEventListener('click', () => dialog.close());
  saveBtn?.addEventListener('click', () => {
    savePipelineSettings(readPipelineSettingsForm());
    window.researchWeaver.toast('Pipeline 设置已保存，下次点击“运行文献 Pipeline”生效。');
    dialog.close();
  });
  resetBtn?.addEventListener('click', () => fillPipelineSettingsForm(PIPELINE_SETTINGS_DEFAULTS));
})();

// --- Relevance-gated query refinement (runs between broad search and dedupe) --
// literature-search-query-builder already emits a concept_matrix and a stricter
// query_v1_after_record_sampling that nothing in this Pipeline ever used. When
// the sampled records are mostly off-topic, spend that free/deterministic v1
// query first; only fall back to an actual read-only Codex task (proposing a
// new Boolean query from low/high-relevance title examples) if v1 alone does
// not fix it. This never invents a relevance score for a single paper — it
// only decides whether the *result set as a whole* is worth re-querying.
// Thresholds below are now read from Pipeline settings at run time (see
// loadPipelineSettings()); these are just the fallback/reference defaults.
function normalizeForDedupe(record) {
  const doi = String(record.doi || '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');
  if (doi) return `doi:${doi}`;
  return `title:${String(record.title || '').toLowerCase().replace(/\W+/g, ' ').trim()}`;
}
function mergeUniqueRecords(base, additions) {
  const seen = new Set(base.map(normalizeForDedupe));
  const merged = [...base];
  for (const record of additions) {
    const key = normalizeForDedupe(record);
    if (!key || key === 'title:' || seen.has(key)) continue;
    seen.add(key);
    merged.push(record);
  }
  return merged;
}
// Word-boundary matching for short single tokens: plain substring inclusion
// let "au" match inside "because" and "tio2" inside unrelated prose. Longer
// tokens and multi-word phrases keep inclusion semantics (stems like
// "photocatal" deliberately match "photocatalysis").
function termAtBoundary(text, term) {
  if (term.length <= 5 && !term.includes(' ')) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(text);
  }
  return text.includes(term);
}
function scoreRecordRelevance(record, blocks) {
  const normalize = (value) => String(value || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u2080-\u2089]/g, (ch) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(ch)))
    .replace(/\s+/g, ' ');
  const text = normalize(`${record.title || ''} ${record.abstract || ''}`);
  const compactText = text.replace(/[^a-z0-9]+/g, '');
  const total = blocks.length || 1;
  let hits = 0;
  for (const block of blocks) {
    const terms = (block.terms || []).map((term) => normalize(String(term).replace(/[*?]/g, '')));
    if (terms.some((term) => {
      if (!term) return false;
      if (termAtBoundary(text, term)) return true;
      const compactTerm = term.replace(/[^a-z0-9]+/g, '');
      return compactTerm.length >= 3 && compactText.includes(compactTerm);
    })) hits++;
  }
  return { hits, total, ratio: hits / total };
}
function recordMatchesTerms(record, terms) {
  const normalize = (value) => String(value || '')
    .toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u2080-\u2089]/g, (ch) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(ch)))
    .replace(/\s+/g, ' ');
  const text = normalize(`${record.title || ''} ${record.abstract || ''}`);
  const compactText = text.replace(/[^a-z0-9]+/g, '');
  return (terms || []).some((term) => {
    const value = normalize(String(term || '').replace(/[*?]/g, ''));
    if (!value) return false;
    if (termAtBoundary(text, value)) return true;
    const compactTerm = value.replace(/[^a-z0-9]+/g, '');
    return compactTerm.length >= 3 && compactText.includes(compactTerm);
  });
}
function passesHardConceptGate(record, blocks) {
  // Every required concept block must be present in the record. The previous
  // version only checked four hard-coded block names, which silently turned
  // the gate into a no-op for topics whose matrix used other names (e.g.
  // "plasmonic metal" + "ceria support" for Au@CeO2): all four lookups
  // returned undefined and every record passed.
  const required = (blocks || []).filter((block) => block.required_in_v0 !== false);
  if (!required.length) return true;
  return required.every((block) => recordMatchesTerms(record, block.terms));
}
function classifyRecordTier(record, blocks) {
  // core = every required block present; peripheral = all role=material
  // blocks present but a process/readout block missing (material-true papers
  // outside the named application — kept as peripheral evidence to protect
  // recall); background = at least one material block missing (dropped before
  // download). Without role-tagged material blocks this degrades to the binary
  // all-required-blocks gate.
  const required = (blocks || []).filter((block) => block.required_in_v0 !== false);
  if (!required.length) return 'core';
  const materials = required.filter((block) => block.role === 'material');
  if (!materials.length) {
    return required.every((block) => recordMatchesTerms(record, block.terms)) ? 'core' : 'background';
  }
  if (!materials.every((block) => recordMatchesTerms(record, block.terms))) return 'background';
  return required.every((block) => recordMatchesTerms(record, block.terms)) ? 'core' : 'peripheral';
}
// --- Generic concept-matrix generation (topic-agnostic) ---------------------
// The deterministic keyword bank in build_query.py cannot cover arbitrary
// topics (it had no CeO2 branch at all, which is why an Au@CeO2 run searched
// without any CeO2 constraint). These two layers make matrix generation work
// for EVERY topic: an Agent produces the semantic matrix when available, and
// a deterministic formula extractor runs unconditionally as a safety net —
// any formula named in the topic that no block covers gets force-added as a
// required material block, and any formula missing from the final Boolean
// query gets ANDed back in by code. No topic-specific rules required.
const ELEMENT_SYMBOLS = new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' '));
const ELEMENT_NAMES = { H: 'hydrogen', He: 'helium', Li: 'lithium', Be: 'beryllium', B: 'boron', C: 'carbon', N: 'nitrogen', O: 'oxygen', F: 'fluorine', Na: 'sodium', Mg: 'magnesium', Al: 'aluminium', Si: 'silicon', P: 'phosphorus', S: 'sulfur', Cl: 'chlorine', K: 'potassium', Ca: 'calcium', Sc: 'scandium', Ti: 'titanium', V: 'vanadium', Cr: 'chromium', Mn: 'manganese', Fe: 'iron', Co: 'cobalt', Ni: 'nickel', Cu: 'copper', Zn: 'zinc', Ga: 'gallium', Ge: 'germanium', As: 'arsenic', Se: 'selenium', Br: 'bromine', Rb: 'rubidium', Sr: 'strontium', Y: 'yttrium', Zr: 'zirconium', Nb: 'niobium', Mo: 'molybdenum', Ru: 'ruthenium', Rh: 'rhodium', Pd: 'palladium', Ag: 'silver', Cd: 'cadmium', In: 'indium', Sn: 'tin', Sb: 'antimony', Te: 'tellurium', I: 'iodine', Cs: 'caesium', Ba: 'barium', La: 'lanthanum', Ce: 'cerium', Pr: 'praseodymium', Nd: 'neodymium', Sm: 'samarium', Eu: 'europium', Gd: 'gadolinium', Tb: 'terbium', Dy: 'dysprosium', Ho: 'holmium', Er: 'erbium', Tm: 'thulium', Yb: 'ytterbium', Lu: 'lutetium', Hf: 'hafnium', Ta: 'tantalum', W: 'tungsten', Re: 'rhenium', Os: 'osmium', Ir: 'iridium', Pt: 'platinum', Au: 'gold', Hg: 'mercury', Tl: 'thallium', Pb: 'lead', Bi: 'bismuth', Th: 'thorium', U: 'uranium' };
const ANION_NAMES = { O: 'oxide', N: 'nitride', S: 'sulfide', P: 'phosphide', C: 'carbide', F: 'fluoride', Cl: 'chloride', Br: 'bromide', I: 'iodide' };
// Single-element tokens accepted without digits. Case-sensitive, so "Co"
// (cobalt) is accepted while "CO" (carbon monoxide) parses as C+O separately,
// and sentence-start words like "In…" or "As…" are never element tokens here.
const ELEMENT_TOKEN_WHITELIST = new Set(['Au', 'Ag', 'Cu', 'Pt', 'Pd', 'Rh', 'Ru', 'Ir', 'Os', 'Fe', 'Co', 'Ni', 'Zn', 'Cd', 'Al', 'Mg', 'Ti', 'Zr', 'Hf', 'Sn', 'Pb', 'Bi', 'Sb', 'Cr', 'Mn', 'Mo', 'W', 'Nb', 'Ta', 'Ga', 'Ge', 'Si']);
// Universal gas-phase product/reagent molecules are not materials; extracting
// them as required blocks would over-constrain e.g. every H2-production topic.
const FORMULA_BLOCKLIST = new Set(['H2', 'O2', 'N2']);
const COMMON_MATERIAL_ALIASES = {
  CeO2: ['ceria'], TiO2: ['titania'], ZrO2: ['zirconia'], Al2O3: ['alumina'],
  SiO2: ['silica'], Fe2O3: ['hematite'], Fe3O4: ['magnetite'],
  'g-C3N4': ['graphitic carbon nitride', 'carbon nitride'],
  C3N4: ['graphitic carbon nitride', 'carbon nitride']
};
function normalizeFormulaCase(text) {
  // Map Unicode subscript digits to ASCII so "CeO₂" and "CeO2" are the same
  // token; keeps letter case intact because formula parsing is case-sensitive.
  return String(text || '').replace(/[\u2080-\u2089]/g, (ch) => String('₀₁₂₃₄₅₆₇₈₉'.indexOf(ch)));
}
function parseFormulaToken(token) {
  let rest = token;
  const parts = [];
  while (rest.length) {
    const m = /^([A-Z][a-z]?)(\d*)/.exec(rest);
    if (!m || !ELEMENT_SYMBOLS.has(m[1])) return null;
    parts.push({ symbol: m[1], count: m[2] ? parseInt(m[2], 10) : 1 });
    rest = rest.slice(m[0].length);
  }
  return parts.length ? parts : null;
}
function expandFormulaAliases(formula, parts) {
  const aliases = [formula];
  for (const alias of COMMON_MATERIAL_ALIASES[formula] || []) aliases.push(alias);
  if (parts.length === 1 && ELEMENT_NAMES[parts[0].symbol]) {
    aliases.push(ELEMENT_NAMES[parts[0].symbol]);
  } else if (parts.length === 2) {
    const [first, second] = parts;
    const GREEK = ['', 'mono', 'di', 'tri', 'tetra'];
    if (ANION_NAMES[second.symbol] && ELEMENT_NAMES[first.symbol]) {
      const anion = ANION_NAMES[second.symbol];
      aliases.push(`${ELEMENT_NAMES[first.symbol]} ${anion}`);
      if (second.count >= 2 && GREEK[second.count]) aliases.push(`${ELEMENT_NAMES[first.symbol]} ${GREEK[second.count]}${anion}`);
    } else if (ANION_NAMES[first.symbol] && ELEMENT_NAMES[second.symbol]) {
      aliases.push(`${ELEMENT_NAMES[second.symbol]} ${ANION_NAMES[first.symbol]}`);
    }
  }
  return [...new Set(aliases)];
}
function extractMaterialBlocks(question) {
  const text = normalizeFormulaCase(question);
  const found = new Map();
  const addMaterial = (formula, terms) => {
    if (FORMULA_BLOCKLIST.has(formula) || found.has(formula)) return;
    found.set(formula, { formula, terms });
  };
  // Inorganic formulas: digit-containing candidates with valid element
  // decomposition (CeO2, ZnIn2S4, BiVO4), plus whitelisted bare element
  // tokens (Au, Pt). Word guards reject fragments cut out of prose, and
  // case-sensitive parsing rejects "CEO" (C-E-O is not an element sequence
  // and "E" cannot join "C" as a lowercase continuation).
  const candidateRe = /(?<![A-Za-z])([A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*)+|[A-Z][a-z])(?![a-z])/g;
  for (const match of text.matchAll(candidateRe)) {
    const token = match[1];
    if (token.length < 2) continue;
    const hasDigit = /\d/.test(token);
    if (!hasDigit && !ELEMENT_TOKEN_WHITELIST.has(token)) continue;
    const parts = parseFormulaToken(token);
    if (!parts) continue;
    addMaterial(token, expandFormulaAliases(token, parts));
  }
  // MOF codes (ZIF-8, UiO-66, MIL-101…) are names, not element formulas.
  for (const match of text.matchAll(/\b((?:ZIF|UiO|UIO|MIL|MOF|HKUST|PCN|NU|CAU)-?\d{1,4}(?:-[A-Za-z0-9]+)?)/g)) {
    const code = match[1];
    addMaterial(code, [...new Set([code, code.replace('-', '')])]);
  }
  // graphitic carbon nitride is written g-C3N4 / C3N4 / gC3N4 in topics.
  if (/\bg?-?C3N4\b/i.test(text)) {
    addMaterial('g-C3N4', ['g-C3N4', 'C3N4', 'graphitic carbon nitride', 'carbon nitride']);
    // The generic candidate regex also captures the bare "C3N4" inside
    // "g-C3N4"; it is the same material and its terms are already covered.
    found.delete('C3N4');
  }
  return [...found.values()].slice(0, 8);
}
function normalizeTermKey(term) {
  return normalizeFormulaCase(String(term || '')).toLowerCase().replace(/[^a-z0-9]+/g, '');
}
function ensureFormulaCoverage(blocks, question) {
  // Safety net applied to EVERY matrix (Agent-generated or deterministic):
  // any formula named in the topic that no existing block covers is added as
  // a required material block, so the gate and the query can never silently
  // drop a core material again.
  const materials = extractMaterialBlocks(question);
  const existing = new Set();
  for (const block of blocks || []) {
    for (const term of block?.terms || []) existing.add(normalizeTermKey(term));
  }
  const out = [...(blocks || [])];
  const added = [];
  for (const material of materials) {
    const covered = material.terms.some((term) => existing.has(normalizeTermKey(term)));
    if (covered) continue;
    out.push({
      block: `material-${material.formula}`, role: 'material', required_in_v0: true,
      terms: material.terms,
      notes: 'Deterministically extracted from the topic text (formula-coverage safety net).'
    });
    added.push(material.formula);
  }
  return { blocks: out, added };
}
function formulaQueryClause(material) {
  return '(' + material.terms.map((term) => (String(term).includes(' ') ? `"${term}"` : term)).join(' OR ') + ')';
}
function applyFormulaGuards(query, question) {
  // Deterministic backstop for any Boolean query (the Agent loop's included):
  // every formula named in the topic must appear in the query, else it is
  // ANDed back in by code.
  const materials = extractMaterialBlocks(question);
  const qText = normalizeFormulaCase(String(query || '')).toLowerCase();
  const missing = materials.filter((material) => !material.terms.some((term) => termAtBoundary(qText, normalizeFormulaCase(term).toLowerCase())));
  if (!missing.length) return { query, injected: [] };
  const extra = missing.map(formulaQueryClause).join(' AND ');
  return { query: query ? `${query} AND ${extra}` : extra, injected: missing.map((m) => m.formula) };
}
function buildBooleanFromBlocks(blocks) {
  const clause = (terms) => '(' + terms.map((term) => (String(term).includes(' ') ? `"${term}"` : term)).join(' OR ') + ')';
  const usable = (blocks || []).filter((block) => (block?.terms || []).length);
  const required = usable.filter((block) => block.required_in_v0 !== false);
  const optional = usable.filter((block) => block.required_in_v0 === false);
  return {
    v0: required.map((block) => clause(block.terms)).join(' AND '),
    v1: [...required, ...optional].map((block) => clause(block.terms)).join(' AND ')
  };
}
function parseConceptMatrixReply(raw) {
  // Strict contract: any deviation rejects the whole matrix and the pipeline
  // falls back to the deterministic one — an Agent reply can never corrupt
  // the gate.
  const text = String(raw || '').replace(/```(?:json)?/gi, '');
  let parsed = null;
  const starts = [];
  for (let i = 0; i < text.length; i++) if (text[i] === '{') starts.push(i);
  for (const start of starts) {
    for (let end = text.length - 1; end > start; end--) {
      if (text[end] !== '}') continue;
      try { parsed = JSON.parse(text.slice(start, end + 1)); break; } catch { /* try next */ }
    }
    if (parsed) break;
  }
  if (!parsed || !Array.isArray(parsed.blocks) || !parsed.blocks.length) return null;
  const ROLES = new Set(['material', 'process', 'refinement']);
  const blocks = [];
  for (const item of parsed.blocks.slice(0, 10)) {
    const name = String(item?.block || '').trim().slice(0, 60);
    const role = ROLES.has(item?.role) ? item.role : null;
    const terms = Array.isArray(item?.terms)
      ? item.terms.map((term) => String(term || '').trim()).filter(Boolean).map((term) => term.slice(0, 60)).slice(0, 24)
      : [];
    if (!name || !role || !terms.length) return null;
    blocks.push({ block: name, role, required_in_v0: item.required_in_v0 !== false, terms, notes: 'Agent-generated concept matrix' });
  }
  return blocks.length ? blocks : null;
}
async function requestAgentConceptMatrix(question) {
  const profile = pipelineAgentProfile();
  if (!profile) return null;
  const prompt = `你是文献检索概念分解器。把研究问题分解为概念块，用于生成布尔检索式和逐篇相关性门槛。

研究问题：${question}

规则：
1. 课题中的每一种核心材料/物质必须单独成一个块——两种材料组成的复合物/异质结/核壳结构必须拆成两个块。材料块 role 填 "material"，required_in_v0 填 true。
2. 反应/过程/机理条件（如光催化、可见光、析氢、CO2 还原）单独成块，role 填 "process"，required_in_v0 填 true。
3. 形貌、结构表征、性能读数等细化概念 role 填 "refinement"，required_in_v0 填 false。
4. 每块给 4–12 个英文检索词：化学式、缩写、英文命名、常见同义词都要覆盖（例如 CeO2 / ceria / cerium oxide；g-C3N4 / graphitic carbon nitride）。
5. 只输出一个 JSON 对象，不要输出任何其他文字、解释或 Markdown 代码块。格式：
{"blocks":[{"block":"<块的英文名>","role":"material","required_in_v0":true,"terms":["..."]}]}

JSON 要求：blocks 为数组；每个元素必须有 block（非空字符串）、role（material/process/refinement 之一）、required_in_v0（布尔）、terms（非空字符串数组）。`;
  const created = await bridgeFetch('/v1/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: profile.adapterId, cwd: workspaceRoot, prompt, permission: 'read', execute: true }) });
  const raw = await waitTask(created.id);
  return parseConceptMatrixReply(raw);
}
function assessRelevance(records, blocks) {
  if (!blocks.length || !records.length) return { ratio: 0, lowCount: 0, total: records.length, lowTitles: [], highTitles: [], highRecords: [] };
  const scored = records.map((record) => ({ record, ...scoreRecordRelevance(record, blocks) }));
  const low = scored.filter((item) => item.ratio < 0.5 || !passesHardConceptGate(item.record, blocks));
  const high = scored.filter((item) => item.ratio >= 0.5 && passesHardConceptGate(item.record, blocks));
  return {
    ratio: low.length / scored.length, lowCount: low.length, total: scored.length,
    lowTitles: low.slice(0, 15).map((item) => item.record.title).filter(Boolean),
    highTitles: high.slice(0, 5).map((item) => item.record.title).filter(Boolean),
    highRecords: high.map((item) => item.record)
  };
}
function screenedRelevanceRecords(relevance, minCount = 3) {
  const records = relevance?.highRecords || [];
  return records.length >= minCount ? records : [];
}
function looksLikeMojibake(text) {
  const value = String(text || '');
  if (!value) return false;
  // U+FFFD means the string has already lost bytes during decoding. Querying
  // scholarly databases with that text gives false "0 hit" results and then
  // risks contaminating downstream notes with stale local PDFs.
  if (value.includes('\uFFFD')) return true;
  // Common Chinese mojibake signatures from UTF-8/GBK mismatches.
  if (/[锟斤拷]/.test(value)) return true;
  if (/(?:Ã.|Â.|â€|â€œ|â€\u009d|鈥|銆|绗|妫|鐨|璁|浠|杩|鍏|鍙)/.test(value)) return true;
  // The run that triggered this guard produced a query such as
  // "(ˮ�ȷ��ϳɷ...)": several Latin-Extended IPA-ish symbols mixed with
  // replacement characters and no searchable scientific token.
  const oddMarks = (value.match(/[ˮ˯�]/g) || []).length;
  return oddMarks >= 2;
}
// Same "which Agent" question the header selector answers for chat and for
// canvas workflows (executePlan()/chatProfile()): prefer whatever the user
// picked in weaverOrchestrator, and only fall back to Codex if nothing is
// selected or the selection isn't actually installed. This is the one place
// in the Pipeline that calls an Agent at all (the query-refinement step), so
// keeping it in sync with the global selector is what makes "Pipeline uses
// the same Agent as the canvas/chat" true, without pulling the Pipeline's
// fixed Skill sequence into the canvas (that split was a deliberate choice).
function pipelineAgentProfile() {
  const selected = window.weaverOrchestrator?.getSelectedAgent?.();
  if (selected && zhiyanBridge.agents.some((agent) => agent.id === selected && agent.installed)) {
    const match = window.researchWeaver.profiles.find((candidate) => candidate.adapterId === selected);
    if (match) return match;
  }
  return window.researchWeaver.profiles.find((candidate) => candidate.adapterId === 'codex'
    && zhiyanBridge.agents.some((agent) => agent.id === 'codex' && agent.installed)) || null;
}
async function requestAgentRefinedQuery(question, blocks, query0, query1, lowTitles, highTitles) {
  const profile = pipelineAgentProfile();
  if (!profile) return null;
  const prompt = `你是文献检索式工程师。当前 OpenAlex 检索结果中，多数记录与研究问题不相关。只读地提出一个更精确的 Boolean 检索式：不得使用通配符 * 或 ?（OpenAlex 会拒绝带通配符的引号短语）。\n\n研究问题：${question}\n\n概念矩阵（block/terms）：${JSON.stringify(blocks)}\n\n已尝试的检索式 v0：${query0}\n已尝试的检索式 v1：${query1 || '（无，未生成或与 v0 相同）'}\n\n低相关性样本标题（负例，说明当前查询过宽或跑偏）：\n${lowTitles.map((title) => `- ${title}`).join('\n') || '（无）'}\n\n高相关性样本标题（正例，新检索式仍应能命中类似文献）：\n${highTitles.map((title) => `- ${title}`).join('\n') || '（无）'}\n\n只输出一行，格式严格为：\nREFINED_QUERY: <检索式>\n不要输出任何解释、Markdown 代码块或多余文字。`;
  const created = await bridgeFetch('/v1/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ agentId: profile.adapterId, cwd: workspaceRoot, prompt, permission: 'read', execute: true }) });
  const raw = await waitTask(created.id);
  const match = raw.match(/REFINED_QUERY:\s*(.+)/i);
  const refined = (match ? match[1] : (raw.split(/\r?\n/).find((line) => line.trim()) || '')).trim().replace(/^["'`]+|["'`]+$/g, '');
  return refined || null;
}

async function requestAgentKnowledgeGraph(question, cards) {
  const profile = pipelineAgentProfile();
  if (!profile) throw new Error('没有可用的 Agent CLI，无法进行知识图谱语义抽取。');
  const core = window.weaverKnowledgeGraphCore;
  if (!core?.buildExtractionPrompt || !core?.parseGraphReply) throw new Error('知识图谱协议未加载，请重载 Scholarium 面板。');
  const prompt = core.buildExtractionPrompt({ question, cards });
  const created = await bridgeFetch('/v1/tasks', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agentId: profile.adapterId, cwd: workspaceRoot, prompt, permission: 'read', execute: true }),
  });
  const raw = await waitTask(created.id);
  return core.parseGraphReply(raw);
}

async function generateSemanticKnowledgeGraph(question, cards = null, sourcePaths = null) {
  const skills = (await bridgeFetch('/v1/skills')).skills;
  let evidenceCards = cards;
  if (!Array.isArray(evidenceCards)) {
    const evidence = await bridgeFetch(`/v1/knowledge-graph/evidence?query=${encodeURIComponent(question || '')}`);
    evidenceCards = evidence.cards || [];
  }
  if (!evidenceCards.length) throw new Error('当前课题没有证据卡片。请先读取至少一篇相关 PDF，再生成知识图谱。');
  let graph = null, extractionWarning = '';
  try { graph = await requestAgentKnowledgeGraph(question, evidenceCards); }
  catch (error) { extractionWarning = `Agent 语义抽取失败，已降级为保守共现图：${error.message}`; }
  const scopedPaths = Array.isArray(sourcePaths) && sourcePaths.length
    ? sourcePaths
    : evidenceCards.map((card) => card.source_path).filter(Boolean);
  const payload = { title: `${String(question || '科研主题').slice(0, 80)} · 知识图谱`, research_question: question, card_source_paths: scopedPaths };
  if (graph) payload.graph = graph;
  const output = await runPipelineSkill(skills, 'zrl-knowledge-graph', JSON.stringify(payload));
  if (extractionWarning) output.manifest = { ...(output.manifest || {}), warnings: [...(output.manifest?.warnings || []), extractionWarning] };
  return output;
}
window.researchWeaverGenerateKnowledgeGraph = generateSemanticKnowledgeGraph;

function persistPipelineTopic(question) {
  const normalized = String(question || '').trim();
  if (!normalized) return;
  if (window.researchWeaver?.taskGoal) {
    window.researchWeaver.taskGoal.value = normalized;
    window.researchWeaver.taskGoal.dispatchEvent(new Event('input', { bubbles: true }));
  }
  try {
    const flowStore = 'research-weaver:flow:v2';
    const flowsStore = 'research-weaver:flows:v1';
    const activeFlowStore = 'research-weaver:active-flow:v1';
    const flow = JSON.parse(localStorage.getItem(flowStore) || '{}');
    flow.task = { ...(flow.task || {}), goal: normalized };
    localStorage.setItem(flowStore, JSON.stringify(flow));
    const flows = JSON.parse(localStorage.getItem(flowsStore) || '[]');
    const activeId = localStorage.getItem(activeFlowStore);
    if (Array.isArray(flows) && flows.length) {
      const index = activeId ? flows.findIndex((item) => item.id === activeId) : 0;
      const targetIndex = index >= 0 ? index : 0;
      flows[targetIndex].task = { ...(flows[targetIndex].task || {}), goal: normalized };
      flows[targetIndex].updatedAt = new Date().toISOString();
      localStorage.setItem(flowsStore, JSON.stringify(flows));
    }
  } catch {
    // Best-effort persistence only. The DOM value remains authoritative.
  }
}

function ensurePipelineTopicDialog() {
  let dialog = document.querySelector('#pipelineTopicDialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'pipelineTopicDialog';
  dialog.className = 'registry-dialog pipeline-topic-dialog';
  dialog.innerHTML = `
    <form method="dialog" class="pipeline-topic-form">
      <div class="run-header">
        <div><span class="eyebrow">PIPELINE TOPIC</span><h2>确认本次文献检索主题</h2></div>
        <button type="button" class="pipeline-topic-close" aria-label="关闭">×</button>
      </div>
      <div class="pipeline-topic-body">
        <p class="wv-faint">Pipeline 只会根据下面这段“检索主题”生成检索式，不会自动读取聊天框、画布节点标题或上一轮对话。每次换主题前，请在这里确认一次。</p>
        <label>本次检索主题<textarea id="pipelineTopicInput" rows="6" placeholder="材料/体系 + 关键机制 + 反应或应用场景 + 你想判断的问题"></textarea></label>
        <div class="pipeline-topic-tip"><b>建议写法：</b>BiVO4 可见光催化在低效率条件下是否仍有研究价值，需要检索公开文献中的效率基线、机制证据和可改性策略。</div>
        <p class="wv-faint">Pipeline 运行时会自动用构建者/质疑者双 Agent 循环打磨检索式，过程显示在下方执行步骤里，不再需要单独点“打磨检索式”。</p>
      </div>
      <footer class="pipeline-topic-actions">
        <button type="button" class="button ghost pipeline-topic-cancel">取消</button>
        <button type="submit" class="button primary">用这个主题运行 Pipeline</button>
      </footer>
    </form>`;
  document.body.appendChild(dialog);
  return dialog;
}

function confirmPipelineTopic() {
  const dialog = ensurePipelineTopicDialog();
  const input = dialog.querySelector('#pipelineTopicInput');
  const close = dialog.querySelector('.pipeline-topic-close');
  const cancel = dialog.querySelector('.pipeline-topic-cancel');
  const form = dialog.querySelector('form');
  input.value = (window.researchWeaver?.taskGoal?.value || '').trim();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dialog.close();
      form.removeEventListener('submit', onSubmit);
      close.removeEventListener('click', onCancel);
      cancel.removeEventListener('click', onCancel);
      dialog.removeEventListener('cancel', onCancel);
      resolve(value);
    };
    const onCancel = (event) => {
      event?.preventDefault?.();
      finish(null);
    };
    const onSubmit = (event) => {
      event.preventDefault();
      const topic = input.value.trim();
      if (!topic) {
        window.researchWeaver?.toast?.('请先写明本次要检索的研究主题。');
        input.focus();
        return;
      }
      persistPipelineTopic(topic);
      finish(topic);
    };
    form.addEventListener('submit', onSubmit);
    close.addEventListener('click', onCancel);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
    input.focus();
    input.select();
  });
}

async function runResearchPipeline(options = {}) {
  if (!zhiyanBridge.online) { await connectBridge(); if (!zhiyanBridge.online) throw new Error('本机 Bridge 未连接。'); }
  const question = String(options.topic || '').trim() || await confirmPipelineTopic();
  if (!question) return;
  const workspace = await loadWorkspace();
  if (!workspace.isDirectory) throw new Error('请先设置存在的课题工作区。');
  if (!question) throw new Error('请先在“任务目标”中写明研究问题。');
  const pipelineConfirmation = options.stopAfterGraph
    ? '将运行 M3 的 P1–P2：检索式生成→检索与去重→PDF 获取与证据卡片→文献笔记→知识图谱。建议运行前先点“登录/刷新 WebVPN”。本次严格停在 P2：不生成 P3–P5 假设/实验/周计划草案，也不生成证据综述、手稿或润色稿。写入仅限本课题工作区的 literature/、Literature/、Canvases/、Research/ 子目录；运行结束后会列出本次产出清单，可选择保留或整批撤销。是否继续？'
    : '将按 research-pipeline.json 自动运行完整文献流程：检索式生成→精排检索→广召回检索→（若相关性过低，自动深化检索式并重新检索）→去重导出→复用 WebVPN/CARSI 浏览器会话下载→PDF 转证据卡片→文献笔记→知识图谱画布→证据综述→手稿初稿→润色。建议运行前先点“登录/刷新 WebVPN”。全部只读本机课题目录，写入仅限 literature/、Literature/、Canvases/、Research/、Manuscript/ 子目录；运行结束后会列出本次产出清单，可选择保留或整批撤销。质量门阈值、是否下载等参数可在“更多 › Pipeline 设置”里调整。是否继续？';
  if (!confirm(pipelineConfirmation)) return;
  startRunControl('pipeline', '文献 Pipeline');
  const { dialog, steps, result } = window.researchWeaver;
  dialog.showModal(); document.querySelector('#runTitle').textContent = '一键运行科研文献 Pipeline'; steps.innerHTML = ''; result.classList.add('hidden');
  try { await beginPipelineHistory(question, workspaceRoot); }
  catch (error) { window.researchWeaver.toast(`Pipeline 历史记录未能建立：${error.message}；本次仍会继续，但不能断点恢复。`); }
  const skills = (await bridgeFetch('/v1/skills')).skills;
  const settings = loadPipelineSettings();

  const row1 = addStep('第 1 步 · literature-search-query-builder', '生成保守的检索式草案（确定性规则，供质量门检查用）');
  const step1 = await runPipelineSkill(skills, 'literature-search-query-builder', question);
  let query = String(step1.manifest?.query_v0 || '').trim();
  if (!query) {
    updateStep(row1, '检索式为空，Pipeline 已停止（research-pipeline.json stop_rule：query manifest 为空）。', 'error');
    result.innerHTML = '<h3>Pipeline 已停止</h3><p>未能从任务目标生成检索式；请把研究问题写得更具体（例如包含材料、体系、反应或现象关键词）后重试。</p>';
    result.classList.remove('hidden');
    finishRunControl('stopped', '检索式为空，已停止');
    return;
  }
  updateStep(row1, `检索式 v0：${query}`);
  if (looksLikeMojibake(query)) {
    updateStep(row1, `检索式包含乱码：${query}；Pipeline 已停止（质量门：编码损坏）。`, 'error');
    result.innerHTML = `<h3>Pipeline 已停止：检索式乱码</h3><p>生成的检索式包含编码损坏字符，说明课题主题在进入检索器前已经被错误解码。继续检索只会得到虚假的 0 条结果，并可能让后续步骤误用旧 PDF。</p><p><b>已拦截的检索式：</b><code>${safeHtml(query)}</code></p><p>请重新输入/修改 Pipeline 主题；如果仍然乱码，需要检查主题保存、读取和 Skill 调用的 UTF-8 编码链路。</p>`;
    result.classList.remove('hidden');
    finishRunControl('stopped', '质量门停止：检索式乱码');
    return;
  }

  // Defense-in-depth backstop for build_query.py's keyword bank: even after
  // promoting light-driven/plasmonic mechanism terms to required-in-v0 there
  // (see that file's own comment for why), a phrasing this watchlist doesn't
  // recognize could still slip through and silently produce a v0 missing a
  // concept the researcher explicitly named — exactly what happened when a
  // run with "Au"+"CO2 reduction" only (no light/photocatalysis term anywhere
  // in v0) pulled back ~60 off-topic electrocatalysis papers out of 67.
  //
  // This must be a CONCEPT-GROUP match, not a literal per-term match: the
  // researcher's question and query_v0 are different languages by design
  // (build_query.py's blocks always emit English terms into the query even
  // when the trigger was a Chinese phrase like "可见光" or "光催化"). Checking
  // "does the literal Chinese substring also appear in the English query"
  // would always fail and false-positive-stop every Chinese-language task
  // goal. Instead: does the question trip ANY trigger for this concept, and
  // does query_v0 contain ANY of the English terms build_query.py would have
  // emitted for that same concept. Keep this list mirroring build_query.py's
  // own illumination/process block so the two never drift apart silently.
  const CORE_CONCEPT_GROUPS = [{
    label: '可见光 / 光催化 / 等离激元光驱动机制',
    triggerTerms: ['visible light', 'visible-light', 'visible', '可见光', 'photocatal', '光催化', 'photoreduction', 'photoexcitation', '光激发', 'light-driven', '光驱动', 'illumination', 'plasmon', '等离激元', 'lspr'],
    queryTerms: ['visible light', 'photocatal', 'photoreduction', 'photoexcitation', 'light-driven', 'plasmon', 'lspr', 'illumination']
  }];
  const questionLower = question.toLowerCase();
  const queryLower = query.toLowerCase();
  const droppedConcepts = CORE_CONCEPT_GROUPS
    .filter((group) => group.triggerTerms.some((term) => questionLower.includes(term.toLowerCase())))
    .filter((group) => !group.queryTerms.some((term) => queryLower.includes(term.toLowerCase())))
    .map((group) => group.label);
  if (droppedConcepts.length) {
    updateStep(row1, `检索式 v0：${query}；但任务目标中提到的核心概念未进入 v0：${droppedConcepts.join('、')}。Pipeline 已停止（质量门：检索意图解析遗漏核心概念）。`, 'error');
    result.innerHTML = `<h3>Pipeline 已停止：检索式缺少核心概念</h3><p>任务目标中提到「${droppedConcepts.map(safeHtml).join('、')}」这一概念，但生成的检索式 v0 里找不到对应的英文检索词。继续检索会系统性跑偏——例如把电催化 CO2RR 文献当成光催化文献，正是此前一次真实运行发生的情况（67 条结果里约 60 条方向不对）。</p><p>请检查 <code>literature-search-query-builder/scripts/build_query.py</code> 的关键词识别规则是否覆盖了这个说法，或把「任务目标」改写得更贴近其内置词表后重试。</p><p><b>已生成的 v0：</b>${safeHtml(query)}</p>`;
    result.classList.remove('hidden');
    finishRunControl('stopped', '质量门停止：检索式缺少核心概念');
    return;
  }

  // --- Step 1.2 · topic-agnostic concept matrix -------------------------
  // build_query.py's keyword bank is inherently topic-specific (it had no
  // CeO2 branch at all, which left an Au@CeO2 run without any CeO2
  // constraint). To give EVERY run the "core materials are enforced"
  // capability, the concept matrix is rebuilt here in three layers:
  //   1. Agent semantic decomposition (when enabled and an Agent is
  //      installed) — understands arbitrary topics;
  //   2. the deterministic keyword-bank matrix from step 1 as fallback —
  //      the pipeline never blocks on Agent availability;
  //   3. an unconditional formula-coverage safety net: any material named
  //      in the topic that no block covers is force-added as a required
  //      material block.
  // Downstream relevance assessment, the 3.5-3.8 refinement gates and the
  // 3.95 final screen all consume this matrix, so a core material can no
  // longer silently drop out of the search for any topic.
  const rowMatrix = addStep('第 1.2 步 · 概念矩阵生成（课题无关）', '把课题分解为概念块，供检索式与逐篇相关性门槛共用');
  let conceptBlocks = Array.isArray(step1.manifest?.concept_matrix) ? step1.manifest.concept_matrix : [];
  let matrixSource = '确定性词库';
  let matrixNote = '';
  if (settings.agentConceptMatrix) {
    try {
      const agentBlocks = await requestAgentConceptMatrix(question);
      if (agentBlocks) {
        conceptBlocks = agentBlocks;
        matrixSource = 'Agent 语义生成';
      } else {
        matrixNote = 'Agent 未返回合规的概念矩阵（未安装/未登录/输出不符合契约），已回退到确定性词库矩阵。';
      }
    } catch (error) {
      matrixNote = `Agent 概念矩阵生成失败：${error.message}；已回退到确定性词库矩阵。`;
    }
  }
  const coverage = ensureFormulaCoverage(conceptBlocks, question);
  conceptBlocks = coverage.blocks;
  if (coverage.added.length) matrixSource += `＋化学式兜底补块（${coverage.added.join('、')}）`;
  step1.manifest.concept_matrix = conceptBlocks;
  if (matrixSource.startsWith('Agent')) {
    // query_v1 and the diagnostic variants in the manifest were produced for
    // the OLD keyword-bank matrix; rebuild v1 from the adopted matrix so the
    // 3.6 fallback re-search stays consistent, and drop the stale variants.
    const rebuilt = buildBooleanFromBlocks(conceptBlocks);
    step1.manifest.query_v1_after_record_sampling = rebuilt.v1;
    step1.manifest.query_variants_after_record_sampling = [];
  }
  const materialNames = conceptBlocks.filter((block) => block?.role === 'material').map((block) => block.block);
  updateStep(rowMatrix, `${conceptBlocks.length} 个概念块（材料：${materialNames.join('、') || '无'}），来源：${matrixSource}。${matrixNote}`);

  // --- Automatic dual-agent query refinement -------------------------
  // v0 above is a fast, free, deterministic draft — good enough to run the
  // mojibake/concept-drop quality gates against, but not what actually goes
  // to the search sources anymore. This is the capability the researcher
  // asked to become "在pipeline中运行时，agent自行操作" and "双agent"
  // instead of a separate manual "打磨检索式" window: a builder agent writes
  // a candidate query, a critic agent scores it against real search hits,
  // and the loop revises up to 3 rounds, one diagnosed change per round
  // (score ≥ 75 or best-of-3). If no Agent CLI
  // is installed at all, this step is skipped and v0 is used as-is so the
  // Pipeline still runs without any CLI installed.
  const rowRefine = addStep('第 1.5 步 · 自动打磨检索式（双 Agent：构建者 + 质疑者）', '正在准备…');
  if (window.weaverQueryLoop?.runAuto) {
    try {
      const loopResult = await runQueryLoopWithStepTicker(rowRefine, question);
      query = loopResult.query;
      const guarded = applyFormulaGuards(query, question);
      if (guarded.injected.length) {
        query = guarded.query;
        updateStep(rowRefine, `第 ${loopResult.cycle} 轮，${loopResult.score} 分，检索式：${query}（质量门：课题中的 ${guarded.injected.join('、')} 未出现在 Agent 检索式中，已自动 AND 回去）`);
      } else {
        updateStep(rowRefine, `第 ${loopResult.cycle} 轮，${loopResult.score} 分，检索式：${query}`);
      }
    } catch (error) {
      const failure = error.queryLoopFailure || {};
      updateStep(rowRefine, `自动打磨已停止：${error.message}。未执行宽泛 v0，也未进入下载。`, 'error');
      result.innerHTML = `<h3>Pipeline 已安全停止：自动打磨未完成</h3><p><b>失败位置：</b>${safeHtml(failure.cycle ? `第 ${failure.cycle} 轮 · ${failure.phase}` : failure.phase || '准备阶段')}</p><p><b>具体原因：</b>${safeHtml(error.message)}</p>${failure.query ? `<p><b>失败前正在测试的检索式：</b><code>${safeHtml(failure.query)}</code></p>` : ''}<p>请确认本机 Bridge 和所选 Agent 可用后重新运行。本次不会退回静态 v0，不会继续检索、去重或下载。</p>`;
      result.classList.remove('hidden');
      finishRunControl('stopped', `自动打磨失败：${error.message}`);
      return;
    }
  } else {
    updateStep(rowRefine, '自动打磨功能不可用：query-loop.js 未加载。Pipeline 已停止，未执行宽泛 v0。', 'error');
    result.innerHTML = '<h3>Pipeline 已安全停止：自动打磨模块未加载</h3><p>请重载 Scholarium 面板后重试。本次未继续检索或下载。</p>';
    result.classList.remove('hidden');
    finishRunControl('stopped', '自动打磨模块未加载');
    return;
  }

  /* --- Steps 2 & 3: parallel-capable search ------------------------ */
  const doParallel = false; // OpenAlex searches are intentionally sequential: concurrent Bridge calls have caused transient proxy failures.

  const row2 = addStep('\u7B2C 2 \u6B65 \u00B7 nature-academic-search', doParallel ? '\u7CBE\u6392\u68C0\u7D22\uFF08\u4E0E\u5E7F\u53EC\u56DE\u5E76\u884C\u6267\u884C\uFF09' : 'OpenAlex \u7CBE\u6392\u68C0\u7D22\uFF08\u6309\u88AB\u5F15\u6392\u5E8F\uFF09');
  const row3 = addStep('\u7B2C 3 \u6B65 \u00B7 pop8-scholar-search', doParallel ? '\u5E7F\u53EC\u56DE\u68C0\u7D22\uFF08\u4E0E\u7CBE\u6392\u5E76\u884C\u6267\u884C\uFF09' : 'OpenAlex \u5E7F\u53EC\u56DE\u68C0\u7D22');

  let step2, step3;
  if (doParallel && window.weaverOrchestrator?.parallel) {
    const parResults = await window.weaverOrchestrator.parallel([
      () => runPipelineSkillWithRetry(skills, 'nature-academic-search', query),
      () => runPipelineSkillWithRetry(skills, 'pop8-scholar-search', query)
    ]);
    step2 = parResults[0].status === 'done' ? parResults[0].result : { manifest: { error: parResults[0].error, records: [] } };
    step3 = parResults[1].status === 'done' ? parResults[1].result : { manifest: { error: parResults[1].error, records: [] } };
  } else {
    step2 = await runPipelineSkillWithRetry(skills, 'nature-academic-search', query);
    step3 = await runPipelineSkillWithRetry(skills, 'pop8-scholar-search', query);
  }

  const records2 = step2.manifest?.records || [];
  if (step2.manifest?.error) {
    updateStep(row2, `OpenAlex \u8BF7\u6C42\u5931\u8D25\uFF08\u5DF2\u91CD\u8BD5\u4E00\u6B21\uFF09\uFF1A${step2.manifest.error}\uFF1B\u672C\u6B65 0 \u6761\uFF0CPipeline \u4F1A\u7EE7\u7EED\u7528\u73B0\u6709\u7ED3\u679C\u5F80\u4E0B\u8DD1\u3002`, 'error');
  } else {
    updateStep(row2, `\u547D\u4E2D ${records2.length} \u6761\uFF1B\u6570\u636E\u5E93\u62A5\u544A\u7EA6 ${step2.manifest?.result_count_reported ?? '\u672A\u77E5'} \u6761\u5019\u9009\u3002`);
  }
  const records3 = step3.manifest?.records || [];
  if (step3.manifest?.error) {
    updateStep(row3, `OpenAlex \u8BF7\u6C42\u5931\u8D25\uFF08\u5DF2\u91CD\u8BD5\u4E00\u6B21\uFF09\uFF1A${step3.manifest.error}\uFF1B\u672C\u6B65 0 \u6761\u3002`, 'error');
  } else {
    updateStep(row3, `\u547D\u4E2D ${records3.length} \u6761\u3002`);
  }

  if (!records2.length && !records3.length) {
    const row0 = addStep('质量门 · 检索结果为空', '精排检索与广召回均为 0 条。');
    updateStep(row0, 'Pipeline 已停止：没有任何新文献记录，不再继续下载、读旧 PDF、生成综述或手稿。', 'error');
    result.innerHTML = `<h3>Pipeline 已停止：检索结果为 0</h3><p>第 2 步和第 3 步都没有检索到文献。此时继续运行会把工作区里已有的旧 PDF 当成本次主题的证据，导致后续证据卡片、知识图谱、综述和手稿全部被污染。</p><p><b>本次检索式：</b><code>${safeHtml(query)}</code></p><p>建议先修改 Pipeline 主题或检索式，再重新运行。只有检索到至少 1 条新文献记录后，才允许进入去重、下载和证据抽取。</p>`;
    result.classList.remove('hidden');
    finishRunControl('stopped', '质量门停止：检索结果为 0');
    return;
  }

  let combined = compactPipelineRecords([...records2, ...records3], settings.compactRecordsLimit);
  conceptBlocks = step1.manifest?.concept_matrix || conceptBlocks;
  let usedQuery = query;
  let relevance = assessRelevance(combined, conceptBlocks);
  if (settings.relevanceGateEnabled && conceptBlocks.length > 1 && combined.length >= settings.minRecordsForGate && relevance.ratio > settings.lowRelevanceRatio) {
    const rowQ = addStep('第 3.5 步 · 检索质量评估', '按检索式的概念矩阵评估已召回记录的相关性');
    updateStep(rowQ, `${combined.length} 条中约 ${relevance.lowCount} 条（${Math.round(relevance.ratio * 100)}%）与概念矩阵匹配度低；开始自动深化检索式。`, 'pending');
    let query1 = String(step1.manifest?.query_v1_after_record_sampling || '').trim();
    if (query1) query1 = applyFormulaGuards(query1, question).query;
    if (settings.tryQueryV1 && query1 && query1 !== query) {
      const row3b = addStep('第 3.6 步 · 用 query_v1 重新检索', '使用检索式生成器已给出但此前未用到的收紧版 v1 重新检索');
      const step2b = await runPipelineSkillWithRetry(skills, 'nature-academic-search', query1);
      const step3b = await runPipelineSkillWithRetry(skills, 'pop8-scholar-search', query1);
      const additions1 = [...(step2b.manifest?.records || []), ...(step3b.manifest?.records || [])];
      const candidate1 = compactPipelineRecords(additions1, settings.compactRecordsLimit);
      const relevance1 = assessRelevance(candidate1, conceptBlocks);
      if (candidate1.length && relevance1.ratio < relevance.ratio) {
        combined = candidate1; usedQuery = query1; relevance = relevance1;
        updateStep(row3b, `替换为 query_v1 结果集：${combined.length} 条，低相关比例降至 ${Math.round(relevance.ratio * 100)}%。`);
      } else {
        updateStep(row3b, candidate1.length
          ? `query_v1 未能改善相关性（候选 ${candidate1.length} 条，低相关约 ${Math.round(relevance1.ratio * 100)}%），继续尝试多检索式候选。`
          : 'query_v1 返回 0 条，不能替换原结果集；继续尝试多检索式候选。', 'error');
      }
    }
    const variants = Array.isArray(step1.manifest?.query_variants_after_record_sampling)
      ? step1.manifest.query_variants_after_record_sampling
      : [];
    if (settings.tryQueryV1 && relevance.ratio > settings.lowRelevanceRatio && variants.length) {
      const row3v = addStep('第 3.6b 步 · 多检索式候选重试', `逐条测试 ${variants.length} 个诊断式检索变体，选择相关性最好的结果集`);
      let best = null;
      for (const variant of variants.slice(0, 6)) {
        let variantQuery = String(variant?.query || '').trim();
        if (!variantQuery || variantQuery === query || variantQuery === usedQuery) continue;
        variantQuery = applyFormulaGuards(variantQuery, question).query;
        const step2v = await runPipelineSkillWithRetry(skills, 'nature-academic-search', variantQuery);
        const step3v = await runPipelineSkillWithRetry(skills, 'pop8-scholar-search', variantQuery);
        const candidateRecords = compactPipelineRecords([...(step2v.manifest?.records || []), ...(step3v.manifest?.records || [])], settings.compactRecordsLimit);
        const candidateRelevance = assessRelevance(candidateRecords, conceptBlocks);
        if (!candidateRecords.length) continue;
        if (!best || candidateRelevance.ratio < best.relevance.ratio || (candidateRelevance.ratio === best.relevance.ratio && candidateRecords.length > best.records.length)) {
          best = { variant, query: variantQuery, records: candidateRecords, relevance: candidateRelevance };
        }
      }
      if (best && best.relevance.ratio < relevance.ratio) {
        combined = best.records; usedQuery = best.query; relevance = best.relevance;
        updateStep(row3v, `采用 ${best.variant.label || 'variant'}：${combined.length} 条，低相关比例降至 ${Math.round(relevance.ratio * 100)}%。检索式：${best.query}`);
      } else {
        updateStep(row3v, '所有诊断式检索变体均未产生更好的非空结果集，继续尝试 Agent 深化。', 'error');
      }
    }
    if (settings.tryAgentRefinement && relevance.ratio > settings.lowRelevanceRatio) {
      const agentProfile = pipelineAgentProfile();
      if (agentProfile) {
        const row3c = addStep('第 3.7 步 · Agent 深化检索式', `${agentProfile.name}（只读，与顶部 Agent 选择器一致）根据低/高相关样本标题提出更精确的检索式`);
        try {
          let refinedQuery = await requestAgentRefinedQuery(question, conceptBlocks, query, query1, relevance.lowTitles, relevance.highTitles);
          if (refinedQuery) refinedQuery = applyFormulaGuards(refinedQuery, question).query;
          if (refinedQuery) {
            const step2c = await runPipelineSkillWithRetry(skills, 'nature-academic-search', refinedQuery);
            const step3c = await runPipelineSkillWithRetry(skills, 'pop8-scholar-search', refinedQuery);
            const additions2 = [...(step2c.manifest?.records || []), ...(step3c.manifest?.records || [])];
            const candidate2 = compactPipelineRecords(additions2, settings.compactRecordsLimit);
            const relevance2 = assessRelevance(candidate2, conceptBlocks);
            if (candidate2.length && relevance2.ratio < relevance.ratio) {
              combined = candidate2; usedQuery = refinedQuery; relevance = relevance2;
              updateStep(row3c, `Agent 检索式：${refinedQuery}；合并后 ${combined.length} 条，低相关比例降至 ${Math.round(relevance.ratio * 100)}%。`);
            } else {
              updateStep(row3c, 'Agent 提出的检索式未能进一步改善相关性。', 'error');
            }
          } else {
            updateStep(row3c, `Agent 未返回可用的检索式（可能是 ${agentProfile.name} 未登录或输出解析失败），保留此前结果集。`, 'error');
          }
        } catch (error) {
          updateStep(row3c, `Agent 深化检索失败：${error.message}；保留此前结果集，继续往下跑。`, 'error');
        }
      } else {
        addStep('第 3.7 步 · Agent 深化检索式（已跳过）', '顶部选择的 Agent 与 Codex 均未安装/不可用，跳过 Agent 深化，继续使用现有结果集。');
      }
    }
    updateStep(rowQ, `质量评估结束：最终 ${combined.length} 条，低相关比例 ${Math.round(relevance.ratio * 100)}%${usedQuery !== query ? `（检索式已深化）` : '（未能改善，仍建议人工检查检索式）'}。`, relevance.ratio > settings.lowRelevanceRatio ? 'error' : 'done');
    if (relevance.ratio > settings.lowRelevanceRatio) {
      const screened = screenedRelevanceRecords(relevance, 3);
      if (screened.length) {
        combined = compactPipelineRecords(screened, settings.compactRecordsLimit);
        relevance = assessRelevance(combined, conceptBlocks);
        addStep('第 3.8 步 · 本地相关文献筛选', `召回集合噪声较高，但已筛出 ${combined.length} 条高相关种子；Pipeline 将只用这些种子继续去重、下载和证据抽取。`);
      }
    }
    if (relevance.ratio > settings.lowRelevanceRatio) {
      result.innerHTML = `<h3>Pipeline 已停止：检索相关性未过质量门</h3><p>当前候选文献中仍有约 ${Math.round(relevance.ratio * 100)}% 与概念矩阵匹配度低。继续去重、下载和写作会把低相关文献带入证据库。</p><p><b>当前检索式：</b><code>${safeHtml(usedQuery)}</code></p><p>请先修改检索主题或检索式，再重新运行。建议把问题写成：<code>BiVO4 hydrothermal urea morphology facet crystal growth</code>，或在主题中明确“尿素作为结构导向/矿化剂对 BiVO4 晶面和形貌的影响”。</p>`;
      result.classList.remove('hidden');
      finishRunControl('stopped', '质量门停止：检索相关性不足');
      return;
    }
  }

  if (settings.extraSearchProviders) {
    // Each of these three sources has different query syntax from OpenAlex
    // (see query-adapt.js for the full rationale): PubMed needs uppercase
    // Boolean operators, Semantic Scholar's endpoint is plain free-text and
    // doesn't reliably honor Boolean syntax at all, Scopus is passed through
    // (its own skill script already wraps bare queries). usedQuery itself —
    // the one canonical query the Agent loop produced — is never mutated;
    // adaptation happens per call, deterministically, in code.
    const queryPubmed = window.weaverQueryAdapt.adaptQueryForSource(usedQuery, 'pubmed');
    const querySemanticScholar = window.weaverQueryAdapt.adaptQueryForSource(usedQuery, 'semantic-scholar');
    const queryScopus = window.weaverQueryAdapt.adaptQueryForSource(usedQuery, 'scopus');
    const row39 = addStep('第 3.9 步 · 补充数据源检索（PubMed / Semantic Scholar / Scopus，各自按语法改写后的检索式）', `PubMed：${queryPubmed}；Semantic Scholar：${querySemanticScholar}；Scopus：${queryScopus}`);
    const step2d = await runPipelineSkillWithRetry(skills, 'pubmed-search', queryPubmed);
    const step2e = await runPipelineSkillWithRetry(skills, 'semantic-scholar-search', querySemanticScholar);
    const step2f = await runPipelineSkillWithRetry(skills, 'scopus-search', queryScopus);
    const records2d = step2d.manifest?.records || [];
    const records2e = step2e.manifest?.records || [];
    const records2f = step2f.manifest?.records || [];
    const extraTotal = records2d.length + records2e.length + records2f.length;
    if (extraTotal) {
      combined = compactPipelineRecords([...combined, ...records2d, ...records2e, ...records2f], settings.compactRecordsLimit);
    }
    const providerNote = (name, list, manifest) => manifest?.error ? `${name} 失败：${manifest.error}` : `${name} ${list.length} 条`;
    updateStep(
      row39,
      `${providerNote('PubMed', records2d, step2d.manifest)}；${providerNote('Semantic Scholar', records2e, step2e.manifest)}；${providerNote('Scopus', records2f, step2f.manifest)}；合并后共 ${combined.length} 条（去重前，含跨源重复）。`,
      extraTotal ? 'done' : 'error'
    );
  } else {
    addStep('第 3.9 步 · 补充数据源检索（已按设置跳过）', 'Pipeline 设置中关闭了 PubMed/Semantic Scholar/Scopus 补充检索，继续只用 OpenAlex 的结果集。');
  }

  /* Final per-record relevance gate. The ratio-based quality gate above only
     inspects the two OpenAlex result sets, and step 3.9 then merges
     PubMed/Semantic Scholar/Scopus records in without re-checking them, so
     every record — from every source — is re-checked here against the
     concept matrix before dedupe/download, regardless of whether the ratio
     gate ever triggered. Tiers come from classifyRecordTier: core and
     peripheral (all material blocks present) continue; background records
     are isolated. */
  if (settings.relevanceGateEnabled && conceptBlocks.length) {
    const tiered = combined.map((record) => ({ record, tier: classifyRecordTier(record, conceptBlocks) }));
    const keptItems = tiered.filter((item) => item.tier !== 'background');
    const droppedItems = tiered.filter((item) => item.tier === 'background');
    if (!keptItems.length) {
      const rowGate = addStep('第 3.95 步 · 下载前相关性终筛', '没有任何记录通过概念矩阵硬门槛');
      updateStep(rowGate, `${combined.length} 条候选记录全部缺少核心材料块，判定为背景噪声。Pipeline 已停止，不进入去重和下载。`, 'error');
      result.innerHTML = `<h3>Pipeline 已停止：终筛后无相关文献</h3><p>合并后的 ${combined.length} 条候选记录没有一条同时命中概念矩阵的核心材料块。继续下载只会得到与课题无关的文献。</p><p><b>当前检索式：</b><code>${safeHtml(usedQuery)}</code></p><p>建议检查课题描述是否覆盖了核心材料（例如复合材料的每种材料都写进了检索式），再重新运行。</p>`;
      result.classList.remove('hidden');
      finishRunControl('stopped', '质量门停止：终筛后无相关文献');
      return;
    }
    if (droppedItems.length) {
      const droppedNoAbstract = droppedItems.filter((item) => !String(item.record.abstract || '').trim()).length;
      const coreCount = keptItems.filter((item) => item.tier === 'core').length;
      const rowGate = addStep('第 3.95 步 · 下载前相关性终筛', `核心/外围 ${keptItems.length} 条进入下载；背景 ${droppedItems.length} 条被隔离`);
      updateStep(
        rowGate,
        `${combined.length} 条 → ${keptItems.length} 条通过概念矩阵硬门槛（${coreCount} 核心 + ${keptItems.length - coreCount} 外围），隔离 ${droppedItems.length} 条缺少核心材料的记录${droppedNoAbstract ? `（其中 ${droppedNoAbstract} 条摘要缺失、仅按标题判定，建议抽查防误杀）` : ''}。`,
        keptItems.length < 5 ? 'error' : 'done'
      );
      combined = compactPipelineRecords(keptItems.map((item) => item.record), settings.compactRecordsLimit);
    }
  }

  const row4 = addStep('第 4 步 · reference-export-dedupe', '合并去重并导出 RIS/BibTeX/DOI 列表');
  const step4 = await runPipelineSkill(skills, 'reference-export-dedupe', JSON.stringify({ records: combined }));
  updateStep(row4, `输入 ${step4.manifest?.input_records ?? combined.length} 条 → 去重后 ${step4.manifest?.deduped_records ?? '未知'} 条，已导出到 ${step4.manifest?.output_dir || 'literature/exports'}${usedQuery !== query ? `（检索式已深化为：${usedQuery}）` : ''}。`);

  let results5 = [], downloadedCount = 0, blockedCount = 0, sessionPolicy = 'skipped_by_setting', downloadDiagnosticNote = '', downloadedPaths = [];
  if (settings.runDownloadStep) {
    const dedupedPath = pipelineWorkspacePath('literature', 'exports', 'deduped-records.json');

    // Tier 1 — scansci-institutional (scansci-pdf's WebVPN/CARSI/EZproxy resolver).
    //
    // This is the only download path that actually routes *through* WebVPN:
    // scansci_pdf.sources.instsci AES-CFB-encrypts the publisher hostname into a
    // https://wvpn.ustc.edu.cn/https/<hex>/... URL and attaches the saved
    // wengine_vpn_ticket cookie, so the publisher sees the university's IP and
    // its subscription entitlement.
    //
    // paper-downloader (tier 2) opens the *raw* publisher URL from this machine's
    // own IP — its SKILL.md forbids WebVPN URL rewriting — and only reads the
    // WebVPN cookie to *report* login state. That is why runs kept ending at
    // 0 PDFs with anti_bot_challenge/access_denied while the WebVPN session was
    // perfectly valid. Tier 1 first, tier 2 only for what tier 1 could not get.
    const rowInst = addStep('第 5 步 · scansci-institutional（机构通道）', '后台静默：按 DOI 经 WebVPN/CARSI/EZproxy + 开放获取源下载', 'pending');
    // Never let a batch invoke an interactive browser.  Login is deliberately
    // a separate, researcher-initiated action; this runner reports failures
    // that need verification instead of opening one window per DOI.
    const instInput = JSON.stringify({
      records_file: dedupedPath,
      allow_browser: false,
      publisher_login: false,
      scansci_browser_fallback: false,
      browser_workers: 1
    });
    const instRun = runPipelineSkillWithRetry(skills, 'scansci-institutional', instInput, 1);
    pollDownloadProgress(rowInst, instRun);
    let stepInst = await instRun;

    // Self-heal an expired session. scansci-institutional fails fast with
    // needs_login rather than walking every source, so this costs one cheap
    // round-trip; webvpn_auto_login.py then does the whole CAS flow unattended
    // and we retry once. Only a captcha or bad credentials should still reach
    // the researcher.
    if (stepInst.manifest?.needs_login) {
      updateStep(rowInst, 'WebVPN/CARSI 会话已过期，正在尝试自动登录…', 'pending');
      const auto = await runPipelineSkill(skills, 'paper-downloader', JSON.stringify({
        // A pipeline retry must remain silent too.  If a captcha blocks this
        // headless attempt, it returns an actionable failure instead of opening
        // a surprise window; the explicit WebVPN button remains the manual path.
        mode: 'auto_login', timeoutSec: 300, headless: true
      }));
      if (auto.manifest?.logged_in) {
        webvpnSessionOk = true;
        try { sessionStorage.setItem('weaver.webvpn', 'ok'); } catch {}
        updateWebvpnButton();
        updateStep(rowInst, '自动登录成功，正在重试机构通道下载…', 'pending');
        const retryRun = runPipelineSkillWithRetry(skills, 'scansci-institutional', instInput, 1);
        pollDownloadProgress(rowInst, retryRun);
        stepInst = await retryRun;
      } else {
        updateStep(rowInst, `自动登录未成功（${auto.manifest?.status || 'unknown'}）：${auto.manifest?.error || auto.manifest?.next_step || ''}`, 'error');
      }
    }

    const instResults = Array.isArray(stepInst.manifest?.results) ? stepInst.manifest.results : [];
    const instDownloaded = instResults.filter((item) => item.status === 'downloaded');
    const instPaths = Array.isArray(stepInst.manifest?.downloaded_paths) && stepInst.manifest.downloaded_paths.length
      ? stepInst.manifest.downloaded_paths
      : instDownloaded.map((item) => item.path).filter(Boolean);
    const instNeedsLogin = instResults.filter((item) => item.status === 'needs_login').length;
    if (stepInst.manifest?.error) {
      updateStep(rowInst, `机构通道不可用：${stepInst.manifest.error}；改用持久化浏览器会话兜底。`, 'error');
    } else if (instNeedsLogin && !instPaths.length) {
      updateStep(rowInst, `WebVPN/CARSI 会话已过期（${instNeedsLogin} 条）。${stepInst.manifest?.hint || '请重新登录后重跑。'}改用持久化浏览器会话兜底。`, 'error');
    } else {
      updateStep(rowInst, `机构通道成功 ${instPaths.length}/${instResults.length} 篇；会话策略：${stepInst.manifest?.session_policy || 'scansci-pdf institutional'}。`, instPaths.length ? 'done' : 'error');
    }

    // Tier 2 — persistent-browser fallback, scoped to the leftovers.
    const gotDois = new Set(instDownloaded.map((item) => normalizeDoiKey(item.doi)).filter(Boolean));
    const leftover = gotDois.size
      ? dedupeRecordsForDownload(combined).filter((rec) => !gotDois.has(normalizeDoiKey(rec?.doi)))
      : null; // nothing fetched yet → let tier 2 read the full deduped file as before
    const row5 = addStep('第 5 步b · paper-downloader（静默兜底）', leftover ? `机构通道未取到的 ${leftover.length} 篇，改用后台浏览器会话重试` : '后台复用本地 Chrome 的 WebVPN/CARSI 登录会话下载');
    let results5b = [], paths5b = [], browserMode = 'headless', browserPolicy = '';
    if (leftover && !leftover.length) {
      updateStep(row5, '机构通道已覆盖全部文献，无需浏览器兜底。');
      browserPolicy = 'skipped_all_covered';
    } else {
      // This browser fallback uses Chromium in headless mode.  Keep the flag in
      // the request (rather than relying on a runner default) so a stale local
      // setting can never turn a normal download into visible pop-up windows.
      const step5Payload = { records_file: dedupedPath, headless: true, browser_workers: 2 };
      if (leftover) step5Payload.records = leftover;
      const step5Input = JSON.stringify(step5Payload);
      const step5 = await runPipelineSkill(skills, 'paper-downloader', step5Input);
      results5b = step5.manifest?.results || [];
      paths5b = step5.manifest?.downloaded_paths || results5b.filter((item) => item.status === 'downloaded' && item.path).map((item) => item.path);
      browserPolicy = step5.manifest?.session_policy || step5.manifest?.cookie_status || 'unknown';
      browserMode = step5.manifest?.browser_mode || browserMode;
      updateStep(row5, `浏览器兜底成功 ${paths5b.length}/${results5b.length} 篇；会话策略：${browserPolicy}；浏览器模式：${browserMode}。`, paths5b.length ? 'done' : 'error');
    }

    results5 = [...instResults, ...results5b];
    downloadedPaths = [...new Set([...instPaths, ...paths5b])].filter(Boolean);
    // Count papers, not attempts. The two tiers report at different granularity:
    // scansci-institutional returns one result per DOI, while paper-downloader
    // expands every record into pdf_url + landing_page_url + doi and returns one
    // per URL. Summing them produced "39/171" for a 75-paper run — the same
    // paper counted two or three times on both sides of the fraction.
    const paperTotal = Number(step4.manifest?.deduped_records) || combined.length || results5.length;
    downloadedCount = downloadedPaths.length;
    blockedCount = results5.filter((item) => item.status === 'blocked_policy').length;
    const attemptCount = results5.length;
    sessionPolicy = [instPaths.length ? 'scansci-pdf institutional' : null, browserPolicy || null].filter(Boolean).join(' + ') || 'unknown';
    const needsLoginCount = results5.filter((item) => item.status === 'needs_login').length;
    const manualCount = results5.filter((item) => item.status === 'manual_required').length;
    const antiBotCount = results5.filter((item) => item.status === 'anti_bot_challenge').length;
    const accessDeniedCount = results5.filter((item) => item.status === 'access_denied').length;
    const skippedNonPdfCount = results5.filter((item) => item.status === 'skipped_non_pdf_resource').length;
    const notWhitelistedCount = results5.filter((item) => item.status === 'blocked_not_whitelisted').length;
    const blockedNote = blockedCount ? `，另有 ${blockedCount} 条命中盗版/镜像域名已被拦截` : '';
    const diagnosticNote = `${notWhitelistedCount ? `，${notWhitelistedCount} 条未通过期刊白名单/标题规则` : ''}${needsLoginCount ? `，${needsLoginCount} 条需要重新登录` : ''}${antiBotCount ? `，${antiBotCount} 条被出版社反爬/Cloudflare 拦截` : ''}${accessDeniedCount ? `，${accessDeniedCount} 条访问拒绝` : ''}${manualCount ? `，${manualCount} 条需人工查看截图` : ''}${skippedNonPdfCount ? `，${skippedNonPdfCount} 条非 PDF 资源已跳过` : ''}`;
    downloadDiagnosticNote = diagnosticNote;
    // Its own row: overwriting row5 here would erase the tier-2 line and make a
    // two-tier run look like a single browser download in the step log.
    const rowSummary = addStep('第 5 步 · 下载汇总', '合并机构通道与浏览器兜底的结果');
    if ((needsLoginCount || manualCount || downloadedCount === 0) && downloadedCount === 0) {
      const actionHint = needsLoginCount
        ? '请先点“登录/刷新 WebVPN”，在弹出的 Chrome 中完成 WebVPN/CARSI 登录，然后重跑 Pipeline。'
        : antiBotCount
          ? '这不是 WebVPN 登录问题，而是出版社 Cloudflare/反爬挑战；请在持久化 Chrome 中打开对应截图/页面，手动通过验证后重跑。'
          : notWhitelistedCount
            ? '请检查期刊白名单/黑名单规则，确认这些期刊是否应允许下载。'
            : '请查看 paper-downloader 日志中的失败状态后重跑。';
      updateStep(rowSummary, `会话策略：${sessionPolicy}；浏览器模式：${browserMode}；本次未成功下载任何文件${blockedNote}${diagnosticNote}。stop_rule：证据安全门已触发，Pipeline 将停止，不会继续生成笔记、综述或手稿。${actionHint}`, 'error');
      webvpnSessionOk = false;
      try { sessionStorage.removeItem('weaver.webvpn'); } catch {}
    } else {
      updateStep(rowSummary, `成功下载 ${downloadedCount}/${paperTotal} 篇（共 ${attemptCount} 次尝试）${blockedNote}；会话策略：${sessionPolicy}；浏览器模式：${browserMode}${diagnosticNote}。`);
      if (downloadedCount > 0) {
        webvpnSessionOk = true;
        try { sessionStorage.setItem('weaver.webvpn', 'ok'); } catch {}
      }
    }
    const manualQueue = buildManualDownloadQueue(combined, results5);
    publishManualDownloadQueue(manualQueue);
    if (manualQueue.length) {
      addStep(
        '第 5.5 步 · 转入文献订阅手动下载',
        `${manualQueue.length} 篇自动渠道未成功，已加入“文献订阅 → 待手动下载”。请逐篇打开，进入 PDF 页面后点“抓取全文”；保存目录仍为 literature/downloaded-pdfs/。`,
      );
    }
    updateWebvpnButton();
    if (downloadedPaths.length) {
      await checkpointPipelineHistory({
        status: 'running', resumeFrom: 'nature-reader',
        artifacts: { downloadedPaths },
      }).catch((error) => window.researchWeaver.toast(`下载已完成，但恢复清单保存失败：${error.message}`));
    }
    if (downloadedCount === 0) {
      const nextAction = manualQueue.length
        ? `已把 ${manualQueue.length} 篇加入“文献订阅 → 待手动下载”。请在那里逐篇打开并下载；完成后重新运行 P2/后续证据步骤。`
        : '这些记录缺少可用的 DOI/落地页地址，无法建立手动队列；请检查去重导出中的元数据。';
      const antiBotScreenshots = results5
        .filter((item) => item.status === 'anti_bot_challenge' && item.screenshot)
        .slice(0, 3)
        .map((item) => `<li>反爬截图：<code>${safeHtml(item.screenshot)}</code></li>`);
      result.innerHTML = [
        '<h3>Pipeline 已停止：本轮没有成功下载 PDF</h3>',
        '<p>这是证据安全停止。第 5 步没有下载到任何本轮 PDF；如果继续运行，reader 会读取历史 PDF，导致证据卡片、知识图谱、综述和手稿被旧文献污染。</p>',
        '<ul>',
        `<li>检索式：<code>${safeHtml(usedQuery)}</code></li>`,
        `<li>进入下载前文献数：${safeHtml(step4.manifest?.deduped_records ?? combined.length)}</li>`,
        `<li>下载成功：0/${safeHtml(paperTotal)} 篇（共 ${safeHtml(attemptCount)} 次尝试）</li>`,
        `<li>会话策略：${safeHtml(sessionPolicy)}</li>`,
        `<li>浏览器模式：${safeHtml(browserMode)}</li>`,
        `<li>诊断：${safeHtml(downloadDiagnosticNote || '未返回额外诊断')}</li>`,
        ...antiBotScreenshots,
        '</ul>',
        `<p><b>下一步：</b>${safeHtml(nextAction)}</p>`,
        '<p><b>本次不会继续生成证据卡片、综述或手稿；也不会反复自动重试同一批失败项。</b></p>'
      ].join('');
      result.classList.remove('hidden');
      finishRunControl('stopped', '证据安全停止：本轮 PDF 下载为 0');
      return;
    }
  } else {
    addStep('第 5 步 · paper-downloader（已按设置跳过）', 'Pipeline 设置中关闭了下载步骤；后续证据卡片/笔记/综述会基于现有 literature/downloaded-pdfs/ 中已有的文件（如果有），本次不新增下载。');
  }

  const row6 = addStep('第 6 步 · nature-reader', '将已下载 PDF 转为证据卡片');
  if (!downloadedPaths.length) {
    result.innerHTML = '<h3>Pipeline stopped: no current-run PDFs</h3><p>Evidence safety gate: nature-reader will not scan historical PDF folders. Enable paper-downloader, refresh WebVPN/CARSI login, or provide a current-run PDF list before continuing.</p>';
    result.classList.remove('hidden');
    finishRunControl('stopped', 'evidence safety stop: no current-run PDFs');
    return;
  }
  const step6 = await runPipelineSkill(skills, 'nature-reader', JSON.stringify({ pdf_paths: downloadedPaths }), { row: row6 });
  const cards6 = step6.manifest?.cards || [];
  const needsReview = cards6.filter((card) => card.evidence_tier === 'needs_manual_review').length;
  updateStep(row6, `PDF ${step6.manifest?.pdf_count ?? 0} 篇 → 证据卡片 ${step6.manifest?.card_count ?? 0} 张${needsReview ? `，其中 ${needsReview} 张读取失败已标记 needs_manual_review（stop_rule 已生效）` : ''}。`);

  addStep('第 7 步 · pdf（别名，已跳过）', 'research-pipeline.json 中 pdf 是 nature-reader 的可执行别名，产出完全相同；跳过以避免重复覆盖同一批证据卡片文件。');

  const row8 = addStep('第 8 步 · obsidian-bases', '为去重后的文献生成 Obsidian 笔记');
  const step8 = await runPipelineSkill(skills, 'obsidian-bases', '');
  updateStep(row8, `已生成 ${step8.manifest?.notes_created ?? 0} 篇文献笔记（Literature/）。`);

  // literature/evidence-cards/ is shared across runs and the cards carry no DOI,
  // so both consumers below are scoped by the PDFs this run actually downloaded.
  // Without it a new topic synthesises over the previous topic's leftovers.
  const cardScope = JSON.stringify({ card_source_paths: downloadedPaths });

  const row9 = addStep('第 9 步 · zrl-knowledge-graph', 'Agent 抽取语义实体/关系，并生成可交互 HTML 知识图谱');
  const step9 = await generateSemanticKnowledgeGraph(question, cards6, downloadedPaths);
  const skipped9 = step9.manifest?.cards_skipped_out_of_scope || 0;
  const warningCount9 = step9.manifest?.warnings?.length || 0;
  updateStep(row9, `语义实体 ${step9.manifest?.nodes ?? 0} 个、关系 ${step9.manifest?.edges ?? 0} 条（本轮证据卡片 ${step9.manifest?.cards ?? 0} 张${skipped9 ? `，已排除 ${skipped9} 张往期卡片` : ''}${warningCount9 ? `，质量警告 ${warningCount9} 条` : ''}）：${step9.manifest?.html || 'knowledge-graph/knowledge_graph.html'}。`);

  // M3's manual first loop deliberately stops at P2. The legacy one-click
  // Pipeline continues into deep-research/manuscript generation, but doing
  // that here would silently cross the P3 planning and P8 evidence gates.
  if (options.stopAfterGraph) {
    const p12Paths = [
      `${exportsBase}/deduped-records.json`, `${exportsBase}/references.ris`, `${exportsBase}/references.bib`,
      ...results5.filter((item) => item.status === 'downloaded').map((item) => item.path).filter(Boolean),
      ...cards6.map((card) => card.card_path).filter(Boolean),
      ...(step8.manifest?.notes || []), step9.manifest?.html, step9.manifest?.graph, step9.manifest?.report,
    ].filter(Boolean);
    const completion = {
      question, query: usedQuery, paths: [...new Set(p12Paths)], project: options.project || null,
      counts: { records: step4.manifest?.deduped_records ?? 0, pdfs: downloadedCount, evidence_cards: step6.manifest?.card_count ?? 0, graph_nodes: step9.manifest?.nodes ?? 0 },
    };
    result.innerHTML = `<h3>M3 · P1–P2 已完成</h3><p>文献建档、证据卡片和知识图谱已生成；本次按课题模式边界停在 P2，没有提前生成手稿。</p><ul><li>去重文献 ${completion.counts.records} 条</li><li>PDF ${completion.counts.pdfs} 篇</li><li>证据卡片 ${completion.counts.evidence_cards} 张</li><li>图谱节点 ${completion.counts.graph_nodes} 个</li></ul><p class="wv-faint">下一步：在课题注册表中点击“生成 P3–P5 首圈草案”。</p>`;
    result.classList.remove('hidden');
    finishRunControl('done', 'M3 P1–P2 已完成');
    window.dispatchEvent(new CustomEvent('scholarium:pipeline-completed', { detail: completion }));
    return completion;
  }

  const row10 = addStep('第 10 步 · deep-research', '汇总已确立证据与缺口');
  const step10 = await runPipelineSkill(skills, 'deep-research', cardScope);
  updateStep(row10, `综述已写入 ${step10.manifest?.synthesis || 'Research/deep-research-synthesis.json'}（已确立证据 ${(step10.manifest?.established_evidence || []).length} 条）。`);

  const row11 = addStep('第 11 步 · nature-writing', '生成证据边界内的手稿初稿');
  const step11 = await runPipelineSkill(skills, 'nature-writing', '');
  updateStep(row11, `初稿已写入 ${step11.manifest?.draft || 'Manuscript/manuscript-draft.md'}。`);

  const row12 = addStep('第 12 步 · nature-polishing', '弱化过强主张措辞');
  const step12 = await runPipelineSkill(skills, 'nature-polishing', '');
  const changes12 = step12.manifest?.claim_strength_changes || [];
  updateStep(row12, `润色稿已写入 ${step12.manifest?.output || 'Manuscript/manuscript-polished.md'}${changes12.length ? `，弱化了 ${changes12.length} 处过强表述（如 ${changes12.slice(0, 3).map((item) => `${item.from}→${item.to}`).join('、')}）` : ''}。`);

  // Every Skill above writes straight to disk as it runs (no /v1/drafts staging,
  // unlike the older executePlan()/proposalActions() report flow) — that's
  // simply how this Pipeline was designed: it's an unattended multi-file batch,
  // not a single note. But that meant a run finished with no moment for the
  // researcher to actually look at what got written and decide whether to keep
  // it. Track every relative path this run touched so a real keep/discard
  // choice can be offered below, backed by a real delete (not just a UI note).
  const exportsBase = 'literature/exports';
  const notesList = step8.manifest?.notes || [];
  const notesFolder = notesList.length ? notesList[0].split('/').slice(0, -1).join('/') : '';
  const trackedOutputs = {
    '检索导出（第 4 步）': [`${exportsBase}/deduped-records.json`, `${exportsBase}/doi-list.txt`, `${exportsBase}/references.ris`, `${exportsBase}/references.bib`],
    '已下载 PDF（第 5 步）': results5.filter((item) => item.status === 'downloaded').map((item) => item.path).filter(Boolean),
    '证据卡片（第 6 步）': cards6.map((card) => card.card_path).filter(Boolean),
    '文献笔记（第 8 步）': notesFolder ? [...notesList, `${notesFolder}/_base-index.json`] : notesList,
    '交互式知识图谱（第 9 步）': [step9.manifest?.html, step9.manifest?.graph, step9.manifest?.report].filter(Boolean),
    '证据综述（第 10 步）': step10.manifest?.synthesis ? [step10.manifest.synthesis] : [],
    '手稿初稿（第 11 步）': step11.manifest?.draft ? [step11.manifest.draft] : [],
    '润色稿（第 12 步）': step12.manifest?.output ? [step12.manifest.output] : []
  };
  const allTrackedPaths = Object.values(trackedOutputs).flat();

  result.innerHTML = `<h3>Pipeline 运行完成</h3><p>已按 research-pipeline.json 顺序实际执行 11 个本机 Skill 阶段（第 7 步为 nature-reader 的声明别名，已跳过以避免重复写入）。</p><ul>
    <li>检索式：${safeHtml(usedQuery)}${usedQuery !== query ? `（原始 v0：${safeHtml(query)}，因低相关比例过高已自动深化）` : ''}</li>
    <li>精排 ${records2.length} 条 + 广召回 ${records3.length} 条${usedQuery !== query ? '（含深化检索追加记录）' : ''} → 去重后 ${step4.manifest?.deduped_records ?? '未知'} 条</li>
    <li>下载：成功 ${downloadedCount}/${results5.length}${blockedCount ? `，拦截 ${blockedCount} 条盗版/镜像链接` : ''}${downloadDiagnosticNote}（会话策略：${sessionPolicy}）</li>
    <li>证据卡片 ${step6.manifest?.card_count ?? 0} 张（${needsReview} 张待人工复核）</li>
    <li>文献笔记 ${step8.manifest?.notes_created ?? 0} 篇；交互式语义知识图谱已生成${warningCount9 ? `（${warningCount9} 条质量警告待审）` : ''}</li>
  </ul><p><b>产出文件：</b>literature/exports/deduped-records.json、references.ris、references.bib；literature/downloaded-pdfs/*.pdf；literature/evidence-cards/*.json；Literature/*.md；knowledge-graph/knowledge_graph.html、knowledge_graph.json、knowledge_graph-report.md；Research/deep-research-synthesis.json；Manuscript/manuscript-draft.md、manuscript-polished.md。</p><p><small>图谱 HTML 由固定离线渲染器生成，关系由 Agent 从本轮证据中抽取；虚线/推断关系仍需研究者核验。手稿仍需核验证据、补写讨论与结论后才能作为最终稿。</small></p>
  <div class="pipeline-review" data-kept="false">
    <p><b>本次共写入/下载 ${allTrackedPaths.length} 个文件（不含 references.ris/bib 等已列出的固定导出名）。</b>确认保留，或整批撤销这次产出后再重跑：</p>
    <details><summary>查看本次产出清单（按步骤分组）</summary><ul>${Object.entries(trackedOutputs).map(([label, paths]) => `<li><b>${safeHtml(label)}</b>：${paths.length ? paths.map((p) => safeHtml(p)).join('、') : '（无）'}</li>`).join('')}</ul></details>
    <p class="pipeline-review-actions"><button type="button" class="button primary pipeline-keep">确认保留本次结果</button> <button type="button" class="button ghost pipeline-discard">不满意，撤销本次全部产出</button></p>
  </div>`;
  result.classList.remove('hidden');
  finishRunControl('done', 'Pipeline 已完成，等待确认保留或撤销');
  const reviewBox = result.querySelector('.pipeline-review');
  reviewBox.querySelector('.pipeline-keep').onclick = () => {
    reviewBox.dataset.kept = 'true';
    reviewBox.querySelector('.pipeline-review-actions').innerHTML = '<small>已确认保留；这些文件已经在课题工作区中，无需再做任何操作。</small>';
  };
  reviewBox.querySelector('.pipeline-discard').onclick = async () => {
    if (!confirm(`将删除本次 Pipeline 写入/下载的全部 ${allTrackedPaths.length} 个文件（工作区外或本次运行之前已存在的文件不受影响）。此操作不可撤销，是否继续？`)) return;
    const button = reviewBox.querySelector('.pipeline-discard');
    button.disabled = true; button.textContent = '正在撤销…';
    try {
      const outcome = await bridgeFetch('/v1/pipeline/discard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace: workspaceRoot, paths: allTrackedPaths }) });
      reviewBox.querySelector('.pipeline-review-actions').innerHTML = `<small>已删除 ${outcome.deleted.length} 个文件${outcome.skipped.length ? `，${outcome.skipped.length} 个未删除（已不存在或路径异常）` : ''}。可以调整任务目标或检索式后重新点击“一键运行文献 Pipeline”。</small>`;
    } catch (error) {
      button.disabled = false; button.textContent = '不满意，撤销本次全部产出';
      window.researchWeaver.toast(`撤销失败：${error.message}`);
    }
  };
  const completion = { question, query: usedQuery, trackedOutputs, paths: allTrackedPaths, project: options.project || null };
  window.dispatchEvent(new CustomEvent('scholarium:pipeline-completed', { detail: completion }));
  return completion;
}
window.runScholariumResearchPipeline = runResearchPipeline;
// M3 Project mode may offer an explicitly confirmed, hash/path-bound P2
// recovery instead of treating an established local corpus as a fresh search.
// The recovery function itself reads only the parent run's recorded PDF list.
window.resumeScholariumPipelineFromHistory = resumePipelineFromHistory;
document.querySelector('#refreshWebvpn').onclick = async () => {
  try { await refreshWebvpnSession(); }
  catch (error) { window.researchWeaver.toast(`WebVPN 会话刷新失败：${error.message}`); }
};
document.querySelector('#runPipeline').onclick = async () => {
  try { await runResearchPipeline(); }
  catch (error) {
    const stopped = Boolean(activeRunControl?.stopRequested);
    if (stopped) {
      const pending = [...document.querySelectorAll('#runSteps .run-step.pending')].at(-1);
      if (pending) updateStep(pending, '已由用户取消；该步骤和后续步骤均未继续执行。', 'stopped');
    }
    finishRunControl(stopped ? 'stopped' : 'error', stopped ? '已取消' : error.message);
    window.researchWeaver.toast(stopped ? 'Pipeline 已取消。' : `Pipeline 运行失败：${error.message}`);
    document.querySelector('#runDialog').close();
  }
};

/* ---------------------------------------------------------------------------
 * Full 车道面板（fetch_and_attach_pdf）：设计稿 v2 §3 操作预览确认 + 状态卡。
 *
 * 流程：输入 DOI/文献信息 → POST /v1/full-tasks/preview 生成操作预览（类别/
 * 联网/写入范围/计划工具/适配器+执法等级/有效期，§3 四项齐全）→ 用户点确认
 * 后才 POST /v1/full-tasks 真正派发。dispatch 命中 §1 probe 门槛（503）时不
 * 抛原始英文错误，而是翻译成"适配器需要重新探测"的引导界面，带一个直接调
 * /v1/full-tasks/probe 的按钮；probe 通过后预览仍然有效（配置类拒绝不消耗
 * 预览），用户直接再点确认即可。
 *
 * 状态卡：completed / completed-with-violations / failed 三种状态肉眼可分，
 * §5 快照 diff 摘要（新增/修改/删除 + 越界清单）完整亮出，不吞掉"完成但
 * 越界"这个区分。视图模型来自 full-lane-ui-core.js（纯函数，有单测）。
 * ------------------------------------------------------------------------- */
async function bridgeFetchRaw(path, options = {}) {
  const response = await fetch(zhiyanBridge.url + path, options);
  let payload = {};
  try { payload = await response.json(); } catch { /* non-JSON body */ }
  return { status: response.status, payload };
}

function ensureFullLaneDialog() {
  let dialog = document.querySelector('#fullLaneDialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'fullLaneDialog';
  dialog.className = 'registry-dialog pipeline-topic-dialog';
  dialog.innerHTML = `
    <form method="dialog" class="pipeline-topic-form" onsubmit="return false">
      <div class="run-header">
        <div><span class="eyebrow">FULL LANE · FETCH &amp; ATTACH PDF</span><h2>抓取开放获取 PDF</h2></div>
        <button type="button" class="pipeline-topic-close" aria-label="关闭">×</button>
      </div>
      <div class="pipeline-topic-body">
        <div data-stage="input">
          <label>DOI 或文献信息<textarea id="fullLaneInput" rows="3" placeholder="例如：10.48550/arXiv.1706.03762（Attention Is All You Need, Vaswani et al. 2017）"></textarea></label>
          <p class="wv-faint">完整权限车道：Agent 联网定位开放获取 PDF 并报告地址，Bridge 校验（%PDF 魔数 · 512B–50MB · sha256 去重）后自行下载到 <span class="wv-mono">literature/downloaded-pdfs/</span>。Agent 在此类别下没有文件写入工具——写入由 Bridge 执行。</p>
        </div>
        <div data-stage="preview" class="hidden"></div>
        <div data-stage="probe" class="hidden"></div>
      </div>
      <footer class="pipeline-topic-actions">
        <button type="button" class="button ghost" data-action="cancel">取消</button>
        <button type="button" class="button ghost hidden" data-action="back">返回修改</button>
        <button type="button" class="button primary" data-action="next">生成操作预览</button>
      </footer>
    </form>`;
  document.body.appendChild(dialog);
  return dialog;
}

function fullLaneStage(dialog, stage) {
  dialog.querySelectorAll('[data-stage]').forEach((el) => el.classList.toggle('hidden', el.dataset.stage !== stage));
  dialog.querySelector('[data-action="back"]').classList.toggle('hidden', stage === 'input');
  dialog.querySelector('[data-action="next"]').textContent = stage === 'input' ? '生成操作预览' : '确认并派发';
}

function fullLanePreviewHtml(preview) {
  const tools = (preview.plannedTools || []).map((tool) => `<span class="lit-tag">${safeHtml(tool)}</span>`).join('');
  const enforcement = preview.enforcement === 'prevention'
    ? '<span class="wv-fulllane-enforce prevention">预防式执法（OS 沙箱）</span>'
    : '<span class="wv-fulllane-enforce detection">检测式执法（写前快照 + 写后 diff，事后发现）</span>';
  return `
    <dl class="wv-fulllane-preview">
      <dt>操作类别</dt><dd><span class="wv-mono">${safeHtml(preview.category)}</span> — ${safeHtml(preview.description || '')}</dd>
      <dt>联网</dt><dd>${preview.network ? '需要（查询出版方 / arXiv 等开放获取来源）' : '不需要'}</dd>
      <dt>写入范围</dt><dd><span class="wv-mono">${safeHtml(preview.pathScope)}/</span>（仅此目录，且由 Bridge 落盘）</dd>
      <dt>计划工具</dt><dd><span class="wv-fulllane-tools">${tools}</span>（无 Write：Agent 只报告地址）</dd>
      <dt>执行适配器</dt><dd><span class="wv-mono">${safeHtml(preview.adapter || '')}</span> ${enforcement}</dd>
      <dt>预览有效期至</dt><dd>${new Date(preview.expiresAt).toLocaleTimeString('zh-CN')}</dd>
    </dl>
    <p class="wv-faint">点击「确认并派发」后任务才真正启动；本预览 ${'15'} 分钟内有效，一次性使用。</p>`;
}

function renderFullTaskResult(run, promptText) {
  const baseModel = window.weaverFullLaneCore.fullTaskCardModel(run);
  // 回退通道解决过的任务，重渲染（含切页恢复）时如实升级，不再挂「任务失败」。
  const resolved = fullLaneResolved(run && run.id);
  const model = (resolved && (baseModel.tone === 'error' || baseModel.tone === 'info'))
    ? { ...baseModel, tone: 'ok', title: `已完成（${resolved.method}）`, summary: resolved.detail || `该任务经${resolved.method}完成。` }
    : baseModel;
  const resolvedBlock = resolved ? `
    <section class="wv-fulllane-download">
      <b>解决途径</b>
      <p>经${safeHtml(resolved.method)}完成${resolved.path ? `：<span class="wv-mono">${safeHtml(resolved.path)}</span>` : '。'}</p>
    </section>` : '';
  const { result } = window.researchWeaver;
  const downloadBlock = model.download ? `
    <section class="wv-fulllane-download">
      <b>Bridge 落盘</b>
      <p><span class="wv-mono">${safeHtml(model.download.path)}</span>（${safeHtml(model.download.bytesText)} · ${safeHtml(model.download.statusText)}）</p>
      <p class="wv-faint">来源：<a href="${safeHtml(model.download.source_url)}" target="_blank" rel="noreferrer">${safeHtml(model.download.source_url)}</a></p>
    </section>` : '';
  // 付费墙/无 OA 的合法结局：给出可点击的着陆页，并提供"抓取全文存 md"
  // 按钮——复用 Scholarium RSS 阅读器那套隐藏 webview 抓取路径（rss.clip_url
  // 动作，经动作队列由 Obsidian 插件执行），把着陆页正文存成 md 进素材库。
  const landingBlock = model.landing ? `
    <section class="wv-fulllane-landing">
      <b>出版方页面（非开放获取，未下载任何文件）</b>
      <p><a href="${safeHtml(model.landing.url)}" target="_blank" rel="noreferrer">${safeHtml(model.landing.url)}</a></p>
      <p><button class="button ghost capture-landing" data-url="${safeHtml(model.landing.url)}">抓取此页全文存 md（经 Scholarium 插件）</button></p>
      <p class="wv-faint">需要 Obsidian 中的 Scholarium 插件在线（约 20 秒内接管任务）。若遇出版社验证页/付费墙，请在「文献订阅」窗口打开该页、完成验证后手动抓取。</p>
    </section>` : '';
  // 失败时不能把 Agent 的解释吞掉——"did not report a PDF_URL=" 这类机器
  // 结论对用户没有信息量，Agent 的实际分析（为什么找不到、替代建议）才是。
  const agentNote = model.finalMessage ? `
    <details class="wv-fulllane-agent-note"${model.tone === 'error' ? ' open' : ''}>
      <summary>Agent 的完整说明</summary>
      <p>${safeHtml(model.finalMessage)}</p>
    </details>` : '';
  // Bridge 直连下载被拦时的首选回退：机构通道（scansci-institutional）。
  // 这是唯一真正"走 WebVPN"的下载路径——把出版方域名加密包装进
  // wvpn.ustc.edu.cn 的 URL 并带上顶栏那个登录保存的 wengine_vpn_ticket
  // cookie，出版方看到的是学校出口 IP 和订阅权限。顶栏"已登录 WebVPN"
  // 的会话就归这个通道用，所以它是第一选择。
  const instDoi = model.tone === 'error' ? (window.weaverFullLaneCore.doiFromPrompt(promptText) || window.weaverFullLaneCore.doiFromPrompt(model.finalMessage)) : null;
  const instBlock = instDoi ? `
    <section class="wv-fulllane-landing">
      <b>首选：经机构通道（WebVPN）下载</b>
      <p class="wv-faint">顶栏登录的 WebVPN 会话归这个通道使用：按 DOI <span class="wv-mono">${safeHtml(instDoi)}</span> 经学校出口访问出版方并下载 PDF，无需重复登录。</p>
      <p><button class="button primary inst-fetch-pdf">经机构通道（WebVPN）下载 PDF</button></p>
    </section>` : '';
  // 次选回退：浏览器会话下载。它用的是「文献订阅」内置 webview 的登录态
  // （persist:scholarium-research-browser 分区），和顶栏 WebVPN 登录（外部
  // 浏览器 profile）是两个互不相通的会话——只在机构通道也失败、且你愿意
  // 在内置浏览器里手动登录/过验证时用。
  const browserPdf = model.tone === 'error' ? window.weaverFullLaneCore.reportedPdfFromMessage(model.finalMessage) : null;
  const browserBlock = browserPdf ? `
    <section class="wv-fulllane-landing">
      <b>备选：经「文献订阅」浏览器会话下载</b>
      <p class="wv-faint">注意：这是另一套会话——「文献订阅」内置浏览器的登录态，与顶栏 WebVPN 登录互不相通。仅当你在文献订阅窗口里已手动登录出版方/代理时有效。</p>
      <p>
        <button class="button ghost browser-fetch-pdf">经浏览器会话下载 PDF（自动，经 Scholarium 插件）</button>
        <button class="button ghost open-in-reader">在「文献订阅」窗口打开此页（手动下载）</button>
      </p>
      <p class="wv-faint">手动路线：点右边按钮会跳到「文献订阅」并用内置研究浏览器打开该页；登录/过验证后用页面里的抓取按钮完成。两个方法任意一个成功，这张卡都会显示已完成。完成后回到本面板，若卡片仍未更新，点「我已完成手动下载」。</p>
      <p><button class="button ghost manual-resolve">我已完成手动下载</button></p>
    </section>` : '';
  const diffList = (label, items) => items.length
    ? `<div class="wv-fulllane-diff-row"><b>${label}</b><ul class="wv-fulllane-diff-list">${items.map((item) => `<li class="wv-mono">${safeHtml(item)}</li>`).join('')}</ul></div>`
    : '';
  const violationsBlock = model.violations.length ? `
    <div class="wv-fulllane-violations">
      <b>⚠ 声明范围外的改动（系统不自动回滚，请人工核对）</b>
      <ul class="wv-fulllane-diff-list">${model.violations.map((item) => `<li class="wv-mono">${safeHtml(item)}</li>`).join('')}</ul>
    </div>` : '';
  result.innerHTML = `
    <section class="agent-result wv-fulllane-card ${model.tone}">
      <header class="wv-fulllane-card-head"><h3>${safeHtml(model.title)}</h3><span class="lit-tag">${safeHtml(model.adapter)} · ${safeHtml(model.category)}</span></header>
      <p>${safeHtml(model.summary)}</p>
      ${agentNote}
      ${resolvedBlock}
      ${landingBlock}
      ${instBlock}
      ${browserBlock}
      ${downloadBlock}
      <section class="wv-fulllane-diff">
        <b>快照 diff 摘要</b> <small class="wv-faint">新增 ${model.added.length} · 修改 ${model.modified.length} · 删除 ${model.deleted.length}</small>
        ${diffList('新增', model.added)}${diffList('修改', model.modified)}${diffList('删除', model.deleted)}
      </section>
      ${violationsBlock}
    </section>`;
  result.classList.remove('hidden');
  const captureBtn = result.querySelector('.capture-landing');
  if (captureBtn) captureBtn.onclick = () => captureLandingToMarkdown(captureBtn, captureBtn.dataset.url, promptText);
  const browserBtn = result.querySelector('.browser-fetch-pdf');
  if (browserBtn && browserPdf) browserBtn.onclick = () => fetchPdfViaBrowserSession(browserBtn, browserPdf, promptText, run && run.id);
  const instBtn = result.querySelector('.inst-fetch-pdf');
  if (instBtn && instDoi) instBtn.onclick = () => downloadViaInstitutionalChannel(instBtn, instDoi, run && run.id);
  // 手动路线：请 Obsidian 宿主跳到「文献订阅」并用内置研究浏览器打开该页。
  // iframe 与宿主跨源，只能 postMessage；宿主侧监听在 main.js（校验
  // event.source 是本 iframe 才动作）。
  const openBtn = result.querySelector('.open-in-reader');
  if (openBtn && browserPdf) openBtn.onclick = () => {
    try {
      window.parent.postMessage({ type: 'scholarium:open-direct-page', url: browserPdf.pdfUrl }, '*');
      window.researchWeaver.toast('已请求跳到「文献订阅」打开该页；若没反应，请确认 Scholarium 插件为最新版本。');
    } catch { window.researchWeaver.toast('无法与 Obsidian 宿主通信。'); }
  };
  const manualBtn = result.querySelector('.manual-resolve');
  if (manualBtn) manualBtn.onclick = () => {
    markFullLaneResolved(run && run.id, { method: '文献订阅手动抓取', detail: '你在「文献订阅」窗口手动完成了抓取/下载。' });
    upgradeFullLaneCard(manualBtn, '文献订阅手动抓取', '你在「文献订阅」窗口手动完成了抓取/下载。');
    window.researchWeaver.toast('已标记完成；切页再回来时这张卡会保持「已完成」。');
  };
}

// 失败卡片的"经机构通道（WebVPN）下载"按钮：直接调 scansci-institutional
// skill——这是唯一真正走 WebVPN 的下载路径（加密包装出版方域名 +
// wengine_vpn_ticket cookie，出版方看到的是学校出口 IP）。顶栏登录的
// WebVPN 会话归它使用，所以这是 Bridge 直连被拦时的首选回退。输入形状与
// Pipeline 第 5 步完全一致（静默、不开浏览器窗口）。
async function downloadViaInstitutionalChannel(button, doi, fullTaskId) {
  button.disabled = true; button.textContent = '正在通过机构通道下载（WebVPN 会话）…';
  let runId = null;
  try {
    const skillsResp = await bridgeFetchRaw('/v1/skills');
    const skillId = pipelineSkillId(skillsResp.payload.skills || [], 'scansci-institutional');
    const input = JSON.stringify({ dois: [doi], allow_browser: false, publisher_login: false, scansci_browser_fallback: false, browser_workers: 1 });
    const { status, payload } = await bridgeFetchRaw('/v1/skill-runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skillId, workspace: workspaceRoot, input }) });
    if (status < 200 || status >= 300) throw new Error(payload.error || `提交失败 (${status})`);
    runId = payload.id;
  } catch (error) {
    button.disabled = false; button.textContent = '经机构通道（WebVPN）下载 PDF';
    window.researchWeaver.toast(`机构通道提交失败：${error.message}`);
    return;
  }
  const started = Date.now();
  for (let attempt = 0; attempt < 150; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    let run = null;
    try {
      const { status, payload } = await bridgeFetchRaw(`/v1/skill-runs/${runId}`);
      if (status === 200) run = payload;
    } catch { /* 网络抖动，下一轮再试 */ }
    if (!run || run.status === 'running') {
      button.textContent = `机构通道下载中…（已等 ${Math.round((Date.now() - started) / 1000)} 秒）`;
      continue;
    }
    if (run.status === 'completed') {
      const manifest = (run.output && run.output.manifest) || {};
      const results = Array.isArray(manifest.results) ? manifest.results : [];
      const okItem = results.find((item) => item.status === 'downloaded');
      if (okItem) {
        button.textContent = '已通过机构通道下载';
        markFullLaneResolved(fullTaskId, { method: '机构通道（WebVPN）', path: okItem.path || '', detail: `PDF 已保存：${okItem.path || ''}` });
        upgradeFullLaneCard(button, '机构通道（WebVPN）', `PDF 已保存：${okItem.path || ''}`);
        window.researchWeaver.toast(`PDF 已保存：${okItem.path || ''}${okItem.source ? `（来源：${okItem.source}）` : ''}`);
        return;
      }
      if (manifest.needs_login || results.some((item) => item.status === 'needs_login')) {
        button.disabled = false; button.textContent = 'WebVPN 会话已过期，先点顶栏「登录/刷新 WebVPN」再点我重试';
        window.researchWeaver.toast('机构通道报告 WebVPN 会话不可用。请先用顶栏的「登录/刷新 WebVPN」完成登录，再重试本按钮。');
        return;
      }
      button.disabled = false; button.textContent = '机构通道未拿到，点击重试';
      const why = manifest.error || (results[0] && (results[0].error || results[0].status)) || '未知原因';
      window.researchWeaver.toast(`机构通道未下载成功：${why}`);
      return;
    }
    button.disabled = false; button.textContent = '下载失败，点击重试';
    window.researchWeaver.toast(`机构通道失败：${run.error || '未知错误'}`);
    return;
  }
  button.disabled = false; button.textContent = '经机构通道（WebVPN）下载 PDF';
  window.researchWeaver.toast('等待超时（7.5 分钟）。任务可能仍在 Bridge 后台运行，请稍后在 literature/ 目录查看结果。');
}

// 失败卡片的"经浏览器会话下载 PDF"按钮：把 rss.fetch_pdf 动作提交进
// Research/_runs/queue/，由 Obsidian 插件用「文献订阅」共享的浏览器会话
// （含 WebVPN 登录态）取回 PDF 字节、校验（%PDF 魔数 · 512B–50MB · sha256
// 去重）后落盘 literature/downloaded-pdfs/。提交与轮询模式和
// captureLandingToMarkdown 一致，真正的网络与写盘都在插件进程里。
async function fetchPdfViaBrowserSession(button, pdf, promptText, fullTaskId) {
  const title = window.weaverFullLaneCore.titleHintFromPrompt(promptText);
  button.disabled = true; button.textContent = '已提交，等待 Scholarium 插件接管…';
  let itemId = null;
  try {
    const { status, payload } = await bridgeFetchRaw('/v1/scholarium/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'rss.fetch_pdf', input: { pdf_url: pdf.pdfUrl, file_name: pdf.pdfName || '', title }, by: 'weaver-panel' }) });
    if (status !== 202) throw new Error(payload.error || `提交失败 (${status})`);
    itemId = payload.id;
  } catch (error) {
    button.disabled = false; button.textContent = '经浏览器会话下载 PDF（经 Scholarium 插件）';
    window.researchWeaver.toast(`下载任务提交失败：${error.message}`);
    return;
  }
  const started = Date.now();
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    let item = null;
    try {
      const { status, payload } = await bridgeFetchRaw(`/v1/scholarium/actions/${itemId}`);
      if (status === 200) item = payload;
    } catch { /* 网络抖动，下一轮再试 */ }
    if (!item || item.status === 'pending') {
      button.textContent = `插件执行中…（已等 ${Math.round((Date.now() - started) / 1000)} 秒）`;
      continue;
    }
    if (item.status === 'completed') {
      const r = item.result || {};
      if (r.status === 'completed') {
        button.textContent = '已下载并存入 literature/downloaded-pdfs/';
        markFullLaneResolved(fullTaskId, { method: '浏览器会话下载', path: r.path || '', detail: `PDF 已保存：${r.path || ''}` });
        upgradeFullLaneCard(button, '浏览器会话下载', `PDF 已保存：${r.path || ''}`);
        window.researchWeaver.toast(`PDF 已保存：${r.path || ''}${r.download_status === 'variant_saved' ? '（同名不同内容，存为变体）' : ''}`);
      } else if (r.status === 'skipped_existing') {
        button.textContent = '该 PDF 已存在，未重复下载';
        markFullLaneResolved(fullTaskId, { method: '浏览器会话下载', path: r.path || '', detail: `已有相同文件：${r.path || ''}` });
        upgradeFullLaneCard(button, '浏览器会话下载', `已有相同文件：${r.path || ''}`);
        window.researchWeaver.toast(`已有相同文件：${r.path || ''}`);
      } else if (r.status === 'needs_interaction') {
        button.disabled = false; button.textContent = '需要登录后重试（点击重新提交）';
        window.researchWeaver.toast(`${r.detail || '需要人工介入'}`);
      } else {
        button.disabled = false; button.textContent = '经浏览器会话下载 PDF（经 Scholarium 插件）';
        window.researchWeaver.toast(`下载结束（状态：${r.status || '未知'}）`);
      }
      return;
    }
    button.disabled = false; button.textContent = '下载失败，点击重试';
    window.researchWeaver.toast(`浏览器会话下载失败：${item.error || '未知错误'}`);
    return;
  }
  button.disabled = false; button.textContent = '经浏览器会话下载 PDF（经 Scholarium 插件）';
  window.researchWeaver.toast('等待超时（6 分钟）。任务可能仍在 Obsidian 插件队列中——请确认 Obsidian 已打开且设置里允许了织研者动作，稍后在 literature/downloaded-pdfs/ 查看结果。');
}

// landing 卡片的"抓取全文存 md"按钮：把 rss.clip_url 动作提交进
// Research/_runs/queue/（POST /v1/scholarium/actions），Obsidian 插件的队列
// 消费者 20 秒一poll，执行走 RSS 阅读器同一套隐藏 webview 抓取路径。这里只
// 负责提交和轮询结果——真正的页面加载、正文判定、笔记落盘都在插件进程里。
async function captureLandingToMarkdown(button, url, promptText) {
  const title = window.weaverFullLaneCore.titleHintFromPrompt(promptText);
  button.disabled = true; button.textContent = '已提交，等待 Scholarium 插件接管…';
  let itemId = null;
  try {
    const { status, payload } = await bridgeFetchRaw('/v1/scholarium/actions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'rss.clip_url', input: { url, title }, by: 'weaver-panel' }) });
    if (status !== 202) throw new Error(payload.error || `提交失败 (${status})`);
    itemId = payload.id;
  } catch (error) {
    button.disabled = false; button.textContent = '抓取此页全文存 md（经 Scholarium 插件）';
    window.researchWeaver.toast(`抓取任务提交失败：${error.message}`);
    return;
  }
  // 抓取本身可能要 1–3 分钟（90s 页面加载上限 + AI 总结），轮询放宽到 6 分钟。
  const started = Date.now();
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    let item = null;
    try {
      const { status, payload } = await bridgeFetchRaw(`/v1/scholarium/actions/${itemId}`);
      if (status === 200) item = payload;
    } catch { /* 网络抖动，下一轮再试 */ }
    if (!item || item.status === 'pending') {
      button.textContent = `插件执行中…（已等 ${Math.round((Date.now() - started) / 1000)} 秒）`;
      continue;
    }
    if (item.status === 'completed') {
      const r = item.result || {};
      if (r.status === 'completed') {
        button.textContent = '已抓取并存入素材库';
        window.researchWeaver.toast(`全文已保存：${r.clip_note_path || ''}${r.summary_note_path ? '；总结：' + r.summary_note_path : ''}`);
      } else if (r.status === 'skipped_existing') {
        button.textContent = '已有全文与总结，未重复抓取';
        window.researchWeaver.toast(`该文献已有剪藏：${r.clip_note_path || ''}`);
      } else if (r.status === 'needs_interaction') {
        button.disabled = false; button.textContent = '需要手动过验证后重试';
        window.researchWeaver.toast(`遇到验证页/付费墙：${r.detail || ''}。请在「文献订阅」窗口打开该页、完成验证后手动抓取，或稍后重试。`);
      } else {
        button.disabled = false; button.textContent = '抓取此页全文存 md（经 Scholarium 插件）';
        window.researchWeaver.toast(`抓取结束（状态：${r.status || '未知'}）`);
      }
      return;
    }
    button.disabled = false; button.textContent = '抓取失败，点击重试';
    window.researchWeaver.toast(`抓取失败：${item.error || '未知错误'}`);
    return;
  }
  button.disabled = false; button.textContent = '抓取此页全文存 md（经 Scholarium 插件）';
  window.researchWeaver.toast('等待超时（6 分钟）。任务可能仍在 Obsidian 插件队列中——请确认 Obsidian 已打开且设置里允许了织研者动作，稍后在素材库查看结果。');
}

async function watchFullTask(runId, row) {
  const started = Date.now();
  // 运行中在步骤行上挂一个真取消按钮（杀进程树，不是仅仅隐藏卡片）。
  // 只在确认任务进入 running 后显示，避免对早已结束的任务露出无效按钮。
  let cancelBtn = null;
  const ensureCancel = () => {
    if (cancelBtn) return;
    cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'wv-step-cancel';
    cancelBtn.textContent = '取消任务';
    cancelBtn.addEventListener('click', async () => {
      cancelBtn.disabled = true;
      cancelBtn.textContent = '正在取消…';
      try {
        const { status, payload } = await bridgeFetchRaw(`/v1/full-tasks/${runId}/cancel`, { method: 'POST' });
        if (status !== 200) throw new Error(payload.error || `HTTP ${status}`);
        updateStep(row, '已发送取消信号，等待进程退出…', 'pending');
      } catch (error) {
        cancelBtn.disabled = false;
        cancelBtn.textContent = '取消任务';
        window.researchWeaver.toast(`取消失败：${error.message}`);
      }
    });
    row.appendChild(cancelBtn);
  };
  const dropCancel = () => { if (cancelBtn) { cancelBtn.remove(); cancelBtn = null; } };
  try {
    for (let attempt = 0; attempt < 360; attempt++) {
      const { status, payload } = await bridgeFetchRaw(`/v1/full-tasks/${runId}`);
      if (status === 404) { updateStep(row, '运行记录已过期（Bridge 重启会清空内存中的运行记录；bridge/audit/ 仍有审计）', 'error'); return null; }
      if (status === 200 && payload.status !== 'running') return payload;
      if (status === 200) { ensureCancel(); updateStep(row, `Agent 正在定位开放获取 PDF…（已运行 ${Math.round((Date.now() - started) / 1000)} 秒）`, 'pending'); }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    updateStep(row, '等待超过 12 分钟；任务可能仍在后台运行，审计日志可查', 'error');
    return null;
  } finally {
    dropCancel();
  }
}

function openFullLaneDialog(prefillText) {
  const dialog = ensureFullLaneDialog();
  if (!dialog.dataset.wired) {
    dialog.dataset.wired = 'true';
    const state = { preview: null, prompt: '' };
    dialog._state = state;
    dialog.querySelector('.pipeline-topic-close').onclick = () => dialog.close();
    dialog.querySelector('[data-action="cancel"]').onclick = () => dialog.close();
    dialog.querySelector('[data-action="back"]').onclick = () => fullLaneStage(dialog, 'input');
    dialog.querySelector('[data-action="next"]').onclick = async () => {
      // probe 阶段的"立即探测"由下方 addEventListener 的监听器负责，这里直接放行。
      if (!dialog.querySelector('[data-stage="probe"]').classList.contains('hidden')) return;
      const nextBtn = dialog.querySelector('[data-action="next"]');
      const currentStage = state.preview && !dialog.querySelector('[data-stage="preview"]').classList.contains('hidden') ? 'preview' : 'input';
      if (currentStage === 'input') {
        const promptText = dialog.querySelector('#fullLaneInput').value.trim();
        if (promptText.length < 3) return window.researchWeaver.toast('请先填写 DOI 或文献信息。');
        nextBtn.disabled = true; nextBtn.textContent = '正在生成预览…';
        try {
          const { status, payload } = await bridgeFetchRaw('/v1/full-tasks/preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(window.weaverFullLaneCore.buildFetchAndAttachPreviewBody({ workspace: workspaceRoot, prompt: promptText })) });
          if (status !== 201) throw new Error(payload.error || `预览失败 (${status})`);
          state.preview = payload; state.prompt = promptText;
          dialog.querySelector('[data-stage="preview"]').innerHTML = fullLanePreviewHtml(payload);
          fullLaneStage(dialog, 'preview');
        } catch (error) { window.researchWeaver.toast(`操作预览失败：${error.message}`); }
        finally { nextBtn.disabled = false; nextBtn.textContent = '生成操作预览'; }
        return;
      }
      // stage === 'preview'：用户已看过 §3 操作预览，真正派发。
      nextBtn.disabled = true; nextBtn.textContent = '正在派发…';
      try {
        const { status, payload } = await bridgeFetchRaw('/v1/full-tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(window.weaverFullLaneCore.buildFetchAndAttachDispatchBody({ previewId: state.preview.id, category: state.preview.category, workspace: workspaceRoot, prompt: state.prompt })) });
        if (status === 202) {
          // 记住这次派发：iframe 在面板切换时会被整体重建（Chromium 下 iframe
          // 分离 DOM 即重载），任务在 Bridge 侧照跑，丢的只是页面里的进度卡；
          // 加载时 restoreFullLaneRun() 会按这条记录把进度/结果卡恢复回来。
          try { localStorage.setItem(FULL_LANE_LAST_RUN_KEY, JSON.stringify({ id: payload.id, prompt: state.prompt, at: Date.now() })); } catch {}
          dialog.close();
          const { dialog: runDialog, steps, result } = window.researchWeaver;
          runDialog.showModal();
          document.querySelector('#runTitle').textContent = '抓取开放获取 PDF（full 车道）';
          steps.innerHTML = ''; result.classList.add('hidden'); result.innerHTML = '';
          const rowConfirm = addStep('操作预览已确认', `${payload.adapter} · ${payload.enforcement}`);
          updateStep(rowConfirm, `${payload.adapter} · ${payload.enforcement}`, 'done');
          const rowRun = addStep('Agent 定位 + Bridge 下载校验', '正在派发…');
          const run = await watchFullTask(payload.id, rowRun);
          if (run) {
            const model = window.weaverFullLaneCore.fullTaskCardModel(run);
            updateStep(rowRun, model.title, (model.tone === 'ok' || model.tone === 'info') ? 'done' : 'error');
            if (model.tone === 'warn') rowRun.querySelector('i').textContent = '⚠';
            renderFullTaskResult(run, state.prompt);
            loadRunHistory(); // 终态已落盘，刷新历史任务列表
          }
          return;
        }
        const gate = window.weaverFullLaneCore.probeGateFromError(status, payload.error);
        if (gate) {
          // §1 探测门槛拒绝：不抛原始错误，翻译成引导界面；预览未被消耗。
          const probeStage = dialog.querySelector('[data-stage="probe"]');
          probeStage.innerHTML = `
            <div class="wv-fulllane-probe-block">
              <b>适配器需要先完成一次能力探测</b>
              <p>${safeHtml(gate.reasonText)}（适配器 <span class="wv-mono">${safeHtml(gate.adapter)}</span>）。探测是一次真实的最小任务——验证"声明允许的工具确实可用"和"边界确实拦得住"，通常需要 1–2 分钟。你的操作预览仍然有效，探测通过后直接再点「确认并派发」即可。</p>
              <p class="wv-faint" data-probe-detail></p>
            </div>`;
          fullLaneStage(dialog, 'probe');
          nextBtn.textContent = `立即探测 ${gate.adapter}`;
          dialog.querySelector('[data-action="back"]').classList.remove('hidden');
          state.probeAdapter = gate.adapter;
          return;
        }
        throw new Error(payload.error || `派发失败 (${status})`);
      } catch (error) { window.researchWeaver.toast(`派发失败：${error.message}`); fullLaneStage(dialog, 'preview'); }
      finally { if (!dialog.querySelector('[data-stage="probe"]').classList.contains('hidden')) { nextBtn.disabled = false; } else { nextBtn.disabled = false; nextBtn.textContent = dialog.querySelector('[data-stage="preview"]').classList.contains('hidden') ? '生成操作预览' : '确认并派发'; } }
    };
    // probe 阶段的 next 按钮复用：stage 为 probe 时点击 = 调 /v1/full-tasks/probe。
    dialog.querySelector('[data-action="next"]').addEventListener('click', async () => {
      if (dialog.querySelector('[data-stage="probe"]').classList.contains('hidden')) return;
      const adapter = dialog._state.probeAdapter;
      if (!adapter) return;
      const nextBtn = dialog.querySelector('[data-action="next"]');
      const detail = dialog.querySelector('[data-probe-detail]');
      nextBtn.disabled = true; nextBtn.textContent = '正在探测（真实 Agent 调用，约 1–2 分钟）…';
      try {
        const { status, payload } = await bridgeFetchRaw('/v1/full-tasks/probe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adapter }) });
        if (status === 200 && payload.ok) {
          window.researchWeaver.toast(`${adapter} 探测通过（工具可用性 + 边界执法均验证）`);
          dialog._state.probeAdapter = null;
          fullLaneStage(dialog, 'preview');
        } else {
          const checks = payload.checks ? Object.entries(payload.checks).map(([key, value]) => `${key}: ${Array.isArray(value) ? JSON.stringify(value) : value}`).join('；') : (payload.error || '未知原因');
          if (detail) detail.textContent = `探测未通过——${checks}。可先排查 CLI 登录/网络后重试。`;
          nextBtn.textContent = `重试探测 ${adapter}`;
        }
      } catch (error) { window.researchWeaver.toast(`探测请求失败：${error.message}`); nextBtn.textContent = `重试探测 ${adapter}`; }
      finally { nextBtn.disabled = false; }
    });
  }
  fullLaneStage(dialog, 'input');
  dialog.querySelector('[data-stage="preview"]').innerHTML = '';
  dialog.querySelector('[data-stage="probe"]').innerHTML = '';
  // 每次打开都重置上一轮遗留的预览状态；预填文本（如检索结果卡片带过来的
  // DOI/标题）只在显式传入时写入，否则保留用户上次未提交的手稿。
  if (dialog._state) { dialog._state.preview = null; dialog._state.prompt = ''; dialog._state.probeAdapter = null; }
  if (typeof prefillText === 'string' && prefillText.trim()) dialog.querySelector('#fullLaneInput').value = prefillText.trim();
  dialog.showModal();
}

document.querySelector('#fetchOaPdf').onclick = async () => {
  try {
    if (!zhiyanBridge.online) await connectBridge();
    if (!zhiyanBridge.online) throw new Error('本机 Bridge 未连接。');
    const workspace = await loadWorkspace();
    if (!workspace.isDirectory) throw new Error('请先设置存在的课题工作区。');
    openFullLaneDialog();
  } catch (error) { window.researchWeaver.toast(error.message); }
};

// --- full 车道任务的跨页面恢复 ---------------------------------------------
// 织研者面板是 main.js render() 里新建的 iframe；切到别的面板再切回来时
// contentEl.empty() 会把它拆下来，而 Chromium 里 iframe 一旦脱离 DOM 就重载，
// 页面内的进度/结果卡随之丢失（任务本身在 Bridge 侧照常运行）。无法在
// main.js 里"保住" iframe——切去其他面板时 originalRender 同样会 empty()
// 容器——所以这里反过来做：加载时按 localStorage 里的最近一条派发记录向
// Bridge 要回运行状态，还在跑就续上监听，已结束就把结果卡重新渲染出来。
const FULL_LANE_LAST_RUN_KEY = 'weaver.fullLane.lastRun';
// 回退通道（机构通道/浏览器会话/手动抓取）成功后，把「这条 full 任务其实
// 已经解决」记下来：任务本体（Bridge 直连下载）确实失败了，卡片不能篡改
// 这个事实，但要在重渲染时如实升级为「已完成（经××通道）」，而不是永远
// 挂着「任务失败」。按任务 id 存 localStorage，切页/重启面板后仍生效。
const FULL_LANE_RESOLVED_PREFIX = 'weaver.fullLane.resolved.';
function fullLaneResolved(id) {
  if (!id) return null;
  try { return JSON.parse(localStorage.getItem(FULL_LANE_RESOLVED_PREFIX + id) || 'null'); } catch { return null; }
}
function markFullLaneResolved(id, info) {
  if (!id) return;
  try { localStorage.setItem(FULL_LANE_RESOLVED_PREFIX + id, JSON.stringify({ ...info, at: Date.now() })); } catch {}
}
// 成功后原地升级当前显示着的卡片（不篡改历史，只是如实补上解决途径）。
function upgradeFullLaneCard(button, method, detail) {
  const result = window.researchWeaver.result;
  const card = result && result.querySelector('.wv-fulllane-card');
  if (card) {
    card.classList.remove('error', 'warn');
    card.classList.add('ok');
    const head = card.querySelector('h3');
    if (head) head.textContent = `已完成（${method}）`;
    const summary = card.querySelector(':scope > p');
    if (summary && detail) summary.textContent = detail;
    card.querySelectorAll('button').forEach((b) => { b.disabled = true; });
  }
}
async function restoreFullLaneRun() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(FULL_LANE_LAST_RUN_KEY) || 'null'); } catch { return; }
  if (!saved || !saved.id) return;
  if (Date.now() - Number(saved.at || 0) > 24 * 3600 * 1000) { try { localStorage.removeItem(FULL_LANE_LAST_RUN_KEY); } catch {} return; }
  const { status, payload } = await bridgeFetchRaw(`/v1/full-tasks/${saved.id}`);
  // Bridge 重启会清空内存中的运行记录（审计在 bridge/audit/），404 即不可恢复。
  if (status === 404) { try { localStorage.removeItem(FULL_LANE_LAST_RUN_KEY); } catch {} return; }
  if (status !== 200) return;
  const { dialog, steps, result } = window.researchWeaver;
  dialog.showModal(); // shell-ui.js 里这只是把追踪栏切到"步骤"页签
  document.querySelector('#runTitle').textContent = '抓取开放获取 PDF（full 车道 · 切换页面后恢复）';
  steps.innerHTML = ''; result.classList.add('hidden'); result.innerHTML = '';
  // 可关闭的恢复卡片：用户明确关掉后才清除 localStorage 里的恢复记录——
  // 不关就一直在（下次切页仍会恢复）；关掉只是不再占这个面板位，右侧
  // 「历史任务」列表里的记录不受影响（那是 Bridge 落盘的 run-history）。
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'wv-restore-dismiss';
  dismiss.textContent = '关闭此卡片';
  dismiss.title = '不再在本面板显示这条恢复记录；历史任务列表里仍可回看';
  dismiss.addEventListener('click', () => {
    try { localStorage.removeItem(FULL_LANE_LAST_RUN_KEY); } catch {}
    steps.innerHTML = '';
    result.classList.add('hidden'); result.innerHTML = '';
    const note = document.createElement('p');
    note.className = 'wv-faint wv-restore-dismissed-note';
    note.textContent = payload.status === 'running'
      ? '已关闭。任务仍在 Bridge 后台运行，可从右侧「历史任务」重新打开查看。'
      : '已关闭。历史记录保留在右侧「历史任务」列表中。';
    steps.appendChild(note);
  });
  steps.appendChild(dismiss);
  const row = addStep('页面切换前派发的任务', `任务 ${String(saved.id).slice(0, 8)}…`);
  if (payload.status === 'running') {
    updateStep(row, '任务仍在运行，继续监听…', 'pending');
    const run = await watchFullTask(saved.id, row);
    if (run) {
      const model = window.weaverFullLaneCore.fullTaskCardModel(run);
      updateStep(row, model.title, (model.tone === 'ok' || model.tone === 'info') ? 'done' : 'error');
      if (model.tone === 'warn') row.querySelector('i').textContent = '⚠';
      renderFullTaskResult(run, saved.prompt || '');
    }
    return;
  }
  updateStep(row, '任务已结束，结果卡已在下方恢复', payload.status === 'completed' ? 'done' : 'error');
  renderFullTaskResult(payload, saved.prompt || '');
}
// 页面加载时（在 connectBridge(true) 之后）尝试恢复一次；失败静默，不影响正常使用。
(async () => {
  try {
    for (let attempt = 0; attempt < 20 && !zhiyanBridge.online; attempt++) await new Promise((resolve) => setTimeout(resolve, 500));
    if (zhiyanBridge.online) {
      const history = await loadRunHistory();
      await restoreLatestPipelineRun(history);
      await restoreFullLaneRun();
    }
  } catch { /* 恢复失败不影响面板正常使用 */ }
})();

// --- 历史任务列表（追踪器顶部，可折叠） --------------------------------------
// 数据源是 Bridge 落盘的运行记录（runtime/run-history/）：iframe 切面板重载、
// 甚至 Bridge 重启后都能列出，点击任意一条把它的结果重新渲染进追踪器——
// full 车道恢复结果卡（还在跑的续上监听），检索恢复文献卡片列表。
const HISTORY_STATUS_TEXT = { running: '运行中', completed: '已完成', 'completed-with-violations': '已完成（有越界）', failed: '失败', cancelled: '已取消', stopped: '已停止', interrupted: '已中断' };
function ensureHistoryHost() {
  let host = document.querySelector('#runHistory');
  if (host) return host;
  const stepsEl = document.querySelector('#runSteps');
  if (!stepsEl || !stepsEl.parentElement) return null;
  host = document.createElement('details');
  host.id = 'runHistory';
  host.className = 'wv-history';
  host.open = true;
  host.innerHTML = '<summary>历史任务 <span class="wv-history-count wv-faint"></span></summary><div class="wv-history-list"></div>';
  stepsEl.parentElement.insertBefore(host, stepsEl);
  return host;
}
function historyTime(value) {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
}
async function loadRunHistory() {
  const host = ensureHistoryHost();
  if (!host) return;
  const listEl = host.querySelector('.wv-history-list');
  let data;
  try {
    const { status, payload } = await bridgeFetchRaw('/v1/history');
    if (status !== 200) throw new Error(payload.error || `HTTP ${status}`);
    data = payload;
  } catch {
    listEl.innerHTML = '<p class="wv-faint">历史任务暂不可用（Bridge 未连接或过旧）。</p>';
    return null;
  }
  const rows = [
    ...(data.pipelines || []).map((r) => ({ ...r, time: r.startedAt })),
    ...(data.fullTasks || []).map((r) => ({ ...r, time: r.startedAt })),
    ...(data.searches || []).map((s) => ({ ...s, time: s.createdAt })),
  ].sort((a, b) => String(b.time || '').localeCompare(String(a.time || ''))).slice(0, 30);
  host.querySelector('.wv-history-count').textContent = rows.length ? `（${rows.length}）` : '';
  if (!rows.length) { listEl.innerHTML = '<p class="wv-faint">还没有历史任务。</p>'; return data; }
  listEl.innerHTML = rows.map((row) => {
    if (row.kind === 'pipeline') {
      return `<button type="button" class="wv-history-row" data-kind="pipeline" data-id="${safeHtml(row.id)}">`
        + `<span class="lit-tag">流程</span><span class="wv-history-title">${safeHtml(row.title || '文献 Pipeline')}</span>`
        + `<span class="wv-history-meta">${historyTime(row.time)} · ${safeHtml(HISTORY_STATUS_TEXT[row.status] || row.status || '')} · ${row.completedSteps}/${row.stepCount} 步${row.pdfCount ? ` · PDF ${row.pdfCount}` : ''}</span></button>`;
    }
    if (row.kind === 'full-task') {
      return `<button type="button" class="wv-history-row" data-kind="full-task" data-id="${safeHtml(row.id)}">`
        + `<span class="lit-tag">PDF</span><span class="wv-history-title">${safeHtml(row.title || row.category || '')}</span>`
        + `<span class="wv-history-meta">${historyTime(row.time)} · ${safeHtml(HISTORY_STATUS_TEXT[row.status] || row.status || '')}</span></button>`;
    }
    return `<button type="button" class="wv-history-row" data-kind="search" data-id="${safeHtml(row.id)}">`
      + `<span class="lit-tag">检索</span><span class="wv-history-title">${safeHtml(row.title || '')}</span>`
      + `<span class="wv-history-meta">${historyTime(row.time)} · ${row.recordCount} 条</span></button>`;
  }).join('');
  listEl.querySelectorAll('.wv-history-row').forEach((btn) => {
    btn.onclick = () => (btn.dataset.kind === 'pipeline' ? openHistoryPipeline(btn.dataset.id) : btn.dataset.kind === 'full-task' ? openHistoryFullTask(btn.dataset.id) : openHistorySearch(btn.dataset.id));
  });
  return data;
}

// A Pipeline is orchestrated by this iframe.  Older host builds destroyed the
// iframe when the user opened Literature subscriptions, leaving a perfectly
// useful Bridge checkpoint but a blank tracker after returning.  On boot,
// automatically reopen the newest running/interrupted Pipeline so the user
// immediately sees where it stopped and can resume from its captured PDFs.
// Completed historical runs remain collapsed in the history list and never
// replace a newly started live run.
async function restoreLatestPipelineRun(history) {
  if (activePipelineHistoryId || !history || !Array.isArray(history.pipelines)) return;
  const candidate = history.pipelines
    .filter((run) => run && (run.status === 'running' || run.status === 'interrupted'))
    .sort((a, b) => String(b.updatedAt || b.startedAt || '').localeCompare(String(a.updatedAt || a.startedAt || '')))[0];
  if (!candidate?.id) return;
  await openHistoryPipeline(candidate.id, { automaticRestore: true });
}

async function openHistoryPipeline(id, options = {}) {
  if (activePipelineHistoryId) { window.researchWeaver.toast('当前 Pipeline 仍在运行，请先完成或取消后再打开历史记录。'); return; }
  const { status, payload } = await bridgeFetchRaw(`/v1/pipeline-runs/${id}`);
  if (status !== 200) { window.researchWeaver.toast(payload.error || `无法打开 Pipeline 历史 (${status})`); return; }
  const { dialog, steps, result } = window.researchWeaver;
  dialog.showModal();
  const interrupted = payload.status === 'interrupted';
  document.querySelector('#runTitle').textContent = interrupted
    ? 'Pipeline 已中断 · 已恢复进度'
    : payload.status === 'running' ? 'Pipeline 运行中 · 已恢复进度' : '历史 Pipeline · 可恢复运行';
  steps.innerHTML = ''; result.classList.add('hidden'); result.innerHTML = '';
  for (const step of payload.steps || []) addStep(step.title, step.detail, step.state);
  const pdfPaths = Array.isArray(payload.artifacts?.downloadedPaths) ? payload.artifacts.downloadedPaths : [];
  const canResume = pdfPaths.length > 0 && payload.resumeFrom === 'nature-reader';
  result.innerHTML = `<h3>${safeHtml(payload.title || '文献 Pipeline')}</h3>
    <p>状态：${safeHtml(HISTORY_STATUS_TEXT[payload.status] || payload.status || '')}；已恢复 ${(payload.steps || []).filter((step) => step.state !== 'pending').length}/${(payload.steps || []).length} 个步骤状态；已保存本批次 PDF ${pdfPaths.length} 篇。</p>
    ${interrupted ? '<p class="quality-gate warning"><b>为什么停下：</b>切换页面时旧版宿主卸载了织研者工作区，浏览器侧 Pipeline 编排随之停止。已完成的文件和步骤记录没有丢失。</p>' : ''}
    ${canResume ? '<p>可以复用这批 PDF，跳过检索和下载，从第 6 步证据卡片继续。系统只读取本记录中的文件，不会扫描其他课题的历史 PDF。</p><button type="button" class="button primary pipeline-resume">从已下载 PDF 继续</button>' : '<p class="wv-faint">该记录没有保存可恢复的 PDF 清单，不能安全地从下游继续。旧版本记录需要重新运行一次下载阶段。</p>'}`;
  result.classList.remove('hidden');
  result.querySelector('.pipeline-resume')?.addEventListener('click', async () => {
    if (!confirm(`将复用这次记录中的 ${pdfPaths.length} 篇 PDF，从 nature-reader 继续；不会重新检索或下载。是否继续？`)) return;
    try { await resumePipelineFromHistory(payload); }
    catch (error) {
      finishRunControl(activeRunControl?.stopRequested ? 'stopped' : 'error', error.message);
      window.researchWeaver.toast(activeRunControl?.stopRequested ? 'Pipeline 续跑已取消。' : `Pipeline 续跑失败：${error.message}`);
    }
  });
}

async function resumePipelineFromHistory(parent) {
  const downloadedPaths = parent.artifacts?.downloadedPaths || [];
  if (!downloadedPaths.length) throw new Error('历史记录中没有可恢复的 PDF。');
  workspaceRoot = parent.workspace;
  if (workspaceInput) workspaceInput.value = workspaceRoot;
  startRunControl('pipeline', 'Pipeline 断点续跑');
  const { dialog, steps, result } = window.researchWeaver;
  document.querySelector('#runTitle').textContent = 'M3 P1–P2 · 从历史 PDF 恢复';
  dialog.showModal(); steps.innerHTML = ''; result.classList.add('hidden'); result.innerHTML = '';
  await beginPipelineHistory(`续跑：${parent.title || '文献 Pipeline'}`, workspaceRoot, parent.id);
  await checkpointPipelineHistory({ status: 'running', resumeFrom: 'nature-reader', artifacts: { downloadedPaths } });
  addStep('恢复点 · 已复用历史下载', `来自 ${historyTime(parent.startedAt)} 的 Pipeline；精确复用 ${downloadedPaths.length} 篇 PDF，已跳过检索与下载。`, 'done');
  const skills = (await bridgeFetch('/v1/skills')).skills;
  const row6 = addStep('第 6 步 · nature-reader', '将该批次已下载 PDF 转为证据卡片');
  const step6 = await runPipelineSkill(skills, 'nature-reader', JSON.stringify({ pdf_paths: downloadedPaths }), { row: row6 });
  const cards = step6.manifest?.cards || [];
  updateStep(row6, `PDF ${step6.manifest?.pdf_count ?? downloadedPaths.length} 篇 → 证据卡片 ${step6.manifest?.card_count ?? cards.length} 张。`);
  addStep('第 7 步 · pdf（别名，已跳过）', '与 nature-reader 产出相同，避免重复执行。', 'done');
  const row8 = addStep('第 8 步 · obsidian-bases', '恢复生成文献笔记');
  const step8 = await runPipelineSkill(skills, 'obsidian-bases', '');
  updateStep(row8, `已生成 ${step8.manifest?.notes_created ?? 0} 篇文献笔记。`);
  const row9 = addStep('第 9 步 · zrl-knowledge-graph', '仅使用该批次证据卡片恢复语义 HTML 知识图谱');
  const step9 = await generateSemanticKnowledgeGraph(parent.title || window.researchWeaver?.taskGoal?.value || '科研主题', cards, downloadedPaths);
  updateStep(row9, `语义实体 ${step9.manifest?.nodes ?? 0} 个、关系 ${step9.manifest?.edges ?? 0} 条：${step9.manifest?.html || 'knowledge-graph/knowledge_graph.html'}。`);
  result.innerHTML = `<h3>断点续跑完成</h3><p>已复用 ${downloadedPaths.length} 篇历史下载 PDF，完成证据卡片、文献笔记和知识图谱；没有重复检索或下载，也没有读取其他批次的 PDF。</p>`;
  result.classList.remove('hidden');
  finishRunControl('done', '断点续跑已完成');
}

async function openHistoryFullTask(id) {
  if (activePipelineHistoryId) { window.researchWeaver.toast('当前 Pipeline 仍在运行，请先完成或取消后再打开历史记录。'); return; }
  const { status, payload } = await bridgeFetchRaw(`/v1/full-tasks/${id}`);
  if (status !== 200) { window.researchWeaver.toast(payload.error || `无法打开历史任务 (${status})`); return; }
  const { dialog, steps, result } = window.researchWeaver;
  dialog.showModal();
  document.querySelector('#runTitle').textContent = '历史任务 · 抓取开放获取 PDF（full 车道）';
  steps.innerHTML = ''; result.classList.add('hidden'); result.innerHTML = '';
  if (payload.status === 'running') {
    const row = addStep('任务仍在运行', '继续监听…');
    const run = await watchFullTask(id, row);
    if (run) {
      const model = window.weaverFullLaneCore.fullTaskCardModel(run);
      updateStep(row, model.title, (model.tone === 'ok' || model.tone === 'info') ? 'done' : 'error');
      if (model.tone === 'warn') row.querySelector('i').textContent = '⚠';
      renderFullTaskResult(run, payload.userPrompt || '');
      loadRunHistory();
    }
    return;
  }
  addStep(`历史任务（${historyTime(payload.startedAt)} 派发）`, HISTORY_STATUS_TEXT[payload.status] || payload.status || '', (payload.status === 'failed' || payload.status === 'interrupted') ? 'error' : 'done');
  renderFullTaskResult(payload, payload.userPrompt || '');
}

async function openHistorySearch(id) {
  if (activePipelineHistoryId) { window.researchWeaver.toast('当前 Pipeline 仍在运行，请先完成或取消后再打开历史记录。'); return; }
  const { status, payload } = await bridgeFetchRaw(`/v1/literature/searches/${id}`);
  if (status !== 200) { window.researchWeaver.toast(payload.error || `无法打开历史检索 (${status})`); return; }
  const { dialog, steps, result } = window.researchWeaver;
  dialog.showModal();
  document.querySelector('#runTitle').textContent = '历史检索 · 开放文献';
  steps.innerHTML = ''; result.classList.add('hidden'); result.innerHTML = '';
  const records = payload.manifest?.records || [];
  const sources = (payload.sources || []).map((s) => (s.ok ? `${s.source} ${s.count}` : `${s.source} 失败`)).join(' · ');
  addStep(`历史检索（${historyTime(payload.createdAt)}）`, `返回 ${records.length} 条记录。${sources}`, 'done');
  result.innerHTML = `<h3>检索结果（历史重开）</h3><p>检索式：<span class="wv-mono">${safeHtml(payload.query || '')}</span>。卡片的「抓取」按钮走完整权限车道，需你确认后才派发。</p><div class="literature-results">${records.map(literatureCard).join('')}</div>`;
  result.classList.remove('hidden');
  wireOaDownloadButtons(result, records);
}
