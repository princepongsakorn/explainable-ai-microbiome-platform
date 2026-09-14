# Replacing SHAP PNGs with JSON + interactive frontend charts: feasibility note

Context for anyone (human or LLM) picking this up: today `kserve-custom-runtime/kserve-shap-multi-modelserver.py`
renders SHAP plots with matplotlib and ships base64 PNGs; NestJS uploads them to GCS; the Next.js frontend
puts them in an `<img>`. The question is whether the Python service can instead return SHAP **values** as
JSON and the frontend can draw SHAP-look-alike charts that are actually interactive (hover, adjustable
`max_display`, sorting, zoom, global → local click-through).

**Short answer: yes, and the hard part is not the maths — it is the payload size and the "Sum of N other
features" semantics.** Every number the plots draw is derivable from three arrays (`values`, `data`,
`base_values`) plus `feature_names`. Nothing in beeswarm / bar / waterfall / heatmap calls back into the
model. Details, with sources, below.

---

## Decision log

Settled 2026-09-11/12 in a structured design interview (24 decisions over 5 rounds). Everything below is
decided; the *Open questions* section at the end of this note is superseded by this log except where it is
explicitly marked still-open.

### Framing

This work is **not committed to the thesis**. It started as the author's own idea; if it turns out well it
may be folded in, or written up as a **separate paper**. That materially lowers the value of pixel-parity
with matplotlib and raises the value of getting the interaction right — several decisions below turn on it.

### Where the follow-on documents live

* [`CONTEXT.md`](../CONTEXT.md) — the glossary. **Sample** is the canonical term for one row at the
  payload and package layer; **Prediction Record** is the platform's name for the same thing. D24
  originally wrote that optional field as `record_ids`; it is `sample_ids`, per the glossary.
* [`docs/shap-explain-spec.md`](./shap-explain-spec.md) — the normative spec: payload contract,
  invariants, pipeline requirements, package surface, fixtures and golden values.

### Two work streams

The work splits in two, developed **in parallel against a static fixture JSON** (D22).

| | **Stream 1 — `shap-charts`** (to become a standalone npm package) | **Stream 2 — platform** (this repo) |
| --- | --- | --- |
| Python | — | payload builder from `Explanation`; `/v1/explain/values`; row chunking |
| NestJS | — | `GET /predict/:id/explain` + ETag; GCS JSON; new entity columns; Redis `EventsHub`; 500-row cap; reject unparseable CSV; axios/Bull timeouts + retry |
| Frontend | **the four renderers, genus toggle, deviation flags, all interaction** | screens, fetching, react-query, click-through wiring |
| Later | — | seed the GCN explainer; batch the predict path |

Stream 1 lives at `explainable-platform/packages/shap-charts/` as a **package-shaped directory**: one
`index.ts` entry point, its own types, and a hard rule that **nothing inside imports from app code**.
Extraction later is then `git mv` plus a `package.json`. No npm workspace for now — Next.js 12 makes that
cost real and it buys nothing today.

### The decisions

| # | Decision | Chosen |
| --- | --- | --- |
| D1 | Fidelity to SHAP | Start faithful, deviate deliberately per element. **Reversible at will** — see below |
| D2 | matplotlib | Kept as an **on-demand export endpoint only**; out of the hot path, no queue job, no GCS object, no `*Error` column |
| D3 | Endpoint shape | One Python code path over the whole dataframe; job graph collapses from `2 + n` to 1 |
| D4 | `0` vs `NaN` | Absent taxon = **biological 0**. Unparseable input = **reject the upload**. The payload can therefore never contain `NaN` |
| D5 | Global bar plot | **Added**, after beeswarm |
| D6 | v1 interactions | hover tooltip; `max_display` slider; click-through global → local; feature name search; species ↔ genus toggle. **Deferred:** zoom/brush, client-side image export |
| D7 | Truncation | **None.** Ship the full matrix always |
| D8 | Row cap | **500 rows** per prediction, enforced at upload |
| D9 | GCN non-determinism | Don't cache it now; seed and re-log the explainer later |
| D10 | Deviations in v1 | All five: numeric label format; "Sum of N other" **corrected** (behind a toggle); real axis + tooltip on the heatmap `f(x)` line; numeric colour legend on beeswarm; italic species names with `_` → space |
| D11 | Route granularity | One service method; **two NestJS routes** — `GET /predict/:id/explain` (whole df) and `GET /predict/:id/records/:rid/explain` (a slice of the same artifact, not a recomputation) |
| D12 | Transport | GCS object, served **through NestJS** with `ETag` — not via signed URL |
| D13 | Caching | **No separate cache.** The stored artifact per prediction *is* the cache. Store `model_version` + `contract_version` alongside it |
| D14/D15 | Genus aggregation | **Frontend computes it.** Python keeps its `?aggregate_by=genus` param only for the export path |
| D16 | Schema | **Purely additive.** New columns added; the seven old image columns and their GCS objects are left untouched as a visual-regression reference |
| D17 | Predict path | Stays per-record for v1. Batching it is a separate piece of work |
| D18 | `EventsHub` | **Move to Redis pub/sub** in this work (Bull already holds a Redis connection) |
| D19 | Rollout order | **bar → waterfall → beeswarm → heatmap** |
| D20/D23 | Long-running explain | **Chunk by rows** — 50 per HTTP call, concatenated in NestJS, one artifact at the end; retry per chunk with backoff; real progress over SSE |
| D21 | Package scope | **Rendering only.** `npm i`, pass what SHAP already gives you, get interactive SVG |
| D22 | Stream ordering | **Parallel**, stream 1 developed against a fixture JSON |
| D24 | Package input shape | `shap.Explanation`'s own field names as the core (`values`, `base_values`, `data`, `feature_names`), plus **optional** platform fields (`sample_ids`, `model_version`). Accepts both `(n, p)` and `(n, p, 2)` with a `classIndex` prop defaulting to 1 |

**Why D1 is cheap to revisit.** Given D7 (no truncation), the payload is raw data with zero presentation
baked in: `values`, `data`, `feature_names`, `base_values`, `sample_ids`. Every constant in §3 of this note
— feature ordering, top-K, the "other" row, jitter, percentile clipping, the colormap, label formats, arrow
geometry, the `f(x)` line, instance ordering — is computed in the browser. Changing any of them is a
frontend deploy: no Python change, no schema change, no recomputation. Only three things are expensive to
change later: the payload contract's *semantics* (adding fields is cheap), the schema, and D2.

**On D10's "Sum of N other".** SHAP absorbs the K-th ranked feature into the group row, so `max_display=15`
shows 14 real features. v1 corrects this, but **behind a flag rather than hardcoded** — if this becomes a
separate paper, comparing against published SHAP figures may want the faithful behaviour back.

### Facts established during the interview

Each of these was verified against the source, and several changed a decision.

**Scale.** Feature counts per registered model: 201 (`sample-*-crc`), 221 (`crc-curatedcrc-rf`), 228
(`crc-rynazal-lodo-yachida`), ~301 (`ryza-rynazal-crc`, derived not read), **865** (`crc-rynazal-notebook`).
Genus aggregation reduces `p` by only **2.3–3.5×** — 865 → 244 — so it is not a size remedy. The largest
input committed to the repo is `sample-data/yachidas_2019_test.csv` at 331 × 865.

**There was no row limit anywhere.** Not in `FileInterceptor` (no `limits`), not in the CSV parser, not in
the entity, not in the frontend (`papaparse` is a dependency but is never imported). The only ceiling in
the system is `client_max_body_size 25m` in `deployment/nginx.conf:33`, which permits ~5,380 rows of the
865-column schema. D8 closes this.

**The request direction already carries the full matrix.**
`explainable-platform-service/src/predictions/prediction.processor.ts:173-183` posts
`data: records.map((r) => r.dfData)` — the whole `n × p` input — and it goes straight to
`INFERENCE_SERVICE_URL`, **bypassing nginx**, so the 25 MiB cap never applied to it. A response of the same
order of magnitude is not a new class of problem.

**`sample-gcn-crc` is not deterministic.** It uses `PermutationExplainer` with no seed.
`shap/explainers/_permutation.py:46-47` seeds only at construction (i.e. at training time, before
pickling); at explain time each row calls `np.random.shuffle` on the global RNG with no reseed. Worse,
`npermutations = max_evals // (2 * len(inds) + 1)` = `500 // 403` = **1** — a single random feature ordering
per row. Repeated explanations of the same record differ materially. Every other registered model is
`TreeExplainer`-backed and bit-identical across calls.

**`base_scalar` is safe for five of six models.** `TreeExplainer.__call__` tiles a constant
(`shap/explainers/_tree.py:269-281`), so `base_values` is `(n, 2)` with every row identical — confirmed
numerically (served `0.5238200000000003` = logged `expected_value_crc`). Only the permutation path produces
genuinely per-row base values. The payload still ships `base_values` per sample (collapsing to a scalar at
serialization when uniform).

**A latent trap:** the fallback branch at `mlflow_explainable/contract.py:184-189` reads
`getattr(explainer, "expected_value", 0.0)`. `PermutationExplainer` has no such attribute, so any exception
on the primary path would silently produce a base value of `0.0`.

**Nothing has a timeout.** `HttpModule` is imported with no configuration, so axios runs at its default
`timeout: 0` — forever. `BullModule.registerQueue({ name: 'predictionQueue' })` sets no `defaultJobOptions`,
so `attempts` is 1 with no backoff and no job timeout. `deployment/nginx.conf:36-38` sets
`proxy_read_timeout 180s` with the comment "SHAP plots can take a while", but that path is not the one that
is slow. D20/D23 addresses this.

**There is no migration system.** `app.module.ts:25` sets `synchronize: true`. Adding a column to an entity
is therefore free — which is what makes D16 cheap — but **removing a property drops the column and its data
without prompting**. Another reason D16 is additive.

**The backend cannot currently scale horizontally.** `events/events.hub.ts:10-11` documents it:
`EventsHub` is an in-memory `Map<string, Subject>`, so with more than one pod SSE events reach only the
clients attached to the emitting pod. D18 fixes this; Bull's existing Redis connection makes it cheap.

**`PredictionRecord.barPlot` is a dead column** — declared at `entity/prediction-record.entity.ts:33` and
referenced nowhere in either codebase. Relevant because D5 adds a bar plot that has nothing to do with it.

**`StorageService.uploadToS3` is PNG-only** — it does `Buffer.from(base64Data, 'base64')` and hardcodes
`contentType: 'image/png'` (`storage/storage.service.ts:60-77`). JSON upload needs a new method, not a
change to this one.

**The heatmap does not use `hclust` here.** `kserve-shap-multi-modelserver.py:312` passes
`instance_order=explanation.sum(1)`, which `convert_ordering` turns into a descending sort by Σφ. No
clustering is involved in what this platform renders, so nothing about instance ordering needs to stay
server-side. (Documented in more detail below, under the earlier correction.)

**`format_value` is broken for this domain** — `0.0003` renders as `0` and `-0.0002` as `−0`. See §3.2.

### Target architecture

```
upload CSV
   │  cap 500 rows (D8) · reject unparseable cells (D4)
   ▼
Prediction + n PredictionRecords ──► ONE queue job (was 2 + n)
                                        │
                     ┌──────────────────┴───────────────────┐
                     │  chunked: 50 rows per call (D23)     │
                     │  POST /v1/explain/values/<model> ×10 │
                     │  retry per chunk, backoff            │
                     └──────────────────┬───────────────────┘
                                        │ concatenate in NestJS
                                        ▼
                          gzip ─► gs://…/{predId}/explain.json.gz
                                  contentType: application/json
                                  contentEncoding: gzip
                                        │
                          sha256 ─► Prediction.explainKey / explainEtag
                                        │
                          SSE {ready, etag} via Redis pub/sub (D18)
                                        ▼
   FE ─► GET /predict/:id/explain
           If-None-Match ─► 304 from a single DB read, GCS untouched
           else 200, GCS stream piped through as-is (still gzipped)
                                        ▼
         one payload ─► bar · waterfall · beeswarm · heatmap
                        all ordering / top-K / jitter / colour / genus
                        computed in the browser
```

### Explicitly deferred

Zoom and brush; client-side image export; seeding and re-logging the GCN explainer; batching the predict
path and fixing the `MAX(record_number)`-in-a-loop insert; adopting SHAP's `bundle.js`; hierarchical
clustering for instance ordering; content-addressed caching; extracting `shap-charts` into its own
repository; and how to divide implementation work between tools.

---

### Correction to an earlier reading of the heatmap

An earlier pass through this work claimed that `hclust` instance ordering was the one computation that
had to stay in Python. **That is wrong for this repo as deployed.** `get_heatmap()`
(`kserve-shap-multi-modelserver.py:309-315`) calls:

```python
shap.plots.heatmap(explanation, instance_order=explanation.sum(1), max_display=15, show=False)
```

`instance_order=explanation.sum(1)` overrides the `Explanation.hclust()` default. `convert_ordering`
(`shap/plots/_utils.py:32-40`) finds no `argsort` in the op history, so it applies `.argsort.flip` →
**instances ordered by descending Σφ**. That is an `O(n log n)` sort the frontend can do itself; no
`pdist` / `complete` linkage / `optimal_leaf_ordering` is involved in what this platform actually renders.

Consequence: **no clustering needs to stay server-side.** If someone later wants SHAP's default
supervised-clustering order, *that* would need Python (scipy's optimal leaf ordering is not something to
port to TypeScript) — and it is `max_display`-invariant, so it would ship as a cached `int[n]` permutation.

Also repo-specific and easy to miss when reimplementing: `get_heatmap()` strips the matplotlib y-ticks and
redraws each label by hand, replacing `_` with a space and rendering it *italic* unless
`_is_summary_row(label)` is true (i.e. the "Sum of N other features" row stays upright). Species names in
italics is a biology-typesetting convention, not decoration — keep it.


## 0. Sources, and how to reproduce every claim here

All SHAP claims are cited to one of:

* the rendered docs at `https://shap.readthedocs.io/en/latest/` (URL given inline), or
* the SHAP source, cited as `shap/<path>::<function>` with a raw URL.

Source was read at **master commit `fc3e290e97ce12f76d1175d24c6e3023b4ca7d69`** (2026-09-07). Raw file
pattern: `https://raw.githubusercontent.com/shap/shap/master/shap/plots/_beeswarm.py`.

The deployed version in this repo is **shap 0.49.1** (see `docs/rynazal-2023-reproduction-notes.md` §2).
I diffed `v0.49.1` against `master` for `plots/_beeswarm.py`, `plots/_waterfall.py`, `plots/_heatmap.py`
and `plots/colors/_colors.py`: **the algorithms are byte-identical**; the only differences are a missing
`return` in an unused helper `is_color_map`, a typing change, and divide-by-zero guards in `_heatmap.py`
(`fx_max > 0` / `fv_max > 0`). So everything below applies to what is actually running.

Colormap hex values in §4 were computed locally by executing SHAP's own `shap/plots/colors/_colorconv.py`
against the constants in `_colors.py` — i.e. they are SHAP's own conversion code, not a reimplementation.

Latest SHAP release at the time of writing: `v0.53.0rc0` (2026-09-07); latest stable tag `v0.52.0`.

---

## 1. What a SHAP `Explanation` actually is, field by field

Docs: <https://shap.readthedocs.io/en/latest/generated/shap.Explanation.html>.
Source: `shap/_explanation.py::Explanation.__init__`
(<https://raw.githubusercontent.com/shap/shap/master/shap/_explanation.py>).

`Explanation` is described in its own docstring as *"A sliceable set of parallel arrays representing a SHAP
explanation."* Internally it is a `Slicer` over these named arrays (constructor signature, `_explanation.py`
lines 108–125):

| Field | Shape (single-output, tabular) | dtype | Meaning |
| --- | --- | --- | --- |
| `values` | `(n_samples, n_features)` | float64 | The Shapley values φ. **This is the only required argument.** |
| `base_values` | `(n_samples,)`, or scalar | float64 | E[f(X)] under the background/masker. One per row. |
| `data` | `(n_samples, n_features)` | float64 (or object) | The **feature values** of the explained rows. Used only for colouring / labelling, never for maths. |
| `display_data` | same as `data` | any | Optional human-readable stand-in for `data` (e.g. category names). Waterfall prefers it over `data`. |
| `feature_names` | `(n_features,)` | str | Column labels. |
| `instance_names` | `(n_samples,)` | str | Row labels. Not used by any plot below. |
| `output_names` | `(n_outputs,)` or scalar | str | Class names for multi-output. |
| `lower_bounds` / `upper_bounds` | `(n_features,)` per row | float | Optional CI for each φ. **Waterfall draws error bars when present** (`_waterfall.py` lines 118–127, 213–219). |
| `main_effects` | `(n_samples, n_features)` | float | Diagonal of the interaction matrix, when computed. |
| `hierarchical_values` | ragged | float | Partition-explainer output before it is flattened to `values`. |
| `clustering` | `(n_features-1, 4)` | float | A scipy **partition tree** (linkage matrix). Beeswarm and bar will merge features according to it if present. |
| `error_std`, `output_indexes`, `compute_time` | — | — | Bookkeeping, not drawn. |
| `op_history` | list of `OpHistoryItem` | — | Records `.abs`, `.mean(0)`, `[...]` etc. `shap.plots.bar` reads it to build its x-axis label (`_bar.py` lines 143–150). |

### `base_values` semantics

`base_values` is the model output you would predict with **no** feature information — E[f(X)] over the
masker/background set. The invariant is

```
base_values[i] + values[i, :].sum() == f(x_i)
```

`shap.plots.waterfall` computes `f(x)` exactly this way and prints it as the top axis tick
(`_waterfall.py` lines 307–308: `fx = base_values + values.sum()`). `TreeExplainer` enforces it at
compute time via `assert_additivity`, which uses `np.allclose(..., atol=1e-2, rtol=1e-2)`
(`shap/explainers/_tree.py::TreeExplainer.assert_additivity`,
<https://raw.githubusercontent.com/shap/shap/master/shap/explainers/_tree.py>, lines 937–958).

### Multi-output / binary-classification shape conventions

This is the part that trips people up. From `shap/explainers/_tree.py::TreeExplainer.__call__`
(lines 422–440):

```python
v = self.shap_values(X, y=y, from_call=True, check_additivity=..., approximate=...)
if isinstance(v, list):
    v = np.stack(v, axis=-1)          # put outputs at the END
...
if hasattr(self.expected_value, "__len__") and len(self.expected_value) > 1:
    ev_tiled = np.tile(self.expected_value, (num_rows, 1))   # (N, k)
else:
    ev_tiled = np.tile(self.expected_value, v.shape[0])      # (N,)
```

So:

* **Outputs live on the LAST axis.** A binary `RandomForestClassifier` under `TreeExplainer` produces
  `values.shape == (n, p, 2)` and `base_values.shape == (n, 2)`.
* A regressor / single-output model produces `values.shape == (n, p)` and `base_values.shape == (n,)`.
* This was a deliberate breaking change in **v0.45.0**: *"Changed type and shape of returned SHAP values
  in some cases, to be consistent with model outputs. SHAP values for models with multiple outputs are
  now np.ndarray rather than list"* — <https://shap.readthedocs.io/en/latest/release_notes.html>.
* Which axis is "positive class" is a model convention, not a SHAP one. This repo hardcodes index 1
  (`kserve-shap-multi-modelserver.py::get_shap_value`), which matches sklearn's `classes_` ordering for
  `{0, 1}` labels.
* For a **binary** classifier the two output slices are near-mirror images (φ₀ ≈ −φ₁), so dropping one is
  lossless in practice — but that is a property of the model, not a SHAP guarantee. Not confirmed from
  SHAP source as a general invariant.

The repo's own contract already documents exactly these shapes —
`mlflow-experiments/extension/mlflow_explainable/src/mlflow_explainable/contract.py` lines 97–100:

```
shap_explain(self, X) -> dict
    # keys:   "values"      shape (n, n_features)  or (n, n_features, n_classes)
    #         "base_values" shape ()                or (n_classes,) or (n, n_classes)
    #         "data"        shape (n, n_features)
```

### Slicing, `.abs`, `.mean(0)`, `hclust`, cohorts

* `Explanation.abs`, `.mean`, `.argsort`, `.flip`, `.sum`, `.max`, `.min`, `.sample`, `.hclust` are exposed
  as **class properties returning `OpChain` objects** — lazy op recordings, not computed values
  (`_explanation.py::MetaExplanation`, lines 39–93). The instance methods of the same name return new
  `Explanation`s.
* `OpChain.apply(obj)` just replays `getattr(obj, op)(*args)` in order
  (`shap/utils/_general.py::OpChain.apply`).
* `Explanation.hclust(metric="sqeuclidean", axis=0)` (`_explanation.py` lines 632–654) delegates to
  `shap/utils/_clustering.py::hclust_ordering`, which is:
  `scipy.spatial.distance.pdist(X, metric)` → `scipy.cluster.hierarchy.complete(D)` →
  `optimal_leaf_ordering(cluster_matrix, D)` → `leaves_list(...)`.
* `.cohorts(k)` splits rows into groups, either by an explicit label array or by auto-fitting a decision
  tree (`_explanation.py::Explanation.cohorts`, lines 694–719). Only `shap.plots.bar` consumes `Cohorts`.
* `clustering` / `hierarchical_values` are **not produced by `TreeExplainer`** — they come from
  `PartitionExplainer`. This repo's models don't set them, which removes a large chunk of the beeswarm
  ordering code path (§3).

---

## 2. Is a JSON payload sufficient to reproduce each plot?

Yes for everything the platform currently ships, and yes for bar/scatter/force too. The nuance is *what the
plot function computes internally that the frontend would inherit*.

| Plot | Arrays needed | Computed inside the plot fn (FE must reimplement) | Needs anything not in the Explanation? |
| --- | --- | --- | --- |
| **beeswarm** | `values (n,p)`, `data (n,p)`, `feature_names` | feature ordering; the "Sum of N other" merge; the bin/layer jitter; **per-row** 5th/95th-percentile colour clipping; NaN → grey | No |
| **bar (global)** | `values (n,p)` (or a pre-collapsed `(p,)`), `feature_names` | `abs.mean(0)` collapse; rank-averaging across cohorts; top-K merge; optional dendrogram from `clustering` | No |
| **waterfall** | `values (p,)`, `base_values` scalar, `data (p,)`, `feature_names` | `argsort(-abs)`; cumulative left-edge walk from f(x); the "N other features" residual bar; arrowhead sizing in inches | No |
| **force** | same as waterfall | nothing meaningful — SHAP itself already emits a flat JSON blob and lets JS draw it (§3.5) | No |
| **heatmap** | `values (n,p)`, `feature_names` | instance order via `hclust` (scipy `complete` + `optimal_leaf_ordering`); feature order via `argsort(-abs.mean(0))`; top-K merge; 1st/99th percentile symmetric colour limits; the `f(x)` line = `values.sum(1)` normalised by its own max | No, but `hclust` needs scipy-equivalent clustering — see caveat |
| **scatter / dependence** | `values[:, j]`, `data[:, j]`, plus `data[:, k]` for the colour feature | optional auto-choice of the interaction feature via `approximate_interactions` (a binned-correlation heuristic, `shap/utils/_general.py::approximate_interactions`), x-jitter, marginal histogram | No — but auto-colour-feature selection needs the **full** `data` matrix, not top-K |
| **decision** | `values (n,p)`, `base_values`, `feature_names` | cumulative sums per row, `feature_display_range` default `slice(-1,-21,-1)` (`shap/plots/_decision.py::decision`) | No |

**The single genuine "cannot do it purely client-side" item is heatmap's default instance ordering.**
`Explanation.hclust` runs an O(n²) `pdist` plus `optimal_leaf_ordering` (scipy). Reimplementing optimal
leaf ordering in JS is real work. Two escapes: (a) compute the order in Python and ship it as an index
array — it is `n` integers, negligible; (b) note that **this repo already overrides it**:
`get_heatmap()` passes `instance_order=explanation.sum(1)`, i.e. sort rows by Σφ, which is trivial in JS.

Everything else is arithmetic over arrays you already have.

---

## 3. The exact plotting algorithms

### 3.1 beeswarm — `shap/plots/_beeswarm.py::beeswarm`

<https://raw.githubusercontent.com/shap/shap/master/shap/plots/_beeswarm.py>

**Signature defaults** (lines 40–57): `max_display=10`, `order=Explanation.abs.mean(0)`,
`clustering=None`, `cluster_threshold=0.5`, `alpha=1.0`, `s=16`, `plot_size="auto"`,
`group_remaining_features=True`, `axis_color="#333333"`.
(This repo calls it with `max_display=15`.)

**(a) Feature ordering.** Line 315: `feature_order = convert_ordering(order, Explanation(np.abs(values)))`.
`convert_ordering` (`shap/plots/_utils.py`, lines 31–39) applies the OpChain then, since the chain has no
`argsort` op, returns `ordering.argsort.flip.values`. Net effect:

```
feature_order = argsort(mean(|values|, axis=0))[::-1]      # descending mean |SHAP|
```

Ties resolve by numpy's `argsort` (quicksort, unstable) then reversed — so tie order is not specified.
When `Explanation.clustering` is set, an extra loop (lines 314–340) relaxes the order to respect a
partition tree and may *merge* features. **Not relevant here** — `TreeExplainer` sets no `clustering`.

**(b) The "Sum of N other features" row** (lines 343–366). This is the most misunderstood part:

```python
feature_inds = feature_order[:max_display]
include_grouped_remaining = num_features < len(values[0]) and group_remaining_features
if include_grouped_remaining:
    num_cut = np.sum([len(orig_inds[feature_order[i]]) for i in range(num_features - 1, len(values[0]))])
    values[:, feature_order[num_features - 1]] = np.sum(
        [values[:, feature_order[i]] for i in range(num_features - 1, len(values[0]))], 0
    )
yticklabels = [feature_names[i] for i in feature_inds]
if include_grouped_remaining:
    yticklabels[-1] = f"Sum of {num_cut} other features"
```

So with `max_display=15` and `p=500`:

* rows 1..14 are the **top 14** features individually;
* row 15 is **not** the 15th-ranked feature. Its SHAP column is overwritten with the row-wise sum of
  ranks 15..500, and its label becomes `"Sum of 486 other features"` (`num_cut = p - max_display + 1 = 486`).
* The row keeps a full `(n,)` vector of summed φ, so it is a real beeswarm row with real spread — it is
  **not** a bar. Its `data` column is whatever the 15th feature's abundance was, which is why SHAP
  colours that row with meaningless values. (Not a bug the FE must replicate; see §9.)
* Rows are drawn `reversed(feature_inds)` (line 378), so the most important feature ends up at the top.

**(c) The jitter / point-stacking algorithm** (lines 395–410) — the non-obvious bit:

```python
row_height = 0.4                       # line 368
nbins = 100
quant = np.round(nbins * (shaps - np.min(shaps)) / (np.max(shaps) - np.min(shaps) + 1e-8))
inds_ = np.argsort(quant + np.random.randn(N) * 1e-6)
layer = 0; last_bin = -1; ys = np.zeros(N)
for ind in inds_:
    if quant[ind] != last_bin:
        layer = 0
    ys[ind] = np.ceil(layer / 2) * ((layer % 2) * 2 - 1)
    layer += 1
    last_bin = quant[ind]
ys *= 0.9 * (row_height / np.max(ys + 1))
# final y coordinate of point k = pos + ys[k]
```

In words:

1. Linearly bin each point's SHAP value into **100 bins** across that row's own `[min, max]`
   (`+1e-8` guards a constant row).
2. Sort by bin, breaking ties with **N(0, 1e-6) noise** — so within-bin order is random.
3. Walk the sorted points. Whenever the bin changes, reset `layer` to 0. Assign
   `ceil(layer/2) * ((layer % 2) * 2 − 1)`, which yields the integer sequence
   **0, +1, −1, +2, −2, +3, −3, …** — a symmetric spread outward from the row centre.
4. Rescale so the widest point in the row sits at `0.9 * row_height * maxLayer / (maxLayer + 1)`,
   i.e. strictly below `0.9 × 0.4 = 0.36`. Row pitch is 1.0, so rows can never collide.

**Two independent `np.random` calls, neither seeded** (line 383 `np.random.shuffle(f_inds)`, line 400
`np.random.randn`). Consequence: **the current PNG endpoint returns a visually different plot on every
call for the same input.** The FE is therefore free to pick its own deterministic jitter without being
"less correct" than matplotlib — and being deterministic is strictly better for a UI where the user
toggles `max_display` back and forth.

**(d) Colour axis** (lines 412–460). Per **row**, not globally:

```python
vmin = np.nanpercentile(fvalues, 5)
vmax = np.nanpercentile(fvalues, 95)
if vmin == vmax:
    vmin = np.nanpercentile(fvalues, 1); vmax = np.nanpercentile(fvalues, 99)
    if vmin == vmax:
        vmin = np.min(fvalues); vmax = np.max(fvalues)
if vmin > vmax:
    vmin = vmax
nan_mask = np.isnan(fvalues)
# NaN feature values -> flat grey
ax.scatter(shaps[nan_mask], pos + ys[nan_mask], color="#777777", s=s, ...)
# non-NaN -> clipped, then cmap
cvals = fvalues[~nan_mask].astype(np.float64)
cvals_imp = cvals.copy(); cvals_imp[np.isnan(cvals)] = (vmin + vmax) / 2.0
cvals[cvals_imp > vmax] = vmax
cvals[cvals_imp < vmin] = vmin
ax.scatter(..., cmap=colors.red_blue, vmin=vmin, vmax=vmax, c=cvals, ...)
```

Points to carry over:

* **Each feature row gets its own colour normalisation** from its own 5th/95th percentiles. This is why
  the colour bar is labelled only `"Low"` / `"High"` with no numbers
  (`_labels.py`: `FEATURE_VALUE_LOW = "Low"`, `FEATURE_VALUE_HIGH = "High"`).
  For microbiome relative abundance — long-tailed, many zeros — the 5/95 clip is doing a *lot* of work.
  If the FE normalises globally the plot will look wrong.
* Values are **clipped, not clamped-to-out-of-range-colour**: everything above the 95th percentile is
  drawn as pure red, everything below the 5th as pure blue. The `set_over`/`set_under` grey on
  `red_blue` is never reached from beeswarm.
* NaN feature values → `#777777`, drawn as a separate layer.
* Marker: `s=16` (matplotlib points², i.e. radius ≈ 2.26 pt), `linewidth=0`, `alpha=1.0`,
  `rasterized=True` when `n > 500`.

**(e) Chrome.** `axvline(x=0, color="#999999")`; per-row `axhline(color="#cccccc", lw=0.5, dashes=(1,5))`;
left/top/right spines hidden; `ylim(-1, len(feature_inds))`; figure size
`(8, min(len(feature_order), max_display) * 0.4 + 1.5)` inches;
x-label = `"SHAP value (impact on model output)"` (`_labels.py::labels["VALUE"]`);
y-tick fontsize 13, x-tick 11.

### 3.2 waterfall — `shap/plots/_waterfall.py::waterfall` (and `waterfall_legacy`)

<https://raw.githubusercontent.com/shap/shap/master/shap/plots/_waterfall.py>.
This repo calls **`waterfall_legacy`** (`get_local_waterfall_plot`, `max_display=8`). The two functions are
algorithmically identical for ordering and layout (compare lines 84–160 with 452–520); `waterfall_legacy`
just takes `(expected_value, shap_values, features, feature_names)` positionally instead of an
`Explanation`.

**Ordering** (line 88): `order = np.argsort(-np.abs(values))` — descending |φ|. Note this uses `-abs`
inside `argsort` (not `argsort` then reverse), so ties resolve differently from beeswarm. Cosmetic.

**Layout walk** (lines 99–137). The plot is built **downward from f(x)**, not upward from the base value:

```python
loc = base_values + values.sum()               # = f(x)
num_features = min(max_display, len(values))
num_individual = num_features if num_features == len(values) else num_features - 1
for i in range(num_individual):
    sval = values[order[i]]
    loc -= sval
    # bar i spans [loc, loc + sval]; sign decides pos/neg list
```

So the top row (largest |φ|) is the bar closest to f(x), and each subsequent row starts where the previous
one began. `rng = range(num_features - 1, -1, -1)` puts row index 0 at the **bottom**.

**`max_display` collapsing** (lines 148–159):

```python
if num_features < len(values):
    yticklabels[0] = f"{len(shap_values) - num_features + 1} other features"
    remaining_impact = base_values - loc
    if remaining_impact < 0:  pos bar of width -remaining_impact at left = loc + remaining_impact
    else:                     neg bar of width -remaining_impact at left = loc + remaining_impact
```

Same `+1` convention as beeswarm: with `max_display=8` and `p=500` you see the **top 7** individually plus
one row labelled `"494 other features"` carrying Σφ of ranks 8..500. The residual bar is defined as
whatever closes the gap back to `base_values` — which is exactly why it is *guaranteed* to make the plot
add up, and why truncating server-side without also shipping this residual breaks the picture (§5, §8).

**Base value → f(x) axis** (lines 306–346):

* `axvline(base_values, 0, 1/num_features, ...)` — a short dashed tick only under the bottom row.
* `axvline(fx, 0, 1, ...)` — full-height dashed line at `fx = base_values + values.sum()`.
* Two stacked twin x-axes carry the annotations: `ax2` ticks at `base_values` labelled
  `"E[f(X)]"` / `"= <format_value(base,'%0.03f')>"`; `ax3` ticks at `fx` labelled `"f(x)"` / `"= <fx>"`.
  Label offsets are in points (`ScaledTranslation(-20/72, 0, ...)` etc.).

**Arrow widths** (lines 187–211, 247–260):

```python
head_length = 0.08                       # INCHES
bar_width   = 0.8                        # data units on y
xlen = xlim[1] - xlim[0]
bbox_to_xscale = xlen / axes_width_inches
hl_scaled = bbox_to_xscale * head_length
plt.arrow(left, y, dist - hl_scaled, 0,
          head_length=min(dist, hl_scaled), width=bar_width, head_width=bar_width)
```

i.e. **the arrowhead is a fixed 0.08 in ≈ 5.8 pt in screen space**, converted into data units. In an SVG
frontend this is simply "arrowhead is a constant N pixels wide, shaft is the rest" — easier than the
matplotlib version, and pixel-identical.

**Value labels**: `format_value(w, "%+0.02f")` centred inside the bar; if the rendered text is wider than
the arrow, matplotlib removes it and redraws it *outside* the bar at a `5/72` inch offset, coloured with
the bar colour (lines 230–245). `format_value` (`shap/utils/_general.py::format_value`) strips trailing
zeros with `re.sub(r"\.?0+$", "", s)` and replaces a leading ASCII `-` with **U+2212 MINUS SIGN**.

**Y-tick labels**: `f"{format_value(float(features[order[i]]), '%0.03f')} = {feature_names[order[i]]}"`,
drawn twice — once fully in grey (`tick_labels_color = "#999999"`), once with only the part after `=` in
black, offset by `1e-8` so matplotlib doesn't collapse the ticks (lines 296–299, 364–368). That is the
"0.043 = Fusobacterium_nucleatum" two-tone look.

**This formatting is actively broken for microbiome relative abundances — verified by running it.**
`format_value(v, "%0.03f")` first renders to three decimals, then strips trailing zeros with
`re.sub(r"\.?0+$", "", s)`. Run against realistic abundance values in the installed v0.49.1:

| input | rendered label |
| --- | --- |
| `0.0003` | `0` |
| `0.00004` | `0` |
| `-0.0002` | `−0` |
| `0.0125` | `0.013` |
| `0.5` | `0.5` |

Most species in a relative-abundance vector are below 1e-3, so the current production waterfall is
labelling a large share of its rows **`0 = <species>`**, and occasionally `−0 = <species>`. This is not a
hypothetical loss-of-fidelity concern — it is an existing defect the PNG pipeline inherits from SHAP's
tabular-data assumptions. The frontend reimplementation should use scientific notation or percent for
values below a threshold. **This is a case where deviating from SHAP is strictly correct**, and it belongs
on the "better than the original" side of the ledger in §9, not the "close but not identical" side.

**Axis padding gotcha** (line 170): `label_padding = [0.1 * dataw if w < 1 else 0 for w in pos_widths]`.
The comparison is against literal `1` in raw model-output units. For probability-space SHAP every |φ| < 1,
so the padding always fires. An FE that computes x-limits "the obvious way" will produce a slightly
tighter plot than matplotlib.

### 3.3 bar — `shap/plots/_bar.py::bar`

<https://raw.githubusercontent.com/shap/shap/master/shap/plots/_bar.py>

* Defaults (lines 22–31): `max_display=10`, `order=Explanation.abs`, `clustering=None`,
  `clustering_cutoff=0.5`, `show_data="auto"`.
* **Auto-collapse** (lines 103–107): if a passed Explanation is 2-D, `bar` itself does
  `cohort_exps[i] = exp.abs.mean(0)`. So the documented "pass a multi-row Explanation to get global
  importance" (<https://shap.readthedocs.io/en/latest/generated/shap.plots.bar.html>) resolves to
  **mean(|φ|) over samples**, and the x-axis label is built from `op_history` into
  `"mean(|SHAP value|)"` (lines 143–150).
* **Ordering with cohorts** (lines 181–183) is *rank averaging*, not value averaging:
  `feature_order = np.argsort(np.mean([np.argsort(convert_ordering(order, Explanation(values[i]))) for i in ...], 0))`.
  With a single cohort this reduces to descending mean|φ|.
* **`max_display` collapsing** is the same code shape as beeswarm (lines 228–241): the last displayed
  column is overwritten with the sum over ranks `max_display-1 .. p-1`, labelled
  `f"Sum of {num_cut} other features"`.
* Bar colours come from the style module: positive `style.primary_color_positive`, negative
  `style.primary_color_negative` (line 268). See §4.
* If `Explanation.clustering` is present, `bar` also draws a dendrogram on the right at
  `xmax + 0.1*(xmax-xmin)` (lines 356–387). Not applicable to this repo's models.

### 3.4 heatmap — `shap/plots/_heatmap.py::heatmap`

<https://raw.githubusercontent.com/shap/shap/master/shap/plots/_heatmap.py>

* Defaults: `instance_order=Explanation.hclust()`, `feature_values=Explanation.abs.mean(0)`,
  `feature_order=None`, `max_display=10`, `cmap=colors.red_white_blue`, `plot_width=8`.
* **Feature order**: `feature_order = np.argsort(-feature_values)` where
  `feature_values = abs.mean(0)` → descending mean|φ|.
* **Instance order**: `Explanation.hclust()` → `hclust_ordering(values, metric="sqeuclidean")` →
  scipy `complete` linkage + `optimal_leaf_ordering` + `leaves_list`
  (`shap/utils/_clustering.py::hclust_ordering`). **This repo overrides it** with
  `instance_order=explanation.sum(1)`, which `convert_ordering` turns into
  `argsort(Σφ per row)` reversed → descending total attribution.
* **Top-K merge**: same shape as the others — last column becomes
  `values[:, max_display-1:].sum(1)`, label `f"Sum of {values.shape[1] - max_display + 1} other features"`,
  and the right-hand mini-bar for that row gets `feature_values[max_display-1:].sum()`.
* **Colour limits**: `vmin, vmax = np.nanpercentile(values.flatten(), [1, 99])`, then forced symmetric:
  `imshow(vmin=min(vmin, -vmax), vmax=max(-vmin, vmax))`. Note this is over the **already-merged**
  matrix, so the "other" column participates.
* **`f(x)` line on top**: `fx = values.T.sum(0)` (per-instance Σφ over the *displayed* columns, which after
  merging equals Σφ over all features), normalised by `np.abs(fx).max()`, drawn at
  `y = -fx_normalized - 1.5` above the heatmap with a dashed `#aaaaaa` separator at `y = -1.5`.
  It is **not** in model-output units and has no y-axis — it is a shape, not a scale.
* Right-hand black bars: `bar_widths = feature_values / |feature_values|.max() * n / 20`, drawn with
  `left = n - 0.5` and `set_clip_on(False)`.
* Aspect: `imshow(..., aspect=0.7 * n_instances / n_features, interpolation="nearest")`.
* Figure height `n_features * 0.5 + 2.5` inches.

### 3.5 force — SHAP already ships a JavaScript/D3 renderer, and it is direct prior art

This deserves its own paragraph because **the user should know it exists before building anything**.

`shap/plots/_force.py` (<https://raw.githubusercontent.com/shap/shap/master/shap/plots/_force.py>) contains:

* `getjs()` (lines 288–293): reads `shap/plots/resources/bundle.js` and returns it wrapped in a
  `<script>` tag. **That file is 353,951 bytes** (measured by fetching it from master). It is a webpack
  production bundle that carries its own React, ReactDOM, D3 v7 and lodash, exposed as globals
  `SHAP.React`, `SHAP.ReactDom`, `SHAP.AdditiveForceVisualizer`, `SHAP.AdditiveForceArrayVisualizer`.
* `initjs()` (lines 295–306): injects that script into a notebook.
* `save_html(out_file, plot, full_html=True)` (lines 309–345): writes the bundle plus the plot's markup to
  a standalone `.html` file.
* `AdditiveForceVisualizer.html()` (lines 505–521) emits literally:

  ```html
  <div id='...'>…</div>
  <script>
    if (window.SHAP) SHAP.ReactDom.render(
      SHAP.React.createElement(SHAP.AdditiveForceVisualizer, {"outNames": ..., "baseValue": ..., ...}),
      document.getElementById('...')
    );
  </script>
  ```

**The JSON contract it uses** (lines 490–503) is the reference design for exactly what this note is
proposing:

```jsonc
{
  "outNames":    ["f(x)"],
  "baseValue":   0.524,
  "outValue":    0.81,
  "link":        "identity",             // or "logit"
  "featureNames": ["Fusobacterium_nucleatum", "..."],
  "features":    { "0": {"effect": 0.031, "value": 0.0042}, "7": {"effect": -0.012, "value": 0.0} },
  "plot_cmap":   "RdBu",
  "labelMargin": 20
}
```

Note `features` is a **sparse dict keyed by feature index**, and the loop that builds it is
`filter(lambda j: e.effects[j] != 0, ...)` — zero-effect features are dropped entirely. For microbiome data
where most species have φ ≈ 0 but not exactly 0, that filter buys nothing; an explicit epsilon would.

The array version (`AdditiveForceArrayVisualizer`, lines 527–583) adds `"explanations": [{outValue, simIndex, features}]`
and orders samples by `hclust_ordering(np.vstack([e.effects for e in arr]))`, flipping so higher
predictions come first.

**Its limits, stated plainly:**

* It covers **force and force-array only**. There is no JS beeswarm, bar, waterfall, heatmap or scatter
  anywhere in the repo — `javascript/visualizers/` and the bundle contain the two Additive* components
  and nothing else.
* The published npm package is **stale and unusable here**: `shapjs@0.35.3` (latest on the registry)
  declares `"react": "^15"`, `"react-dom": "^15"`, `"d3": "^4"`, `"react-tap-event-plugin": "^2"`.
  The in-repo `javascript/package.json` is much newer (React 19, D3 7) at version `0.35.0`, i.e. the
  registry has never been updated to match. License is **MIT** in both.
* Consuming the prebuilt `bundle.js` means shipping a second React 19 + ReactDOM + D3 + lodash copy
  (≈354 KB unminified-of-a-minified-bundle) alongside the app's own React 18. Doable via a `<script>`
  tag (it namespaces itself under `window.SHAP`) but ugly, and it will not tree-shake.
* Building from `javascript/` source requires React 19, which this frontend is not on (React 18.3.1).

**Verdict on force JS:** valuable as a *proof that the data-shipping model works* and as a reference for
the payload shape. Not worth adopting as a dependency. Say so to the user rather than quietly ignoring it.

### 3.5b `shap.plots.text` — the *other* first-party interactive renderer, and the better template

The user raised this one directly, pointing at
<https://shap.readthedocs.io/en/latest/example_notebooks/text_examples/translation/Machine%20Translation%20Explanations.html>.
It matters because it is a **second, completely different** answer SHAP gives to "interactive in a browser",
and it is the one worth copying.

Source: `shap/plots/_text.py` (<https://raw.githubusercontent.com/shap/shap/master/shap/plots/_text.py>),
1,465 lines in the installed v0.49.1.

**It does not touch `bundle.js` at all.** No React, no D3, no dependency of any kind. It concatenates an
HTML string with inline `<script>`/`<style>` and hands it to `display(HTML(...))`, or returns it when
`display=False` (`_text.py::text`, signature at line 21).

The mechanisms, all of which port directly to a React component:

* **UUID namespacing** — `uuid = "".join(random.choices(string.ascii_lowercase, k=20))` (`_text.py:88`),
  then every element id is `_tp_{uuid}_ind_{i}` / `_fb_{uuid}_ind_{i}` / `_fs_{uuid}_ind_{i}`. This is how
  multiple plots coexist on one page without colliding. (A React component gets this from `useId()`.)
* **Percentage-based SVG coordinates** — `svg_force_plot()` (`_text.py:498`) opens with
  `<svg width="100%" height="80px">` and positions everything through
  `xpos(xval) = 100 * (xval - xmin) / (xmax - xmin + 1e-8)`, emitted as `%`. The plot is responsive for
  free, with no viewBox arithmetic and no re-render on resize.
* **Interactivity via inline handlers toggling `opacity` / `display`** — e.g. `_text.py:366-367`:

  ```
  onmouseover="document.getElementById('_fb_{uuid}_ind_{i}').style.opacity = 1;
               document.getElementById('_fs_{uuid}_ind_{i}').style.opacity = 1;"
  onmouseout="...opacity = 0; ...opacity = 0;"
  ```

  Every hoverable element has a pre-rendered, initially-invisible companion (`_fb_` = the bracket line,
  `_fs_` = the value label `values[ind].round(3)`, `_text.py:568,571`). Hovering does not create anything;
  it reveals what is already in the DOM. That is exactly the model a React renderer wants.
* **Click-to-pin** — `_output_onclick_{uuid}(i)` (`_text.py:169-190`) keeps `document._zoom_{uuid}` and
  `document._hover_{uuid}` as module-level state so a clicked output stays pinned and suppresses hover.
  In React this is two pieces of `useState`.
* **Data embedded as JSON literals** — `json.dumps(colors_dict)`, `json.dumps(shap_values_dict)`,
  `json.dumps(token_id_to_node_id_mapping)` for the text-to-text case.
* Helpers worth knowing: `unpack_shap_explanation_contents` (reads `hierarchical_values` when present) and
  `process_shap_values(tokens, values, grouping_threshold, separator, clustering)` (`_text.py:378`), which
  collapses token groups below `grouping_threshold`.

**It cannot be used directly on this project's data.** The docstring for `shap_values` says
"*List of arrays of SHAP values. Each array has the shap values for a string (#input_tokens x
output_tokens)*" (`_text.py:38-40`) — it is an NLP plot keyed on tokens, not a tabular plot keyed on
features. There is no path from `Genus_species` columns to `shap.plots.text`.

**What to take from it:** the *rendering technique*, not the function. Percentage-coordinate SVG,
pre-rendered hidden hover companions, uuid-namespaced ids, zero dependencies — for beeswarm and waterfall
that is a complete and proven recipe, and it is roughly 250 lines of Python producing something that
already behaves the way the user wants.

**Coverage map — which plots have a first-party JS/HTML renderer.** Grepping the installed package for
`_repr_html_`, `<script` and `getjs` returns exactly three files: `_force.py`, `_text.py`, `_image.py`.
Everything else in `shap/plots/` imports matplotlib and only matplotlib:

| plot | first-party JS renderer | used by this project |
| --- | --- | --- |
| `force` / force-array | yes — `bundle.js` (React) | no |
| `text` | yes — vanilla JS, self-contained | no (needs tokens) |
| `image` | yes | no |
| **beeswarm** | **no — matplotlib only** | **yes** |
| **heatmap** | **no — matplotlib only** | **yes** |
| **waterfall** | **no — matplotlib only** | **yes** |
| bar / scatter / decision / violin | no — matplotlib only | no |

The three plots this platform actually ships are precisely the three with no first-party JS renderer. That
is the crux of the feasibility answer: **there is nothing to adopt, but there is a proven pattern to copy.**

**Note on `bundle.js` size.** §3.5 quotes 353,951 bytes from `master`. The bundle in the *installed*
v0.49.1 (`.worktrees/curatedcrc-retraining/.venv/lib/python3.12/site-packages/shap/plots/resources/bundle.js`)
is **346,060 bytes**, and `grep`ping it for the exposed globals gives:

```
SHAP={SimpleListVisualizer:Qe,AdditiveForceVisualizer:Nn,AdditiveForceArrayVisualizer:ri,
      React:e,ReactDOM:n,ReactDom:{render:function(e,n){var r=t.createRoot(n);return r.render(e),r}
```

with `version:"19.1.1"` inside — i.e. the bundle carries **React 19**, while this frontend is on React
18.3.1. Both numbers are right; they are different builds. Use the installed one when reasoning about what
would actually ship.

### 3.6 scatter / dependence — `shap/plots/_scatter.py::scatter`

Defaults: `color="#1E88E5"`, `cmap=colors.red_blue`, `dot_size=16`, `x_jitter="auto"`, `hist=True`.
If `color` is an `Explanation`, the interaction feature is auto-selected via
`shap/utils/_general.py::approximate_interactions`, which sorts rows by the x feature, walks them in
chunks of `inc = max(min(int(len(x)/10), 50), 1)`, and sums `|corrcoef|` per candidate feature. Cheap, but
it needs the **whole** `data` matrix — a top-K-truncated payload cannot do auto-colour selection. If the FE
wants the dependence plot, either let the user pick the colour feature explicitly or compute the
interaction ranking in Python.

---

## 4. The official SHAP colour scheme

Source: `shap/plots/colors/_colors.py`
(<https://raw.githubusercontent.com/shap/shap/master/shap/plots/colors/_colors.py>).

### The anchor colours

```python
blue_lch = [54.0, 70.0, 4.6588]
l_mid    = 40.0
red_lch  = [54.0, 90.0, 0.35470565 + 2 * np.pi]
gray_lch = [55.0, 0.0, 0.0]
blue_rgb = lch2rgb(blue_lch)
red_rgb  = lch2rgb(red_lch)
gray_rgb = lch2rgb(gray_lch)
light_blue_rgb = np.array([127.0, 196, 252]) / 255   # #7fc4fc
light_red_rgb  = np.array([255.0, 127, 167]) / 255   # #ff7fa7
old_blue_rgb   = np.array([30, 136, 229]) / 255      # #1e88e5
old_red_rgb    = np.array([255, 13, 87]) / 255       # #ff0d57
```

Running SHAP's own `_colorconv.lch2rgb` on those constants gives:

| Name | RGB (0–1) | Hex |
| --- | --- | --- |
| `blue_rgb` | `(0.000000, 0.543378, 0.983379)` | **`#008bfb`** |
| `red_rgb` | `(1.000000, 0.000000, 0.317964)` | **`#ff0051`** |
| `gray_rgb` | `(0.516155, 0.516151, 0.516173)` | **`#848484`** |
| `light_blue_rgb` | — | `#7fc4fc` |
| `light_red_rgb` | — | `#ff7fa7` |
| `old_blue_rgb` (legacy `#1E88E5`) | — | `#1e88e5` |
| `old_red_rgb` (legacy) | — | `#ff0d57` |

`#1e88e5` / `#ff0d57` are the *old* SHAP colours still used as the default `scatter` dot colour and inside
`red_transparent_blue` / `transparent_blue` / `transparent_red`. The current beeswarm / bar / waterfall
colours are `#008bfb` / `#ff0051`.

### `red_blue` — the beeswarm/scatter colormap

Built as a **100-stop `LinearSegmentedColormap`** where each stop is computed in **Lch**:

```python
nsteps = 100
l_vals = list(np.linspace(54.0, 40.0, 50)) + list(np.linspace(40.0, 54.0, 50))  # V-shaped lightness
c_vals = np.linspace(70.0, 90.0, 100)
h_vals = np.linspace(4.6588, 0.35470565 + 2*np.pi, 100)
# stop i is lch2rgb([l_vals[i], c_vals[i], h_vals[i]]) at position i/99
red_blue = LinearSegmentedColormap("red_blue", {...})
red_blue.set_bad(gray_rgb, 1.0); red_blue.set_over(gray_rgb, 1.0); red_blue.set_under(gray_rgb, 1.0)
```

The comment in source explains the deliberate lightness dip: *"we intentionally vary the lightness during
interpolation so as to better enable the eye to see patterns"*.

Variants in the same file: `red_blue_no_bounds` (identical stops, no bad/over/under grey),
`red_blue_transparent` (alpha 0.5), `red_blue_circle` (a circular hue version for categorical colouring).
No colorblind-safe alternative is defined anywhere in `_colors.py` — **not confirmed from source that SHAP
ships one**. If the user wants one, it will have to be invented.

### **The key insight for the frontend: you do NOT need Lab interpolation at runtime.**

SHAP computes the 100 stops in Lch **once, at import time**, then hands them to matplotlib as
`segmentdata`. Matplotlib's `LinearSegmentedColormap` then interpolates **linearly in each RGB channel**
between adjacent stops — from matplotlib's own source,
`lib/matplotlib/colors.py::_create_lookup_table`
(<https://raw.githubusercontent.com/matplotlib/matplotlib/main/lib/matplotlib/colors.py>):

> *"the rows define values (x, y0, y1) … A value between xᵢ and xᵢ₊₁ is mapped to the range y¹ᵢ₋₁ … y⁰ᵢ by
> linear interpolation."*

(The default LUT size is 256, so the mapping is quantised to 256 levels.)

**Therefore: embed the 100 precomputed hex stops and lerp in sRGB. That is bit-exact, no colour-space
library needed.** `d3-interpolate` has `interpolateLab`/`interpolateHcl` (`src/lab.js`, `src/hcl.js`) but
using them would be *wrong* — it would smooth the very kink SHAP's gamut clipping creates.

I measured how badly a subsampled stop table degrades. Using SHAP's own stops as ground truth against a
256-entry LUT:

| Stops embedded | Max per-channel error |
| ---: | ---: |
| 11 | 30.1 / 255 |
| 21 | 21.9 / 255 |
| 33 | 17.3 / 255 |
| 41 | 10.9 / 255 |
| **100 (all)** | **0** |

The error concentrates at `t ≈ 0.18`, where the red channel is gamut-clipped at 0 and then jumps
(`R: 0.000 → 0.190` between adjacent stops). Subsampling smooths that away and shifts the whole
blue→purple transition. **Ship all 100.**

```js
// shap red_blue — 100 stops, position i/99, linear sRGB interpolation between them.
// Generated from shap/plots/colors/_colors.py via shap's own _colorconv.lch2rgb.
export const SHAP_RED_BLUE = [
"#008bfb","#0089fa","#0088fa","#0086fa","#0085f9","#0084f9","#0082f8","#0081f7",
"#007ff7","#007ef6","#007cf5","#007bf4","#0079f3","#0077f2","#0076f1","#0074f0",
"#0073ef","#0071ee","#006fed","#186deb","#266cea","#306ae9","#3968e7","#4066e6",
"#4664e4","#4c63e3","#5261e1","#575fdf","#5b5ddd","#605bdc","#6459da","#6857d8",
"#6c54d6","#6f52d4","#7350d2","#764ed0","#794cce","#7d49cc","#8047c9","#8244c7",
"#8542c5","#883fc2","#8a3cc0","#8d39be","#8f36bb","#9233b9","#9430b6","#962db3",
"#9829b1","#9a25ae","#9d22ac","#a01fab","#a31daa","#a71aa9","#aa17a7","#ad13a6",
"#b00fa5","#b30aa3","#b604a2","#b900a0","#bc009f","#bf009d","#c2009c","#c5009a",
"#c70098","#ca0097","#cd0095","#cf0093","#d10091","#d40090","#d6008e","#d9008c",
"#db008a","#dd0088","#df0086","#e10084","#e30082","#e50080","#e7007e","#e9007c",
"#eb007a","#ec0078","#ee0076","#f00074","#f10072","#f30070","#f4006e","#f6006c",
"#f7006a","#f80067","#fa0065","#fb0063","#fc0061","#fd005f","#fe005c","#ff005a",
"#ff0058","#ff0056","#ff0053","#ff0051"];
```

### `red_white_blue` — the heatmap colormap

```python
rgb_colors = [blue_rgb*a + (1-a)*white for a in np.linspace(1, 0, 100)] \
           + [red_rgb*a  + (1-a)*white for a in np.linspace(0, 1, 100)]
red_white_blue = LinearSegmentedColormap.from_list("red_white_blue", rgb_colors)
```

This one is trivially exact in JS: two straight sRGB ramps, `#008bfb → #ffffff` on `t ∈ [0, 0.5]` and
`#ffffff → #ff0051` on `t ∈ [0.5, 1]` (technically white sits at t = 99/199 and 100/199, a 0.5 % offset —
ignore it).

### Waterfall / bar chrome colours — `shap/plots/_style.py`

<https://raw.githubusercontent.com/shap/shap/master/shap/plots/_style.py>, `_default_style` (lines 66–76):

| Style key | Value |
| --- | --- |
| `primary_color_positive` | `colors.red_rgb` → `#ff0051` |
| `primary_color_negative` | `colors.blue_rgb` → `#008bfb` |
| `hlines_color` | `#cccccc` |
| `vlines_color` | `#bbbbbb` |
| `text_color` | `white` (the value written *inside* a bar) |
| `tick_labels_color` | `#999999` |

Plus, hardcoded in the plot functions: beeswarm zero line `#999999`, beeswarm row guides `#cccccc`,
axis/tick colour `#333333`, NaN dots `#777777`, heatmap `f(x)` separator `#aaaaaa` and the `f(x)` line
itself `#000000`.

---

## 5. Payload size analysis

The JSON is O(n·p) floats. I measured this rather than estimating it: synthetic
`(n, p)` float matrices for `values` + `data`, plus `feature_names` of the form `Genus7_species123`,
serialised with `json.dumps` and gzipped at level 6.

**Caveat on the numbers: my synthetic values are Gaussian noise, i.e. maximally incompressible.**
Real SHAP matrices for microbiome data are far more compressible — most species have φ ≈ 0 and abundance
exactly 0. Treat these as an **upper bound**; expect real gzip figures 1.5–3× smaller for the wide cases.

| Encoding | 200 × 500 raw | gzip | 200 × 2000 raw | gzip | 50 × 500 raw | gzip | 1 × 2000 raw | gzip |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| float64 `.tolist()` (naive) | 4162 KiB | 1800 KiB | 16642 KiB | 7196 KiB | 1048 KiB | 452 KiB | 128 KiB | 43 KiB |
| float32 `.tolist()` | 4159 KiB | 1462 KiB | 16634 KiB | 5842 KiB | 1048 KiB | 369 KiB | 128 KiB | 37 KiB |
| **4 significant figures, text** | **1719 KiB** | **503 KiB** | **6870 KiB** | **2001 KiB** | **438 KiB** | **129 KiB** | **79 KiB** | **17 KiB** |
| float32 → base64 binary | 1052 KiB | 780 KiB | 4212 KiB | 3117 KiB | 271 KiB | 196 KiB | 66 KiB | 21 KiB |
| **top-50 + "other" column, 4 s.f.** | **174 KiB** | **53 KiB** | **174 KiB** | **53 KiB** | **44 KiB** | **14 KiB** | **2 KiB** | **0.6 KiB** |

**Baseline: the current PNG.** `mlflow-experiments/curatedcrc-rf/outputs/track_a_shap_beeswarm.png` is
**264,514 bytes = 258 KiB**, which is **344 KiB once base64-encoded** in the JSON envelope. Two of those
(beeswarm + heatmap) per prediction, plus one waterfall per record.

Three things fall out of this table:

1. **Rounding to 4 significant figures in text beats binary encoding after gzip.** float32 base64 looks
   smaller raw (1052 vs 1719 KiB) but gzips *worse* (780 vs 503 KiB) because IEEE mantissa bits are
   essentially random. Decimal text with 4 s.f. has low entropy and compresses hard. This is the opposite
   of the usual intuition, and it is why I would *not* reach for typed arrays here. It also keeps the
   payload debuggable in the browser network tab, which matters for a research platform.
   (For real sparse microbiome data the gap widens further in text's favour, because `0` is one byte.)
2. **Full 200 × 2000 is not shippable.** 2 MiB gzipped is a bad experience even on a fast connection, and
   `JSON.parse` on ~800k numbers will jank the main thread. 200 × 500 at ~500 KiB gzipped is borderline-OK.
3. **Top-K truncation is a 10–40× win** and is flat in `p` — which is the whole point.

### What top-K truncation breaks

* **The "Sum of N other features" row becomes a scalar, not a distribution.** In matplotlib that row is a
  full beeswarm row with `n` points spread across it (§3.1b). If Python only ships the top-K columns, the
  FE can draw the "other" row only if Python *also* ships the per-sample residual vector
  `other[i] = Σ_{j ∉ topK} φ[i, j]` — which is `n` extra floats, i.e. free. **Ship it.**
* **Additivity is preserved iff you ship the residual.** With `values_topK` + `other`,
  `base + Σ_K φ + other == f(x)` exactly. Without `other`, it doesn't, and the waterfall's f(x) tick is a
  lie. See §8.
* **Client-side `max_display` is capped at K.** If the server ships K = 50 and the user drags the slider to
  60, the FE must refetch. This is the crux of the architecture decision — see §7.
* **The colour axis for hidden features is gone**, so a user can never inspect feature #51 without a
  refetch.
* **Dependence/scatter auto-interaction selection is impossible** (§3.6).
* **A different global ordering is impossible.** If the user asks to sort by max|φ| instead of mean|φ|,
  the top-K under the new criterion may include features the server dropped.

### Recommended payload strategy

* Serialise as **decimal text with ~4 significant figures** (`%.4g`). SHAP values for probability outputs
  live in roughly `[-0.2, 0.2]`; 4 s.f. gives ~1e-6 absolute resolution, several orders below anything
  visible in a chart and below `assert_additivity`'s own `atol=1e-2`.
* **Columnar layout** (`values` as an array of per-feature arrays rather than per-sample arrays) is
  marginally better for gzip because a single feature's values are more self-similar than a single
  sample's, and it makes "drop feature j" a splice instead of a per-row map. Costs a transpose in Python.
  Worth doing; not worth agonising over.
* **Ship top-K with K ≫ max_display.** K = 100 or 150, with `max_display` defaulting to 15. That gives
  ~350–500 KiB raw / ~100–150 KiB gzipped for n = 200 — cheaper than the current PNG pair — and lets the
  slider run 5 → 100 **with no refetch**, which is the user's stated key requirement.
* Always include `other_values[n]` (the residual) and `n_other` (the count) so additivity holds and the
  "Sum of N other features" row is drawable at any `max_display ≤ K` by re-summing
  `Σ_{j > max_display-1} φ + other`.
* Enable gzip/brotli at the NestJS/ingress layer. Verify it — a large `application/json` body is exactly
  the case people forget to compress.

### Proposed JSON schema

Design artifact, not code. Shapes noted per field.

```jsonc
{
  "schema_version": 1,

  "model": {
    "name": "crc-rynazal-notebook",
    "version": "3",
    "run_id": "9f2c…",
    "stage": "Production"
  },

  "explanation": {
    "n_samples": 200,                 // n
    "n_features_total": 865,          // p BEFORE truncation
    "n_features_sent": 100,           // K
    "output_index": 1,                // which class slice of a (n, p, 2) array
    "output_name": "CRC",
    "link": "identity",               // matches shap force's `link`; "logit" if ever needed
    "aggregate_by": null,             // null | "genus" — mirrors ?aggregate_by

    "instance_ids": ["S001", "S002"],           // (n,) — index of the input DataFrame
    "feature_names": ["Fusobacterium_nucleatum"], // (K,) — already in descending mean|phi| order

    "base_values": [0.5241],          // (n,) per-sample; length 1 means "same for every row"
    "fx":          [0.8130],          // (n,) convenience: base + full row sum. Redundant but cheap.

    // COLUMNAR: values[j][i] is phi for feature j, sample i. (K, n)
    "values": [[0.031, -0.004], [0.012, 0.019]],
    // COLUMNAR feature values used for colour. (K, n). null when the model has no `data`.
    "data":   [[0.0042, 0.0], [0.0, 0.0031]],

    // Everything not in the top-K, summed per sample. (n,)
    "other_values": [0.0071, -0.0032],
    "n_other": 765,                   // = n_features_total - n_features_sent

    // Precomputed global summary over ALL p features, so the FE can label
    // ranks it doesn't hold data for.
    "global": {
      "mean_abs_sent":  [0.0184, 0.0121],   // (K,) mean(|phi|) per sent feature
      "mean_abs_other": 0.00021             // scalar, mean over the dropped tail
    }
  },

  "encoding": {
    "float_format": "%.4g",
    "nan": null,                      // NaN/Infinity are serialised as JSON null — see §8
    "layout": "columnar"
  },

  "cache": {
    "key": "sha256:…",                // see §7 for how this is built
    "computed_at": "2026-09-11T04:12:00Z",
    "shap_version": "0.49.1"
  }
}
```

Notes:

* `values` and `data` are the same shape; `data` is `null` (not omitted) when unavailable, so the FE can
  branch on presence and fall back to the single-colour beeswarm that SHAP itself uses in that case
  (`_beeswarm.py` lines 157–161: `color = colors.blue_rgb` when `features is None`).
* `base_values` as an array of length 1 vs length `n` is a deliberate encoding, not an accident — see §8
  on the current `base_scalar` collapse.
* Waterfall for record *i* needs **no separate request**: it is `values[*][i]`, `data[*][i]`,
  `base_values[i]`, `other_values[i]`. See §7.

---

## 6. JS/React library survey

Sizes below are **npm registry `unpackedSize`** (the tarball's uncompressed contents) for the current
`latest` — a primary-source figure, but **not** a min+gzip bundle figure. Real shipped weight depends on
tree-shaking and is not confirmed from primary sources except where a project states it (uPlot does).

Frontend constraints from `explainable-platform/package.json`: **Next 12.3.4, React 18.3.1, TypeScript 4.9.5**.

| Library | Latest | License | npm unpacked | Dense scatter w/ per-point colour | Canvas | Ordered categorical y-axis | Diverging horizontal bars | React 18? |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| **d3-scale + d3-interpolate** (no framework) | 4.0.2 / 3.0.1 | ISC | 174 KB + 70 KB | you draw it | your choice | you draw it | you draw it | N/A (framework-free) |
| **visx** (`@visx/*`) | 4.0.0 | MIT | 431 KB (xychart) | yes, `@visx/shape` primitives | you render into `<canvas>` yourself | yes, `scaleBand` | yes | **Yes** — README: *"visx v4 is the current stable release and requires React 18 or 19"*; npm peerDeps `^18.0.0 \|\| ^19.0.0` |
| **d3** (full) | 7.9.0 | ISC | 871 KB | yes | manual | yes | yes | N/A |
| **Observable Plot** | 0.6.17 | ISC | 1.53 MB | yes (dot mark) | SVG only (no canvas renderer documented) | yes | yes | imperative DOM node; needs a wrapper |
| **Apache ECharts** | 6.1.0 | Apache-2.0 | 60.3 MB (incl. all builds/maps) | yes (`scatter`) | **yes** — `echarts.init(dom, null, {renderer: 'canvas'})`, canvas is the default; handbook: *"For larger amounts of data (>1k is an experience value), canvas renderer is always recommended"* | yes (`category` axis) | yes | framework-agnostic |
| **Plotly.js** (`plotly.js-dist-min`) | 4.1.0 | MIT | 5.63 MB | yes (`scattergl`, WebGL) | WebGL | yes | yes | framework-agnostic |
| **Recharts** | 3.10.1 | MIT | 7.45 MB | yes (`ScatterChart`) | SVG only | yes | yes | yes (peerDeps include `^18.0.0`) |
| **uPlot** | 1.6.32 | MIT | 545 KB | not really — it is a time-series/line plotter | yes, Canvas 2D | no | no | framework-agnostic |
| **Nivo** (`@nivo/*`) | 0.99.0 | MIT | 254 KB (core) | yes; `ScatterPlotCanvas` — docs: *"well suited for large data sets as it does not impact DOM tree depth"* but *"you lose the isomorphic ability and transitions"* | yes (Canvas variants) | yes | yes (`@nivo/bar`) | peerDeps `^16.14 \|\| ^17.0 \|\| ^18.0 \|\| ^19.0` |

Sources: npm registry metadata (`https://registry.npmjs.org/<pkg>`);
visx README <https://github.com/airbnb/visx>;
ECharts handbook <https://echarts.apache.org/handbook/en/best-practices/canvas-vs-svg/>;
nivo <https://nivo.rocks/scatterplot/canvas/>;
uPlot README <https://github.com/leeoniya/uPlot> (*"A small (~50 KB min) … Canvas 2D-based chart"*).

### Ruling libraries out

* **uPlot** — wrong shape of problem. No categorical axis, no per-point colour scale, no diverging bars.
  Excellent at 100k-point time series, useless for a beeswarm. Out.
* **Plotly.js** — 5.6 MB unpacked for a chart the app draws in three places, and its opinionated interaction
  model (modebar, hover templates) fights a custom design. Out on weight alone.
* **Recharts** — SVG-only. A 200 × 15 beeswarm is 3,000 DOM nodes; a 200 × 100 heatmap is 20,000 `<rect>`s.
  It will render but scroll/hover will be sluggish, and Recharts has no beeswarm-shaped primitive so you
  end up hand-positioning a `Scatter` anyway. Out.
* **Observable Plot** — genuinely elegant API and it *would* express the beeswarm nicely, but it is
  imperative (returns a DOM node you append), SVG-only, and 1.5 MB unpacked. The React integration is
  a `useEffect` + `replaceChildren` wrapper that fights React 18 StrictMode double-effects. Out, reluctantly.
* **ECharts** — the strongest *framework* candidate: canvas by default, explicitly recommended for
  >1k points, Apache-2.0, mature. But the 15-row beeswarm is not an ECharts chart type, so you'd use
  `custom` series and end up writing the same render function you'd write by hand — plus a 60 MB package
  in `node_modules` and an option-object mental model layered on top. It buys tooltips and zoom for free,
  which is not nothing. **This is the fallback.**

### Recommendation: hand-rolled SVG/Canvas on `d3-scale` + a 3-line sRGB lerp

**Reasoning:**

1. **The three charts are not generic charts.** A beeswarm is "for each of 15 rows, place n dots at
   (φ, rowCentre + jitter) coloured by a per-row-normalised scale". A waterfall is "15 arrows laid end to
   end". A heatmap is "an image". None of these is a `<BarChart>`. Every chart library will be used as a
   coordinate system and a tooltip host, and nothing more.
2. **You must match SHAP's algorithms exactly** (§3) — the jitter, the per-row 5/95 colour clip, the
   "Sum of N other" merge. No library gives you those, so the algorithmic work is constant across all
   options. Adding a framework adds integration cost without removing implementation cost.
3. **The colour scale is a fixed 100-stop table with linear sRGB interpolation** (§4). `d3-scale`'s
   `scaleLinear().domain([...]).range([...])` with an explicit `interpolateRgb` reproduces it exactly, or
   you write six lines yourself. `d3-scale` (ISC, 174 KB unpacked, tree-shakeable) + `d3-interpolate`
   (ISC, 70 KB) is a rounding error next to the existing `flowbite-react` + `motion` + `sweetalert2`.
4. **Rendering strategy per chart, deliberately mixed:**
   * **beeswarm** — `<canvas>` for the dots (200 × 15 = 3,000 points, and up to 200 × 100 = 20,000 if the
     user opens the slider), SVG overlay for axes/labels/gridlines, hit-testing via a quadtree
     (`d3-quadtree`, ISC) or a simple grid index. This mirrors what SHAP itself does — it sets
     `rasterized=True` above 500 points (`_beeswarm.py` line 439).
   * **waterfall** — pure SVG. ≤ 20 arrows. Trivially hoverable and accessible.
   * **heatmap** — `<canvas>` via `putImageData` at 1 px per cell then CSS-scale, which is exactly
     matplotlib's `imshow(interpolation="nearest")`.
5. **Next 12 / React 18 compat is a non-issue** for a library with no React dependency at all. `d3-scale`
   is pure functions. (Note: Next 12 has no `"use client"`; anything touching `canvas` needs
   `next/dynamic` with `ssr: false` or a `useEffect` guard — a one-liner either way.)

**Fallback: Apache ECharts** with `renderer: 'canvas'` and `custom` series, if the team decides the
tooltip/zoom/legend/export plumbing is worth more than bundle size and control. Pick this if the same
people also want six more conventional charts elsewhere in the app.

**Do not** adopt `shapjs` / SHAP's `bundle.js` (§3.5).

---

## 7. Architecture options

### (A) Keep the PNG, add an interactive overlay

Server keeps rendering matplotlib; the FE overlays an invisible hit-test layer (from a JSON sidecar of
bounding boxes) to provide tooltips.

**Reject.** Specifically:

* You'd need pixel coordinates from matplotlib, which means running the transform after `tight_layout()`
  and `bbox_inches="tight"` — both of which change the axes position *after* you'd query it. Fragile.
* `max_display` still requires a server round-trip and a full re-render. That is the user's primary ask,
  and this option cannot satisfy it.
* The beeswarm jitter is **unseeded random** (§3.1c), so re-fetching the same plot moves every dot. Any
  cached overlay goes stale against a re-rendered image.
* The `_plt_lock` global mutex stays, so explain throughput remains one-plot-at-a-time per pod.
* Retina/DPI: you now have to keep an image and a coordinate system in sync across devicePixelRatio.

Worth exactly one sentence in the final write-up, as the thing you rejected.

### (B) Python returns full Explanation JSON; NestJS caches it; FE renders everything

**Pros:** maximal client-side freedom — any `max_display`, any ordering, any drill-down, zero refetches.
The Python service gets simpler (delete matplotlib, delete `_plt_lock`, delete the base64 plumbing).

**Cons:** the size table in §5. 200 × 2000 is 2 MiB gzipped and ~800k `JSON.parse`d numbers.

**Does S3/GCS still matter?** Yes, but for a different reason. Today `StorageService` exists to hold
binary PNGs (`explainable-platform-service/src/storage/storage.service.ts` — note it is **GCS**, not S3;
the method is still named `uploadToS3` for call-site compatibility). With JSON:

* The payload is still too big for a Postgres `jsonb` column you query, and too big to inline in the
  websocket `prediction:explain` event that `prediction.processor.ts` currently emits.
* Keeping it in GCS and handing the FE a **V4 signed URL** (already implemented, 1 h TTL) means the JSON
  is served by Google's CDN with `Content-Encoding: gzip`, never touches NestJS memory on read, and the
  existing `toPredictionExplainEvent` shape barely changes — swap `heatmap: <signed png url>` for
  `explanation: <signed json url>`.
* So: **keep GCS, change the content type.** Set `contentType: "application/json"` and
  `contentEncoding: "gzip"` on the object, store gzipped bytes. Drop `MIN_PNG_BASE64_LEN` (the 8000-char
  blank-PNG heuristic in `prediction.processor.ts`) and replace it with a schema/shape check.

### (C) Hybrid: Python returns a pre-computed, plot-specific view model

Python ships already-ordered, already-binned, already-jittered, already-colour-normalised top-K rows;
the FE is a dumb renderer; anything needing more data triggers a cheap re-request.

**Pros:** smallest payload, guaranteed pixel-parity with matplotlib, FE work is minimal.

**Cons — and these are decisive:**

* **Jitter is a function of `max_display`.** No — actually it isn't (each row's jitter depends only on that
  row's own values). But the **"Sum of N other features" row is** — its φ vector changes every time
  `max_display` changes (§3.1b). So a precomputed view model pins `max_display`, and every slider tick
  is a round-trip. That directly contradicts the user's requirement.
* Jitter is a **layout** decision that depends on the rendered row height in CSS pixels, the marker radius,
  and whether the user has resized the window. Computing it in Python bakes in a matplotlib figure size
  the browser doesn't have.
* You end up with three bespoke endpoints again, each versioned against a specific FE rendering — the
  same coupling you have today, just with JSON instead of PNG.

### Where ordering, top-K and jitter should be computed

Given the requirement "user adjusts `max_display` client-side without a refetch":

| Concern | Where | Why |
| --- | --- | --- |
| **Global ordering** (`mean(\|φ\|)` descending) | **Python**, and ship the ordered arrays | It is O(n·p) over the *untruncated* matrix, which the FE will never hold. Ship features already sorted; the FE's "sort by X" then only reorders the K it has. |
| **Top-K truncation to K ≈ 100–150** | **Python** | Bounds the payload; K is a transport concern, not a display concern. Must be accompanied by `other_values[n]` and `n_other`. |
| **`max_display` (5–100) selection out of K** | **FE** | Pure slice + re-sum of the tail. Instant, no network. This is the whole point. |
| **The "Sum of N other" row** | **FE**, computed as `Σ_{j ≥ max_display-1, j < K} φ[j] + other_values` | Recomputable at any `max_display ≤ K` from what the FE already holds. Exactly reproduces SHAP's `num_cut = p - max_display + 1` semantics if the FE labels it `p_total - max_display + 1`. |
| **Jitter / point stacking** | **FE** | Depends on rendered row height and marker size; must be recomputed when `max_display` or the viewport changes. Also: SHAP's own version is unseeded, so the FE should use a **seeded** PRNG (seed on feature name) for a stable UI. |
| **Per-row colour normalisation (5th/95th pct)** | **FE** — but Python may precompute `vmin`/`vmax` per feature as a 2×K array | The percentiles are over `data[:, j]`, which the FE has for the K it holds. Precomputing is 2K floats and removes a sort per row; either is fine. |
| **Heatmap instance ordering** | **Python** — ship an `instance_order` index array `(n,)` | `hclust` needs scipy. Cheap to ship (`n` small ints). This repo's `sum(1)` override is FE-computable, but shipping the array keeps the door open for real `hclust` later. |

### Recommendation: **B, with a K-bounded payload — i.e. B shaped by C's discipline**

Concretely:

1. Python gets one new endpoint, `POST /v1/explain/values/<model>?aggregate_by=&top_k=`, returning the
   §5 schema. It replaces all three plot endpoints.
2. NestJS calls it once per prediction, gzips, writes to GCS as `application/json`, and emits the signed
   URL over the existing `prediction:explain` event.
3. The FE fetches that one document and renders **beeswarm, global bar, heatmap, and every per-record
   waterfall** from it (see below).
4. The old `/v1/explain/{beeswarm,heatmap,waterfall}` PNG endpoints stay live during migration and are
   deleted afterwards, along with `_plt_lock` and the matplotlib import.

### Caching and invalidation

SHAP values are deterministic given (model version, explainer config, input rows) — with one asterisk:
`PermutationExplainer` and `KernelExplainer` are sampling-based, so they are only deterministic if seeded.
`TreeExplainer` (the RF path) is exact and deterministic. Not confirmed from source whether this repo's
GCN/permutation path seeds its RNG — **check `mlflow_explainable`'s explainer construction before
promising determinism for that model.**

Cache key:

```
sha256(
  model_name || ":" || model_version || ":" ||
  shap_version || ":" ||
  aggregate_by || ":" || top_k || ":" ||
  sha256(canonical(dfColumns)) || ":" ||
  sha256(canonical(sorted(dfData rows)))
)
```

Include `model_version` (not just name) because `/v1/models` resolves the *Production* alias, which moves.
Include `shap_version` because the ordering/merge semantics could change across releases. Include `top_k`
because a K=50 document cannot serve a K=150 request. Invalidate on stage transition — the platform
already has a `PUT /v1/mlflow/run/<run_id>/stage` endpoint that is the natural hook.

Store the key in the `Prediction` row next to the GCS object key so a repeat prediction on identical input
skips inference entirely.

### Can the FE compute a local waterfall from the global payload? **Yes.**

Given the §5 document, the waterfall for sample `i` is:

1. `phi_i = [values[j][i] for j in 0..K-1]`, `x_i = [data[j][i] for j in 0..K-1]`.
2. `order = argsort(-abs(phi_i))` — per-sample, **not** the global order. (SHAP does exactly this:
   `_waterfall.py` line 88.)
3. `base = base_values[i]` (or `base_values[0]` if length 1), `fx = fx[i]`.
4. `loc = fx`; for `k` in `0..max_display-2`: `sval = phi_i[order[k]]`; `loc -= sval`; bar spans
   `[loc, loc + sval]`.
5. Residual row: `remaining = base - loc`, label `"{p_total - max_display + 1} other features"`.

**The base_value caveat, and it is the important one.** This works only if the payload carries the
**per-sample** `base_values[i]`. The current Python code does *not*:

```python
# kserve-shap-multi-modelserver.py::get_shap_value
if hasattr(base_value, "ndim") and base_value.ndim >= 1:
    base_scalar = float(base_value.ravel()[0])   # <- takes SAMPLE 0's base value for EVERY sample
```

with the comment *"they're usually identical"*. For `TreeExplainer` with a fixed background set that is
true — `expected_value` is a single number tiled across rows (`_tree.py` lines 431–439). It is **not**
true in general: `interventional` TreeExplainer with a per-row background, and any explainer where the
masker varies per row, produce genuinely per-row base values. The fix is one line and costs `n` floats:
ship the whole `base_values` array, collapsing to length 1 only when all entries are equal. See §8.

---

## 8. Numerical / correctness gotchas for a JSON round-trip

### 8.1 `NaN` and `Infinity` are not valid JSON — and the current code emits them

This is a live bug waiting to happen, not a hypothetical.

* Python's `json.dumps` defaults to `allow_nan=True` and emits the bare tokens `NaN` / `Infinity`:
  ```
  >>> json.dumps({'a': float('nan'), 'b': float('inf')})
  '{"a": NaN, "b": Infinity}'
  ```
* Flask does **not** override that. `flask/json/provider.py::DefaultJSONProvider.dumps`
  (<https://raw.githubusercontent.com/pallets/flask/main/src/flask/json/provider.py>, lines 166–179) sets
  only `default`, `ensure_ascii` and `sort_keys` before calling `json.dumps` — `allow_nan` is untouched.
* `JSON.parse` rejects it: `JSON.parse('{"a":NaN}')` → `SyntaxError: Unexpected token 'N'`. Axios's
  default `transformResponse` uses `JSON.parse`, so the whole response fails, not just the field.
* The repo's `safe_jsonify` does not help: its first branch is
  `isinstance(v, (str, int, float, bool)) or v is None: return v`, and `float('nan')` is a `float`.
  It passes NaN straight through.
* **NaN is reachable in this pipeline.** `transformer()` ends with
  `transformed_df.apply(pd.to_numeric, errors="coerce")`, which turns any unparseable abundance string
  into NaN. That NaN then flows into `data` and (depending on the model) into `values`.

**Fix:** a serialiser that maps non-finite floats to `null`, plus `allow_nan=False` so a leak raises
instead of silently shipping invalid JSON. The FE then treats `null` as "NaN" and draws it `#777777`,
exactly as `_beeswarm.py` does with `nan_mask`. Record the convention in the payload (`encoding.nan`).

Secondary: Flask's `sort_keys=True` default sorts dict keys on every response. Irrelevant for arrays, but
if the payload ends up dict-of-arrays it is a wasted sort on a large object — pass `sort_keys=False`.

### 8.2 Float precision

* SHAP values are float64 in numpy; `values.tolist()` yields Python floats which `json.dumps` renders with
  `repr` (17 significant digits, shortest round-trip). That is 3–4× more bytes than needed (§5).
* JS numbers are IEEE754 float64, so a full-precision round-trip is lossless. **Precision loss is a
  deliberate choice, not a constraint.**
* 4 significant figures gives ~1e-6 absolute error for φ in `[-0.2, 0.2]`. For comparison, SHAP's own
  additivity check tolerates `atol=1e-2, rtol=1e-2` (`_tree.py::assert_additivity`). A chart pixel at
  800 px wide over a 0.4-unit domain is 5e-4 per pixel. 4 s.f. is ~500× below one pixel. Safe.
* **But**: do the rounding on `values` and `data`, **not** on `base_values`/`fx`. Those are absolute model
  outputs where a user may read the number off the axis; give them 6–8 s.f.
* Rounding breaks exact additivity by up to `K × 1e-6`. Either accept it (invisible) or compute
  `other_values` *after* rounding so the residual absorbs the error exactly. The latter is one extra line
  and makes `base + Σφ + other == fx` hold bit-exactly in the payload. Recommended.

### 8.3 The additivity invariant, and how truncation breaks it

`base_values[i] + Σ_j φ[i,j] == f(x_i)` (§1). Truncating to top-K drops
`Σ_{j ∉ K} φ[i,j]`, which for microbiome data with p = 865 and K = 100 is **not** negligible — hundreds of
small same-signed contributions can sum to a substantial number. Concretely, in this repo's own Rynazal
reproduction 549 of 865 features have non-zero mean|φ| (`docs/rynazal-2023-reproduction-notes.md` §2), so
the tail is large and real.

Shipping `other_values[i] = Σ_{j ∉ K} φ[i,j]` restores the invariant exactly. Without it:

* the waterfall's `f(x)` tick and the sum of its bars disagree, visibly;
* the heatmap's `f(x)` line is wrong;
* any client-side "check the numbers add up" assertion fails.

Also worth flagging to the user: **SHAP's own "Sum of N other features" row means the K-th ranked feature
is never shown alone** (§3.1b, §3.2). If the FE deviates from that (e.g. shows the top 15 individually
*plus* an "other" row of ranks 16..p), the plot will not match a matplotlib reference and a reviewer who
knows SHAP will notice. Decide deliberately; it is arguably the better design, but it is a deviation.

### 8.4 Per-sample vs scalar base values

Covered in §7. Restating the verdict: `base_scalar = float(base_value.ravel()[0])` is **safe for the
TreeExplainer models in this repo** (`_tree.py` tiles a scalar `expected_value` across rows) and **not
safe as a general contract**. Since the contract in
`mlflow_explainable/contract.py` explicitly allows `base_values` of shape `(n, n_classes)`, the JSON
payload should carry the array and let the FE collapse it, not the other way round. Cost: `n` floats.

### 8.5 Genus aggregation and additivity

`_aggregate_shap_by_genus` sums φ within each genus via a one-hot matrix multiply. The docstring's claim is
correct: **summation preserves additivity**, because Σ over groups of a partition equals Σ over all
features, so `base + Σ_genera φ_g == f(x)` still holds. Two caveats:

1. It also sums `data` ("total relative abundance of the genus"), which is meaningful for relative
   abundance but would be nonsense for any non-additive feature (log-ratios, CLR-transformed data,
   z-scores). If the pipeline ever CLR-transforms, this aggregation silently produces garbage colours.
2. The genus is derived as `c.split("_")[0]`, so a column named `unclassified_Bacteroides_sp` collapses
   under genus `"unclassified"`. Pre-existing behaviour, orthogonal to this note, but worth a look.
3. The FE must know whether aggregation happened, because feature counts and names differ — hence
   `explanation.aggregate_by` in the schema. Cache keys must include it too (§7).

### 8.6 Other

* **Large-array `JSON.parse` blocks the main thread.** At ~500 KiB gzipped / ~1.7 MB raw, parse is tens of
  milliseconds — acceptable. If K ever grows past a few hundred, move the fetch+parse into a Web Worker.
* **Column order must be pinned.** `transformer()` reorders the input DataFrame to `input_columns`; the
  payload's `feature_names` is authoritative and the FE must never assume it matches the uploaded CSV order.
* **`instance_ids` are the DataFrame index**, which `predict` also uses (`result_df.index = input_data.index`).
  Keep them as strings in JSON; numeric indices silently become numbers and then `String(id)` mismatches.

---

## 9. What is lost by leaving matplotlib

Things the FE reimplementation should accept as "close but not identical":

1. **Font metrics.** Every matplotlib text-placement decision (the waterfall's "does the label fit inside
   the arrow?" check at `_waterfall.py` lines 230–245) measures rendered text via the renderer. In the
   browser you'd use `canvas.measureText` or `getBBox` — same idea, different metrics, so labels will
   break inside/outside at slightly different widths.
2. **Exact axis tick selection.** Matplotlib's `MaxNLocator` picks "nice" ticks with rules that d3's
   `ticks()` does not exactly reproduce. Close, not identical.
3. **The unseeded jitter** (§3.1c). The FE *cannot* reproduce a specific PNG's dot arrangement, because
   that arrangement was random. Use a seeded PRNG and accept the plots are not comparable dot-for-dot.
   Frame this as a fix, not a regression.
4. **`tight_layout()` / `bbox_inches="tight"` margins.** The current code also does a bespoke y-label
   re-placement at `x_min - 0.030 * x_range` with italicised species names (`get_beeswarm`,
   `get_heatmap`, `get_local_waterfall_plot`). That italics convention and the `_is_summary_row` check are
   platform-specific and easy to keep — they're CSS.
5. **Marker rendering.** `s=16` is points², an area. Browser canvas draws radii. `r = sqrt(16/π) ≈ 2.26 pt
   ≈ 3.0 px @96dpi`. Anti-aliasing differs between Agg and canvas.
6. **The colour LUT quantisation.** Matplotlib quantises to 256 levels; a JS lerp is continuous.
   Sub-1/255 difference, invisible.
7. **PNG export.** Users who right-click → Save Image today lose that. `canvas.toBlob()` plus an SVG
   serialiser gets it back, but it is extra work and the SVG path needs fonts embedded or the export
   looks different from the screen.

Genuinely hard to replicate:

* **`optimal_leaf_ordering`** for the heatmap's default instance order (§2). Ship the index array from
  Python instead of porting it.
* **Partition-tree dendrograms** in `shap.plots.bar` (`_bar.py` lines 356–387 with
  `shap/plots/_utils.py::dendrogram_coords` / `merge_nodes` / `sort_inds`). Only reachable with a
  `PartitionExplainer`; not applicable today, but it is the one plot feature that would be a real port.
* **`shap.plots.force`'s label-collision layout** — the D3 code in `bundle.js` does non-trivial text
  packing. If force is wanted, this is the place where reading SHAP's JS is worth the time.

Nothing here is a blocker. The honest summary is: **the data is identical, the layout is 95 % identical,
and the typography is where the eye will notice a difference.**

---

## 10. Effort estimate and rollout order

Assumes one developer familiar with each stack. Ranges reflect "it works" → "it's reviewed and tested".

| Service | Work | Estimate |
| --- | --- | --- |
| **Python** (`kserve-custom-runtime`) | New `/v1/explain/values/<model>` returning the §5 schema: reshape (n,p,2)→(n,p), per-sample `base_values`, top-K + residual, columnar transpose, `%.4g` rounding, non-finite→`null` serialiser with `allow_nan=False`, optional per-feature `vmin`/`vmax`, `instance_order` | **2–3 days** |
| | Delete matplotlib path, `_plt_lock`, base64 plumbing (after FE cutover) | 0.5 day |
| | Tests: shape conventions, additivity with residual, NaN round-trip, genus aggregation | 1 day |
| **NestJS** (`explainable-platform-service`) | `StorageService`: gzip + `application/json` + `contentEncoding`; replace `MIN_PNG_BASE64_LEN` with a schema check; `prediction.processor.ts` one call instead of three; event payload `explanation: <signed url>`; cache key + skip-if-cached | **2–3 days** |
| | Entity/migration: `explanationKey`, `explanationError`, `cacheKey` columns; keep PNG columns during migration | 0.5 day |
| **Next.js FE** (`explainable-platform`) | Shared `useExplanation(url)` hook (react-query v3 is already there), typed payload, `d3-scale` + colour table module, seeded PRNG | **2 days** |
| | **Beeswarm**: canvas dots + SVG axes, jitter, per-row 5/95 colour, "Sum of N other" row, `max_display` slider, hover tooltip w/ quadtree hit-test, click-row → filter | **4–6 days** |
| | **Waterfall**: SVG arrows, per-sample ordering, residual bar, two-tone y labels, hover | **2–3 days** |
| | **Heatmap**: canvas `putImageData`, `f(x)` line, right-hand importance bars, instance hover → open that record's waterfall | **3–4 days** |
| | Global→local click-through wiring, loading/error/empty states, matching the existing `ShapPlotPlaceholder` UX | 2 days |
| | Visual regression against saved matplotlib references | 1–2 days |
| **Total** | | **≈ 4–5 weeks** for all three plots, single dev |

### Recommended rollout order

1. **Waterfall first.** Reasons, in order of weight:
   * It is a **single row** — the payload is `p` floats (0.6 KiB gzipped truncated, 17 KiB full). No size
     problem at all, so you can ship the *full* untruncated explanation and validate the schema end-to-end
     before the size question matters.
   * It is **pure SVG with ≤ 20 elements** — the simplest possible renderer, no canvas, no quadtree.
   * It is the **highest-value interaction** for a clinical/research user: "why did *this* sample get this
     score?" Hovering a bar to see the exact abundance and φ, and expanding `max_display` from 8 to 40 to
     see the whole tail, is an immediate improvement over a fixed 8-row PNG.
   * It is where the **base-value and additivity correctness questions** (§8.3, §8.4) surface most
     visibly — get them right here, once, and the other two inherit the fix.
   * It exercises the whole pipeline (Python → GCS → NestJS event → FE) with the lowest risk.
2. **Beeswarm second.** Highest visual value, hardest renderer. By this point the schema is proven and the
   only new work is the jitter + per-row colour + canvas hit-testing. This is also where the `max_display`
   slider pays off most.
3. **Global bar third — and consider adding it even though it doesn't exist today.** It is a 1-day chart
   (`mean_abs_sent` is already in the payload), it is the most legible global view for a non-ML reader,
   and it is the natural "click a bar → open the beeswarm row" entry point.
4. **Heatmap last.** Lowest interaction value per unit of effort, and it is the one with a genuine Python
   dependency (`instance_order`).

Run PNG and JSON side by side behind a feature flag for one release so the two can be compared on real
predictions before the matplotlib path is deleted.

---

## Open questions / decisions for the user

These are the contested choices. I have given a recommendation for each, but each is genuinely arguable.

1. **K (server-side top-K).** I recommend 100–150. K = 50 makes the payload trivially small but caps the
   `max_display` slider at 50 and forecloses "show me the whole tail". K = p (no truncation) at p = 865,
   n = 200 is ~700 KiB gzipped — possibly fine, and it makes every future feature free. **What is the
   actual worst-case (n, p) in production?** The size argument changes completely between n = 50 and
   n = 500. I did not find this in the repo.

2. **Does the "Sum of N other features" row stay faithful to SHAP, or get fixed?** SHAP absorbs the
   K-th-ranked feature into the "other" row, so `max_display=15` shows 14 real features. That is
   surprising and arguably a bug. Matching it preserves comparability with published SHAP figures
   (which matters for a thesis); fixing it is clearer for users. **You cannot have both.**

3. **Faithful reproduction vs. better design.** Same tension, broader: how much does pixel-parity with
   matplotlib matter? If the goal is "figures in a paper look like SHAP figures", every §3 constant is a
   requirement. If the goal is "the platform's users understand their predictions", several of SHAP's
   choices (per-row colour normalisation with no numeric legend; the unlabelled `f(x)` line on the
   heatmap; the "other" row coloured by an unrelated feature's abundance) are worth deviating from.

4. **Is `base_values` genuinely per-sample for the GCN/permutation model?** The current code collapses it
   to sample 0's value. Safe for `TreeExplainer`; unverified for the permutation path. Someone should
   check `mlflow_explainable`'s explainer construction, and also whether that explainer is **seeded** —
   the whole caching design (§7) assumes deterministic SHAP values.

5. **Hand-rolled vs. ECharts.** I recommend hand-rolled with `d3-scale`. The counter-argument is real:
   ECharts gives tooltips, zoom/brush, legend, PNG/SVG export and accessibility scaffolding for free, and
   a team that is not confident writing canvas hit-testing will ship faster with it. This is a team-skill
   question more than a technical one.

6. **One endpoint or three?** I recommend collapsing the three PNG endpoints into a single
   `/v1/explain/values`. But the waterfall endpoint currently enforces `len(input_data) == 1` and is
   called per-record; the beeswarm/heatmap are called per-prediction. Merging them changes the NestJS job
   graph. Is one document per prediction (serving all records' waterfalls) the right granularity, or do
   you want per-record documents?

7. **Where does the JSON live?** GCS + signed URL (my recommendation, reuses everything) vs. a Postgres
   `jsonb` column vs. streaming it over the existing websocket. GCS keeps NestJS out of the data path but
   means the FE makes a second cross-origin request with a 1 h TTL — which will expire on a long-lived tab.
   Needs a refresh path.

8. **Do you want `shap.plots.bar` at all?** It does not exist in the platform today. It is the cheapest
   chart to build from this payload and probably the most readable. Adding it is scope creep; not adding
   it leaves the most legible view on the table.

9. **Does the PNG path get deleted, or kept for export?** Users may want a publication-ready PNG. Keeping
   matplotlib alive purely as an "export figure" endpoint means keeping `_plt_lock` and the whole
   dependency, but a canvas/SVG export from the FE will not look like a matplotlib figure. **If figures
   from this platform go into a thesis, keep the matplotlib export endpoint** and let the interactive
   view be the interactive view.

10. **NaN policy.** I recommend `null`. The alternatives are the string `"NaN"` (survives JSON, needs
    per-field parsing) or server-side imputation (hides a data-quality problem the `pd.to_numeric(errors="coerce")`
    coercion is currently creating silently). Whichever you pick, the coercion in `transformer()` deserves
    its own look: I verified that `pd.to_numeric(errors="coerce")` handles surrounding whitespace fine
    (`"2.73449 " → 2.73449`), but an empty cell or a sentinel like `"NA"` / `"-"` becomes NaN with no
    warning, and that NaN then flows into `data` and the plot. Is silently treating a missing abundance as
    NaN the intended behaviour, or should it be 0?
