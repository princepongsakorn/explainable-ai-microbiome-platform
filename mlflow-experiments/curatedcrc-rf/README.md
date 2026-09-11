# curatedCRC Random Forest experiment

This experiment retrains the platform Random Forest on all 802 CRC/control samples from Rynazal et al.'s curatedCRC dataset. It is isolated from the existing `sample-rf-crc` and `ryza-rynazal-crc` experiments and registers under the new model name `crc-curatedcrc-rf`.

## Data provenance

| Item | Value |
| --- | --- |
| Data repository | `https://github.com/ryzary/shapmat` |
| Branch / commit | `cv_notebook` / `0ca51a9ab9c859fac3305f599a81b2e2206bef49` |
| Path | `data/curatedCRC.csv` |
| CSV SHA-256 | `8f1258882cbedd1613ae3490f9ec94bbc97c72c041f1ed9f531f43b2030c1a8f` |
| Paper-code repository commit | `6600175db5984a07b86f2b5591114f39181ff4dc` |
| Samples | 802 (378 healthy, 424 CRC) |
| Raw bacterial features | 864 |
| Filtered bacterial features | 221 |

The five upstream `study_name` values are `VogtmannE_2016`, `WirbelJ_2018`, `YachidaS_2019`, `YuJ_2015`, and `ZellerG_2014`. The source calls the Wirbel cohort `WirbelJ_2018`, although the associated paper was published in 2019; code and outputs preserve the source value.

`curatedcrc.data.prepare_dataset` imports and calls `shapmat.abundance_filter.ab_filter` directly with `abundance_threshold=1e-5` and `prevalence_threshold=0.9`. SHAPMAT retains a feature only when its zero fraction is strictly below 0.9, so a feature with exactly 90% zeros is removed. The installed `shapmat==0.1.5` filter source has the same SHA-256 as the pinned upstream implementation.

## Environment

From the repository root:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r mlflow-experiments/curatedcrc-rf/requirements.txt
.venv/bin/python -m pip install -e mlflow-experiments/extension/mlflow_explainable
```

MLflow credentials are never stored by this experiment. If the server requires basic authentication, export `MLFLOW_TRACKING_USERNAME` and `MLFLOW_TRACKING_PASSWORD` before training. The default tracking server is `http://35.225.129.127:5000`; override it with `--tracking-uri` or `MLFLOW_TRACKING_URI`.

## Prepare data and the 60-row sample

```bash
.venv/bin/python mlflow-experiments/curatedcrc-rf/scripts/prepare_data.py
```

This clones both pinned upstream repositories into the ignored `.upstream/` directory, validates the exact data checksum and dimensions, filters all 802 rows, and writes:

- `sample-data/curatedCRC-60-row.csv`: 60 proportionally stratified rows (seed 42), 221 filtered features, and final integer label `CRC`.
- `sample-data/curatedCRC-60-row.manifest.json`: selected IDs, source commits/checksum, and class/cohort counts.
- `outputs/data_provenance.json`: full-data provenance and observed filtering counts.

The old `sample-data/sample-60-row.csv` is not reused because it comes from the 180-row subset. Existing sample files remain unchanged.

## Track A: platform MLflow pipeline

```bash
.venv/bin/python mlflow-experiments/curatedcrc-rf/scripts/train_track_a.py \
  --tracking-uri http://35.225.129.127:5000
```

Track A runs no hyperparameter search. It trains the same fixed model Track B compares against — `RandomForestClassifier(n_estimators=500, max_depth=None, random_state=0, class_weight=None)`, the parameters Rynazal et al. use — on all 802 samples with no holdout held back. `curatedcrc.train.reference_params` reads those values off `curatedcrc.evaluate.reference_model`, so the registered model and the paper comparison cannot drift apart.

Because the registered model sees every sample, the run's `roc_auc`, `accuracy`, `precision`, `recall`, and `f1` are pooled 10-fold × 10-repeat stratified CV means over those same 802 samples (100 fits, `random_state=0`), each logged next to a matching `*_std`. Track B's per-cohort and leave-one-dataset-out AUCs are read from `outputs/track_b_cohort_cv.csv` and `outputs/track_b_lodo.csv` and logged onto the same run as `cv10x10_auc_<group>` and `lodo_auc_<cohort>`, so every number in the paper hangs off one MLflow run and one model version. Run Track B first when those files are absent; the training run still succeeds without them and simply omits those metrics.

The run calls the repository's `log_explainable_model(model, background=X, registered_name="crc-curatedcrc-rf")` contract and transitions the returned version to Staging with `archive_existing_versions=True`, so any earlier Staging version of this model is archived and the platform resolves a single current model. The script snapshots every Production model version and its run metrics before and after registration and fails if any value changes. It contains no path that promotes a model to Production.

### Observed Track A result

The run completed against `http://35.225.129.127:5000` on 2026-09-03 with workflow ID `f24eb733b4544979ae18c65d4acde015`. It is a single run, `74621d1f28db48c5861302672d80c11b`, in MLflow experiment `crc-curatedcrc-rf` (experiment ID 10).

Pooled 10-fold × 10-repeat CV over all 802 samples (100 fits):

| Metric | Mean | Std |
| --- | ---: | ---: |
| ROC AUC | 0.808967 | 0.043275 |
| Accuracy | 0.727676 | 0.046149 |
| Precision | 0.747618 | 0.051810 |
| Recall | 0.736728 | 0.066661 |
| F1 | 0.740205 | 0.047448 |

The same run also carries the Track B per-cohort AUCs as `cv10x10_auc_*`, the leave-one-dataset-out AUCs as `lodo_auc_*`, and their mean as `lodo_mean_auc` (0.807629).

The model fit on all 802 samples is registered as `crc-curatedcrc-rf` version 2 and staged as Staging; version 1 — the earlier tuned model — was archived by the same transition, so the registry exposes exactly one current curatedCRC model. A follow-up server query loaded version 2 as an MLflow PyFunc model, which returned `Y_proba`/`Y_class` for the 60-row sample and exposed a working `shap_explain`.

Production state was unchanged across registration: `sample-rf-crc` version 96, `sample-gcn-crc` version 29, and `sample-xgboost-crc` version 31 remained the Production versions with the same run IDs and metrics. Full evidence is saved in `outputs/track_a_model_run.json` and `outputs/track_a_registration.json`.

## Deployment to the platform

The inference service only loads registered models whose stage is `Production` (`load_explainable_model` in `kserve-custom-runtime/kserve-shap-multi-modelserver.py`), and the platform UI lists exactly what `GET /v1/models` returns. Training never promotes; promotion is a separate, deliberate step:

```python
client.update_model_version(name="crc-curatedcrc-rf", version="2", description=json.dumps(
    {"model": "e5dd86c6-56c3-499a-af4f-9f01d29d9803",
     "description": "curatedCRC RF - 802 samples, Rynazal parameters (500 trees), 221 features"}))
client.transition_model_version_stage(
    name="crc-curatedcrc-rf", version="2", stage="Production", archive_existing_versions=False)
```

The description is JSON because `ModelsService.fetchProductionModels` parses it to resolve the model-type UUID used by the other platform models; `archive_existing_versions=False` keeps `sample-rf-crc` 96, `sample-gcn-crc` 29, and `sample-xgboost-crc` 31 in Production untouched.

Version 2 was promoted on 2026-09-03 and verified end-to-end against `http://35.239.175.89:8080` with `sample-data/curatedCRC-60-row.csv`:

| Endpoint | Result |
| --- | --- |
| `POST /v1/predict/crc-curatedcrc-rf` | 200, 60 probabilities and classes |
| `POST /v1/explain/beeswarm/crc-curatedcrc-rf` | 200 |
| `POST /v1/explain/heatmap/crc-curatedcrc-rf` | 200 |
| `POST /v1/explain/waterfall/crc-curatedcrc-rf` | 200 for a single row (the endpoint rejects multi-row input by design) |

The server's `transformer` aligns uploaded columns to the model's `feature_names`, so the sample's `subject_id` and `CRC` columns are dropped before inference and no manual editing is needed.

**The 60-row sample is drawn from the same 802 samples the model was fit on.** Its predictions agree with its own `CRC` column on all 60 rows, which demonstrates the interface end to end and must not be reported as a performance estimate. Every accuracy claim belongs to the cross-validated numbers above.

## Track B: paper comparison

```bash
.venv/bin/python mlflow-experiments/curatedcrc-rf/scripts/evaluate_track_b.py
```

The fixed reference model is `RandomForestClassifier(n_estimators=500, max_depth=None, random_state=0, class_weight=None)` — the same estimator Track A registers. The command writes:

- `outputs/track_b_cohort_cv.csv`: 10-fold × 10-repeat ROC AUC for all five cohorts plus YachidaS controls vs Stage III–IV CRC (the subset corresponding to the paper's quoted 0.82).
- `outputs/track_b_lodo.csv`: fixed-500 leave-one-dataset-out AUC and the paper's reported values for comparison.

The checked-in paper notebook used scikit-learn's historical default of 100 trees for repeated CV and cohort-specific 100/500/1000-tree settings for LODO. These outputs deliberately use the task brief's fixed 500-tree model and label that difference rather than claiming byte-for-byte notebook parity.

## SHAP sanity check

Track A writes a beeswarm PNG, the complete positive-contribution ranking, and a JSON summary, computed over all 802 samples with the same 802 rows as the SHAP background — the identical explainer that is pickled into the registered model, so the platform UI and the paper figures share one explanation. Features are ranked by mean positive class-1 SHAP magnitude; mean absolute and signed SHAP values are retained as context. The run is flagged and exits with status 2 if either `Fusobacterium_nucleatum` or `Peptostreptococcus_stomatis` is outside the top 20. Evidence and the Staging model are preserved, but no Production promotion occurs.

The observed check passed: `Peptostreptococcus_stomatis` ranked 3rd and `Fusobacterium_nucleatum` ranked 5th among positive class-1 contributors. Both are visible in `outputs/track_a_shap_beeswarm.png`; full rankings and the machine-readable verdict are in `outputs/track_a_shap_positive_contributors.csv` and `outputs/track_a_shap_summary.json`.

## Observed Track B results

The complete 500-tree run produced:

| Evaluation group | 10×10 CV ROC AUC (mean ± std) |
| --- | ---: |
| VogtmannE_2016 | 0.644 ± 0.157 |
| WirbelJ_2018 | 0.893 ± 0.087 |
| YachidaS_2019 (all stages) | 0.751 ± 0.073 |
| YuJ_2015 | 0.844 ± 0.121 |
| ZellerG_2014 | 0.856 ± 0.120 |
| YachidaS_2019 (Stage III–IV CRC + controls) | 0.782 ± 0.103 (paper reference: 0.82) |

| Held-out cohort | Fixed-500 LODO AUC | Paper-reported AUC |
| --- | ---: | ---: |
| VogtmannE_2016 | 0.767 | 0.766 |
| WirbelJ_2018 | 0.873 | 0.894 |
| YachidaS_2019 | 0.725 | 0.723 |
| YuJ_2015 | 0.876 | 0.867 |
| ZellerG_2014 | 0.796 | 0.771 |

Machine-readable full-precision values are in `outputs/track_b_cohort_cv.csv` and `outputs/track_b_lodo.csv`.
