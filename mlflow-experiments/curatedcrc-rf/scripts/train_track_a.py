#!/usr/bin/env python3
"""Tune curatedCRC RF models and register only the best run as Staging."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import mlflow


EXPERIMENT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EXPERIMENT_ROOT))

from curatedcrc import acquire_upstream, prepare_dataset  # noqa: E402
from curatedcrc.shap_report import create_shap_report  # noqa: E402
from curatedcrc.train import (  # noqa: E402
    DEFAULT_EXPERIMENT_NAME,
    DEFAULT_REGISTERED_NAME,
    DEFAULT_TRACKING_URI,
    register_best_model,
    run_hyperopt,
    save_best_run,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout-dir", type=Path, default=EXPERIMENT_ROOT / ".upstream")
    parser.add_argument(
        "--tracking-uri",
        default=os.environ.get("MLFLOW_TRACKING_URI", DEFAULT_TRACKING_URI),
    )
    parser.add_argument("--experiment-name", default=DEFAULT_EXPERIMENT_NAME)
    parser.add_argument("--registered-name", default=DEFAULT_REGISTERED_NAME)
    parser.add_argument("--max-evals", type=int, default=50)
    parser.add_argument("--output-dir", type=Path, default=EXPERIMENT_ROOT / "outputs")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    source = acquire_upstream(args.checkout_dir)
    prepared = prepare_dataset(source)
    (args.output_dir / "data_provenance.json").write_text(
        json.dumps(prepared.provenance, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )

    best, split, all_trials = run_hyperopt(
        prepared,
        tracking_uri=args.tracking_uri,
        experiment_name=args.experiment_name,
        max_evals=args.max_evals,
    )
    best_path = args.output_dir / "track_a_best_run.json"
    save_best_run(best, split, best_path)
    shap_report = create_shap_report(
        best.model,
        split.X_train,
        split.X_test,
        args.output_dir,
    )

    extra_artifacts = {
        "data_provenance": str(args.output_dir / "data_provenance.json"),
        "track_a_best_run": str(best_path),
        "shap_ranking": str(shap_report.ranking_path),
        "shap_summary": str(shap_report.summary_path),
        "shap_beeswarm": str(shap_report.beeswarm_path),
    }
    registration = register_best_model(
        best,
        split,
        registered_name=args.registered_name,
        explainer=shap_report.explainer,
        extra_artifacts=extra_artifacts,
    )
    registration_path = args.output_dir / "track_a_registration.json"
    registration_path.write_text(
        json.dumps(
            {
                "registered_name": registration.name,
                "version": registration.version,
                "stage": registration.stage,
                "production_unchanged": registration.production_before
                == registration.production_after,
                "production_before": registration.production_before,
                "production_after": registration.production_after,
            },
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )

    with mlflow.start_run(run_id=best.run_id):
        logged_dataset = prepared.X.join(prepared.metadata[["CRC"]])
        mlflow.log_input(
            mlflow.data.from_pandas(
                logged_dataset,
                source=(
                    "https://raw.githubusercontent.com/ryzary/shapmat/"
                    f"{source.shapmat_commit}/data/curatedCRC.csv"
                ),
                name="curatedCRC-802-filtered",
                targets="CRC",
            ),
            context="training-and-holdout",
        )
        mlflow.log_artifacts(str(args.output_dir), artifact_path="curatedcrc_results")
        mlflow.set_tag("registered_model_name", registration.name)
        mlflow.set_tag("registered_model_version", registration.version)
        mlflow.set_tag("registered_model_stage", registration.stage)
        mlflow.set_tag("shap_biomarker_status", shap_report.status)

    print(f"workflow_id={best.workflow_id} trials={len(all_trials)}")
    print(f"best_run_id={best.run_id}")
    print(f"best_metrics={json.dumps(best.metrics, sort_keys=True)}")
    print(f"registered={registration.name} version={registration.version} stage=Staging")
    print(f"production_unchanged={registration.production_before == registration.production_after}")
    print(f"shap_biomarker_status={shap_report.status} ranks={shap_report.biomarker_ranks}")
    return 0 if shap_report.status == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
