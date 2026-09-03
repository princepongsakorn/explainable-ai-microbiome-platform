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
  --tracking-uri http://35.225.129.127:5000 \
  --max-evals 50
```

Track A uses an 80/20 stratified split (`random_state=42`) and Hyperopt TPE (`random_state=0`). Every trial logs `roc_auc`, `accuracy`, `precision`, `recall`, and `f1`. The search covers 50–1000 estimators plus `max_depth`, `min_samples_leaf`, `min_samples_split`, `max_features`, and `class_weight` choices used by `sample-rf-crc`, but selection is by holdout ROC AUC instead of the old script's accuracy.

Only the winning run calls the repository's `log_explainable_model(model, background=X_train, registered_name="crc-curatedcrc-rf")` contract. The returned version alone is transitioned to Staging with `archive_existing_versions=False`. The script snapshots every Production model version and its run metrics before and after registration and fails if any value changes. It contains no path that promotes a model to Production.

## Track B: paper comparison

```bash
.venv/bin/python mlflow-experiments/curatedcrc-rf/scripts/evaluate_track_b.py
```

The fixed reference model is `RandomForestClassifier(n_estimators=500, max_depth=None, random_state=0, class_weight=None)`. The command writes:

- `outputs/track_b_cohort_cv.csv`: 10-fold × 10-repeat ROC AUC for all five cohorts plus YachidaS controls vs Stage III–IV CRC (the subset corresponding to the paper's quoted 0.82).
- `outputs/track_b_lodo.csv`: fixed-500 leave-one-dataset-out AUC and the paper's reported values for comparison.

The checked-in paper notebook used scikit-learn's historical default of 100 trees for repeated CV and cohort-specific 100/500/1000-tree settings for LODO. These outputs deliberately use the task brief's fixed 500-tree model and label that difference rather than claiming byte-for-byte notebook parity.

## SHAP sanity check

Track A writes a beeswarm PNG, the complete positive-contribution ranking, and a JSON summary. Features are ranked by mean positive class-1 SHAP magnitude; mean absolute and signed SHAP values are retained as context. The run is flagged and exits with status 2 if either `Fusobacterium_nucleatum` or `Peptostreptococcus_stomatis` is outside the top 20. Evidence and the Staging model are preserved, but no Production promotion occurs.

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

Machine-readable full-precision values are in `outputs/track_b_cohort_cv.csv` and `outputs/track_b_lodo.csv`. Track A run ID, metrics, model version, and final biomarker ranks will be added after authenticated execution against the MLflow server.
