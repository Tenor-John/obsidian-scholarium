#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

MISSING = {"", "na", "n/a", "nan", "null", "none", "-", "--"}


def load_input(value: str) -> dict:
    if value:
        try:
            return json.loads(value)
        except Exception:
            try:
                candidate = Path(value)
                if candidate.exists():
                    return json.loads(candidate.read_text(encoding="utf-8"))
            except OSError:
                pass
            return {"data_path": value}
    return {}


def unwrap(payload: dict) -> dict:
    return payload.get("manifest") if isinstance(payload.get("manifest"), dict) else payload


def safe_path(root: Path, value: str) -> Path:
    if not value:
        raise ValueError("data_path is required")
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = root / candidate
    resolved = candidate.resolve()
    if root not in resolved.parents and resolved != root:
        raise ValueError("data_path must stay inside the authorized workspace")
    if not resolved.exists() or not resolved.is_file():
        raise ValueError(f"data file not found: {value}")
    return resolved


def sniff(text: str) -> csv.Dialect:
    sample = text[:8192]
    try:
        return csv.Sniffer().sniff(sample, delimiters=",\t;")
    except Exception:
        class Fallback(csv.excel):
            delimiter = "\t" if "\t" in sample else ","
        return Fallback


def decode_dataset(raw: bytes) -> tuple[str, str]:
    """Decode common lab-export encodings without silently replacing bytes."""
    for encoding, label in (("utf-8-sig", "UTF-8"), ("utf-8", "UTF-8"), ("gb18030", "GB18030"), ("gbk", "GBK")):
        try:
            return raw.decode(encoding), label
        except UnicodeDecodeError:
            continue
    raise ValueError("dataset encoding is unsupported; save the CSV/TSV as UTF-8, GB18030, or GBK")


def is_missing(value: object) -> bool:
    return str(value if value is not None else "").strip().lower() in MISSING


def to_number(value: object):
    if is_missing(value):
        return None
    text = str(value).strip().replace(",", "")
    if text.endswith("%"):
        text = text[:-1]
    try:
        number = float(text)
    except Exception:
        return None
    return number if math.isfinite(number) else None


def read_table(path: Path):
    text, encoding = decode_dataset(path.read_bytes())
    dialect = sniff(text)
    rows = list(csv.DictReader(text.splitlines(), dialect=dialect))
    headers = list(rows[0].keys()) if rows else []
    return headers, rows, dialect.delimiter, encoding


def profile_from_rows(headers, rows, rel_path="", delimiter=",", encoding=""):
    columns = []
    for header in headers:
        values = [row.get(header, "") for row in rows]
        missing = sum(1 for value in values if is_missing(value))
        numbers = [to_number(value) for value in values]
        numeric_count = sum(1 for value in numbers if value is not None)
        non_missing = len(values) - missing
        numeric_ratio = numeric_count / non_missing if non_missing else 0.0
        inferred = "numeric" if numeric_count >= 2 and numeric_ratio >= 0.5 else "text"
        columns.append({
            "name": header,
            "inferred_type": inferred,
            "missing_count": missing,
            "non_missing_count": non_missing,
            "numeric_count": numeric_count,
        })
    return {
        "skill": "sch-data-profile-audit-lite",
        "input": {
            "path": rel_path,
            "delimiter": delimiter,
            "encoding": encoding,
            "rows": len(rows),
            "columns": len(headers),
        },
        "columns": columns,
    }


def norm(name: str) -> str:
    return "".join(ch.lower() if ch.isalnum() else "_" for ch in str(name)).strip("_")


def has_any(name: str, words) -> bool:
    n = norm(name)
    return any(word in n for word in words)


def first_by_name(columns, words, inferred=None):
    for column in columns:
        if inferred and column.get("inferred_type") != inferred:
            continue
        if has_any(column.get("name", ""), words):
            return column.get("name")
    return None


def duplicate_levels(rows, column_name: str) -> int:
    if not rows or not column_name:
        return 0
    counts = {}
    for row in rows:
        value = str(row.get(column_name, "")).strip()
        if value:
            counts[value] = counts.get(value, 0) + 1
    return sum(1 for count in counts.values() if count > 1)


def score_candidate(candidates, key, score, evidence):
    candidates.append({
        "type": key,
        "score": round(max(0.0, min(1.0, score)), 3),
        "evidence": evidence,
    })


def classify(profile, rows=None):
    rows = rows or []
    columns = profile.get("columns", [])
    numeric = [col for col in columns if col.get("inferred_type") == "numeric"]
    text = [col for col in columns if col.get("inferred_type") != "numeric"]
    numeric_names = [col.get("name") for col in numeric]
    text_names = [col.get("name") for col in text]

    sample_col = first_by_name(columns, ["sample", "catalyst", "material", "specimen", "name", "id"])
    group_col = first_by_name(columns, ["group", "condition", "treatment", "category", "class"])
    replicate_col = first_by_name(columns, ["replicate", "rep", "trial", "repeat", "batch", "run"])
    time_col = first_by_name(columns, ["time", "date", "timestamp", "minute", "min", "second", "sec", "hour"], "numeric") or first_by_name(columns, ["time", "date", "timestamp"])
    wavelength_col = first_by_name(columns, ["wavelength", "wave_length", "lambda", "nm", "wavenumber", "raman_shift", "cm_1", "cm-1", "twotheta", "two_theta", "2theta", "theta", "binding_energy"], "numeric")
    potential_col = first_by_name(columns, ["potential", "voltage", "ewe", "voltage_v", "potential_v"], "numeric")
    current_col = first_by_name(columns, ["current", "current_density", "ma_cm2", "ua", "ampere"], "numeric")
    intensity_col = first_by_name(columns, ["intensity", "absorbance", "transmittance", "counts", "signal"], "numeric")

    candidate_scores = []
    duplicate_sample_groups = duplicate_levels(rows, sample_col or group_col or "")

    if wavelength_col and len(numeric) >= 2:
        score_candidate(candidate_scores, "spectrum_curve", 0.88, [
            f"x-axis-like spectral column: {wavelength_col}",
            f"numeric signal columns: {', '.join(name for name in numeric_names if name != wavelength_col)[:180]}",
        ])
    elif len(numeric) >= 4 and not text:
        score_candidate(candidate_scores, "numeric_matrix", 0.55, ["many numeric columns without a clear categorical axis"])

    if potential_col and current_col:
        score_candidate(candidate_scores, "electrochemistry_curve", 0.9, [
            f"potential column: {potential_col}",
            f"current column: {current_col}",
        ])

    if time_col and len(numeric) >= 2:
        score_candidate(candidate_scores, "time_series", 0.82, [
            f"time-like column: {time_col}",
            f"numeric response columns: {', '.join(name for name in numeric_names if name != time_col)[:180]}",
        ])

    if replicate_col and (sample_col or group_col) and numeric:
        score_candidate(candidate_scores, "replicate_assay", 0.88, [
            f"replicate column: {replicate_col}",
            f"group/sample column: {sample_col or group_col}",
        ])
    elif duplicate_sample_groups and numeric:
        score_candidate(candidate_scores, "replicate_assay", 0.68, [
            f"repeated levels in {sample_col or group_col}",
            "no explicit replicate column found",
        ])

    if (sample_col or text) and numeric:
        score_candidate(candidate_scores, "sample_metric_table", 0.72, [
            f"categorical/sample column: {sample_col or text_names[0]}",
            f"numeric metrics: {', '.join(numeric_names)[:180]}",
        ])

    if len(numeric) >= 3 and (not text or len(rows) >= 3):
        score_candidate(candidate_scores, "heatmap_matrix", 0.45, [
            "multiple numeric columns can be rendered as a matrix/heatmap",
        ])

    if not candidate_scores:
        score_candidate(candidate_scores, "generic_table", 0.35, ["no strong domain-specific pattern detected"])

    candidate_scores.sort(key=lambda item: item["score"], reverse=True)
    primary = candidate_scores[0]
    roles = {
        "sample": sample_col,
        "group": group_col or sample_col,
        "replicate": replicate_col,
        "time": time_col,
        "wavelength": wavelength_col,
        "potential": potential_col,
        "current": current_col,
        "intensity": intensity_col,
        "numeric_values": numeric_names,
        "text_columns": text_names,
    }

    templates = {
        "spectrum_curve": {"id": "spectrum_overlay", "plot": "overlay_line", "next_skill": "sch-data-spectrum-plot"},
        "electrochemistry_curve": {"id": "electrochemistry_curve", "plot": "curve", "next_skill": "sch-data-electrochemistry-plot"},
        "time_series": {"id": "time_series", "plot": "line", "next_skill": "sch-data-time-series-plot"},
        "replicate_assay": {"id": "replicate_assay", "plot": "bar_error", "next_skill": "sch-data-replicate-summary"},
        "sample_metric_table": {"id": "sample_metric_table", "plot": "bar_or_line", "next_skill": "sch-data-transform-runner"},
        "heatmap_matrix": {"id": "heatmap_matrix", "plot": "heatmap", "next_skill": "sch-data-transform-runner"},
        "numeric_matrix": {"id": "numeric_matrix", "plot": "heatmap", "next_skill": "sch-data-transform-runner"},
        "generic_table": {"id": "generic_table", "plot": "table_profile", "next_skill": "sch-data-transform-runner"},
    }
    template = templates.get(primary["type"], templates["generic_table"])
    template = dict(template)
    template["reason"] = "; ".join(primary["evidence"])

    return {
        "classification": {
            "primary_type": primary["type"],
            "confidence": "high" if primary["score"] >= 0.8 else ("medium" if primary["score"] >= 0.55 else "low"),
            "score": primary["score"],
            "candidates": candidate_scores[:5],
        },
        "roles": roles,
        "recommended_template": template,
    }


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    payload = load_input(sys.argv[2] if len(sys.argv) > 2 else "")
    profile = unwrap(payload)
    rows = []
    if not profile.get("columns"):
        path_value = payload.get("data_path") or payload.get("raw_path") or payload.get("path") or ""
        path = safe_path(root, path_value)
        headers, rows, delimiter, encoding = read_table(path)
        profile = profile_from_rows(headers, rows, str(path.relative_to(root)).replace("\\", "/"), delimiter, encoding)
    elif payload.get("data_path") or payload.get("raw_path") or payload.get("path"):
        try:
            path = safe_path(root, payload.get("data_path") or payload.get("raw_path") or payload.get("path"))
            _headers, rows, _delimiter, _encoding = read_table(path)
        except Exception:
            rows = []
    result = classify(profile, rows)
    manifest = {
        "skill": "sch-data-classifier",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input": profile.get("input", {}),
        **result,
        "requires_confirmation": True,
        "writes": [],
    }
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
