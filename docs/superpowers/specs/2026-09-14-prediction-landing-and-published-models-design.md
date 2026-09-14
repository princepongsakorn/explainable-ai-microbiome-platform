# Prediction list as the landing page, and published models at a glance

Agreed with Pongsakorn on 2026-09-14. There are three changes, each implemented and committed on its own, on `feature/shadcn-ui`.

## 1. The Prediction List becomes an at-a-glance landing page

**Context.** Sign-in lands on `/prediction/prediction`, through the `/` redirect in `next.config.js`. People mostly come back to check on predictions they already sent. They want progress and results side by side, and today the list shows neither.

Approach A was chosen: enrich the existing list rather than add a separate overview page, which would repeat much of it.

### What the page shows

**Summary strip** above the table. It shows three figures counted across all predictions, not only the current page.

| Figure | Counts predictions that… |
|---|---|
| In Progress | have at least one sample `PENDING` or `IN_PROGRESS` |
| Needs Attention | have at least one sample in `ERROR` |
| Uploaded in the Last 7 Days | have `createdAt` within the last 7×24 hours |

"Completed in the last 7 days" was the first idea, but it cannot be computed. Neither `Prediction` nor `PredictionRecord` records when work finished; each has only `createdAt`. Adding an `updatedAt` column would be additive and safe under `synchronize: true`, but it would cover only new work, so it is left out.

**Table columns.** The columns are Prediction, Model, Progress, Results and Created. The separate Samples column goes, because the total now appears in Progress.

- **Progress.** A stacked bar with one segment per status, in the `StatusBadge` colours: success green, error red, canceled muted, in progress blue, pending amber.
  - Beside it is text such as "38 / 40 done". "Done" counts success, error and canceled together.
  - When there are errors, the text adds "· 2 errors".
  - The bar is `aria-hidden`; the text carries the numbers, and a `title` lists the count for each status.
- **Results.** A stacked bar with one segment per predicted class value, and text such as "12 Positive · 26 Negative".
  - It shows "—" until any sample has been classified.
  - Segment colours come from a fixed categorical palette, assigned in class-value order. They deliberately differ from the SHAP charts' red and blue, which mean "pushes the prediction up/down", not a class.

**Class labels.** A class is a value, not a meaning.
- Today every model is binary, and the app already labels `1` "Positive" and `0` "Negative" in the records page and its filters.
- Later a model may be multi-class (for example −1/0/1), or give 0 and 1 other meanings, configured when it is published.
- So:
  - The API reports counts per class value and assigns them no meaning.
  - The frontend names classes in one function, `classLabel(value)`: `1` → "Positive", `0` → "Negative", anything else → "Class N".
  - When per-model labels exist, only that function has to change: it will receive the prediction's model labels.

**Live updates.** While any prediction on the current page has a `PENDING` or `IN_PROGRESS` sample, the page and the summary are refetched every 15 s. Polling pauses while the tab is hidden, the same pattern as the Experiments runs table. The drawer is unchanged.

**Failures and empty data.**
- If the summary request fails, its figures show "—" and the table still works. There is no toast, because the strip is secondary.
- With no predictions, the table keeps its existing empty state and the strip shows zeros.

### API (`explainable-platform-service`)

**`GET /predict` (existing).** Each item's `records` gains `byStatus` and `byClass`. The existing `total`, `success` and `error` stay, so current consumers are unaffected.
```ts
records: {
  total, success, error,
  byStatus: { PENDING, IN_PROGRESS, SUCCESS, ERROR, CANCELED },  // every status, 0 when none
  byClass: { [classValue: string]: number },                       // e.g. { "0": 26, "1": 12 }; unclassified samples are not counted
}
```
- **How it is counted.** One grouped query covers the page's prediction ids (`GROUP BY prediction, status, class`). It replaces the three `COUNT` queries currently run per prediction.
- **Folding.** A pure function folds the grouped rows into `byStatus` and `byClass` for each prediction.

**`GET /predict/summary` (new).** Returns `{ inProgress, needsAttention, uploadedLast7Days }` from aggregate queries. It is declared before the `:predictionId` routes in `predictions.controller.ts`.

### Testing

- **Backend.** A Jest unit spec for the fold function, beside the service like `explain.builder.spec.ts`. It covers:
  - a prediction with every status;
  - unclassified (`class` null) samples;
  - a class value other than 0/1;
  - a prediction with no rows, which yields zeros and an empty `byClass`.
- **Frontend.** There is no test runner. Checks are `tsc`, `next build`, and the browser once Pongsakorn signs in to the Browser pane.

## 2. Published state in Experiments, and details on Models

### Experiments runs table

- **New Model column** after Run Name. It shows a `Published · v3` badge when the run is the Production version of a registered model, and "—" otherwise.
- **Source.** `GET /experiments/models` returns MLflow `registered-models/search`, whose `latest_versions` holds the latest version of each stage.
  - A run is published when some model's `latest_versions` holds its `run_id` with `current_stage === "Production"`.
  - Publishing archives the model's other versions (`archive_existing_versions: true`), so a model has at most one Production version.
- **Refresh.** The list is fetched with the runs, and again on Refresh, on the 15 s poll, and after publish or unpublish. There is no backend change.

### Models page

- It still lists only production versions. Unpublished models can be published again from Experiments.
- Each row opens the run details sheet. For the keyboard, there is a button in the name cell.
- **Unpublish** asks first (`ConfirmDialog`). On success it shows a toast, closes the sheet and refetches the list, so the row disappears.

### Shared `RunDetailsSheet`

`components/experiments/RunDetailsSheet.tsx` is used by both pages, so both show the same details and actions.

**Props:** `{ runId?: string; open: boolean; onOpenChange(open); onChanged?(): void }`

**Data it loads itself:**
- the run, from `GET /experiments/run/:runId`;
- the model types, from `GET /models/model-type`, fetched once while mounted.

**What it shows:**
- the run name, with a Published / Not Published badge;
- the user, start time and duration;
- the model's name, version and stage;
- the **model type**, with its id mapped to a name, e.g. "CRC (Colorectal cancer)";
- the **description**, parsed from the version description that Publish writes as JSON (`{"model": typeId, "description": text}`). A description that does not parse is shown as text.
- the metrics, with names as logged, and the parameters.

**Actions:**
- **Publish**, through `PublishDialog`, which moves into this file.
- **Unpublish**, through `ConfirmDialog`.
- After either, the sheet reloads the run and calls `onChanged` so the page can refresh its table.

This also takes about 250 lines out of `pages/experiments/experiments.tsx`.

## 3. A failed stage change is reported as a failure

**Problem.** `PUT /v1/mlflow/run/<run_id>/stage`, in `kserve-custom-runtime/kserve-shap-multi-modelserver.py`, answers HTTP 200 with `{"status": "error"}` in two cases:
- when the run has no registered model;
- when MLflow raises `MlflowException`.

The Nest service only fails on a non-2xx response, so the page announces "Model Published" or "Model Unpublished" for a change that never happened.

**Fix.** Return real status codes, as the neighbouring description route already does:
- 404 for a run with no model;
- 500 with the MLflow message for an `MlflowException`.

The Nest service then throws. The page's existing error handling shows "Couldn’t Publish Model" or "Couldn’t Unpublish Model", and the dialog stays open.

Every caller of the Nest publish and unpublish routes is followed through, so that none of them turns the failure back into success.

**Deployment.** The runtime has to be restarted to pick up the change. The session records how (memory: MLflow runtime perf and secrets); a restart is done only with Pongsakorn's go-ahead.

## Out of scope

- Configuring class labels, or declaring a model multi-class, at publish time. This is planned; §1's `classLabel` is the one place it will plug in.
- Filtering the list by clicking a summary figure.
- Showing only the signed-in user's predictions. Every user sees every prediction today, and so does this page.
- A separate overview page, and recording when work completes.
- Listing unpublished registered models on the Models page.
