/* orchestrator.js — Agent selector + parallel Skill execution + DAG skeleton
 * Research Weaver multi-agent orchestration module.
 *
 * Public API on window.weaverOrchestrator:
 *   getSelectedAgent() / setSelectedAgent(id) / onAgentChange(fn)
 *   parallel(tasks) / isParallel() / toggleParallel()
 *   validateDAG(nodes) / hasCycle(nodes) / executeDAG(nodes, executor)
 *   registerRole / getRole / listRoles
 *
 * Loaded BEFORE app.js / bridge-ui.js / shell-ui.js so they can reference
 * window.weaverOrchestrator during their own initialisation.
 */
(() => {
  const ORCHESTRATOR_AGENT_KEY = 'weaver.orchestrator.agent';
  const ORCHESTRATOR_PARALLEL_KEY = 'weaver.orchestrator.parallel';

  let selectedAgent = '';
  try { selectedAgent = sessionStorage.getItem(ORCHESTRATOR_AGENT_KEY) || ''; } catch {}
  const changeCallbacks = [];

  function getSelectedAgent() { return selectedAgent; }

  function setSelectedAgent(agentId) {
    selectedAgent = agentId;
    try { sessionStorage.setItem(ORCHESTRATOR_AGENT_KEY, agentId); } catch {}
    window.dispatchEvent(new CustomEvent('weaver:agent-changed', { detail: { agent: agentId } }));
    for (const fn of changeCallbacks) { try { fn(agentId); } catch {} }
  }

  function onAgentChange(fn) {
    if (typeof fn === 'function') changeCallbacks.push(fn);
  }

  /* ------------------------------------------------ agent selector UI -- */

  function renderAgentSelector() {
    const container = document.querySelector('#agentSelector');
    if (!container) return;

    const agents = (window.zhiyanBridge && window.zhiyanBridge.agents) || [];
    const installed = agents.filter((a) => a.installed);

    if (!selectedAgent && installed.length) {
      selectedAgent = installed[0].id;
      try { sessionStorage.setItem(ORCHESTRATOR_AGENT_KEY, selectedAgent); } catch {}
    }

    const current = installed.find((a) => a.id === selectedAgent) || installed[0] || { id: 'none', name: 'No Agent' };
    const isActive = installed.some((a) => a.id === selectedAgent);

    container.innerHTML =
      '<button class="wv-agent-btn" id="agentSelectorBtn" title="\u5F53\u524D\u6267\u884C Agent\uFF08\u70B9\u51FB\u5207\u6362\uFF09">' +
        '<span class="wv-agent-dot' + (isActive ? ' active' : '') + '"></span>' +
        '<span class="wv-agent-label">' + (current.name || current.id) + '</span>' +
        '<svg class="ic" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>' +
      '</button>' +
      '<div class="wv-agent-menu" id="agentSelectorMenu" hidden>' +
        '<div class="wv-agent-menu-title">\u9009\u62E9\u6267\u884C Agent</div>' +
        installed.map((agent) =>
          '<button class="wv-agent-option' + (agent.id === selectedAgent ? ' is-active' : '') + '" data-agent="' + agent.id + '">' +
            '<span class="wv-agent-opt-dot"></span>' +
            '<span>' + (agent.name || agent.id) + '</span>' +
            (agent.executionEnabled ? '<span class="wv-agent-opt-badge">\u53EF\u6267\u884C</span>' : '') +
          '</button>'
        ).join('') +
        (!installed.length ? '<div class="wv-agent-empty">\u672A\u68C0\u6D4B\u5230\u5DF2\u5B89\u88C5\u7684 CLI\u3002\u8BF7\u5148\u8FDE\u63A5 Bridge\u3002</div>' : '') +
      '</div>';

    const btn = document.querySelector('#agentSelectorBtn');
    const menu = document.querySelector('#agentSelectorMenu');
    if (btn && menu) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
      });
      menu.querySelectorAll('.wv-agent-option').forEach((opt) => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          setSelectedAgent(opt.dataset.agent);
          menu.hidden = true;
          renderAgentSelector();
        });
      });
    }
  }

  /* Close menu on outside click / Escape */
  document.addEventListener('click', () => {
    const menu = document.querySelector('#agentSelectorMenu');
    if (menu) menu.hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const menu = document.querySelector('#agentSelectorMenu');
      if (menu) menu.hidden = true;
    }
  });

  /* ------------------------------------------------ parallel toggle -- */

  let parallelEnabled = false;
  try { parallelEnabled = sessionStorage.getItem(ORCHESTRATOR_PARALLEL_KEY) === 'true'; } catch {}

  function isParallel() { return parallelEnabled; }

  function toggleParallel() {
    parallelEnabled = !parallelEnabled;
    try { sessionStorage.setItem(ORCHESTRATOR_PARALLEL_KEY, String(parallelEnabled)); } catch {}
    window.dispatchEvent(new CustomEvent('weaver:parallel-changed', { detail: { parallel: parallelEnabled } }));
    updateParallelToggle();
  }

  function updateParallelToggle() {
    const btn = document.querySelector('#parallelToggle');
    if (!btn) return;
    const dot = btn.querySelector('.wv-parallel-dot');
    const label = btn.querySelector('.wv-parallel-label');
    if (dot) dot.classList.toggle('active', parallelEnabled);
    if (label) label.textContent = parallelEnabled ? '\u5E76\u884C\u5DF2\u5F00\u542F' : '\u5E76\u884C\u6267\u884C';
    btn.classList.toggle('is-active', parallelEnabled);
    btn.title = parallelEnabled
      ? '\u5DF2\u5F00\u542F\u5E76\u884C\u6267\u884C\uFF1APipeline \u4E2D\u65E0\u4F9D\u8D56\u7684\u6B65\u9AA4\u5C06\u540C\u65F6\u8FD0\u884C\u3002\u70B9\u51FB\u5173\u95ED\u3002'
      : '\u5F53\u524D\u4E32\u884C\u6267\u884C\u3002\u70B9\u51FB\u5F00\u542F\u5E76\u884C\u6A21\u5F0F\uFF0C\u65E0\u4F9D\u8D56\u7684 Pipeline \u6B65\u9AA4\u5C06\u540C\u65F6\u8FD0\u884C\u3002';
  }

  /* ---------------------------------------------------- init UI -- */

  function initAgentSelector() {
    const container = document.querySelector('#agentSelector');
    if (container && !container.querySelector('#agentSelectorBtn')) {
      renderAgentSelector();
    }
    /* Re-render when Bridge comes online */
    window.addEventListener('bridge:agents', renderAgentSelector);

    /* Parallel toggle button */
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'parallelToggle';
    toggleBtn.className = 'wv-btn wv-parallel-toggle';
    toggleBtn.innerHTML =
      '<span class="wv-parallel-dot"></span>' +
      '<span class="wv-parallel-label">\u5E76\u884C\u6267\u884C</span>';
    const pipelineBtn = document.querySelector('#runPipeline');
    if (pipelineBtn && pipelineBtn.parentNode) {
      pipelineBtn.parentNode.insertBefore(toggleBtn, pipelineBtn);
    }
    toggleBtn.addEventListener('click', toggleParallel);
    updateParallelToggle();
  }

  /* ------------------------------------------- parallel execution -- */

  async function parallel(tasks) {
    const startTime = Date.now();
    const results = await Promise.allSettled(tasks.map((t) => t()));
    return results.map((r, i) => ({
      index: i,
      status: r.status === 'fulfilled' ? 'done' : 'error',
      result: r.status === 'fulfilled' ? r.value : undefined,
      error: r.status === 'rejected' ? (r.reason && r.reason.message) || String(r.reason) : undefined,
      elapsed: Date.now() - startTime
    }));
  }

  /* ------------------------------------------- DAG helpers (future) -- */

  function topologicalSort(nodes) {
    const ids = new Set(nodes.map((n) => n.id));
    const adj = new Map();
    const inDeg = new Map();
    for (const n of nodes) { adj.set(n.id, []); inDeg.set(n.id, 0); }
    for (const n of nodes) {
      for (const dep of (n.dependsOn || [])) {
        if (!ids.has(dep)) continue;
        adj.get(dep).push(n.id);
        inDeg.set(n.id, (inDeg.get(n.id) || 0) + 1);
      }
    }
    const queue = [];
    for (const [id, deg] of inDeg) { if (deg === 0) queue.push(id); }
    const order = [];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      for (const next of adj.get(id)) {
        const newDeg = inDeg.get(next) - 1;
        inDeg.set(next, newDeg);
        if (newDeg === 0) queue.push(next);
      }
    }
    if (order.length !== nodes.length) throw new Error('DAG \u4E2D\u5B58\u5728\u5FAA\u73AF\u4F9D\u8D56\uFF0C\u65E0\u6CD5\u6267\u884C\u3002');
    return order;
  }

  function validateDAG(nodes) {
    try { topologicalSort(nodes); return true; } catch { return false; }
  }

  function hasCycle(nodes) { return !validateDAG(nodes); }

  /* executeDAG — skeleton for future multi-agent DAG execution.
   * Runs independent nodes in parallel waves, respecting dependsOn edges.
   * Actual node execution is delegated to an executor(node, upstreamResults)
   * function that the caller provides. */
  async function executeDAG(nodes, executor) {
    const order = topologicalSort(nodes);
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const results = new Map();
    const waves = [];
    const done = new Set();
    const remaining = new Set(order);

    while (remaining.size) {
      const wave = [];
      for (const id of remaining) {
        const node = nodeMap.get(id);
        const deps = (node.dependsOn || []).filter((d) => remaining.has(d) || done.has(d));
        if (deps.every((d) => done.has(d))) wave.push(id);
      }
      if (!wave.length) throw new Error('DAG \u6267\u884C\u5361\u6B7B\uFF1A\u65E0\u53EF\u6267\u884C\u8282\u70B9\u4F46\u4EFB\u52A1\u672A\u5B8C\u6210\u3002');
      waves.push(wave);

      const waveResults = await parallel(
        wave.map((id) => () => {
          const node = nodeMap.get(id);
          const upstream = (node.dependsOn || []).map((d) => results.get(d)).filter(Boolean);
          return executor(node, upstream);
        })
      );
      for (let i = 0; i < wave.length; i++) {
        const id = wave[i];
        results.set(id, waveResults[i]);
        done.add(id);
        remaining.delete(id);
      }
    }
    return { waves, results: Object.fromEntries(results), order };
  }

  /* ----------------------------------------- agent role registry -- */

  const agentRoles = new Map();

  function registerRole(id, role) { agentRoles.set(id, { id, ...role }); }
  function getRole(id) { return agentRoles.get(id) || null; }
  function listRoles() { return [...agentRoles.values()]; }

  registerRole('literature-searcher', {
    name: '\u6587\u732E\u68C0\u7D22\u5458',
    description: '\u8D1F\u8D23\u6784\u5EFA\u68C0\u7D22\u5F0F\u3001\u8C03\u7528 OpenAlex\u3001\u53BB\u91CD\u4E0E\u5BFC\u51FA',
    defaultPrompt: '\u4F60\u662F\u6587\u732E\u68C0\u7D22\u4E13\u5458\u3002\u6839\u636E\u7814\u7A76\u95EE\u9898\u6784\u5EFA\u82F1\u6587 Boolean \u68C0\u7D22\u5F0F\uFF0C\u8C03\u7528 OpenAlex API\uFF0C\u53BB\u91CD\u5E76\u5BFC\u51FA\u7ED3\u679C\u3002'
  });
  registerRole('evidence-analyst', {
    name: '\u8BC1\u636E\u5206\u6790\u5458',
    description: '\u8D1F\u8D23\u9605\u8BFB PDF\u3001\u63D0\u53D6\u8BC1\u636E\u5361\u7247\u3001\u751F\u6210\u7EFC\u8FF0',
    defaultPrompt: '\u4F60\u662F\u8BC1\u636E\u5206\u6790\u4E13\u5458\u3002\u9605\u8BFB\u5DF2\u4E0B\u8F7D\u7684\u8BBA\u6587\uFF0C\u63D0\u53D6\u5173\u952E\u8BC1\u636E\u3001\u65B9\u6CD5\u3001\u7ED3\u8BBA\u548C\u7F3A\u53E3\u3002'
  });
  registerRole('critic', {
    name: '\u5BA1\u7A3F\u4EBA / \u8D28\u7591\u8005',
    description: '\u5BA1\u67E5\u8BC1\u636E\u5F3A\u5EA6\u3001\u66FF\u4EE3\u89E3\u91CA\u3001\u903B\u8F91\u7F3A\u53E3',
    defaultPrompt: '\u4F60\u662F\u4E25\u683C\u7684\u5BA1\u7A3F\u4EBA\u3002\u5BA1\u67E5\u8BC1\u636E\u662F\u5426\u5145\u5206\u652F\u6301\u7ED3\u8BBA\uFF0C\u6709\u65E0\u66FF\u4EE3\u89E3\u91CA\u3001\u903B\u8F91\u7F3A\u53E3\u6216\u672A\u63A7\u53D8\u91CF\u3002'
  });
  registerRole('writer', {
    name: '\u5199\u4F5C\u5458',
    description: '\u8D1F\u8D23\u64B0\u5199\u7EFC\u8FF0\u3001\u521D\u7A3F\u3001\u6DA6\u8272',
    defaultPrompt: '\u4F60\u662F\u79D1\u7814\u5199\u4F5C\u4E13\u5458\u3002\u57FA\u4E8E\u5DF2\u786E\u7ACB\u7684\u8BC1\u636E\u64B0\u5199\u6E05\u6670\u3001\u4E13\u4E1A\u3001\u6709\u4FE1\u606F\u91CF\u7684\u79D1\u7814\u6587\u7AE0\u3002'
  });

  /* ---------------------------------------------- public API -- */

  window.weaverOrchestrator = {
    getSelectedAgent,
    setSelectedAgent,
    onAgentChange,
    renderAgentSelector,
    initAgentSelector,
    parallel,
    isParallel,
    toggleParallel,
    updateParallelToggle,
    validateDAG,
    hasCycle,
    executeDAG,
    topologicalSort,
    registerRole,
    getRole,
    listRoles
  };

  /* Auto-init when DOM is ready (scripts are at end of body so it should be). */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAgentSelector);
  } else {
    initAgentSelector();
  }
})();
