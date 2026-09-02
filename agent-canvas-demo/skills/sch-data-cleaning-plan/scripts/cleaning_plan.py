#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


def load_input(value: str) -> dict:
    if value:
        try:
            return json.loads(value)
        except Exception:
            candidate = Path(value)
            return json.loads(candidate.read_text(encoding="utf-8"))
    return {}


def unwrap(payload: dict) -> dict:
    return payload.get("manifest") if isinstance(payload.get("manifest"), dict) else payload


def main() -> int:
    _root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    profile = unwrap(load_input(sys.argv[2] if len(sys.argv) > 2 else ""))
    columns = profile.get("columns", [])
    numeric = [column for column in columns if column.get("inferred_type") == "numeric"]
    text = [column for column in columns if column.get("inferred_type") != "numeric"]
    plan_columns = []
    for column in numeric:
        stats = column.get("numeric", {})
        missing = column.get("missing_count", 0)
        outliers = stats.get("iqr_candidate_count", 0)
        plan_columns.append({
            "column": column.get("name"),
            "missing": {
                "enabled": bool(missing),
                "strategy": "median",
                "reason": "Median is robust for small or skewed experimental numeric columns.",
                "observed_missing": missing,
            },
            "outlier": {
                "enabled": bool(outliers),
                "strategy": "iqr_clip",
                "reason": "IQR does not assume normality and is appropriate as a first-pass candidate screen.",
                "observed_candidates": outliers,
                "low": stats.get("iqr_low"),
                "high": stats.get("iqr_high"),
            },
        })
    chart_type = "line" if text and numeric else "bar"
    plan = {
        "data_path": profile.get("input", {}).get("path"),
        "requires_confirmation": True,
        "defaults": {
            "needsProcessing": True,
            "missingStrategy": "median",
            "outlierStrategy": "iqr_clip",
            "normalize": False,
            "chartType": chart_type,
            "xKey": text[0].get("name") if text else (columns[0].get("name") if columns else ""),
            "numericKeys": [column.get("name") for column in numeric],
        },
        "columns": plan_columns,
        "rationale": "The plan is conservative: it proposes robust defaults only where the profile found actual missing cells or outlier candidates.",
    }
    print(json.dumps({
        "skill": "sch-data-cleaning-plan",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "plan": plan,
        "writes": [],
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
