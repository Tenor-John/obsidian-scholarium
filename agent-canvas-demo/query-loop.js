/* query-loop.js — 检索式「构建 → 质疑 → 修订」循环的入口 UI（M3）。
 *
 * 一个 Agent 负责构建检索式，另一个（没装第二个 CLI 时同一个 Agent 第二
 * 角色）负责按命中结果质疑打分。循环控制是 query-loop-core.js 里的确定性
 * 代码：score ≥ 75 通过，最多 3 轮，轮数用尽取历史最佳。检索走
 * /v1/literature/search（多源并行），评分基于真实命中而非想象。
 *
 * 依赖 bridge-ui.js 全局：bridgeFetch, zhiyanBridge, connectBridge,
 * waitTask, safeHtml, workspaceRoot。
 * window.weaverQueryLoop._runAgent / _search 可注入替身（端到端测试用）。
 */
(() => {
  const $ = (selector) => document.querySelector(selector);
  const entryBtn = $('#queryLoopBtn');
  if (!entryBtn) return;

  const Core = () => window.weaverQueryLoopCore;

  function ensureDialog() {
    let dialog = $('#queryLoopDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.id = 'queryLoopDialog';
    dialog.className = 'registry-dialog pipeline-topic-dialog idea-mode-dialog';
    dialog.innerHTML = `
      <form method="dialog" class="pipeline-topic-form" onsubmit="return false">
        <div class="run-header">
          <div><span class="eyebrow">QUERY LOOP</span><h2>检索式打磨：构建 → 质疑 → 修订</h2></div>
          <button type="button" class="pipeline-topic-close" aria-label="关闭">×</button>
        </div>
        <div class="pipeline-topic-body">
          <label>研究主题<textarea id="queryLoopTopic" rows="3" placeholder="例如：双波长光热耦合调控等离子体半导体的 CO2 还原动力学"></textarea></label>
          <p class="wv-faint" id="queryLoopAgents">构建者 / 质疑者：连接 Bridge 后自动分配。</p>
          <p class="wv-faint">由简到繁：首轮只保留必要概念块，后续根据真实命中一次只改一个组件。评分公开为相关性 40 + 召回 25 + 跨库可执行性 15 + 代码计算的简洁度 20；达到 75 分即停止，最多 3 轮。DOI/已知标题只做覆盖检查，不混入主题检索式。</p>
          <div class="idea-mode-status wv-faint" id="queryLoopStatus"></div>
          <div class="idea-mode-results" id="queryLoopResults" hidden></div>
        </div>
        <footer class="pipeline-topic-actions">
          <button type="button" class="button ghost ql-cancel">取消</button>
          <button type="button" class="button ghost" id="queryLoopAbortBtn" hidden>中止循环</button>
          <button type="button" class="button primary" id="queryLoopRunBtn">开始打磨</button>
          <button type="button" class="button primary" id="queryLoopApplyBtn" hidden>用作 Pipeline 检索主题</button>
        </footer>
      </form>`;
    document.body.appendChild(dialog);
    return dialog;
  }

  let busy = false;
  let aborted = false;
  let best = null; // { query, rationale, score, cycle }

  const status = (html) => { const el = $('#queryLoopStatus'); if (el) el.innerHTML = html; };
  const toast = (text) => window.researchWeaver?.toast?.(text);

  function setButtons(phase) {
    $('#queryLoopRunBtn').hidden = phase !== 'input';
    $('#queryLoopApplyBtn').hidden = phase !== 'done';
    $('#queryLoopAbortBtn').hidden = phase !== 'running';
    $('#queryLoopRunBtn').disabled = busy;
    $('#queryLoopApplyBtn').disabled = busy;
  }

  function pickAgents() {
    const installed = (zhiyanBridge.agents || []).filter((a) => a.installed);
    const find = (id) => installed.find((a) => a.id === id);
    const builder = find('codex') || installed[0] || null;
    const critic = find('claude') && builder?.id !== 'claude' ? find('claude') : builder;
    return { builder, critic, shared: builder && critic && builder.id === critic.id };
  }

  async function runAgent(agentId, prompt) {
    const created = await bridgeFetch('/v1/tasks', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentId, cwd: workspaceRoot, prompt, permission: 'read', execute: true }),
    });
    if (!created?.id) throw new Error('Bridge 未返回任务 ID。');
    return waitTask(created.id);
  }

  async function realSearch(query) {
    const response = await bridgeFetch('/v1/literature/search', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace: workspaceRoot, query }),
    });
    return { records: response.manifest?.records || [], sources: response.sources || [] };
  }

  /* --------------------------------------------------------- cycle log -- */

  function cycleCard(entry) {
    const badge = entry.score == null ? '' :
      `<span class="ql-score ${entry.score >= Core().SCORE_THRESHOLD ? 'pass' : 'revise'}">${entry.score} 分</span>`;
    const problems = (entry.problems || []).length
      ? `<ul class="ql-problems">${entry.problems.map((p) => `<li>${safeHtml(p)}</li>`).join('')}</ul>` : '';
    const b = entry.breakdown;
    const breakdown = b
      ? `<small class="ql-breakdown">评分：相关性 ${b.relevance}/40 · 召回 ${b.recall}/25 · 可执行性 ${b.executability}/15 · 简洁度 ${b.simplicity}/20</small>`
      : '';
    const penalties = (entry.complexity?.penalties || []).length
      ? `<small class="wv-faint">复杂度扣分：${entry.complexity.penalties.map((item) => `${safeHtml(item.reason)} -${item.points}`).join('；')}</small>`
      : '';
    return `<section class="ql-cycle">
      <header><b>第 ${entry.cycle} 轮</b>${badge}</header>
      <p class="ql-query wv-mono">${safeHtml(entry.query)}</p>
      ${entry.rationale ? `<small>${safeHtml(entry.rationale)}</small>` : ''}
      ${breakdown}${penalties}
      <small class="wv-faint">${safeHtml(entry.searchNote || '')}</small>
      ${problems}
    </section>`;
  }

  function renderLog(history) {
    const box = $('#queryLoopResults');
    box.innerHTML = history.map(cycleCard).join('') + (best && history.at(-1)?.final ? `
      <div class="idea-summary"><b>最终检索式（第 ${best.cycle} 轮，${best.score} 分）</b>
      <p class="wv-mono">${safeHtml(best.query)}</p></div>` : '');
    box.hidden = false;
    box.scrollTop = box.scrollHeight;
  }

  /* ------------------------------------------------------------ the loop -- */

  async function runLoop() {
    const topic = ($('#queryLoopTopic')?.value || '').trim();
    if (!topic) { status('<span class="error">请先写明研究主题。</span>'); return; }
    if (!zhiyanBridge.online) { await connectBridge(true); if (!zhiyanBridge.online) { status('<span class="error">Bridge 未连接。</span>'); return; } }
    const { builder, critic, shared } = pickAgents();
    if (!builder) { status('<span class="error">没有可用的已安装 Agent CLI。</span>'); return; }

    const core = Core();
    const runAgentFn = window.weaverQueryLoop._runAgent || runAgent;
    const searchFn = window.weaverQueryLoop._search || realSearch;

    busy = true; aborted = false; best = null;
    setButtons('running');
    const history = [];
    let feedback = null;
    try {
      for (let cycle = 1; cycle <= core.MAX_CYCLES; cycle++) {
        if (aborted) throw new Error('已手动中止。');
        status(`第 ${cycle}/${core.MAX_CYCLES} 轮：构建者（${builder.id}）正在写检索式…`);
        const built = core.parseBuilderReply(await runAgentFn(builder.id, core.buildBuilderPrompt({ topic, feedback, cycle })));
        if (!built.ok) throw new Error(`构建者输出不合格：${built.error}`);

        status(`第 ${cycle}/${core.MAX_CYCLES} 轮：多源并行检索中…`);
        const search = await searchFn(built.query);
        const sourceNote = search.sources?.length
          ? `命中 ${search.records.length} 条（` + search.sources.map((s) => s.ok ? `${s.source} ${s.count}` : `${s.source} 失败`).join(' · ') + '）'
          : `命中 ${search.records.length} 条`;

        if (aborted) throw new Error('已手动中止。');
        status(`第 ${cycle}/${core.MAX_CYCLES} 轮：质疑者（${critic.id}${shared ? ' · 同 CLI 双角色' : ''}）正在评分…`);
        const judged = core.parseCriticReply(
          await runAgentFn(critic.id, core.buildCriticPrompt({ topic, query: built.query, records: search.records, cycle })),
          { query: built.query, cycle },
        );
        if (!judged.ok) throw new Error(`质疑者输出不合格：${judged.error}`);

        const entry = { cycle, query: built.query, rationale: built.rationale, score: judged.score, breakdown: judged.breakdown, complexity: judged.complexity, problems: judged.problems, searchNote: sourceNote };
        history.push(entry);
        if (!best || judged.score > best.score) best = { ...entry };
        renderLog(history);

        const next = core.decideNext({ cycle, score: judged.score });
        if (next === 'accept' || next === 'exhausted') {
          history.at(-1).final = true;
          renderLog(history);
          status(next === 'accept'
            ? `<b>达标。</b>第 ${cycle} 轮获得 ${judged.score} 分（≥${core.SCORE_THRESHOLD}），循环收敛。`
            : `<b>轮数用尽。</b>${core.MAX_CYCLES} 轮未达 ${core.SCORE_THRESHOLD} 分，已取历史最佳（第 ${best.cycle} 轮，${best.score} 分）。你可以采纳，也可以带上质疑意见再跑一轮。`);
          busy = false; // 先解锁再切按钮态，否则「用作 Pipeline 检索主题」被 busy 禁掉
          setButtons('done');
          return;
        }
        feedback = { problems: judged.problems, suggestion: judged.suggestion, query: built.query, breakdown: judged.breakdown };
      }
    } catch (error) {
      status(`<span class="error">${safeHtml(error.message)}</span>`);
      busy = false;
      if (best) { renderLog(history); setButtons('done'); }
      else setButtons('input');
    } finally {
      busy = false;
    }
  }

  /* ------------------------------------------------------- headless auto -- */
  // Runs the exact same builder→search→critic cycle as runLoop() above, but
  // with zero DOM: no dialog, no buttons, no manual "开始打磨"/"应用" click.
  // This is what makes the loop "在pipeline中运行时，agent自行操作" instead
  // of a separate window the researcher has to drive by hand — both
  // "检索开放文献" and "运行文献 Pipeline" call this directly and render its
  // onProgress() callbacks into their own existing step tracker.
  // Returns { query, score, cycle, rationale, history } — the best-scoring
  // cycle's result — or throws (no Bridge / no installed Agent CLI / a
  // builder or critic reply that doesn't parse).
  async function runAutoLoop(topic, opts = {}) {
    const { onProgress = () => {} } = opts;
    if (!zhiyanBridge.online) { await connectBridge(true); if (!zhiyanBridge.online) throw new Error('本机 Bridge 未连接。'); }
    const { builder, critic, shared } = pickAgents();
    if (!builder) throw new Error('没有可用的已安装 Agent CLI。');
    const core = Core();
    const runAgentFn = window.weaverQueryLoop._runAgent || runAgent;
    const searchFn = window.weaverQueryLoop._search || realSearch;
    const history = [];
    let best = null;
    let feedback = null;
    for (let cycle = 1; cycle <= core.MAX_CYCLES; cycle++) {
      onProgress({ phase: 'build', cycle, maxCycles: core.MAX_CYCLES, agent: builder.id });
      const built = core.parseBuilderReply(await runAgentFn(builder.id, core.buildBuilderPrompt({ topic, feedback, cycle })));
      if (!built.ok) throw new Error(`构建者输出不合格：${built.error}`);
      onProgress({ phase: 'search', cycle, maxCycles: core.MAX_CYCLES, query: built.query });
      const search = await searchFn(built.query);
      onProgress({ phase: 'critic', cycle, maxCycles: core.MAX_CYCLES, agent: critic.id, shared, hits: search.records.length });
      const judged = core.parseCriticReply(
        await runAgentFn(critic.id, core.buildCriticPrompt({ topic, query: built.query, records: search.records, cycle })),
        { query: built.query, cycle },
      );
      if (!judged.ok) throw new Error(`质疑者输出不合格：${judged.error}`);
      const entry = { cycle, query: built.query, rationale: built.rationale, score: judged.score, breakdown: judged.breakdown, complexity: judged.complexity, problems: judged.problems, hits: search.records.length };
      history.push(entry);
      if (!best || judged.score > best.score) best = { ...entry };
      onProgress({ phase: 'scored', cycle, maxCycles: core.MAX_CYCLES, score: judged.score, threshold: core.SCORE_THRESHOLD, breakdown: judged.breakdown, complexity: judged.complexity });
      const next = core.decideNext({ cycle, score: judged.score });
      if (next === 'accept' || next === 'exhausted') {
        onProgress({ phase: next, cycle, maxCycles: core.MAX_CYCLES, best });
        return { ...best, history };
      }
      feedback = { problems: judged.problems, suggestion: judged.suggestion, query: built.query, breakdown: judged.breakdown };
    }
    return { ...best, history }; // unreachable given the loop bound above, kept as a defensive fallback
  }

  let applyCallback = null; // set by openDialog() when opened from another flow (see window.weaverQueryLoop.open)

  function applyQuery() {
    if (!best) return;
    if (applyCallback) {
      // Inline caller (e.g. the "检索开放文献"/"运行文献 Pipeline" topic dialogs)
      // wants the refined query fed back into its own flow, not into #taskGoal —
      // that's what made the loop feel like "a separate window" instead of part
      // of those two entry points.
      applyCallback({ query: best.query, score: best.score, cycle: best.cycle });
      toast(`已应用打磨后的检索式（${best.score} 分）。`);
    } else {
      const goal = $('#taskGoal');
      if (goal) {
        goal.value = best.query;
        goal.dispatchEvent(new Event('input', { bubbles: true }));
      }
      toast(`已将最终检索式（${best.score} 分）写入 Pipeline 检索主题。`);
    }
    $('#queryLoopDialog')?.close();
  }

  /* -------------------------------------------------------------- wiring -- */

  // Shared opener behind both the standalone "打磨检索式" button and the
  // window.weaverQueryLoop.open() API other flows call to embed this loop
  // inline instead of sending the researcher to a separate button/window.
  // forceSeed=true always overwrites the topic field with the caller's
  // current topic (the standalone button instead only fills it when empty,
  // so reopening it doesn't clobber text you were mid-edit on).
  function openDialog(seedTopic, onApply, opts = {}) {
    const { forceSeed = false, applyLabel = '用作 Pipeline 检索主题' } = opts;
    const dialog = ensureDialog();
    const topicField = $('#queryLoopTopic');
    if (seedTopic && (forceSeed || !topicField.value.trim())) topicField.value = seedTopic;
    const { builder, critic, shared } = pickAgents();
    $('#queryLoopAgents').textContent = builder
      ? `构建者：${builder.id} · 质疑者：${critic.id}${shared ? '（同一 CLI 分饰两角；安装第二个 CLI 后自动变为真·双 Agent）' : ''}`
      : '未检测到已安装的 Agent CLI。';
    $('#queryLoopResults').hidden = true;
    status('');
    best = null;
    applyCallback = onApply || null;
    $('#queryLoopApplyBtn').textContent = applyLabel;
    setButtons('input');
    dialog.showModal();
    dialog.querySelector('.pipeline-topic-close').onclick = () => dialog.close();
    dialog.querySelector('.ql-cancel').onclick = () => dialog.close();
    $('#queryLoopRunBtn').onclick = runLoop;
    $('#queryLoopAbortBtn').onclick = () => { aborted = true; };
    $('#queryLoopApplyBtn').onclick = applyQuery;
  }

  entryBtn.addEventListener('click', () => {
    const goalText = ($('#taskGoal')?.value || '').trim();
    openDialog(goalText, null);
  });

  // Public API for other flows to embed this loop instead of requiring a
  // separate "打磨检索式" button click: window.weaverQueryLoop.open(topic,
  // (result) => { ... }, { applyLabel? }) — result is { query, score, cycle }.
  window.weaverQueryLoop = {
    _runAgent: null,
    _search: null,
    open: (seedTopic, onApply, opts = {}) => openDialog(seedTopic, onApply, { forceSeed: true, applyLabel: '应用为本次检索式', ...opts }),
    // Headless entry point for "检索开放文献"/"运行文献 Pipeline": runs the
    // same builder/critic loop with no dialog; onProgress(opts) reports each
    // phase transition so the caller can render it into its own UI.
    runAuto: runAutoLoop,
  };
})();
