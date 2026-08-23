# curatedCRC Random Forest Retraining Design

## Objective

Add a reproducible, isolated experiment for the 802-sample curatedCRC dataset. The experiment must prepare the data with SHAPMAT's own abundance/prevalence filter, tune and register a new explainable Random Forest through the platform's MLflow contract, reproduce the paper's repeated cross-validation protocol, and generate a SHAP biomarker sanity check. Existing registered models and every Production-stage model version remain unchanged.

## Upstream data and provenance

The implementation will clone both upstream repositories into a temporary working directory:

- `https://github.com/ryzary/shapmat`
- `https://github.com/ryzary/shapmat_paper`

The acquisition command will resolve and record each repository's exact commit SHA. The expected primary data source is `data/curatedCRC.csv` on SHAPMAT's `cv_notebook` branch; the implementation must verify that path against both clones rather than relying on the existing hard-coded URL. It will calculate and record the CSV's SHA-256 checksum, row count, columns, class counts, cohort counts, and source URL. If the CSV is absent, the command will stop with instructions pointing to the regeneration code found in `shapmat_paper`; it will not silently substitute a different dataset.

The validated raw CSV will be kept as an input artifact for the experiment rather than replacing `sample-data/sample.csv`. The raw table must contain exactly 802 CRC/healthy samples and exactly these five studies: `YachidaS_2019`, `YuJ_2015`, `WirbelJ_2019`, `ZellerG_2014`, and `VogtmannE_2016` (allowing upstream display-name punctuation only through an explicit canonical-name mapping). Adenoma or other non-binary labels cause validation to fail.

## Package layout

Create `mlflow-experiments/curatedcrc-rf/` as a self-contained experiment package:

- `curatedcrc/data.py`: validated loading, SHAPMAT filtering, metadata separation, provenance calculation, and deterministic 60-row sample generation.
- `curatedcrc/train.py`: Track A split, Hyperopt objective, metric logging, best-run selection, explainable-model registration, and Staging transition.
- `curatedcrc/evaluate.py`: Track B per-cohort repeated cross-validation and optional leave-one-dataset-out evaluation.
- `curatedcrc/shap_report.py`: class-1 SHAP values, ranked contributors, biomarker assertions, and beeswarm output.
- `scripts/prepare_data.py`, `scripts/train_track_a.py`, and `scripts/evaluate_track_b.py`: thin command-line entry points.
- `tests/`: focused unit and integration tests using small fixtures and a local file-backed MLflow store.
- `outputs/`: generated CSV/PNG/JSON result artifacts, with a README explaining which files are reproducible outputs.
- `README.md`, `MLproject`, and a pinned Python environment file: commands, thresholds, provenance, feature count, model names, and result summaries.

This new directory will not import or mutate `mlflow-experiments/ryza-rynazal-crc/model.py` or `mlflow-experiments/sample-rf-crc/model.py`. It will reuse their public MLflow logging pattern and the in-repo `mlflow_explainable.log_explainable_model` package.

## Data preparation

Load `curatedCRC.csv` with the subject identifier as the index. Preserve `study_name`, `CRC`, and `ajcc_stage` as metadata and pass only bacterial abundance columns to filtering.

Invoke `shapmat.abundance_filter.ab_filter` directly with:

- `abundance_threshold=1e-5`
- `prevalence_threshold=0.9`

No local reimplementation of the filter is permitted. After filtering, reject NaN/infinite values, duplicate subject identifiers, missing labels, unexpected metadata columns treated as features, or an empty feature matrix. Record both the unfiltered and filtered feature counts. The platform-facing label remains the integer column `CRC`, encoded as `0` for healthy and `1` for CRC.

Filtering is performed once on the validated complete curatedCRC feature matrix, matching the ordering in the upstream paper workflow, before Track A splitting or Track B cohort selection. The same filtered feature names and order are used by training, evaluation, SHAP, and the sample export.

## Deterministic 60-row platform sample

Create `sample-data/curatedCRC-60-row.csv` from the validated 802-row dataset with a fixed random seed of `42`. Sampling will be stratified by canonical cohort and `CRC` label with proportional allocation so the output represents all five cohorts and both classes while remaining reproducible. The exported table will match the platform CSV schema: subject identifier index, filtered bacterial feature columns in model order, and final integer `CRC` column. Study and stage metadata stay out of the platform-facing CSV. A companion JSON manifest will record selected subject IDs, seed, source checksum, class counts, cohort counts, and filtered feature count.

The existing `sample-data/sample-60-row.csv` is not a substitute: it is derived from the old 180-sample dataset. It remains untouched for backward compatibility.

## Track A: platform training and registration

Use `train_test_split(test_size=0.2, random_state=42, stratify=y)` on all 802 filtered samples. Hyperopt uses TPE for exactly 50 trials with deterministic random state and this search space:

- `n_estimators`: 50 through 1000 in steps of 50
- `max_depth`: 10, 20, 50, 100, or `None`
- `min_samples_leaf`: integers 1 through 5
- `min_samples_split`: integers 2 through 6
- `max_features`: `sqrt`, `log2`, or `None`
- `class_weight`: `None` or `balanced`

Each trial fits a `RandomForestClassifier` with a fixed per-trial reproducibility seed and logs parameters plus holdout `roc_auc`, `accuracy`, `precision`, `recall`, and `f1`. Binary precision/recall/F1 use CRC (`1`) as the positive class with zero-division handling. Hyperopt minimizes negative ROC AUC. Every trial receives tags identifying the dataset checksum, thresholds, split seed, code purpose, and model candidate name.

After all trials complete, identify the highest unrounded holdout ROC AUC, tag that existing MLflow trial run as the best run, reopen that run, and call:

```python
log_explainable_model(
    model=best_model,
    background=X_train,
    registered_name="crc-curatedcrc-rf",
)
```

Only the best run registers a model version. The returned registration metadata is resolved through `MlflowClient`, and only that exact new version of `crc-curatedcrc-rf` is transitioned to `Staging` with `archive_existing_versions=False`. The script records the set of Production model versions before and after registration and fails if it changes. Tracking URI and credentials come from environment variables; no new credentials are committed.

## Track B: paper-protocol comparison

Use exactly:

```python
RandomForestClassifier(
    n_estimators=500,
    max_depth=None,
    random_state=0,
    class_weight=None,
)
```

For each of the five cohorts, evaluate ROC AUC with `RepeatedStratifiedKFold(n_splits=10, n_repeats=10, random_state=0)`. Validate that every cohort/class has at least ten samples before evaluation. Save one row per cohort with sample count, healthy count, CRC count, mean ROC AUC, standard deviation across the 100 held-out folds, and confidence-supporting minimum/maximum fold scores to `outputs/track_b_cohort_cv.csv`. Print a compact `cohort -> mean ± std` table.

The same command also supports LODO. For each held-out cohort, train the fixed Random Forest on the other four cohorts and calculate a single held-out ROC AUC. Save results to `outputs/track_b_lodo.csv`. Cohort CV and LODO are separate result tables because a single LODO test score has no fold standard deviation.

## SHAP sanity check

For the Track A best model, calculate class-1 SHAP values on the untouched holdout set. Support the SHAP return shapes produced by the pinned SHAP version and verify that the final matrix is `n_test_samples × n_features`. Save:

- `outputs/track_a_shap_beeswarm.png`
- `outputs/track_a_shap_positive_contributors.csv`
- `outputs/track_a_shap_summary.json`

Rank global importance by mean absolute class-1 SHAP value and include mean signed class-1 SHAP value to distinguish direction. Normalize display names only for matching, mapping `Fusobacterium_nucleatum` and `Peptostreptococcus_stomatis` to the paper names. Both biomarkers must appear in the filtered matrix and in the configured top-20 global importance list. If either check fails, write the report with `status=flagged`, log it to the best MLflow run, and exit unsuccessfully after preserving the evidence; the registration may remain Staging but must never be promoted to Production.

## Error handling and safety

- Fail before training if provenance, sample count, cohort set, binary labels, or SHAPMAT filtering validation differs from expectations.
- Retry no state-changing MLflow action automatically; surface the run/model version already created so reruns are auditable.
- Never call a Production transition and never archive an existing model version.
- Default commands support a dry/local mode using a temporary file-backed MLflow store for tests.
- Generated artifacts are written atomically where practical so interrupted evaluations do not look complete.
- Full 50-trial and 10×10 evaluations print progress and can be rerun independently from the prepared-data artifact.

## Verification

Automated tests will prove:

- metadata and features are separated correctly and labels/cohorts are validated;
- the real `ab_filter` function is called with exactly `1e-5` and `0.9`;
- the 60-row export is deterministic, has the platform schema, all cohorts in its manifest, and both classes;
- every Track A trial logs all five required metrics and selection uses ROC AUC;
- registration targets only `crc-curatedcrc-rf`, transitions only the returned version to Staging, and rejects any Production-set change;
- Track B produces 100 fold scores per cohort and the expected CSV schema;
- LODO trains on four cohorts and tests only the held-out cohort;
- SHAP shape normalization and biomarker flagging behave correctly.

Final verification will run the complete 802-sample preparation, 50-trial Track A job, five-cohort 10×10 Track B job, LODO job, and SHAP report. The README/run description will be updated with the observed filtered feature count, source commit/checksum, best run ID and metrics, model version/stage, cohort table, LODO table, and biomarker status. MLflow client queries before and after will provide acceptance evidence that existing Production models and their metrics were untouched.
