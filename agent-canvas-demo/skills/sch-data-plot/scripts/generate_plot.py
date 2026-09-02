#!/usr/bin/env python3
"""Bounded, dependency-free CSV/TSV -> SVG renderer for Scholarium.

The runner deliberately accepts a small schema and derives its only output
directory from the source bytes. It is not an AI-code executor.
"""
from __future__ import annotations

import csv
import hashlib
import html
import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


def load_input(value: str) -> dict:
    if not value:
        return {}
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        candidate = Path(value)
        if candidate.exists():
            return json.loads(candidate.read_text(encoding="utf-8"))
    raise ValueError("input must be JSON or a path to JSON")


def safe_source(root: Path, value: str) -> Path:
    if not value:
        raise ValueError("data_path is required")
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = root / candidate
    target = candidate.resolve()
    if root not in target.parents or not target.is_file():
        raise ValueError("data_path must be an existing file inside the authorized workspace")
    if target.suffix.lower() not in {".csv", ".tsv"}:
        raise ValueError("only CSV and TSV files are supported for deterministic plotting")
    return target


def decode_dataset(raw: bytes) -> tuple[str, str]:
    """Decode common lab-export encodings without silently replacing bytes."""
    for encoding, label in (("utf-8-sig", "UTF-8"), ("utf-8", "UTF-8"), ("gb18030", "GB18030"), ("gbk", "GBK")):
        try:
            return raw.decode(encoding), label
        except UnicodeDecodeError:
            continue
    raise ValueError("dataset encoding is unsupported; save the CSV/TSV as UTF-8, GB18030, or GBK")


def numeric(value: object) -> float | None:
    text = str(value or "").strip().replace(",", "")
    if text.endswith("%"):
        text = text[:-1]
    try:
        result = float(text)
    except ValueError:
        return None
    return result if math.isfinite(result) else None


def slug(value: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip(".-")
    return (clean or "dataset")[:60]


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def text_units(value: object) -> float:
    """Approximate rendered em units (CJK is full width, Latin is narrower)."""
    total = 0.0
    for char in str(value):
        if char.isspace():
            total += 0.34
        elif ord(char) > 0x2FF:
            total += 1.0
        elif char in "MW@%#":
            total += 0.82
        elif char in "il.,:;|'!":
            total += 0.3
        else:
            total += 0.58
    return total


def text_width(value: object, font_size: float) -> float:
    return text_units(value) * float(font_size)


def wrap_text(value: object, max_width: float, font_size: float, max_lines: int = 3) -> list[str]:
    """Deterministically wrap mixed CJK/Latin SVG text and bound its height."""
    source = str(value).strip()
    if not source:
        return [""]
    lines: list[str] = []
    current = ""
    truncated = False
    for index, char in enumerate(source):
        candidate = current + char
        if current and text_width(candidate, font_size) > max_width:
            lines.append(current.rstrip())
            current = char.lstrip()
            if len(lines) == max_lines:
                truncated = index < len(source)
                break
        else:
            current = candidate
    if len(lines) < max_lines and current:
        lines.append(current.rstrip())
    if truncated and lines:
        tail = lines[-1].rstrip("… ")
        while tail and text_width(tail + "…", font_size) > max_width:
            tail = tail[:-1]
        lines[-1] = tail + "…"
    return lines or [source]


def svg_multiline(lines: list[str], x: float, y: float, font_size: float, anchor: str = "start", weight: str | None = None, css_class: str | None = None) -> str:
    attrs = [f'x="{x:.2f}"', f'y="{y:.2f}"', f'font-size="{font_size:g}"', f'text-anchor="{anchor}"']
    if weight:
        attrs.append(f'font-weight="{weight}"')
    if css_class:
        attrs.append(f'class="{css_class}"')
    line_height = font_size * 1.22
    spans = []
    for index, line in enumerate(lines):
        location = f'y="{y:.2f}"' if index == 0 else f'dy="{line_height:.2f}"'
        spans.append(f'<tspan x="{x:.2f}" {location}>{esc(line)}</tspan>')
    return f'<text {" ".join(attrs)}>{"".join(spans)}</text>'


def pack_legend(labels: list[str], available_width: float, font_size: float) -> list[list[tuple[float, float]]]:
    """Return rows of (x-offset, item-width), wrapping before items collide."""
    rows: list[list[tuple[float, float]]] = [[]]
    cursor = 0.0
    for label in labels:
        item_width = min(available_width, 20 + text_width(label, min(15, font_size)) + 30)
        if rows[-1] and cursor + item_width > available_width:
            rows.append([])
            cursor = 0.0
        rows[-1].append((cursor, item_width))
        cursor += item_width
    return rows


CHART_THEMES = {
    # The default is deliberately conservative for manuscripts: white paper,
    # dark text, muted grid, and a colour-blind-friendly palette.
    "publication": {
        "label": "科研出版",
        "background": "#ffffff", "ink": "#172033", "muted": "#526171",
        "grid": "#dbe3ec", "axis": "#64748b",
        "palette": ["#2563eb", "#d9485f", "#008c72", "#7856c8", "#c57300", "#007c91"],
    },
    "soft": {
        "label": "柔和展示",
        "background": "#f8fafc", "ink": "#1e293b", "muted": "#64748b",
        "grid": "#d9e2ec", "axis": "#7b8794",
        "palette": ["#3b82f6", "#ec4899", "#14b8a6", "#8b5cf6", "#f59e0b", "#06b6d4"],
    },
    "dark": {
        "label": "深色演示",
        "background": "#101827", "ink": "#f1f5f9", "muted": "#cbd5e1",
        "grid": "#334155", "axis": "#94a3b8",
        "palette": ["#60a5fa", "#fb7185", "#2dd4bf", "#a78bfa", "#fbbf24", "#22d3ee"],
    },
}


def clamp_float(value: object, default: float, lo: float, hi: float) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(result):
        return default
    return min(hi, max(lo, result))


def view_range(raw_range: object) -> list[float] | None:
    """Parse a [min, max] view window; invalid input falls back to None."""
    if isinstance(raw_range, (list, tuple)) and len(raw_range) == 2:
        try:
            lo, hi = float(raw_range[0]), float(raw_range[1])
            if math.isfinite(lo) and math.isfinite(hi) and lo < hi:
                return [lo, hi]
        except (TypeError, ValueError):
            return None
    return None


def chart_style(value: object) -> dict:
    """Return a bounded, explicit visual-only recipe.

    These options never transform, smooth, exclude, or otherwise alter a
    measurement. x_range/y_range are view zooms (points outside the window are
    not drawn, never deleted); annotations are visual overlay lines/labels;
    fig_size, spines, fonts, labels, legend, marker/line styles are pure
    presentation. Data processing such as baseline correction is deliberately
    out of scope here: it must produce derived data with its own processing
    record instead. Keeping that distinction in the persisted manifest makes a
    future "edit chart" run reproducible rather than a destructive SVG edit.
    """
    incoming = value if isinstance(value, dict) else {}
    theme_id = str(incoming.get("theme") or "publication").lower()
    if theme_id not in CHART_THEMES:
        theme_id = "publication"
    markers = str(incoming.get("markers") or incoming.get("marker_mode") or "auto").lower()
    if markers not in {"auto", "all", "none"}:
        markers = "auto"
    try:
        line_width = float(incoming.get("line_width", 2.6))
    except (TypeError, ValueError):
        line_width = 2.6
    x_range = view_range(incoming.get("x_range"))
    y_range = view_range(incoming.get("y_range"))
    fig_size = [1200, 760]
    raw_size = incoming.get("fig_size")
    if isinstance(raw_size, (list, tuple)) and len(raw_size) == 2:
        fig_size = [
            int(clamp_float(raw_size[0], 1200, 400, 2400)),
            int(clamp_float(raw_size[1], 760, 300, 1800)),
        ]
    spines = {"top": False, "right": False, "left": True, "bottom": True}
    raw_spines = incoming.get("spines")
    if isinstance(raw_spines, dict):
        for side in spines:
            if side in raw_spines:
                spines[side] = bool(raw_spines[side])
    legend = str(incoming.get("legend") or "bottom").lower()
    if legend not in {"bottom", "right", "none"}:
        legend = "bottom"
    line_style = str(incoming.get("line_style") or "solid").lower()
    if line_style not in {"solid", "dashed", "dotted"}:
        line_style = "solid"
    x_label = str(incoming.get("x_label") or "").strip()[:60] or None
    y_label = str(incoming.get("y_label") or "").strip()[:60] or None
    annotations = []
    raw_annotations = incoming.get("annotations")
    if isinstance(raw_annotations, list):
        for entry in raw_annotations[:8]:  # bounded: at most 8 overlay lines
            if not isinstance(entry, dict):
                continue
            kind = str(entry.get("type") or "").lower()
            if kind not in {"hline", "vline"}:
                continue
            try:
                position = float(entry.get("value"))
            except (TypeError, ValueError):
                continue
            if not math.isfinite(position):
                continue
            label = str(entry.get("label") or "").strip()[:60]
            annotations.append({"type": kind, "value": position, "label": label})
    series_colors: dict[str, str] = {}
    raw_colors = incoming.get("series_colors")
    if isinstance(raw_colors, dict):
        for column, color in list(raw_colors.items())[:12]:
            text = str(color or "").strip()
            if re.fullmatch(r"#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?", text):
                series_colors[str(column)] = text.lower()
    return {
        "theme": theme_id,
        "markers": markers,
        "show_grid": bool(incoming.get("show_grid", True)),
        "line_width": round(min(6.0, max(1.0, line_width)), 1),
        "x_range": x_range,
        "annotations": annotations,
        "series_colors": series_colors,
        "fig_size": fig_size,
        "spines": spines,
        "border_width": round(clamp_float(incoming.get("border_width"), 1.5, 0.5, 4.0), 1),
        "title_size": round(clamp_float(incoming.get("title_size"), 28, 10, 40), 1),
        "label_size": round(clamp_float(incoming.get("label_size"), 16, 8, 24), 1),
        "tick_size": round(clamp_float(incoming.get("tick_size"), 14, 6, 20), 1),
        "x_label": x_label,
        "y_label": y_label,
        "y_range": y_range,
        "legend": legend,
        "marker_size": round(clamp_float(incoming.get("marker_size"), 3.6, 1.0, 10.0), 1),
        "line_style": line_style,
        "tick_count": int(clamp_float(incoming.get("tick_count"), 6, 3, 10)),
    }


def svg_chart(rows: list[dict[str, str]], x_key: str, y_keys: list[str], kind: str, title: str, style: dict) -> tuple[str, dict]:
    points: list[tuple[float, list[float | None]]] = []
    for index, row in enumerate(rows):
        x = numeric(row.get(x_key))
        if x is None:
            x = float(index + 1)
        values = [numeric(row.get(key)) for key in y_keys]
        if any(value is not None for value in values):
            points.append((x, values))
    if len(points) < 2:
        raise ValueError("the selected fields do not contain at least two numeric rows")
    # x_range is a view zoom: it clips the window, never the underlying data.
    view = style.get("x_range")
    if view:
        points = [point for point in points if view[0] <= point[0] <= view[1]]
        if len(points) < 2:
            raise ValueError("x_range 视图区间内不足两个数据点；请放宽区间或重置缩放")
    xs = [point[0] for point in points]
    ys = [value for _, values in points for value in values if value is not None]
    if not ys:
        raise ValueError("selected y columns contain no numeric values")
    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)
    if xmin == xmax: xmax = xmin + 1
    if ymin == ymax: ymax = ymin + 1
    # Horizontal annotations (e.g. a y=0 baseline) stay visible even when the
    # data itself never crosses them.
    for note in style.get("annotations", []):
        if note["type"] == "hline":
            ymin, ymax = min(ymin, note["value"]), max(ymax, note["value"])
    # y_range is a view zoom like x_range: an explicit window replaces the
    # auto-padded data extent; drawing is clipped, measurements are untouched.
    view_y = style.get("y_range")
    if view_y:
        ymin, ymax = view_y[0], view_y[1]
    else:
        pad = (ymax - ymin) * 0.08
        ymin, ymax = ymin - pad, ymax + pad
    width, height = style["fig_size"]
    scale = max(0.45, min(width / 1200, height / 760))
    legend = style["legend"]
    title_size = style["title_size"]
    label_size = style["label_size"]
    tick_size = style["tick_size"]
    requested_tick_count = style["tick_count"]
    marker_r = style["marker_size"]
    dash = {"solid": None, "dashed": "9 6", "dotted": "2 5"}[style["line_style"]]
    # Margins are derived from actual label lengths. This is intentionally
    # deterministic: the Agent may request sizes, but cannot accidentally make
    # a long title/legend overwrite the plot or another label.
    tick_gap = tick_size + 14
    y_tick_examples = [f"{(ymin + (ymax-ymin)*i/max(1, requested_tick_count-1)):.4g}" for i in range(requested_tick_count)]
    left = max(56, max(text_width(value, tick_size) for value in y_tick_examples) + label_size + 34)
    right = max(28, 52 * scale)
    if legend == "right":
        right = max(right, max(text_width(key, label_size) for key in y_keys) + 74)
    preliminary_width = max(80, width - left - right)
    title_lines = wrap_text(title, preliminary_width, title_size, 3)
    title_line_height = title_size * 1.22
    top = max(44, 18 + len(title_lines) * title_line_height + 18)
    x_axis_raw = style["x_label"] or x_key
    y_axis_raw = style["y_label"] or ", ".join(y_keys)
    x_label_lines = wrap_text(x_axis_raw, preliminary_width, label_size, 2)
    x_label_height = len(x_label_lines) * label_size * 1.22
    legend_rows = pack_legend(y_keys, preliminary_width, label_size) if legend == "bottom" else []
    legend_row_height = label_size + 12
    legend_h = len(legend_rows) * legend_row_height if legend_rows else 0
    bottom = max(54, tick_gap + legend_h + x_label_height + 20)
    pw, ph = width - left - right, height - top - bottom
    if pw < 60 or ph < 60:
        raise ValueError("fig_size 太小，绘图区不足 60×60 px；请增大画布尺寸")
    x_tick_examples = [f"{(xmin + (xmax-xmin)*i/max(1, requested_tick_count-1)):.4g}" for i in range(requested_tick_count)]
    widest_x_tick = max(text_width(value, tick_size) for value in x_tick_examples)
    tick_count = min(requested_tick_count, max(3, int(pw / max(34, widest_x_tick + 16)) + 1))
    sx = lambda value: left + (value - xmin) / (xmax - xmin) * pw
    sy = lambda value: top + (ymax - value) / (ymax - ymin) * ph
    theme = CHART_THEMES[style["theme"]]
    colors = theme["palette"]
    spines = style["spines"]
    border_w = style["border_width"]
    draw_markers = style["markers"] == "all" or (style["markers"] == "auto" and len(points) <= 80)
    y_axis_label = esc(y_axis_raw)
    tick_font = f"{tick_size:g}"
    pieces = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{esc(title)}">',
        f'<rect width="100%" height="100%" fill="{theme["background"]}"/>',
        f'<style>text{{font-family:Arial,"Microsoft YaHei",sans-serif;fill:{theme["ink"]}}} .muted{{fill:{theme["muted"]}}} .grid{{stroke:{theme["grid"]};stroke-width:1}} .axis{{stroke:{theme["axis"]};stroke-width:{border_w:g}}}</style>',
        f'<clipPath id="plot-clip"><rect x="{left:.2f}" y="{top:.2f}" width="{pw:.2f}" height="{ph:.2f}"/></clipPath>',
        svg_multiline(title_lines, left, max(title_size + 6, 28), title_size, "start", "700"),
    ]
    for tick in range(tick_count):
        value = ymin + (ymax - ymin) * tick / (tick_count - 1)
        y = sy(value)
        if style["show_grid"]:
            pieces.append(f'<line class="grid" x1="{left}" x2="{width-right}" y1="{y:.2f}" y2="{y:.2f}"/>')
        pieces.append(f'<text class="muted" x="{left-14}" y="{y+tick_size*0.35:.2f}" font-size="{tick_font}" text-anchor="end">{value:.4g}</text>')
    for tick in range(tick_count):
        value = xmin + (xmax - xmin) * tick / (tick_count - 1)
        x = sx(value)
        if style["show_grid"]:
            pieces.append(f'<line class="grid" x1="{x:.2f}" x2="{x:.2f}" y1="{top}" y2="{height-bottom}"/>')
        pieces.append(f'<text class="muted" x="{x:.2f}" y="{height-bottom+tick_size+14:.2f}" font-size="{tick_font}" text-anchor="middle">{value:.4g}</text>')
    # Axis spines: each enabled side of the plot frame, including a full border box.
    if spines["left"]:
        pieces.append(f'<line class="axis" x1="{left}" x2="{left}" y1="{top}" y2="{height-bottom}"/>')
    if spines["bottom"]:
        pieces.append(f'<line class="axis" x1="{left}" x2="{width-right}" y1="{height-bottom}" y2="{height-bottom}"/>')
    if spines["top"]:
        pieces.append(f'<line class="axis" x1="{left}" x2="{width-right}" y1="{top}" y2="{top}"/>')
    if spines["right"]:
        pieces.append(f'<line class="axis" x1="{width-right}" x2="{width-right}" y1="{top}" y2="{height-bottom}"/>')
    x_label_y = height - 10 - max(0, len(x_label_lines) - 1) * label_size * 1.22
    pieces.append(svg_multiline(x_label_lines, left + pw / 2, x_label_y, label_size, "middle"))
    y_axis_x = max(14, 24 * scale)
    y_fit = f' textLength="{max(20, ph-10):.2f}" lengthAdjust="spacingAndGlyphs"' if text_width(y_axis_raw, label_size) > ph - 10 else ""
    pieces.append(f'<text x="{y_axis_x:.2f}" y="{top+ph/2:.2f}" font-size="{label_size:g}" text-anchor="middle" transform="rotate(-90 {y_axis_x:.2f} {top+ph/2:.2f})"{y_fit}>{y_axis_label}</text>')
    # Visual overlay annotations (never derived from or applied to the data).
    overrides = style.get("series_colors", {})
    for note in style.get("annotations", []):
        if note["type"] == "hline" and ymin <= note["value"] <= ymax:
            ay = sy(note["value"])
            pieces.append(f'<line class="annotation" x1="{left}" x2="{width-right}" y1="{ay:.2f}" y2="{ay:.2f}" stroke="{theme["muted"]}" stroke-width="1.2" stroke-dasharray="7 5"/>')
            if note["label"]:
                pieces.append(f'<text class="muted" x="{width-right-8}" y="{ay-8:.2f}" font-size="{min(13, tick_size):g}" text-anchor="end">{esc(note["label"])}</text>')
        elif note["type"] == "vline" and xmin <= note["value"] <= xmax:
            ax = sx(note["value"])
            pieces.append(f'<line class="annotation" x1="{ax:.2f}" x2="{ax:.2f}" y1="{top}" y2="{height-bottom}" stroke="{theme["muted"]}" stroke-width="1.2" stroke-dasharray="7 5"/>')
            if note["label"]:
                pieces.append(f'<text class="muted" x="{ax+8:.2f}" y="{top+16}" font-size="{min(13, tick_size):g}">{esc(note["label"])}</text>')
    # Series are clipped to the plot area so a y_range/x_range view window
    # trims the drawing without touching the measurements.
    series_pieces = []
    legend_items = []
    for series, key in enumerate(y_keys):
        color = overrides.get(key) or colors[series % len(colors)]
        series_points = [(x, values[series]) for x, values in points if values[series] is not None]
        if kind == "bar":
            bar_width = max(3, pw / max(len(points), 1) / (len(y_keys) + 1))
            for x, value in series_points:
                px = sx(x) + (series - (len(y_keys)-1)/2) * bar_width
                py = sy(value)
                base_y = min(max(sy(0), top), height - bottom) if ymin < 0 < ymax else height - bottom
                series_pieces.append(f'<rect x="{px-bar_width/2:.2f}" y="{min(py, base_y):.2f}" width="{bar_width:.2f}" height="{abs(base_y-py):.2f}" fill="{color}" opacity="0.82"/>')
        else:
            if kind == "line":
                lw = style["line_width"]
                lw_text = str(int(lw)) if float(lw).is_integer() else str(lw)
                dash_attr = f' stroke-dasharray="{dash}"' if dash else ""
                coords = " ".join(f"{sx(x):.2f},{sy(value):.2f}" for x, value in series_points)
                series_pieces.append(f'<polyline fill="none" stroke="{color}" stroke-width="{lw_text}"{dash_attr} stroke-linecap="round" stroke-linejoin="round" points="{coords}"/>')
            if draw_markers:
                for x, value in series_points:
                    series_pieces.append(f'<circle cx="{sx(x):.2f}" cy="{sy(value):.2f}" r="{marker_r:g}" fill="{color}"/>')
        legend_items.append((color, key))
    pieces.append(f'<g clip-path="url(#plot-clip)">' + "\n".join(series_pieces) + "</g>")
    if legend != "none":
        if legend == "right":
            for index, (color, key) in enumerate(legend_items):
                ly = top + 14 + index * (label_size + 10)
                label_space = max(30, right - 58)
                fit = f' textLength="{label_space:.2f}" lengthAdjust="spacingAndGlyphs"' if text_width(key, label_size) > label_space else ""
                pieces += [f'<rect x="{width-right+18:.2f}" y="{ly-11:.2f}" width="13" height="13" rx="2" fill="{color}"/>', f'<text x="{width-right+38:.2f}" y="{ly:.2f}" font-size="{label_size:g}"{fit}>{esc(key)}</text>']
        else:
            legend_top = height - bottom + tick_gap + 10
            for row_index, row in enumerate(legend_rows):
                for item_index, (offset, item_width) in enumerate(row):
                    color, key = legend_items[sum(len(previous) for previous in legend_rows[:row_index]) + item_index]
                    lx = left + offset
                    ly = legend_top + row_index * legend_row_height
                    label_space = max(20, item_width - 24)
                    fit = f' textLength="{label_space:.2f}" lengthAdjust="spacingAndGlyphs"' if text_width(key, min(15, label_size)) > label_space else ""
                    pieces += [f'<rect x="{lx:.2f}" y="{ly:.2f}" width="13" height="13" rx="2" fill="{color}"/>', f'<text x="{lx+20:.2f}" y="{ly+12:.2f}" font-size="{min(15, label_size):g}"{fit}>{esc(key)}</text>']
    pieces.append("</svg>")
    return "\n".join(pieces), {"row_count": len(points), "x_range": [xmin, xmax], "y_range": [ymin, ymax], "markers_rendered": draw_markers, "layout": {"title_lines": len(title_lines), "legend_rows": len(legend_rows), "requested_tick_count": requested_tick_count, "rendered_tick_count": tick_count, "collision_avoidance": True}}


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    payload = load_input(sys.argv[2] if len(sys.argv) > 2 else "")
    source = safe_source(root, str(payload.get("data_path") or ""))
    raw = source.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    delimiter = "\t" if source.suffix.lower() == ".tsv" else ","
    text, encoding = decode_dataset(raw)
    rows = list(csv.DictReader(text.splitlines(), delimiter=delimiter))
    headers = list(rows[0].keys()) if rows else []
    if len(headers) < 2:
        raise ValueError("dataset needs a header row and at least two columns")
    numeric_columns = [header for header in headers if sum(numeric(row.get(header)) is not None for row in rows) >= 2]
    if len(numeric_columns) < 2:
        raise ValueError("dataset needs at least two numeric columns for a chart")
    x_key = str(payload.get("x_column") or numeric_columns[0])
    requested_y = payload.get("y_columns") or []
    if isinstance(requested_y, str): requested_y = [requested_y]
    y_keys = [str(value) for value in requested_y if str(value) in numeric_columns and str(value) != x_key]
    if not y_keys: y_keys = [value for value in numeric_columns if value != x_key][:3]
    if x_key not in headers or not y_keys:
        raise ValueError("choose a valid x column and at least one valid numeric y column")
    kind = str(payload.get("plot_kind") or "line").lower()
    if kind not in {"line", "scatter", "bar"}: raise ValueError("plot_kind must be line, scatter, or bar")
    title = str(payload.get("title") or f"{source.stem}: {', '.join(y_keys)} vs {x_key}").strip()[:180]
    style = chart_style(payload.get("chart_style"))
    request_key = json.dumps({"x": x_key, "y": y_keys, "kind": kind, "title": title, "chart_style": style}, ensure_ascii=False, sort_keys=True)
    request_digest = hashlib.sha256(request_key.encode("utf-8")).hexdigest()[:10]
    save_mode = str(payload.get("save_mode") or "new").lower()
    if save_mode not in {"new", "overwrite"}:
        raise ValueError("save_mode must be new or overwrite")
    target_manifest_relative = None
    if save_mode == "overwrite":
        target_manifest_relative = str(payload.get("target_manifest_path") or "").strip().replace("\\", "/")
        if not target_manifest_relative:
            raise ValueError("target_manifest_path is required for overwrite")
        target_manifest = (root / target_manifest_relative).resolve()
        analysis_root = (root / "Materials" / "_analysis").resolve()
        try:
            target_manifest.relative_to(analysis_root)
        except ValueError as error:
            raise ValueError("overwrite target must remain inside Materials/_analysis") from error
        if target_manifest.name != "plot-manifest.json" or not target_manifest.is_file():
            raise ValueError("overwrite target must be an existing plot-manifest.json")
        try:
            previous = json.loads(target_manifest.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise ValueError("overwrite target manifest is unreadable") from error
        source_relative = str(source.relative_to(root)).replace("\\", "/")
        if previous.get("skill") != "sch-data-plot" or previous.get("source", {}).get("path") != source_relative:
            raise ValueError("overwrite target does not belong to the selected source dataset")
        output = target_manifest.parent
    else:
        # Source bytes and plotting request together form the artifact identity.
        # A repeated identical new-version request is naturally idempotent.
        output = root / "Materials" / "_analysis" / f"{slug(source.stem)}-{digest[:12]}-{request_digest}"
    output.mkdir(parents=True, exist_ok=True)
    svg_path, report_path, manifest_path = output / "plot.svg", output / "plot-report.md", output / "plot-manifest.json"
    svg, summary = svg_chart(rows, x_key, y_keys, kind, title, style)
    outputs = [str(item.relative_to(root)).replace("\\", "/") for item in (svg_path, report_path, manifest_path)]
    extras = ""
    if style["x_range"]:
        extras += f"- X view window: `{style['x_range'][0]:g} – {style['x_range'][1]:g}` (visual zoom; source data unchanged)\n"
    if style["y_range"]:
        extras += f"- Y view window: `{style['y_range'][0]:g} – {style['y_range'][1]:g}` (visual zoom; source data unchanged)\n"
    for note in style["annotations"]:
        extras += f"- Annotation: `{note['type']} @ {note['value']:g}` {note['label']}\n"
    if style["series_colors"]:
        extras += f"- Series colors: `{json.dumps(style['series_colors'], ensure_ascii=False)}`\n"
    extras += f"- Canvas: `{style['fig_size'][0]}×{style['fig_size'][1]}px`\n- Spines: `{json.dumps(style['spines'])}` (border width {style['border_width']:g})\n- Legend: `{style['legend']}` · Line style: `{style['line_style']}` · Fonts: title {style['title_size']:g} / label {style['label_size']:g} / tick {style['tick_size']:g}\n"
    if style["x_label"] or style["y_label"]:
        extras += f"- Axis labels: x=`{style['x_label'] or ''}` y=`{style['y_label'] or ''}`\n"
    manifest = {"skill": "sch-data-plot", "created_at": datetime.now(timezone.utc).isoformat(), "source": {"path": str(source.relative_to(root)).replace("\\", "/"), "sha256": digest, "bytes": len(raw), "delimiter": delimiter, "encoding": encoding}, "plot": {"kind": kind, "title": title, "x_column": x_key, "y_columns": y_keys, "chart_style": style, **summary}, "revision": {"mode": save_mode, "target_manifest_path": target_manifest_relative}, "outputs": outputs, "writes": outputs}
    report = f"# {title}\n\n- Source: `{manifest['source']['path']}`\n- SHA-256: `{digest}`\n- Plot: `{kind}`\n- X: `{x_key}`\n- Y: `{', '.join(y_keys)}`\n- Theme: `{style['theme']}`\n- Markers: `{style['markers']}`\n- Grid: `{style['show_grid']}`\n- Save mode: `{save_mode}`\n{extras}\n> Reopen this chart from the Material Library to revise it. Choose either a new reproducible version or an explicit overwrite of this selected version. The source dataset is always read-only. Annotations and view ranges are visual only — data processing such as baseline correction must produce derived data with its own record instead.\n\n![[plot.svg]]\n"
    if save_mode == "overwrite" or not svg_path.exists(): svg_path.write_text(svg, encoding="utf-8")
    if save_mode == "overwrite" or not report_path.exists(): report_path.write_text(report, encoding="utf-8")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
