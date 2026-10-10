#!/usr/bin/env python3
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import posixpath
import re
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree as ET

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

SUPPORTED_SUFFIXES = {".csv", ".tsv", ".txt", ".dat", ".xlsx"}
MAX_SOURCE_BYTES = 100 * 1024 * 1024
MAX_XLSX_UNCOMPRESSED_BYTES = 300 * 1024 * 1024
MAX_XLSX_ENTRIES = 4096
MAX_ROWS = 250_000
MAX_COLUMNS = 4096
MAX_CELLS = 2_000_000
XML_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
XML_REL_DOC = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
XML_REL_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
CELL_REF = re.compile(r"^([A-Za-z]+)([0-9]+)$")
NUMBER = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?%?$")


def load_input(value: str) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        candidate = Path(value)
        if not candidate.exists():
            raise ValueError("input must be JSON or a path to a JSON file")
        parsed = json.loads(candidate.read_text(encoding="utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError("input must be a JSON object")
    return parsed


def inside(root: Path, target: Path) -> bool:
    try:
        target.relative_to(root)
        return True
    except ValueError:
        return False


def safe_source(root: Path, value: object) -> Path:
    text = str(value or "").strip()
    if not text:
        raise ValueError("data_path is required")
    candidate = Path(text)
    target = (candidate if candidate.is_absolute() else root / candidate).resolve()
    if not inside(root, target) or not target.is_file():
        raise ValueError("data_path must be an existing file inside the authorized workspace")
    if target.suffix.lower() not in SUPPORTED_SUFFIXES:
        if target.suffix.lower() == ".xls":
            raise ValueError("legacy .xls is not supported; save it as .xlsx before normalization")
        raise ValueError("supported data formats are CSV, TSV, TXT, DAT, and XLSX")
    size = target.stat().st_size
    if size > MAX_SOURCE_BYTES:
        raise ValueError(f"source file exceeds the {MAX_SOURCE_BYTES // (1024 * 1024)} MB limit")
    return target


def safe_output_root(root: Path, value: object) -> tuple[str, Path]:
    relative = str(value or "Materials").replace("\\", "/").strip("/")
    if not relative or relative in {".", ".."} or any(part in {"", ".", ".."} for part in relative.split("/")):
        raise ValueError("output_root must be a relative vault folder")
    target = (root / relative / "_normalized").resolve()
    if not inside(root, target):
        raise ValueError("output_root must remain inside the authorized workspace")
    return relative, target


def relative(root: Path, target: Path) -> str:
    return str(target.relative_to(root)).replace("\\", "/")


def sha256_bytes(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def decode_text(raw: bytes) -> tuple[str, str]:
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16"), "UTF-16"
    for encoding, label in (("utf-8-sig", "UTF-8"), ("utf-8", "UTF-8"), ("gb18030", "GB18030"), ("gbk", "GBK")):
        try:
            return raw.decode(encoding), label
        except UnicodeDecodeError:
            continue
    raise ValueError("text encoding is unsupported; use UTF-8, UTF-16 BOM, GB18030, or GBK")


def delimiter_value(value: object) -> str:
    name = str(value or "auto").strip().lower()
    aliases = {
        "auto": "auto", "comma": ",", ",": ",", "tab": "\t", "\\t": "\t",
        "semicolon": ";", ";": ";", "pipe": "|", "|": "|", "whitespace": "whitespace",
    }
    if name not in aliases:
        raise ValueError("delimiter must be auto, comma, tab, semicolon, pipe, or whitespace")
    return aliases[name]


def detect_delimiter(text: str, suffix: str, requested: object) -> str:
    selected = delimiter_value(requested)
    if selected != "auto":
        return selected
    sample = "\n".join(line for line in text.splitlines()[:80] if line.strip())[:16384]
    try:
        detected = csv.Sniffer().sniff(sample, delimiters=",\t;|").delimiter
        if detected in {",", "\t", ";", "|"}:
            return detected
    except csv.Error:
        pass
    preferred = "\t" if suffix == ".tsv" else ","
    if preferred in sample:
        return preferred
    candidates = [(char, sample.count(char)) for char in ("\t", ";", "|", ",")]
    best, count = max(candidates, key=lambda item: item[1])
    if count:
        return best
    nonempty = [line.strip() for line in text.splitlines() if line.strip()][:20]
    if nonempty and all(len(re.split(r"\s+", line)) >= 2 for line in nonempty):
        return "whitespace"
    return preferred


def parse_delimited(text: str, delimiter: str) -> list[tuple[int, list[str]]]:
    if delimiter == "whitespace":
        return [(index, re.split(r"\s+", line.strip())) for index, line in enumerate(text.splitlines(), 1) if line.strip()]
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)
    rows = []
    for index, row in enumerate(reader, 1):
        if any(str(cell).strip() for cell in row):
            rows.append((index, [str(cell) for cell in row]))
        if len(rows) > MAX_ROWS:
            raise ValueError(f"table exceeds the {MAX_ROWS} row limit")
    return rows


def qname(namespace: str, name: str) -> str:
    return f"{{{namespace}}}{name}"


def safe_xlsx_archive(source: Path) -> zipfile.ZipFile:
    try:
        archive = zipfile.ZipFile(source)
    except zipfile.BadZipFile as error:
        raise ValueError("XLSX container is invalid or corrupt") from error
    entries = archive.infolist()
    if len(entries) > MAX_XLSX_ENTRIES:
        archive.close()
        raise ValueError("XLSX contains too many archive entries")
    if sum(item.file_size for item in entries) > MAX_XLSX_UNCOMPRESSED_BYTES:
        archive.close()
        raise ValueError("XLSX uncompressed content exceeds the safety limit")
    names = set(archive.namelist())
    if "xl/workbook.xml" not in names or "xl/_rels/workbook.xml.rels" not in names:
        archive.close()
        raise ValueError("XLSX is missing workbook metadata")
    return archive


def workbook_sheets(archive: zipfile.ZipFile) -> list[dict]:
    workbook = ET.fromstring(archive.read("xl/workbook.xml"))
    rel_root = ET.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    relations = {
        node.attrib.get("Id", ""): node.attrib.get("Target", "")
        for node in rel_root.findall(qname(XML_REL_PKG, "Relationship"))
    }
    sheets = []
    sheets_node = workbook.find(qname(XML_MAIN, "sheets"))
    if sheets_node is None:
        return sheets
    for index, node in enumerate(sheets_node.findall(qname(XML_MAIN, "sheet")), 1):
        rel_id = node.attrib.get(qname(XML_REL_DOC, "id"), "")
        target = relations.get(rel_id, "")
        if not target:
            continue
        archive_path = posixpath.normpath(posixpath.join("xl", target)).lstrip("/")
        if not archive_path.startswith("xl/") or archive_path not in archive.namelist():
            raise ValueError(f"worksheet relationship for {node.attrib.get('name', index)} is invalid")
        sheets.append({
            "index": index,
            "name": node.attrib.get("name", f"Sheet{index}"),
            "state": node.attrib.get("state", "visible"),
            "path": archive_path,
        })
    return sheets


def select_sheet(sheets: list[dict], requested: object) -> dict:
    if not sheets:
        raise ValueError("XLSX contains no worksheets")
    if requested is not None and str(requested).strip() != "":
        if isinstance(requested, int) or str(requested).strip().isdigit():
            index = int(requested)
            match = next((sheet for sheet in sheets if sheet["index"] == index), None)
        else:
            name = str(requested).strip()
            match = next((sheet for sheet in sheets if sheet["name"] == name), None)
        if match is None:
            available = ", ".join(f"{sheet['index']}:{sheet['name']}" for sheet in sheets)
            raise ValueError(f"sheet not found; available sheets: {available}")
        return match
    visible = [sheet for sheet in sheets if sheet["state"] == "visible"]
    if len(visible) == 1:
        return visible[0]
    available = ", ".join(f"{sheet['index']}:{sheet['name']} ({sheet['state']})" for sheet in sheets)
    raise ValueError(f"sheet is required because the workbook has multiple visible sheets: {available}")


def shared_strings(archive: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in archive.namelist():
        return []
    root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
    return ["".join(node.text or "" for node in item.iter(qname(XML_MAIN, "t"))) for item in root.findall(qname(XML_MAIN, "si"))]


def column_index(cell_reference: str, fallback: int) -> int:
    match = CELL_REF.match(cell_reference or "")
    if not match:
        return fallback
    result = 0
    for char in match.group(1).upper():
        result = result * 26 + ord(char) - 64
    return result - 1


def cell_value(cell: ET.Element, strings: list[str], formula_mode: str, counters: dict) -> str:
    kind = cell.attrib.get("t", "n")
    formula = cell.find(qname(XML_MAIN, "f"))
    value_node = cell.find(qname(XML_MAIN, "v"))
    if formula is not None:
        counters["formula_cells"] += 1
        if formula_mode == "reject":
            raise ValueError("worksheet contains formulas and formula_mode is reject")
        if formula_mode == "formula_text":
            counters["formula_text_cells"] += 1
            return "'=" + (formula.text or "")
        if value_node is None:
            counters["missing_formula_cache"] += 1
            return ""
    if kind == "inlineStr":
        inline = cell.find(qname(XML_MAIN, "is"))
        return "" if inline is None else "".join(node.text or "" for node in inline.iter(qname(XML_MAIN, "t")))
    raw = "" if value_node is None else (value_node.text or "")
    if kind == "s":
        try:
            return strings[int(raw)]
        except (ValueError, IndexError):
            raise ValueError("XLSX shared-string index is invalid")
    if kind == "b":
        return "TRUE" if raw == "1" else "FALSE"
    if kind == "e":
        return f"#{raw or 'ERROR'}"
    return raw


def parse_xlsx_sheet(archive: zipfile.ZipFile, sheet: dict, formula_mode: str) -> tuple[list[tuple[int, list[str]]], dict]:
    root = ET.fromstring(archive.read(sheet["path"]))
    strings = shared_strings(archive)
    counters = {"formula_cells": 0, "formula_text_cells": 0, "missing_formula_cache": 0}
    rows = []
    cells_seen = 0
    fallback_row = 0
    for row_node in root.iter(qname(XML_MAIN, "row")):
        fallback_row += 1
        row_number = int(row_node.attrib.get("r", fallback_row))
        if row_number > MAX_ROWS:
            raise ValueError(f"worksheet exceeds the {MAX_ROWS} row limit")
        values: list[str] = []
        fallback_column = 0
        for cell in row_node.findall(qname(XML_MAIN, "c")):
            index = column_index(cell.attrib.get("r", ""), fallback_column)
            fallback_column = index + 1
            if index >= MAX_COLUMNS:
                raise ValueError(f"worksheet exceeds the {MAX_COLUMNS} column limit")
            if len(values) <= index:
                values.extend([""] * (index + 1 - len(values)))
            values[index] = cell_value(cell, strings, formula_mode, counters)
            cells_seen += 1
            if cells_seen > MAX_CELLS:
                raise ValueError(f"worksheet exceeds the {MAX_CELLS} cell limit")
        if any(str(value).strip() for value in values):
            rows.append((row_number, values))
    return rows, counters


def requested_header_row(value: object) -> int | None:
    if value is None or str(value).strip() == "":
        return None
    try:
        row = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError("header_row must be a one-based integer") from error
    if row < 1 or row > MAX_ROWS:
        raise ValueError(f"header_row must be between 1 and {MAX_ROWS}")
    return row


def table_from_rows(rows: list[tuple[int, list[str]]], header_requested: int | None) -> tuple[list[str], list[list[str]], int, list[dict]]:
    if not rows:
        raise ValueError("selected table contains no non-empty rows")
    if header_requested is None:
        header_index = 0
    else:
        header_index = next((index for index, item in enumerate(rows) if item[0] == header_requested), -1)
        if header_index < 0:
            raise ValueError(f"header_row {header_requested} is empty or absent")
    physical_header_row, raw_headers = rows[header_index]
    data_rows = [list(values) for _number, values in rows[header_index + 1:]]
    width = max([len(raw_headers), *(len(row) for row in data_rows)] or [0])
    last_nonempty = -1
    for row in [raw_headers, *data_rows]:
        for index, value in enumerate(row):
            if str(value).strip():
                last_nonempty = max(last_nonempty, index)
    width = last_nonempty + 1
    if width < 1:
        raise ValueError("header row has no usable columns")
    if width > MAX_COLUMNS or len(data_rows) > MAX_ROWS:
        raise ValueError("selected table exceeds normalization limits")
    raw_headers = list(raw_headers) + [""] * (width - len(raw_headers))
    used: dict[str, int] = {}
    headers = []
    mapping = []
    for index, original in enumerate(raw_headers[:width], 1):
        base = str(original).strip() or f"column_{index}"
        count = used.get(base, 0) + 1
        used[base] = count
        normalized = base if count == 1 else f"{base}_{count}"
        while normalized in headers:
            count += 1
            used[base] = count
            normalized = f"{base}_{count}"
        headers.append(normalized)
        if normalized != str(original):
            mapping.append({"column": index, "original": str(original), "normalized": normalized})
    normalized_rows = []
    for row in data_rows:
        padded = (list(row) + [""] * width)[:width]
        if any(str(value).strip() for value in padded):
            normalized_rows.append([str(value) for value in padded])
    if len(headers) * max(1, len(normalized_rows)) > MAX_CELLS:
        raise ValueError(f"selected table exceeds the {MAX_CELLS} cell limit")
    return headers, normalized_rows, physical_header_row, mapping


def protect_csv_cell(value: str) -> tuple[str, bool]:
    text = str(value)
    stripped = text.lstrip()
    if not stripped:
        return text, False
    risky = stripped[0] in {"=", "+", "@"} or (stripped[0] == "-" and not NUMBER.match(stripped)) or text[0] in {"\t", "\r"}
    if risky and not text.startswith("'"):
        return "'" + text, True
    return text, False


def protect_table(headers: list[str], rows: list[list[str]]) -> tuple[list[str], list[list[str]], int]:
    count = 0
    safe_headers = []
    for value in headers:
        safe, changed = protect_csv_cell(value)
        safe_headers.append(safe)
        count += int(changed)
    safe_rows = []
    for row in rows:
        safe_row = []
        for value in row:
            safe, changed = protect_csv_cell(value)
            safe_row.append(safe)
            count += int(changed)
        safe_rows.append(safe_row)
    return safe_headers, safe_rows, count


def inspect_manifest(root: Path, source: Path, raw: bytes, payload: dict) -> dict:
    base = {
        "skill": "sch-data-normalize",
        "mode": "inspect",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": {"path": relative(root, source), "sha256": sha256_bytes(raw), "bytes": len(raw), "format": source.suffix.lower().lstrip(".")},
        "writes": [],
    }
    if source.suffix.lower() == ".xlsx":
        with safe_xlsx_archive(source) as archive:
            sheets = workbook_sheets(archive)
        base["workbook"] = {"sheets": [{key: sheet[key] for key in ("index", "name", "state")} for sheet in sheets]}
        return base
    text, encoding = decode_text(raw)
    delimiter = detect_delimiter(text, source.suffix.lower(), payload.get("delimiter"))
    parsed = parse_delimited(text, delimiter)
    base["text"] = {
        "encoding": encoding,
        "delimiter": delimiter,
        "non_empty_rows": len(parsed),
        "preview": [{"row": row_number, "values": values[:20]} for row_number, values in parsed[:10]],
    }
    return base


def write_csv(path: Path, headers: list[str], rows: list[list[str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(headers)
        writer.writerows(rows)


def report_text(manifest: dict) -> str:
    source = manifest["source"]
    selection = manifest["selection"]
    table = manifest["table"]
    notes = [
        "# Normalized material data",
        "",
        f"- Source: `{source['path']}`",
        f"- Source SHA-256: `{source['sha256']}`",
        f"- Source format: `{source['format']}`",
        f"- Header row: `{selection['header_row']}`",
        f"- Rows: `{table['rows']}`",
        f"- Columns: `{table['columns']}`",
    ]
    if selection.get("sheet"):
        notes.append(f"- Sheet: `{selection['sheet']}` (index {selection['sheet_index']})")
        notes.append(f"- Formula mode: `{selection['formula_mode']}`")
    else:
        notes.append(f"- Source encoding: `{source.get('encoding', '')}`")
        notes.append(f"- Detected delimiter: `{selection.get('delimiter', '')}`")
    notes.extend([
        f"- Renamed empty/duplicate headers: `{len(table['header_mapping'])}`",
        f"- Escaped formula-like CSV cells: `{table['csv_injection_escaped_cells']}`",
        "",
        "> Structural conversion only. The source file was not changed, and no values were cleaned, filtered, smoothed, imputed, aggregated, or formula-evaluated.",
        "",
        f"Next plot input: `{manifest['ready_for']['data_path']}`",
        "",
    ])
    return "\n".join(notes)


def normalize(root: Path, source: Path, raw: bytes, payload: dict) -> dict:
    output_root_name, normalized_root = safe_output_root(root, payload.get("output_root"))
    header_requested = requested_header_row(payload.get("header_row"))
    formula_mode = str(payload.get("formula_mode") or "cached").strip().lower()
    if formula_mode not in {"cached", "formula_text", "reject"}:
        raise ValueError("formula_mode must be cached, formula_text, or reject")
    source_metadata = {
        "path": relative(root, source), "sha256": sha256_bytes(raw), "bytes": len(raw), "format": source.suffix.lower().lstrip("."),
    }
    counters = {"formula_cells": 0, "formula_text_cells": 0, "missing_formula_cache": 0}
    selection: dict = {"header_row_requested": header_requested}
    if source.suffix.lower() == ".xlsx":
        with safe_xlsx_archive(source) as archive:
            sheets = workbook_sheets(archive)
            sheet = select_sheet(sheets, payload.get("sheet"))
            rows, counters = parse_xlsx_sheet(archive, sheet, formula_mode)
        if counters["missing_formula_cache"] and not bool(payload.get("allow_missing_formula_cache", False)):
            raise ValueError(
                f"{counters['missing_formula_cache']} formula cells have no cached value; recalculate and save the workbook, choose formula_text, or explicitly allow missing caches"
            )
        selection.update({
            "sheet": sheet["name"], "sheet_index": sheet["index"], "sheet_state": sheet["state"],
            "formula_mode": formula_mode,
            "allow_missing_formula_cache": bool(payload.get("allow_missing_formula_cache", False)),
        })
    else:
        text, encoding = decode_text(raw)
        delimiter = detect_delimiter(text, source.suffix.lower(), payload.get("delimiter"))
        rows = parse_delimited(text, delimiter)
        source_metadata["encoding"] = encoding
        selection["delimiter"] = delimiter
    headers, data_rows, physical_header_row, mapping = table_from_rows(rows, header_requested)
    selection["header_row"] = physical_header_row
    headers, data_rows, escaped = protect_table(headers, data_rows)
    request = {
        "source_sha256": source_metadata["sha256"],
        "source_path": source_metadata["path"],
        "output_root": output_root_name,
        "selection": selection,
    }
    request_sha = sha256_bytes(json.dumps(request, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8"))
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", source.stem).strip("-.") or "dataset"
    directory_name = f"{stem}-{source_metadata['sha256'][:12]}-{request_sha[:8]}"
    output = (normalized_root / directory_name).resolve()
    if not inside(normalized_root, output):
        raise ValueError("normalized output escaped the configured output root")
    csv_path = output / "normalized.csv"
    manifest_path = output / "normalize-manifest.json"
    report_path = output / "normalize-report.md"
    output_paths = [relative(root, csv_path), relative(root, report_path), relative(root, manifest_path)]
    if output.exists():
        if not manifest_path.is_file():
            raise ValueError("immutable normalized output exists without a valid manifest")
        existing = json.loads(manifest_path.read_text(encoding="utf-8"))
        if existing.get("request", {}).get("sha256") != request_sha or existing.get("source", {}).get("sha256") != source_metadata["sha256"]:
            raise ValueError("immutable normalized output identity collision")
        existing["result_status"] = "existing"
        return existing
    manifest = {
        "skill": "sch-data-normalize",
        "mode": "normalize",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": source_metadata,
        "request": {**request, "sha256": request_sha},
        "selection": selection,
        "table": {
            "rows": len(data_rows), "columns": len(headers), "headers": headers,
            "header_mapping": mapping,
            "formula_cells": counters["formula_cells"],
            "formula_text_cells": counters["formula_text_cells"],
            "missing_formula_cache": counters["missing_formula_cache"],
            "csv_injection_escaped_cells": escaped,
        },
        "output": {"encoding": "UTF-8-BOM", "delimiter": ",", "line_ending": "LF"},
        "ready_for": {"skill": "sch-data-plot", "data_path": output_paths[0]},
        "outputs": output_paths,
        "writes": output_paths,
        "result_status": "created",
    }
    normalized_root.mkdir(parents=True, exist_ok=True)
    temp = normalized_root / f".{directory_name}.tmp-{os.getpid()}"
    if temp.exists():
        raise ValueError("temporary normalized output already exists")
    try:
        temp.mkdir()
        write_csv(temp / csv_path.name, headers, data_rows)
        (temp / report_path.name).write_text(report_text(manifest), encoding="utf-8")
        (temp / manifest_path.name).write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temp, output)
    except Exception:
        if temp.exists() and inside(normalized_root, temp):
            shutil.rmtree(temp)
        raise
    return manifest


def main() -> int:
    root = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd().resolve()
    payload = load_input(sys.argv[2] if len(sys.argv) > 2 else "")
    source = safe_source(root, payload.get("data_path") or payload.get("path"))
    raw = source.read_bytes()
    mode = str(payload.get("mode") or "normalize").strip().lower()
    if mode == "inspect":
        result = inspect_manifest(root, source, raw, payload)
    elif mode == "normalize":
        result = normalize(root, source, raw, payload)
    else:
        raise ValueError("mode must be inspect or normalize")
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, ValueError, ET.ParseError, zipfile.BadZipFile, json.JSONDecodeError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)
