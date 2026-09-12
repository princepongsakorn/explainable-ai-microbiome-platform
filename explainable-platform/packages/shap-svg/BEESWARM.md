# Task brief: `<ShapBeeswarm>` — the hardest of the four

Third chart. Read `SPEC.md` and `CONTEXT.md` first. Follow the layering the bar and waterfall charts
already establish: pure geometry in `src/core/`, a thin component in `src/react/`, tests against
captured golden values. Reuse `parseExplanation`, `globalImportance`, `orderFeatures`,
`collapseToDisplay`, `formatShapValue`, `formatFeatureLabel` — do not write second copies.

## What it shows

One row per Feature, ordered by mean |φ| descending — the **same ordering the bar chart uses**, so
`globalImportance` + `orderFeatures` + `collapseToDisplay` apply unchanged. Within a row, one dot per
Sample at `x = φ`, spread vertically so overlapping dots stay visible, coloured by that Sample's
**feature value** (not its φ).

## The algorithm, from `shap/plots/_beeswarm.py` v0.49.1

### Point spreading — the part that makes it a beeswarm

Lines 398–410. Per row, independently:

```
nbins  = 100
quant  = round(100 * (x - min(x)) / (max(x) - min(x) + 1e-8))   // bin index per point
order  = argsort(quant)                                          // ties broken randomly, see below
layer  = 0
lastBin = -1
for ind of order:
    if quant[ind] !== lastBin: layer = 0                         // new bin resets the stack
    ys[ind] = ceil(layer / 2) * ((layer % 2) * 2 - 1)            // 0, +1, -1, +2, -2, ...
    layer  += 1
    lastBin = quant[ind]

ys *= 0.9 * (ROW_HEIGHT / max(ys + 1))                           // ROW_HEIGHT = 0.4
```

Note `max(ys + 1)` is `max(ys) + 1`, not `max(ys + 1)` elementwise-then-max of something else — they
are the same thing, but write it so the +1 is obvious.

**You cannot reproduce the point order, and you are not expected to.** The source shuffles and adds
`randn(N) * 1e-6` to break ties, so *which* point in a bin gets `+1` versus `-1` comes from numpy's
RNG. What is deterministic is the **multiset of |ys|** — that follows from the bin counts alone. The
golden files store sorted values for exactly this reason. Use a seeded PRNG of your own for tie-breaks
so your own output is stable across renders.

### Colour

Lines 414–447. Per row, independently — **this is why a global colour scale looks wrong on this data**:

```
vmin = percentile(featureValues, 5)
vmax = percentile(featureValues, 95)
if vmin === vmax: vmin = percentile(featureValues, 1);  vmax = percentile(featureValues, 99)
if vmin === vmax: vmin = min(featureValues);            vmax = max(featureValues)
if vmin > vmax:   vmin = vmax                           // rare numerical case, keep it

clipped = clamp(featureValue, vmin, vmax)
colour  = redBlue((clipped - vmin) / (vmax - vmin))
```

Relative abundances are long-tailed, so without the 5/95 clip a single dominant taxon washes out every
other dot in the row. Skipping this is the single most visible way to get beeswarm wrong.

`fixtures/colormaps.json` holds `red_blue` as a **256-entry sRGB lookup table** dumped from SHAP.
Interpolate linearly between entries. Do not re-derive it from Lch — matplotlib itself interpolates
linearly in sRGB between precomputed stops, so the table *is* the ground truth.

Dots whose feature value is missing are drawn separately in **`#777777`** (`_beeswarm.py:432`). Note
this is not the `#848484` the colormap uses for bad values; the NaN scatter passes its own colour.

Dot size is `s = 16` in matplotlib points²; pick an SVG radius that looks equivalent and make it a prop.

### Rows and ordering

Identical to bar: `max_display`, the faithful/corrected `faithfulOtherRow` switch, and the
`Sum of N other features` label all come from `collapseToDisplay`. The collapsed row's dots are the
summed φ of the hidden Features, and its colour axis uses the summed feature values.

## Golden values

`fixtures/tiny.beeswarm.golden.json` and `fixtures/real.beeswarm.golden.json`:

```jsonc
{
  "max_display": 10, "dot_size": 16, "nan_color": "#777777",
  "labels": ["Parvimonas_unclassified", "...", "Sum of 41 other features"],  // top to bottom
  "rows": [{
    "label": "Parvimonas_unclassified",
    "row_index": 9,
    "x_sorted": [-0.0485007, ...],            // the phi values in this row, sorted
    "jitter_sorted": [0.0, 0.0, ...],         // |y - row|, sorted — the multiset, not an order
    "vmin": 0.0, "vmax": 0.005838,
    "colour_values_sorted": [...]             // the clipped feature values, sorted
  }]
}
```

Compare **sets, not sequences**: sort your own output the same way before comparing. Round to four
significant figures first, as `tests/golden.bar.test.ts` does. **Never round inside the renderer** —
there is a test guarding that.

`vmin`/`vmax` are worth their own assertions: they are fully deterministic, they are where the
percentile logic lives, and getting them right is most of getting the chart right.

## Deliverables

- `src/core/beeswarmLayout.ts` — `beeswarmRows()` (value space: ordering, collapse, binning, jitter,
  per-row colour domain) and `beeswarmLayout()` (pixels). Split so the first is testable against the
  golden values without a pixel scale.
- `src/core/colormap.ts` — load the LUT, expose `sampleColormap(name, t)` with linear interpolation.
- `src/react/ShapBeeswarm.tsx` — props `{ explanation, maxDisplay, faithfulOtherRow, classIndex,
  width, rowHeight, seed, onFeatureClick }`.
- `tests/beeswarmLayout.test.ts`, `tests/colormap.test.ts`, `tests/golden.beeswarm.test.ts`.
- Export from `index.ts` / `react.ts`.

## Interaction

Hovering a dot shows the Feature name, its φ and its feature value. Follow `ShapBar`'s hover pattern —
pre-rendered elements toggled by state, not elements created on hover.

## Performance

The real fixture is 180 Samples × 10 rows = 1,800 dots; the large one would be 331 × 10. SVG handles
that, but do not create a React element per dot with its own handlers — render the dots of a row as
one group and resolve which dot was hovered from the event, or accept a single `<g>` per row with
pointer events on the row. Measure before optimising further.
