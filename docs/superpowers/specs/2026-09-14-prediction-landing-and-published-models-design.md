# Prediction list as the landing page, and published models at a glance

Agreed with Pongsakorn on 2026-09-14. There are two independent changes, each implemented and committed on its own, on `feature/shadcn-ui`.

## 1. The Prediction List becomes an at-a-glance landing page

**Context.** Sign-in lands on `/prediction/prediction`, via the `/` redirect in `next.config.js`. People mostly come back to check on predictions they already sent. They want progress and results side by side, and today the list shows neither.

Approach A was chosen: enrich the existing list rather than add a separate overview page, which would repeat much of it.

### What the page shows

**Summary strip** above the table. It has three figures, counted across all predictions, not just the page:

| Figure | Counts predictions that… |
|---|---|
| In Progress | have at least one sample `PENDING` or `IN_PROGRESS` |
| Needs Attention | have at least one sample in `ERROR` |
| Uploaded in the Last 7 Days | have `createdAt` within the last 7×24 hours |

"Completed in the last 7 days" was the first idea, but neither `Prediction` nor `PredictionRecord` records when work finished, only `createdAt`. Adding an `updatedAt` column (additive, safe under `synchronize: true`) would cover new work only, so it is left out.

**Table columns.** The columns are Prediction, Model, Progress, Results and Created. The separate Samples column goes; the total appears in Progress.

- **Progress** is a stacked bar with one segment per status. It uses the `StatusBadge` colours: success green, error red, canceled muted, in progress blue, pending amber.
  - The text beside it reads, for example, "38 / 40 done". Done means success, error and canceled together. It adds "· 2 errors" when there are any.
  - The bar is `aria-hidden`; the text carries the numbers, and a `title` lists the count for each status.
- **Results** is a two-segment bar: positive (`class` 1) in rose and negative (`class` 0) in sky.
  - The text reads, for example, "12 positive · 26 negative".
  - It shows "—" until a sample has been classified.
  - These colours deliberately differ from the SHAP charts' red and blue, which mean "pushes the prediction up" and "pushes it down", not a class.

**Live updates.** While any prediction on the current page has a `PENDING` or `IN_PROGRESS` sample, the page and the summary are fetched again every 15 s. Polling pauses while the tab is hidden, the same pattern as the Experiments runs table. The drawer is unchanged.

**Failures and empty data.**
- If the summary request fails, its figures show "—" and the table still works. There is no toast, because it is secondary information.
- With no predictions, the table keeps its existing empty state and the strip shows zeros.

### API (`explainable-platform-service`)

**`GET /predict` (existing).** Each item's `records` gains two fields. The existing `total`, `success` and `error` stay, so current consumers are unaffected.
```ts
records: {
  total, success, error,
  byStatus: { PENDING, IN_PROGRESS, SUCCESS, ERROR, CANCELED },
  byClass: { positive, negative },
}
```
The counts come from one grouped query over the page's prediction ids (`GROUP BY prediction, status, class`). This replaces the three `COUNT` queries currently run per prediction. A pure function folds the grouped rows into `byStatus` and `byClass` per prediction.

**`GET /predict/summary` (new).** Returns `{ inProgress, needsAttention, uploadedLast7Days }` from aggregate queries. It is declared before the `:predictionId` routes in `predictions.controller.ts`.

### Testing

- **Backend:** a Jest unit spec for the fold function, beside the service, as with `explain.builder.spec.ts`. It covers:
  - a prediction with every status;
  - one with unclassified (`class` null) samples;
  - one with no rows at all, which yields zeros.
- **Frontend:** there is no test runner. Check with `tsc`, `next build`, and in the browser once Pongsakorn signs in to the Browser pane.

## 2. Published state in Experiments, and details on Models

### Experiments runs table

- **New Model column** after Run Name. It shows a `Published · v3` badge when the run is the Production version of a registered model, and "—" otherwise.
- **Source.** `GET /experiments/models` returns MLflow `registered-models/search`, whose `latest_versions` holds the latest version of each stage.
  - A run is published when some model's `latest_versions` holds its `run_id` with `current_stage === "Production"`.
  - Publishing archives the model's other versions (`archive_existing_versions: true`), so each model has at most one.
- **Freshness.** The list is fetched with the runs, and again on Refresh, on the 15 s poll, and after publishing or unpublishing. There is no backend change.

### Models page

- It still lists only production versions (option A). Models that were unpublished can be published again from Experiments.
- Each row opens the run details sheet; for keyboard users there is a button in the name cell.
- **Unpublish** asks first (`ConfirmDialog`). On success it shows a toast, closes the sheet and fetches the list again, so the row disappears.

### Shared `RunDetailsSheet`

`components/experiments/RunDetailsSheet.tsx` is used by both pages, so both show the same details and actions.

**Props:** `{ runId?: string; open: boolean; onOpenChange(open); onChanged?(): void }`.

**Data:** it loads the run itself (`GET /experiments/run/:runId`) and the model types (`GET /models/model-type`, fetched once while mounted).

**It shows:**
- the run name and a Published / Not Published badge;
- user, start time and duration;
- the model's name, version and stage;
- **model type**, the id mapped to its name, e.g. "CRC (Colorectal cancer)";
- **description**, parsed from the version description that Publish writes as JSON (`{"model": typeId, "description": text}`). A description that does not parse is shown as plain text.
- metrics, with names as logged, and parameters.

**Actions:** Publish (`PublishDialog`, which moves into this file) or Unpublish (`ConfirmDialog`). After either, it reloads the run and calls `onChanged` so the page can refresh its table.

This also takes about 250 lines out of `pages/experiments/experiments.tsx`.

## Out of scope

- Filtering the list by clicking a summary figure.
- Showing only the signed-in user's predictions. Every user sees every prediction today, and so does this page.
- A separate overview page.
- Recording when work completes.
- Listing unpublished registered models on the Models page.
- **Known issue, not fixed here:** failures from MLflow do not always reach the page.
  - Where: the inference service's `PUT /v1/mlflow/run/<run_id>/stage` (`kserve-custom-runtime/kserve-shap-multi-modelserver.py`).
  - What happens: when MLflow raises an exception, and when the run has no model, it answers HTTP 200 with `{"status": "error"}`.
  - Effect: the service and the page take that as success and say "Model Published" or "Model Unpublished". Reloading the run afterwards shows the real stage.
