# Five more SHAP plots — design

Status: agreed 2026-09-16, not yet implemented.
Extends the Decision log in [`docs/shap-interactive-frontend-feasibility.md`](../../shap-interactive-frontend-feasibility.md)
(D1–D24) and the normative contract in [`docs/shap-explain-spec.md`](../../shap-explain-spec.md).
Vocabulary is [`CONTEXT.md`](../../../CONTEXT.md)'s — **Sample**, **Feature**, **SHAP value**,
**Base value**, **Model output**, **Other features row**, **Species view / Genus view**.

## Why these five

`shap-svg` 0.2.4 ships four charts — bar, beeswarm, heatmap (Global) and waterfall (Local). All four
answer one question: *which Features did the model use*. Five more are added because each answers a
question the existing four cannot.

The scope of the surrounding thesis work is an **automated XAI pipeline applying SHAP**, not a
clinical product. The real user's workflow is unknown, so nothing here may depend on knowing whether
a prediction was right: there is no true-label column and none is proposed. Every chart below is
computable from the Explanation payload as it already exists, plus the predicted class and
probability the platform already stores.

| Chart | Question it answers | Scope |
| --- | --- | --- |
| `Plots.scatter` | Is more of this taxon always worse, or is there a threshold? | Global |
| `Plots.embedding` | Which Samples were decided for the same reasons? | Global |
| `Plots.decision` | Where do Samples' decision paths diverge? | Global + Local |
| `Plots.force` | The waterfall, compact enough for a table row | Local |
| `Plots.bar` + `clustering` | Which taxa split credit with each other? | Global |

## Decisions

Numbering continues the original log.

| # | Decision | Chosen |
| --- | --- | --- |
| D25 | Rollout | **All five in one release, 0.3.0.** Not the staged D19 style — the four new charts share layout and colour code, and splitting them would mean five PRs over near-identical diffs |
| D26 | Embedding projection | **PCA in the browser**, matching `shap.plots.embedding`, deterministic. Optional `coords` prop accepts externally computed positions (e.g. UMAP from Python) |
| D27 | Clustering distance | **Selectable by prop**: SHAP-value correlation, relative-abundance correlation, or an externally supplied linkage matrix |
| D28 | Scatter and absent taxa | **A separate "Absent" band** left of a log-scaled x axis, not a point at x=0 on a linear axis |
| D29 | Decision plot at n = 500 | **Draw every Sample** — thin, translucent, coloured by Model output. Consistent with D7. `sampleIndices` subsets |
| D30 | Supervised clustering target | **Model output f(x)**, never a true label. Reads as "can taxon j stand in for taxon i in explaining what the model produced" |
| D31 | Supervised clustering location | **Python, as a separate stream.** Optional payload extra; `shap-svg` 0.3.0 ships without waiting for it |
| D32 | API shape | `clustering` is a **prop on `Plots.bar`**, not a new entry — matching `shap.plots.bar(exp, clustering=…)`. `Plots` goes from 4 entries to 8 |
| D33 | Which Feature the scatter draws | **A prop.** The selector UI belongs to the app, per D21 (the package renders, it does not build controls) |
| D34 | Scatter colour Feature | **Auto-picked** by an interaction heuristic, overridable by prop, disableable |
| D35 | Colour ramp | `red_blue` stays the default for fidelity; a `colormap` prop offers `red_white_blue`, whose midpoint is actually neutral |
| D36 | Decision plot x limits | **Always symmetric** about the Base value — what SHAP's comment promises and its code does not always deliver |
| D37 | Interaction strength | The scatter **shows the score** behind its colour Feature, normalised, and declines to colour at all below a threshold |
| D38 | Genus view | All four new charts take `groupByGenus`, the prop the existing charts already use |
| D39 | Dose–response | The scatter draws a **binned-median trend line** over detected Samples, plus a mean marker on the Absent band |
| D40 | Table view | Every new chart emits a real `<table>` of its own data, visually hidden by default |

## Package surface, 0.3.0

```ts
import { Plots } from "shap-svg/react";

Plots.bar        // + clustering, clusteringCutoff
Plots.beeswarm   // unchanged
Plots.heatmap    // unchanged
Plots.waterfall  // unchanged
Plots.scatter    // new
Plots.embedding  // new
Plots.decision   // new
Plots.force      // new
```

Exported prop types gain `ScatterPlotProps`, `EmbeddingPlotProps`, `DecisionPlotProps`,
`ForcePlotProps`, alongside the four that exist.

**Bundle cost.** One import still pulls every chart — the trade accepted when `Plots` was chosen over
tree-shakable named exports. Measured at ~30 KB minified for four charts; eight is expected to land
near ~55 KB. Accepted knowingly; revisit only if a consumer complains.

**Shared props on all four new charts.** `colormap` (`"red_blue" | "red_white_blue"`, default
`"red_blue"`) per D35; `groupByGenus` (default `false`) per D38, aggregating through the existing
`taxonomy.ts` — the name the four existing charts already use, rather than a second spelling; and `tableView` (`"hidden" | "visible" | "none"`, default
`"hidden"`) per D40, which emits a real `<table>` of the chart's own rows next to the SVG. Each chart
also exports a pure function returning those rows, for a consumer that would rather render its own.

`PlotLabels` gains keys for the new wording, additively, defaults in SHAP's own words:
`absent`, `absentWithCount(n)`, `principalComponent(index, varianceRatio)`, `cumulativeShapValue`,
`clusterDistance`, `interactionScore(value)`, `weakInteraction`, `trend`, `tableCaption`. Existing
keys are untouched.

## The charts

### `Plots.scatter` — dependence

x is a Feature's relative abundance, y is that Feature's SHAP value, one point per Sample.

The x axis is in two parts. Samples where the taxon was not detected form an **Absent band** at the
left, separated by a visible gap and carrying its own tick labelled `Absent (n = …)`. Everything
above zero is drawn on a log scale to the right of the gap. A horizontal rule marks y = 0.

This is a deliberate deviation from `shap.plots.scatter`, which is linear and would pile every absent
Sample into one opaque vertical stripe. It is, however, the same device SHAP already uses for a
different problem: `_scatter.py` draws Samples whose Feature value is `NaN` as tick marks at
`xlim[0]`, off the axis proper. An Absent band does for a true zero what SHAP does for a missing
value. Microbiome abundance data is zero-inflated; "not detected"
and "detected but low" are different statements, and D4 already fixed that a zero here is a true
biological zero rather than missing data.

Points are coloured by a second Feature's value on the existing SHAP colormap with the existing
colour bar. That Feature is chosen by SHAP's `approximate_interactions` algorithm itself, not an approximation
of it — it is short enough to port exactly. Sort Samples by the plotted Feature's value; walk them in
windows of `max(min(floor(n / 10), 50), 1)`; for every other Feature sum `|Pearson r|` between that
window's values and the correspondingly sorted SHAP values, skipping the Feature itself and any
Feature that is all but zero; take the Feature with the largest sum. (SHAP also scores a
missing-value indicator and takes the larger of the two; D4 forbids `NaN` in the payload, so that
branch is dead here.) `colorFeature` overrides it; `colorFeature` overrides it, `"none"`
disables colouring. Following `_scatter.py`, the colour scale is clipped to the 5th and 95th
percentiles of the colour Feature — falling back to min and max when those coincide — and the colour
bar is suppressed when the chosen colour Feature is the Feature being plotted. The interaction score
is shown beside the colour bar, and below `colorFeatureMinScore` the chart draws in a single hue and
says why (D37).

A trend line runs through the detected Samples: the median SHAP value per window of sorted
abundance, using the same window size the interaction score uses. The Absent band carries a mean
marker of its own, so "not detected" can be read against the low end of "detected" (D39).

Props: `explanation`, `feature` (name or index, required), `colorFeature`, `colorFeatureMinScore`
(default 0.2), `xScale` (`"log" | "linear"`, default `"log"`), `trend` (default on), plus the shared
`classIndex`, `labels`, `colorBar`, `colormap`, `groupByGenus` and `tableView`, and the Sample click-through
callback the beeswarm and heatmap already take.

### `Plots.embedding`

PCA of the **SHAP matrix**, not of the abundance matrix. Samples that the model decided for similar
reasons land near each other — supervised clustering, in SHAP's own framing.

The matrix is centred per Feature — `sklearn.decomposition.PCA` centres without scaling, and
`_embedding.py` uses it with no other preprocessing — then the top two components are found by power
iteration with deflation on the n x n Gram matrix. The starting vector is fixed and each component's
sign is normalised so that its largest-magnitude loading is positive, mirroring what `svd_flip` does
inside scikit-learn, so repeated renders of the same payload give identical coordinates. Axes are labelled with the variance each component explains, e.g.
`SHAP PC1 (42% of SHAP variance)`.

`coords` accepts `[number, number][]` and skips the PCA entirely — SHAP spells the same escape hatch
as a non-string `method` argument; which is how a UMAP or t-SNE
projection computed in Python would be displayed. When `coords` is supplied the axis labels fall back
to generic wording, since variance ratios are meaningless for a non-linear projection.

Points are coloured on the **diverging** SHAP ramp, as `_embedding.py` does with `colors.red_blue`.
The default is `"sum"` — the sum of a Sample's SHAP values, which is SHAP's own `"sum()"` option and
equals the Model output minus the Base value. `colorBy` also accepts a Feature name, colouring by
that Feature's SHAP value, or `"none"`.

Σφ is used rather than f(x) deliberately. They differ by the Base value, which is constant for the
five TreeExplainer-backed models and therefore only shifts the colour scale; for the permutation-backed
model the Base value is genuinely per Sample, and Σφ is the quantity SHAP colours by.

### `Plots.decision`

x is the Model output axis. y lists Features in ascending global importance from the bottom up. Each
Sample is a path that starts at the Base value and accumulates its SHAP values upward, ending at
f(x). Where paths diverge is where the model treated Samples differently.

A vertical rule marks the Base value, as `_decision.py` draws with `axvline`.

**This chart has no Other features row.** When every Feature is shown the path starts exactly at the
Base value; when it is not, `_decision.py` starts the path at the Base value plus the SHAP values of
every Feature it is *not* showing, and the first drawn segment begins there. The fold is implicit in
where the path begins, and an explicit Other row would draw the same quantity twice. D10's Other
features row applies to bar, beeswarm, waterfall and heatmap; it does not apply here.

Every Sample is drawn: 1px strokes, coloured by the path's final value — f(x) — on the diverging SHAP
ramp. The colour scale spans the x limits, and those limits are always symmetric about the Base
value (D36), so the ramp's neutral midpoint lands exactly on the Base value rather than on zero or on
a point that drifts with the data. Hovering isolates one path, thickening it to 2px as SHAP's
`highlight` does, and shows its Sample label and f(x). `sampleIndices` renders a subset without
recomputing anything.

Opacity falls as n grows. SHAP leaves `alpha` at 1.0 and expects the caller to set it; this is one of
the few places where drawing every Sample by default (D7, D29) forces a choice SHAP does not make.

Feature ordering comes from the existing `order.ts`, reversed. SHAP orders this chart by ascending
`sum|φ|` where `order.ts` uses `mean|φ|`; the two differ by a factor of n and produce an identical
order, so nothing new is needed. `collapse.ts` is **not** used — see the paragraph on the implicit
fold above.

SHAP's own default here shows the last 20 Features, and it refuses outright above 2,000 Samples or
200 displayed Features unless warnings are silenced. A 500-Sample cap (D8) sits comfortably inside
what SHAP itself considers drawable.

### `Plots.force` — local

One horizontal bar for one Sample. Positive SHAP values push from the left, negative from the right,
and they meet at f(x), which is marked and labelled, with the Base value marked separately as
`_force_matplotlib.py` does. The two directions are labelled "higher" and "lower" either side of
f(x).

Segments run outward from f(x) in descending magnitude, so the largest contributions sit against the
meeting point. A segment is labelled when it accounts for at least 5% of the total effect — SHAP's
`contribution_threshold`, which its matplotlib renderer receives as `min_perc` — rather than by
measuring pixels. The rest are identified on hover.

`shap.plots.force` passes **every** Feature to its renderer and lets the JavaScript bundle deal with
crowding. At p = 865 that is not an option here, so this chart takes `maxDisplay` and collapses the
tail through `collapse.ts` like the waterfall does. That is an addition rather than a deviation:
SHAP has no behaviour to match.

It reuses the waterfall's Feature ordering and row collapsing wholesale. It exists because the
waterfall needs vertical space proportional to `maxDisplay`, which makes it unusable inside a row of
a Sample list; this fits in one line.

Props mirror the waterfall's, including `sampleIndex`.

### `Plots.bar` with `clustering`

```ts
clustering?: "shap" | "data" | number[][] | false   // default false
clusteringCutoff?: number
```

`false` keeps today's behaviour exactly, which is what makes 0.3.0 a minor bump rather than a major
one. `"shap"` clusters on `1 − |Pearson r|` between Features' SHAP values across Samples; `"data"`
does the same on relative abundances, which reads as taxon co-occurrence. A `number[][]` is taken as
a SciPy linkage matrix, shape `(k − 1) × 4` — the shape `_bar.py` validates — and drawn as given.
`clusteringCutoff` defaults to 0.5, SHAP's default, and the cutoff is drawn as a labelled vertical
line beside the dendrogram.

**Turning clustering on is not decoration.** `_bar.py` does two further things, and the design has to
account for both.

First, it **changes the row order**. The order stops being plain descending mean |φ| and is relaxed
by `get_sort_order` to respect the partition tree wherever a connection sits below the cutoff. So the
set of rows that ends up displayed depends on the clustering — which means the clustering cannot be
computed over "the displayed rows", because that is circular.

The clustering is therefore computed over the **top K Features by mean |φ|**, K = 50, and the display
order is derived from that. At K = 50 and n = 500 the correlation matrix is about 1.25M
multiply-accumulates, which is still nothing.

Second, when the cut point at `maxDisplay` falls inside a cluster tighter than the cutoff, SHAP
**merges the two Features into a single row**, summing their SHAP values and joining their names, and
repeats until the cut lands on a clean break. This is deferred, not implemented — see the deviations
ledger. With it deferred, the cut can land inside a cluster, which the dendrogram will show as a
connection running off the bottom edge.

## Core modules

Framework-free, no new runtime dependency — the package still has only React as an optional peer.

| New file | Responsibility |
| --- | --- |
| `src/core/pca.ts` | Centre, power iteration with deflation, two components plus variance ratios |
| `src/core/hclust.ts` | Average-linkage agglomerative clustering over the top K = 50 Features, emitting a SciPy-shaped linkage matrix, plus SHAP's cophenetic-distance order relaxation |
| `src/core/interactions.ts` | Pick the Feature that interacts most with a given Feature — a direct port of `approximate_interactions` |
| `src/core/dendrogram.ts` | Port of SHAP's `dendrogram_coords`: line coordinates for a tree drawn in a *given* leaf order, which SciPy cannot produce |
| `src/core/scatterLayout.ts` | Absent band, log scale, point positions |
| `src/core/embeddingLayout.ts` | Point positions, axis labels |
| `src/core/decisionLayout.ts` | Cumulative paths, opacity by n |
| `src/core/forceLayout.ts` | Segment widths and label fitting |

Reused unchanged: `parse`, `collapse`, `order`, `colormap`, `colorBar`, `ticks`, `tooltip`, `format`,
`labels`, `taxonomy`, `rowSort`.

The diverging ramp the new charts need costs nothing: `colormaps.json` already carries `red_blue` and
`red_white_blue` as 256-entry lookup tables dumped from `shap.plots.colors`.

`hclust.ts` emitting SciPy's linkage format is what lets the browser path and the Python path feed the
same prop.

## Python stream — supervised redundancy

Separate work, separate timeline. `shap-svg` 0.3.0 does not depend on it.

`shap.utils.hclust(X, y)` measures redundancy by training XGBoost models: one univariate model per
Feature, then one per ordered pair to see whether Feature j can reproduce Feature i's univariate
model of y. It needs no new dependency — `xgboost==2.1.3`, scikit-learn, SciPy and numba are already
in `kserve-custom-runtime/requirements.txt`.

It is, however, **quadratic in model fits**: p + p² − p of them.

| p | Fits | Verdict |
| --- | --- | --- |
| 865 (`crc-rynazal-notebook`) | ~748,000 | Impossible |
| 221 (`crc-curatedcrc-rf`) | ~48,600 | Minutes per Prediction |
| 50 | ~2,500 | Seconds |
| 30 | ~900 | Under a second |

So it runs over the **top K Features by mean |φ|**, K = 50, never over all p. Nothing is lost: the bar
chart never displays more rows than that.

`y` is the Model output f(x) (D30). Two matrices are computed, one for the Species view and one for
the Genus view, because aggregating to Genus changes the Feature set and invalidates a Species-view
clustering. With clustering on, the frontend clamps `maxDisplay` to K.

The payload gains one optional extra, additive per §1.1 of the spec:

```jsonc
"clustering": {
  "metric": "xgboost_distances_r2",
  "species": { "feature_indices": [...], "linkage": [[...], ...] },
  "genus":   { "feature_names":   [...], "linkage": [[...], ...] }
}
```

The Species entry keys by index into `feature_names`; the Genus entry keys by name, because a Genus
is derived in the browser and has no index in the payload.

A payload without it renders exactly as before. Determinism holds: `train_test_split` is seeded at
`random_state=0` and the XGBoost parameters are fixed. (The unsupervised `cosine` path inside
`hclust` adds unseeded `randn * 1e-8` jitter and is not used.)

## Deviations from SHAP

Kept as a ledger, per D1.

1. **Clustered bar, browser path** uses unsupervised correlation where SHAP uses supervised
   `xgboost_distances_r2`. A browser cannot train gradient-boosted trees. The Python stream restores
   the faithful measure for consumers that want it.
2. **Row merging under clustering is not implemented.** SHAP merges two Features into one row when
   the display cut falls inside a tight cluster. It interacts with the Other features row (D10) in a
   way that deserves its own decision, so 0.3.0 cuts the list without merging.
3. **Dependence scatter** has an Absent band and a log x axis; SHAP is linear throughout.
4. **Linkage method.** The browser path uses average linkage; `shap.utils.hclust` defaults to single
   linkage. Average is chosen because single linkage chains badly on correlation distances between
   taxa that share a few Samples. The Python path keeps SHAP's default.
5. **Decision plot opacity** falls as n grows; SHAP fixes `alpha` at 1.0 and leaves it to the caller.
   A consequence of drawing all 500 Samples by default.
6. **Embedding** and **decision** otherwise match SHAP, including the diverging colour ramp.
   **Force** matches the layout of SHAP's matplotlib renderer — which SHAP's own docstring calls
   "less developed" than its JavaScript one — without shipping any JavaScript bundle.

## Where this improves on SHAP

D1 licenses deliberate deviation. These six are chosen, not accidental, and each is grounded in
something measured or read rather than in taste.

### The colour ramp's midpoint is inverted (D35)

`colors.red_blue` is SHAP's default diverging ramp for the scatter, embedding and decision plots.
Measuring OKLab lightness on the 256-entry lookup table the package already ships:

| Stop | Colour | L |
| --- | --- | --- |
| Negative pole | `#008bfb` | 0.636 |
| **Midpoint (φ = 0)** | `#9c23ad` | **0.512** |
| Positive pole | `#ff0051` | 0.635 |

The midpoint is darker than both poles, so the taxa that contributed *nothing* are drawn with the
most visual weight on the chart — the opposite of what a diverging ramp is for. SHAP's own
`red_white_blue` has L = 1.000 at the midpoint and the correct shape; `colormaps.json` already carries
it, so this costs nothing to offer.

Colour-blind separation is not the problem here: running the three stops through a CVD validator
passes every check, worst adjacent pair ΔE 13.5 under deuteranopia. The defect is visual weight, not
discriminability. `red_blue` therefore stays the default and the choice is a prop.

### The decision plot's axis is not symmetric (D36)

`_decision.py` carries the comment "create a symmetric axis around base_value" above a branch that
does not always produce one:

```python
n, m = (base_value - xmin), (xmax - base_value)
if n > m:
    xlim = (base_value - n, base_value + m)   # == (xmin, xmax)
else:
    xlim = (base_value - m, base_value + m)
```

Only the second branch is symmetric. Because the colour scale is clamped to `xlim`, an asymmetric
axis slides the ramp's neutral point off the Base value, and a Sample sitting exactly at the Base
value stops being drawn as neutral. This design always takes the symmetric form.

### The interaction score is hidden (D37)

`approximate_interactions` returns a ranking and `_scatter.py` takes `[0]` without ever asking how
strong that winner is. A colour Feature chosen from noise looks exactly like one chosen from a real
interaction.

The score is therefore surfaced next to the colour bar. It is normalised by the number of windows, so
it reads as a mean `|Pearson r|` in 0–1 and is comparable across Samples counts — SHAP's raw sum is
not. Below `colorFeatureMinScore` (default 0.2) the chart declines to colour and says why.

### The dose–response question deserves an answer (D39)

The scatter exists to answer "is more of this taxon always worse, or is there a threshold". SHAP
draws the cloud and stops.

A trend line is drawn over the **detected** Samples only, as the binned median of SHAP values in
windows of sorted abundance — the same windowing `approximate_interactions` uses, so one constant
governs both. A binned median was chosen over LOESS deliberately: it needs no bandwidth parameter, no
dependency, and it cannot invent a curve the data does not contain. The Absent band carries its own
mean marker, so the reader can compare "not detected" against the low end of "detected" directly.

### Nothing SHAP draws can be read without seeing it (D40)

A matplotlib PNG is opaque to a screen reader, to text search and to anyone recomputing a number from
a figure. Each new chart emits a real `<table>` beside its SVG, visually hidden by default and
switchable to visible, plus a pure function returning the same rows for a consumer that wants to
render its own. This applies to the four new charts in 0.3.0; retrofitting the original four is
follow-up work, kept out so the diff stays honest.

### Two more, already in the design

The clustered bar **keeps taxa as separate rows** and draws the cluster bracket, where SHAP fuses two
Features into one row labelled `A + B`. And the embedding **keeps its axes**, labelled with the
variance each component explains, where `_embedding.py` calls `plt.axis("off")` and discards the
ratios entirely.

## Checked against SHAP's source

Every claim above about what SHAP does was read out of `shap` 0.49.1 as installed in this repo's
`.venv`, not recalled. `shap.utils.hclust` was additionally compared against 0.46.0 in `mlflow-env`:
the two differ only in formatting and type annotations, so the cost table holds for both.

| Claim | Source | Result |
| --- | --- | --- |
| Embedding is a 2-component PCA of the SHAP matrix | `plots/_embedding.py` | Confirmed — `PCA(2).fit_transform(shap_values)` |
| An externally computed 2-D projection can be passed in | `plots/_embedding.py` | Confirmed — the `method` argument accepts an (n x 2) array |
| Scatter picks its colour Feature automatically | `plots/_scatter.py` | Confirmed — `approximate_interactions(...)[0]` under `interaction_index="auto"` |
| Scatter has no log option | `plots/_scatter.py` | Confirmed — only `xmin`/`xmax` |
| Decision orders Features by ascending importance, bottom up | `plots/_decision.py` | Confirmed — `argsort(sum(abs(shap_values), axis=0))` |
| Decision colours by the path's final value | `plots/_decision.py` | Confirmed — `m.to_rgba(cumsum[i, -1])` |
| Force meets positive and negative pushes at f(x) | `plots/_force_matplotlib.py` | Confirmed |
| `clustering` takes a `(k-1) x 4` linkage matrix | `plots/_bar.py` | Confirmed — validated at line 122 |
| `clustering_cutoff` defaults to 0.5 | `plots/_bar.py` | Confirmed |
| `xgboost_distances_r2` is quadratic in model fits | `utils/_clustering.py` | Confirmed — p univariate fits, then a nested p x p loop |
| Decision paths begin at the Base value | `plots/_decision.py` | Confirmed when all Features are shown; otherwise they begin at the Base value plus the hidden Features' SHAP values |
| Decision has an Other features row | `plots/_decision.py` | **False** — the remainder is folded into where the path starts |
| The decision colour scale is centred on the Base value | `plots/_decision.py` | Confirmed — `set_clim(xlim)`, and `xlim` is built around the Base value |
| `approximate_interactions` is portable as-is | `utils/_general.py` | Confirmed — windowed `|Pearson r|`, no model calls |
| The dendrogram is drawn to the right of the bars | `plots/_bar.py` | Confirmed — its x positions are offset past `xmax` |
| Force subsets Features before drawing | `plots/_force.py` | **False** — it passes all p and lets its JavaScript renderer cope |
| Force's label threshold is 5% of total effect | `plots/_force.py` | Confirmed — `contribution_threshold=0.05` |

Five claims across the first two drafts of this document were **wrong** and are corrected above.

1. Both new Global charts were specified with a sequential colour ramp. SHAP uses the diverging
   `colors.red_blue` in both, and it is the better choice anyway: a cumulative path's endpoint and a
   sum of signed SHAP values are both quantities with a meaningful midpoint.
2. The clustered bar was described as a dendrogram drawn alongside an unchanged chart, computed over
   the displayed rows. Clustering in fact reorders the rows, so computing it from the displayed rows
   is circular. Hence K = 50.
3. Row merging was missed entirely. Now deferred explicitly rather than silently.
4. The embedding's default colour was given as the Model output. SHAP's equivalent is the sum of SHAP
   values, which differs by the Base value.
5. The decision plot was specified with an Other features row taken from `collapse.ts`. It has none —
   the Features it does not show are folded into the x position where each path starts, so an
   explicit row would draw that quantity a second time.

## Testing

Unchanged in kind from the four existing charts.

Unit tests per core module: PCA returns identical coordinates across runs and matches a
hand-computed answer on a small matrix; `hclust` reproduces a dendrogram computed by hand; the Absent
band splits Samples correctly including the all-zero and no-zero edge cases; every decision path ends
at `base + Σφ` within 1e-3, the tolerance invariant I3 requires.

The improvements get their own tests: the decision plot's x limits are symmetric about the Base
value for both orderings of the data, including the case SHAP gets asymmetric; the interaction score
is normalised to 0–1 and a below-threshold score suppresses colouring; the trend line's windows match
the interaction code's window size on the same input; and each new chart's `<table>` carries one row
per drawn row with the same numbers the SVG draws.

Golden tests per chart against `fixtures/real.json`, mirroring `golden.beeswarm.test.ts` and its
siblings. `plots.test.ts` extends to all eight entries.

**No fixture regeneration.** The payload contract does not change, so `tiny.json`, `real.json` and
`large.json` are used as they are. `large.json` doubles as the performance check for PCA at n = 500.

## Release

One branch carrying all five, one PR, then `chore(release): 0.3.0` on `main` — the existing workflow
publishes to npm and cuts the GitHub Release. The app then takes `shap-svg@0.3.0` and wires the new
charts into `components/shap/ExplanationCharts.tsx`, extending `RESEARCH_LABELS` with the new keys.

During development the app consumes an `npm pack` tarball rather than a published version.

Screenshots for review are captured from the running app, not from tests.

## Out of scope

Deliberately excluded, with reasons.

* **True labels and anything needing them** — ROC, PR, calibration, confusion matrix, differential
  abundance, model monitoring. Parked until the real workflow is known.
* **Ecology charts** — composition stacked bar, alpha diversity, beta diversity ordination on
  Bray–Curtis, prevalence–abundance. These explain the data rather than the model, and belong to the
  app if anywhere, never to `shap-svg`.
* **UMAP or t-SNE in the browser.** The `coords` prop is the supported path.
* **A Feature selector UI** for the scatter. D21: the package renders.
