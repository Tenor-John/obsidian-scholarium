"use strict";

// A deterministic, sidecar-first implementation of PaperGraph. It produces a
// rebuildable navigation view, not a second research database. LLMs may later
// propose labels, but this runner deliberately makes only source-located
// MENTIONS edges so no unreviewed assertion becomes a scientific conclusion.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ENTITY_PATTERNS = [
  ["Material", /\b(?:au\s*(?:np|nanoparticle)?|gold nanoparticles?|bivo[₄4]|bismuth vanadate|bi2o2co3|zno|tio2|g-c3n4|mos2)\b/ig],
  ["Method", /\b(?:xrd|xps|tem|sem|uv[- ]?vis|drs|pl|eis|ftir|raman|photocatalysis|transient absorption)\b/ig],
  ["Reaction", /\b(?:co2 reduction|co production|methane|hydrogen evolution|photocatalytic activity|catalytic efficiency)\b/ig],
];

function sha(value) { return crypto.createHash("sha256").update(String(value), "utf8").digest("hex"); }
function posix(value) { return value.split(path.sep).join("/"); }
function compact(value, length = 180) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, length); }
function safe(value) { return String(value || "paper-graph").replace(/[^a-z0-9_-]+/ig, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "paper-graph"; }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function listSidecars(vault) {
  const dir = path.join(vault, ".scholarium", "pdf-sidecars");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((name) => name.endsWith(".json")).sort().map((name) => ({ file: path.join(dir, name), relative: posix(path.relative(vault, path.join(dir, name))) }));
}
function validSidecar(sidecar) {
  if (!sidecar || sidecar.kind !== "scholarium-pdf-anchor-sidecar") return "wrong_kind";
  if (!/^[a-f0-9]{64}$/i.test(String(sidecar.source_sha256 || ""))) return "missing_source_sha256";
  if (!/^https?:\/\//i.test(String(sidecar.original_url || ""))) return "missing_original_url";
  if (!Array.isArray(sidecar.anchors) || !sidecar.anchors.length) return "missing_anchors";
  return "";
}
function extractEntities(text, keywords) {
  const found = new Map();
  for (const [kind, regex] of ENTITY_PATTERNS) {
    for (const match of String(text || "").matchAll(regex)) {
      const label = compact(match[0], 80).toLowerCase();
      found.set(`${kind}:${label}`, { kind, label });
    }
  }
  for (const keyword of keywords || []) {
    const label = compact(keyword, 80).toLowerCase();
    if (label && String(text || "").toLowerCase().includes(label)) found.set(`Keyword:${label}`, { kind: "Keyword", label });
  }
  return [...found.values()];
}
// PDF text extraction commonly groups bibliography entries into the same block
// as their title.  A bibliography mentions many materials and methods but is
// not evidence that the *paper* discusses them, so keep it out of this
// navigation view.  This is deliberately a high-confidence filter: uncertain
// blocks remain visible rather than being silently discarded.
function isLikelyReferenceBlock(text) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  const doiCount = (value.match(/\b(?:doi|pubmed)\b/ig) || []).length;
  const yearCount = (value.match(/\b(?:19|20)\d{2}\b/g) || []).length;
  return doiCount >= 2 || (doiCount >= 1 && yearCount >= 3 && /\b(?:references|bibliography)\b/i.test(value));
}
function parseInput(input) {
  if (!input) return { limit: 10, keywords: [] };
  const value = typeof input === "string" ? JSON.parse(input) : input;
  const limit = Math.max(1, Math.min(50, Number(value.limit || 10) || 10));
  const keywords = Array.isArray(value.keywords) ? value.keywords.map((x) => compact(x, 80)).filter(Boolean).slice(0, 30) : [];
  return { limit, keywords };
}
function buildPlan(vault, input = {}) {
  const options = parseInput(input);
  const terminal = [];
  const papers = [];
  const entities = new Map();
  const edges = [];
  let skippedReferenceAnchors = 0;
  for (const entry of listSidecars(vault)) {
    let sidecar;
    try { sidecar = readJson(entry.file); } catch (error) { terminal.push({ path: entry.relative, status: "rejected", reason: "invalid_json" }); continue; }
    const reason = validSidecar(sidecar);
    if (reason) { terminal.push({ path: entry.relative, status: "rejected", reason }); continue; }
    if (papers.length >= options.limit) { terminal.push({ path: entry.relative, status: "deferred", reason: "limit" }); continue; }
    const paperId = `pdf:${sidecar.source_sha256.slice(0, 16)}`;
    const paper = { id: paperId, type: "Paper", label: compact(sidecar.doi || path.basename(sidecar.source_path || entry.file), 120), doi: String(sidecar.doi || ""), source_path: sidecar.source_path, source_sha256: sidecar.source_sha256, original_url: sidecar.original_url };
    papers.push(paper);
    let edgeCount = 0;
    for (const anchor of sidecar.anchors) {
      if (!anchor || !String(anchor.id || "").trim() || !String(anchor.text_hash || anchor.quote_hash || "").trim()) continue;
      if (isLikelyReferenceBlock(anchor.text)) { skippedReferenceAnchors++; continue; }
      const locator = { source_sha256: sidecar.source_sha256, anchor: String(anchor.id), quote_hash: String(anchor.quote_hash || anchor.text_hash), original_url: sidecar.original_url };
      for (const entity of extractEntities(anchor.text, options.keywords)) {
        const entityId = `${entity.kind.toLowerCase()}:${safe(entity.label)}`;
        if (!entities.has(entityId)) entities.set(entityId, { id: entityId, type: entity.kind, label: entity.label });
        edges.push({ from: paperId, to: entityId, relation: "MENTIONS", locator, evidence_text: compact(anchor.text, 260) });
        edgeCount++;
      }
    }
    terminal.push({ path: entry.relative, status: "accepted", papers: 1, edges: edgeCount });
  }
  const accepted = terminal.filter((x) => x.status === "accepted").length;
  const rejected = terminal.filter((x) => x.status === "rejected").length;
  const deferred = terminal.filter((x) => x.status === "deferred").length;
  const plan = { artifact: "paper_knowledge_graph_plan", version: 1, generated_at: new Date().toISOString(), vault, write_mode: "dry_run", input: options, source: { sidecar_directory: ".scholarium/pdf-sidecars", scanned: terminal.length, accepted, rejected, deferred, skipped_reference_anchors: skippedReferenceAnchors, terminal }, graph: { papers, entities: [...entities.values()], edges }, invariants: { every_input_has_terminal_state: accepted + rejected + deferred === terminal.length, edges_are_mentions_only: edges.every((edge) => edge.relation === "MENTIONS"), every_edge_has_locator: edges.every((edge) => Object.values(edge.locator).every(Boolean)), creates_no_schema_objects: true, overwrites_no_existing_files: true } };
  plan.plan_sha256 = sha(JSON.stringify(plan));
  plan.valid = Object.values(plan.invariants).every(Boolean);
  return plan;
}
const TYPE_STYLE = {
  Paper: { color: "4", hex: "#98a6ff", label: "PAPERS" },
  Material: { color: "3", hex: "#79b8ef", label: "MATERIALS" },
  Method: { color: "6", hex: "#ae8be7", label: "METHODS" },
  Reaction: { color: "1", hex: "#dc7a9a", label: "REACTIONS" },
  Keyword: { color: "2", hex: "#d9a66e", label: "KEYWORDS" },
};

// The raw plan keeps every locator.  A view must not draw one edge per
// mention: the same paper/entity pair can occur hundreds of times.  Collapse
// only the display edge and retain all located mentions under it.
function visualGraph(plan) {
  const grouped = new Map();
  for (const edge of plan.graph.edges) {
    const key = `${edge.from}|${edge.to}`;
    if (!grouped.has(key)) grouped.set(key, { id: `view:${sha(key).slice(0, 20)}`, from: edge.from, to: edge.to, relation: "MENTIONS", mentions: [] });
    grouped.get(key).mentions.push({ locator: edge.locator, evidence_text: edge.evidence_text });
  }
  return {
    papers: plan.graph.papers.map((paper) => ({ ...paper, style: TYPE_STYLE.Paper })),
    entities: plan.graph.entities.map((entity) => ({ ...entity, style: TYPE_STYLE[entity.type] || TYPE_STYLE.Keyword })),
    edges: [...grouped.values()],
  };
}

function canvas(plan) {
  const nodes = [];
  const edges = [];
  const view = visualGraph(plan);
  view.papers.forEach((paper, index) => nodes.push({ id: paper.id, type: "text", text: `# Paper\n${paper.label}`, x: 60 + (index % 3) * 330, y: Math.floor(index / 3) * 150, width: 280, height: 100, color: paper.style.color }));
  const byType = new Map();
  view.entities.forEach((entity) => { if (!byType.has(entity.type)) byType.set(entity.type, []); byType.get(entity.type).push(entity); });
  let typeIndex = 0;
  for (const [type, entities] of byType) {
    entities.forEach((entity, index) => nodes.push({ id: entity.id, type: "text", text: `# ${entity.type}\n${entity.label}`, x: 1120 + typeIndex * 300, y: 40 + index * 110, width: 230, height: 80, color: entity.style.color }));
    typeIndex++;
  }
  view.edges.forEach((edge) => edges.push({ id: edge.id, fromNode: edge.from, toNode: edge.to, label: edge.mentions.length === 1 ? "MENTIONS" : `MENTIONS ×${edge.mentions.length}` }));
  return { nodes, edges };
}

function escapeHtml(value) { return String(value || "").replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char])); }

function htmlVisualization(plan) {
  return htmlVisualizationStatic(plan);
  /*
  const view = visualGraph(plan);
  const payload = JSON.stringify({ generated_at: plan.generated_at, papers: view.papers, entities: view.entities, edges: view.edges })
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  const title = "织研者 · Paper Knowledge Graph";
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
:root{--bg:#090b10;--ink:#f3f0ea;--muted:#8e95a3;--hair:rgba(255,255,255,.08);--accent:#98a6ff;--glass:rgba(13,16,24,.78)}
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:radial-gradient(1100px 700px at 56% 45%,rgba(89,105,182,.11),transparent 62%),linear-gradient(180deg,#0a0c12,#080a0f);color:var(--ink);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}
body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.16;background-image:radial-gradient(rgba(255,255,255,.12) .55px,transparent .65px);background-size:5px 5px}
.topbar{height:82px;position:fixed;inset:0 0 auto;z-index:5;display:grid;grid-template-columns:minmax(280px,1fr) minmax(300px,520px) auto;gap:22px;align-items:center;padding:0 30px;border-bottom:1px solid var(--hair);background:linear-gradient(180deg,rgba(9,11,16,.94),rgba(9,11,16,.72));backdrop-filter:blur(22px)}
.brand{display:flex;gap:15px;align-items:center;min-width:0}.mark{width:32px;height:32px;border:1px solid rgba(152,166,255,.6);border-radius:50%;box-shadow:0 0 22px rgba(152,166,255,.16) inset;position:relative}.mark:after{content:"";position:absolute;width:6px;height:6px;border-radius:50%;background:#98a6ff;left:12px;top:12px;box-shadow:-10px -8px 0 -1px #72d7b2,11px 8px 0 -1px #dc7a9a}.kicker{font-size:10px;letter-spacing:.19em;color:#697182;text-transform:uppercase}.title{font:600 18px ui-serif,Georgia,"Songti SC",serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}.subtitle{font-size:11px;color:var(--muted);margin-top:3px}
.search{height:40px;width:100%;border:1px solid var(--hair);outline:none;border-radius:999px;padding:0 17px 0 40px;color:var(--ink);background:rgba(255,255,255,.025)}.search:focus{border-color:rgba(152,166,255,.5);box-shadow:0 0 0 4px rgba(152,166,255,.06)}.search-wrap{position:relative}.search-wrap:before{content:"⌕";position:absolute;z-index:1;left:15px;top:7px;font-size:20px;color:#7b8290}.metrics{display:flex;gap:18px}.metric{text-align:right}.metric b{font:600 14px ui-monospace,monospace;display:block}.metric span{font-size:9px;letter-spacing:.15em;color:#697182}
.rail{position:fixed;z-index:3;left:28px;top:108px;bottom:52px;width:176px}.rail-cap{font-size:9px;letter-spacing:.18em;color:#59606e;margin:4px 0 14px}.types{display:flex;flex-direction:column;gap:3px}.type{border:0;background:transparent;color:#9aa1ae;text-align:left;padding:9px 8px;border-radius:9px;cursor:pointer;display:grid;grid-template-columns:10px 1fr auto;gap:9px;align-items:center}.type:hover,.type.active{background:linear-gradient(90deg,rgba(152,166,255,.16),transparent);color:#fff}.dot{width:7px;height:7px;border-radius:50%;box-shadow:0 0 15px currentColor}.count{font:10px ui-monospace,monospace;color:#606877}
#svg{position:fixed;inset:82px 0 0;width:100%;height:calc(100% - 82px);cursor:grab;touch-action:none}#svg.dragging{cursor:grabbing}.edge{stroke:rgba(173,184,218,.18);stroke-width:1.15;fill:none}.edge.focus{stroke:rgba(196,203,255,.78);stroke-width:1.8}.node{cursor:pointer}.node .halo{opacity:.18}.node:hover .halo,.node.selected .halo{opacity:.62}.node.dim,.edge.dim{opacity:.09}.node-label{font-size:11px;fill:#c8ced9;paint-order:stroke;stroke:#090b10;stroke-width:4px;stroke-linejoin:round;pointer-events:none}.zone{font:600 10px ui-sans-serif,sans-serif;letter-spacing:.18em;fill:#3c4351}
.inspector{position:fixed;z-index:4;right:24px;top:104px;bottom:28px;width:330px;transform:translateX(370px);opacity:0;transition:.35s;pointer-events:none;background:linear-gradient(180deg,rgba(18,22,31,.94),rgba(10,13,19,.92));border:1px solid var(--hair);border-radius:18px 6px 18px 18px;box-shadow:0 24px 80px rgba(0,0,0,.42);padding:24px;overflow:auto}.inspector.open{transform:none;opacity:1;pointer-events:auto}.close{position:absolute;right:13px;top:11px;border:0;background:transparent;color:#9ca3b0;font-size:22px;cursor:pointer}.inspector-type{font-size:10px;letter-spacing:.15em;margin-bottom:14px}.inspector h2{font:500 24px ui-serif,Georgia,"Songti SC",serif;line-height:1.2;margin:0 25px 8px 0}.inspector .meta{font:10px ui-monospace,monospace;color:#798190}.locator{margin-top:18px;border-top:1px solid var(--hair);padding-top:14px;font-size:11px;line-height:1.6;color:#bfc5cf}.locator b{color:#fff}.locator small{display:block;color:#7c8491;word-break:break-all}.empty{color:#8e95a3;font-size:12px;margin-top:24px}
.footer{position:fixed;z-index:3;left:28px;right:28px;bottom:17px;display:flex;justify-content:space-between;font-size:10px;color:#697182;pointer-events:none}.footer i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#98a6ff;margin-right:6px}.footer kbd{border:1px solid var(--hair);padding:2px 5px;border-radius:4px}@media(max-width:850px){.topbar{grid-template-columns:1fr auto;padding:0 16px}.search-wrap{display:none}.metrics{gap:9px}.rail{left:10px;width:130px}.inspector{right:10px;width:min(315px,calc(100vw - 20px))}.footer{left:12px;right:12px}}
</style></head><body>
<header class="topbar"><div class="brand"><div class="mark"></div><div><div class="kicker">Evidence-located navigation view</div><div class="title">${title}</div><div class="subtitle">${view.papers.length} 篇 PDF · ${view.entities.length} 个实体 · ${view.edges.length} 条压缩 MENTIONS 关系</div></div></div><div class="search-wrap"><input class="search" id="search" placeholder="搜索材料、方法、反应或关键词"></div><div class="metrics"><div class="metric"><b id="nodeCount">${view.papers.length + view.entities.length}</b><span>NODES</span></div><div class="metric"><b>${view.edges.length}</b><span>RELATIONS</span></div></div></header>
<aside class="rail"><div class="rail-cap">SEMANTIC LAYERS</div><div class="types" id="types"></div></aside><svg id="svg" aria-label="Paper knowledge graph"><defs><filter id="glow"><feGaussianBlur stdDeviation="4"/></filter><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(173,184,218,.34)"/></marker></defs><g id="view"></g></svg>
<aside class="inspector" id="inspector"><button class="close" id="close">×</button><div class="inspector-type" id="kind"></div><h2 id="label"></h2><div class="meta" id="meta"></div><div id="details"></div></aside><footer class="footer"><span><i></i>边只表示“文献段落提及”，不是科研结论</span><span>拖拽平移 · 滚轮缩放 · <kbd>Esc</kbd> 重置</span></footer>
<script>const graph=${payload};const style=${JSON.stringify(TYPE_STYLE)};const svg=document.getElementById('svg'),view=document.getElementById('view'),types=document.getElementById('types'),inspector=document.getElementById('inspector');const nodes=[...graph.papers,...graph.entities],byId=new Map(nodes.map(n=>[n.id,n]));const typeOrder=['Paper','Material','Method','Reaction','Keyword'];let active='all',selected='',q='',pan={x:0,y:0},scale=1,drag=null;const esc=s=>String(s||'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]));const groups={};nodes.forEach(n=>(groups[n.type]??=[]).push(n));Object.entries(groups).forEach(([kind,list],i)=>{const center=kind==='Paper'?[0,0]:[260*Math.cos(i*1.4),220*Math.sin(i*1.4)];list.forEach((n,j)=>{const a=j*2.399;const r=kind==='Paper'?70+Math.sqrt(j)*76:55+Math.sqrt(j)*54;n.x=center[0]+Math.cos(a)*r;n.y=center[1]+Math.sin(a)*r})});function transform(){view.setAttribute('transform',`translate(${pan.x} ${pan.y}) scale(${scale})`)}function fit(){const r=svg.getBoundingClientRect();scale=Math.max(.48,Math.min(1.08,Math.min((r.width-330)/780,(r.height-120)/650)));pan={x:r.width*.48,y:r.height*.51};transform()}function matches(n){return !q||[n.label,n.type,n.doi].join(' ').toLowerCase().includes(q)}function related(id){return graph.edges.some(e=>e.from===id||e.to===id)}function render(){types.innerHTML=['all',...typeOrder.filter(t=>groups[t]?.length)].map(t=>{const c=t==='all'?'#98a6ff':style[t].hex,count=t==='all'?nodes.length:groups[t].length;return `<button class="type ${active===t?'active':''}" data-type="${t}"><i class="dot" style="color:${c};background:${c}"></i><span>${t==='all'?'全部层级':style[t].label}</span><b class="count">${count}</b></button>`}).join('');types.querySelectorAll('.type').forEach(x=>x.onclick=()=>{active=x.dataset.type;render()});view.innerHTML='';typeOrder.forEach((t,i)=>{if(groups[t]?.length){const p=groups[t][0];const z=document.createElementNS('http://www.w3.org/2000/svg','text');z.setAttribute('class','zone');z.setAttribute('x',p.x-60);z.setAttribute('y',p.y-85);z.textContent=style[t].label;view.append(z)}});graph.edges.forEach(e=>{const a=byId.get(e.from),b=byId.get(e.to),focus=selected&&(e.from===selected||e.to===selected);const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('class','edge '+(focus?'focus':'')+(selected&&!focus?' dim':''));line.setAttribute('x1',a.x);line.setAttribute('y1',a.y);line.setAttribute('x2',b.x);line.setAttribute('y2',b.y);line.setAttribute('marker-end','url(#arrow)');view.append(line)});nodes.forEach(n=>{const visible=(active==='all'||n.type===active)&&matches(n);const g=document.createElementNS('http://www.w3.org/2000/svg','g');g.setAttribute('class','node '+(!visible?'dim ':'')+(selected===n.id?'selected':''));g.setAttribute('transform',`translate(${n.x} ${n.y})`);const c=n.style.hex;g.innerHTML=`<circle class="halo" r="${n.type==='Paper'?34:25}" fill="${c}" filter="url(#glow)"></circle><circle r="${n.type==='Paper'?13:9}" fill="${c}" stroke="rgba(255,255,255,.25)"></circle><text class="node-label" text-anchor="middle" y="${n.type==='Paper'?31:25}">${esc(n.label).slice(0,42)}</text>`;g.onclick=e=>{e.stopPropagation();selected=n.id;show(n);render()};view.append(g)});document.getElementById('nodeCount').textContent=nodes.filter(n=>(active==='all'||n.type===active)&&matches(n)).length;transform()}function show(n){inspector.classList.add('open');document.getElementById('kind').textContent=style[n.type].label;document.getElementById('kind').style.color=n.style.hex;document.getElementById('label').textContent=n.label;const edges=graph.edges.filter(e=>e.from===n.id||e.to===n.id);document.getElementById('meta').textContent=`${n.type} · ${edges.length} relationship(s)`;document.getElementById('details').innerHTML=n.type==='Paper'?`<div class="locator"><b>DOI</b><small>${esc(n.doi||'Not recorded')}</small><b>Source</b><small>${esc(n.original_url||'')}</small></div>`:`<div class="locator"><b>Located mentions</b>${edges.slice(0,8).map(e=>{const m=e.mentions[0],p=byId.get(e.from===n.id?e.to:e.from);return `<div><b>${esc(p.label)}</b> · ${e.mentions.length} mention(s)<small>${esc(m.locator.anchor)} · ${esc(m.locator.original_url)}</small></div>`}).join('')}</div>`}document.getElementById('close').onclick=()=>{selected='';inspector.classList.remove('open');render()};document.getElementById('search').oninput=e=>{q=e.target.value.trim().toLowerCase();render()};svg.addEventListener('pointerdown',e=>{drag={x:e.clientX-pan.x,y:e.clientY-pan.y};svg.setPointerCapture(e.pointerId);svg.classList.add('dragging')});svg.addEventListener('pointermove',e=>{if(!drag)return;pan={x:e.clientX-drag.x,y:e.clientY-drag.y};transform()});svg.addEventListener('pointerup',e=>{drag=null;svg.classList.remove('dragging');svg.releasePointerCapture(e.pointerId)});svg.addEventListener('wheel',e=>{e.preventDefault();const r=svg.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top,old=scale;scale=Math.max(.45,Math.min(2.1,scale*Math.exp(-e.deltaY*.001)));pan={x:x-(x-pan.x)*(scale/old),y:y-(y-pan.y)*(scale/old)};transform()},{passive:false});document.addEventListener('keydown',e=>{if(e.key==='Escape'){q='';document.getElementById('search').value='';active='all';selected='';inspector.classList.remove('open');fit();render()}});window.addEventListener('resize',fit);fit();render();<\/script></body></html>`;
  */
}

function htmlVisualizationStatic(plan) {
  const view = visualGraph(plan);
  const layout = new Map();
  const grouped = new Map();
  for (const entity of view.entities) {
    if (!grouped.has(entity.type)) grouped.set(entity.type, []);
    grouped.get(entity.type).push(entity);
  }
  view.papers.forEach((paper, index) => layout.set(paper.id, { x: 520 + (index % 3) * 190, y: 290 + Math.floor(index / 3) * 145 }));
  // Keep the right-hand semantic columns inside the 1280px SVG/view frame.
  // A 3-column group offsets its centre by -135/0/+135 and each card is 136px.
  const centers = { Material: [190, 155], Method: [1000, 150], Reaction: [190, 620], Keyword: [1000, 620] };
  for (const [type, entities] of grouped) entities.forEach((entity, index) => {
    const center = centers[type] || [1210, 700];
    layout.set(entity.id, { x: center[0] + (index % 3) * 135 - 135, y: center[1] + Math.floor(index / 3) * 78 });
  });
  const nodes = [...view.papers, ...view.entities];
  const nodeMarkup = nodes.map((node) => {
    const point = layout.get(node.id); const color = node.style.hex;
    return '<div class="node ' + node.type.toLowerCase() + '" style="left:' + point.x + 'px;top:' + point.y + 'px;--color:' + color + '" title="' + escapeHtml(node.label) + '"><b>' + escapeHtml(node.label).slice(0, 38) + '</b><small>' + escapeHtml(node.type) + '</small></div>';
  }).join("");
  const edgeMarkup = view.edges.map((edge) => {
    const a = layout.get(edge.from); const b = layout.get(edge.to); if (!a || !b) return "";
    return '<line x1="' + (a.x + 68) + '" y1="' + (a.y + 26) + '" x2="' + (b.x + 68) + '" y2="' + (b.y + 26) + '"/>';
  }).join("");
  const legend = ["Paper", "Material", "Method", "Reaction", "Keyword"].filter((type) => type === "Paper" || grouped.has(type))
    .map((type) => '<span><i style="background:' + TYPE_STYLE[type].hex + '"></i>' + TYPE_STYLE[type].label + '</span>').join("");
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>织研者 · Paper Knowledge Graph</title><style>' +
    ':root{--bg:#090b10;--ink:#f3f0ea;--muted:#8e95a3;--hair:rgba(255,255,255,.08)}*{box-sizing:border-box}html,body{margin:0;min-width:1500px;min-height:960px;background:radial-gradient(1100px 700px at 56% 45%,rgba(89,105,182,.11),transparent 62%),linear-gradient(180deg,#0a0c12,#080a0f);color:var(--ink);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",sans-serif}body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.15;background-image:radial-gradient(rgba(255,255,255,.12) .55px,transparent .65px);background-size:5px 5px}.topbar{height:82px;position:fixed;inset:0 0 auto;z-index:3;display:flex;align-items:center;justify-content:space-between;padding:0 34px;border-bottom:1px solid var(--hair);background:linear-gradient(180deg,rgba(9,11,16,.94),rgba(9,11,16,.72));backdrop-filter:blur(22px)}.brand{display:flex;gap:15px;align-items:center}.mark{width:32px;height:32px;border:1px solid rgba(152,166,255,.6);border-radius:50%;box-shadow:0 0 22px rgba(152,166,255,.16) inset;position:relative}.mark:after{content:"";position:absolute;width:6px;height:6px;border-radius:50%;background:#98a6ff;left:12px;top:12px;box-shadow:-10px -8px 0 -1px #72d7b2,11px 8px 0 -1px #dc7a9a}.kicker{font-size:10px;letter-spacing:.19em;color:#697182;text-transform:uppercase}.title{font:600 18px ui-serif,Georgia,"Songti SC",serif;margin-top:4px}.subtitle{font-size:11px;color:var(--muted);margin-top:3px}.metrics{display:flex;gap:20px}.metric{text-align:right}.metric b{display:block;font:600 14px ui-monospace,monospace}.metric span{font-size:9px;letter-spacing:.15em;color:#697182}.rail{position:fixed;left:28px;top:108px;z-index:2;width:176px}.rail-cap{font-size:9px;letter-spacing:.18em;color:#59606e;margin:4px 0 14px}.legend{display:flex;flex-direction:column;gap:9px}.legend span{font-size:12px;color:#a7afbd}.legend i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:9px;box-shadow:0 0 13px currentColor}.graph{position:absolute;top:82px;left:210px;width:1280px;height:835px}.graph svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}.graph line{stroke:rgba(173,184,218,.20);stroke-width:1.1}.node{position:absolute;z-index:1;width:136px;min-height:52px;padding:8px 9px;border:1px solid color-mix(in srgb,var(--color),transparent 42%);border-radius:12px;background:linear-gradient(145deg,color-mix(in srgb,var(--color),transparent 89%),rgba(12,15,22,.83));box-shadow:0 10px 25px rgba(0,0,0,.2),0 0 22px color-mix(in srgb,var(--color),transparent 88%)}.node b{display:block;font-size:11px;line-height:1.35;word-break:break-word}.node small{display:block;margin-top:4px;font:9px ui-monospace,monospace;color:#8f98a8;text-transform:uppercase}.node.paper{width:150px;min-height:60px;background:linear-gradient(145deg,rgba(152,166,255,.17),rgba(12,15,22,.84))}.zone{position:absolute;z-index:0;font:600 10px ui-sans-serif,sans-serif;letter-spacing:.18em;color:#4d5563}.zone.material{left:40px;top:35px}.zone.method{right:5px;top:35px}.zone.reaction{left:40px;bottom:105px}.zone.keyword{right:5px;bottom:105px}.footer{position:fixed;z-index:2;left:28px;right:28px;bottom:18px;display:flex;justify-content:space-between;font-size:10px;color:#697182}.footer i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#98a6ff;margin-right:6px}.note{position:fixed;right:28px;bottom:48px;width:310px;border-left:2px solid #98a6ff;padding:10px 13px;background:rgba(18,22,31,.67);color:#aab1bd;font-size:11px;line-height:1.55}</style></head><body><header class="topbar"><div class="brand"><div class="mark"></div><div><div class="kicker">Evidence-located navigation view</div><div class="title">织研者 · Paper Knowledge Graph</div><div class="subtitle">' + view.papers.length + ' 篇 PDF · ' + view.entities.length + ' 个实体 · ' + view.edges.length + ' 条压缩 MENTIONS 关系</div></div></div><div class="metrics"><div class="metric"><b>' + nodes.length + '</b><span>NODES</span></div><div class="metric"><b>' + view.edges.length + '</b><span>RELATIONS</span></div></div></header><aside class="rail"><div class="rail-cap">SEMANTIC LAYERS</div><div class="legend">' + legend + '</div></aside><main class="graph"><span class="zone material">MATERIALS</span><span class="zone method">METHODS</span><span class="zone reaction">REACTIONS</span><span class="zone keyword">KEYWORDS</span><svg viewBox="0 0 1280 835">' + edgeMarkup + '</svg>' + nodeMarkup + '</main><aside class="note">每一条边只表示：某篇 PDF 的某个已定位段落提及该实体。它不是支持、反驳或科研结论；正式 Evidence 仍须走 Scholarium 审核流程。</aside><footer class="footer"><span><i></i>视图可由同一组 sidecar 重建</span><span>生成时间：' + escapeHtml(plan.generated_at) + '</span></footer></body></html>';
}
function report(plan) {
  const lines = ["---", "generated_by: paper-knowledge-graph", `plan_sha256: ${plan.plan_sha256}`, "rebuildable_view: true", "---", "", "# Paper knowledge graph", "", `- Papers: ${plan.graph.papers.length}`, `- Entities: ${plan.graph.entities.length}`, `- Located MENTIONS edges: ${plan.graph.edges.length}`, "", "## Boundary", "", "All edges mean only that a passage mentions an entity. This report establishes no scientific conclusion and creates no formal Evidence.", "", "## Papers", ""];
  for (const paper of plan.graph.papers) lines.push(`- ${paper.label} — ${paper.original_url}`);
  lines.push("", "## Located edges", "");
  for (const edge of plan.graph.edges) lines.push(`- ${edge.from} → ${edge.to} (${edge.locator.anchor}): ${edge.evidence_text}`);
  return lines.join("\n") + "\n";
}
function applyPlan(plan) {
  if (!plan.valid) throw new Error("invalid_plan_refuses_write");
  const stamp = plan.generated_at.replace(/[:.]/g, "-");
  const canvasPath = path.join(plan.vault, "Canvases", `paper-knowledge-graph-${stamp}.canvas`);
  const visualizationPath = path.join(plan.vault, "Canvases", `paper-knowledge-graph-${stamp}.html`);
  const reportPath = path.join(plan.vault, "Research", "WeaveRuns", `paper-knowledge-graph-${stamp}.md`);
  if (fs.existsSync(canvasPath) || fs.existsSync(visualizationPath) || fs.existsSync(reportPath)) throw new Error("timestamp_target_already_exists");
  fs.mkdirSync(path.dirname(canvasPath), { recursive: true });
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(canvasPath, JSON.stringify(canvas(plan), null, 2), "utf8");
  fs.writeFileSync(visualizationPath, htmlVisualization(plan), "utf8");
  fs.writeFileSync(reportPath, report(plan), "utf8");
  return { canvas: posix(path.relative(plan.vault, canvasPath)), visualization: posix(path.relative(plan.vault, visualizationPath)), report: posix(path.relative(plan.vault, reportPath)) };
}
if (require.main === module) {
  const args = process.argv.slice(2); const vault = path.resolve(args[0] || "");
  if (!vault || !fs.existsSync(vault)) throw new Error("usage: build_paper_graph.js <vault> [input-json] [--apply]");
  const apply = args.includes("--apply"); const raw = args.find((arg) => arg !== "--apply" && arg !== args[0]);
  let input = {}; if (raw) input = fs.existsSync(raw) ? readJson(raw) : JSON.parse(raw);
  const plan = buildPlan(vault, input); if (apply) plan.applied = applyPlan(plan); console.log(JSON.stringify(plan, null, 2));
}
module.exports = { buildPlan, applyPlan, extractEntities, isLikelyReferenceBlock, visualGraph, canvas, htmlVisualization };
