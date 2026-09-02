#!/usr/bin/env python3
from __future__ import annotations

import csv
import json
import math
import statistics
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


def read_table(path: Path) -> tuple[list[str], list[dict[str, str]], str, str]:
    text, encoding = decode_dataset(path.read_bytes())
    dialect = sniff(text)
    rows = list(csv.DictReader(text.splitlines(), dialect=dialect))
    headers = list(rows[0].keys()) if rows else []
    return headers, rows, dialect.delimiter, encoding


def is_missing(value: object) -> bool:
    return str(value if value is not None else "").strip().lower() in MISSING


def to_number(value: object) -> float | None:
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


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    pos = (len(ordered) - 1) * max(0.0, min(100.0, pct)) / 100.0
    low = math.floor(pos)
    high = math.ceil(pos)
    if low == high:
        return ordered[low]
    return ordered[low] + (ordered[high] - ordered[low]) * (pos - low)


def profile_column(header: str, rows: list[dict[str, str]]) -> dict:
    raw = [row.get(header, "") for row in rows]
    missing = sum(1 for value in raw if is_missing(value))
    numbers = []
    for value in raw:
        number = to_number(value)
        if number is not None:
            numbers.append(number)
    non_missing = len(raw) - missing
    numeric_ratio = len(numbers) / non_missing if non_missing else 0.0
    inferred = "numeric" if len(numbers) >= 2 and numeric_ratio >= 0.5 else "text"
    result = {
        "name": header,
        "inferred_type": inferred,
        "missing_count": missing,
        "missing_rate": missing / len(raw) if raw else 0.0,
        "non_missing_count": non_missing,
        "numeric_count": len(numbers),
    }
    if inferred == "numeric":
        ordered = sorted(numbers)
        mean = sum(numbers) / len(numbers) if numbers else 0.0
        median = statistics.median(numbers) if numbers else 0.0
        std = statistics.pstdev(numbers) if len(numbers) > 1 else 0.0
        q1 = percentile(ordered, 25)
        q3 = percentile(ordered, 75)
        iqr = q3 - q1
        iqr_low = q1 - 1.5 * iqr
        iqr_high = q3 + 1.5 * iqr
        z_candidates = 0
        if std > 0:
            z_candidates = sum(1 for value in numbers if abs((value - mean) / std) > 3)
        result["numeric"] = {
            "min": min(numbers),
            "max": max(numbers),
            "mean": mean,
            "median": median,
            "std": std,
            "q1": q1,
            "q3": q3,
            "iqr": iqr,
            "iqr_low": iqr_low,
            "iqr_high": iqr_high,
            "iqr_candidate_count": sum(1 for value in numbers if value < iqr_low or value > iqr_high),
            "zscore_3_candidate_count": z_candidates,
            "percentile_1": percentile(ordered, 1),
            "percentile_99": percentile(ordered, 99),
        }
    return result


def recommendations(columns: list[dict]) -> list[dict]:
    out = []
    for column in columns:
        if column["inferred_type"] != "numeric":
            continue
        name = column["name"]
        numeric = column.get("numeric", {})
        if column["missing_count"]:
            out.append({
                "column": name,
                "concern": "missing_values",
                "default_strategy": "median",
                "rationale": "Median imputation is conservative for skewed small experimental tables; user confirmation is still required.",
            })
        if numeric.get("iqr_candidate_count", 0):
            out.append({
                "column": name,
                "concern": "outlier_candidates",
                "default_strategy": "iqr_clip",
                "rationale": "IQR flags distributional extremes without assuming normality; treat candidates as review items, not errors.",
            })
    return out


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    payload = load_input(sys.argv[2] if len(sys.argv) > 2 else "")
    path = safe_path(root, payload.get("data_path") or payload.get("raw_path") or payload.get("path") or "")
    headers, rows, delimiter, encoding = read_table(path)
    columns = [profile_column(header, rows) for header in headers]
    manifest = {
        "skill": "sch-data-profile-audit",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "input": {
            "path": str(path.relative_to(root)).replace("\\", "/"),
            "delimiter": delimiter,
            "encoding": encoding,
            "rows": len(rows),
            "columns": len(headers),
        },
        "columns": columns,
        "recommendations": recommendations(columns),
        "writes": [],
    }
    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
