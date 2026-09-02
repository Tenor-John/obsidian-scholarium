/* Idea 树 · 聚类力导向网络 —— 右栏第三个 tab，消费 M1 读通道。
 *
 * 布局语义（对照设计师原型 weaver-idea-tree-clustered.html 的 clusterForce）：
 *   - 每条假设是一个语义簇的锚点，簇中心沿环形排列；
 *   - 只测一条假设的实验被较强地拉向该簇中心，形成紧密小团体；
 *   - 跨簇实验（tests_hypotheses ≥ 2）的拉力很弱，目标位置是各簇中心的
 *     均值，自然浮在中间——等价于原型里 nCross >= 3 的枢纽行为；
 *   - 课题本身是 hub 节点，固定在画布中心，所有假设连向它；
 *   - 未关联实验和 open 问题各自成簇。
 *   - 每个簇有半透明凸包 + 簇名标签；点击节点高亮邻居、dim 其余、
 *     相关簇凸包同步高亮，详情卡（含假设级结算预演按钮）在下方浮层。
 *
 * 零依赖：力导向模拟、凸包（monotone chain）、缩放/平移、节点拖拽均为
 * 原生实现，方便在 Obsidian iframe 沙箱里离线运行。
 */
(() => {
  const $ = (selector) => document.querySelector(selector);

  const graphEl = $('#ideaTreeGraph');
  const svgEl = $('#ideaTreeSvg');
  const overlayEl = $('#ideaTreeOverlay');
  const statsEl = $('#ideaTreeStats');
  const detailEl = $('#ideaTreeDetail');
  const searchEl = $('#ideaTreeSearch');
  const filtersEl = $('#ideaTreeFilters');
  const projectSelect = $('#ideaTreeProject');
  const refreshBtn = $('#ideaTreeRefresh');
  if (!graphEl || !svgEl) return;

  const SVGNS = 'http://www.w3.org/2000/svg';
  const esc = (value) =>
    String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let loaded = false;
  let loading = false;
  let detail = null;          // project.get result for the selected project
  let activeFilter = 'all';
  let searchText = '';

  /* -------------------------------------------------------- data load -- */

  function stateFetch(action, input) {
    const query = new URLSearchParams({ action });
    if (input) query.set('input', JSON.stringify(input));
    return bridgeFetch(`/v1/scholarium/state?${query.toString()}`);
  }

  function showOverlay(text, isError = false) {
    overlayEl.textContent = text;
    overlayEl.classList.toggle('error', isError);
    overlayEl.hidden = false;
    statsEl.hidden = true;
  }

  function hideOverlay() {
    overlayEl.hidden = true;
    statsEl.hidden = false;
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
      projectSelect.innerHTML = projects.length
        ? projects.map((p) => `<option value="${esc(p.display_id)}">${esc(p.display_id)} · ${esc(p.title || '未命名课题')}</option>`).join('')
        : '<option value="">（注册表为空）</option>';
      if (!projects.length) { showOverlay('课题注册表为空：Research/Projects/ 下还没有 schema-v1 课题对象。'); return; }
      await loadProject(projectSelect.value);
    } catch (error) {
      showOverlay(`Idea 树读取失败：${error.message}`, true);
    }
  }

  async function loadProject(displayId) {
    if (!displayId) return;
    showOverlay('正在展开课题结构…');
    try {
      detail = (await stateFetch('project.get', { display_id: displayId })).result || null;
      buildGraph();
    } catch (error) {
      showOverlay(`课题读取失败：${error.message}`, true);
    }
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    try { await loadProjects(); }
    finally { loading = false; }
  }

  /* --------------------------------------------------- verdict helpers -- */

  // 结算判定优先级：有反驳 > 有限定 > 有支持 > 待结算 > 未评审——冲突必须最先被看到。
  function verdict(h) {
    const s = h.settlement || {};
    if (s.contradicts > 0) return 'contradicted';
    if (s.qualifies > 0) return 'qualified';
    if (s.supports > 0) return 'supported';
    if (s.pending > 0) return 'pending';
    return 'unrated';
  }

  const VERDICT_LABEL = {
    contradicted: '有反驳', qualified: '有限定', supported: '有支持',
    pending: '待结算', unrated: '未评审'
  };
  const VERDICT_COLOR = {
    contradicted: 'var(--wv-red)', qualified: 'var(--wv-amber)', supported: 'var(--wv-green)',
    pending: 'var(--wv-faint)', unrated: 'var(--wv-faint)'
  };

  // 与 scan_outcomes 的「待结算」口径对齐：已出结论但还没 integrated。
  function awaitingExpsFor(hypId) {
    return (detail?.experiments || []).filter((e) =>
      (e.tests_hypotheses || []).some((t) => t.display_id === hypId) &&
      e.has_conclusion && e.status !== 'integrated');
  }

  /* --------------------------------------------------- graph building -- */

  const sim = {
    nodes: [], links: [], clusters: [], centers: {},
    alpha: 0, raf: 0, selectedId: null, visible: new Set(),
    transform: { x: 0, y: 0, k: 1 },
    W: 320, H: 480,
  };
  const el = { hulls: new Map(), hullLabels: new Map(), links: [], nodes: new Map(), labels: new Map() };
  let gRoot = null, gHulls = null, gLinks = null, gNodes = null, gLabels = null;

  function nodeMatches(n) {
    if (n.kind === 'project') return true;
    if (searchText && !n.search.includes(searchText)) return false;
    if (n.kind === 'hypothesis' && activeFilter !== 'all') {
      if (activeFilter === 'pending') return n.awaiting > 0;
      return n.verdict === activeFilter;
    }
    return true;
  }

  function computeVisible() {
    sim.visible = new Set(sim.nodes.filter(nodeMatches).map((n) => n.id));
    // 过滤假设后，只属于被隐藏簇的实验也跟着隐藏，避免悬空点。
    for (const n of sim.nodes) {
      if (n.kind !== 'experiment' || !sim.visible.has(n.id)) continue;
      if (activeFilter === 'all') continue;
      const hyps = n.hypIds || [];
      if (hyps.length && !hyps.some((h) => sim.visible.has(h))) sim.visible.delete(n.id);
    }
  }

  function buildGraph() {
    stopSim();
    if (!detail) { showOverlay('没有可显示的数据。'); return; }
    const p = detail.project || {};
    const hypotheses = detail.hypotheses || [];
    const experiments = detail.experiments || [];
    const questions = detail.questions || [];
    const c = detail.counts || {};

    const rect = graphEl.getBoundingClientRect();
    sim.W = Math.max(260, rect.width || 320);
    sim.H = Math.max(320, rect.height || 480);
    const cx = sim.W / 2, cy = sim.H / 2;

    // 簇清单：每条假设一簇，加上未关联实验与问题两个兜底簇。
    const orphans = experiments.filter((e) => !(e.tests_hypotheses || []).length);
    const clusters = hypotheses.map((h) => ({ key: h.display_id, label: h.display_id, color: VERDICT_COLOR[verdict(h)] }));
    if (orphans.length) clusters.push({ key: '__orphans', label: '未关联实验', color: 'var(--wv-faint)' });
    if (questions.length) clusters.push({ key: '__questions', label: '问题', color: 'var(--wv-accent-soft)' });
    sim.clusters = clusters;

    // 簇中心沿椭圆排列（顶部起，顺时针）：右栏是窄高区域，横向半径受宽度
    // 约束，纵向半径单独放大，让簇在整栏里摊开而不是挤成一团。
    const RX = sim.W * 0.38;
    const RY = Math.min(sim.H * 0.34, 260);
    sim.centers = {};
    clusters.forEach((cl, i) => {
      const angle = (i / clusters.length) * 2 * Math.PI - Math.PI / 2;
      sim.centers[cl.key] = { x: cx + RX * Math.cos(angle), y: cy + RY * Math.sin(angle) };
    });

    const nodes = [];
    const links = [];
    const hypBydId = new Map(hypotheses.map((h) => [h.display_id, h]));

    nodes.push({
      id: p.display_id || 'PRJ', kind: 'project', label: p.display_id || '课题',
      r: 11, color: 'var(--wv-text)', cluster: '__hub', hypIds: [],
      search: `${p.display_id} ${p.title || ''}`.toLowerCase(),
    });

    for (const h of hypotheses) {
      const v = verdict(h);
      nodes.push({
        id: h.display_id, kind: 'hypothesis', label: h.display_id, verdict: v,
        awaiting: awaitingExpsFor(h.display_id).length,
        r: 9, color: VERDICT_COLOR[v], cluster: h.display_id, hypIds: [],
        search: `${h.display_id} ${h.statement}`.toLowerCase(),
      });
      links.push({ source: h.display_id, target: p.display_id || 'PRJ', rel: '隶属于' });
    }

    for (const e of experiments) {
      const hypIds = (e.tests_hypotheses || []).map((t) => t.display_id).filter((id) => hypBydId.has(id));
      const cross = hypIds.length >= 2;
      nodes.push({
        id: e.display_id, kind: 'experiment', label: e.display_id,
        r: cross ? 7 : 5,
        color: e.has_conclusion ? 'var(--wv-accent)' : 'var(--wv-faint)',
        cluster: hypIds.length === 1 ? hypIds[0] : '__orphans',
        hypIds, cross,
        search: `${e.display_id} ${e.title} ${e.conclusion_excerpt || ''}`.toLowerCase(),
      });
      for (const hid of hypIds) links.push({ source: e.display_id, target: hid, rel: '测试' });
    }

    for (const q of questions) {
      nodes.push({
        id: q.display_id, kind: 'question', label: q.display_id,
        r: 5, color: 'var(--wv-accent-soft)', cluster: '__questions', hypIds: [],
        search: `${q.display_id} ${q.statement}`.toLowerCase(),
      });
    }

    // 目标位置：hub 居中；跨簇取各簇中心均值（弱拉力 → 浮在中间）；
    // 单簇节点取簇中心（强拉力 → 紧密小团体）。
    for (const n of nodes) {
      if (n.kind === 'project') { n.tx = cx; n.ty = cy; n.pull = 0.15; }
      else if (n.cross) {
        n.tx = n.hypIds.reduce((s, h) => s + (sim.centers[h]?.x || cx), 0) / n.hypIds.length;
        n.ty = n.hypIds.reduce((s, h) => s + (sim.centers[h]?.y || cy), 0) / n.hypIds.length;
        n.pull = 0.04;
      } else {
        const center = sim.centers[n.cluster] || { x: cx, y: cy };
        n.tx = center.x; n.ty = center.y;
        n.pull = n.kind === 'hypothesis' ? 0.3 : 0.18;
      }
      n.x = n.tx + (Math.random() - 0.5) * 40;
      n.y = n.ty + (Math.random() - 0.5) * 40;
      n.vx = 0; n.vy = 0;
    }

    sim.nodes = nodes;
    sim.links = links;
    computeVisible();
    drawGraph();
    hideOverlay();
    statsEl.textContent = `${nodes.length} 节点 · ${links.length} 关系 · ${clusters.length} 簇 · 假设 ${c.hypotheses || 0} / 实验 ${c.experiments || 0} / 证据 ${c.evidence || 0}`;
    reheat(1);
  }

  /* ----------------------------------------------------------- render --- */

  function makeSvg(tag, attrs) {
    const node = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    return node;
  }

  function drawGraph() {
    while (svgEl.firstChild) svgEl.firstChild.remove();
    el.hulls.clear(); el.hullLabels.clear(); el.nodes.clear(); el.labels.clear(); el.links = [];

    gRoot = makeSvg('g');
    svgEl.appendChild(gRoot);
    gHulls = makeSvg('g', { class: 'wv-g-hulls' });
    gLinks = makeSvg('g', { class: 'wv-g-links' });
    gNodes = makeSvg('g', { class: 'wv-g-nodes' });
    gLabels = makeSvg('g', { class: 'wv-g-labels' });
    gRoot.append(gHulls, gLinks, gNodes, gLabels);

    for (const cl of sim.clusters) {
      const hull = makeSvg('path', { class: 'wv-g-hull', fill: cl.color, stroke: cl.color });
      const label = makeSvg('text', { class: 'wv-g-hull-label', fill: cl.color, 'text-anchor': 'middle' });
      label.textContent = cl.label;
      gHulls.append(hull, label);
      el.hulls.set(cl.key, hull);
      el.hullLabels.set(cl.key, label);
    }

    for (const link of sim.links) {
      const line = makeSvg('line', { class: 'wv-g-link' });
      gLinks.appendChild(line);
      el.links.push({ line, link });
    }

    for (const n of sim.nodes) {
      const circle = makeSvg('circle', {
        class: `wv-g-node wv-g-${n.kind}`, r: n.r, fill: n.color,
        'data-id': n.id,
      });
      if (n.kind === 'project') { circle.setAttribute('stroke', 'var(--wv-accent)'); circle.setAttribute('stroke-width', '1.5'); }
      circle.addEventListener('click', (ev) => { ev.stopPropagation(); selectNode(n.id); });
      circle.addEventListener('pointerdown', (ev) => startDrag(ev, n));
      gNodes.appendChild(circle);
      el.nodes.set(n.id, circle);

      const label = makeSvg('text', { class: 'wv-g-node-label', dy: n.r + 10, 'text-anchor': 'middle' });
      label.textContent = n.label;
      gLabels.appendChild(label);
      el.labels.set(n.id, label);
    }

    applyTransform();
    applyVisibility();
  }

  function applyTransform() {
    const t = sim.transform;
    gRoot?.setAttribute('transform', `translate(${t.x} ${t.y}) scale(${t.k})`);
  }

  /* ------------------------------------------------------- simulation --- */

  function reheat(alpha) {
    sim.alpha = Math.max(sim.alpha, alpha);
    if (!sim.raf) sim.raf = requestAnimationFrame(tick);
  }

  function stopSim() {
    if (sim.raf) cancelAnimationFrame(sim.raf);
    sim.raf = 0;
    sim.alpha = 0;
  }

  function tick() {
    sim.raf = 0;
    sim.alpha *= 0.985;
    const a = sim.alpha;
    const nodes = sim.nodes;

    // 簇拉力（clusterForce）
    for (const n of nodes) {
      if (n.fx != null) { n.x = n.fx; n.y = n.fy; n.vx = 0; n.vy = 0; continue; }
      n.vx += (n.tx - n.x) * n.pull * a;
      n.vy += (n.ty - n.y) * n.pull * a;
    }

    // 连线弹簧（目标距离 55）
    for (const { link } of el.links) {
      const s = typeof link.source === 'object' ? link.source : (link.source = sim.nodes.find((n) => n.id === link.source));
      const t = typeof link.target === 'object' ? link.target : (link.target = sim.nodes.find((n) => n.id === link.target));
      if (!s || !t) continue;
      const dx = t.x - s.x, dy = t.y - s.y;
      const dist = Math.hypot(dx, dy) || 1;
      const f = ((dist - 55) / dist) * 0.25 * a;
      s.vx += dx * f * 0.5; s.vy += dy * f * 0.5;
      t.vx -= dx * f * 0.5; t.vy -= dy * f * 0.5;
    }

    // 多体斥力 + 碰撞（O(n²)，节点数十级足够）
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const A = nodes[i], B = nodes[j];
        let dx = B.x - A.x, dy = B.y - A.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        if (d2 > 40000) continue;
        const dist = Math.sqrt(d2);
        const rep = (120 / d2) * a;
        const fx = (dx / dist) * rep, fy = (dy / dist) * rep;
        A.vx -= fx; A.vy -= fy; B.vx += fx; B.vy += fy;
        const minDist = A.r + B.r + 10;
        if (dist < minDist) {
          const push = ((minDist - dist) / dist) * 0.5;
          A.vx -= dx * push; A.vy -= dy * push;
          B.vx += dx * push; B.vy += dy * push;
        }
      }
    }

    for (const n of nodes) {
      if (n.fx != null) continue;
      n.vx *= 0.6; n.vy *= 0.6;
      n.x += n.vx; n.y += n.vy;
    }

    paint();
    if (sim.alpha > 0.015) sim.raf = requestAnimationFrame(tick);
  }

  function paint() {
    for (const { line, link } of el.links) {
      const s = link.source, t = link.target;
      if (typeof s !== 'object' || typeof t !== 'object') continue;
      line.setAttribute('x1', s.x); line.setAttribute('y1', s.y);
      line.setAttribute('x2', t.x); line.setAttribute('y2', t.y);
    }
    for (const n of sim.nodes) {
      const circle = el.nodes.get(n.id);
      const label = el.labels.get(n.id);
      if (circle) { circle.setAttribute('cx', n.x); circle.setAttribute('cy', n.y); }
      if (label) { label.setAttribute('x', n.x); label.setAttribute('y', n.y); }
    }
    paintHulls();
  }

  // Monotone chain 凸包；节点先向 8 个方向外扩 26px 再取包，得到有衬垫的簇区域。
  function hullPoints(pts) {
    if (!pts.length) return null;
    const expanded = [];
    for (const p of pts) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
        expanded.push([p.x + 26 * Math.cos(a), p.y + 26 * Math.sin(a)]);
      }
    }
    expanded.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const p of expanded) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = expanded.length - 1; i >= 0; i--) {
      const p = expanded[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  function paintHulls() {
    for (const cl of sim.clusters) {
      const hull = el.hulls.get(cl.key);
      const label = el.hullLabels.get(cl.key);
      const pts = sim.nodes.filter((n) => n.cluster === cl.key && n.kind !== 'project' && sim.visible.has(n.id));
      // 单节点簇画成外扩 26px 的八边形光晕，两节点成「胶囊」，≥3 为真凸包。
      const poly = pts.length >= 1 ? hullPoints(pts) : null;
      if (!poly) {
        hull?.setAttribute('d', '');
        label?.setAttribute('opacity', '0');
        continue;
      }
      hull.setAttribute('d', 'M' + poly.map((p) => p.join(',')).join('L') + 'Z');
      const mx = pts.reduce((s, n) => s + n.x, 0) / pts.length;
      const minY = Math.min(...pts.map((n) => n.y));
      label.setAttribute('x', mx);
      label.setAttribute('y', minY - 32);
      label.setAttribute('opacity', '0.55');
    }
  }

  /* --------------------------------------------------------- visibility -- */

  function applyVisibility() {
    computeVisible();
    for (const n of sim.nodes) {
      const on = sim.visible.has(n.id);
      el.nodes.get(n.id)?.classList.toggle('is-hidden', !on);
      el.labels.get(n.id)?.classList.toggle('is-hidden', !on);
    }
    for (const { line, link } of el.links) {
      const s = typeof link.source === 'object' ? link.source : null;
      const t = typeof link.target === 'object' ? link.target : null;
      const on = s && t && sim.visible.has(s.id) && sim.visible.has(t.id);
      line.classList.toggle('is-hidden', !on);
    }
    paintHulls();
  }

  /* --------------------------------------------------------- interaction -- */

  function neighborIds(id) {
    const out = new Set([id]);
    for (const { link } of el.links) {
      const s = typeof link.source === 'object' ? link.source.id : link.source;
      const t = typeof link.target === 'object' ? link.target.id : link.target;
      if (s === id) out.add(t);
      if (t === id) out.add(s);
    }
    return out;
  }

  function highlight(id) {
    const nb = neighborIds(id);
    graphEl.classList.add('is-dimmed');
    const node = sim.nodes.find((n) => n.id === id);
    const touchedClusters = new Set();
    if (node) {
      if (node.cluster && !node.cluster.startsWith('__')) touchedClusters.add(node.cluster);
      (node.hypIds || []).forEach((h) => touchedClusters.add(h));
    }
    for (const n of sim.nodes) {
      el.nodes.get(n.id)?.classList.toggle('is-hl', nb.has(n.id));
      el.labels.get(n.id)?.classList.toggle('is-hl', nb.has(n.id));
    }
    for (const { line, link } of el.links) {
      const s = typeof link.source === 'object' ? link.source.id : link.source;
      const t = typeof link.target === 'object' ? link.target.id : link.target;
      line.classList.toggle('is-hl', s === id || t === id);
    }
    for (const [key, hull] of el.hulls) hull.classList.toggle('is-hl', touchedClusters.has(key));
    for (const [key, label] of el.hullLabels) label.classList.toggle('is-hl', touchedClusters.has(key));
  }

  function clearHighlight() {
    graphEl.classList.remove('is-dimmed');
    svgEl.querySelectorAll('.is-hl').forEach((n) => n.classList.remove('is-hl'));
  }

  function selectNode(id) {
    sim.selectedId = id;
    highlight(id);
    const node = sim.nodes.find((n) => n.id === id);
    showDetail(node?.kind, id);
  }

  function deselect() {
    sim.selectedId = null;
    clearHighlight();
    if (detailEl) detailEl.hidden = true;
  }

  svgEl.addEventListener('click', deselect);

  // 缩放 / 平移
  svgEl.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const rect = svgEl.getBoundingClientRect();
    const mx = ev.clientX - rect.left, my = ev.clientY - rect.top;
    const t = sim.transform;
    const k2 = Math.min(4, Math.max(0.3, t.k * Math.exp(-ev.deltaY * 0.001)));
    t.x = mx - ((mx - t.x) / t.k) * k2;
    t.y = my - ((my - t.y) / t.k) * k2;
    t.k = k2;
    applyTransform();
  }, { passive: false });

  let panStart = null;
  svgEl.addEventListener('pointerdown', (ev) => {
    if (ev.target !== svgEl) return;
    panStart = { x: ev.clientX, y: ev.clientY, tx: sim.transform.x, ty: sim.transform.y };
    svgEl.setPointerCapture(ev.pointerId);
  });
  svgEl.addEventListener('pointermove', (ev) => {
    if (!panStart) return;
    sim.transform.x = panStart.tx + (ev.clientX - panStart.x);
    sim.transform.y = panStart.ty + (ev.clientY - panStart.y);
    applyTransform();
  });
  svgEl.addEventListener('pointerup', () => { panStart = null; });
  svgEl.addEventListener('pointercancel', () => { panStart = null; });

  // 节点拖拽
  function startDrag(ev, node) {
    ev.stopPropagation();
    ev.preventDefault();
    const rect = svgEl.getBoundingClientRect();
    const toGraph = (ev2) => ({
      x: (ev2.clientX - rect.left - sim.transform.x) / sim.transform.k,
      y: (ev2.clientY - rect.top - sim.transform.y) / sim.transform.k,
    });
    const move = (ev2) => {
      const p = toGraph(ev2);
      node.fx = p.x; node.fy = p.y;
      reheat(0.3);
    };
    const up = () => {
      node.fx = null; node.fy = null;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  // 栏宽拖拽 / 窗口变化时重排：簇中心按新尺寸重算并轻热重启。
  let resizeTimer = null;
  new ResizeObserver(() => {
    if (!sim.nodes.length) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const oldW = sim.W, oldH = sim.H;
      buildGraph();
      if (Math.abs(sim.W - oldW) < 2 && Math.abs(sim.H - oldH) < 2) return;
    }, 180);
  }).observe(graphEl);

  /* --------------------------------------------------------- detail ---- */

  function showDetail(kind, id) {
    if (!detail || !detailEl) return;
    let html = '';
    if (kind === 'project') {
      const p = detail.project || {};
      html = `<h4>${esc(p.display_id)} · ${esc(p.title || '')}</h4>
        <p>${esc(p.goal || p.description || '（课题对象没有 goal/description 字段）')}</p>
        <p class="wv-faint">${esc(detail.path || '')}</p>`;
    } else if (kind === 'hypothesis') {
      const h = (detail.hypotheses || []).find((x) => x.display_id === id);
      if (!h) return;
      const s = h.settlement || {};
      const awaitingCount = awaitingExpsFor(id).length;
      html = `<h4>${esc(h.display_id)} <span class="wv-tree-state">${esc(VERDICT_LABEL[verdict(h)])}</span></h4>
        <p>${esc(h.statement)}</p>
        <p class="wv-faint">状态 ${esc(h.status || '—')} · 置信度 ${h.confidence ?? '—'} · 支持 ${s.supports || 0} / 反驳 ${s.contradicts || 0} / 限定 ${s.qualifies || 0} / 待审 ${s.pending || 0} / 驳回 ${s.rejected || 0}</p>
        <p class="wv-faint">${esc(h.path || '')}</p>
        <div class="wv-rehearsal-actions">
          <button class="wv-btn wv-btn-sm" id="ideaTreeRehearse" type="button"
            title="只读预演：捞出声明测试该假设且尚未结算的实验，让 Agent 给出结算建议草稿；不写任何正式对象">对该假设运行结算预演${awaitingCount ? `（待结算 ${awaitingCount}）` : ''}</button>
        </div>`;
    } else if (kind === 'experiment') {
      const e = (detail.experiments || []).find((x) => x.display_id === id);
      if (!e) return;
      html = `<h4>${esc(e.display_id)} <span class="wv-tree-state">${esc(e.status || '')}</span></h4>
        <p><b>${esc(e.title || '(无标题实验)')}</b></p>
        ${e.conclusion_excerpt ? `<p>${esc(e.conclusion_excerpt)}</p>` : '<p class="wv-faint">还没有结论。</p>'}
        <p class="wv-faint">测试假设：${(e.tests_hypotheses || []).map((t) => esc(t.display_id)).join('、') || '未声明'} · 产出证据 ${e.produced_evidence_count || 0} 条</p>
        <p class="wv-faint">${esc(e.path || '')}</p>`;
    } else if (kind === 'question') {
      const q = (detail.questions || []).find((x) => x.display_id === id);
      if (!q) return;
      html = `<h4>${esc(q.display_id)} <span class="wv-tree-state">${esc(q.status || '')}</span></h4>
        <p>${esc(q.statement)}</p>
        <p class="wv-faint">${esc(q.path || '')}</p>`;
    }
    if (!html) return;
    detailEl.innerHTML = `<div class="wv-tree-detail-head"><span class="wv-sect-label">节点详情</span><button class="wv-linkbtn" id="ideaTreeDetailClose">收起</button></div>${html}`;
    detailEl.hidden = false;
    detailEl.querySelector('#ideaTreeDetailClose').addEventListener('click', () => { detailEl.hidden = true; });
    detailEl.querySelector('#ideaTreeRehearse')?.addEventListener('click', () => {
      window.researchWeaver?.toast?.(`正在为 ${id} 运行结算预演——进展与建议卡片显示在左栏「课题注册表」下方。`);
      window.weaverRehearsal?.run({ hypothesisId: id, projectId: detail.project?.display_id });
    });
  }

  /* ----------------------------------------------------------- wiring -- */

  searchEl?.addEventListener('input', () => {
    searchText = searchEl.value.trim().toLowerCase();
    if (detail) applyVisibility();
  });

  filtersEl?.querySelectorAll('.wv-filter-pill').forEach((pill) => {
    pill.addEventListener('click', () => {
      filtersEl.querySelectorAll('.wv-filter-pill').forEach((p) => p.classList.remove('is-active'));
      pill.classList.add('is-active');
      activeFilter = pill.dataset.filter || 'all';
      if (detail) applyVisibility();
    });
  });

  projectSelect?.addEventListener('change', () => loadProject(projectSelect.value));
  refreshBtn?.addEventListener('click', refresh);

  // shell-ui.js calls this when the tab is first opened.
  window.weaverIdeaTree = {
    ensureLoaded() {
      if (loaded) return;
      loaded = true;
      refresh();
    },
    refresh
  };
})();
