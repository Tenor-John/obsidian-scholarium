#!/usr/bin/env python3
from __future__ import annotations

import html
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from quote_verify import verify_quote

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

NODE_TYPES = {
    "material", "precursor", "condition", "process", "structure",
    "mechanism", "characterization", "outcome", "paper", "question",
    # Project-structural types (2026-09-01): a read-only projection of this
    # project's own specimens/executions/observations onto the same graph,
    # not a second taxonomy. Deliberately visualization-only — see
    # SKILL.md's "project-structural nodes" note for why these are not new
    # committed schema-v1 object types.
    "specimen", "synthesis", "execution", "observation", "claim",
}
RELATIONS = {
    "contains", "prepared_from", "treated_by", "under_condition", "forms",
    "changes", "enables", "inhibits", "measured_by", "correlates_with",
    "supports", "contradicts", "tests",
    # Only added because nothing above covers "this specimen is an instance
    # of that material system" without overloading `contains`/`forms`.
    "instance_of",
}
TYPE_LABELS = {
    "material": "材料", "precursor": "前驱体", "condition": "条件",
    "process": "过程", "structure": "结构", "mechanism": "机理",
    "characterization": "表征", "outcome": "结果", "paper": "文献",
    "question": "研究问题",
    "specimen": "样品", "synthesis": "制备", "execution": "表征执行",
    "observation": "观测", "claim": "结论",
}
TYPE_COLORS = {
    "material": "#2366d1", "precursor": "#7c3aed", "condition": "#db6b20",
    "process": "#0f8b8d", "structure": "#9c3f74", "mechanism": "#c33f49",
    "characterization": "#53657d", "outcome": "#2f855a", "paper": "#6b7280",
    "question": "#111827",
    "specimen": "#a16207", "synthesis": "#0891b2", "execution": "#4d7c0f",
    "observation": "#7c2d12", "claim": "#1e3a8a",
}


def load_input(value: str) -> dict:
    if not value:
        return {}
    try:
        candidate = Path(value)
        if candidate.exists() and candidate.is_file():
            return json.loads(candidate.read_text(encoding="utf-8").lstrip("\ufeff"))
    except OSError:
        pass
    try:
        return json.loads(value)
    except Exception:
        return {}


def slug(value: str, prefix: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return (text[:48] or prefix)


def read_scoped_cards(root: Path, payload: dict) -> tuple[list[dict], int]:
    requested = payload.get("card_source_paths") or payload.get("pdf_paths") or []
    scope = {Path(str(item)).name.lower() for item in requested if item} if requested else None
    cards, skipped = [], 0
    folder = root / "literature" / "evidence-cards"
    if not folder.exists():
        return cards, skipped
    for target in sorted(folder.glob("*.json")):
        try:
            card = json.loads(target.read_text(encoding="utf-8"))
        except Exception:
            continue
        if scope is not None and Path(str(card.get("source_path", ""))).name.lower() not in scope:
            skipped += 1
            continue
        cards.append(card)
    return cards, skipped


def fallback_graph(cards: list[dict], payload: dict) -> dict:
    """Conservative emergency graph: vocabulary co-occurrence, never causality."""
    vocabulary = [
        ("Au", "material", r"\bAu\b|gold nanoparticle|gold core"),
        ("CeO₂", "material", r"CeO\s*2|ceria|cerium oxide"),
        ("Pt", "material", r"\bPt\b|platinum"),
        ("core–shell structure", "structure", r"core[-– ]shell|shell thickness"),
        ("oxygen vacancy", "mechanism", r"oxygen vacanc|\bOVs?\b"),
        ("surface Ce³⁺", "mechanism", r"Ce\s*3\+|Ce³"),
        ("SPR / hot electrons", "mechanism", r"surface plasmon|\bSPR\b|hot electron"),
        ("charge transfer", "mechanism", r"charge transfer|electron transfer|carrier separation"),
        ("visible-light irradiation", "condition", r"visible[- ]light|λ\s*>|420\s*nm"),
        ("hydrogen evolution", "outcome", r"hydrogen evolution|H2 production|water splitting"),
        ("photocatalytic activity", "outcome", r"photocatalytic activ|photoactivity"),
        ("TEM", "characterization", r"\bTEM\b|transmission electron"),
        ("XPS", "characterization", r"\bXPS\b|photoelectron spectroscopy"),
        ("UV–vis", "characterization", r"UV[-– ]?vis|ultraviolet.visible"),
    ]
    found: dict[str, dict] = {}
    co: dict[tuple[str, str], list[dict]] = {}
    relevant_cards = 0
    for card in cards:
        text = "\n".join(str(x) for x in (card.get("claim_candidates") or [])[:2])[:10000]
        hits = []
        for label, kind, pattern in vocabulary:
            if re.search(pattern, text, re.I):
                nid = slug(label, "entity")
                found[nid] = {"id": nid, "label": label, "type": kind, "description": "Evidence-card keyword match", "source_refs": []}
                found[nid]["source_refs"].append(str(card.get("source_path", "")))
                hits.append(nid)
        if "au" in hits and "ceo-2" in hits:
            relevant_cards += 1
        for index, left in enumerate(hits):
            for right in hits[index + 1:]:
                pair = tuple(sorted((left, right)))
                co.setdefault(pair, []).append({"source_path": str(card.get("source_path", "")), "locator": "automatic evidence-card excerpt"})
    edges = []
    for index, ((left, right), evidence) in enumerate(sorted(co.items(), key=lambda item: -len(item[1]))[:80], 1):
        if len(evidence) < 2:
            continue
        edges.append({"id": f"edge-{index}", "source": left, "target": right, "relation": "correlates_with", "label": "共同出现", "confidence": min(.75, .35 + .08 * len(evidence)), "review_status": "inferred", "evidence": evidence[:5]})
    warnings = ["Agent semantic extraction was unavailable; this fallback graph contains co-occurrence only and must not be read as causality."]
    if relevant_cards < max(2, len(cards) // 3):
        warnings.append(f"Source relevance gate warning: only {relevant_cards}/{len(cards)} cards mention both Au and CeO2.")
    return {"title": payload.get("title") or "科研知识图谱", "research_question": payload.get("research_question") or "", "summary": "Conservative fallback graph", "nodes": list(found.values()), "edges": edges, "warnings": warnings}


def _card_text_index(cards: list[dict]) -> dict[str, str]:
    """Maps a card's source_path (both the full path and just the filename,
    lowercased) to its full claim_candidates text, so an edge's claimed
    quote can be checked against the actual source it cites."""
    index: dict[str, str] = {}
    for card in cards:
        source_path = str(card.get("source_path") or "")
        if not source_path:
            continue
        text = "\n".join(str(x) for x in (card.get("claim_candidates") or []))
        index[source_path] = text
        index[Path(source_path).name.lower()] = text
    return index


def normalize_graph(raw: dict, cards: list[dict], skipped: int) -> tuple[dict, list[str]]:
    warnings = [str(x) for x in raw.get("warnings", []) if str(x).strip()][:20]
    card_text = _card_text_index(cards)
    nodes, seen = [], set()
    for index, item in enumerate(raw.get("nodes") or []):
        if not isinstance(item, dict):
            continue
        label = str(item.get("label") or "").strip()[:120]
        if not label:
            continue
        nid = str(item.get("id") or slug(label, f"node-{index+1}"))[:80]
        if nid in seen:
            continue
        seen.add(nid)
        kind = str(item.get("type") or "material").lower()
        if kind not in NODE_TYPES:
            warnings.append(f"Unknown node type '{kind}' on {nid}; normalized to material.")
            kind = "material"
        refs = [str(x)[:500] for x in (item.get("source_refs") or []) if str(x).strip()][:12]
        nodes.append({"id": nid, "label": label, "type": kind, "description": str(item.get("description") or "")[:1200], "source_refs": refs})
    edges = []
    for index, item in enumerate(raw.get("edges") or []):
        if not isinstance(item, dict):
            continue
        source, target = str(item.get("source") or ""), str(item.get("target") or "")
        if source not in seen or target not in seen or source == target:
            warnings.append(f"Dropped edge {index+1}: missing endpoint or self-loop.")
            continue
        relation = str(item.get("relation") or "correlates_with").lower()
        if relation not in RELATIONS:
            relation = "correlates_with"
        evidence = []
        for ev in item.get("evidence") or []:
            if isinstance(ev, str):
                ev = {"source_path": ev}
            if not isinstance(ev, dict) or not str(ev.get("source_path") or "").strip():
                continue
            evidence.append({"source_path": str(ev.get("source_path"))[:600], "locator": str(ev.get("locator") or "")[:300], "quote": str(ev.get("quote") or "")[:500]})
        claimed_supported = str(item.get("review_status") or "").lower() == "supported"
        if not evidence:
            review = "inferred"
        else:
            # `supported` requires at least one evidence entry whose quote is
            # independently verified against the actual card text. Carrying a
            # source_path/locator with no quote at all is not sufficient --
            # that gap previously let such an edge keep `supported` untouched,
            # because the per-quote verification loop below simply never ran
            # for it (an empty `quoted` list never overrides the initial
            # `review_status` guess). Never trust the model's own
            # review_status claim; only a verified quote earns `supported`.
            quoted = [e for e in evidence if e["quote"]]
            verified_any = False
            for e in quoted:
                text = card_text.get(e["source_path"]) or card_text.get(Path(e["source_path"]).name.lower())
                result = verify_quote(text, e["quote"]) if text is not None else {"verified": False, "reason": "source_card_not_found"}
                if result["verified"]:
                    verified_any = True
                elif claimed_supported:
                    warnings.append(
                        f"Edge {index+1} ({relation}): claimed quote not found verbatim in "
                        f"{e['source_path']} ({result['reason']}); downgraded to inferred."
                    )
            if not quoted and claimed_supported:
                warnings.append(
                    f"Edge {index+1} ({relation}): evidence has source_path/locator but no "
                    f"quote; a literature-evidence edge cannot be supported without a "
                    f"verified quote, downgraded to inferred."
                )
            review = "supported" if verified_any else "inferred"
        try:
            confidence = max(0.0, min(1.0, float(item.get("confidence", .5))))
        except (TypeError, ValueError):
            confidence = .5
        edges.append({"id": str(item.get("id") or f"edge-{index+1}"), "source": source, "target": target, "relation": relation, "label": str(item.get("label") or relation)[:100], "confidence": confidence, "review_status": review, "evidence": evidence[:8]})
    if skipped:
        warnings.append(f"Excluded {skipped} evidence cards outside the current Pipeline run.")
    if len(nodes) < 3 or len(edges) < 2:
        warnings.append("Graph is sparse: inspect evidence relevance and semantic extraction before scientific use.")
    graph = {"schema_version": "zrl-kg-1", "title": str(raw.get("title") or "科研知识图谱")[:160], "research_question": str(raw.get("research_question") or "")[:600], "summary": str(raw.get("summary") or "")[:1200], "nodes": nodes, "edges": edges, "warnings": list(dict.fromkeys(warnings)), "generated_at": datetime.now(timezone.utc).isoformat(), "source_card_count": len(cards)}
    return graph, graph["warnings"]


def render_html(graph: dict) -> str:
    data = json.dumps(graph, ensure_ascii=False).replace("</", "<\\/")
    type_config = {key: {"label": TYPE_LABELS[key], "color": TYPE_COLORS[key]} for key in NODE_TYPES}
    types = json.dumps(type_config, ensure_ascii=False)
    title = html.escape(graph["title"])
    # Presentation only: source evidence, graph normalization and review status
    # have all been finalized before this self-contained HTML is assembled.
    template = r'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>__TITLE__</title>
<style>
:root{--bg:#090b10;--ink:#f3f0ea;--muted:#8e95a3;--dim:#5d6472;--hair:rgba(255,255,255,.075);--accent:#98a6ff}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:var(--bg);color:var(--ink);font-family:Inter,"Segoe UI","Microsoft YaHei",sans-serif}body{background:radial-gradient(1100px 700px at 56% 45%,rgba(89,105,182,.11),transparent 62%),linear-gradient(180deg,#0a0c12,#080a0f)}body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.15;background-image:radial-gradient(rgba(180,194,255,.45) .6px,transparent .7px);background-size:10px 10px}.top{height:82px;display:grid;grid-template-columns:minmax(310px,1fr) minmax(280px,520px) auto;align-items:center;gap:22px;padding:0 30px 0 34px;border-bottom:1px solid var(--hair);background:rgba(9,11,16,.82);backdrop-filter:blur(20px);position:relative;z-index:3}.kicker,.cap{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--dim)}h1{font-family:ui-serif,Georgia,"Songti SC",serif;font-size:20px;margin:5px 0 2px}.subtitle{font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.search{height:40px;border:1px solid var(--hair);border-radius:999px;padding:0 18px;background:rgba(255,255,255,.025);color:var(--ink);outline:0;width:100%}.metrics{display:flex;gap:18px}.metrics b{display:block;text-align:right;font:600 17px ui-monospace,monospace}.metrics span{font-size:9px;letter-spacing:.15em;color:var(--dim)}main{height:calc(100vh - 82px);display:grid;grid-template-columns:190px 1fr 330px}.rail,.inspector{background:rgba(8,10,15,.55);border-right:1px solid var(--hair);padding:28px 24px;overflow:auto;z-index:2}.inspector{border-right:0;border-left:1px solid var(--hair)}.type{width:100%;border:0;background:transparent;color:#818896;display:grid;grid-template-columns:9px 1fr auto;align-items:center;gap:10px;padding:10px 7px;border-radius:8px;cursor:pointer;text-align:left}.type:hover,.type.on{background:rgba(152,166,255,.12);color:#f0efe9}.dot{width:7px;height:7px;border-radius:50%;box-shadow:0 0 16px currentColor}.count{font:10px ui-monospace,monospace;color:var(--dim)}.quality{border-top:1px solid var(--hair);margin-top:20px;padding-top:18px;font-size:11px;line-height:1.65;color:#747c8a}.warn{color:#d9a66e;margin:8px 0}.stage{position:relative;overflow:hidden}.focus{position:absolute;z-index:1;left:42px;top:33px;max-width:480px;pointer-events:none}.focus h2{font-family:ui-serif,Georgia,"Songti SC",serif;font-size:27px;font-weight:500;margin:8px 0;color:#eae8e2}.focus p{font-size:11px;line-height:1.6;color:#656d7b}.tools{position:absolute;right:20px;top:20px;z-index:2;display:flex;gap:8px}.tools button{background:rgba(13,16,24,.76);border:1px solid var(--hair);border-radius:7px;color:#c7cbd5;padding:8px 11px;cursor:pointer}.tools button:hover{border-color:rgba(152,166,255,.6)}svg{width:100%;height:100%;display:block;cursor:grab;touch-action:none}svg.panning{cursor:grabbing}.zone{font:9px ui-monospace,monospace;letter-spacing:.16em;fill:#48505e}.edge{fill:none;stroke:rgba(158,169,192,.38);stroke-width:1.05}.edge.inferred{stroke-dasharray:4 5;stroke:rgba(158,169,192,.26)}.edge-label{font:9px ui-monospace,monospace;fill:#667080;opacity:0;transition:.15s}.edge.hot+.edge-label,.edge-label.hot{opacity:1}.node{cursor:pointer}.halo{opacity:.18;filter:url(#glow)}.core{stroke:#0b0d12;stroke-width:2}.node-label{font-size:10px;fill:#e7e9ee;text-anchor:middle;paint-order:stroke;stroke:#090b10;stroke-width:4;stroke-linejoin:round}.node.dim,.edge.dim,.edge-label.dim{opacity:.08}.node.selected .core{stroke:#fff;stroke-width:2.5}.empty{font-size:12px;line-height:1.7;color:#69717f}.ititle{font-family:ui-serif,Georgia,"Songti SC",serif;font-size:24px;line-height:1.2;margin:12px 0;color:#f2efe8}.badge{display:inline-flex;gap:6px;align-items:center;font:10px ui-monospace,monospace;color:var(--nodeColor,#98a6ff);letter-spacing:.1em}.badge i{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 13px currentColor}.detail{font-size:12px;line-height:1.7;color:#9ba2ae;margin:18px 0}.rel{border-top:1px solid var(--hair);padding:11px 0;color:#aeb4c0;font-size:11px;cursor:pointer}.rel:hover{color:#fff}.rel small{float:right;color:#69717f;font-family:ui-monospace,monospace}.legend{position:absolute;z-index:2;left:25px;bottom:18px;color:#68717f;font-size:10px}.legend i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#aeb4c0;margin:0 5px 1px 14px}.legend i:first-child{margin-left:0}.legend .dash{background:transparent;border-top:1px dashed #aeb4c0;border-radius:0;width:13px;height:0}
</style></head><body><header class="top"><div><div class="kicker">Knowledge graph / semantic evidence map</div><h1>__TITLE__</h1><div class="subtitle">__SUBTITLE__</div></div><input id="search" class="search" placeholder="搜索实体、关系或来源…"><div class="metrics"><span><b id="nodeCount"></b>实体</span><span><b id="edgeCount"></b>关系</span></div></header><main><aside class="rail"><div class="cap">Semantic layers</div><div id="types"></div><div class="quality"><div class="cap">Quality</div><div id="warnings"></div><p>实线：已核验来源关系<br>虚线：推断/待审关系<br>点击节点查看证据；滚轮缩放，拖动画布。</p></div></aside><section class="stage"><div class="focus"><div class="kicker">Semantic evidence map</div><h2>从关系中读出机理</h2><p id="summary"></p></div><div class="tools"><button id="fit">适配视图</button><button id="reset">重置筛选</button></div><svg id="graph" aria-label="科研知识图谱"><defs><filter id="glow" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="8"/></filter><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7z" fill="#7d8798" opacity=".6"/></marker></defs><g id="viewport"><g id="zones"></g><g id="edges"></g><g id="edgeLabels"></g><g id="nodes"></g></g></svg><div class="legend"><i></i>已核验关系 <i class="dash"></i>推断/待审关系</div></section><aside class="inspector"><div class="cap">Inspector</div><div id="inspector" class="empty">点击任一实体，查看说明、相邻关系及来源证据。</div></aside></main><script>
const graph=__DATA__,typeConfig=__TYPES__,svg=document.querySelector('#graph'),vp=document.querySelector('#viewport'),ns='http://www.w3.org/2000/svg';let pan={x:0,y:0},scale=1,drag=null,selected=null,activeType='all';const nodes=graph.nodes.map((n,i)=>({...n,i,x:0,y:0}),byId=new Map());nodes.forEach(n=>byId.set(n.id,n));const groups={};nodes.forEach(n=>(groups[n.type]??=[]).push(n));const kinds=Object.keys(groups);const layout={material:[-260,-80],precursor:[-430,110],condition:[-390,290],process:[-170,180],structure:[30,-170],mechanism:[280,120],characterization:[-40,270],outcome:[220,280],paper:[470,240],question:[0,-330],specimen:[-330,-200],synthesis:[-160,-10],execution:[-260,30],observation:[60,120],claim:[270,-100]};kinds.forEach((kind,gi)=>{const list=groups[kind],base=layout[kind]||[Math.cos(gi*2.4)*330,Math.sin(gi*2.4)*240],radius=Math.max(58,36+list.length*13);list.forEach((n,j)=>{const a=(j/Math.max(1,list.length))*Math.PI*2-Math.PI/2;n.x=base[0]+Math.cos(a)*radius;n.y=base[1]+Math.sin(a)*radius})});function el(tag,a={}){const n=document.createElementNS(ns,tag);Object.entries(a).forEach(([k,v])=>n.setAttribute(k,v));return n}function esc(v){return String(v||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function short(v){const s=String(v||'').replace(/\s+/g,' ').trim();return s.length>24?s.slice(0,23)+'…':s}function curve(a,b){const mx=(a.x+b.x)/2,my=(a.y+b.y)/2,dx=b.x-a.x,dy=b.y-a.y;return `M${a.x},${a.y} Q${mx-dy*.12},${my+dx*.12} ${b.x},${b.y}`}const zones=document.querySelector('#zones'),edges=document.querySelector('#edges'),edgeLabels=document.querySelector('#edgeLabels'),nodeLayer=document.querySelector('#nodes');kinds.forEach(k=>{const p=layout[k]||[0,0],t=el('text',{x:p[0],y:p[1]-80,class:'zone','text-anchor':'middle'});t.textContent=(typeConfig[k]?.label||k).toUpperCase();zones.append(t)});graph.edges.forEach((e,i)=>{const a=byId.get(e.source),b=byId.get(e.target);if(!a||!b)return;const path=el('path',{d:curve(a,b),class:'edge '+(e.review_status==='inferred'?'inferred':''),'marker-end':'url(#arrow)'});path.dataset.edge=e.id;const lab=el('text',{x:(a.x+b.x)/2,y:(a.y+b.y)/2-5,class:'edge-label','text-anchor':'middle'});lab.dataset.edge=e.id;lab.textContent=short(e.label||e.relation);edges.append(path);edgeLabels.append(lab)});nodes.forEach(n=>{const g=el('g',{class:'node',transform:`translate(${n.x} ${n.y})`});g.dataset.id=n.id;const color=typeConfig[n.type]?.color||'#98a6ff',r=Math.max(12,Math.min(19,12+Math.sqrt((graph.edges.filter(e=>e.source===n.id||e.target===n.id).length))*2));g.innerHTML=`<circle class="halo" r="${r+13}" fill="${color}"></circle><circle class="core" r="${r}" fill="${color}"></circle><text class="node-label" y="${r+15}">${esc(short(n.label))}</text>`;g.addEventListener('click',ev=>{ev.stopPropagation();inspect(n)});g.addEventListener('pointerdown',ev=>{ev.stopPropagation();drag={node:n,sx:ev.clientX,sy:ev.clientY,ox:n.x,oy:n.y};svg.setPointerCapture(ev.pointerId)});nodeLayer.append(g)});function update(){vp.setAttribute('transform',`translate(${pan.x} ${pan.y}) scale(${scale})`)}function fit(){const r=svg.getBoundingClientRect(),xs=nodes.map(n=>n.x),ys=nodes.map(n=>n.y),w=Math.max(...xs)-Math.min(...xs)+220,h=Math.max(...ys)-Math.min(...ys)+210;scale=Math.max(.45,Math.min(1.25,Math.min(r.width/w,r.height/h)));pan={x:r.width/2-((Math.max(...xs)+Math.min(...xs))/2)*scale,y:r.height/2-((Math.max(...ys)+Math.min(...ys))/2)*scale};update()}function refreshEdges(id){graph.edges.forEach(e=>{if(id&&(e.source!==id&&e.target!==id))return;const a=byId.get(e.source),b=byId.get(e.target);edges.querySelector(`[data-edge="${CSS.escape(e.id)}"]`)?.setAttribute('d',curve(a,b));const l=edgeLabels.querySelector(`[data-edge="${CSS.escape(e.id)}"]`);l?.setAttribute('x',(a.x+b.x)/2);l?.setAttribute('y',(a.y+b.y)/2-5)})}function inspect(n){selected=n.id;document.querySelectorAll('.node').forEach(g=>g.classList.toggle('selected',g.dataset.id===n.id));const rel=graph.edges.filter(e=>e.source===n.id||e.target===n.id);document.querySelectorAll('.edge-label').forEach(x=>x.classList.remove('hot'));rel.forEach(e=>edgeLabels.querySelector(`[data-edge="${CSS.escape(e.id)}"]`)?.classList.add('hot'));const c=typeConfig[n.type]?.color||'#98a6ff';document.querySelector('.inspector').style.setProperty('--nodeColor',c);document.querySelector('#inspector').innerHTML=`<div class="badge"><i></i>${esc(typeConfig[n.type]?.label||n.type)}</div><h2 class="ititle">${esc(n.label)}</h2><div class="detail">${esc(n.description)||'无补充说明。'}</div><div class="cap">Relations · ${rel.length}</div>`+rel.map(e=>{const other=byId.get(e.source===n.id?e.target:e.source),ev=(e.evidence||[]).map(x=>`${esc(x.source_path)}${x.locator?' · '+esc(x.locator):''}`).join('<br>');return `<div class="rel" data-node="${esc(other?.id)}">${e.source===n.id?'→':'←'} ${esc(short(other?.label))}<small>${esc(e.relation)} · ${Math.round((e.confidence||0)*100)}%</small><div class="empty">${esc(e.review_status)}${ev?'<br>'+ev:''}</div></div>`}).join('');document.querySelectorAll('.rel[data-node]').forEach(x=>x.onclick=()=>inspect(byId.get(x.dataset.node)))}function applyFilter(){const q=document.querySelector('#search').value.toLowerCase().trim(),hit=new Set();nodes.forEach(n=>{const typeOk=activeType==='all'||n.type===activeType,txt=(n.label+' '+n.description+' '+n.type).toLowerCase();if(typeOk&&(!q||txt.includes(q)))hit.add(n.id)});if(q)graph.edges.forEach(e=>{if((e.label+' '+e.relation+' '+JSON.stringify(e.evidence)).toLowerCase().includes(q)){hit.add(e.source);hit.add(e.target)}});document.querySelectorAll('.node').forEach(g=>g.classList.toggle('dim',!hit.has(g.dataset.id)));graph.edges.forEach(e=>{const dim=!hit.has(e.source)||!hit.has(e.target);edges.querySelector(`[data-edge="${CSS.escape(e.id)}"]`)?.classList.toggle('dim',dim);edgeLabels.querySelector(`[data-edge="${CSS.escape(e.id)}"]`)?.classList.toggle('dim',dim)})}svg.addEventListener('pointerdown',e=>{if(e.target.closest?.('.node'))return;drag={pan:true,sx:e.clientX,sy:e.clientY,ox:pan.x,oy:pan.y};svg.setPointerCapture(e.pointerId);svg.classList.add('panning')});svg.addEventListener('pointermove',e=>{if(!drag)return;if(drag.pan){pan.x=drag.ox+e.clientX-drag.sx;pan.y=drag.oy+e.clientY-drag.sy;update()}else{drag.node.x=drag.ox+(e.clientX-drag.sx)/scale;drag.node.y=drag.oy+(e.clientY-drag.sy)/scale;nodeLayer.querySelector(`[data-id="${CSS.escape(drag.node.id)}"]`)?.setAttribute('transform',`translate(${drag.node.x} ${drag.node.y})`);refreshEdges(drag.node.id)}});svg.addEventListener('pointerup',()=>{drag=null;svg.classList.remove('panning')});svg.addEventListener('wheel',e=>{e.preventDefault();const r=svg.getBoundingClientRect(),sx=e.clientX-r.left,sy=e.clientY-r.top,old=scale;scale=Math.max(.35,Math.min(2.4,scale*Math.exp(-e.deltaY*.0012)));pan.x=sx-(sx-pan.x)*(scale/old);pan.y=sy-(sy-pan.y)*(scale/old);update()},{passive:false});document.querySelector('#search').oninput=applyFilter;document.querySelector('#fit').onclick=fit;document.querySelector('#reset').onclick=()=>{activeType='all';document.querySelector('#search').value='';document.querySelectorAll('.type').forEach(x=>x.classList.toggle('on',x.dataset.type==='all'));applyFilter();fit()};const box=document.querySelector('#types');[['all',{label:'全部语义层',color:'#98a6ff'}],...Object.entries(typeConfig).filter(([k])=>groups[k]?.length)].forEach(([k,c])=>{const b=document.createElement('button');b.className='type '+(k==='all'?'on':'');b.dataset.type=k;b.innerHTML=`<i class="dot" style="color:${c.color};background:${c.color}"></i><span>${esc(c.label)}</span><span class="count">${k==='all'?nodes.length:groups[k].length}</span>`;b.onclick=()=>{activeType=k;document.querySelectorAll('.type').forEach(x=>x.classList.toggle('on',x===b));applyFilter()};box.append(b)});document.querySelector('#warnings').innerHTML=(graph.warnings||[]).map(x=>`<div class="warn">⚠ ${esc(x)}</div>`).join('')||'未发现结构性警告。';document.querySelector('#summary').textContent=graph.research_question||graph.summary||'保留来源与关系，按语义层展开审阅。';document.querySelector('#nodeCount').textContent=nodes.length;document.querySelector('#edgeCount').textContent=graph.edges.length;fit();
</script></body></html>'''
    rendered = template.replace("__TITLE__", title).replace("__SUBTITLE__", html.escape(graph.get("research_question") or graph.get("summary") or "可追溯的科研语义网络")).replace("__DATA__", data).replace("__TYPES__", types)
    # The generated graph is deliberately standalone.  These interaction
    # refinements are appended after the base renderer so they also work in
    # Obsidian's embedded WebView, where SVG click bubbling can differ from a
    # normal browser tab.  Saved positions are presentation preferences only:
    # they never modify the graph JSON, evidence, or canonical graph files.
    interaction = r'''<style>.halo{opacity:.12}.core{stroke:rgba(235,240,255,.38);stroke-width:.85}</style><script>
(()=>{
  const layoutKey='zrl-kg-layout:'+location.pathname;
  const nodeElement=(target)=>{ for(let el=target;el&&el!==svg;el=el.parentNode){ if(el.classList&&el.classList.contains('node')) return el; } return null; };
  const saveLayout=()=>{ try { localStorage.setItem(layoutKey,JSON.stringify(Object.fromEntries(nodes.map(n=>[n.id,{x:n.x,y:n.y}])))); } catch (_) {} };
  const restoreLayout=()=>{ try { return JSON.parse(localStorage.getItem(layoutKey)||'{}'); } catch (_) { return {}; } };
  const saved=restoreLayout(); let changed=false;
  nodes.forEach(n=>{ const p=saved[n.id]; if(Number.isFinite(p?.x)&&Number.isFinite(p?.y)){ n.x=p.x;n.y=p.y;changed=true; nodeLayer.querySelector(`[data-id="${CSS.escape(n.id)}"]`)?.setAttribute('transform',`translate(${n.x} ${n.y})`); } });
  if(changed){ refreshEdges(); fit(); }
  let gesture=null;
  document.addEventListener('pointerdown',(event)=>{
    const el=nodeElement(event.target); if(!el) return;
    const node=byId.get(el.dataset.id); if(!node) return;
    event.preventDefault(); event.stopPropagation();
    gesture={node,el,sx:event.clientX,sy:event.clientY,ox:node.x,oy:node.y,moved:false};
    svg.setPointerCapture?.(event.pointerId);
  },true);
  document.addEventListener('pointermove',(event)=>{
    if(!gesture) return;
    const dx=event.clientX-gesture.sx,dy=event.clientY-gesture.sy;
    if(Math.abs(dx)>3||Math.abs(dy)>3) gesture.moved=true;
    if(!gesture.moved) return;
    event.preventDefault(); event.stopPropagation();
    gesture.node.x=gesture.ox+dx/scale; gesture.node.y=gesture.oy+dy/scale;
    gesture.el.setAttribute('transform',`translate(${gesture.node.x} ${gesture.node.y})`); refreshEdges(gesture.node.id);
  },true);
  document.addEventListener('pointerup',(event)=>{
    if(!gesture) return;
    const done=gesture; gesture=null; event.preventDefault(); event.stopPropagation();
    if(done.moved) saveLayout(); else inspect(done.node);
  },true);
  document.addEventListener('click',(event)=>{ const el=nodeElement(event.target); if(el){ event.preventDefault(); event.stopPropagation(); inspect(byId.get(el.dataset.id)); } },true);
})();
</script>'''
    return rendered.replace("</body>", interaction + "</body>")


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    payload = load_input(sys.argv[2] if len(sys.argv) > 2 else "")
    cards, skipped = read_scoped_cards(root, payload)
    raw = payload.get("graph") if isinstance(payload.get("graph"), dict) else fallback_graph(cards, payload)
    graph, warnings = normalize_graph(raw, cards, skipped)

    # --dry-run (also settable via payload["dry_run"]): run the exact same
    # normalize_graph() -- including quote_verify.py's verification -- but
    # never touch disk. Used by the graph review UI to show a researcher the
    # real review_status/warnings a publish would produce, before anything
    # is written. Default is False; existing callers are unaffected.
    dry_run = "--dry-run" in sys.argv[1:] or bool(payload.get("dry_run"))
    if dry_run:
        print(json.dumps({"skill": "zrl-knowledge-graph", "dry_run": True, "graph": graph, "nodes": len(graph["nodes"]), "edges": len(graph["edges"]), "cards": len(cards), "warnings": warnings, "semantic": True, "self_contained": True}, ensure_ascii=False, indent=2))
        return 0

    # Optional versioned output directory (payload["output_subdir"], e.g.
    # "knowledge-graph/runs/<run-id>"): when absent, behavior is byte-for-byte
    # identical to before this change -- write to the single canonical
    # <root>/knowledge-graph/ location. Only an explicit, non-empty
    # output_subdir redirects the write, so no existing caller is affected.
    subdir = str(payload.get("output_subdir") or "").strip().replace("\\", "/")
    out = (root / subdir) if subdir else (root / "knowledge-graph")
    out.mkdir(parents=True, exist_ok=True)
    json_target = out / "knowledge_graph.json"
    html_target = out / "knowledge_graph.html"
    report_target = out / "knowledge_graph-report.md"
    json_target.write_text(json.dumps(graph, ensure_ascii=False, indent=2), encoding="utf-8")
    html_target.write_text(render_html(graph), encoding="utf-8")
    report = [f"# {graph['title']}", "", f"- 实体：{len(graph['nodes'])}", f"- 关系：{len(graph['edges'])}", f"- 来源证据卡片：{len(cards)}", f"- 推断/待审关系：{sum(1 for edge in graph['edges'] if edge['review_status'] == 'inferred')}", "", "## 质量警告", ""] + ([f"- {item}" for item in warnings] or ["- 无结构性警告"]) + ["", "## 说明", "", "HTML 为离线自包含交互图；点击实体可审阅关系来源。推断关系不得作为已确认事实引用。"]
    report_target.write_text("\n".join(report) + "\n", encoding="utf-8")
    rel = lambda p: str(p.relative_to(root)).replace("\\", "/")
    print(json.dumps({"skill": "zrl-knowledge-graph", "html": rel(html_target), "graph": rel(json_target), "report": rel(report_target), "nodes": len(graph["nodes"]), "edges": len(graph["edges"]), "cards": len(cards), "warnings": warnings, "semantic": True, "self_contained": True}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
