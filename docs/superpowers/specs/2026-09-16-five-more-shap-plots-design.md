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

`PlotLabels` gains keys for the new wording, additively, defaults in SHAP's own words:
`absent`, `absentWithCount(n)`, `principalComponent(index, varianceRatio)`, `cumulativeShapValue`,
`clusterDistance`. Existing keys are untouched.

## The charts

### `Plots.scatter` — dependence

x is a Feature's relative abundance, y is that Feature's SHAP value, one point per Sample.

The x axis is in two parts. Samples where the taxon was not detected form an **Absent band** at the
left, separated by a visible gap and carrying its own tick labelled `Absent (n = …)`. Everything
above zero is drawn on a log scale to the right of the gap. A horizontal rule marks y = 0.

This is a deliberate deviation from `shap.plots.scatter`, which is linear and would pile every absent
Sample into one opaque vertical stripe. Microbiome abundance data is zero-inflated; "not detected"
and "detected but low" are different statements, and D4 already fixed that a zero here is a true
biological zero rather than missing data.

Points are coloured by a second Feature's value on the existing SHAP colormap with the existing
colour bar. That Feature is chosen automatically by an interaction heuristic equivalent to SHAP's
`approximate_interactions`; `colorFeature` overrides it, `"none"` disables colouring.

Props: `explanation`, `feature` (name or index, required), `colorFeature`, `xScale`
(`"log" | "linear"`, default `"log"`), plus the shared `classIndex`, `labels`, `colorBar`, and the
Sample click-through callback the beeswarm and heatmap already take.

### `Plots.embedding`

PCA of the **SHAP matrix**, not of the abundance matrix. Samples that the model decided for similar
reasons land near each other — supervised clustering, in SHAP's own framing.

The matrix is centred per Feature, then the top two components are found by power iteration with
deflation on the n x n Gram matrix. The starting vector is fixed, so repeated renders of the same
payload give identical coordinates. Axes are labelled with the variance each component explains, e.g.
`SHAP PC1 (42% of SHAP variance)`.

`coords` accepts `[number, number][]` and skips the PCA entirely, which is how a UMAP or t-SNE
projection computed in Python would be displayed. When `coords` is supplied the axis labels fall back
to generic wording, since variance ratios are meaningless for a non-linear projection.

Points are coloured by Model output on a sequential ramp by default; `colorBy` accepts a Feature name
for colouring by that Feature's SHAP value, or `"none"`.

### `Plots.decision`

x is the Model output axis. y lists Features in ascending global importance from the bottom up. Each
Sample is a path that starts at the Base value and accumulates its SHAP values upward, ending at
f(x). Where paths diverge is where the model treated Samples differently.

Every Sample is drawn: 1px strokes, opacity scaled down as n grows, coloured by f(x) on the same
sequential ramp the embedding uses. Hovering isolates one path and shows its Sample label and f(x).
`sampleIndices` renders a subset without recomputing anything.

Feature ordering and the Other features row come from the existing `order.ts` and `collapse.ts`, so
`maxDisplay` and the corrected-versus-faithful Other row behave exactly as they do elsewhere.

### `Plots.force` — local

One horizontal bar for one Sample. Positive SHAP values push from the left, negative from the right,
and they meet at f(x), which is marked. Segments wide enough to hold text are labelled; the rest are
identified on hover.

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
a SciPy linkage matrix, shape `(k − 1) × 4`, and drawn as given.

The dendrogram is drawn to the right of the bars. It is computed over **displayed rows only**
(at most `maxDisplay + 1`), which keeps it at O(k²n) and therefore free.

## Core modules

Framework-free, no new runtime dependency — the package still has only React as an optional peer.

| New file | Responsibility |
| --- | --- |
| `src/core/pca.ts` | Centre, power iteration with deflation, two components plus variance ratios |
| `src/core/hclust.ts` | Average-linkage agglomerative clustering, emitting a SciPy-shaped linkage matrix |
| `src/core/interactions.ts` | Pick the Feature that interacts most with a given Feature |
| `src/core/scatterLayout.ts` | Absent band, log scale, point positions |
| `src/core/embeddingLayout.ts` | Point positions, axis labels |
| `src/core/decisionLayout.ts` | Cumulative paths, opacity by n |
| `src/core/forceLayout.ts` | Segment widths and label fitting |

Reused unchanged: `parse`, `collapse`, `order`, `colormap`, `colorBar`, `ticks`, `tooltip`, `format`,
`labels`, `taxonomy`, `rowSort`.

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
2. **Dependence scatter** has an Absent band and a log x axis; SHAP is linear throughout.
3. **Linkage method.** The browser path uses average linkage; `shap.utils.hclust` defaults to single
   linkage. Average is chosen because single linkage chains badly on correlation distances between
   taxa that share a few Samples. The Python path keeps SHAP's default.
4. **Embedding** and **decision** match SHAP. **Force** matches SHAP's layout without its JavaScript
   bundle.

## Testing

Unchanged in kind from the four existing charts.

Unit tests per core module: PCA returns identical coordinates across runs and matches a
hand-computed answer on a small matrix; `hclust` reproduces a dendrogram computed by hand; the Absent
band splits Samples correctly including the all-zero and no-zero edge cases; every decision path ends
at `base + Σφ` within 1e-3, the tolerance invariant I3 requires.

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
