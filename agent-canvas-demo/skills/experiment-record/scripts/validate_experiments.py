#!/usr/bin/env python3
"""Validate and index Experiments/**/experiment.md against the v1 schema.

Reports, never repairs. The frontmatter is a two-way contract: the researcher
may hand-edit it and owns the body outright, so silently rewriting their file
would break the premise the schema is built on. A wrong field is surfaced as an
error for a human to resolve.

Output: one JSON manifest on stdout, plus Research/experiment-index.json for
the downstream project-status step.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

STATUSES = {"planned", "running", "done", "abandoned"}
OUTCOMES = {"pending", "supports", "refutes", "inconclusive"}
REQUIRED = ["type", "id", "title", "status", "created_at", "updated_at"]
LOOP_FIELDS = ["hypothesis_id", "hypothesis", "predicts", "falsified_if", "outcome"]
ID_RE = re.compile(r"^EXP-\d{3}$")


def split_frontmatter(text: str):
    """Return (raw_frontmatter, body). Deliberately does not parse the body."""
    if not text.startswith("---"):
        return None, text
    end = text.find("\n---", 3)
    if end == -1:
        return None, text
    return text[3:end].lstrip("\n"), text[end + 4:]


def parse_yaml(raw: str) -> dict:
    """Minimal YAML reader for this schema's shapes.

    PyYAML is not a dependency of this project and the schema is deliberately
    flat: scalars, inline {..} maps, inline [..] lists, and '- ' item lists.
    Anything it cannot read becomes a validation error rather than a crash.
    """
    data: dict = {}
    key = None
    pending: list = []
    block_scalar = False

    for line in raw.split("\n"):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if block_scalar:
            if line.startswith(("  ", "\t")):
                data[key] = (str(data.get(key) or "") + " " + line.strip()).strip()
                continue
            block_scalar = False
        if line.startswith(("  ", "\t")) and line.lstrip().startswith("- ") and key:
            pending.append(line.lstrip()[2:].strip())
            continue
        if pending and key:
            data[key] = pending
            pending = []
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        key = key.strip()
        value = value.strip()
        if value in (">", "|", ">-", "|-"):
            data[key] = ""
            block_scalar = True
            continue
        if value.startswith("[") and value.endswith("]"):
            inner = value[1:-1].strip()
            data[key] = [v.strip().strip("'\"") for v in inner.split(",") if v.strip()] if inner else []
        elif value.startswith("{") and value.endswith("}"):
            data[key] = value
        else:
            data[key] = value.strip("'\"")
    if pending and key:
        data[key] = pending
    return data


def check(record: dict, rel: str) -> list[str]:
    errors = []
    for field in REQUIRED:
        if not record.get(field):
            errors.append(f"missing required field: {field}")

    if record.get("type") and record["type"] != "experiment":
        errors.append(f"type must be 'experiment', got {record['type']!r}")

    exp_id = str(record.get("id") or "")
    if exp_id and not ID_RE.match(exp_id):
        errors.append(f"id must match EXP-nnn, got {exp_id!r}")
    if exp_id and not rel.startswith(exp_id):
        errors.append(f"directory name should start with {exp_id}")

    status = str(record.get("status") or "")
    if status and status not in STATUSES:
        errors.append(f"status must be one of {sorted(STATUSES)}, got {status!r}")

    outcome = str(record.get("outcome") or "")
    if outcome and outcome not in OUTCOMES:
        errors.append(f"outcome must be one of {sorted(OUTCOMES)}, got {outcome!r}")

    # The state machine. A 'done' experiment with no verdict is the failure mode
    # this whole schema exists to prevent: it looks finished on a board while
    # contributing nothing to the hypothesis it was meant to test.
    if status == "done":
        if outcome in ("", "pending"):
            errors.append("status=done requires outcome != pending")
        if not str(record.get("conclusion") or "").strip():
            errors.append("status=done requires a non-empty conclusion")
    if status == "abandoned" and not str(record.get("conclusion") or "").strip():
        errors.append("status=abandoned requires a conclusion saying why (abandonment is information)")

    return errors


def warn(record: dict, folder: Path) -> list[str]:
    warnings = []
    for field in LOOP_FIELDS:
        if not str(record.get(field) or "").strip():
            warnings.append(f"loop field empty: {field} (project-status cannot use this experiment)")
    for field in ("data_raw", "data_processed", "figures"):
        for item in record.get(field) or []:
            if not (folder / str(item)).exists():
                warnings.append(f"{field} path not found: {item}")
    if not record.get("independent") and record.get("status") != "planned":
        warnings.append("no independent variable declared; rigour checks will degrade to outcome-only")
    return warnings


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
    exp_root = root / "Experiments"
    experiments, all_errors = [], 0

    for path in sorted(exp_root.glob("*/experiment.md")) if exp_root.exists() else []:
        rel = path.parent.name
        text = path.read_text(encoding="utf-8").lstrip("﻿")
        raw, _body = split_frontmatter(text)
        if raw is None:
            experiments.append({"dir": rel, "errors": ["no YAML frontmatter"], "warnings": []})
            all_errors += 1
            continue
        record = parse_yaml(raw)
        errors = check(record, rel)
        warnings = warn(record, path.parent)
        all_errors += len(errors)
        experiments.append({
            "dir": rel,
            "id": record.get("id"),
            "title": record.get("title"),
            "status": record.get("status"),
            "hypothesis_id": record.get("hypothesis_id"),
            "outcome": record.get("outcome"),
            "conclusion": record.get("conclusion"),
            "data_processed": record.get("data_processed") or [],
            "figures": record.get("figures") or [],
            "linked_evidence": record.get("linked_evidence") or [],
            "linked_records": record.get("linked_records") or [],
            "next_actions": record.get("next_actions") or [],
            "blocked_by": record.get("blocked_by") or [],
            "errors": errors,
            "warnings": warnings,
        })

    by_status = {}
    by_outcome = {}
    for item in experiments:
        by_status[item.get("status") or "?"] = by_status.get(item.get("status") or "?", 0) + 1
        if item.get("outcome"):
            by_outcome[item["outcome"]] = by_outcome.get(item["outcome"], 0) + 1

    manifest = {
        "skill": "experiment-record",
        "run_at": datetime.now(timezone.utc).isoformat(),
        "experiments_root": str(exp_root.relative_to(root)).replace("\\", "/") if exp_root.exists() else None,
        "count": len(experiments),
        "by_status": by_status,
        "by_outcome": by_outcome,
        "error_count": all_errors,
        "valid": all_errors == 0,
        "experiments": experiments,
    }

    out_dir = root / "Research"
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "experiment-index.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps(manifest, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
