---
name: sch-data-normalize
description: Inspect and convert tabular CSV, TSV, TXT, DAT, or XLSX material-library files into an immutable, provenance-tracked UTF-8 CSV before deterministic plotting. Use when delimiter, encoding, Excel sheet, header row, or formula handling must be made explicit; do not use it to clean, smooth, filter, or alter measurements.
---

# Scholarium Data Normalize / 素材库数据规范化

Use this Skill before `sch-data-profile-audit` or `sch-data-plot` when the
selected material is not already a plot-ready CSV/TSV, or when its delimiter,
encoding, sheet, header row, or Excel formula policy must be recorded.

## Inspect first when structure is ambiguous

```json
{"mode":"inspect","data_path":"Materials/results.xlsx"}
```

Inspection is read-only. For XLSX it returns the workbook's sheet names and
visibility. For delimited text it reports the detected encoding, delimiter,
physical row count, and a small preview. If an XLSX has more than one visible
sheet, ask the researcher to choose one instead of silently selecting it.

## Normalize

```json
{
  "mode": "normalize",
  "data_path": "Materials/results.xlsx",
  "output_root": "Materials",
  "sheet": "kinetics",
  "header_row": 3,
  "formula_mode": "cached"
}
```

- `data_path` must be inside the authorized workspace and end in `.csv`,
  `.tsv`, `.txt`, `.dat`, or `.xlsx`. Legacy binary `.xls` is intentionally
  rejected; convert it to `.xlsx` first.
- `sheet` is an XLSX sheet name or one-based sheet index. It may be omitted
  only when the workbook has exactly one visible sheet.
- `header_row` is the one-based physical row containing column names. When
  omitted, the first non-empty row is used and the decision is recorded.
- `formula_mode` is `cached` (default), `formula_text`, or `reject`. `cached`
  uses values stored by the spreadsheet application and fails if any formula
  lacks a cached value unless `allow_missing_formula_cache` is explicitly
  `true`. `formula_text` exports inert text, never evaluates a formula.
- For text formats, `delimiter` may be `auto`, `comma`, `tab`, `semicolon`,
  `pipe`, or `whitespace`.

The output is a new UTF-8-with-BOM CSV under
`<output_root>/_normalized/<source-and-request-hash>/`. The Skill also writes a
Markdown report and `normalize-manifest.json` containing the source SHA-256,
encoding/delimiter or sheet choice, header decision, formula counts, renamed
duplicate/empty headers, CSV-injection escaping count, and exact output paths.
An identical request returns the existing immutable artifact.

Use `ready_for.data_path` from the manifest as the input to
`sch-data-profile-audit` and then `sch-data-plot`.

## Boundaries

- The source file is byte-for-byte read-only.
- This is structural conversion only. It must not impute, aggregate, smooth,
  filter, normalize values, remove outliers, or execute formulas/macros.
- XLSX is parsed as OOXML data. VBA, external links, queries, and embedded
  objects are never executed.
- All writes stay inside `<output_root>/_normalized/`; no arbitrary output path
  or overwrite target is accepted.
