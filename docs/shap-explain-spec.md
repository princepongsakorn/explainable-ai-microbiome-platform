# SHAP explanation payload & `shap-svg` — specification

Normative spec for the work agreed in the Decision log of
[`shap-interactive-frontend-feasibility.md`](./shap-interactive-frontend-feasibility.md). That note
says **why**; this says **what**. Vocabulary is defined in [`CONTEXT.md`](../CONTEXT.md) — the terms
**Sample**, **Feature**, **SHAP value**, **Base value**, **Model output**, **Other features row** are
used here with exactly those meanings.

Everything in §3 of the feasibility note is the source of truth for algorithm behaviour. Constants
are restated here because they are acceptance criteria.

---

## 1. The Explanation payload

One payload per Prediction. Content type `application/json`, stored and transmitted gzip-encoded.

```jsonc
{
  "contract_version": 1,

  // --- core: named exactly as shap.Explanation names them ---
  "values":        [[0.0312, -0.0041, ...], ...],  // n × p
  "base_values":   [0.5238, 0.5238, ...],          // n   (see §1.3)
  "data":          [[0.0042, 0.0, ...], ...],      // n × p
  "feature_names": ["Fusobacterium_nucleatum", "Bacteroides_fragilis", ...],  // p

  // --- optional: platform extras, absent for third-party callers ---
  "sample_ids":    ["a1b2…", ...],   // n — enables click-through to a Local explanation
  "sample_labels": ["SAMD00114722", ...], // n, optional — what a person reads; never a join key
  "sample_label_column": "sample_id",     // optional — header the labels came from
  "output_names":  ["CRC"],          // labels the Model output axis
  "model_name":    "crc-rynazal-notebook",
  "model_version": "1"
}
```

### 1.1 Required vs optional

`contract_version`, `values`, `base_values`, `data`, `feature_names` are **required**. Everything else
is optional; `shap-svg` renders fully without them, losing only the features each enables.

A payload containing only the five required fields is exactly `json.dumps` of four `shap.Explanation`
attributes plus a version — that is the point of the contract. Any Python user with `shap` installed
can produce one without reading this document.

### 1.2 Shapes and class selection

`values` may be `n × p` (already class-selected) **or** `n × p × 2` (binary classification as
`TreeExplainer.__call__` emits it). `base_values` may correspondingly be `n` or `n × 2`, or a bare
scalar. `shap-svg` accepts all of these and selects with a `classIndex` option defaulting to `1`.

The platform's own payloads are always pre-selected to `n × p` and `n`; the 3-D forms exist so that
third-party callers do not have to know about the class axis.

### 1.3 `base_values`

Always conceptually **per Sample**. It MAY be serialized as a bare number when every Sample shares
the same value (the `TreeExplainer` case, which is 5 of this platform's 6 models); consumers MUST
treat a scalar as "the same value for every Sample". It MUST NOT be serialized as a scalar taken from
Sample 0 when the values actually differ — that is the bug this contract exists to prevent.

### 1.4 Numeric encoding

Every float is written as **decimal text rounded to 4 significant figures**. No base64, no typed
arrays. Rationale, measured: 4-s.f. text after gzip is smaller than float32-base64 after gzip, and
fixtures stay human-readable — which both a reviewer and an implementing agent need throughout.

`NaN` and `Infinity` MUST NOT appear. They are not valid JSON, Flask's default provider emits them
bare, and `JSON.parse` rejects them. The upload path guarantees this by rejecting unparseable cells
rather than coercing them (see §2.1).

### 1.5 Invariants

| # | Invariant | Enforced by |
| --- | --- | --- |
| I1 | `values.length === data.length === base_values.length === n` | producer + consumer validation |
| I2 | every row of `values` and `data` has length `feature_names.length === p` | producer + consumer validation |
| I3 | `base_values[i] + Σ values[i]` equals the Model output for Sample `i` **within 1e-3 absolute** | test only — the payload does not carry `f(x)` |
| I4 | no `NaN`, no `Infinity`, no `null` in `values`, `data`, `base_values` | producer |
| I5 | `contract_version` is an integer the consumer recognises, else the consumer throws a named error | consumer |

I3's tolerance is a consequence of §1.4: 4-significant-figure rounding breaks exact additivity.
Tests MUST use the tolerance and MUST NOT assert exact equality.

The tolerance is **absolute, not relative**, and that is deliberate. The Model output is a probability
which can be exactly `0`, and a relative tolerance against zero is meaningless — it either divides by
zero or, guarded with an epsilon, reports an astronomical error for a rounding difference of 1e-8.
Measured on the 201-Feature fixture, unrounded additivity error is **1.4e-08** and post-rounding error
is **1.09e-04**; the error grows roughly with √p, so 1e-3 leaves headroom at p = 865.

---

## 2. Platform pipeline

### 2.1 Upload

* Reject an upload of more than **500 Samples**, with an error naming the limit and the actual count.
* Reject an upload containing a cell that does not parse as a number, naming the row and column.
  Absent Features are filled with `0` — a true biological zero, not missing data.
* These two rules together are what make I4 hold without any serializer workaround.

### 2.2 Computing the Explanation

One queue job per Prediction. Within the job, call the Python explain endpoint in **chunks of 50
Samples**, concatenating results in NestJS. Each chunk is retried independently, 3 attempts with
exponential backoff. Progress is published as `{done, total}`.

Chunking is safe because the Explainer's background is fixed inside the model artifact, so a Sample's
SHAP values do not depend on which other Samples share its request. Nothing that requires seeing all
Samples at once happens in Python — ordering, colour scaling and instance ordering are all computed
in the browser.

### 2.3 Storage and transport

* Object: `gs://{bucket}/{prefix}/{predictionId}/explain.json.gz`, `contentType: application/json`,
  `contentEncoding: gzip`.
* `Prediction` gains: `explainKey`, `explainEtag`, `explainError`, `explainModelVersion`,
  `explainContractVersion`. **No existing column is removed** — `synchronize: true` would drop the
  column and its data.
* `explainEtag` is the SHA-256 of the uncompressed payload bytes, stored at write time.

```
GET /predict/:id/explain
GET /predict/:id/records/:recordId/explain     → a slice of the same artifact, never a recomputation
```

* `If-None-Match` matching `explainEtag` returns **304 from the database read alone** — GCS is not
  touched.
* Otherwise 200, streaming the stored bytes through unchanged with `Content-Encoding: gzip` and
  `Cache-Control: private, max-age=0, must-revalidate`.
* No signed URLs on this path. A signed URL expires inside an open tab; an ETag does not.

**Sample labels are for reading, `sample_ids` are for joining.** A label comes from an uploaded file,
so nothing guarantees it is unique; every join — the per-record route, the waterfall's row lookup,
click-through — uses `sample_ids`, which are record UUIDs, and a renderer never shows one.

The first uploaded column is taken as the identifier **unless its header is one of the model's
`feature_names`** — then the file has no identifier column. The test is by meaning, not by name:
the sample files alone use `sample_id`, `subject_id` and a blank header, and some number their
subjects, so neither a list of names nor "is it non-numeric" holds. A Sample with no usable id
(no identifier column, or a blank cell) is labelled `Record #<record_number>`, prefixed so it cannot
be read as a numeric id from the file. Payloads built before labels existed have none; renderers
fall back to `Sample <n>`.

`PredictionRecord.id` maps to the payload's `sample_ids` entry at the same index. **Record** is the
platform's word and **Sample** is the payload's word for the same thing; the boundary between them is
this mapping and nowhere else.

---

## 3. `shap-svg`

### 3.1 Shape of the package

```
packages/shap-svg/
  src/
    core/      # framework-free: validation, ordering, layout, colour. No React import anywhere.
    react/     # thin components over core
  index.ts     # re-exports core
  react.ts     # re-exports react
```

The `core` directory MUST NOT import React, and MUST NOT import anything from the host application.
That rule is what makes the eventual extraction to npm a `git mv`.

### 3.2 Public surface for milestone 1

```ts
type Explanation = {
  contract_version: number;
  values: number[][] | number[][][];
  base_values: number | number[] | number[][];
  data: number[][];
  feature_names: string[];
  sample_ids?: string[];
  sample_labels?: string[];
  sample_label_column?: string;
  output_names?: string[];
  model_name?: string;
  model_version?: string;
};

// core
function parseExplanation(input: unknown, opts?: { classIndex?: number }): ParsedExplanation;
function globalImportance(e: ParsedExplanation): number[];                 // mean(|φ|) per Feature
function orderFeatures(importance: number[]): number[];                    // descending, ties by index
function collapseToDisplay(
  e: ParsedExplanation, order: number[], maxDisplay: number, faithfulOtherRow: boolean
): DisplayRows;
function barLayout(rows: DisplayRows, width: number): BarLayout;

// react
<ShapBar explanation={…} maxDisplay={10} faithfulOtherRow={false} onFeatureClick={…} />
```

### 3.3 Bar chart — required behaviour

Verified against `shap/plots/_bar.py` at v0.49.1.

* A multi-row Explanation collapses to `mean(|φ|)` per Feature (`_bar.py:103-107`). The axis label is
  `mean(|SHAP value|)`.
* Feature order is **descending** by that value (`_bar.py:181-183`, which reduces to a plain argsort
  for a single cohort).
* `num_features = min(max_display, p)`; `row_height = 0.5`; `total_width = 0.7`, and for the single
  cohort this project has, `bar_width = 0.7` and the per-cohort y-offset is exactly `0`.
* Bars use `#ff0051` when the value is `> 0` and `#008bfb` when `<= 0` (`_bar.py:267-271`;
  note the boundary: zero is coloured negative). Edge stroke `rgba(255,255,255,0.8)`.
* A vertical rule at `x = 0`, `#000000`, 1 px, is drawn **only if any displayed value is negative**
  (`_bar.py:252-254`).
* Value labels are `format_value(v, "%+0.02f")` placed `5/72 inch` outside the bar end.
* Tick label font size 13; value label font size 12.

### 3.4 The Other features row

SHAP's own behaviour (`_bar.py:228-241`, and identically in beeswarm and heatmap) is that the last
displayed row **absorbs the Feature ranked `max_display`**, so `max_display=15` shows 14 real
Features and one combined row labelled `Sum of {p - max_display + 1} other features`.

`shap-svg` implements **both**, switched by `faithfulOtherRow`:

* `false` (default): `max_display` real Features are shown, plus a separate Other features row
  carrying the sum of ranks `max_display .. p-1`. Label: `{p - max_display} other features`.
* `true`: byte-compatible with SHAP as described above.

The row is always recomputed from the full matrix when `maxDisplay` changes. It is a re-partition,
so the sum over all displayed rows always equals the sum over all Features — that identity is a test.

### 3.5 Agreed deviations from SHAP

| # | Deviation | Reason |
| --- | --- | --- |
| V1 | Numeric labels use significant figures or percent, never `%0.03f` | `format_value(0.0003, "%0.03f")` renders `0`, and `-0.0002` renders `−0`. Most relative abundances are below 1e-3, so SHAP's format is unusable here |
| V2 | Other features row defaults to the corrected behaviour | `max_display=15` showing 14 Features reads as a bug to users |
| V3 | Species names render italic with `_` replaced by a space | Biology typesetting convention; the existing matplotlib path already does this |
| V4 | Colour legends carry numeric ticks | SHAP labels only "High"/"Low" |
| V5 | The heatmap `f(x)` line gets a real axis and tooltip | SHAP normalises it and draws it with no scale |

V1 and V3 apply to milestone 1. V2 is milestone 1 as the `faithfulOtherRow` flag. V4 and V5 arrive
with beeswarm and heatmap.

### 3.6 Colour constants

Captured by running shap 0.49.1, not transcribed by eye.

```
positive / red   #ff0051
negative / blue  #008bfb
missing  / grey  #848484
```

`red_blue` (beeswarm) and `red_white_blue` (heatmap) are 256-entry lookup tables generated by the
capture script in §4 — they are **not** to be re-derived in TypeScript. matplotlib interpolates
linearly in sRGB between precomputed stops, so a lookup plus linear interpolation reproduces them
exactly.

---

## 4. Fixtures and golden values

Fixtures live in `packages/shap-svg/fixtures/`. They are generated offline from data already
committed to this repo plus the locally installed shap — no MLflow, no network.

| Fixture | Shape | Purpose |
| --- | --- | --- |
| `tiny.json` | 20 × 50 | unit tests, small enough to read by eye |
| `real.json` | 180 × 201 | genuine relative-abundance skew; the only fixture that exercises percentile clipping honestly |
| `large.json` | 331 × 865 | performance |
| `edge.json` | several | 1 Sample; an all-zero Feature column; all-negative values; `p < maxDisplay` |

Alongside each fixture, `*.golden.json` carries the arrays SHAP itself would draw, captured by
monkey-patching `plt.barh` / `plt.scatter` / `plt.arrow` before calling the real
`shap.plots.*` functions and recording their arguments.

Golden values are the acceptance criterion. A `shap-svg` layout function is correct when its output
matches the captured arrays within `1e-6` absolute for coordinates and exactly for colours — not when
it "looks like SHAP".

Synthetic Gaussian data is explicitly forbidden for `real.json`: it overstates gzip size by 1.5–3×
and, more importantly, hides the long-tailed distribution that makes percentile clipping matter.

---

## 5. Out of scope

Zoom and brush; image export from the browser; seeding the GCN Explainer; batching the predict path;
adopting SHAP's `bundle.js`; hierarchical clustering for instance ordering; content-addressed
caching.
