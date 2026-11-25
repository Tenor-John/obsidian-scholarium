#!/usr/bin/env python3
"""Read-only, bounded inspection of an authorized literature workbook or table."""
import importlib.util
import json
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

NORMALIZER = Path(__file__).resolve().parents[2] / "sch-data-normalize" / "scripts" / "normalize_data.py"
spec = importlib.util.spec_from_file_location("sch_review_table_reader", NORMALIZER)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)

ALIASES = {
    "title": {"title", "标题", "文献标题", "题名", "articletitle"},
    "authors": {"author", "authors", "作者", "作者列表"},
    "year": {"year", "publicationyear", "发表年份", "年份"},
    "doi": {"doi", "digitalobjectidentifier"},
    "abstract": {"abstract", "abstractnote", "原始摘要", "摘要"},
    "priority": {"阅读优先级", "priority", "readingpriority"},
    "item_link": {"itemlink", "itemlinkraw", "zoterolink"},
}

def normalize_name(value):
    return "".join(str(value).strip().lower().split()).replace("_", "").replace("-", "")

def inspect(root, payload):
    source = reader.safe_source(root, payload.get("data_path") or payload.get("path"))
    raw = source.read_bytes()
    result = {"source": {"path": reader.relative(root, source), "sha256": reader.sha256_bytes(raw), "bytes": len(raw)}, "writes": []}
    if source.suffix.lower() == ".xlsx":
        with reader.safe_xlsx_archive(source) as archive:
            sheets = reader.workbook_sheets(archive)
            result["sheets"] = [{key: sheet[key] for key in ("index", "name", "state")} for sheet in sheets]
            requested = payload.get("sheet")
            if requested is None and any(sheet["name"] == "Main_Classification" and sheet["state"] == "visible" for sheet in sheets):
                requested = "Main_Classification"
            selected = reader.select_sheet(sheets, requested)
            rows, counters = reader.parse_xlsx_sheet(archive, selected, "cached")
            result["sheet"] = selected["name"]
            result["formula_counts"] = counters
    else:
        text, encoding = reader.decode_text(raw)
        delimiter = reader.detect_delimiter(text, source.suffix.lower(), payload.get("delimiter"))
        rows = reader.parse_delimited(text, delimiter)
        result.update({"encoding": encoding, "delimiter": delimiter})
    raw_rows = rows
    headers, rows, header_row, renamed = reader.table_from_rows(raw_rows, reader.requested_header_row(payload.get("header_row")))
    physical_rows = [number for number, values in raw_rows if number > header_row and any(str(value).strip() for value in values[:len(headers)])]
    columns = {}
    for key, aliases in ALIASES.items():
        hits = [header for header in headers if normalize_name(header) in aliases]
        if hits:
            columns[key] = hits[0]
    result.update({"headers": headers, "header_row": header_row, "renamed_headers": renamed, "columns": columns, "record_count": len(rows)})
    result["coverage"] = {key: {"present": sum(bool(str(row[headers.index(name)]).strip()) for row in rows), "total": len(rows)} for key, name in columns.items()}
    result["missing_columns"] = [key for key in ALIASES if key not in columns]
    offset = max(0, int(payload.get("offset", 0)))
    limit = max(0, min(200, int(payload.get("limit", 20))))
    result["page"] = {"offset": offset, "limit": limit, "returned": min(limit, max(0, len(rows) - offset)), "has_more": offset + limit < len(rows)}
    result["records"] = [{"row": physical_rows[offset + index], "values": dict(zip(headers, row))} for index, row in enumerate(rows[offset:offset + limit])]
    result["limitations"] = ["Excel formulas are read only from cached values; external links and macros are not executed.", "Abstracts and metadata alone do not establish full-text evidence."]
    return result

def main():
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
    payload = reader.load_input(sys.argv[2] if len(sys.argv) > 2 else "")
    print(json.dumps(inspect(root, payload), ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
