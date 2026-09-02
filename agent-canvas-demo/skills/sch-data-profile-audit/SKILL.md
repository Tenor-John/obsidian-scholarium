---
name: sch-data-profile-audit
description: Profile an authorized local CSV/TSV dataset before cleaning or plotting. It reads the raw data, reports column types, missing cells, numeric ranges, and outlier-candidate bounds, and never modifies the dataset.
---

# Scholarium Data Profile Audit

Run `scripts/profile_audit.py <workspace> <json-input-or-file>` before data cleaning.

## Input

Pass JSON with one of these fields:

```json
{"data_path":"Materials/example/01_raw_data/raw.csv"}
```

`data_path` must resolve inside the authorized workspace.

## Output Contract

Return one JSON manifest:

- `skill`: `sch-data-profile-audit`
- `input`: raw file path, delimiter, row count and column count
- `columns`: per-column type inference, missing count, numeric summary, IQR bounds, z-score candidates, percentile bounds
- `recommendations`: conservative strategy suggestions for downstream review

## Boundaries

- This Skill is read-only. It must not write, overwrite, delete, or normalize data.
- Treat outliers as candidates, not scientific errors.
- Treat inferred types as operational hints, not a domain claim.
- Downstream cleaning requires researcher confirmation.
