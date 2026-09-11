#!/usr/bin/env python3
"""Train the fixed Rynazal-parameter curatedCRC RF on all samples and register it."""

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
    paper_comparison_metrics,
    register_model,
    save_run_summary,
    train_reference_model,
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
    parser.add_argument("--output-dir", type=Path, default=EXPERIMENT_ROOT / "outputs")
    parser.add_argument(
        "--shap-background-size",
        type=int,
        default=0,
        help="Rows sampled as the SHAP background; 0 uses all samples.",
    )
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

    trained = train_reference_model(
        prepared,
        tracking_uri=args.tracking_uri,
        experiment_name=args.experiment_name,
        extra_metrics=paper_comparison_metrics(args.output_dir),
    )
    run_summary_path = args.output_dir / "track_a_model_run.json"
    save_run_summary(trained, prepared, run_summary_path)

    background = prepared.X
    if args.shap_background_size and args.shap_background_size < len(prepared.X):
        background = prepared.X.sample(
            n=args.shap_background_size,
            random_state=42,
        ).sort_index()
    print(
        f"computing SHAP for {len(prepared.X)} samples "
        f"against {len(background)} background rows...",
        flush=True,
    )
    shap_report = create_shap_report(
        trained.model,
        background,
        prepared.X,
        args.output_dir,
    )

    extra_artifacts = {
        "data_provenance": str(args.output_dir / "data_provenance.json"),
        "track_a_model_run": str(run_summary_path),
        "shap_ranking": str(shap_report.ranking_path),
        "shap_summary": str(shap_report.summary_path),
        "shap_beeswarm": str(shap_report.beeswarm_path),
    }
    registration = register_model(
        trained,
        background,
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
                "archived_versions": registration.archived_versions,
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

    with mlflow.start_run(run_id=trained.run_id):
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
            context="training",
        )
        mlflow.log_artifacts(str(args.output_dir), artifact_path="curatedcrc_results")
        mlflow.set_tag("registered_model_name", registration.name)
        mlflow.set_tag("registered_model_version", registration.version)
        mlflow.set_tag("registered_model_stage", registration.stage)
        mlflow.set_tag("shap_biomarker_status", shap_report.status)

    print(f"workflow_id={trained.workflow_id}")
    print(f"run_id={trained.run_id}")
    print(f"metrics={json.dumps(trained.metrics, sort_keys=True)}")
    print(f"registered={registration.name} version={registration.version} stage=Staging")
    print(f"archived_versions={registration.archived_versions}")
    print(f"production_unchanged={registration.production_before == registration.production_after}")
    print(f"shap_biomarker_status={shap_report.status} ranks={shap_report.biomarker_ranks}")
    return 0 if shap_report.status == "passed" else 2


if __name__ == "__main__":
    raise SystemExit(main())
