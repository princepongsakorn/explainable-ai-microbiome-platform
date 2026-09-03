"""Track A: Hyperopt tuning, MLflow logging, and safe model registration."""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import mlflow
import numpy as np
import pandas as pd
from hyperopt import STATUS_OK, Trials, fmin, hp, tpe
from mlflow.tracking import MlflowClient
from mlflow_explainable import log_explainable_model
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split

from .data import PreparedDataset


DEFAULT_TRACKING_URI = "http://35.225.129.127:5000"
DEFAULT_EXPERIMENT_NAME = "crc-curatedcrc-rf"
DEFAULT_REGISTERED_NAME = "crc-curatedcrc-rf"
PROTECTED_MODEL_NAMES = frozenset({"sample-rf-crc", "ryza-rynazal-crc"})
REQUIRED_METRICS = ("roc_auc", "accuracy", "precision", "recall", "f1")


@dataclass(frozen=True)
class HoldoutSplit:
    X_train: pd.DataFrame
    X_test: pd.DataFrame
    y_train: pd.Series
    y_test: pd.Series


@dataclass(frozen=True)
class TrialResult:
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
    production_before: dict[str, dict[str, Any]]
    production_after: dict[str, dict[str, Any]]


def make_holdout(
    prepared: PreparedDataset,
    *,
    test_size: float = 0.2,
    random_state: int = 42,
) -> HoldoutSplit:
    y = prepared.metadata.loc[prepared.X.index, "CRC"]
    X_train, X_test, y_train, y_test = train_test_split(
        prepared.X,
        y,
        test_size=test_size,
        random_state=random_state,
        stratify=y,
    )
    return HoldoutSplit(X_train, X_test, y_train, y_test)


def evaluate_model(
    model: RandomForestClassifier,
    X_test: pd.DataFrame,
    y_test: pd.Series,
) -> dict[str, float]:
    prediction = model.predict(X_test)
    probability = model.predict_proba(X_test)[:, 1]
    return {
        "roc_auc": float(roc_auc_score(y_test, probability)),
        "accuracy": float(accuracy_score(y_test, prediction)),
        "precision": float(precision_score(y_test, prediction, zero_division=0)),
        "recall": float(recall_score(y_test, prediction, zero_division=0)),
        "f1": float(f1_score(y_test, prediction, zero_division=0)),
    }


def search_space() -> dict[str, Any]:
    return {
        "n_estimators": hp.quniform("n_estimators", 50, 1000, 50),
        "max_depth": hp.choice("max_depth", [10, 20, 50, 100, None]),
        "min_samples_leaf": hp.quniform("min_samples_leaf", 1, 5, 1),
        "min_samples_split": hp.quniform("min_samples_split", 2, 6, 1),
        "class_weight": hp.choice("class_weight", [None, "balanced"]),
        "max_features": hp.choice("max_features", ["sqrt", "log2", None]),
    }


def _coerce_params(params: dict[str, Any]) -> dict[str, Any]:
    result = dict(params)
    for key in ("n_estimators", "min_samples_leaf", "min_samples_split"):
        result[key] = int(result[key])
    return result


def _provenance_tags(prepared: PreparedDataset, workflow_id: str) -> dict[str, str]:
    return {
        "workflow": "curatedcrc-track-a",
        "workflow_id": workflow_id,
        "dataset_sha256": str(prepared.provenance["sha256"]),
        "source_commit": str(prepared.provenance["source_commit"]),
        "paper_commit": str(prepared.provenance["paper_commit"]),
        "split": "stratified-80-20-random_state-42",
        "selection_metric": "roc_auc",
    }


def run_hyperopt(
    prepared: PreparedDataset,
    *,
    tracking_uri: str = DEFAULT_TRACKING_URI,
    experiment_name: str = DEFAULT_EXPERIMENT_NAME,
    max_evals: int = 50,
    random_state: int = 0,
) -> tuple[TrialResult, HoldoutSplit, list[TrialResult]]:
    if max_evals < 1:
        raise ValueError("max_evals must be positive")
    mlflow.set_tracking_uri(tracking_uri)
    mlflow.set_experiment(experiment_name)
    split = make_holdout(prepared)
    workflow_id = uuid.uuid4().hex
    trial_results: list[TrialResult] = []

    def objective(raw_params: dict[str, Any]) -> dict[str, Any]:
        params = _coerce_params(raw_params)
        trial_number = len(trial_results) + 1
        with mlflow.start_run(run_name=f"curatedcrc-trial-{trial_number:02d}") as run:
            mlflow.set_tags(_provenance_tags(prepared, workflow_id))
            mlflow.set_tag(
                "mlflow.note.content",
                "802-sample curatedCRC RF tuning; SHAPMAT ab_filter(1e-5, 0.9); "
                f"{prepared.raw_feature_count}->{prepared.filtered_feature_count} features.",
            )
            mlflow.log_params(
                {
                    **params,
                    "random_state": 0,
                    "model_type": "RandomForest",
                    "samples": len(prepared.X),
                    "features_bacteria_raw": prepared.raw_feature_count,
                    "features_bacteria": prepared.filtered_feature_count,
                    "abundance_threshold": prepared.provenance["abundance_threshold"],
                    "prevalence_threshold": prepared.provenance["prevalence_threshold"],
                }
            )
            model = RandomForestClassifier(**params, random_state=0, n_jobs=-1)
            model.fit(split.X_train, split.y_train)
            metrics = evaluate_model(model, split.X_test, split.y_test)
            mlflow.log_metrics(metrics)
            result = TrialResult(run.info.run_id, model, params, metrics, workflow_id)
            trial_results.append(result)
            print(
                f"trial={trial_number:02d}/{max_evals} run_id={run.info.run_id} "
                f"roc_auc={metrics['roc_auc']:.4f} accuracy={metrics['accuracy']:.4f}"
            )
            return {"loss": -metrics["roc_auc"], "status": STATUS_OK}

    fmin(
        fn=objective,
        space=search_space(),
        algo=tpe.suggest,
        max_evals=max_evals,
        trials=Trials(),
        rstate=np.random.default_rng(random_state),
    )
    best = max(trial_results, key=lambda item: item.metrics["roc_auc"])
    with mlflow.start_run(run_id=best.run_id):
        mlflow.set_tag("selection_status", "best")
        mlflow.set_tag("selection_metric", "roc_auc")
    return best, split, trial_results


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


def register_best_model(
    best: TrialResult,
    split: HoldoutSplit,
    *,
    registered_name: str = DEFAULT_REGISTERED_NAME,
    explainer: Any | None = None,
    extra_artifacts: dict[str, str] | None = None,
) -> RegistrationResult:
    if registered_name in PROTECTED_MODEL_NAMES:
        raise ValueError(f"Refusing protected registered model name: {registered_name}")
    client = MlflowClient()
    before = production_snapshot(client)
    with mlflow.start_run(run_id=best.run_id):
        info = log_explainable_model(
            model=best.model,
            background=split.X_train,
            registered_name=registered_name,
            explainer=explainer,
            extra_artifacts=extra_artifacts,
        )
    version = _resolve_version(info, client, registered_name, best.run_id)
    client.transition_model_version_stage(
        name=registered_name,
        version=version,
        stage="Staging",
        archive_existing_versions=False,
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
        production_before=before,
        production_after=after,
    )


def save_best_run(
    best: TrialResult,
    split: HoldoutSplit,
    destination: Path,
) -> None:
    payload = {
        "workflow_id": best.workflow_id,
        "best_run_id": best.run_id,
        "selection_metric": "roc_auc",
        "params": best.params,
        "metrics": best.metrics,
        "train_samples": len(split.X_train),
        "test_samples": len(split.X_test),
    }
    Path(destination).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
