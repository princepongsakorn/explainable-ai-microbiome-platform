# Prediction Landing Page and Published Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the prediction list a landing page that shows progress and results at a glance. Show which Experiments runs are published, give Models a details sheet with Unpublish, and stop a failed stage change from reporting success.

**Architecture:**
- **Inference service:** answers a failed MLflow stage transition with a real HTTP error.
- **Nest service:** counts records per status and per class value in one grouped query, folded by a pure function, and serves a new `/predict/summary`.
- **Frontend:**
  - Reads those counts into progress and result bars plus a summary strip.
  - Derives each run's published state from the registered-models list it already fetches.
  - Moves the run drawer into a shared `RunDetailsSheet` used by Experiments and Models.

**Tech Stack:** Flask + MLflow 2.19 (pytest); NestJS + TypeORM + Postgres (Jest); Next 12 pages router + React 18 + Tailwind 3.4 + shadcn/ui (checked with `tsc` and `next build`; no test runner).

**Spec:** `docs/superpowers/specs/2026-09-14-prediction-landing-and-published-models-design.md`

## Global Constraints

- **Commits:** on branch `feature/shadcn-ui`, one commit per task. No `Co-Authored-By` trailer.
- **shadcn:** add components with `npx shadcn@2.3.0 add …`, never `@latest`.
- **Where to run `next build`:** in an APFS clone (`cp -cR`), never in `explainable-platform/` itself; its `.next` is served by `next start -p 3001`.
- **Class values carry no fixed meaning.** Only `classLabel(value)` and `classColor(value)` in `explainable-platform/lib/classes.ts` name or colour a class: `1` → "Positive", `0` → "Negative", anything else → "Class N".
- **`GET /predict` stays additive:** `records.total`, `records.success` and `records.error` keep their meaning.
- **Tolerate the running backend:** the frontend must work against a backend that has not been rebuilt yet, so `records.byStatus` and `records.byClass` are optional in its types.
- **Restarting shared services:** restart the Nest service (`node dist/main` on :3000) or the inference service (:8080) only with Pongsakorn's go-ahead.

---

## File Structure

| File | Responsibility |
|---|---|
| `kserve-custom-runtime/kserve-shap-multi-modelserver.py` | Stage route returns 404 / 500 instead of 200 on failure |
| `kserve-custom-runtime/tests/test_stage_route.py` (new) | Pins the stage route's status codes |
| `explainable-platform-service/src/predictions/record-counts.ts` (new) | `RecordCountRow`, `RecordCounts`, `foldRecordCounts`, `emptyRecordCounts` |
| `explainable-platform-service/src/predictions/record-counts.spec.ts` (new) | Jest spec for the fold |
| `explainable-platform-service/src/predictions/predictions.service.ts` | Grouped count query in `getPredictions`; new `getPredictionSummary` |
| `explainable-platform-service/src/predictions/predictions.controller.ts` | `GET /predict/summary` |
| `explainable-platform/lib/classes.ts` (new) | `classLabel`, `classColor` |
| `explainable-platform/components/model/model.interface.ts` | `IRecordCounts`, `IPredictionSummary` |
| `explainable-platform/pages/api/predict.ts` | `getPredictionSummary()` |
| `explainable-platform/components/prediction/StatusBadge.tsx` | Export `STATUS_STYLE` for the progress bar |
| `explainable-platform/components/prediction/PredictionProgress.tsx` (new) | Progress bar + text |
| `explainable-platform/components/prediction/PredictionResults.tsx` (new) | Results bar + text |
| `explainable-platform/components/prediction/PredictionSummary.tsx` (new) | Summary strip |
| `explainable-platform/pages/prediction/prediction.tsx` | Strip, new columns, polling |
| `explainable-platform/pages/prediction/local.tsx` | Classification text through `classLabel` |
| `explainable-platform/components/experiments/RunDetailsSheet.tsx` (new) | Run drawer: details, Publish, Unpublish |
| `explainable-platform/pages/experiments/experiments.tsx` | Model column; uses `RunDetailsSheet` |
| `explainable-platform/pages/experiments/models.tsx` | Rows open `RunDetailsSheet` |

---

### Task 1: A failed stage change answers with an HTTP error

**Files:**
- Modify: `kserve-custom-runtime/kserve-shap-multi-modelserver.py:1004-1025`
- Test: `kserve-custom-runtime/tests/test_stage_route.py`

**Interfaces:**
- Consumes: the `server` fixture in `tests/conftest.py`
- Produces: `PUT /v1/mlflow/run/<run_id>/stage` returns 200 on success, 404 when the run has no model version, and 500 on `MlflowException`

- [ ] **Step 1: Write the failing test**

```python
"""A stage change that did not happen must not answer 200.

The Nest service treats any 2xx as success, so a failed MLflow transition, or
a run with no registered model, used to reach the page as "Model Published".
No MLflow server is involved: MlflowClient is stubbed.
"""

from __future__ import annotations

import pytest

pytest.importorskip("mlflow")

from mlflow.exceptions import MlflowException  # noqa: E402

URL = "/v1/mlflow/run/run-1/stage"
BODY = {"stage": "Production", "description": "{}", "archive_existing_versions": True}


@pytest.fixture
def client(server, monkeypatch):
    monkeypatch.setattr(server.mlflow, "set_tracking_uri", lambda uri: None)
    return server.app.test_client()


def stub_mlflow(server, monkeypatch, *, has_version=True, transition_error=None):
    class Version:
        name = "crc-model"
        version = "3"

    class Client:
        def search_model_versions(self, query):
            return [Version()] if has_version else []

        def transition_model_version_stage(self, **kwargs):
            if transition_error is not None:
                raise transition_error

        def update_model_version(self, **kwargs):
            pass

    monkeypatch.setattr(server.mlflow.tracking, "MlflowClient", Client)


def test_a_successful_transition_is_a_200(client, server, monkeypatch):
    stub_mlflow(server, monkeypatch)
    response = client.put(URL, json=BODY)
    assert response.status_code == 200
    assert response.get_json()["status"] == "success"


def test_a_run_without_a_model_is_a_404(client, server, monkeypatch):
    stub_mlflow(server, monkeypatch, has_version=False)
    response = client.put(URL, json=BODY)
    assert response.status_code == 404
    assert "run-1" in response.get_json()["message"]


def test_an_mlflow_failure_is_a_500_with_its_message(client, server, monkeypatch):
    stub_mlflow(server, monkeypatch, transition_error=MlflowException("registry is read-only"))
    response = client.put(URL, json=BODY)
    assert response.status_code == 500
    assert "registry is read-only" in response.get_json()["message"]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd kserve-custom-runtime && python3 -m pytest tests/test_stage_route.py -q`
Expected: 1 passed, 2 failed (`assert 200 == 404`, `assert 200 == 500`)

- [ ] **Step 3: Return real status codes**

In `update_model_stage_by_run_id`, replace the no-model return and the `except` return:

```python
    models = client.search_model_versions(f"run_id='{run_id}'")
    if not models:
        return jsonify({"status": "error", "message": f"No model found for Run ID: {run_id}"}), 404
```

```python
    except MlflowException as e:
        return jsonify({"status": "error", "message": str(e)}), 500
```

- [ ] **Step 4: Run the stage tests and the whole suite**

Run: `cd kserve-custom-runtime && python3 -m pytest tests -q`
Expected: all pass, including the 3 new tests

- [ ] **Step 5: Commit**

```bash
git add kserve-custom-runtime/kserve-shap-multi-modelserver.py kserve-custom-runtime/tests/test_stage_route.py
git commit -m "fix(kserve): answer a failed stage change with an HTTP error"
```

---

### Task 2: Fold grouped record counts per prediction

**Files:**
- Create: `explainable-platform-service/src/predictions/record-counts.ts`
- Test: `explainable-platform-service/src/predictions/record-counts.spec.ts`

**Interfaces:**
- Produces:
  - `interface RecordCountRow { predictionId: string; status: PredictionStatus; class: number | null; count: string | number }`
  - `interface RecordCounts { total: number; success: number; error: number; byStatus: StatusCounts; byClass: Record<string, number> }`
  - `type StatusCounts = Record<'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'ERROR' | 'CANCELED', number>`
  - `function emptyRecordCounts(): RecordCounts`
  - `function foldRecordCounts(predictionIds: string[], rows: RecordCountRow[]): Map<string, RecordCounts>`

- [ ] **Step 1: Write the failing test**

```ts
import { PredictionStatus } from '../interface/prediction-class.enum';
import { RecordCountRow, emptyRecordCounts, foldRecordCounts } from './record-counts';

const row = (
  predictionId: string,
  status: PredictionStatus,
  cls: number | null,
  count: string | number,
): RecordCountRow => ({ predictionId, status, class: cls, count });

describe('foldRecordCounts', () => {
  it('counts every status and keeps total, success and error in step', () => {
    const counts = foldRecordCounts(
      ['p1'],
      [
        row('p1', PredictionStatus.SUCCESS, 1, '12'),
        row('p1', PredictionStatus.SUCCESS, 0, '26'),
        row('p1', PredictionStatus.ERROR, null, '2'),
        row('p1', PredictionStatus.PENDING, null, '3'),
        row('p1', PredictionStatus.IN_PROGRESS, null, '1'),
        row('p1', PredictionStatus.CANCELED, null, '4'),
      ],
    );
    expect(counts.get('p1')).toEqual({
      total: 48,
      success: 38,
      error: 2,
      byStatus: { PENDING: 3, IN_PROGRESS: 1, SUCCESS: 38, ERROR: 2, CANCELED: 4 },
      byClass: { '0': 26, '1': 12 },
    });
  });

  it('counts unclassified samples in the total but not in byClass', () => {
    const counts = foldRecordCounts(['p1'], [row('p1', PredictionStatus.PENDING, null, '5')]);
    expect(counts.get('p1')?.total).toBe(5);
    expect(counts.get('p1')?.byClass).toEqual({});
  });

  it('keeps class values other than 0 and 1, and numeric counts', () => {
    const counts = foldRecordCounts(
      ['p1'],
      [
        row('p1', PredictionStatus.SUCCESS, -1, 4),
        row('p1', PredictionStatus.SUCCESS, 2, 6),
      ],
    );
    expect(counts.get('p1')?.byClass).toEqual({ '-1': 4, '2': 6 });
  });

  it('gives a prediction with no rows zeros and an empty byClass', () => {
    expect(foldRecordCounts(['p1'], []).get('p1')).toEqual(emptyRecordCounts());
  });

  it('ignores rows for predictions it was not asked about', () => {
    const counts = foldRecordCounts(['p1'], [row('p2', PredictionStatus.SUCCESS, 1, '9')]);
    expect(counts.has('p2')).toBe(false);
    expect(counts.get('p1')?.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd explainable-platform-service && npx jest src/predictions/record-counts.spec.ts`
Expected: FAIL, "Cannot find module './record-counts'"

- [ ] **Step 3: Implement the fold**

```ts
import { PredictionStatus } from '../interface/prediction-class.enum';

/** One row of `GROUP BY prediction, status, class` over prediction records. */
export interface RecordCountRow {
  predictionId: string;
  status: PredictionStatus;
  class: number | null;
  /** Postgres returns COUNT(*) as a string. */
  count: string | number;
}

export type StatusCounts = Record<
  'PENDING' | 'IN_PROGRESS' | 'SUCCESS' | 'ERROR' | 'CANCELED',
  number
>;

export interface RecordCounts {
  total: number;
  success: number;
  error: number;
  byStatus: StatusCounts;
  /**
   * Samples per predicted class value, keyed by the value as a string. A value
   * has no fixed meaning here: models may be multi-class, and what 0 or 1
   * stands for belongs to the model. Unclassified samples are left out.
   */
  byClass: Record<string, number>;
}

export const emptyRecordCounts = (): RecordCounts => ({
  total: 0,
  success: 0,
  error: 0,
  byStatus: { PENDING: 0, IN_PROGRESS: 0, SUCCESS: 0, ERROR: 0, CANCELED: 0 },
  byClass: {},
});

export function foldRecordCounts(
  predictionIds: string[],
  rows: RecordCountRow[],
): Map<string, RecordCounts> {
  const counts = new Map(predictionIds.map((id) => [id, emptyRecordCounts()]));

  for (const row of rows) {
    const entry = counts.get(row.predictionId);
    if (!entry) continue;
    const count = Number(row.count);
    entry.total += count;
    if (row.status in entry.byStatus) {
      entry.byStatus[row.status as keyof StatusCounts] += count;
    }
    if (row.class !== null && row.class !== undefined) {
      const key = String(row.class);
      entry.byClass[key] = (entry.byClass[key] ?? 0) + count;
    }
  }

  for (const entry of counts.values()) {
    entry.success = entry.byStatus.SUCCESS;
    entry.error = entry.byStatus.ERROR;
  }
  return counts;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd explainable-platform-service && npx jest src/predictions/record-counts.spec.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add explainable-platform-service/src/predictions/record-counts.ts explainable-platform-service/src/predictions/record-counts.spec.ts
git commit -m "feat(service): fold prediction record counts by status and class"
```

---

### Task 3: Serve the counts and the summary

**Files:**
- Modify: `explainable-platform-service/src/predictions/predictions.service.ts` (imports; `getPredictions` counting block, currently lines ~422-449; new method after `getPredictions`)
- Modify: `explainable-platform-service/src/predictions/predictions.controller.ts` (new route after `@Get()` `getPredictions`)

**Interfaces:**
- Consumes: `foldRecordCounts`, `emptyRecordCounts`, `RecordCountRow` (Task 2)
- Produces:
  - `GET /predict` items: `records: RecordCounts`
  - `GET /predict/summary` → `{ inProgress: number; needsAttention: number; uploadedLast7Days: number }`

- [ ] **Step 1: Replace the three per-prediction COUNT queries**

Imports: add `MoreThanOrEqual` to the `typeorm` import, and add:

```ts
import {
  RecordCountRow,
  emptyRecordCounts,
  foldRecordCounts,
} from './record-counts';
```

In `getPredictions`, before `const predictions = await Promise.all(`:

```ts
    // One grouped query for the whole page, where there were three COUNTs per
    // prediction. The relation column is quoted raw: TypeORM does not map
    // "predictionId" from the property path.
    const ids = items.map((prediction) => prediction.id);
    const countRows: RecordCountRow[] = ids.length
      ? await this.recordsRepository
          .createQueryBuilder('record')
          .select('"record"."predictionId"', 'predictionId')
          .addSelect('"record"."status"', 'status')
          .addSelect('"record"."class"', 'class')
          .addSelect('COUNT(*)', 'count')
          .where('"record"."predictionId" IN (:...ids)', { ids })
          .groupBy('"record"."predictionId"')
          .addGroupBy('"record"."status"')
          .addGroupBy('"record"."class"')
          .getRawMany()
      : [];
    const countsById = foldRecordCounts(ids, countRows);
```

Inside the `items.map(async (prediction) => {…})` callback:
- delete the `totalRecords`, `successRecords` and `errorRecords` queries;
- replace the `records: {…}` literal with:

```ts
          records: countsById.get(predictionId) ?? emptyRecordCounts(),
```

- [ ] **Step 2: Add `getPredictionSummary` after `getPredictions`**

```ts
  /** The prediction list's summary strip, counted across every prediction. */
  async getPredictionSummary() {
    const predictionsWithStatus = async (statuses: PredictionStatus[]) => {
      const row = await this.recordsRepository
        .createQueryBuilder('record')
        .select('COUNT(DISTINCT "record"."predictionId")', 'count')
        .where('"record"."status" IN (:...statuses)', { statuses })
        .getRawOne();
      return Number(row?.count ?? 0);
    };
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [inProgress, needsAttention, uploadedLast7Days] = await Promise.all([
      predictionsWithStatus([PredictionStatus.PENDING, PredictionStatus.IN_PROGRESS]),
      predictionsWithStatus([PredictionStatus.ERROR]),
      this.predictionsRepository.count({
        where: { createdAt: MoreThanOrEqual(since) },
      }),
    ]);
    return { inProgress, needsAttention, uploadedLast7Days };
  }
```

- [ ] **Step 3: Add the route after the `@Get()` `getPredictions` handler, before any `:predictionId` route**

```ts
  /** Figures for the prediction list's summary strip, across every prediction. */
  @Get('summary')
  async getPredictionSummary() {
    return this.predictionsService.getPredictionSummary();
  }
```

- [ ] **Step 4: Type-check and run the unit tests**

Run: `cd explainable-platform-service && npx tsc --noEmit -p tsconfig.json && npx jest src/predictions`
Expected: no type errors; all prediction specs pass

- [ ] **Step 5: Commit**

```bash
git add explainable-platform-service/src/predictions/predictions.service.ts explainable-platform-service/src/predictions/predictions.controller.ts
git commit -m "feat(service): count prediction records per status and class, and summarise them"
```

Live check, once Pongsakorn allows restarting the Nest service (`npm run build`, then restart `node dist/main`): signed in, `GET /api/predict` items carry `byStatus` and `byClass`, and `GET /api/predict/summary` returns the three numbers.

---

### Task 4: Progress, results and summary on the prediction list

**Files:**
- Create: `explainable-platform/lib/classes.ts`
- Create: `explainable-platform/components/prediction/PredictionProgress.tsx`
- Create: `explainable-platform/components/prediction/PredictionResults.tsx`
- Create: `explainable-platform/components/prediction/PredictionSummary.tsx`
- Modify: `explainable-platform/components/model/model.interface.ts` (`IPredictions.records`, new types)
- Modify: `explainable-platform/pages/api/predict.ts` (add `getPredictionSummary`)
- Modify: `explainable-platform/components/prediction/StatusBadge.tsx` (export `STATUS_STYLE`)
- Modify: `explainable-platform/pages/prediction/prediction.tsx`
- Modify: `explainable-platform/pages/prediction/local.tsx` (`classificationLabel`)

**Interfaces:**
- Consumes: `GET /predict` `records` shape and `GET /predict/summary` (Task 3)
- Produces:
  - `classLabel(value: number | string): string`
  - `classColor(value: number | string): string` (a Tailwind `bg-*` class)
  - `IRecordCounts`, `IPredictionSummary`, `getPredictionSummary(): Promise<IPredictionSummary>`
  - `STATUS_STYLE: Record<string, { label; className; dot }>`

- [ ] **Step 1: `lib/classes.ts`**

```ts
/**
 * How a predicted class is named and coloured. The one place that knows: a
 * class is a value, and every model today is binary with 1 = positive. When a
 * model can be multi-class, or name its classes at publish time, these take
 * that model's labels and nothing else changes.
 */
const KNOWN_LABELS: Record<string, string> = { "1": "Positive", "0": "Negative" };
const KNOWN_COLORS: Record<string, string> = { "1": "bg-rose-500", "0": "bg-sky-500" };
const OTHER_COLORS = ["bg-violet-500", "bg-amber-500", "bg-teal-500", "bg-slate-500"];

export function classLabel(value: number | string): string {
  const key = String(value);
  return KNOWN_LABELS[key] ?? `Class ${key}`;
}

/** A class's colour, fixed by its value so it matches across predictions. */
export function classColor(value: number | string): string {
  const key = String(value);
  return KNOWN_COLORS[key] ?? OTHER_COLORS[Math.abs(Number(key)) % OTHER_COLORS.length];
}
```

- [ ] **Step 2: Types and API**

In `components/model/model.interface.ts`, replace the `records` field of `IPredictions` and add the two interfaces:

```ts
export interface IRecordCounts {
  total: number;
  success: number;
  error: number;
  /** Absent from a backend older than the counts; treat as unknown. */
  byStatus?: Record<Exclude<PredictionStatus, PredictionStatus.ALL>, number>;
  /** Samples per class value, e.g. { "0": 26, "1": 12 }. */
  byClass?: Record<string, number>;
}

export interface IPredictionSummary {
  inProgress: number;
  needsAttention: number;
  uploadedLast7Days: number;
}
```

```ts
  records: IRecordCounts;
```

In `pages/api/predict.ts`, add `IPredictionSummary` to the model interface import and:

```ts
export const getPredictionSummary = async () => {
  const { data } = await httpClient.get<IPredictionSummary>(`/predict/summary`);
  return data;
};
```

- [ ] **Step 3: Export the status colours**

In `components/prediction/StatusBadge.tsx`, change `const STATUS_STYLE` to `export const STATUS_STYLE`.

- [ ] **Step 4: `PredictionProgress.tsx`**

```tsx
import { IRecordCounts, PredictionStatus } from "@/components/model/model.interface";
import { STATUS_STYLE } from "@/components/prediction/StatusBadge";

const BAR_ORDER = [
  PredictionStatus.SUCCESS,
  PredictionStatus.ERROR,
  PredictionStatus.CANCELED,
  PredictionStatus.IN_PROGRESS,
  PredictionStatus.PENDING,
] as const;

/** How far a prediction's samples have got, as a bar and in words. */
export function PredictionProgress({ records }: { records: IRecordCounts }) {
  const { byStatus, total } = records;

  // A backend without per-status counts still says how many succeeded or failed.
  if (!byStatus) {
    return (
      <span className="text-xs tabular-nums text-muted-foreground">
        {records.success + records.error} / {total} done
      </span>
    );
  }

  const done = byStatus.SUCCESS + byStatus.ERROR + byStatus.CANCELED;
  const breakdown = BAR_ORDER.filter((status) => byStatus[status] > 0)
    .map((status) => `${byStatus[status]} ${STATUS_STYLE[status].label.toLowerCase()}`)
    .join(", ");

  return (
    <div className="flex min-w-[10rem] flex-col gap-1.5" title={breakdown || "No samples"}>
      <div aria-hidden="true" className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {total > 0 &&
          BAR_ORDER.map(
            (status) =>
              byStatus[status] > 0 && (
                <div
                  key={status}
                  className={STATUS_STYLE[status].dot}
                  style={{ width: `${(byStatus[status] / total) * 100}%` }}
                />
              )
          )}
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {done} / {total} done
        {byStatus.ERROR > 0 && (
          <span className="text-destructive">
            {" "}
            · {byStatus.ERROR} {byStatus.ERROR === 1 ? "error" : "errors"}
          </span>
        )}
      </span>
    </div>
  );
}
```

- [ ] **Step 5: `PredictionResults.tsx`**

```tsx
import { classColor, classLabel } from "@/lib/classes";

/** How a prediction's classified samples split across classes. */
export function PredictionResults({ byClass }: { byClass?: Record<string, number> }) {
  const classes = Object.entries(byClass ?? {})
    .filter(([, count]) => count > 0)
    .sort(([a], [b]) => Number(b) - Number(a));
  const total = classes.reduce((sum, [, count]) => sum + count, 0);

  if (total === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }

  return (
    <div className="flex min-w-[10rem] flex-col gap-1.5">
      <div aria-hidden="true" className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {classes.map(([value, count]) => (
          <div
            key={value}
            className={classColor(value)}
            style={{ width: `${(count / total) * 100}%` }}
          />
        ))}
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {classes.map(([value, count]) => `${count} ${classLabel(value)}`).join(" · ")}
      </span>
    </div>
  );
}
```

- [ ] **Step 6: `PredictionSummary.tsx`**

```tsx
import { IPredictionSummary } from "@/components/model/model.interface";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * The three figures above the prediction list. `undefined` while loading,
 * `null` when the request failed: the figures then read "—" and the table
 * below carries on.
 */
export function PredictionSummary({ summary }: { summary?: IPredictionSummary | null }) {
  const figures = [
    {
      label: "In Progress",
      value: summary?.inProgress,
      hint: "Predictions with samples still waiting or running.",
      alert: false,
    },
    {
      label: "Needs Attention",
      value: summary?.needsAttention,
      hint: "Predictions with at least one failed sample.",
      alert: true,
    },
    {
      label: "Uploaded in the Last 7 Days",
      value: summary?.uploadedLast7Days,
      hint: "Predictions created in the past week.",
      alert: false,
    },
  ];

  return (
    <dl className="grid gap-4 sm:grid-cols-3">
      {figures.map((figure) => (
        <div key={figure.label} className="rounded-lg border bg-card p-4">
          <dt className="text-sm text-muted-foreground">{figure.label}</dt>
          <dd
            className={cn(
              "mt-1 text-2xl font-semibold tabular-nums",
              figure.alert && (figure.value ?? 0) > 0 && "text-destructive"
            )}
          >
            {summary === undefined ? <Skeleton className="h-8 w-12" /> : figure.value ?? "—"}
          </dd>
          <p className="mt-1 text-xs text-muted-foreground">{figure.hint}</p>
        </div>
      ))}
    </dl>
  );
}
```

- [ ] **Step 7: Wire the list page**

In `pages/prediction/prediction.tsx`:

1. **Imports:**
   - add `PredictionProgress`, `PredictionResults` and `PredictionSummary`;
   - add `IPredictionSummary` to the model interface import;
   - add `getPredictionSummary` to the `../api/predict` import.
2. **Constant**, above the component:
   ```tsx
   // While a prediction on the page is still running, look again this often.
   const LIST_POLL_INTERVAL_MS = 15_000;
   ```
3. **State and loader**, inside the component, after the existing state:
   ```tsx
   // undefined while loading, null if it failed.
   const [summary, setSummary] = useState<IPredictionSummary | null>();

   const loadSummary = () =>
     getPredictionSummary()
       .then(setSummary)
       .catch(() => setSummary(null));

   useEffect(() => {
     loadSummary();
   }, []);

   const hasActiveWork =
     predictions?.items.some(
       (item) =>
         (item.records.byStatus?.PENDING ?? 0) + (item.records.byStatus?.IN_PROGRESS ?? 0) > 0
     ) ?? false;

   // Poll only while something on this page is still running, and not while
   // the tab is hidden.
   useEffect(() => {
     if (!hasActiveWork) return;
     const intervalId = setInterval(() => {
       if (document.hidden) return;
       getPredictionsRecordList();
       loadSummary();
     }, LIST_POLL_INTERVAL_MS);
     return () => clearInterval(intervalId);
   }, [hasActiveWork, currentPage]);
   ```
4. **Summary strip:** render `<PredictionSummary summary={summary} />` between `<PageHeader … />` and the table's `<div className="flex flex-col gap-4">`.
5. **Table header:** replace `<TableHead className="text-right">Samples</TableHead>` with `<TableHead>Progress</TableHead><TableHead>Results</TableHead>`.
6. **Body rows:** replace the Samples cell with:
   ```tsx
   <TableCell>
     <PredictionProgress records={prediction.records} />
   </TableCell>
   <TableCell>
     <PredictionResults byClass={prediction.records.byClass} />
   </TableCell>
   ```
7. **Column counts:** in the loading rows change `length: 4` to `length: 5`, and in the empty state change `colSpan={4}` to `colSpan={5}`.

- [ ] **Step 8: Route the records page's classification through `classLabel`**

In `pages/prediction/local.tsx`, add `import { classLabel } from "@/lib/classes";` and replace `classificationLabel`:

```tsx
/** One wording for the predicted class, in the table and the drawer alike. */
function classificationLabel(value?: number | null): string {
  if (value === null || value === undefined) return "—";
  return `Probable ${classLabel(value).toLowerCase()}`;
}
```

- [ ] **Step 9: Verify**

Run: `cd explainable-platform && ./node_modules/.bin/tsc --noEmit --incremental false`
Expected: exit 0

Build in a clone:
```bash
SP=<scratchpad>; B=$SP/fe-build; F=explainable-platform
rm -rf $B && mkdir -p $B && (cd $F && for f in $(ls -A | grep -vE '^(\.next|node_modules|tsconfig.tsbuildinfo)$'); do cp -cR "$f" $B/; done && cp -cR node_modules $B/) && (cd $B && ./node_modules/.bin/next build)
```
Expected: "Compiled successfully"

- [ ] **Step 10: Commit**

```bash
git add explainable-platform/lib/classes.ts explainable-platform/components/prediction/PredictionProgress.tsx explainable-platform/components/prediction/PredictionResults.tsx explainable-platform/components/prediction/PredictionSummary.tsx explainable-platform/components/model/model.interface.ts explainable-platform/pages/api/predict.ts explainable-platform/components/prediction/StatusBadge.tsx explainable-platform/pages/prediction/prediction.tsx explainable-platform/pages/prediction/local.tsx
git commit -m "feat(platform): show progress and results on the prediction list"
```

---

### Task 5: Shared run details sheet, and published runs in Experiments

**Files:**
- Create: `explainable-platform/components/experiments/RunDetailsSheet.tsx`
- Modify: `explainable-platform/pages/experiments/experiments.tsx`

**Interfaces:**
- Produces:
  ```ts
  RunDetailsSheet(props: {
    runId?: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onChanged?: () => void;
  })
  ```

- [ ] **Step 1: Create `RunDetailsSheet.tsx`**

Move these out of `experiments.tsx` and into this file, unchanged except where noted:
- `isPublished`
- `PublishDialog`: it takes `modelTypes?: IModelType[]` as a prop instead of fetching, and its effect only resets the fields when it opens.
- `DetailList`
- the `<Sheet>` block and its body
- the Publish / Unpublish handlers and the `ConfirmDialog` for unpublishing

The component:

```tsx
export function RunDetailsSheet({
  runId,
  open,
  onOpenChange,
  onChanged,
}: {
  runId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged?: () => void;
}) {
  const [run, setRun] = useState<IRunDetail>();
  const [modelTypes, setModelTypes] = useState<IModelType[]>();
  const [publishOpen, setPublishOpen] = useState(false);
  const [unpublishOpen, setUnpublishOpen] = useState(false);
  // The run last asked for, so a slow answer for an earlier one cannot land.
  const requestedRef = useRef<string>();

  useEffect(() => {
    getModelsType()
      .then(setModelTypes)
      .catch(() => setModelTypes([]));
  }, []);

  const loadRun = async (id: string) => {
    requestedRef.current = id;
    const response = await getRunById(id);
    if (requestedRef.current === id && response.run) setRun(response.run);
  };

  useEffect(() => {
    if (!open || !runId) return;
    setRun(undefined);
    loadRun(runId).catch(() => {
      if (requestedRef.current !== runId) return;
      onOpenChange(false);
      notifyError("Couldn’t Open Run", "MLflow didn’t answer. Try again in a moment.");
    });
  }, [open, runId]);

  const publish = async (data: { model: IModelType; description: string }) => {
    if (!runId) return;
    await putPublicModelByRunId(runId, data);
    await loadRun(runId);
    onChanged?.();
    notifySuccess("Model Published", "It is now offered when uploading files.");
  };

  const unpublish = async () => {
    if (!runId) return;
    await putUnPublicModelByRunId(runId);
    await loadRun(runId);
    onChanged?.();
    notifySuccess("Model Unpublished");
  };

  const model = run?.models?.[0];
  const published = parsePublishDescription(model?.description);
  const typeName = modelTypes?.find((type) => type.id === published.typeId);
  // …render the Sheet exactly as experiments.tsx does today, with the Model
  // DetailList entries extended to:
  //   ["Name", model.name], ["Version", model.version],
  //   ["Stage", isPublished(run) ? "Production" : model.current_stage || "None"],
  //   ["Type", typeName ? `${typeName.name} (${typeName.description})` : published.typeId ?? "—"],
  //   ["Description", published.text || "—"],
  // and <PublishDialog modelTypes={modelTypes} … onPublish={publish} />
  // and <ConfirmDialog … onConfirm={unpublish} />.
}
```

Also add the description parser in the same file:

```tsx
/**
 * Publish stores the model type and description as JSON in the model version's
 * description. Anything else, such as a description set in MLflow directly, is
 * shown as it is.
 */
function parsePublishDescription(raw?: string): { typeId?: string; text?: string } {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return { typeId: parsed.model ?? undefined, text: parsed.description ?? undefined };
    }
  } catch {
    // Not JSON: fall through to plain text.
  }
  return { text: raw };
}
```

- [ ] **Step 2: Rework `experiments.tsx`**

1. **Delete** from `experiments.tsx`:
   - `PublishDialog`, `DetailList` and `isPublished`;
   - the state `runInfo`, `publishOpen` and `unpublishOpen`, and `requestedRunRef`;
   - `loadRunInfo`, `refreshRunInfo`, `publishModel` and `unPublishModel`;
   - the `<Sheet>`, `<PublishDialog>` and `<ConfirmDialog>` blocks;
   - any imports that are now unused.
2. **Add state:**
   ```tsx
   const [openRunId, setOpenRunId] = useState<string>();
   // run_id → version, for runs whose model version is in Production.
   const [publishedRuns, setPublishedRuns] = useState<Map<string, string>>(new Map());

   const loadPublishedRuns = async () => {
     try {
       const { registered_models } = await getExperimentsModelList();
       setPublishedRuns(
         new Map(
           registered_models.flatMap((registered) =>
             (registered.latest_versions ?? [])
               .filter((version) => version.current_stage === "Production")
               .map((version) => [version.run_id, version.version] as [string, string])
           )
         )
       );
     } catch {
       // Keep the last known state; the column is secondary to the runs.
     }
   };
   ```
3. **When to reload the published list:**
   - call `loadPublishedRuns()` in the first `useEffect`, next to `getExperiments()`;
   - call it at the end of `getExperiment()`;
   - call it inside the poll's `setInterval` callback, after `setRuns(data)`.
4. **Opening a run:** replace `loadRunInfo(run.info.run_id)` in both row handlers with:
   ```tsx
   setOpenRunId(run.info.run_id);
   setIsOpen(true);
   ```
5. **Header:**
   - after `<TableHead …>Run Name</TableHead>`, add `<TableHead className="whitespace-nowrap bg-muted">Model</TableHead>`;
   - in the group row, change `colSpan={3}` to `colSpan={4}`;
   - change `columnCount` to `5 + metricsHeaders.length + parametersHeaders.length`.
6. **Body row:** after the sticky run-name cell, add:
   ```tsx
   <TableCell className="whitespace-nowrap">
     {publishedRuns.has(run.info.run_id) ? (
       <Badge>Published · v{publishedRuns.get(run.info.run_id)}</Badge>
     ) : (
       <span className="text-muted-foreground">—</span>
     )}
   </TableCell>
   ```
7. **Render the sheet** at the end:
   ```tsx
   <RunDetailsSheet
     runId={openRunId}
     open={isOpen}
     onOpenChange={setIsOpen}
     onChanged={() => {
       getExperiment();
     }}
   />
   ```
8. **Import** `getExperimentsModelList` from `../api/experiments`, and `RunDetailsSheet` from `@/components/experiments/RunDetailsSheet`.

- [ ] **Step 3: Verify**

Run: `cd explainable-platform && ./node_modules/.bin/tsc --noEmit --incremental false`, then build in a clone as in Task 4 Step 9.
Expected: exit 0; "Compiled successfully"

- [ ] **Step 4: Commit**

```bash
git add explainable-platform/components/experiments/RunDetailsSheet.tsx explainable-platform/pages/experiments/experiments.tsx
git commit -m "feat(platform): mark published runs and share the run details sheet"
```

---

### Task 6: Model details and Unpublish on Registered Models

**Files:**
- Modify: `explainable-platform/pages/experiments/models.tsx`

**Interfaces:**
- Consumes: `RunDetailsSheet` (Task 5)

- [ ] **Step 1: Open a model's run from its row**

In `models.tsx`:

1. **Imports:** add `RunDetailsSheet` from `@/components/experiments/RunDetailsSheet`.
2. **State:**
   ```tsx
   const [openRunId, setOpenRunId] = useState<string>();
   const [sheetOpen, setSheetOpen] = useState(false);

   const openModel = (runId: string) => {
     setOpenRunId(runId);
     setSheetOpen(true);
   };
   ```
3. **Rows:** each model row becomes the following (the row is the mouse target; the button is the keyboard one):
   ```tsx
   <TableRow
     key={`${model.name}-${model.version}`}
     className="cursor-pointer"
     onClick={() => openModel(model.run_id)}
   >
     <TableCell>
       <button
         type="button"
         onClick={(event) => {
           event.stopPropagation();
           openModel(model.run_id);
         }}
         className="rounded-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
       >
         {model.name}
       </button>
     </TableCell>
     <TableCell className="text-right tabular-nums">{model.version}</TableCell>
     <TableCell className="whitespace-nowrap tabular-nums">
       {formatDateTime(model.creation_timestamp)}
     </TableCell>
   </TableRow>
   ```
4. **Sheet:** after the table's wrapper, add the following. An unpublished model leaves this list, so its sheet closes.
   ```tsx
   <RunDetailsSheet
     runId={openRunId}
     open={sheetOpen}
     onOpenChange={setSheetOpen}
     onChanged={() => {
       setSheetOpen(false);
       getModels().catch(() => undefined);
     }}
   />
   ```

- [ ] **Step 2: Verify**

Run: `cd explainable-platform && ./node_modules/.bin/tsc --noEmit --incremental false`, then build in a clone as in Task 4 Step 9.
Expected: exit 0; "Compiled successfully"

- [ ] **Step 3: Commit**

```bash
git add explainable-platform/pages/experiments/models.tsx
git commit -m "feat(platform): open model details and unpublish from Registered Models"
```

---

## After the tasks

Ask Pongsakorn before restarting anything. With a go-ahead, restart:
- **Nest** (`npm run build` in `explainable-platform-service`, then restart `node dist/main` on :3000)
- **the inference service** (:8080)

Then, signed in to the Browser pane:

| Page | Check |
|---|---|
| Prediction list | strip, bars and polling |
| Experiments | Model column, and publish/unpublish through the sheet |
| Models | the sheet, and Unpublish removes the row |
| Any page | a failed stage change (e.g. a run with no model) shows "Couldn’t Publish Model" |
