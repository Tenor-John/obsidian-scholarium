#!/usr/bin/env python3
"""
merge_and_build_graph.py — Research Weaver Phase 4–5

Collects per-sub-topic weave-bundle JSON files, deduplicates papers,
builds a research network graph, and outputs:
  1. Canvases/research-network.canvas (Obsidian JSON Canvas)
  2. Research/research-network-summary.md (human-readable)
"""
from __future__ import annotations

import json, re, sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


SAFE_RE = re.compile(r"[^a-zA-Z0-9_\-.]+")


def safe_node_id(text: str) -> str:
    return SAFE_RE.sub("_", text.strip())[:80]


def doi_key(doi: str | None) -> str:
    if not doi:
        return ""
    return doi.strip().lower().removeprefix("https://doi.org/").removeprefix("http://doi.org/")


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()

    # ── Load topic profile and divergence tree ──
    topic_profile = {}
    tp_path = root / "Research" / "topic-profile.json"
    if tp_path.exists():
        try:
            topic_profile = json.loads(tp_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    divergence_tree = {}
    dt_path = root / "Research" / "divergence-tree.json"
    if dt_path.exists():
        try:
            divergence_tree = json.loads(dt_path.read_text(encoding="utf-8"))
        except Exception:
            pass

    # ── Load all weave bundles ──
    bundles_dir = root / "Research" / "weave-bundles"
    bundles = []
    if bundles_dir.exists():
        for fpath in sorted(bundles_dir.glob("*.json")):
            try:
                bundles.append(json.loads(fpath.read_text(encoding="utf-8")))
            except Exception:
                continue

    if not bundles:
        print(json.dumps({"error": "no weave bundles found", "hint": str(bundles_dir)}))
        return 1

    # ── Deduplicate papers across bundles ──
    seen_dois: dict[str, dict] = {}  # doi_key -> {title, year, venue, ...}
    paper_to_axes: dict[str, list[str]] = defaultdict(list)  # doi_key -> [axis names]
    axis_papers: dict[str, list[str]] = defaultdict(list)     # axis -> [doi_keys]

    for bundle in bundles:
        axis = bundle.get("axis", "unknown")
        node_id = bundle.get("node_id", "")
        title = bundle.get("title", node_id)
        for paper in bundle.get("papers", []):
            dk = doi_key(paper.get("doi"))
            if not dk:
                continue
            if dk not in seen_dois:
                seen_dois[dk] = {
                    "doi": paper.get("doi", ""),
                    "title": paper.get("title", ""),
                    "year": paper.get("year"),
                    "venue": paper.get("venue", ""),
                    "cited_by_count": paper.get("cited_by_count", 0),
                }
            paper_to_axes[dk].append(axis)
            if dk not in axis_papers[axis]:
                axis_papers[axis].append(dk)

    # ── Build Canvas nodes and edges ──
    nodes: list[dict] = []
    edges: list[dict] = []
    x, y = 0, 0
    col_width = 520
    row_height = 280

    # Seed topic center node
    seed_label = topic_profile.get("seed_topic", divergence_tree.get("seed_topic", "Research Topic"))
    nodes.append({
        "id": "seed-topic",
        "type": "text",
        "x": 300, "y": 0,
        "width": 460, "height": 160,
        "text": f"# {seed_label}\n## Seed Topic\n{len(bundles)} sub-topics · {len(seen_dois)} unique papers · {len(axis_papers)} axes",
        "color": "5"
    })

    # Axis column nodes (one per axis, left side)
    axis_names = ["material", "synthesis", "mechanism", "characterization",
                  "theory", "performance", "analogy", "application"]
    axis_colors = {"material": "1", "synthesis": "1", "mechanism": "2",
                   "characterization": "3", "theory": "4", "performance": "2",
                   "analogy": "4", "application": "6"}
    axis_positions: dict[str, tuple[int, int]] = {}
    for i, axis in enumerate(axis_names):
        count = len(axis_papers.get(axis, []))
        if count == 0:
            continue
        ax = 20
        ay = 240 + i * row_height
        axis_positions[axis] = (ax, ay)
        nodes.append({
            "id": f"axis-{axis}",
            "type": "text",
            "x": ax, "y": ay,
            "width": 260, "height": 120,
            "text": f"## {axis.title()}\n{count} papers",
            "color": axis_colors.get(axis, "4")
        })
        edges.append({
            "id": f"seed-to-axis-{axis}",
            "fromNode": "seed-topic",
            "toNode": f"axis-{axis}",
            "label": ""
        })

    # Sub-topic nodes (from bundles)
    for i, bundle in enumerate(bundles):
        node_id = bundle.get("node_id", f"subtopic-{i}")
        axis = bundle.get("axis", "unknown")
        title = bundle.get("title", node_id)
        papers_count = len(bundle.get("papers", []))
        evidence = bundle.get("evidence_level", "L0")
        summary = bundle.get("summary", "")[:200]

        if axis in axis_positions:
            sx = axis_positions[axis][0] + 320
            sy = axis_positions[axis][1]
        else:
            sx = 600
            sy = 240 + i * row_height

        label = f"## {title}\n{papers_count} papers · {evidence}\n{summary}"
        nodes.append({
            "id": node_id,
            "type": "text",
            "x": sx, "y": sy,
            "width": 440, "height": 180,
            "text": label,
            "color": axis_colors.get(axis, "4")
        })
        edges.append({
            "id": f"axis-{axis}-to-{node_id}",
            "fromNode": f"axis-{axis}",
            "toNode": node_id,
            "label": evidence
        })

        # Paper nodes (top 5 per sub-topic)
        for j, paper in enumerate(bundle.get("papers", [])[:5]):
            pid = f"paper-{doi_key(paper.get('doi'))[:40]}" if paper.get("doi") else f"paper-{node_id}-{j}"
            existing = [n for n in nodes if n["id"] == pid]
            if existing:
                edges.append({
                    "id": f"{node_id}-to-{pid}",
                    "fromNode": node_id,
                    "toNode": pid,
                    "label": "also appears in other sub-topics"
                })
                continue
            py = sy + 200 + j * 100
            ptitle = (paper.get("title") or "Untitled")[:120]
            pvenue = paper.get("venue") or ""
            pyear = paper.get("year") or ""
            nodes.append({
                "id": pid,
                "type": "text",
                "x": sx + 30, "y": py,
                "width": 380, "height": 80,
                "text": f"**{ptitle}**\n{pvenue} ({pyear}) · cited {paper.get('cited_by_count', 0)}×"
            })
            edges.append({
                "id": f"{node_id}-paper-{pid}",
                "fromNode": node_id,
                "toNode": pid,
                "label": "found in search"
            })

    # Cross-axis connections: papers that appear in multiple axes
    for dk, axes in paper_to_axes.items():
        if len(axes) < 2:
            continue
        unique_axes = list(dict.fromkeys(axes))
        for a1, a2 in zip(unique_axes, unique_axes[1:]):
            edges.append({
                "id": f"cross-{dk[:30]}-{a1}-{a2}",
                "fromNode": f"axis-{a1}",
                "toNode": f"axis-{a2}",
                "label": f"shared paper\n{seen_dois[dk]['title'][:50]}"
            })

    # Write canvas
    canvas_dir = root / "Canvases"
    canvas_dir.mkdir(parents=True, exist_ok=True)
    canvas_path = canvas_dir / "research-network.canvas"
    canvas_path.write_text(
        json.dumps({"nodes": nodes, "edges": edges}, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )

    # ── Build Markdown summary ──
    md_lines = [
        f"# Research Network: {seed_label}",
        "",
        f"> Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')} UTC",
        f"> {len(bundles)} sub-topics · {len(seen_dois)} unique papers · {len(axis_papers)} axes",
        "",
        "## Topic Profile",
        "",
    ]
    if topic_profile:
        for k, v in topic_profile.items():
            if k.startswith("_"):
                continue
            md_lines.append(f"- **{k}**: {v}")
    else:
        md_lines.append("_(no topic profile found)_")

    md_lines.append("")
    md_lines.append("## Axis Overview")
    md_lines.append("")
    md_lines.append("| Axis | Sub-topics | Papers | Unique Papers | Cross-axis Links |")
    md_lines.append("|---|---:|---:|---:|")
    for axis in axis_names:
        count = len(axis_papers.get(axis, []))
        if count == 0:
            continue
        axis_bundles = [b for b in bundles if b.get("axis") == axis]
        unique = len(set(axis_papers.get(axis, [])))
        cross_count = sum(
            1 for dk in axis_papers.get(axis, [])
            if len(paper_to_axes.get(dk, [])) > 1
        )
        md_lines.append(f"| {axis.title()} | {len(axis_bundles)} | {count} | {unique} | {cross_count} |")

    md_lines.append("")
    md_lines.append("## Sub-topics by Axis")
    md_lines.append("")
    for axis in axis_names:
        axis_bundles = [b for b in bundles if b.get("axis") == axis]
        if not axis_bundles:
            continue
        md_lines.append(f"### {axis.title()} Axis")
        md_lines.append("")
        for bundle in axis_bundles:
            title = bundle.get("title", bundle.get("node_id", ""))
            evidence = bundle.get("evidence_level", "L0")
            summary = bundle.get("summary", "")
            papers = bundle.get("papers", [])
            md_lines.append(f"#### {title}  `{evidence}`")
            if summary:
                md_lines.append(f"> {summary[:300]}")
            md_lines.append("")
            if papers:
                md_lines.append("| # | Title | Venue | Year | Citations |")
                md_lines.append("|:---:|---|---:|---:|")
                for j, p in enumerate(papers[:5], 1):
                    ptitle = (p.get("title") or "N/A")[:80]
                    pvenue = p.get("venue") or ""
                    pyear = p.get("year") or ""
                    pcited = p.get("cited_by_count", 0)
                    md_lines.append(f"| {j} | {ptitle} | {pvenue} | {pyear} | {pcited} |")
                md_lines.append("")
            else:
                md_lines.append("_(no direct papers found in this search)_")
                md_lines.append("")

    # Cross-axis connections section
    md_lines.append("## Cross-Axis Connections")
    md_lines.append("")
    cross_connections: dict[tuple[str, str], list[str]] = defaultdict(list)
    for dk, axes in paper_to_axes.items():
        unique_axes = list(dict.fromkeys(axes))
        if len(unique_axes) < 2:
            continue
        for a1, a2 in zip(unique_axes, unique_axes[1:]):
            key = tuple(sorted([a1, a2]))
            p = seen_dois[dk]
            cross_connections[key].append(f"{p['title'][:80]} ({p.get('year', '')})")

    if cross_connections:
        md_lines.append("Papers that bridge multiple axes:")
        md_lines.append("")
        md_lines.append("| Axis Pair | Bridging Papers |")
        md_lines.append("|---|---|")
        for (a1, a2), titles in sorted(cross_connections.items()):
            md_lines.append(f"| {a1.title()} ↔ {a2.title()} | {', '.join(titles[:3])} |")
    else:
        md_lines.append("_(no cross-axis connections found)_")

    # Suggested next steps
    md_lines.append("")
    md_lines.append("## Suggested Next Steps")
    md_lines.append("")
    # Find axes with fewest papers
    weak_axes = sorted(
        [(a, len(axis_papers.get(a, []))) for a in axis_names if len(axis_papers.get(a, [])) > 0],
        key=lambda x: x[1]
    )
    for axis, count in weak_axes[:3]:
        if count < 10:
            md_lines.append(f"- **{axis.title()} axis** has only {count} papers — consider a deeper dedicated search")
    # Find L0/L1 sub-topics
    l0_topics = [b for b in bundles if b.get("evidence_level") in ("L0", "L1")]
    if l0_topics:
        md_lines.append(f"- **{len(l0_topics)} sub-topics** at L0/L1 evidence level — may indicate genuinely underexplored directions (or need better search queries)")
    md_lines.append(f"- Download top-candidate PDFs via `scansci-institutional` or `paper-downloader`")
    md_lines.append(f"- Run `nature-reader` on key PDFs to generate evidence cards")
    md_lines.append(f"- Open `Canvases/research-network.canvas` in Obsidian to explore the graph interactively")

    # Write markdown
    research_dir = root / "Research"
    research_dir.mkdir(parents=True, exist_ok=True)
    md_path = research_dir / "research-network-summary.md"
    md_path.write_text("\n".join(md_lines), encoding="utf-8")

    # ── Output ──
    result = {
        "skill": "research-weaver",
        "phase": "merge-and-build",
        "canvas": str(canvas_path.relative_to(root)).replace("\\", "/"),
        "summary_md": str(md_path.relative_to(root)).replace("\\", "/"),
        "nodes": len(nodes),
        "edges": len(edges),
        "bundles": len(bundles),
        "unique_papers": len(seen_dois),
        "axes_covered": len(axis_papers),
        "cross_axis_connections": len(cross_connections),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
