# TODO: class labels and multi-class models

**Status:** not started. Recorded on 2026-09-15, during PR #5 (`feature/shadcn-ui`), so that picking this up later needs no re-investigation.

**Goal:** let a model define what its predicted class values mean, including binary with other meanings and multi-class (for example −1 / 0 / 1), without hard-coding and without breaking predictions made before the change.

## Why this is needed

Today the whole pipeline assumes a binary task where class `1` means "positive". The assumption is spread across several layers. Nothing records what a class meant when a prediction was made.

- **The raw data survives any change.** `PredictionRecord.class` stores the integer as the model returned it.
- **Its meaning does not.** If "1" ever changes meaning for a model, every earlier prediction would be read with the new meaning.

## Current state: where binary is assumed

Functions and files are named rather than line numbers, which move.

| Layer | Where | The assumption |
|---|---|---|
| Logged model contract | `mlflow-experiments/extension/mlflow_explainable/.../contract.py`, the predict wrapper | `Y_proba = proba[:, 1]` ("binary task assumption — column 1 is the positive class"). `Y_class` is `predict()` or the `argmax` of the probabilities. |
| Contract tests | `mlflow_explainable/tests/test_contract.py` | Assert `Y_class` ⊆ {0, 1}. |
| Inference predict | `kserve-custom-runtime/kserve-shap-multi-modelserver.py`, `predict()` (`/v1/predict/<model>`) | Returns one `proba` float and one `class` int per sample. It does not say which model version answered. |
| Inference explain | same file, `_positive_class_base` and the per-class value handling in the explain routes | With per-class SHAP values, keeps class 1 only. |
| Database | `explainable-platform-service/src/entity/prediction-record.entity.ts` | `proba` is a single `decimal(10,4)`, so per-class probabilities cannot be stored. `class` is a nullable int, which holds −1/0/1 fine. |
| Database | `src/entity/prediction.entity.ts` | Stores `modelName`. The version is recorded only in `explainModelVersion`, set when the explanation is built (`prediction.processor.ts`). It is not set at prediction time, so a prediction whose explanation failed has no version. |
| Model types | `src/entity/model-type.entity.ts`, table `model_type` | `id`, `name`, `description` only (currently CRC and CD). There is no create/edit API or UI; rows are inserted directly. |
| Publish | `PublishDialog` in `explainable-platform/components/experiments/RunDetailsSheet.tsx`, `putPublicModelByRunId` in `pages/api/experiments.ts` | Stores `{"model": typeId, "description": text}` as JSON in the MLflow model version description. Class meanings are not captured. |
| Service filters | `PredictionClass` in `src/interface/prediction-class.enum.ts`, and `getPredictionRecords` in `predictions.service.ts` | `POSITIVE` → `class = 1`, `NEGATIVE` → `class = 0`. |
| Frontend labels | `explainable-platform/lib/classes.ts`, `classLabel()` | `1` → "Positive", `0` → "Negative", anything else → "Class N". This is deliberately the only place values become words. |
| Frontend filters | `CLASS_FILTERS` in `pages/prediction/local.tsx` | All / Positive / Negative. |
| Charts | `RESEARCH_LABELS` in `components/shap/ExplanationCharts.tsx`, and the `shap-svg` package | Every chart explains one predicted probability ("Contribution to predicted probability"). There is no choice of which class to explain. |

**Already class-agnostic.** These were built in PR #5 with this in mind:
- `records.byClass` on `GET /predict` counts samples per class value (`{"0": 26, "1": 12}`) and gives the values no meaning. See `src/predictions/record-counts.ts`.
- The Results column prints whatever class values exist, through `classLabel()`.
- `ModelLink` opens the exact model version recorded on a prediction, never a guess from the name.

## Design principles

1. **Additive only.**
   - New columns are nullable, since TypeORM runs with `synchronize: true` and removing or retyping a column drops data.
   - New API fields are optional.
   - Existing fields (`proba`, `class`, `records.total/success/error`) keep their meaning.
2. **Meaning belongs to an immutable thing.** Labels attach to a model *version* and are snapshotted onto each prediction. Never look them up by model name at read time.
3. **Old data keeps its original meaning.** A prediction with no snapshot uses the legacy binary default (`1` = Positive, `0` = Negative), which is what it was made under.
4. **No hard-coded class lists** in filters, badges or charts. They are derived from the labels in effect for the prediction.
5. **One place turns a value into a word** per surface: `classLabel(value, labels)` in the frontend, and a single helper in the service.

## Planned work

### 1. Default class labels on the model type

- **Column:** add nullable `classLabels jsonb` to `model_type`, shaped `[{ "value": 1, "label": "CRC", "positive": true }, { "value": 0, "label": "Healthy" }]`.
  - `positive` marks the class whose probability is "the" probability in binary displays.
- **Management:** add create/edit (API, and eventually a small admin page) so a new disease type can be added with its labels, rather than by SQL.

### 2. Class labels on the model version, at publish

- **Publish dialog:** add a class-labels editor, pre-filled from the chosen model type's defaults and editable when a model defines its classes differently.
- **Storage:** save the labels with the version. Either extend the JSON already written to the MLflow version description (`{"model", "description", "classLabels"}`), or keep a platform table keyed by `(modelName, version)`. Decide which (see open questions).
- **Validation:** check the labels against the model where possible, for example the logged model's `classes_` or number of output columns.

### 3. Snapshot on the prediction (do this first)

- **Columns:** add nullable `modelVersion` and `classLabels jsonb` to `Prediction`.
- **Filling them:** set both when the prediction is created, from the version the inference service actually used.
  - This needs `/v1/predict` to return `model_version`. The explain routes already do, and the runtime knows it from `_resolve_production_version`.
- **Reading labels:** read them from the prediction, never from the current model or type.
- **Other readers:** `explainModelVersion` stays as is. `ModelLink` and the details sheet prefer `modelVersion`.
- **Why first:** this is the only part that cannot be backfilled. Predictions made before it exists will never know their version or labels.

### 4. Frontend and filters use the snapshot

- **Labels:** `classLabel(value, labels?)` takes the prediction's labels and falls back to the legacy binary default when there are none.
- **Filters:**
  - Build the classification filter from the labels, filtering by value (`?class=1`, `?class=-1`).
  - The service accepts a class value alongside `POSITIVE`/`NEGATIVE`, which stay as aliases so old links keep working.
- **Results:** show labels in the labels' order, with a stable colour per class if colour is ever added back. `records.byClass` already fits.

### 5. Real multi-class support (a separate, larger project)

- **Contract:** in `mlflow_explainable`, `predict` returns per-class probabilities, for example `Y_proba` as a per-class vector or one column per class plus `Y_class`.
  - Keep `Y_proba` as the positive-class probability for binary models so existing artifacts stay valid.
  - Bump the contract version, and update `test_contract.py` to cover multi-class.
- **Inference:** `/v1/predict` returns `probabilities: {classValue: p}` next to `proba`/`class`.
  - The explain routes keep all per-class SHAP values instead of `_positive_class_base` picking class 1, and say which class each set explains.
- **Database:** add nullable `probabilities jsonb` to `PredictionRecord`. `proba` stays the probability of the predicted class (or the positive class for binary), so existing queries and the UI keep working.
- **Explanation payload and charts:** the payload carries per-class values (bump `contract_version`). The charts, and `shap-svg`, gain a class selector, and the axis label names the class being explained.
- **Records UI:** show the predicted class label and its probability, with every class's probability in the drawer.

## Backward-compatibility checklist (before shipping any step)

- [ ] **Old predictions:** those with null `modelVersion`/`classLabels` still show "Probable positive / negative" exactly as today.
- [ ] **Old links:** URLs with `?class=POSITIVE` / `NEGATIVE` still filter correctly.
- [ ] **Old artifacts:** existing binary model artifacts, logged with the current `mlflow_explainable`, still load and predict.
- [ ] **Old payloads:** explanation payloads built before a `contract_version` bump still render.
- [ ] **No destructive migrations:** no column is removed or retyped.

## Recommended order

1. Step 3: record `modelVersion` and a labels snapshot per prediction. With no editor yet, snapshot the legacy default.
2. Steps 1–2: labels on model type and version, and the publish editor.
3. Step 4: the frontend and filters read the snapshot.
4. Step 5: multi-class contract, storage and charts, as its own design and plan.

## Open questions

- **Where do version labels live?** In the MLflow version description JSON (travels with the model, but free text anyone can overwrite in MLflow), or in a platform table keyed by `(modelName, version)` (validated, but separate from MLflow)?
- **What does a "positive" class mean beyond binary?** Should summaries like Needs Attention or future positivity rates be defined per model type?
- **Is −1/0/1 ordinal?** If so, charts may want an ordered colour scale rather than categorical colours.
- **How should a model logged without labels be published?** Require labels, or fall back to the model type's defaults?
