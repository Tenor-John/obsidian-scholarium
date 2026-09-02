---
name: sch-data-plot
description: Generate a reproducible SVG chart and Markdown report from an authorized CSV/TSV dataset in the Scholarium Material Library. The raw data is read-only; output is constrained to Materials/_analysis/.
---

# Scholarium Data Plot / 素材库数据绘图

Use this Skill only after the researcher has selected a CSV or TSV dataset in
the Material Library and chosen the intended variables. It is a deterministic
plotter, not an arbitrary-code runner.

## Input

```json
{
  "data_path": "Materials/kinetics.csv",
  "x_column": "time_min",
  "y_columns": ["co_rate", "ch4_rate"],
  "plot_kind": "line",
  "title": "CO formation rate",
  "save_mode": "new",
  "target_manifest_path": null,
  "chart_style": {
    "theme": "publication",
    "markers": "auto",
    "show_grid": true,
    "line_width": 2.6,
    "x_range": [10, 20],
    "annotations": [
      { "type": "hline", "value": 0, "label": "baseline" },
      { "type": "vline", "value": 12.4, "label": "peak" }
    ],
    "series_colors": { "co_rate": "#c57300" },
    "fig_size": [1200, 760],
    "spines": { "top": false, "right": false, "left": true, "bottom": true },
    "border_width": 1.5,
    "title_size": 28,
    "label_size": 16,
    "tick_size": 14,
    "x_label": "Time (min)",
    "y_label": "Rate",
    "y_range": [0, 100],
    "legend": "bottom",
    "marker_size": 3.6,
    "line_style": "solid",
    "tick_count": 6
  }
}
```

`data_path` must remain inside the authorized Vault and must end in `.csv` or
`.tsv`. `plot_kind` is one of `line`, `scatter`, or `bar`. Empty variable
choices are resolved conservatively from numeric columns and reported in the
manifest.

`save_mode` is `new` by default. When the researcher explicitly chooses
`overwrite`, `target_manifest_path` is required and must name an existing
`Materials/_analysis/.../plot-manifest.json` belonging to the same source
dataset. Overwrite rewrites only that version's SVG, report, and manifest;
it never rewrites the source dataset or another version.

`chart_style` is optional and visual-only: `theme` is `publication`, `soft`,
or `dark`; `markers` is `auto`, `all`, or `none`; `show_grid` is a boolean;
and `line_width` is constrained to 1–6. `x_range` and `y_range` (null or
`[min, max]` with min < max) are **view zooms**: points outside the window are
not drawn, never deleted. `annotations` (at most 8) are visual overlay lines:
`hline`/`vline` at a numeric `value` with an optional short `label`.
`series_colors` maps a y column name to a `#rgb`/`#rrggbb` hex override.
`fig_size` is the canvas size in px (400–2400 × 300–1800). `spines` toggles
each side of the plot frame (default left+bottom; all four gives a full
border box) and `border_width` (0.5–4) sets its stroke. `title_size` (10–40),
`label_size` (8–24), and `tick_size` (6–20) control font sizes; `x_label` /
`y_label` (≤60 chars) override the axis titles. `legend` is `bottom`,
`right`, or `none`. `marker_size` is the marker radius (1–10), `line_style`
is `solid`, `dashed`, or `dotted`, and `tick_count` (3–10) sets ticks per
axis. None of these may smooth, filter, normalize, or otherwise change the
plotted measurements.

Data processing is a different operation and is out of scope here. "Draw a
baseline at y=0" is a visual annotation and belongs in `annotations`;
"baseline correction / background subtraction" transforms measurements and
must produce derived data with its own processing record instead of being
silently folded into a chart recipe.

## Output

In `new` mode the tool writes a source/request-hash-named directory under:

`Materials/_analysis/<dataset-stem>-<sha256-prefix>/`

It creates:

- `plot.svg` — static vector chart, usable in Obsidian and manuscripts.
- `plot-report.md` — source path, hash, columns and plotting choices.
- `plot-manifest.json` — machine-readable provenance.

The manifest stores the complete chart recipe, including the style and save
mode. The Material Library can reopen that recipe, display its SVG, let the
researcher revise it, and either create a new version or explicitly overwrite
the selected version.

It never rewrites the source dataset and never executes AI-authored code. A
repeated identical `new` request reports the existing artifact instead of
creating a duplicate. Overwrite is accepted only for the selected manifest,
inside `Materials/_analysis/`, with matching source provenance.

## Research Weaver boundary

织研者 may inspect the profile and recommend a chart, but it must not infer a
scientific conclusion from the chart alone. The researcher retains control of
the selected dataset, variables, plot type, and any later Evidence claim.
