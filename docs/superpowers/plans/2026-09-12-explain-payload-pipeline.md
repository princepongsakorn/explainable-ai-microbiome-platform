# Explanation payload pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-image SHAP PNG pipeline with a single JSON Explanation per Prediction — computed in chunks, stored gzipped in GCS, and served through NestJS with an ETag.

**Architecture:** The KServe Flask service gains one endpoint that returns SHAP values as JSON for any number of Samples. A single Bull job calls it in chunks of 50, concatenates, gzips, writes one GCS object, and records its SHA-256 on the `Prediction` row. NestJS serves that object with conditional-GET semantics. The existing image columns and objects are left untouched as a visual reference.

**Tech Stack:** Python 3.12 + Flask + shap 0.49.1; NestJS + TypeORM + Bull + `@google-cloud/storage`; Next.js 12 + react-query.

## Global Constraints

- `docs/shap-explain-spec.md` is normative. This plan implements its §1, §2 and §4.
- `CONTEXT.md` defines the vocabulary. **Sample** at the payload layer, **Prediction Record** at the platform layer; the two meet only at the `sample_ids` mapping.
- **No entity property may be removed.** `app.module.ts:25` sets `synchronize: true`, which drops the column and its data. Additive changes only.
- Every float in the payload: decimal text, 4 significant figures. No `NaN`, no `Infinity`, no `null`.
- Row cap: **500 Samples** per Prediction. Chunk size: **50** Samples per HTTP call.
- Leave `/v1/explain/beeswarm`, `/v1/explain/heatmap`, `/v1/explain/waterfall` in place — they become the on-demand export path.

---

### Task 1: Fixtures and golden values

**This task blocks the `shap-svg` plan. Do it first.**

**Files:**
- Create: `tools/shap_fixtures/generate.py`
- Create (generated): `explainable-platform/packages/shap-svg/fixtures/{tiny,real,large,edge}.json`, `{tiny,real}.bar.golden.json`

**Interfaces:**
- Produces: the fixture and golden files consumed by every task of the `shap-svg` plan

No MLflow and no network. Train a small RandomForest on data already committed to this repo, explain
it with the locally installed shap, and capture what `shap.plots.bar` actually draws.

- [ ] **Step 1: Write `tools/shap_fixtures/generate.py`**

The script is committed at that path — read it rather than retyping it. Three things in it are
non-obvious and were established by probing the installed shap, not by reading docs:

1. `shap.plots.bar` calls `ax.barh`, **not** `plt.barh`. The capture patches
   `matplotlib.axes.Axes.barh` (an unbound method, so the spy takes `self`).
2. The captured bar widths and the y tick labels both come out **top-to-bottom already**.
   Do not reverse them.
3. `sample-data/yachidas_2019_test.csv` carries **no label column** — the labels live in
   `sample-data/yachidas_2019_test_labels.csv`, joined on `sample_id`.

The script also asserts that the number of captured bars equals the number of labels, so a future
shap upgrade that changes `_bar.py` fails loudly here instead of silently writing a wrong golden file.

- [ ] **Step 2: Run it**

Run: `.worktrees/curatedcrc-retraining/.venv/bin/python tools/shap_fixtures/generate.py`
Expected: six `wrote …` lines, no traceback.

- [ ] **Step 3: Verify the payload satisfies the spec invariants**

Run:
```bash
.worktrees/curatedcrc-retraining/.venv/bin/python - <<'PY'
import json, math, pathlib
for f in pathlib.Path("explainable-platform/packages/shap-svg/fixtures").glob("*.json"):
    d = json.loads(f.read_text())
    for p in (d.values() if "contract_version" not in d else [d]):
        assert len(p["values"]) == len(p["data"]) == len(p["base_values"])
        assert all(len(r) == len(p["feature_names"]) for r in p["values"])
        assert all(math.isfinite(v) for r in p["values"] for v in r)
    print(f.name, "ok")
PY
```
Expected: one `ok` line per fixture.

- [ ] **Step 4: Commit**

```bash
git add tools/shap_fixtures explainable-platform/packages/shap-svg/fixtures
git commit -m "test: generate shap-svg fixtures and golden bar values"
```

- [ ] **Step 5: Hand off to codex — do not wait for it**

```bash
codex exec -C explainable-platform/packages/shap-svg -s workspace-write \
  -o /tmp/codex-shap-svg.md \
  "Implement docs/superpowers/plans/2026-09-12-shap-svg-core-and-bar.md (path relative to the repo root, two levels above your working root — its full text has been copied to ./PLAN.md in your working root). Follow it task by task, TDD, committing after each task. Do not modify anything outside your working root. Do not edit fixtures/*.json — they are ground truth."
```

Copy the plan and spec into the package first so codex can read them within its root:
```bash
cp docs/superpowers/plans/2026-09-12-shap-svg-core-and-bar.md explainable-platform/packages/shap-svg/PLAN.md
cp docs/shap-explain-spec.md explainable-platform/packages/shap-svg/SPEC.md
cp CONTEXT.md explainable-platform/packages/shap-svg/CONTEXT.md
```

Run this with `run_in_background: true`. Continue to Task 2 immediately.

---

### Task 2: Python payload builder

**Files:**
- Create: `kserve-custom-runtime/explain_payload.py`
- Create: `kserve-custom-runtime/tests/test_explain_payload.py`

**Interfaces:**
- Consumes: the `ShapValueObject`-free path — takes raw arrays
- Produces: `build_payload(values, base_values, data, feature_names, sample_ids=None, **meta) -> dict` and `sigfig(x, digits=4) -> float`

- [ ] **Step 1: Write the failing test**

```python
# kserve-custom-runtime/tests/test_explain_payload.py
import math
import numpy as np
import pytest
from explain_payload import build_payload, sigfig

def test_sigfig_rounds_to_four_significant_figures():
    assert sigfig(0.000123456) == 0.0001235
    assert sigfig(123456.0) == 123500.0

def test_build_payload_shape_and_version():
    p = build_payload(
        values=np.array([[1.0, -2.0], [3.0, 4.0]]),
        base_values=np.array([0.5, 0.5]),
        data=np.array([[0.1, 0.2], [0.3, 0.4]]),
        feature_names=["a", "b"],
        sample_ids=["s1", "s2"],
    )
    assert p["contract_version"] == 1
    assert p["values"] == [[1.0, -2.0], [3.0, 4.0]]
    assert p["base_values"] == [0.5, 0.5]
    assert p["sample_ids"] == ["s1", "s2"]

def test_build_payload_rejects_non_finite():
    with pytest.raises(ValueError, match="non-finite"):
        build_payload(values=np.array([[math.nan]]), base_values=np.array([0.0]),
                      data=np.array([[0.0]]), feature_names=["a"])

def test_base_values_stay_per_sample_when_they_differ():
    p = build_payload(values=np.array([[1.0], [1.0]]), base_values=np.array([0.1, 0.9]),
                      data=np.array([[0.0], [0.0]]), feature_names=["a"])
    assert p["base_values"] == [0.1, 0.9]
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd kserve-custom-runtime && python -m pytest tests/test_explain_payload.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'explain_payload'`.

- [ ] **Step 3: Implement `kserve-custom-runtime/explain_payload.py`**

```python
"""Build the Explanation payload described in docs/shap-explain-spec.md §1."""
from __future__ import annotations

import numpy as np

CONTRACT_VERSION = 1


def sigfig(x: float, digits: int = 4) -> float:
    """Spec §1.4 — 4 significant figures as a JSON-safe float."""
    x = float(x)
    if x == 0.0:
        return 0.0
    return float("%.*g" % (digits, x))


def _rows(matrix, name: str) -> list[list[float]]:
    arr = np.asarray(matrix, dtype=float)
    if not np.isfinite(arr).all():
        raise ValueError(f"{name} contains non-finite values; the payload must be JSON-valid")
    return [[sigfig(v) for v in row] for row in arr]


def build_payload(
    values,
    base_values,
    data,
    feature_names,
    sample_ids=None,
    model_name: str | None = None,
    model_version: str | None = None,
    output_names=None,
) -> dict:
    base = np.asarray(base_values, dtype=float).ravel()
    if not np.isfinite(base).all():
        raise ValueError("base_values contains non-finite values")

    payload = {
        "contract_version": CONTRACT_VERSION,
        "values": _rows(values, "values"),
        "base_values": [sigfig(b) for b in base],
        "data": _rows(data, "data"),
        "feature_names": [str(n) for n in feature_names],
    }
    if sample_ids is not None:
        payload["sample_ids"] = [str(s) for s in sample_ids]
    if output_names is not None:
        payload["output_names"] = [str(n) for n in output_names]
    if model_name:
        payload["model_name"] = model_name
    if model_version:
        payload["model_version"] = str(model_version)
    return payload
```

- [ ] **Step 4: Run the tests**

Run: `cd kserve-custom-runtime && python -m pytest tests/test_explain_payload.py -v`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add kserve-custom-runtime/explain_payload.py kserve-custom-runtime/tests
git commit -m "feat(kserve): build Explanation payloads per the explain spec"
```

---

### Task 3: `/v1/explain/values/<model_name>` endpoint

**Files:**
- Modify: `kserve-custom-runtime/kserve-shap-multi-modelserver.py` — add a route beside `explain_beeswarm` (currently at line 483)

**Interfaces:**
- Consumes: `build_payload` from Task 2; the existing `_load_model_or_error`, `_parse_dataframe_split`, `transformer`, `get_shap_value`
- Produces: `POST /v1/explain/values/<model_name>` returning the §1 payload

The existing three plot endpoints stay untouched — they are the export path (D2).

- [ ] **Step 1: Add the route**

```python
@app.route("/v1/explain/values/<model_name>", methods=["POST"])
def explain_values(model_name):
    """Return SHAP values as JSON (docs/shap-explain-spec.md §1).

    Unlike the plot endpoints this holds no matplotlib lock — it is pure numerics,
    so concurrent requests actually run concurrently.
    """
    loaded, impl, input_columns, err = _load_model_or_error(model_name)
    if err:
        return err
    try:
        req_json = request.get_json()
        input_df, err = _parse_dataframe_split(req_json)
        if err:
            return err
        input_data = transformer(input_df, input_columns)

        aggregate_by = request.args.get("aggregate_by")
        shap_object = get_shap_value(impl, X=input_data, aggregate_by=aggregate_by)

        payload = build_payload(
            values=shap_object.shap_df.values,
            base_values=[shap_object.base_value] * len(input_data),
            data=shap_object.explanation.data,
            feature_names=list(shap_object.shap_df.columns),
            sample_ids=[str(i) for i in input_data.index],
            model_name=model_name,
        )
        return jsonify(payload)
    except Exception as e:
        logger.exception("explain_values failed")
        return jsonify({"error": str(e)}), 500
```

Add `from explain_payload import build_payload` to the imports at the top of the file.

- [ ] **Step 2: Smoke-test it locally**

Run the server and post a two-row frame; assert the response satisfies the §1.5 invariants:
```bash
curl -s -X POST localhost:8080/v1/explain/values/sample-rf-crc \
  -H 'content-type: application/json' -d @/tmp/two-rows.json \
  | python3 -c "import sys,json;d=json.load(sys.stdin);assert d['contract_version']==1;assert len(d['values'])==len(d['base_values'])==len(d['data']);print('ok',len(d['values']),'x',len(d['feature_names']))"
```
Expected: `ok 2 x 201`.

- [ ] **Step 3: Commit**

```bash
git add kserve-custom-runtime/kserve-shap-multi-modelserver.py
git commit -m "feat(kserve): add /v1/explain/values returning SHAP values as JSON"
```

---

### Task 4: Entity columns and JSON upload

**Files:**
- Modify: `explainable-platform-service/src/entity/prediction.entity.ts`
- Modify: `explainable-platform-service/src/storage/storage.service.ts`

**Interfaces:**
- Produces: `Prediction.explainKey/explainEtag/explainError/explainModelVersion/explainContractVersion`; `StorageService.uploadJsonGzip(buffer, path, fileName): Promise<string>` and `StorageService.createReadStream(key): NodeJS.ReadableStream`

- [ ] **Step 1: Add the columns — additive only**

Append to `Prediction`, removing nothing:

```ts
  // --- Explanation payload (docs/shap-explain-spec.md §2.3). The heatmap/beeswarm
  // columns above are intentionally retained: `synchronize: true` would drop them
  // along with their data, and the old PNGs are the visual reference for the new charts.
  @Column({ type: 'text', nullable: true })
  explainKey?: string | null;

  @Column({ type: 'text', nullable: true })
  explainEtag?: string | null;

  @Column({ type: 'text', nullable: true })
  explainError?: string | null;

  @Column({ type: 'text', nullable: true })
  explainModelVersion?: string | null;

  @Column({ type: 'int', nullable: true })
  explainContractVersion?: number | null;
```

- [ ] **Step 2: Add the storage methods**

`uploadToS3` is left as-is — it is still the export path's uploader.

```ts
  /**
   * Store an already-gzipped JSON payload. Kept separate from uploadToS3(), which
   * takes base64 and hardcodes image/png.
   */
  async uploadJsonGzip(gzipped: Buffer, path: string, fileName: string): Promise<string> {
    const key = `${this.prefix}/${path}/${fileName}`;
    await this.bucket.file(key).save(gzipped, {
      contentType: 'application/json',
      contentEncoding: 'gzip',
      resumable: false,
      metadata: { cacheControl: 'private, max-age=0, must-revalidate' },
    });
    return key;
  }

  /** Stream stored bytes straight through — no decompress/recompress hop. */
  createReadStream(key: string): NodeJS.ReadableStream {
    return this.bucket.file(key).createReadStream();
  }
```

- [ ] **Step 3: Build**

Run: `cd explainable-platform-service && npm run build`
Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add explainable-platform-service/src/entity/prediction.entity.ts explainable-platform-service/src/storage/storage.service.ts
git commit -m "feat(service): add explain artifact columns and gzip JSON storage"
```

---

### Task 5: Chunked explain job

**Files:**
- Create: `explainable-platform-service/src/predictions/explain.builder.ts`
- Create: `explainable-platform-service/test/explain.builder.spec.ts`
- Modify: `explainable-platform-service/src/predictions/prediction.processor.ts`
- Modify: `explainable-platform-service/src/predictions/predictions.module.ts` (HttpModule timeout)

**Interfaces:**
- Consumes: `StorageService.uploadJsonGzip` from Task 4
- Produces: `concatPayloads(chunks: ExplainPayload[]): ExplainPayload`, `CHUNK_SIZE`, and `PredictionProcessor.buildExplanation(prediction, records)`

- [ ] **Step 1: Write the failing test for concatenation**

```ts
// test/explain.builder.spec.ts
import { concatPayloads } from '../src/predictions/explain.builder';

const chunk = (ids: string[], v: number) => ({
  contract_version: 1,
  values: ids.map(() => [v, -v]),
  base_values: ids.map(() => 0.5),
  data: ids.map(() => [1, 2]),
  feature_names: ['a', 'b'],
  sample_ids: ids,
});

describe('concatPayloads', () => {
  it('concatenates rows in order and keeps one copy of the shared fields', () => {
    const out = concatPayloads([chunk(['s1', 's2'], 1), chunk(['s3'], 2)]);
    expect(out.sample_ids).toEqual(['s1', 's2', 's3']);
    expect(out.values).toHaveLength(3);
    expect(out.values[2]).toEqual([2, -2]);
    expect(out.feature_names).toEqual(['a', 'b']);
    expect(out.contract_version).toBe(1);
  });

  it('rejects chunks whose feature_names disagree', () => {
    const bad = { ...chunk(['s3'], 2), feature_names: ['a', 'c'] };
    expect(() => concatPayloads([chunk(['s1'], 1), bad])).toThrow(/feature_names/);
  });

  it('rejects an empty chunk list', () => {
    expect(() => concatPayloads([])).toThrow(/at least one/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd explainable-platform-service && npx jest test/explain.builder.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement `explain.builder.ts`**

```ts
export const CHUNK_SIZE = 50;
export const MAX_SAMPLES_PER_PREDICTION = 500;

export interface ExplainPayload {
  contract_version: number;
  values: number[][];
  base_values: number[];
  data: number[][];
  feature_names: string[];
  sample_ids?: string[];
  model_name?: string;
  model_version?: string;
}

/**
 * Join per-chunk payloads into one. Safe because a Sample's SHAP values do not
 * depend on which other Samples shared its request — the Explainer's background is
 * fixed inside the model artifact (docs/shap-explain-spec.md §2.2).
 */
export function concatPayloads(chunks: ExplainPayload[]): ExplainPayload {
  if (chunks.length === 0) throw new Error('concatPayloads needs at least one chunk');
  const [first] = chunks;
  const names = first.feature_names.join(' ');

  for (const c of chunks.slice(1)) {
    if (c.feature_names.join(' ') !== names) {
      throw new Error('chunk feature_names disagree; refusing to concatenate');
    }
  }

  return {
    contract_version: first.contract_version,
    feature_names: first.feature_names,
    model_name: first.model_name,
    model_version: first.model_version,
    values: chunks.flatMap((c) => c.values),
    base_values: chunks.flatMap((c) => c.base_values),
    data: chunks.flatMap((c) => c.data),
    sample_ids: chunks.flatMap((c) => c.sample_ids ?? []),
  };
}

export function chunkIndices(total: number, size = CHUNK_SIZE): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let start = 0; start < total; start += size) {
    out.push([start, Math.min(start + size, total)]);
  }
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd explainable-platform-service && npx jest test/explain.builder.spec.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Give the HTTP client a timeout**

In `predictions.module.ts`, replace the bare `HttpModule` import with:

```ts
    HttpModule.register({ timeout: 120_000, maxRedirects: 0 }),
```

Axios defaults to `timeout: 0` — no timeout at all. 120 s bounds one 50-Sample chunk.

- [ ] **Step 6: Add `buildExplanation` to the processor**

```ts
  /**
   * One job per Prediction: chunked explain calls, concatenate, gzip, store, stamp the
   * ETag. Replaces the previous 2 + n image jobs. Each chunk retries independently so a
   * single failure does not discard the whole matrix.
   */
  private async buildExplanation(prediction: Prediction, records: PredictionRecord[]) {
    const ranges = chunkIndices(records.length);
    const chunks: ExplainPayload[] = [];

    for (const [start, end] of ranges) {
      chunks.push(await this.explainChunk(prediction, records.slice(start, end)));
      this.eventsHub.publishPrediction(prediction.id, 'prediction:explain-progress', {
        done: end, total: records.length,
      });
    }

    const payload = concatPayloads(chunks);
    const raw = Buffer.from(JSON.stringify(payload), 'utf8');
    const etag = createHash('sha256').update(raw).digest('hex');
    const gzipped = gzipSync(raw);

    prediction.explainKey = await this.storageService.uploadJsonGzip(
      gzipped, prediction.id, 'explain.json.gz',
    );
    prediction.explainEtag = etag;
    prediction.explainContractVersion = payload.contract_version;
    prediction.explainModelVersion = payload.model_version ?? null;
    prediction.explainError = null;
    await this.predictionsRepository.save(prediction);

    this.eventsHub.publishPrediction(prediction.id, 'prediction:explain', { ready: true, etag });
  }

  /** 3 attempts, exponential backoff. */
  private async explainChunk(
    prediction: Prediction, records: PredictionRecord[],
  ): Promise<ExplainPayload> {
    const url =
      `${this.inferenceServiceURL}/v1/explain/values/${prediction.modelName}`;
    const body = {
      dataframe_split: {
        columns: prediction.dfColumns,
        data: records.map((r) => r.dfData),
        index: records.map((r) => r.id),
      },
    };
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await lastValueFrom(this.httpService.post(url, body));
        return response.data as ExplainPayload;
      } catch (error) {
        lastError = error;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    throw lastError;
  }
```

Import `createHash` from `node:crypto`, `gzipSync` from `node:zlib`, and the builder symbols.

- [ ] **Step 7: Build and commit**

Run: `cd explainable-platform-service && npm run build`

```bash
git add explainable-platform-service/src
git commit -m "feat(service): chunked explain job writing one gzipped artifact"
```

---

### Task 6: Serve the payload with an ETag

**Files:**
- Modify: `explainable-platform-service/src/predictions/predictions.controller.ts`

**Interfaces:**
- Consumes: `Prediction.explainKey/explainEtag`, `StorageService.createReadStream`
- Produces: `GET /predict/:id/explain`, `GET /predict/:id/records/:recordId/explain`

- [ ] **Step 1: Add the routes**

```ts
  @Get(':id/explain')
  async getExplanation(
    @Param('id') id: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res() res: Response,
  ) {
    const prediction = await this.predictionsService.findOne(id);
    if (!prediction?.explainKey) throw new NotFoundException('Explanation not ready');

    const etag = `"${prediction.explainEtag}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');

    // Conditional GET is answered from the database alone — GCS is never touched.
    if (ifNoneMatch === etag) return res.status(304).end();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Encoding', 'gzip');
    this.storageService.createReadStream(prediction.explainKey).pipe(res);
  }

  /** A slice of the same artifact. Never recomputes. */
  @Get(':id/records/:recordId/explain')
  async getRecordExplanation(
    @Param('id') id: string,
    @Param('recordId') recordId: string,
  ) {
    return this.predictionsService.sliceExplanationForRecord(id, recordId);
  }
```

- [ ] **Step 2: Implement `sliceExplanationForRecord` in `predictions.service.ts`**

```ts
  /**
   * Return a single-Sample payload taken from the stored matrix. `PredictionRecord.id`
   * is the platform's identifier; `sample_ids` is the payload's — this is the only
   * place the two vocabularies meet (CONTEXT.md).
   */
  async sliceExplanationForRecord(predictionId: string, recordId: string) {
    const payload = await this.loadExplanation(predictionId);
    const i = payload.sample_ids?.indexOf(recordId) ?? -1;
    if (i < 0) throw new NotFoundException(`Record ${recordId} is not in this Explanation`);
    return {
      contract_version: payload.contract_version,
      values: [payload.values[i]],
      base_values: [payload.base_values[i]],
      data: [payload.data[i]],
      feature_names: payload.feature_names,
      sample_ids: [recordId],
      model_name: payload.model_name,
      model_version: payload.model_version,
    };
  }
```

- [ ] **Step 3: Verify conditional GET end to end**

Run:
```bash
ETAG=$(curl -sI localhost:3000/predict/$PID/explain | awk '/^ETag/{print $2}' | tr -d '\r')
curl -s -o /dev/null -w '%{http_code}\n' -H "If-None-Match: $ETAG" localhost:3000/predict/$PID/explain
```
Expected: `304`.

- [ ] **Step 4: Commit**

```bash
git add explainable-platform-service/src/predictions
git commit -m "feat(service): serve the Explanation payload with conditional GET"
```

---

### Task 7: Upload guards — row cap and strict parsing

**Files:**
- Modify: `explainable-platform-service/src/utils/csv-parser.util.ts`
- Modify: `explainable-platform-service/src/predictions/predictions.service.ts`

**Interfaces:**
- Consumes: `MAX_SAMPLES_PER_PREDICTION` from Task 5
- Produces: rejection before any job is enqueued

Spec §2.1. Together these two rules are what let §1.4 promise a payload with no `NaN`.

- [ ] **Step 1: Enforce the row cap**

In `createPrediction`, before creating the `Prediction`:

```ts
    if (dfDataRows.length > MAX_SAMPLES_PER_PREDICTION) {
      throw new BadRequestException(
        `This upload has ${dfDataRows.length} samples; the limit is ${MAX_SAMPLES_PER_PREDICTION}. ` +
        `Split the file and submit it as separate predictions.`,
      );
    }
```

- [ ] **Step 2: Reject unparseable cells**

In the CSV parser, after splitting rows:

```ts
  rows.forEach((row, rowIndex) => {
    row.forEach((cell, colIndex) => {
      const trimmed = String(cell).trim();
      // An empty cell is an absent taxon, which is a true biological zero (CONTEXT.md).
      if (trimmed === '') return;
      if (!Number.isFinite(Number(trimmed))) {
        throw new BadRequestException(
          `Row ${rowIndex + 2}, column "${columns[colIndex]}" is "${cell}", which is not a number.`,
        );
      }
    });
  });
```

- [ ] **Step 3: Verify**

Run: upload a 501-row CSV and a CSV containing the text `n/a`.
Expected: HTTP 400 both times, with the row/column named in the second case, and **no job enqueued**.

- [ ] **Step 4: Commit**

```bash
git add explainable-platform-service/src
git commit -m "feat(service): cap uploads at 500 samples and reject non-numeric cells"
```

---

### Task 8: Redis-backed `EventsHub`

**Files:**
- Modify: `explainable-platform-service/src/events/events.hub.ts`

**Interfaces:**
- Consumes: the Redis connection details already used by `BullModule.forRoot` (`app.module.ts:28`)
- Produces: the same `publish` / `subscribe` / `publishPrediction` / `subscribePrediction` API

The file's own comment already prescribes this: *"If the service is ever scaled horizontally, swap
the internals for a Redis pub/sub adapter — the public API can stay."* Keep the public API byte-identical
so no call site changes.

- [ ] **Step 1: Replace the internals**

Hold two `ioredis` clients (one publisher, one subscriber — a subscribing connection cannot issue
other commands), map each topic to a Redis channel `events:{topic}`, and keep the existing local
`Subject` per topic as the fan-out point for sockets attached to *this* pod. `publish` writes to
Redis; the subscriber callback pushes into the local `Subject`.

- [ ] **Step 2: Verify with two instances**

Run two backends on different ports against the same Redis, open the SSE stream on instance A, and
trigger an explain job on instance B.
Expected: instance A's stream receives `prediction:explain`.

- [ ] **Step 3: Commit**

```bash
git add explainable-platform-service/src/events/events.hub.ts
git commit -m "feat(service): back EventsHub with Redis pub/sub"
```

---

### Task 9: Render the bar chart in the app

**Files:**
- Modify: `explainable-platform/pages/prediction/prediction.tsx`
- Modify: `explainable-platform/package.json`, `explainable-platform/tsconfig.json`
- Create: `explainable-platform/lib/useExplanation.ts`

**Interfaces:**
- Consumes: `ShapBar` from `packages/shap-svg/react`, `GET /predict/:id/explain`
- Produces: a working global bar chart alongside the existing PNGs

- [ ] **Step 1: Make the package importable**

Add `"shap-svg": "file:./packages/shap-svg"` to dependencies, add the path mapping to
`tsconfig.json`, and add `transpilePackages`-equivalent handling for Next 12
(`next.config.js` → `experimental.externalDir` or `next-transpile-modules`).

- [ ] **Step 2: Add the fetch hook**

```ts
// lib/useExplanation.ts — react-query v3 caches the parsed payload for the session.
export function useExplanation(predictionId?: string) {
  return useQuery(
    ['explanation', predictionId],
    async () => (await api.get(`/predict/${predictionId}/explain`)).data,
    { enabled: Boolean(predictionId), staleTime: Infinity },
  );
}
```

- [ ] **Step 3: Render it above the existing images**

Keep the beeswarm and heatmap `<img>` blocks in place. The old PNGs are the reference the new chart
is checked against; they come out only once every chart has shipped.

```tsx
{explanation && (
  <>
    <input type="range" min={5} max={50} value={maxDisplay}
           onChange={(e) => setMaxDisplay(Number(e.target.value))} />
    <ShapBar explanation={explanation} maxDisplay={maxDisplay}
             onFeatureClick={(i) => i !== null && setSelectedFeature(i)} />
  </>
)}
```

- [ ] **Step 4: Verify against the reference**

Open a Prediction that already has a beeswarm PNG. Confirm the bar chart's top features and their
order match the PNG's top rows, and that moving the slider re-renders with **no network request**
in the browser's network panel.

- [ ] **Step 5: Commit**

```bash
git add explainable-platform
git commit -m "feat(web): render the global SHAP bar chart from the explain payload"
```

---

### Task 10: Stop re-unpickling the model on every request

**Files:** Modify `kserve-custom-runtime/kserve-shap-multi-modelserver.py:88-104`

`@memory.cache` on `_load_pyfunc_cached` is a **disk** cache: every "hit" hashes the args, then reads
and unpickles the stored value. Measured ~2.3 ms/MB warm, so a 200-400 MB torch+shap bundle costs
**0.5-1.0 s of blocking work per request** before any real work starts, and hands each caller a fresh
object so no warm explainer state survives.

- [x] **Step 1:** Wrap the joblib-cached loader in a process-local `functools.lru_cache(maxsize=4)`
  keyed on `model_uri`. Keep the joblib layer as the cold-start path — it is what avoids re-downloading
  artifacts when a pod restarts.
- [x] **Step 2:** Confirm with two consecutive identical requests that the second does no disk read
  (log a line in the loader and check it appears once). *Verified both ways. Unit test with a counting stub in
  `tests/test_model_cache.py`, and live against `crc-rynazal-notebook`: five model-loading requests
  logged `Unpickling models:/crc-rynazal-notebook/1` exactly once, and the second identical request
  took 0.27 s against the first's 1.54 s.*
- [x] **Step 3:** Commit.

---

### Task 11: Cache the MLflow registry lookup

**Files:** Modify `kserve-custom-runtime/kserve-shap-multi-modelserver.py:92-104`

`load_explainable_model` builds a fresh `MlflowClient` and calls `get_latest_versions` on every
request — a blocking 10-200 ms round trip to the tracking server, which also makes the whole service
fail whenever MLflow is briefly unreachable.

- [x] **Step 1:** Add a TTL cache (30-60 s) over `model_name -> (version, run_id)`. Fold it into the
  same cache as Task 10 if that is simpler.
- [x] **Step 2:** Decide and document what happens when the lookup fails but a cached entry exists —
  serving the cached version is almost certainly right, and is the point of the change.
- [x] **Step 3:** Commit.

---

### Task 12: One preamble for the five model endpoints

**Files:** Modify `kserve-custom-runtime/kserve-shap-multi-modelserver.py` — `explain_values`,
`explain_beeswarm`, `explain_heatmap`, `explain_waterfall`, `predict`

All five repeat `_load_model_or_error` -> `get_json` -> `_parse_dataframe_split` -> `transformer`, and
three carry a byte-identical `?aggregate_by=genus` comment that duplicates `get_shap_value`'s docstring.
~~**They have already drifted**: only `explain_values` maps `PayloadError` to 400; the others fall to a
generic 500 for the same bad input.~~ **Wrong, corrected while implementing.** `PayloadError` is raised
by `build_payload`, which only `explain_values` calls, so the other four cannot raise it. The real
drift was smaller: all five reported a malformed JSON body as 500. That is what Step 3 fixed.

A genuine finding left unfixed, because it is a behaviour change to the live predict path rather than a
refactor: `transformer()` coerces with `errors="coerce"`, so non-numeric input becomes `NaN` silently.
`explain_values` catches it downstream in `build_payload` and returns 400; the three plot endpoints and
`predict` carry the NaN into matplotlib or the model. Rejecting non-finite input in `_prepare` would
make all five consistent — decide it on purpose, not as a side effect.

- [x] **Step 1:** Extract `_prepare(model_name) -> (loaded, impl, X, None) | (None, None, None, (resp, status))`.
- [x] **Step 2:** Rewrite the five handlers to use it; delete the three duplicated comments.
- [x] **Step 3:** Decide deliberately whether a malformed JSON body should now surface as Flask's 400
  rather than the current 500 — it is a behaviour change either way, so make it on purpose.
- [x] **Step 4:** Verify all four explain endpoints and predict still respond identically for a good
  request, and consistently for a bad one. Commit.

---

### Task 13: Faster JSON serialization — **measured, not worth doing**

**Do not do this.** The premise below was wrong and the measurement is recorded here so nobody picks
it up again.

Claimed: "after Tasks 10-12, serialization is the dominant remaining cost of the endpoint",
`jsonify` 181 ms vs `orjson.dumps` 38 ms.

Measured after Tasks 10-12, against the live runtime and `crc-rynazal-notebook`:

| | |
|---|---|
| `/v1/explain/values`, 50 Samples x 865 Features (one real chunk) | **6,625 ms** |
| JSON serialization within it | **17 ms** |
| Most `orjson` could save | **~13 ms, or 0.2%** |

The original 181 ms was also too high: `json.dumps` on the full 331-Sample payload measures 108 ms.
Flask's provider sets `sort_keys=True`, which is often the reason such benchmarks disagree — here it
costs 0.4 ms, because the payload has seven top-level keys and all the work is in the nested float
lists.

The error was measuring serialization on its own and never dividing by the request it sits inside.
Once Task 10 removed the 1.3 s model load, the dominant cost was not serialization — it is SHAP
itself, at 99.7% of the request. Adding a dependency to the runtime image to win 0.2% is not a trade
worth making.

If the endpoint ever does need to be faster, the target is that 6.6 s of SHAP compute — a different
size of job, and one that risks changing the values themselves, so it needs a decision about the
paper before it needs an implementation.

---

## Not a task: committed credentials

`deployment/01.set-mlflow-secret.yaml` contains `MLFLOW_TRACKING_PASSWORD: cGFzc3dvcmQ=` (base64 of
`password`) and an AWS access key id, committed to the repository. Base64 is an encoding, not
encryption. These should be treated as disclosed and **rotated**, and replaced with a sealed secret or
an external secret store. This is the owner's call to make, not a refactor to schedule.

---

## Definition of done

- A Prediction produces exactly one queue job and one GCS object.
- `GET /predict/:id/explain` returns 200 once, then 304 on every repeat with the ETag.
- Moving the `max_display` slider issues no network request.
- Uploading 501 rows, or a cell reading `n/a`, returns 400 and enqueues nothing.
- Every pre-existing image column and GCS object is still present and still rendering.
