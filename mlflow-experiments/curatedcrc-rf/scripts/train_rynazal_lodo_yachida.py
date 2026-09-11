#!/usr/bin/env python3
"""Reproduce the Rynazal et al. (2023, Genome Biology 24:21) Fig. 1/2 setup.

Setup
-----
* Data: curatedCRC (802 samples, 5 cohorts) from the pinned ``ryzary/shapmat``
  checkout resolved by ``curatedcrc.acquire``.
* Preprocessing: ``shapmat.abundance_filter.ab_filter`` with SHAPMAT's own
  defaults (abundance 1e-15, prevalence 0.9), fit on the full 802-sample table
  exactly as SHAPMAT does. Labels are the source ``CRC`` column (CRC=1,
  control=0).
* Split: TRAIN = YuJ_2015 + WirbelJ_2018 (the paper's WirbelJ_2019) +
  ZellerG_2014 + VogtmannE_2016 (471 samples); TEST = YachidaS_2019
  (331 samples, never used for training).
* Model: ``RandomForestClassifier(n_estimators=500, max_depth=None,
  random_state=0, class_weight=None)``.
* SHAP: ``shap.TreeExplainer(model)`` (no background data) on TEST, class CRC.
* Registration: ``mlflow_explainable.log_explainable_model`` with the exact
  TreeExplainer above; ``background=X_train`` is only used for feature names,
  signature and input example. Promoted to Staging only. Production is never
  touched; the script snapshots every Production version before and after and
  fails if anything changed.

Known deviations from the paper's reported numbers
--------------------------------------------------
The paper quotes 549 features and a base value of 0.53. Neither comes from
SHAPMAT's prevalence filter: the paper notebook (``LODO.ipynb``) trains on all
raw features and builds ``shap.TreeExplainer(model, data=X_test)``, so 549 is
the number of features with non-zero mean(|SHAP|) and 0.53 is the
interventional base value (mean predicted CRC probability on YachidaS). This
script follows the task brief (SHAPMAT defaults, TreeExplainer without
background) and additionally records the interventional base value and the
non-zero-SHAP feature count so the two conventions can be compared.
``--preprocessing notebook-raw`` reproduces the notebook's unfiltered setup:
it reads the notebook's own ``data/bacteria_relative_abundance_concat.csv``
(865 raw features, 802 samples, same SAMD ids) and applies no filter. Combine
with ``--n-estimators 1000 --explainer test-background`` for the notebook's
YachidaS LODO parameters and its ``TreeExplainer(model, data=X_test)``.

Usage
-----
    MLFLOW_TRACKING_USERNAME=... MLFLOW_TRACKING_PASSWORD=... \
    python scripts/train_rynazal_lodo_yachida.py --tracking-uri http://35.225.129.127:5000
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import sys
import tempfile
from pathlib import Path
from typing import Any

_matplotlib_cache = Path(tempfile.gettempdir()) / "curatedcrc-matplotlib-cache"
_matplotlib_cache.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_matplotlib_cache))

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import mlflow  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import shap  # noqa: E402
import sklearn  # noqa: E402
from mlflow.tracking import MlflowClient  # noqa: E402
from mlflow_explainable import log_explainable_model  # noqa: E402
from shapmat.abundance_filter import ab_filter  # noqa: E402
from sklearn.ensemble import RandomForestClassifier  # noqa: E402
from sklearn.metrics import (  # noqa: E402
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)

EXPERIMENT_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = EXPERIMENT_ROOT.parents[1]
sys.path.insert(0, str(EXPERIMENT_ROOT))

from curatedcrc.acquire import acquire_upstream, sha256_file  # noqa: E402
from curatedcrc.train import production_snapshot  # noqa: E402

DEFAULT_TRACKING_URI = "http://35.225.129.127:5000"
DEFAULT_NAME = "crc-rynazal-lodo-yachida"
TEST_COHORT = "YachidaS_2019"
TRAIN_COHORTS = ("YuJ_2015", "WirbelJ_2018", "ZellerG_2014", "VogtmannE_2016")
# (control, CRC) counts from the task brief; the source calls Wirbel "WirbelJ_2018".
EXPECTED_COHORT_COUNTS = {
    "YachidaS_2019": (146, 185),
    "YuJ_2015": (54, 74),
    "WirbelJ_2018": (65, 60),
    "ZellerG_2014": (61, 53),
    "VogtmannE_2016": (52, 52),
}
METADATA_COLUMNS = ["study_name", "CRC", "ajcc_stage"]
NOTEBOOK_DATA = Path("data") / "bacteria_relative_abundance_concat.csv"  # under shapmat_paper
NOTEBOOK_METADATA_COLUMNS = ["study_name", "CRC"]
REQUIRED_TEST_IDS = ("SAMD00114931", "SAMD00114739")
RF_PARAM_KEYS = ("n_estimators", "max_depth", "random_state", "class_weight")
SHAPMAT_DEFAULTS = {"abundance_threshold": 1e-15, "prevalence_threshold": 0.9}
AUC_GUARD = (0.6, 0.85)
PAPER_REFERENCE = {"auc": 0.72, "base_value": 0.53, "features": 549}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--checkout-dir", type=Path, default=EXPERIMENT_ROOT / ".upstream")
    parser.add_argument(
        "--tracking-uri", default=os.environ.get("MLFLOW_TRACKING_URI", DEFAULT_TRACKING_URI)
    )
    parser.add_argument("--experiment-name", default=DEFAULT_NAME)
    parser.add_argument("--registered-name", default=DEFAULT_NAME)
    parser.add_argument(
        "--output-dir", type=Path, default=EXPERIMENT_ROOT / "outputs" / "rynazal_lodo_yachida"
    )
    parser.add_argument("--sample-data-dir", type=Path, default=REPOSITORY_ROOT / "sample-data")
    parser.add_argument(
        "--preprocessing",
        choices=("shapmat-default", "notebook-raw"),
        default="shapmat-default",
        help="shapmat-default: ab_filter(1e-15, 0.9) on all 802 rows (task brief). "
        "notebook-raw: no filtering, as LODO.ipynb actually runs.",
    )
    parser.add_argument(
        "--n-estimators", type=int, default=500,
        help="500 = task brief; 1000 = the notebook's YachidaS LODO setting.",
    )
    parser.add_argument(
        "--explainer",
        choices=("path-dependent", "test-background"),
        default="path-dependent",
        help="Explainer logged to the platform and used for the primary SHAP report: "
        "path-dependent = shap.TreeExplainer(model) (task brief); "
        "test-background = shap.TreeExplainer(model, data=X_test) (paper notebook).",
    )
    parser.add_argument("--n-jobs", type=int, default=-1)
    parser.add_argument(
        "--skip-registration",
        action="store_true",
        help="Train, evaluate, explain and export only; do not contact MLflow.",
    )
    parser.add_argument(
        "--verify-version",
        default=None,
        help="Do not log or register; retrain locally (deterministic) and verify the "
        "already registered model version against it, then write registration.json.",
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------
def load_table(
    data_path: Path, metadata_columns: list[str] = METADATA_COLUMNS
) -> tuple[pd.DataFrame, pd.DataFrame]:
    table = pd.read_csv(data_path, index_col=0)
    table.index = table.index.astype(str)
    table.index.name = "sample_id"
    missing = set(metadata_columns).difference(table.columns)
    if missing:
        raise ValueError(f"Missing metadata columns: {sorted(missing)}")
    if not table.index.is_unique:
        raise ValueError("Duplicate sample identifiers in curatedCRC")
    metadata = table[metadata_columns].copy()
    metadata["CRC"] = pd.to_numeric(metadata["CRC"], errors="raise").astype(int)
    if set(metadata["CRC"].unique()) != {0, 1}:
        raise ValueError(f"Unexpected labels: {sorted(metadata['CRC'].unique())}")
    X_raw = table.drop(columns=metadata_columns).apply(pd.to_numeric, errors="raise")
    if not np.isfinite(X_raw.to_numpy()).all() or (X_raw.to_numpy() < 0).any():
        raise ValueError("Abundance matrix must be finite and non-negative")
    return X_raw, metadata


def verify_cohorts(metadata: pd.DataFrame) -> dict[str, dict[str, int]]:
    counts = pd.crosstab(metadata["study_name"], metadata["CRC"])
    observed = {
        str(cohort): (int(counts.loc[cohort, 0]), int(counts.loc[cohort, 1]))
        for cohort in counts.index
    }
    if observed != EXPECTED_COHORT_COUNTS:
        raise ValueError(
            f"Cohort counts differ from the brief.\nexpected={EXPECTED_COHORT_COUNTS}\nobserved={observed}"
        )
    return {
        cohort: {"control": ctrl, "crc": crc, "total": ctrl + crc}
        for cohort, (ctrl, crc) in observed.items()
    }


def preprocess(X_raw: pd.DataFrame, mode: str) -> pd.DataFrame:
    if mode == "shapmat-default":
        # Same call SHAPMAT's tutorial makes: filter fit on the full table.
        return ab_filter(X_raw, **SHAPMAT_DEFAULTS)
    return X_raw.copy()


# ---------------------------------------------------------------------------
# Model and SHAP
# ---------------------------------------------------------------------------
def evaluate(model: RandomForestClassifier, X: pd.DataFrame, y: pd.Series) -> dict[str, float]:
    proba = model.predict_proba(X)[:, 1]
    pred = model.predict(X)
    return {
        "roc_auc": float(roc_auc_score(y, proba)),
        "accuracy": float(accuracy_score(y, pred)),
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "f1": float(f1_score(y, pred, zero_division=0)),
    }


def class1_values(values: Any, n: int, p: int) -> np.ndarray:
    """Normalise shap's RF output (list of 2 or (n, p, 2)) to the CRC class."""
    if isinstance(values, list):
        values = values[1]
    array = np.asarray(values)
    if array.shape == (n, p, 2):
        array = array[:, :, 1]
    if array.shape != (n, p):
        raise ValueError(f"Unexpected SHAP shape {array.shape}, expected {(n, p)}")
    return array


def class1_expected(explainer: shap.TreeExplainer) -> float:
    return float(np.atleast_1d(explainer.expected_value)[-1])


def beeswarm(values: np.ndarray, X: pd.DataFrame, path: Path, title: str) -> None:
    explanation = shap.Explanation(
        values=values, data=X.to_numpy(), feature_names=X.columns.tolist()
    )
    plt.figure(figsize=(11, 8))
    shap.plots.beeswarm(explanation, max_display=20, show=False)
    plt.title(title)
    plt.tight_layout()
    plt.savefig(path, dpi=200, bbox_inches="tight")
    plt.close()


def verify_registered_model(
    name: str, version: str, model: RandomForestClassifier, X_test: pd.DataFrame, exported: pd.DataFrame
) -> float:
    """Load ``models:/name/version`` and check predict + shap_explain against the local model."""
    loaded = mlflow.pyfunc.load_model(f"models:/{name}/{version}")
    features = exported.drop(columns=["sample_id"])
    served = loaded.predict(features)
    local_proba = model.predict_proba(X_test)[:, 1]
    if not np.allclose(served["Y_proba"].to_numpy(), local_proba, atol=1e-9):
        raise RuntimeError("Registered model predictions differ from the local model")
    explained = loaded._model_impl.python_model.shap_explain(features.head(5))
    values = np.asarray(explained["values"])
    base = np.asarray(explained["base_values"])
    # base_values is () / (2,) / (n, 2) depending on the explainer; take the CRC class.
    served_base = float(np.atleast_2d(base)[0, -1])
    if values.shape[:2] != (5, X_test.shape[1]):
        raise RuntimeError(f"Unexpected served SHAP shape {values.shape}")
    print(
        f"registry check: {name} v{version} predictions match the local model on {len(features)} rows; "
        f"shap_explain values={values.shape} base_values={base.shape} base[CRC]={served_base:.4f}"
    )
    return served_base


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.sample_data_dir.mkdir(parents=True, exist_ok=True)

    # 1. Data + preprocessing ------------------------------------------------
    source = acquire_upstream(args.checkout_dir)
    if args.preprocessing == "notebook-raw":
        data_path = Path(args.checkout_dir).resolve() / "shapmat_paper" / NOTEBOOK_DATA
        data_sha256 = sha256_file(data_path)
        X_raw, metadata = load_table(data_path, NOTEBOOK_METADATA_COLUMNS)
    else:
        data_path, data_sha256 = source.data_path, source.sha256
        X_raw, metadata = load_table(data_path)
    cohort_counts = verify_cohorts(metadata)
    X = preprocess(X_raw, args.preprocessing)
    y = metadata["CRC"]
    print(f"data: {data_path} sha256={data_sha256}")
    print(f"cohorts verified: {json.dumps(cohort_counts, sort_keys=True)}")
    print(f"preprocessing={args.preprocessing} features: {X_raw.shape[1]} -> {X.shape[1]}")
    print("label encoding: CRC=1, control=0 (source column 'CRC')")

    # 2. Split + train --------------------------------------------------------
    is_test = metadata["study_name"] == TEST_COHORT
    is_train = metadata["study_name"].isin(TRAIN_COHORTS)
    if (is_test & is_train).any() or not (is_test | is_train).all():
        raise ValueError("Train/test cohorts must partition the dataset")
    X_train, y_train = X[is_train], y[is_train]
    X_test, y_test = X[is_test], y[is_test]
    if len(X_train) != 471 or len(X_test) != 331:
        raise ValueError(f"Unexpected split sizes train={len(X_train)} test={len(X_test)}")
    if set(X_train.index) & set(X_test.index):
        raise ValueError("Sample leakage between train and test")
    print(f"train={len(X_train)} ({', '.join(TRAIN_COHORTS)}) test={len(X_test)} ({TEST_COHORT})")

    model = RandomForestClassifier(
        n_estimators=args.n_estimators,
        max_depth=None,
        random_state=0,
        class_weight=None,
        n_jobs=args.n_jobs,
    ).fit(X_train, y_train)
    fitted_params = {key: model.get_params()[key] for key in RF_PARAM_KEYS}
    metrics = evaluate(model, X_test, y_test)
    print("test metrics (YachidaS_2019):")
    for name, value in metrics.items():
        print(f"  {name:>9s} = {value:.3f}")
    auc_ok = AUC_GUARD[0] <= metrics["roc_auc"] <= AUC_GUARD[1]

    # 3. SHAP -----------------------------------------------------------------
    # Both conventions are always computed; ``--explainer`` picks the one that is
    # logged to the platform and reported as primary.
    explainer_pd = shap.TreeExplainer(model)
    shap_pd = class1_values(explainer_pd.shap_values(X_test), len(X_test), X_test.shape[1])
    explainer_tb = shap.TreeExplainer(model, data=X_test)
    shap_tb = class1_values(
        explainer_tb.shap_values(X_test, check_additivity=False), len(X_test), X_test.shape[1]
    )
    conventions = {
        "path-dependent": ("shap.TreeExplainer(model)", "none", explainer_pd, shap_pd),
        "test-background": (
            "shap.TreeExplainer(model, data=X_test)",
            "X_test (YachidaS_2019, 331 rows)",
            explainer_tb,
            shap_tb,
        ),
    }
    explainer_label, background_label, explainer, shap_test = conventions[args.explainer]
    expected_value = class1_expected(explainer)
    mean_abs = pd.Series(np.abs(shap_test).mean(axis=0), index=X_test.columns, name="mean_abs_shap")
    ranking = mean_abs.sort_values(ascending=False)
    top10 = ranking.head(10)
    nonzero_features = int((mean_abs != 0).sum())
    other = "test-background" if args.explainer == "path-dependent" else "path-dependent"
    other_label, _, other_explainer, other_shap = conventions[other]
    expected_value_other = class1_expected(other_explainer)
    nonzero_features_other = int((np.abs(other_shap).mean(axis=0) != 0).sum())

    print(
        f"logged explainer: {explainer_label} (feature_perturbation="
        f"{explainer.feature_perturbation}, background={background_label})"
    )
    print(f"expected_value[CRC] = {expected_value:.4f} (paper reference 0.53)")
    print(f"non-zero mean(|SHAP|) features = {nonzero_features}/{X_test.shape[1]} (paper reference 549)")
    print(
        f"other convention {other_label}: expected_value[CRC] = {expected_value_other:.4f}, "
        f"non-zero mean(|SHAP|) features = {nonzero_features_other}/{X_test.shape[1]}"
    )
    print("top-10 features by mean(|SHAP|) on TEST:")
    for rank, (feature, value) in enumerate(top10.items(), start=1):
        print(f"  {rank:2d}. {feature}  {value:.5f}")

    beeswarm_path = args.output_dir / "shap_beeswarm.png"
    beeswarm(shap_test, X_test, beeswarm_path, f"YachidaS_2019 test, {explainer_label}, CRC class")
    top10_path = args.output_dir / "top10_shap.txt"
    top10_path.write_text(
        "\n".join(f"{rank}\t{feature}\t{value:.6f}" for rank, (feature, value) in enumerate(top10.items(), 1))
        + "\n"
    )
    ranking.rename_axis("feature").reset_index().to_csv(args.output_dir / "mean_abs_shap.csv", index=False)

    # 4. Export TEST set --------------------------------------------------------
    test_csv = args.sample_data_dir / "yachidas_2019_test.csv"
    labels_csv = args.sample_data_dir / "yachidas_2019_test_labels.csv"
    X_test.rename_axis("sample_id").reset_index().to_csv(test_csv, index=False)
    y_test.rename("label").rename_axis("sample_id").reset_index().to_csv(labels_csv, index=False)
    exported = pd.read_csv(test_csv)
    if exported.columns[0] != "sample_id" or list(exported.columns[1:]) != list(X_test.columns):
        raise ValueError("Exported test CSV does not match the model feature schema")
    missing_ids = [sid for sid in REQUIRED_TEST_IDS if sid not in set(exported["sample_id"])]
    if missing_ids:
        raise ValueError(f"Required sample IDs missing from export: {missing_ids}")
    print(f"exported {test_csv} ({exported.shape[0]} rows, {exported.shape[1] - 1} features) and {labels_csv}")
    print(f"required IDs present: {list(REQUIRED_TEST_IDS)}")

    summary: dict[str, Any] = {
        "registered_name": args.registered_name,
        "preprocessing": args.preprocessing,
        "filter": SHAPMAT_DEFAULTS if args.preprocessing == "shapmat-default" else None,
        "rf_params": fitted_params,
        "versions": {
            "python": platform.python_version(),
            "scikit-learn": sklearn.__version__,
            "shap": shap.__version__,
            "mlflow": mlflow.__version__,
            "numpy": np.__version__,
            "pandas": pd.__version__,
        },
        "data": {
            "path": str(data_path),
            "sha256": data_sha256,
            "shapmat_commit": source.shapmat_commit,
            "paper_commit": source.paper_commit,
            "cohort_counts": cohort_counts,
        },
        "features_raw": int(X_raw.shape[1]),
        "features": int(X.shape[1]),
        "train_cohorts": list(TRAIN_COHORTS),
        "test_cohort": TEST_COHORT,
        "train_samples": int(len(X_train)),
        "test_samples": int(len(X_test)),
        "metrics": metrics,
        "auc_within_guard": auc_ok,
        "shap": {
            "explainer": explainer_label,
            "background": background_label,
            "feature_perturbation": explainer.feature_perturbation,
            "expected_value_crc": expected_value,
            "nonzero_mean_abs_shap_features": nonzero_features,
            "top10_mean_abs_shap": [
                {"rank": i, "feature": f, "mean_abs_shap": float(v)}
                for i, (f, v) in enumerate(top10.items(), 1)
            ],
            "other_convention": {
                "explainer": other_label,
                "expected_value_crc": expected_value_other,
                "nonzero_mean_abs_shap_features": nonzero_features_other,
            },
        },
        "paper_reference": PAPER_REFERENCE,
        "exports": {"test_csv": str(test_csv), "labels_csv": str(labels_csv)},
    }
    summary_path = args.output_dir / "summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")

    if not auc_ok:
        print(
            f"STOP: test AUC {metrics['roc_auc']:.3f} is outside {AUC_GUARD}; "
            "check for YachidaS leakage. Not registering."
        )
        return 3
    if args.skip_registration:
        print("registration skipped (--skip-registration)")
        return 0

    mlflow.set_tracking_uri(args.tracking_uri)
    client = MlflowClient()
    if args.verify_version is not None:
        version = str(args.verify_version)
        mv = client.get_model_version(args.registered_name, version)
        served_base = verify_registered_model(args.registered_name, version, model, X_test, exported)
        registration = {
            "registered_name": args.registered_name,
            "version": version,
            "stage": mv.current_stage,
            "run_id": mv.run_id,
            "experiment_name": args.experiment_name,
            "tracking_uri": args.tracking_uri,
            "production_versions": production_snapshot(client),
            "served_base_value_crc": served_base,
            "verified_by": "--verify-version",
        }
        (args.output_dir / "registration.json").write_text(json.dumps(registration, indent=2, sort_keys=True) + "\n")
        summary["registration"] = {k: registration[k] for k in ("version", "stage", "run_id")}
        summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")
        print(f"verified {args.registered_name} version {version} stage={mv.current_stage} run_id={mv.run_id}")
        return 0

    # 5. MLflow run + registration -----------------------------------------------
    mlflow.set_experiment(args.experiment_name)
    production_before = production_snapshot(client)
    with mlflow.start_run(run_name=f"{args.registered_name}-rf{args.n_estimators}") as run:
        mlflow.set_tags(
            {
                "workflow": "rynazal-lodo-yachida",
                "paper": "Rynazal et al. 2023 Genome Biology 24:21 Fig.1/Fig.2",
                "dataset_sha256": data_sha256,
                "dataset_path": str(data_path),
                "source_commit": source.shapmat_commit,
                "paper_commit": source.paper_commit,
                "split": "leave-one-dataset-out; test=YachidaS_2019",
                "shap_explainer": f"{explainer_label}; background={background_label}",
            }
        )
        mlflow.set_tag(
            "mlflow.note.content",
            "RF(500, max_depth=None, random_state=0, class_weight=None) trained on "
            f"{', '.join(TRAIN_COHORTS)} ({len(X_train)}), evaluated on {TEST_COHORT} "
            f"({len(X_test)}); preprocessing={args.preprocessing}; {X_raw.shape[1]}->{X.shape[1]} features; "
            f"SHAP = {explainer_label} on the test set.",
        )
        mlflow.log_params(
            {
                **fitted_params,
                "model_type": "RandomForest",
                "preprocessing": args.preprocessing,
                "abundance_threshold": SHAPMAT_DEFAULTS["abundance_threshold"] if args.preprocessing == "shapmat-default" else "none",
                "prevalence_threshold": SHAPMAT_DEFAULTS["prevalence_threshold"] if args.preprocessing == "shapmat-default" else "none",
                "features_raw": X_raw.shape[1],
                "features": X.shape[1],
                "dataset_file": data_path.name,
                "train_cohorts": "+".join(TRAIN_COHORTS),
                "test_cohort": TEST_COHORT,
                "train_samples": len(X_train),
                "test_samples": len(X_test),
                "shap_explainer": explainer_label,
                "shap_background": background_label,
                "shap_feature_perturbation": explainer.feature_perturbation,
                "sklearn_version": sklearn.__version__,
                "shap_version": shap.__version__,
            }
        )
        mlflow.log_metrics(
            {
                **metrics,
                "shap_expected_value_crc": expected_value,
                "shap_expected_value_crc_path_dependent": class1_expected(explainer_pd),
                "shap_expected_value_crc_test_background": class1_expected(explainer_tb),
                "shap_nonzero_features": nonzero_features,
            }
        )
        mlflow.log_artifact(str(top10_path))
        mlflow.log_artifacts(str(args.output_dir), artifact_path="rynazal_lodo_yachida_results")
        mlflow.log_artifact(str(test_csv), artifact_path="test_set")
        mlflow.log_artifact(str(labels_csv), artifact_path="test_set")
        for name, frame, target, context in (
            ("curatedCRC-train-4-cohorts", X_train.join(y_train), "CRC", "training"),
            ("curatedCRC-test-YachidaS_2019", X_test.join(y_test), "CRC", "evaluation"),
        ):
            mlflow.log_input(mlflow.data.from_pandas(frame, name=name, targets=target), context=context)

        info = log_explainable_model(
            model=model,
            background=X_train,
            registered_name=args.registered_name,
            explainer=explainer,
            extra_artifacts={"top10_shap": str(top10_path), "shap_beeswarm": str(beeswarm_path)},
        )
        run_id = run.info.run_id

    version = getattr(info, "registered_model_version", None)
    if version is None:
        matches = [
            v for v in client.search_model_versions(f"name = '{args.registered_name}'")
            if v.run_id == run_id
        ]
        if len(matches) != 1:
            raise RuntimeError(f"Could not resolve the new model version for run {run_id}")
        version = matches[0].version
    version = str(version)
    client.transition_model_version_stage(
        name=args.registered_name, version=version, stage="Staging", archive_existing_versions=True
    )
    production_after = production_snapshot(client)
    if production_after != production_before:
        raise RuntimeError("Production model state changed during registration; investigate")
    with mlflow.start_run(run_id=run_id):
        mlflow.set_tags(
            {
                "registered_model_name": args.registered_name,
                "registered_model_version": version,
                "registered_model_stage": "Staging",
            }
        )

    # 6. Load back from the registry and check the served contract -----------------
    served_base = verify_registered_model(args.registered_name, version, model, X_test, exported)

    registration = {
        "registered_name": args.registered_name,
        "version": version,
        "stage": "Staging",
        "run_id": run_id,
        "experiment_name": args.experiment_name,
        "tracking_uri": args.tracking_uri,
        "production_unchanged": production_before == production_after,
        "production_before": production_before,
        "production_after": production_after,
        "served_base_value_crc": served_base,
    }
    (args.output_dir / "registration.json").write_text(json.dumps(registration, indent=2, sort_keys=True) + "\n")
    summary["registration"] = {k: registration[k] for k in ("version", "stage", "run_id", "production_unchanged")}
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")

    # 7. Deliverables -----------------------------------------------------------------
    print("\n=== Deliverables ===")
    print(f"RF params: {fitted_params}")
    print(f"versions: scikit-learn={sklearn.__version__} shap={shap.__version__} mlflow={mlflow.__version__} python={platform.python_version()}")
    print(f"raw feature count: {X_raw.shape[1]} ({data_path.name}); features used by the model: {X.shape[1]} ({args.preprocessing})")
    print(f"non-zero mean(|SHAP|) features on TEST: {nonzero_features}/{X.shape[1]} (paper: 549)")
    print("test metrics: " + ", ".join(f"{k}={v:.3f}" for k, v in metrics.items()))
    print(f"logged explainer: {explainer_label}; background={background_label}; expected_value[CRC]={expected_value:.4f}")
    print(f"other convention {other_label}: expected_value[CRC]={expected_value_other:.4f}")
    print("top-10 mean(|SHAP|): " + ", ".join(f"{i}.{f}" for i, f in enumerate(top10.index, 1)))
    print(f"MLflow: run_id={run_id} registered={args.registered_name} version={version} stage=Staging")
    print(f"production_unchanged={production_before == production_after}")
    print(f"exports: {test_csv}, {labels_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
