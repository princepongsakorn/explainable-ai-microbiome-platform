# Task brief: `<ShapHeatmap>` — the last of the four

Read `SPEC.md` and `CONTEXT.md` first. Follow the layering the other three charts establish: pure
geometry in `src/core/`, a thin component in `src/react/`, tests against captured golden values. Reuse
`parseExplanation`, `globalImportance`, `orderFeatures`, `collapseToDisplay`, `formatShapValue`,
`formatFeatureLabel` and `sampleColormap` — do not write second copies.

## What it shows

A grid: one **row per Feature**, one **column per Sample**, each cell coloured by that Sample's SHAP
value for that Feature. Above the grid runs a line of each Sample's total attribution. To its right,
a small bar per row showing that Feature's global importance.

Unlike beeswarm, the colour here encodes the **SHAP value**, not the feature value.

## The algorithm, from `shap/plots/_heatmap.py` v0.49.1

### Ordering

* **Rows (Features):** `argsort(-globalImportance)` — descending mean |φ|, the same ordering the bar
  and beeswarm charts use. Reuse it.
* **Columns (Samples):** this platform does **not** use SHAP's `hclust` default. The runtime passes
  `instance_order=explanation.sum(1)`, which `convert_ordering` turns into a **descending sort by the
  Sample's total Σφ**. That is an `O(n log n)` sort you can do directly — no clustering, no scipy.
  The golden file was captured with this ordering, and it is what the platform draws.

### Collapsing

Same `collapseToDisplay` as the others, including the `faithfulOtherRow` switch. The collapsed row's
cells are the summed φ of the hidden Features, and its right-hand bar is their summed importance.

### Colour

`_heatmap.py:121-128`, and it differs from beeswarm in three ways that all matter:

```
vmin, vmax = percentile(allCells, 1), percentile(allCells, 99)   // 1/99, not 5/95
limit = max(-vmin, vmax)                                          // forced symmetric about zero
colour = redWhiteBlue((value + limit) / (2 * limit))              // white at exactly zero
```

* percentiles are **1st/99th**, not 5th/95th;
* they are computed over the **whole displayed matrix at once**, not per row;
* the domain is forced **symmetric**, so zero is exactly the middle of the colormap — which is white.

Use `red_white_blue` from `fixtures/colormaps.json`, **not** `red_blue`. The two share their endpoints
but not their middle, and using the wrong one is easy to miss.

Because the domain is computed after collapsing, it **changes when `maxDisplay` changes** — the
"other" row's cells are large. Recompute it; do not cache it across `maxDisplay` values.

### The f(x) line and the side bars

* Line: `fx = matrix.sum(axis=0)` — Σφ per Sample, i.e. `f(x) - baseValue`. SHAP normalises it by
  `max(|fx|)` and draws it above the grid with **no axis at all**. Spec §3.5 V5 deviates here: give it
  a real axis and a tooltip. Keep the dashed separator between it and the grid.
* Side bars: `globalImportance / max(globalImportance)`, drawn past the right edge of the grid.

## Golden values

`fixtures/tiny.heatmap.golden.json`:

```jsonc
{
  "max_display": 10,
  "instance_order": "sum(1) descending",
  "labels": ["Parvimonas_unclassified", "...", "Sum of 41 other features"],  // top to bottom
  "vmin": -0.121965, "vmax": 0.121965,       // already symmetric
  "aspect": 1.4,
  "n_features_drawn": 10, "n_instances": 20,
  "matrix": [[...]],        // features x instances, exactly as imshow received it
  "fx_line": [...]          // sum over features, per instance
}
```

`matrix` is **row-major features × instances** — the transpose of the payload's `values`. Getting this
axis order wrong produces a plausible-looking chart that is entirely wrong, so assert the shape first.

Round to four significant figures before comparing, as the other golden tests do. **Never round inside
the renderer** — there is a test guarding that.

## Deliverables

- `src/core/heatmapLayout.ts` — `heatmapRows()` (value space: both orderings, collapse, the symmetric
  colour domain, the f(x) line, the side-bar values) and `heatmapLayout()` (pixels: cell rects, axis
  marks). Split so the first is testable against the golden values without a pixel scale.
- `src/react/ShapHeatmap.tsx` — props `{ explanation, maxDisplay, faithfulOtherRow, classIndex, width,
  rowHeight, onFeatureClick, onSampleClick }`.
- `tests/heatmapLayout.test.ts`, `tests/golden.heatmap.test.ts`.
- Export from `index.ts` / `react.ts`.

## Interaction — this is where the heatmap earns its keep

The existing PNG labels its x axis "Instances" and nothing else, so a reader cannot tell which column
is which sample. That makes the supervised-clustering idea the chart exists for unusable.

* Hovering a column highlights it and shows the Sample's id and its Σφ.
* `onSampleClick` fires with the Sample's id, so the host app can open that Sample's waterfall. The
  data is already in memory, so this costs no request.

## Performance

Cells are `n × maxDisplay` — bounded by `maxDisplay`, not by the feature count, so 331 × 10 = 3,310
rects at the realistic maximum. SVG is fine. Render a row as one group rather than creating a React
element with its own handlers per cell.
