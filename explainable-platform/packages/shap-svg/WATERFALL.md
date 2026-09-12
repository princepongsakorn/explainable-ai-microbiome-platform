# Task brief: `<ShapWaterfall>` — the Local explanation chart

Second chart for this package. Read `SPEC.md` and `CONTEXT.md` first; the vocabulary there is
normative (one row is a **Sample**, one column is a **Feature**).

**Follow the existing bar implementation as the pattern.** `src/core/parse.ts`, `order.ts`,
`collapse.ts`, `format.ts`, `barLayout.ts` and `src/react/ShapBar.tsx` already establish the layering:
pure geometry in `core/`, a thin component in `react/`, tests against captured golden values. Reuse
`parseExplanation`, `formatShapValue` and `formatFeatureLabel` rather than writing new ones.

## What a waterfall shows

One Sample. Bars run from the Model output `f(x)` back to the Base value `E[f(X)]`, one per Feature,
largest |φ| at the **top**. It is the same additive decomposition the bar chart summarises across
Samples, drawn for a single row.

## The algorithm, verified against `shap/plots/_waterfall.py::waterfall_legacy` v0.49.1

The runtime calls `waterfall_legacy`, so that is what the golden files capture. Constants below are
from source, not from a description of it.

```
values      = explanation.values[sampleIndex]     // length p
baseValue   = explanation.baseValues[sampleIndex]
order       = argsort(-abs(values))               // descending |phi|, ties by ascending index
numFeatures = min(maxDisplay, p)
```

**Row assignment.** Row index counts *down*: `rng[i] = numFeatures - 1 - i`. So the largest |φ| sits
at the top of the chart and the Other features row, when present, is the bottom row (index 0).

**Bar positions — walk backwards from f(x), not forwards from the base.** This is the part that is
easy to get wrong:

```
loc = baseValue + sum(values)          // = f(x), the far end
numIndividual = (numFeatures === p) ? numFeatures : numFeatures - 1

for i in 0 .. numIndividual-1:
    sval = values[order[i]]
    loc -= sval                        // step back
    left  = loc                        // the bar's left edge in value space
    width = sval                       // signed
```

**The Other features row** (`_waterfall.py:149-160`), only when `numFeatures < p`:

```
remainingImpact = baseValue - loc      // === -(sum of the hidden phi)
width = -remainingImpact
left  = loc + remainingImpact          // lands exactly on baseValue
label = `${p - numFeatures + 1} other features`
```

Note the `+ 1`: the row absorbs the Feature ranked `numFeatures`, exactly as the bar chart's faithful
mode does. Implement the same `faithfulOtherRow` switch `collapseToDisplay` already has, defaulting
to the corrected behaviour (`maxDisplay` real Features plus a separate row labelled
`${p - maxDisplay} other features`).

**Colours.** Positive `#ff0051`, negative `#008bfb`. Bar's vertical rule at x = 0 has no counterpart
here — waterfall's reference lines are the two axis marks below. (For how a contribution of exactly
zero is coloured, see the note under Golden values; it differs from bar.)

**Arrow geometry.** Each bar is an arrow, not a rectangle: a rectangle plus a triangular tip.
matplotlib uses `head_length = 0.08` **inches** and converts to data units, because the head must stay
a constant size on screen regardless of the value scale. In SVG you are already in pixels, so this is
simpler, not harder — use a fixed pixel head and clamp it so a short bar never grows a head longer
than itself:

```
head = Math.min(Math.abs(endPx - startPx), HEAD_LENGTH_PX)   // HEAD_LENGTH_PX = 8
```

`bar_width = 0.8` of the row pitch (matplotlib's `width=0.8`), same ratio `barLayout` already uses.

A left-pointing (negative) arrow is the mirror image. Emit each as one `<polygon>`.

**Axis marks.** A dashed vertical rule at `baseValue`, labelled `E[f(X)]`, and one at `f(x)`, labelled
`f(x)`, both with their numeric value. Colour `#bbbbbb`, and a dashed horizontal separator per row in
`#cccccc`.

## Golden values

`fixtures/tiny.waterfall.golden.json` and `fixtures/real.waterfall.golden.json` record what SHAP
actually drew, captured by patching `matplotlib.axes.Axes.arrow`:

```jsonc
{
  "sample_index": 0, "sample_id": "...",
  "max_display": 10,
  "base_value": 0.3885, "fx": 0.322395,
  "labels": ["Peptostreptococcus_stomatis", "...", "41 other features"],  // top to bottom
  "arrows": [ { "x": 0.323824, "row": 8, "dx": 0.0237027,
                "head_length": 0.00165539, "bar_width": 0.8, "color": "#ff0051" } ]
}
```

All of these are in **value space, not pixels**.

Three traps, all of them real:

* **`dx` is the arrow body, not the contribution.** `_waterfall.py` passes `dist - hl_scaled` as `dx`
  and puts the remainder in `head_length`, so the Feature's φ is `dx + head_length` (with the head
  signed the same way as `dx`). The capture now also records `contribution`, which is that sum —
  use it. `head_length` is matplotlib's inch-to-data conversion and is *not* what your SVG head
  should be.
* **Arrows come positives-first, then negatives**, because the source draws them in two loops. Their
  order is not the ranking. Map an arrow back to its rank through its `row`.
* **`labels` is top-to-bottom** — the reverse of the raw tick order — and corresponds to
  `faithfulOtherRow: true`. It keeps underscores; turning them into spaces is the renderer's job.

One more asymmetry worth knowing: waterfall treats a contribution of exactly zero as **positive**
(`_waterfall.py:115` tests `sval >= 0`), while bar treats it as **negative** (`_bar.py:268` tests
`<= 0`). SHAP is not self-consistent here; match each plot to its own source.

Round to four significant figures before comparing, exactly as `tests/golden.bar.test.ts` does, and
for the same reason. **Never round inside the renderer** — `tests/golden.bar.test.ts` has a test
guarding that, and it applies here too.

## Deliverables

- `src/core/waterfallLayout.ts` — `waterfallRows()` (value-space: ordering, backward walk, other row)
  and `waterfallLayout()` (pixels: polygons, axis marks). Split them so the first is testable against
  the golden values without a pixel scale.
- `src/react/ShapWaterfall.tsx` — props `{ explanation, sampleIndex, maxDisplay, faithfulOtherRow,
  classIndex, width, rowHeight, onFeatureClick }`.
- `tests/waterfallLayout.test.ts` and `tests/golden.waterfall.test.ts`.
- Export both from `index.ts` / `react.ts`.

## Invariant worth a test of its own

The displayed widths plus the Other features row must sum to `f(x) - baseValue`, in **both** modes and
at every `maxDisplay`. It is a re-partition of one vector, so this identity cannot be approximate
beyond the 1e-3 rounding tolerance. If it fails, the backward walk is wrong.
