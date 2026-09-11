"""Track A: fixed-parameter reference training, MLflow logging, and safe registration."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import mlflow
import numpy as np
import pandas as pd
from mlflow.tracking import MlflowClient
from mlflow_explainable import log_explainable_model
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import RepeatedStratifiedKFold, cross_validate

from .data import PreparedDataset
from .evaluate import reference_model


DEFAULT_TRACKING_URI = "http://35.225.129.127:5000"
DEFAULT_EXPERIMENT_NAME = "crc-curatedcrc-rf"
DEFAULT_REGISTERED_NAME = "crc-curatedcrc-rf"
PROTECTED_MODEL_NAMES = frozenset({"sample-rf-crc", "ryza-rynazal-crc"})
REQUIRED_METRICS = ("roc_auc", "accuracy", "precision", "recall", "f1")
CV_SPLITS = 10
CV_REPEATS = 10
CV_RANDOM_STATE = 0


@dataclass(frozen=True)
class TrainedModel:
    run_id: str
    model: RandomForestClassifier
    params: dict[str, Any]
    metrics: dict[str, float]
    workflow_id: str


@dataclass(frozen=True)
class RegistrationResult:
    name: str
    version: str
    stage: str
    archived_versions: list[str]
    production_before: dict[str, dict[str, Any]]
    production_after: dict[str, dict[str, Any]]


def reference_params() -> dict[str, Any]:
    """The Rynazal comparison parameters, read off the shared reference model."""
    params = reference_model().get_params()
    return {
        "n_estimators": params["n_estimators"],
        "max_depth": params["max_depth"],
        "random_state": params["random_state"],
        "class_weight": params["class_weight"],
    }


def labels_for(prepared: PreparedDataset) -> pd.Series:
    return prepared.metadata.loc[prepared.X.index, "CRC"]


def cross_validated_metrics(
    prepared: PreparedDataset,
    *,
    n_splits: int = CV_SPLITS,
    n_repeats: int = CV_REPEATS,
    random_state: int = CV_RANDOM_STATE,
) -> dict[str, float]:
    """Pooled repeated stratified CV over all 802 samples with the fixed model."""
    splitter = RepeatedStratifiedKFold(
        n_splits=n_splits,
        n_repeats=n_repeats,
        random_state=random_state,
    )
    scores = cross_validate(
        reference_model(),
        prepared.X,
        labels_for(prepared),
        cv=splitter,
        scoring={name: name for name in REQUIRED_METRICS},
        n_jobs=1,
    )
    metrics: dict[str, float] = {}
    for name in REQUIRED_METRICS:
        fold_scores = scores[f"test_{name}"]
        metrics[name] = float(np.mean(fold_scores))
        metrics[f"{name}_std"] = float(np.std(fold_scores, ddof=0))
    metrics["cv_fits"] = float(len(scores[f"test_{REQUIRED_METRICS[0]}"]))
    return metrics


def paper_comparison_metrics(output_dir: Path) -> dict[str, float]:
    """Per-cohort CV and LODO AUCs from Track B, so one run carries every paper number."""
    output_dir = Path(output_dir)
    metrics: dict[str, float] = {}
    cohort_path = output_dir / "track_b_cohort_cv.csv"
    if cohort_path.is_file():
        cohort_table = pd.read_csv(cohort_path)
        for row in cohort_table.itertuples(index=False):
            metrics[f"cv10x10_auc_{row.evaluation_group}"] = float(row.mean_auc)
    lodo_path = output_dir / "track_b_lodo.csv"
    if lodo_path.is_file():
        lodo_table = pd.read_csv(lodo_path)
        for row in lodo_table.itertuples(index=False):
            metrics[f"lodo_auc_{row.held_out_cohort}"] = float(row.roc_auc)
        metrics["lodo_mean_auc"] = float(lodo_table["roc_auc"].mean())
    return metrics


def _provenance_tags(prepared: PreparedDataset, workflow_id: str) -> dict[str, str]:
    return {
        "workflow": "curatedcrc-track-a",
        "workflow_id": workflow_id,
        "dataset_sha256": str(prepared.provenance["sha256"]),
        "source_commit": str(prepared.provenance["source_commit"]),
        "paper_commit": str(prepared.provenance["paper_commit"]),
        "training_data": "full-802-no-holdout",
        "hyperparameter_search": "none-fixed-rynazal-parameters",
        "evaluation": f"pooled-{CV_SPLITS}-fold-{CV_REPEATS}-repeat-cv",
    }


def train_reference_model(
    prepared: PreparedDataset,
    *,
    tracking_uri: str = DEFAULT_TRACKING_URI,
    experiment_name: str = DEFAULT_EXPERIMENT_NAME,
    extra_metrics: dict[str, float] | None = None,
) -> TrainedModel:
    """Score the fixed model by repeated CV, then fit it on every sample."""
    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment(experiment_name)
    workflow_id = uuid.uuid4().hex
    params = reference_params()
    y = labels_for(prepared)

    with mlflow.start_run(run_name="curatedcrc-reference-rf-500") as run:
        mlflow.set_tags(_provenance_tags(prepared, workflow_id))
        mlflow.set_tag(
            "mlflow.note.content",
            "802-sample curatedCRC RF with Rynazal et al. parameters (no tuning); "
            "SHAPMAT ab_filter(1e-5, 0.9); "
            f"{prepared.raw_feature_count}->{prepared.filtered_feature_count} features. "
            "Metrics are pooled 10-fold x 10-repeat CV; the registered model is fit on all "
            "802 samples.",
        )
        mlflow.log_params(
            {
                **params,
                "model_type": "RandomForest",
                "parameter_source": "Rynazal et al. comparison protocol",
                "samples": len(prepared.X),
                "features_bacteria_raw": prepared.raw_feature_count,
                "features_bacteria": prepared.filtered_feature_count,
                "abundance_threshold": prepared.provenance["abundance_threshold"],
                "prevalence_threshold": prepared.provenance["prevalence_threshold"],
                "cv_splits": CV_SPLITS,
                "cv_repeats": CV_REPEATS,
                "cv_random_state": CV_RANDOM_STATE,
            }
        )
        print(
            f"cross-validating {CV_SPLITS}-fold x {CV_REPEATS}-repeat "
            f"({CV_SPLITS * CV_REPEATS} fits) on {len(prepared.X)} samples...",
            flush=True,
        )
        metrics = cross_validated_metrics(prepared)
        if extra_metrics:
            metrics.update(extra_metrics)
        mlflow.log_metrics(metrics)
        print("fitting the registered model on all samples...", flush=True)
        model = reference_model().fit(prepared.X, y)
        return TrainedModel(run.info.run_id, model, params, metrics, workflow_id)


def production_snapshot(client: MlflowClient) -> dict[str, dict[str, Any]]:
    snapshot: dict[str, dict[str, Any]] = {}
    for version in client.search_model_versions():
        if version.current_stage != "Production":
            continue
        run = client.get_run(version.run_id)
        key = f"{version.name}:{version.version}"
        snapshot[key] = {
            "name": version.name,
            "version": str(version.version),
            "run_id": version.run_id,
            "metrics": dict(sorted(run.data.metrics.items())),
        }
    return dict(sorted(snapshot.items()))


def _resolve_version(info: Any, client: MlflowClient, name: str, run_id: str) -> str:
    direct = getattr(info, "registered_model_version", None)
    if direct is not None:
        return str(direct)
    matches = [
        version
        for version in client.search_model_versions(f"name = '{name}'")
        if version.run_id == run_id
    ]
    if len(matches) != 1:
        raise RuntimeError(
            f"Could not resolve exactly one {name} model version for run {run_id}: {matches}"
        )
    return str(matches[0].version)


def register_model(
    trained: TrainedModel,
    background: pd.DataFrame,
    *,
    registered_name: str = DEFAULT_REGISTERED_NAME,
    explainer: Any | None = None,
    extra_artifacts: dict[str, str] | None = None,
) -> RegistrationResult:
    if registered_name in PROTECTED_MODEL_NAMES:
        raise ValueError(f"Refusing protected registered model name: {registered_name}")
    client = MlflowClient()
    before = production_snapshot(client)
    superseded = [
        str(version.version)
        for version in client.search_model_versions(f"name = '{registered_name}'")
        if version.current_stage == "Staging"
    ]
    with mlflow.start_run(run_id=trained.run_id):
        info = log_explainable_model(
            model=trained.model,
            background=background,
            registered_name=registered_name,
            explainer=explainer,
            extra_artifacts=extra_artifacts,
        )
    version = _resolve_version(info, client, registered_name, trained.run_id)
    client.transition_model_version_stage(
        name=registered_name,
        version=version,
        stage="Staging",
        archive_existing_versions=True,
    )
    after = production_snapshot(client)
    if after != before:
        raise RuntimeError(
            "Production model state changed during curatedCRC registration; "
            "manual investigation is required"
        )
    return RegistrationResult(
        name=registered_name,
        version=version,
        stage="Staging",
        archived_versions=sorted(item for item in superseded if item != version),
        production_before=before,
        production_after=after,
    )


def save_run_summary(
    trained: TrainedModel,
    prepared: PreparedDataset,
    destination: Path,
) -> None:
    payload = {
        "workflow_id": trained.workflow_id,
        "run_id": trained.run_id,
        "hyperparameter_search": "none",
        "parameter_source": "Rynazal et al. comparison protocol",
        "params": trained.params,
        "metrics": trained.metrics,
        "evaluation": f"pooled {CV_SPLITS}-fold x {CV_REPEATS}-repeat stratified CV",
        "training_samples": int(len(prepared.X)),
        "holdout_samples": 0,
    }
    Path(destination).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
