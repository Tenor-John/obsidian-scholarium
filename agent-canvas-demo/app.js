const PROFILE_STORE = 'research-weaver:profiles:v1';
const SKILL_STORE = 'research-weaver:skills:v1';
const FLOW_STORE = 'research-weaver:flow:v2';
const FLOWS_STORE = 'research-weaver:flows:v1';
const ACTIVE_FLOW_STORE = 'research-weaver:active-flow:v1';
const TOPIC_STORE = 'research-weaver:topics:v1';
const defaultProfiles = [
  { id: 'research-theory-agent', name: '科研论主 Agent', adapterId: 'codex', icon: '◉', subtitle: '对话式课题设计与迭代', role: '依据实际证据与研究员回答，提出、审计并迭代可证伪的研究方案。', description: '单 Agent 科研论', locked: true },
  { id: 'codex-auditor', name: 'Codex 审计者', adapterId: 'codex', icon: '⌘', subtitle: '证据链与代码审计', role: '核对主张、来源、文件范围与可复现性。', description: '用于独立审计与反思', locked: true },
  { id: 'claude-extractor', name: 'Claude 证据提取者', adapterId: 'claude', icon: '✺', subtitle: '文档与证据提取', role: '从授权资料中提取候选主张、观察与来源片段。', description: '用于资料结构化', locked: true },
  { id: 'hermes-retriever', name: 'Hermes 检索员', adapterId: 'hermes', icon: '◇', subtitle: '本地检索与记忆', role: '检索实验记录、文献笔记与课题上下文。', description: '用于课题资料定位', locked: true },
  { id: 'opencode-builder', name: 'OpenCode 实施者', adapterId: 'opencode', icon: '⌁', subtitle: '实现与测试', role: '在得到确认后实施受限修改并提供验证。', description: '用于可执行实现', locked: true },
  { id: 'openclaw-orchestrator', name: 'OpenClaw 编排者', adapterId: 'openclaw', icon: '♜', subtitle: '任务分派与汇总', role: '协调多 Agent 阶段、交接输入与最终汇总。', description: '用于流程协调', locked: true }
];
const defaultSkills = [
  { id: 'retrieve', name: '课题检索', icon: '⌕', subtitle: '文献与实验上下文', instruction: '定位与任务最相关的实验记录、路线图和文献笔记；只报告实际读到的来源。', output: '来源路径、相关片段、缺失资料', locked: true },
  { id: 'download-open-access', name: '开放全文下载', icon: '⇩', subtitle: '确认后下载并验证 PDF', instruction: '仅从上游开放访问候选中下载并验证 PDF；保留下载日志，不得绕过付费墙。', output: '已保存 PDF、失败链接、来源与时间戳', locked: true },
  { id: 'evidence', name: '证据提取', icon: '▣', subtitle: '观察 / 结论 / 局限', instruction: '将原始资料拆成观察、推断、主张和局限，禁止把推断写成事实。', output: '原子主张、证据片段、局限', locked: true },
  { id: 'claim-audit', name: 'Claim 审计', icon: '✓', subtitle: '来源匹配与结论强度', instruction: '逐条核对主张是否被实际来源直接支持，标记结论强度与不确定性。', output: '结论等级、来源、缺口、下一步', locked: true },
  { id: 'red-team', name: '红队审稿', icon: '⚑', subtitle: '替代解释与缺失对照', instruction: '假设当前结论可能错误；提出最强替代解释、混杂因素和关键对照。', output: '替代解释、反证、最低验证实验', locked: true },
  { id: 'synthesis', name: '证据汇总', icon: '↔', subtitle: '阶段结果整合', instruction: '整合上游阶段结果，区分事实、推断与假设，并输出可执行的研究下一步。', output: '带来源的审计结论与行动清单', locked: true },
  { id: 'research-theory', name: '科研论对话', icon: '◉', subtitle: '约束澄清、方案设计与自审计', instruction: '基于证据底座与研究员回答提出高信息量问题；形成假设、对照、实验漏斗和 stop/go 规则；未通过自审计时修订。', output: '问题清单、可证伪方案、审计结果、下一步行动', locked: true }
];
const clone = (value) => JSON.parse(JSON.stringify(value));
function loadRegistry(key, defaults) { try { const saved = JSON.parse(localStorage.getItem(key)); return Array.isArray(saved) && saved.length ? saved : clone(defaults); } catch { return clone(defaults); } }
let profiles = loadRegistry(PROFILE_STORE, defaultProfiles);
let skills = loadRegistry(SKILL_STORE, defaultSkills);
let registryMigrated = false;
for (const defaultSkill of defaultSkills) {
  if (!skills.some((skill) => skill.id === defaultSkill.id)) { skills.push(clone(defaultSkill)); registryMigrated = true; }
}
for (const defaultProfile of defaultProfiles) {
  if (!profiles.some((profile) => profile.id === defaultProfile.id)) { profiles.push(clone(defaultProfile)); registryMigrated = true; }
}
for (const profile of profiles) {
  if (profile.id === 'openclaw-orchestrator' && profile.locked && profile.adapterId === 'openclaw') { profile.adapterId = 'claude'; profile.name = 'Claude 研究编排者'; profile.subtitle = '任务分派与汇总'; registryMigrated = true; }
  if (profile.id === 'hermes-retriever' && profile.locked && profile.adapterId === 'hermes') { profile.adapterId = 'claude'; profile.name = 'Claude 检索员'; profile.subtitle = '本地资料定位'; registryMigrated = true; }
}
if (registryMigrated) localStorage.setItem(PROFILE_STORE, JSON.stringify(profiles));
let fileSkills = [];
const allSkills = () => [...skills, ...fileSkills];
let nodes = [], links = [], selectedId = null, linkStart = null, nodeCounter = 0;
let workflows = [], activeFlowId = null;
const canvas = document.querySelector('#canvas'), stage = document.querySelector('#canvasStage'), svg = document.querySelector('#connections'), template = document.querySelector('#nodeTemplate');
const viewport = { x: 0, y: 0, zoom: 1 };
const palette = document.querySelector('#agentPalette'), skillPalette = document.querySelector('#skillPalette');
const taskGoal = document.querySelector('#taskGoal'), taskContext = document.querySelector('#taskContext'), taskDeliverable = document.querySelector('#taskDeliverable');
const dialog = document.querySelector('#runDialog'), steps = document.querySelector('#runSteps'), result = document.querySelector('#runResult');
const fieldName = document.querySelector('#fieldName'), fieldProfile = document.querySelector('#fieldProfile'), fieldRole = document.querySelector('#fieldRole'), fieldSkill = document.querySelector('#fieldSkill'), fieldPermission = document.querySelector('#fieldPermission'), fieldInput = document.querySelector('#fieldInput'), fieldOutput = document.querySelector('#fieldOutput');
const byId = (items, id) => items.find((item) => item.id === id || item.uid === id);
const uid = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
function loadTopics() { try { const saved = JSON.parse(localStorage.getItem(TOPIC_STORE)); return Array.isArray(saved) ? saved : []; } catch { return []; } }
let researchTopics = loadTopics();
function persistTopics() { localStorage.setItem(TOPIC_STORE, JSON.stringify(researchTopics)); }
function activeWorkflow() { return workflows.find((flow) => flow.id === activeFlowId) || null; }
function activeTopic() { const flow = activeWorkflow(); return researchTopics.find((topic) => topic.id === flow?.topicId) || null; }
function topicFromFlow(flow) {
  if (!flow) return null;
  let topic = researchTopics.find((item) => item.id === flow.topicId);
  if (!topic) {
    topic = { id: flow.topicId || uid('topic'), name: flow.name || flow.title || '未命名研究主题', goal: flow.task?.goal || '', workspace: flow.workspace || '', projectId: flow.projectId || flow.task?.projectId || '', subtopics: flow.subtopics || [], createdAt: flow.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
    flow.topicId = topic.id;
    researchTopics.unshift(topic);
    persistTopics();
  }
  return topic;
}
function syncTopicPreview() {
  const flow = activeWorkflow();
  const topic = topicFromFlow(flow);
  const title = document.querySelector('#flowTitle');
  const preview = document.querySelector('#projectGoalPreview');
  if (title && flow) title.textContent = flow.name || topic?.name || '未命名研究主题';
  if (preview) preview.textContent = topic?.goal || taskGoal?.value?.trim() || '尚未填写 Pipeline 主题。';
}
function normalizeTopicName(value) { return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80); }
function applyTopicToFlow(flow, patch = {}) {
  const topic = topicFromFlow(flow);
  if (!topic) return null;
  if (patch.name) topic.name = normalizeTopicName(patch.name) || topic.name;
  if (typeof patch.goal === 'string') topic.goal = patch.goal.trim();
  if (patch.workspace) topic.workspace = patch.workspace;
  if (Object.prototype.hasOwnProperty.call(patch, 'projectId')) topic.projectId = String(patch.projectId || '');
  topic.subtopics = Array.isArray(topic.subtopics) ? topic.subtopics : [];
  topic.updatedAt = new Date().toISOString();
  flow.topicId = topic.id;
  flow.name = topic.name;
  flow.title = topic.name;
  flow.task = flow.task || {};
  if (topic.goal) flow.task.goal = topic.goal;
  if (topic.workspace) flow.workspace = topic.workspace;
  flow.projectId = topic.projectId || '';
  flow.task.projectId = topic.projectId || '';
  if (flow.id === activeFlowId) {
    if (topic.goal) taskGoal.value = topic.goal;
    if (topic.workspace) document.querySelector('#workspaceRoot').value = topic.workspace;
    document.querySelector('#flowTitle').textContent = topic.name;
    syncTopicPreview();
  }
  persistTopics();
  persistWorkflows();
  return topic;
}
function setActiveTopicProjectId(projectId) {
  const flow = activeWorkflow();
  if (!flow) return null;
  return applyTopicToFlow(flow, { projectId });
}
function saveRegistries() { localStorage.setItem(PROFILE_STORE, JSON.stringify(profiles)); localStorage.setItem(SKILL_STORE, JSON.stringify(skills)); }
function toast(text) { const item = document.createElement('div'); item.className = 'toast'; item.textContent = text; document.body.appendChild(item); setTimeout(() => item.remove(), 2600); }
function profileAvailability(profile) { const agent = window.zhiyanBridge?.agents?.find((item) => item.id === profile.adapterId); return agent?.installed ? '已检测命令' : '未检测'; }
function paletteButton(item, type) { const button = document.createElement('button'); button.className = 'palette-item'; button.innerHTML = `<span class="item-icon">${item.icon || '◫'}</span><span><b>${item.name}</b><small>${type === 'agent' ? `${item.subtitle || item.description || ''} · ${profileAvailability(item)}` : (item.subtitle || '本机 Skill')}</small></span>`; button.onclick = () => addNode(type, item); return button; }
function renderPalettes() { if (palette && skillPalette) { palette.innerHTML = ''; skillPalette.innerHTML = ''; profiles.filter((profile) => profile.id === 'research-theory-agent').forEach((profile) => palette.appendChild(paletteButton(profile, 'agent'))); allSkills().forEach((skill) => skillPalette.appendChild(paletteButton(skill, 'skill'))); } renderRegistryLists(); }
function centerForNew() { const index = nodes.length; return { x: 62 + (index % 3) * 220, y: 56 + Math.floor(index / 3) * 118 }; }
function addNode(type, item, at = centerForNew()) {
  const node = type === 'agent'
    ? { uid: `n${++nodeCounter}`, type, profileId: item.id, ref: item.adapterId, name: item.name, role: item.role, skill: 'claim-audit', permission: 'read', input: '来自上游节点的结构化结果与已授权课题上下文。', output: '带来源、结论强度和不确定性的结构化结果。', x: at.x, y: at.y, icon: item.icon, subtitle: item.subtitle }
    : { uid: `n${++nodeCounter}`, type, profileId: null, ref: item.id, name: item.name, role: item.instruction, skill: item.id, permission: 'propose', input: '来自上游节点的结构化结果。', output: item.output, x: at.x, y: at.y, icon: item.icon, subtitle: item.subtitle };
  if (type === 'agent' && item.defaultSkill) node.skill = item.defaultSkill;
  if (type === 'skill') node.profileId = profiles.find((profile) => profile.adapterId === 'codex')?.id || profiles[0]?.id || null;
  nodes.push(node); renderNode(node); selectNode(node.uid); drawLinks();
}
function applyViewport() { stage.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`; document.querySelector('#zoomOut').disabled = viewport.zoom <= 0.45; document.querySelector('#zoomIn').disabled = viewport.zoom >= 1.8; }
function stagePoint(event) { const rect = canvas.getBoundingClientRect(); return { x: (event.clientX - rect.left - viewport.x) / viewport.zoom, y: (event.clientY - rect.top - viewport.y) / viewport.zoom }; }
function setZoom(nextZoom, clientX = canvas.getBoundingClientRect().left + canvas.clientWidth / 2, clientY = canvas.getBoundingClientRect().top + canvas.clientHeight / 2) { const before = stagePoint({ clientX, clientY }); viewport.zoom = Math.max(0.45, Math.min(1.8, nextZoom)); const rect = canvas.getBoundingClientRect(); viewport.x = clientX - rect.left - before.x * viewport.zoom; viewport.y = clientY - rect.top - before.y * viewport.zoom; applyViewport(); }
function renderNode(node) {
  const element = template.content.firstElementChild.cloneNode(true); element.dataset.uid = node.uid; element.classList.toggle('skill-node', node.type === 'skill'); element.style.left = `${node.x}px`; element.style.top = `${node.y}px`;
  element.querySelector('.node-icon').textContent = node.icon; element.querySelector('strong').textContent = node.name; element.querySelector('small').textContent = node.subtitle;
  element.addEventListener('mousedown', startDrag); element.addEventListener('click', (event) => { if (!event.target.classList.contains('node-port')) selectNode(node.uid); });
  element.querySelector('.output').addEventListener('click', (event) => { event.stopPropagation(); linkStart = node.uid; toast('请选择下游节点的左侧输入端。'); });
  element.querySelector('.input').addEventListener('click', (event) => { event.stopPropagation(); if (linkStart && linkStart !== node.uid) { if (!links.some((link) => link.from === linkStart && link.to === node.uid)) links.push({ from: linkStart, to: node.uid }); linkStart = null; drawLinks(); toast('已创建工作流连接。'); } else toast('请先点击上游节点的右侧输出端。'); });
  stage.appendChild(element); document.querySelector('#canvasHint').classList.add('hidden');
}
function startDrag(event) { if (event.target.classList.contains('node-port')) return; const element = event.currentTarget, node = byId(nodes, element.dataset.uid), start = stagePoint(event), offsetX = start.x - node.x, offsetY = start.y - node.y; event.stopPropagation(); element.style.cursor = 'grabbing'; const move = (moveEvent) => { const point = stagePoint(moveEvent); node.x = point.x - offsetX; node.y = point.y - offsetY; element.style.left = `${node.x}px`; element.style.top = `${node.y}px`; drawLinks(); }; const up = () => { element.style.cursor = 'grab'; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }; document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); }
function drawLinks() { svg.innerHTML = ''; links.forEach((link) => { const source = byId(nodes, link.from), target = byId(nodes, link.to); if (!source || !target) return; const x1 = source.x + 178, y1 = source.y + 33, x2 = target.x, y2 = target.y + 33, bend = Math.max(46, Math.abs(x2 - x1) * 0.5); const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`); svg.appendChild(path); }); }
function refreshNodeText(node) { const element = document.querySelector(`[data-uid="${node.uid}"]`); if (!element) return; element.querySelector('strong').textContent = node.name; element.querySelector('small').textContent = node.subtitle; }
function selectNode(nodeId) { selectedId = nodeId; document.querySelectorAll('.node').forEach((element) => element.classList.toggle('selected', element.dataset.uid === nodeId)); const node = byId(nodes, nodeId); if (!node) return; document.querySelector('#emptyInspector').classList.add('hidden'); document.querySelector('#nodeForm').classList.remove('hidden'); document.querySelector('#nodeKind').textContent = node.type === 'agent' ? 'AGENT PROFILE' : 'SKILL STEP'; document.querySelector('#nodeName').textContent = node.name; fieldName.value = node.name; fieldRole.value = node.role; fieldPermission.value = node.permission; fieldInput.value = node.input; fieldOutput.value = node.output; fieldProfile.innerHTML = profiles.map((profile) => `<option value="${profile.id}">${profile.name} · ${profile.adapterId}</option>`).join(''); fieldProfile.value = node.profileId || profiles[0]?.id || ''; fieldProfile.closest('label').classList.toggle('hidden', node.type !== 'agent'); fieldSkill.innerHTML = allSkills().map((skill) => `<option value="${skill.id}">${skill.name}${skill.readOnly ? ' · 本机文件' : ''}</option>`).join(''); fieldSkill.value = node.skill || allSkills()[0]?.id || ''; }
document.querySelector('#nodeForm').addEventListener('submit', (event) => { event.preventDefault(); const node = byId(nodes, selectedId); if (!node) return; node.name = fieldName.value.trim() || node.name; node.role = fieldRole.value; node.skill = fieldSkill.value; node.permission = fieldPermission.value; node.input = fieldInput.value; node.output = fieldOutput.value; if (node.type === 'agent') { const profile = byId(profiles, fieldProfile.value); node.profileId = profile.id; node.ref = profile.adapterId; node.icon = profile.icon; node.subtitle = profile.subtitle; } refreshNodeText(node); document.querySelector('#nodeName').textContent = node.name; toast('节点配置已保存。'); });
function removeSelectedNode() { if (!selectedId) return; nodes = nodes.filter((node) => node.uid !== selectedId); links = links.filter((link) => link.from !== selectedId && link.to !== selectedId); document.querySelector(`[data-uid="${selectedId}"]`)?.remove(); selectedId = null; document.querySelector('#nodeForm').classList.add('hidden'); document.querySelector('#emptyInspector').classList.remove('hidden'); drawLinks(); toast('已删除画布节点。'); }
document.querySelector('#deleteNode').onclick = removeSelectedNode;
document.querySelector('#deleteNodeButton').onclick = removeSelectedNode;
canvas.addEventListener('mousedown', (event) => { if (event.target.closest('.node') || event.target.closest('button') || event.button !== 0) return; const startX = event.clientX, startY = event.clientY, originX = viewport.x, originY = viewport.y; canvas.classList.add('panning'); const move = (moveEvent) => { viewport.x = originX + moveEvent.clientX - startX; viewport.y = originY + moveEvent.clientY - startY; applyViewport(); }; const up = () => { canvas.classList.remove('panning'); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }; document.addEventListener('mousemove', move); document.addEventListener('mouseup', up); });
canvas.addEventListener('click', (event) => { if (!event.target.closest('.node')) { linkStart = null; document.querySelectorAll('.node').forEach((node) => node.classList.remove('selected')); } });
canvas.addEventListener('wheel', (event) => { event.preventDefault(); setZoom(viewport.zoom + (event.deltaY < 0 ? 0.12 : -0.12), event.clientX, event.clientY); }, { passive: false });
function workflowOrder() { const incoming = new Map(nodes.map((node) => [node.uid, 0])); const children = new Map(nodes.map((node) => [node.uid, []])); links.forEach((link) => { if (incoming.has(link.to) && children.has(link.from)) { incoming.set(link.to, incoming.get(link.to) + 1); children.get(link.from).push(link.to); } }); const queue = nodes.filter((node) => incoming.get(node.uid) === 0); const ordered = []; while (queue.length) { const node = queue.shift(); ordered.push(node); children.get(node.uid).forEach((child) => { incoming.set(child, incoming.get(child) - 1); if (incoming.get(child) === 0) queue.push(byId(nodes, child)); }); } if (ordered.length !== nodes.length) throw new Error('画布存在循环连接；请移除循环后再运行。'); return ordered; }
function workflowPlan() { const ordered = workflowOrder().filter((node) => node.type === 'agent' || node.type === 'skill'); const agents = ordered.filter((node) => node.type === 'agent'); if (agents.length !== 1 || agents[0].profileId !== 'research-theory-agent') throw new Error('科研论单 Agent 模式要求且仅允许一个“科研论主 Agent”节点。'); return ordered; }
function exportModel() { const topic = activeTopic(); return { version: '0.3', title: document.querySelector('#flowTitle').textContent, topicId: topic?.id || null, projectId: topic?.projectId || '', topic: topic ? clone(topic) : null, workspace: document.querySelector('#workspaceRoot')?.value?.trim() || '', nodes, links, task: { goal: taskGoal.value, context: taskContext.value, deliverable: taskDeliverable.value, projectId: topic?.projectId || '' } }; }
function saveFlow() { localStorage.setItem(FLOW_STORE, JSON.stringify(exportModel())); toast('工作流已保存到本机浏览器。'); }
function resetFlow() { nodes = []; links = []; selectedId = null; nodeCounter = 0; stage.querySelectorAll('.node').forEach((node) => node.remove()); document.querySelector('#canvasHint').classList.remove('hidden'); svg.innerHTML = ''; document.querySelector('#nodeForm').classList.add('hidden'); document.querySelector('#emptyInspector').classList.remove('hidden'); }
function workflowName() { return document.querySelector('#flowTitle').textContent.trim() || '未命名工作流'; }
function persistWorkflows() { localStorage.setItem(FLOWS_STORE, JSON.stringify(workflows)); localStorage.setItem(ACTIVE_FLOW_STORE, activeFlowId || ''); }
function renderTopicSwitcher() { const switcher = document.querySelector('#topicSwitcher'); if (!switcher) return; switcher.replaceChildren(...workflows.map((flow) => { const topic = topicFromFlow(flow); const option = document.createElement('option'); option.value = flow.id; option.textContent = topic?.name || flow.name; option.selected = flow.id === activeFlowId; return option; })); switcher.onchange = () => switchWorkflow(switcher.value); }
function renderWorkflowList() { renderTopicSwitcher(); const list = document.querySelector('#workflowList'); if (!list) return; list.innerHTML = workflows.map((flow) => { const topic = topicFromFlow(flow); const subtopicCount = topic?.subtopics?.length || 0; return `<div class="workflow-item${flow.id === activeFlowId ? ' active' : ''}"><button class="workflow-open" data-open-flow="${flow.id}" title="打开 ${flow.name}"><b>${topic?.name || flow.name}</b><small>${flow.nodes?.length || 0} 个节点 · 子方向 ${subtopicCount} · ${new Date(flow.updatedAt || Date.now()).toLocaleDateString('zh-CN')}</small></button><button class="workflow-more" data-rename-flow="${flow.id}" title="编辑主题">⋯</button></div>`; }).join(''); document.querySelectorAll('[data-open-flow]').forEach((button) => button.onclick = () => switchWorkflow(button.dataset.openFlow)); document.querySelectorAll('[data-rename-flow]').forEach((button) => button.onclick = () => renameWorkflow(button.dataset.renameFlow)); syncTopicPreview(); }
function saveWorkflow(showToast = true) { const snapshot = { ...exportModel(), id: activeFlowId || uid('flow'), name: workflowName(), updatedAt: new Date().toISOString() }; const topic = topicFromFlow(snapshot); if (topic) applyTopicToFlow(snapshot, { name: snapshot.name, goal: snapshot.task?.goal, workspace: snapshot.workspace }); activeFlowId = snapshot.id; const index = workflows.findIndex((flow) => flow.id === activeFlowId); if (index >= 0) workflows[index] = snapshot; else workflows.unshift(snapshot); localStorage.setItem(FLOW_STORE, JSON.stringify(snapshot)); persistWorkflows(); renderWorkflowList(); if (showToast) toast(`已保存「${snapshot.name}」`); }
function announceFlowChange() { try { window.dispatchEvent(new CustomEvent('weaver:flow-changed', { detail: { flowId: activeFlowId, name: document.querySelector('#flowTitle')?.textContent?.trim() || '' } })); } catch { /* event dispatch is best-effort */ } }
function restoreFlow(flow) { resetFlow(); activeFlowId = flow.id; const topic = topicFromFlow(flow); document.querySelector('#flowTitle').textContent = topic?.name || flow.name || flow.title || '未命名工作流'; nodes = clone(flow.nodes || []); links = clone(flow.links || []); nodeCounter = Math.max(0, ...nodes.map((node) => Number(node.uid?.slice(1)) || 0)); taskGoal.value = topic?.goal || flow.task?.goal || taskGoal.value; taskContext.value = flow.task?.context || taskContext.value; taskDeliverable.value = flow.task?.deliverable || taskDeliverable.value; if (topic?.workspace || flow.workspace) document.querySelector('#workspaceRoot').value = topic?.workspace || flow.workspace; nodes.forEach(renderNode); drawLinks(); renderWorkflowList(); syncTopicPreview(); announceFlowChange(); }
function switchWorkflow(id) { if (id === activeFlowId) return; saveWorkflow(false); const target = workflows.find((flow) => flow.id === id); if (!target) return; restoreFlow(target); persistWorkflows(); toast(`已打开「${target.name}」`); }
function createWorkflow() { createResearchTopicFlow(); }
function renameWorkflow(id) { const flow = workflows.find((item) => item.id === id); if (!flow) return; editResearchTopic(flow); }
// window.prompt is blocked inside Obsidian's sandboxed iframe (no
// allow-modals on older mounts, and native prompts are poor UX anyway), so
// topic creation/edit goes through a real modal dialog instead.
function ensureTopicDialog() {
  let dialog = document.querySelector('#researchTopicDialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'researchTopicDialog';
  dialog.className = 'registry-dialog pipeline-topic-dialog';
  dialog.innerHTML = `
    <form method="dialog" class="pipeline-topic-form">
      <div class="run-header">
        <div><span class="eyebrow">RESEARCH TOPIC</span><h2 class="rtd-title">新建研究主题</h2></div>
        <button type="button" class="pipeline-topic-close" aria-label="关闭">×</button>
      </div>
      <div class="pipeline-topic-body">
        <label>主题名称<input class="rtd-name" type="text" autofocus placeholder="例如：双波长动力学耦合调控" /></label>
        <label>Pipeline 检索主题 / 大课题问题<textarea class="rtd-goal" rows="5" placeholder="材料/体系 + 关键机制 + 你想判断的问题"></textarea></label>
        <p class="wv-faint rtd-hint"></p>
      </div>
      <footer class="pipeline-topic-actions">
        <button type="button" class="button ghost pipeline-topic-cancel">取消</button>
        <button type="submit" class="button primary">保存主题</button>
      </footer>
    </form>`;
  document.body.appendChild(dialog);
  return dialog;
}
function askResearchTopic(defaults = {}) {
  const dialog = ensureTopicDialog();
  const nameInput = dialog.querySelector('.rtd-name');
  const goalInput = dialog.querySelector('.rtd-goal');
  const hint = dialog.querySelector('.rtd-hint');
  const title = dialog.querySelector('.rtd-title');
  const close = dialog.querySelector('.pipeline-topic-close');
  const cancel = dialog.querySelector('.pipeline-topic-cancel');
  const form = dialog.querySelector('form');
  title.textContent = defaults.title || '新建研究主题';
  nameInput.value = defaults.name || '';
  goalInput.value = defaults.goal || '';
  const workspace = document.querySelector('#workspaceRoot')?.value?.trim() || '';
  hint.textContent = workspace
    ? `保存位置：浏览器本地（键 research-weaver:topics:v1）+ Bridge 在线时在「${workspace}」下创建同名主题文件夹。`
    : '保存位置：浏览器本地（键 research-weaver:topics:v1）。填写并应用课题目录后，才会在本机创建主题文件夹。';
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
    const onCancel = (event) => { event?.preventDefault?.(); finish(null); };
    const onSubmit = (event) => {
      event.preventDefault();
      const cleanName = normalizeTopicName(nameInput.value);
      if (!cleanName) { toast('研究主题名称不能为空。'); nameInput.focus(); return; }
      finish({ name: cleanName, goal: (goalInput.value || cleanName).trim() });
    };
    form.addEventListener('submit', onSubmit);
    close.addEventListener('click', onCancel);
    cancel.addEventListener('click', onCancel);
    dialog.addEventListener('cancel', onCancel);
    dialog.showModal();
    // 2026-08-28 发布冲刺项4 P2（清单缺陷#6，项3实测两次建主题各错焦一次）：
    // 紧跟在 showModal() 后面同步调用 .focus() 有时会输给浏览器自己对刚打开
    // 的 <dialog> 做的内部初始焦点处理（尤其是在本文件顶部注释提到的
    // Obsidian 沙箱 iframe 里，<dialog> 的自动聚焦行为本来就不完全可靠）——
    // 焦点最终落到 DOM 里下一个可聚焦元素（.rtd-goal 描述框）上。加
    // autofocus 属性是声明式的第一层保险；这里再用 requestAnimationFrame
    // 把手动 focus/select 挪到下一帧，等浏览器自己的初始焦点处理跑完之后
    // 再抢回来，双保险。
    requestAnimationFrame(() => { nameInput.focus(); nameInput.select(); });
  });
}
async function createTopicFolder(topicName) {
  if (typeof window.createResearchTopicFolder !== 'function') return null;
  const baseWorkspace = document.querySelector('#workspaceRoot')?.value?.trim() || '';
  try { return await window.createResearchTopicFolder(topicName, baseWorkspace); }
  catch (error) { toast(`主题已保存，但文件夹创建失败：${error.message}`); return null; }
}
async function createResearchTopicFlow() {
  saveWorkflow(false);
  const input = await askResearchTopic({ name: '新建研究主题', goal: taskGoal.value, title: '新建研究主题' });
  if (!input) return;
  resetFlow();
  activeFlowId = uid('flow');
  const topic = { id: uid('topic'), name: input.name, goal: input.goal, workspace: '', subtopics: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  researchTopics.unshift(topic);
  const folder = await createTopicFolder(topic.name);
  if (folder?.root) topic.workspace = folder.root;
  taskGoal.value = topic.goal;
  document.querySelector('#flowTitle').textContent = topic.name;
  if (topic.workspace) document.querySelector('#workspaceRoot').value = topic.workspace;
  const flow = { ...exportModel(), id: activeFlowId, topicId: topic.id, name: topic.name, title: topic.name, workspace: topic.workspace, task: { goal: topic.goal, context: taskContext.value, deliverable: taskDeliverable.value }, updatedAt: new Date().toISOString() };
  workflows.unshift(flow);
  persistTopics();
  persistWorkflows();
  localStorage.setItem(FLOW_STORE, JSON.stringify(flow));
  renderWorkflowList();
  syncTopicPreview();
  announceFlowChange();
  if (topic.workspace) document.querySelector('#saveWorkspace')?.click();
  toast(`已创建研究主题「${topic.name}」${topic.workspace ? `，文件夹：${topic.workspace}` : '。Bridge 离线时未创建文件夹。'}`);
}
async function editResearchTopic(flow = activeWorkflow()) {
  if (!flow) return;
  const topic = topicFromFlow(flow);
  const input = await askResearchTopic({ name: topic?.name || flow.name, goal: topic?.goal || flow.task?.goal || taskGoal.value, title: '修改 Pipeline 主题' });
  if (!input) return;
  applyTopicToFlow(flow, input);
  if (flow.id === activeFlowId) saveWorkflow(false);
  renderWorkflowList();
  toast(`已更新 Pipeline 主题「${input.name}」`);
}
function installTopicControls() {
  const project = document.querySelector('.wv-project');
  const preview = document.querySelector('#projectGoalPreview');
  if (!project || !preview || document.querySelector('#editTopic')) return;
  const row = document.createElement('div');
  row.className = 'wv-topic-actions';
  row.innerHTML = '<select id="topicSwitcher" class="wv-topic-switcher" title="切换研究主题"></select><button id="editTopic" class="wv-btn wv-btn-sm" type="button">修改 Pipeline 主题</button><button id="createTopic" class="wv-btn wv-btn-sm wv-btn-primary" type="button">新建研究主题</button><small>子方向接口：主题目录下 subtopics/，后续由 Agent 对话生成或手动编辑。</small>';
  preview.after(row);
  row.querySelector('#editTopic').onclick = () => editResearchTopic();
  row.querySelector('#createTopic').onclick = () => createResearchTopicFlow();
}
function loadExample() {
  resetFlow(); const profile = (id) => byId(profiles, id); const skill = (id) => byId(allSkills(), id);
  addNode('skill', skill('retrieve'), { x: 65, y: 110 });
  addNode('skill', skill('download-open-access'), { x: 285, y: 110 });
  addNode('skill', skill('evidence'), { x: 505, y: 110 });
  addNode('skill', skill('research-theory'), { x: 725, y: 110 });
  addNode('agent', profile('research-theory-agent'), { x: 945, y: 110 });
  links = [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }, { from: 'n3', to: 'n4' }, { from: 'n4', to: 'n5' }];
  drawLinks();
}
function fillSkillEditor(skill) { document.querySelector('#skillName').value = skill?.name || ''; document.querySelector('#skillInstruction').value = skill?.instruction || ''; document.querySelector('#skillOutput').value = skill?.output || ''; }
function renderRegistryLists() { const adapterText = (profile) => `${profile.adapterId} · ${profileAvailability(profile)}`; document.querySelector('#profileList').innerHTML = profiles.map((profile) => `<div class="registry-item"><b>${profile.name}</b><small>${adapterText(profile)}</small>${profile.locked ? '<em>内置</em>' : `<button data-delete-profile="${profile.id}">删除</button>`}</div>`).join(''); document.querySelector('#skillList').innerHTML = allSkills().map((skill) => `<div class="registry-item"><b>${skill.name}</b><small>${skill.readOnly ? `本机文件：${skill.origin}` : skill.output}</small>${skill.readOnly ? '<em>文件</em>' : `<button data-delete-skill="${skill.id}">删除</button>`}</div>`).join(''); const selector = document.querySelector('#skillEditorSelect'); const current = selector.value; selector.innerHTML = `<option value="">＋ 新建自定义 Skill</option>${allSkills().map((skill) => `<option value="${skill.id}">${skill.name}${skill.readOnly ? ' · 本机文件（只读）' : ''}</option>`).join('')}`; selector.value = allSkills().some((skill) => skill.id === current) ? current : ''; document.querySelectorAll('[data-delete-profile]').forEach((button) => button.onclick = () => { profiles = profiles.filter((profile) => profile.id !== button.dataset.deleteProfile); saveRegistries(); renderPalettes(); }); document.querySelectorAll('[data-delete-skill]').forEach((button) => button.onclick = () => { skills = skills.filter((skill) => skill.id !== button.dataset.deleteSkill); saveRegistries(); renderPalettes(); }); }
function showRegistry(kind) { const dialog = document.querySelector('#registryDialog'); document.querySelector('#registryKind').textContent = kind === 'profile' ? 'PROFILE REGISTRY' : 'SKILL LIBRARY'; document.querySelector('#registryTitle').textContent = kind === 'profile' ? 'Agent Profile 注册表' : 'Skill 库'; document.querySelector('#profileRegistry').classList.toggle('registry-focus', kind === 'profile'); document.querySelector('#skillRegistry').classList.toggle('registry-focus', kind === 'skill'); renderRegistryLists(); dialog.showModal(); }
function refreshAdapterChoices() { const adapters = window.zhiyanBridge?.agents || []; const ids = adapters.length ? adapters.map((agent) => agent.id) : ['codex', 'claude', 'hermes', 'opencode', 'openclaw']; document.querySelector('#profileAdapter').innerHTML = ids.map((id) => `<option value="${id}">${id}${adapters.find((agent) => agent.id === id)?.installed ? ' · 可用' : ' · 未检测'}</option>`).join(''); renderPalettes(); }
document.querySelector('#saveProfile').onclick = () => { const name = document.querySelector('#profileName').value.trim(), adapterId = document.querySelector('#profileAdapter').value, role = document.querySelector('#profileRole').value.trim(), description = document.querySelector('#profileDescription').value.trim(); if (!name || !role) return toast('请填写 Profile 名称与角色。'); profiles.push({ id: uid('profile'), name, adapterId, icon: '◈', subtitle: description || '自定义 Agent Profile', role, description, locked: false }); saveRegistries(); ['#profileName', '#profileRole', '#profileDescription'].forEach((selector) => { document.querySelector(selector).value = ''; }); renderPalettes(); toast('已创建 Agent Profile。'); };
document.querySelector('#skillEditorSelect').onchange = (event) => fillSkillEditor(byId(allSkills(), event.target.value));
document.querySelector('#copySkill').onclick = () => { const selected = byId(allSkills(), document.querySelector('#skillEditorSelect').value); if (!selected) return toast('请先选择一个 Skill。'); document.querySelector('#skillEditorSelect').value = ''; fillSkillEditor({ ...selected, name: `${selected.name}（副本）` }); toast('已复制为可编辑草稿。'); };
document.querySelector('#saveSkill').onclick = () => { const name = document.querySelector('#skillName').value.trim(), instruction = document.querySelector('#skillInstruction').value.trim(), output = document.querySelector('#skillOutput').value.trim(), selected = byId(allSkills(), document.querySelector('#skillEditorSelect').value); if (!name || !instruction || !output) return toast('请填写 Skill 名称、任务协议与输出契约。'); if (selected && !selected.readOnly) { Object.assign(selected, { name, subtitle: output, instruction, output }); toast('Skill 已更新。'); } else { const created = { id: uid('skill'), name, icon: '◫', subtitle: output, instruction, output, locked: false }; skills.push(created); document.querySelector('#skillEditorSelect').value = created.id; toast('已创建可编辑 Skill。'); } saveRegistries(); renderPalettes(); };
document.querySelector('#showProfiles').onclick = () => showRegistry('profile'); document.querySelector('#showSkills').onclick = () => showRegistry('skill'); document.querySelector('#closeRegistry').onclick = () => document.querySelector('#registryDialog').close(); document.querySelector('#closeRun').onclick = () => dialog.close();
document.querySelector('#exportFlow').onclick = () => { const blob = new Blob([JSON.stringify({ ...exportModel(), profiles, skills }, null, 2)], { type: 'application/json' }), anchor = document.createElement('a'); anchor.href = URL.createObjectURL(blob); anchor.download = 'research-weaver-workflow.json'; anchor.click(); URL.revokeObjectURL(anchor.href); };
document.querySelector('#saveFlow').onclick = saveFlow; document.querySelector('#newFlow').onclick = () => { resetFlow(); toast('已创建空白工作流。'); }; document.querySelector('#clearLinks').onclick = () => { links = []; drawLinks(); }; document.querySelector('#fitCanvas').onclick = () => { nodes.forEach((node, index) => { node.x = 55 + (index % 3) * 220; node.y = 55 + Math.floor(index / 3) * 125; const element = document.querySelector(`[data-uid="${node.uid}"]`); if (element) { element.style.left = `${node.x}px`; element.style.top = `${node.y}px`; } }); drawLinks(); }; document.querySelector('#zoomIn').onclick = () => setZoom(viewport.zoom + 0.15); document.querySelector('#zoomOut').onclick = () => setZoom(viewport.zoom - 0.15); document.querySelector('#resetView').onclick = () => { viewport.x = 0; viewport.y = 0; viewport.zoom = 1; applyViewport(); }; document.querySelector('#loadExample').onclick = loadExample;
document.querySelector('#runFlow').onclick = () => { try { const plan = workflowPlan(); dialog.showModal(); document.querySelector('#runTitle').textContent = '工作流预览'; steps.innerHTML = plan.map((node, index) => `<div class="run-step"><i>·</i><div><b>阶段 ${index + 1} · ${node.name}</b><br/><small>${byId(skills, node.skill)?.name || '未绑定 Skill'} · ${node.permission}</small></div></div>`).join(''); result.innerHTML = '<h3>预检完成</h3><p>点击“真实运行整个工作流”后，将按上列顺序调用实际可用的本机 Profile。任何不可用适配器都会阻断执行。</p>'; result.classList.remove('hidden'); } catch (error) { toast(error.message); } };
function importFileSkills(imported) { fileSkills = Array.isArray(imported) ? imported : []; renderPalettes(); }
window.researchWeaver = { get profiles() { return profiles; }, get skills() { return allSkills(); }, get topics() { return researchTopics; }, get activeTopic() { return activeTopic(); }, get activeFlowId() { return activeFlowId; }, profile: (id) => byId(profiles, id), skill: (id) => byId(allSkills(), id), getSelectedNode: () => byId(nodes, selectedId), setActiveTopicProjectId, workflowPlan, refreshAdapterChoices, importFileSkills, toast, dialog, steps, result, taskGoal, taskContext, taskDeliverable };
window.addEventListener('bridge:agents', refreshAdapterChoices);
function prepareLibraryLayout(sectionId, listId, existingTitle) { const section = document.querySelector(sectionId); if (section.dataset.libraryReady) return; const list = document.querySelector(listId); const create = document.createElement('div'); create.className = 'library-create'; [...section.children].filter((child) => child !== list).forEach((child) => create.appendChild(child)); const existing = document.createElement('div'); existing.className = 'library-existing'; const heading = document.createElement('h3'); heading.textContent = existingTitle; existing.append(heading, list); section.append(create, existing); section.dataset.libraryReady = 'true'; section.classList.add('library-layout'); }
function ensureProfileSkillSelector() { let select = document.querySelector('#profileDefaultSkill'); if (select) return select; const adapter = document.querySelector('#profileAdapter'); const label = document.createElement('label'); label.textContent = '默认 Skill'; select = document.createElement('select'); select.id = 'profileDefaultSkill'; label.appendChild(select); adapter.closest('label').after(label); return select; }
function populateProfileSkillSelector() { const select = ensureProfileSkillSelector(); const previous = select.value; select.innerHTML = allSkills().map((skill) => `<option value="${skill.id}">${skill.name}</option>`).join(''); select.value = allSkills().some((skill) => skill.id === previous) ? previous : (allSkills()[0]?.id || ''); }
function escapeForDetail(text) { return String(text || '').replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char])); }
function libraryAsset(list, item, type) {
  const row = document.createElement('div'); row.className = 'registry-item library-asset';
  const copy = document.createElement('div');
  const name = document.createElement('b'); name.textContent = item.name;
  if (item.readOnly) {
    const badge = document.createElement('span');
    badge.className = `skill-badge ${item.executable ? 'executable' : 'doc-only'}`;
    badge.textContent = item.executable ? '可执行' : '仅说明';
    name.append(' ', badge);
  }
  const meta = document.createElement('small');
  // Show the SKILL.md's own description (what the Skill actually does), not a
  // generic placeholder — this is the thing the user asked for specifically.
  meta.textContent = type === 'agent'
    ? `${item.adapterId} · 默认：${byId(allSkills(), item.defaultSkill)?.name || 'Claim 审计'}`
    : (item.readOnly ? (item.subtitle || '本机 SKILL.md，未填写 description。') : item.output);
  copy.append(name, meta);
  if (item.readOnly) {
    const toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'library-detail-toggle'; toggle.textContent = '查看完整说明 ▾';
    const detail = document.createElement('div'); detail.className = 'library-asset-detail hidden';
    const runnerLine = item.executable
      ? `<p><b>调用工具：</b>本机脚本 <code>skills/…/scripts/${escapeForDetail(item.runnerScript)}</code>，由 Bridge 在你的课题工作区内只读/受限写入运行。</p>`
      : '<p><b>调用工具：</b>无绑定的本机脚本；这份 SKILL.md 是给 Agent 看的操作指引，需要 Agent 按文字自行完成任务。</p>';
    detail.innerHTML = `${runnerLine}<pre class="library-asset-instruction">${escapeForDetail(item.instruction) || '（SKILL.md 未提供正文）'}</pre><p class="library-asset-origin">文件位置：${escapeForDetail(item.origin || '未知')}</p>`;
    toggle.onclick = () => { const nowHidden = detail.classList.toggle('hidden'); toggle.textContent = nowHidden ? '查看完整说明 ▾' : '收起说明 ▴'; };
    copy.append(toggle, detail);
  }
  const actions = document.createElement('div'); actions.className = 'library-actions';
  const add = document.createElement('button'); add.className = 'add-to-canvas'; add.textContent = '加入画布';
  add.onclick = () => { addNode(type, item); document.querySelector('#registryDialog').close(); };
  actions.appendChild(add);
  if (!item.locked && !item.readOnly) {
    const remove = document.createElement('button'); remove.className = 'library-delete'; remove.textContent = '删除';
    remove.onclick = () => { if (type === 'agent') profiles = profiles.filter((profile) => profile.id !== item.id); else skills = skills.filter((skill) => skill.id !== item.id); saveRegistries(); renderLibraryEntries(type); };
    actions.appendChild(remove);
  }
  row.append(copy, actions);
  list.appendChild(row);
}
function renderLibraryEntries(kind) { populateProfileSkillSelector(); const list = document.querySelector(kind === 'agent' ? '#profileList' : '#skillList'); list.innerHTML = ''; (kind === 'agent' ? profiles : allSkills()).forEach((item) => libraryAsset(list, item, kind)); }
function openLibrary(kind) { prepareLibraryLayout('#profileRegistry', '#profileList', '已有 Agent Profile'); prepareLibraryLayout('#skillRegistry', '#skillList', '已保存 Skill'); const dialog = document.querySelector('#registryDialog'); const profileView = kind === 'agent'; document.querySelector('#registryKind').textContent = profileView ? 'AGENT PROFILES' : 'SKILL LIBRARY'; document.querySelector('#registryTitle').textContent = profileView ? 'Agent Profile' : 'Skill 库'; document.querySelector('#profileRegistry').classList.toggle('hidden', !profileView); document.querySelector('#skillRegistry').classList.toggle('hidden', profileView); document.querySelector('.registry-grid').classList.add('single-library'); renderLibraryEntries(kind); dialog.showModal(); }
function installLibraryNavigation() { document.querySelector('#showProfiles').onclick = () => openLibrary('agent'); document.querySelector('#showSkills').onclick = () => openLibrary('skill'); document.querySelector('#showBoard').onclick = () => document.querySelector('#registryDialog').close(); document.querySelector('#saveProfile').onclick = () => { const name = document.querySelector('#profileName').value.trim(), adapterId = document.querySelector('#profileAdapter').value, role = document.querySelector('#profileRole').value.trim(), description = document.querySelector('#profileDescription').value.trim(), defaultSkill = ensureProfileSkillSelector().value; if (!name || !role) return toast('请填写 Profile 名称与角色。'); profiles.push({ id: uid('profile'), name, adapterId, defaultSkill, icon: '◫', subtitle: description || '自定义 Agent Profile', role, description, locked: false }); saveRegistries(); ['#profileName', '#profileRole', '#profileDescription'].forEach((selector) => { document.querySelector(selector).value = ''; }); renderLibraryEntries('agent'); toast('已创建 Profile，并绑定默认 Skill。'); }; }
installLibraryNavigation();
const saveSkillFromLibrary = document.querySelector('#saveSkill').onclick;
document.querySelector('#saveSkill').onclick = () => { saveSkillFromLibrary(); renderLibraryEntries('skill'); };
function initializeWorkflowLibrary() {
  installTopicControls();
  try { workflows = JSON.parse(localStorage.getItem(FLOWS_STORE)) || []; } catch { workflows = []; }
  const legacy = (() => { try { return JSON.parse(localStorage.getItem(FLOW_STORE)); } catch { return null; } })();
  if (!Array.isArray(workflows) || !workflows.length) {
    const first = legacy?.nodes?.length ? legacy : exportModel();
    activeFlowId = uid('flow');
    workflows = [{ ...first, id: activeFlowId, name: first.title || workflowName(), updatedAt: new Date().toISOString() }];
  } else {
    activeFlowId = localStorage.getItem(ACTIVE_FLOW_STORE) || workflows[0].id;
    const selected = workflows.find((flow) => flow.id === activeFlowId) || workflows[0];
    restoreFlow(selected);
  }
  document.querySelector('#saveFlow').onclick = () => saveWorkflow(true);
  document.querySelector('#newFlow').onclick = createWorkflow;
  window.addEventListener('beforeunload', () => saveWorkflow(false));
  persistWorkflows(); renderWorkflowList();
}
queueMicrotask(initializeWorkflowLibrary);
renderPalettes(); refreshAdapterChoices(); applyViewport();
try { const saved = JSON.parse(localStorage.getItem(FLOW_STORE)); if (saved?.nodes?.length) { nodes = saved.nodes; links = saved.links || []; nodeCounter = Math.max(0, ...nodes.map((node) => Number(node.uid?.slice(1)) || 0)); taskGoal.value = saved.task?.goal || taskGoal.value; taskContext.value = saved.task?.context || taskContext.value; taskDeliverable.value = saved.task?.deliverable || taskDeliverable.value; nodes.forEach(renderNode); drawLinks(); } else loadExample(); } catch { loadExample(); }
// Execute every connected Skill as an actual stage, then hand its output to downstream Agents.
setTimeout(() => { if (window.researchWeaver) { window.researchWeaver.workflowPlan = () => { const ordered = workflowOrder(); if (!ordered.some((node) => node.type === 'agent')) throw new Error('工作流需要至少一个最终 Agent Profile。'); return ordered.filter((node) => node.type === 'agent' || node.type === 'skill'); }; document.querySelector('#runFlow').onclick = () => { try { const plan = window.researchWeaver.workflowPlan(); dialog.showModal(); document.querySelector('#runTitle').textContent = '工作流预览'; steps.innerHTML = plan.map((node, index) => `<div class="run-step"><i>·</i><div><b>${node.type === 'skill' ? 'Skill' : 'Agent'} 阶段 ${index + 1} · ${node.name}</b><br/><small>${byId(allSkills(), node.skill)?.name || '未绑定 Skill'} · ${node.type === 'skill' ? '由执行 Profile 运行' : node.permission}</small></div></div>`).join(''); result.innerHTML = '<h3>预检完成</h3><p>Skill 阶段会先实际运行并把结果传入下游 Agent；所有阶段维持只读，笔记写入仍需确认。</p>'; result.classList.remove('hidden'); } catch (error) { toast(error.message); } }; } }, 0);

// One-time, non-destructive migration from the former multi-agent canvas.
// The old graph is retained in localStorage so users can inspect/export it,
// but the active project is immediately made runnable in single-agent mode.
setTimeout(() => {
  const isSingleTheoryFlow = () => nodes.filter((node) => node.type === 'agent').length === 1 && nodes.some((node) => node.type === 'agent' && node.profileId === 'research-theory-agent');
  if (!isSingleTheoryFlow()) {
    try { localStorage.setItem('research-weaver:legacy-multi-agent-backup:v1', JSON.stringify(exportModel())); } catch {}
    loadExample();
    document.querySelector('#flowTitle').textContent = '科研论单 Agent · 证据闭环';
    saveWorkflow(false);
    toast('已安全迁移旧多 Agent 画布；原流程已备份，当前模板可直接运行。');
  }
  window.researchWeaver.workflowPlan = () => {
    const ordered = workflowOrder().filter((node) => node.type === 'agent' || node.type === 'skill');
    const agents = ordered.filter((node) => node.type === 'agent');
    if (agents.length !== 1 || agents[0].profileId !== 'research-theory-agent') throw new Error('科研论单 Agent 模式要求且仅允许一个“科研论主 Agent”节点。');
    if (!ordered.some((node) => node.type === 'skill' && node.skill === 'download-open-access')) throw new Error('科研论工作流必须包含“开放全文下载”节点；未下载并验证全文时不得生成研究方案。');
    return ordered;
  };
}, 20);
