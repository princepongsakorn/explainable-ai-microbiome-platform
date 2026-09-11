# Rynazal et al. (2023) reproduction notes: why the paper says 549 features and our model has 865

Context for anyone (human or LLM) picking this up: this repo reproduces the Random Forest + SHAP setup
behind Fig. 1 and Fig. 2 of Rynazal et al., *Genome Biology* 24:21 (2023), and registers it on the
platform's MLflow registry. The reproduction is exact. The "549 features" number in the paper is a
post-processing count, not the model's input dimension. Details below.

## 1. What the paper actually did (from its own code)

Source: `mlflow-experiments/curatedcrc-rf/.upstream/shapmat_paper/LODO.ipynb` and
`shap_mat/explainer.py` (pinned commit `6600175db5984a07b86f2b5591114f39181ff4dc`).

1. Loads `data/bacteria_relative_abundance_concat.csv`: 802 samples, 5 cohorts, **865 bacterial features**.
2. Calls `prevalence_filter(...)` but stores the result in `bacteria_ab_x_preval`, which is never used.
   The leave-one-dataset-out (LODO) loop trains on the unfiltered `bacteria_ab_x` (all 865 features).
3. Held-out cohort YachidaS_2019 (331 samples). Train = the other four cohorts (471 samples).
4. Model: `RandomForestClassifier(n_estimators=1000, random_state=0, n_jobs=-1)` for YachidaS
   (per-cohort tree counts come from `n_estimators_dict`). max_depth and class_weight are sklearn defaults.
5. Reported LODO AUC for YachidaS: 0.723.
6. SHAP: `shap.TreeExplainer(model, data=X_test)` on the YachidaS test set (interventional, background =
   the 331 test samples). Base value (expected_value for CRC) is therefore the mean predicted CRC
   probability on YachidaS, about 0.52 to 0.53.
7. `Explainer.shap_df()` is called with its default `correct_pred_only=True`: rows for misclassified
   samples are dropped (331 -> 215 samples). The remaining SHAP matrix is then reduced to columns whose
   mean(|SHAP|) is non-zero. That matrix is the input to the PCA + K-means in Fig. 2.

## 2. Our reproduction

Script: `mlflow-experiments/curatedcrc-rf/scripts/train_rynazal_lodo_yachida.py`

```bash
python mlflow-experiments/curatedcrc-rf/scripts/train_rynazal_lodo_yachida.py \
  --preprocessing notebook-raw --n-estimators 1000 --explainer test-background \
  --registered-name crc-rynazal-notebook --experiment-name crc-rynazal-notebook \
  --output-dir mlflow-experiments/curatedcrc-rf/outputs/rynazal_notebook
```

Environment: scikit-learn 1.6.1, shap 0.49.1, mlflow 2.19.0, Python 3.12.6.

| Item | Paper | Ours |
| --- | ---: | ---: |
| Input features to the RF | 865 (raw, no filter) | 865 |
| Trees / random_state | 1000 / 0 | 1000 / 0 |
| Train / test samples | 471 / 331 | 471 / 331 |
| YachidaS LODO AUC | 0.723 | 0.723 |
| SHAP base value (CRC) | ~0.53 | 0.524 |
| Non-zero mean(\|SHAP\|) columns, all 331 test samples | not reported | 562 |
| Non-zero mean(\|SHAP\|) columns, correctly predicted samples only (215) | **549** | **549** |

Other test metrics on YachidaS (threshold 0.5): accuracy 0.650, precision 0.693, recall 0.670, F1 0.681.
Top mean(|SHAP|) features: Peptostreptococcus_stomatis, Parvimonas_micra, Fusobacterium_nucleatum,
Gemella_morbillorum, Clostridium_symbiosum.

So: **549 = number of SHAP-matrix columns left after (a) dropping misclassified test samples and
(b) dropping all-zero columns.** It is reproduced exactly, and it only comes out to 549 with 1000 trees
(500 trees gives 539). It is not a prevalence-filter result: shapmat's `ab_filter` with its defaults
(abundance 1e-15, prevalence 0.9) keeps 228 features, and no threshold combination yields 549.

## 3. Registered models on the platform (MLflow `http://35.225.129.127:5000`)

| Registered name | Version / stage | Setup | Features | AUC | Logged explainer |
| --- | --- | --- | ---: | ---: | --- |
| `crc-rynazal-notebook` | 1 / Staging | notebook-literal (above) | 865 | 0.723 | `TreeExplainer(model, data=X_test)`, background = 331 YachidaS rows |
| `crc-rynazal-lodo-yachida` | 1 / Production | task-brief variant: shapmat `ab_filter` defaults, 500 trees | 228 | 0.730 | `TreeExplainer(model)`, no background |

Both were logged through `mlflow_explainable.log_explainable_model`; `background=X_train` there is only
used for feature names, signature and input example, not for the explainer.

`sample-data/yachidas_2019_test.csv` currently has the 865-column schema of `crc-rynazal-notebook`
(`sample_id` + 865 features). `sample-data/yachidas_2019_test_labels.csv` holds the ground truth
(`sample_id,label`). The 228-column file for the other model is an artifact under `test_set/` of MLflow
run `c6c6898e5b38462da9b3024a3be42c89`.

## 4. Is anything wrong with the model or the platform? No.

- **Model**: identical to the paper (same data file, features, parameters, split, AUC).
- **SHAP computation**: the platform's runtime calls the bundled explainer and gets the same 331 x 865
  SHAP matrix the notebook gets before any trimming.
- **Rendering**: the platform shows beeswarm/heatmap with `max_display=15` and waterfall with
  `max_display=8` (`kserve-custom-runtime/kserve-shap-multi-modelserver.py`). All-zero SHAP columns can
  never reach the top 15, so keeping 865 columns changes nothing visually.
- **Why the platform cannot show "549"**: step (a) needs the true label of every sample to decide which
  predictions are correct. The platform predicts on unlabeled uploads, so filtering to correct predictions
  is impossible by design. Fig. 2-style PCA/clustering of SHAP values is an offline analysis; do it in a
  notebook with `yachidas_2019_test_labels.csv`, not as a platform feature.

## 5. One-paragraph summary for a report

The reference model was reproduced exactly: an 865-feature (unfiltered) Random Forest with 1000 trees and
random_state 0, trained on YuJ_2015, WirbelJ_2018, ZellerG_2014 and VogtmannE_2016 (471 samples) and
evaluated on YachidaS_2019 (331 samples), reaching the paper's AUC of 0.723. SHAP values were computed
with TreeExplainer using the test set as background (base value 0.524). The paper's "549 features" refers
to the SHAP matrix used for its Fig. 2 clustering after removing misclassified samples (215 remain) and
all-zero columns; applying the same steps to our SHAP values gives exactly 549.
