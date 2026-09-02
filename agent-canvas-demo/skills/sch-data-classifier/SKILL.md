---
name: sch-data-classifier
description: Classify a profiled CSV/TSV dataset into conservative analysis templates such as sample-metric table, replicate assay, time series, spectrum curve, or electrochemistry curve. It is read-only and never modifies data.
---

# Scholarium Data Classifier

Run `scripts/data_classifier.py <workspace> <json-input-or-file>` after `sch-data-profile-audit`, or pass a local `data_path` directly.

## Input

Preferred input:

```json
{"manifest": {"skill": "sch-data-profile-audit", "columns": []}}
```

Direct input is also supported:

```json
{"data_path": "Materials/example/01_raw_data/raw.csv"}
```

All paths must resolve inside the authorized workspace.

## Output Contract

Return one JSON manifest:

- `skill`: `sch-data-classifier`
- `input`: source path, row count, column count when available
- `classification`: primary dataset type, confidence, and candidate scores
- `roles`: detected semantic roles such as sample, group, replicate, time, wavelength, potential, current, and numeric values
- `recommended_template`: conservative downstream template and default plot type
- `requires_confirmation`: always `true`
- `writes`: always empty

## Boundaries

- This Skill is read-only.
- Treat the result as routing advice, not a scientific claim.
- Prefer conservative `generic_table` / `sample_metric_table` when evidence is weak.
- Downstream transforms and plots require researcher confirmation.
