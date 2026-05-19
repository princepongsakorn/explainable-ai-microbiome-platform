#!/usr/bin/env python3
"""
MLflow GCP Deployment - Smoke Test (e2e, 4 stages)

ต้องรัน บน VM #1 (MLflow VM) เพราะ:
  - ใช้ compute SA OAuth scope ในการเขียน/อ่าน GCS (ตัวเดียวกับที่ MLflow proxy ใช้)
  - google-cloud-storage SDK จะใช้ Application Default Credentials = compute SA
  - = ทดสอบ identity จริงที่ deploy ใช้

Stages:
  1. log_param + log_metric → Postgres backend store
  2. log_artifact → MLflow server proxy upload to GCS
  3. google-cloud-storage SDK list blob → confirm artifact in bucket จริง (independent check)
  4. download_artifacts via proxy → round-trip content compare

Usage (บน VM):
    sudo /opt/mlflow/venv/bin/pip install google-cloud-storage
    sudo /opt/mlflow/venv/bin/python smoke_test.py
"""

import os
import sys
import tempfile
from datetime import datetime

# ---------- Config ----------
MLFLOW_URL = os.environ.get("MLFLOW_TRACKING_URI", "http://127.0.0.1:5000")
MLFLOW_USERNAME = os.environ.get("MLFLOW_TRACKING_USERNAME", "admin")
MLFLOW_PASSWORD = os.environ.get(
    "MLFLOW_TRACKING_PASSWORD",
    "BfKfqfQOwT3qpQyiB72oqDydvjAPrndz",
)
GCS_BUCKET = os.environ.get("GCS_BUCKET", "microbiome_xai_platform")
# Subpath under bucket where MLflow stores artifacts (matches --artifacts-destination)
GCS_ARTIFACTS_PREFIX = os.environ.get("GCS_ARTIFACTS_PREFIX", "mlflow-artifacts")
EXPERIMENT_NAME = os.environ.get("SMOKE_EXPERIMENT", "smoke-test-gcp")

# Auth must be set BEFORE importing mlflow
os.environ["MLFLOW_TRACKING_USERNAME"] = MLFLOW_USERNAME
os.environ["MLFLOW_TRACKING_PASSWORD"] = MLFLOW_PASSWORD

import mlflow  # noqa: E402
from mlflow.tracking import MlflowClient  # noqa: E402

try:
    from google.cloud import storage  # noqa: E402
except ImportError:
    print("ERROR: google-cloud-storage not installed.")
    print("Install with: sudo /opt/mlflow/venv/bin/pip install google-cloud-storage")
    sys.exit(2)


ARTIFACT_PAYLOAD = (
    f"smoke test artifact - {datetime.now().isoformat()}\n"
    f"random-token: {os.urandom(8).hex()}\n"
    "If you see this content roundtripped + in bucket, MLflow + GCS + scope ทุกชั้น OK\n"
)


def banner(text):
    print("\n" + "=" * 64)
    print(f"  {text}")
    print("=" * 64)


def setup():
    banner("SETUP")
    print(f"  MLflow URL    : {MLFLOW_URL}")
    print(f"  Auth user     : {MLFLOW_USERNAME}")
    print(f"  GCS bucket    : gs://{GCS_BUCKET}")
    print(f"  GCS prefix    : {GCS_ARTIFACTS_PREFIX or '(root)'}")
    print(f"  Experiment    : {EXPERIMENT_NAME}")
    mlflow.set_tracking_uri(MLFLOW_URL)
    mlflow.set_experiment(EXPERIMENT_NAME)


def run_test():
    banner("TEST RUN — single MLflow run covering all 4 stages")

    results = {1: False, 2: False, 3: False, 4: False}
    run_id = None
    experiment_id = None
    artifact_subpath = None

    try:
        with mlflow.start_run(run_name=f"smoke-{datetime.now().strftime('%H%M%S')}") as run:
            run_id = run.info.run_id
            experiment_id = run.info.experiment_id
            artifact_uri = run.info.artifact_uri
            print(f"  run_id        : {run_id}")
            print(f"  experiment_id : {experiment_id}")
            print(f"  artifact_uri  : {artifact_uri}")

            # ---------- STAGE 1: Postgres backend (params + metrics) ----------
            print("\n  [1/4] log_param + log_metric → Postgres backend")
            mlflow.log_param("test_type", "smoke_e2e")
            mlflow.log_param("timestamp", datetime.now().isoformat())
            mlflow.log_metric("dummy_accuracy", 0.95)
            mlflow.log_metric("dummy_loss", 0.12)

            client = MlflowClient()
            fetched = client.get_run(run_id)
            assert fetched.data.metrics["dummy_accuracy"] == 0.95
            assert fetched.data.params["test_type"] == "smoke_e2e"
            print("       PASS — Postgres readable, metrics/params match")
            results[1] = True

            # ---------- STAGE 2: log_artifact → GCS via MLflow proxy ----------
            print("\n  [2/4] log_artifact → GCS via MLflow proxy")
            with tempfile.TemporaryDirectory() as tmpdir:
                local_path = os.path.join(tmpdir, "smoke_artifact.txt")
                with open(local_path, "w") as f:
                    f.write(ARTIFACT_PAYLOAD)
                mlflow.log_artifact(local_path, artifact_path="smoke")
                artifact_subpath = "smoke/smoke_artifact.txt"

            artifacts = client.list_artifacts(run_id, path="smoke")
            if not artifacts:
                raise RuntimeError("list_artifacts returned empty after upload")
            for a in artifacts:
                print(f"       artifact: {a.path} ({a.file_size} bytes)")
            print("       PASS — MLflow proxy accepted upload, artifact listed")
            results[2] = True

        # ---------- STAGE 3: independent GCS verification ----------
        print("\n  [3/4] google-cloud-storage SDK → list bucket, confirm blob")
        gcs_client = storage.Client()
        bucket = gcs_client.bucket(GCS_BUCKET)
        # MLflow proxy with --artifacts-destination gs://bucket[/prefix] stores at:
        #   gs://bucket/[prefix/]{experiment_id}/{run_id}/artifacts/{path}
        prefix_part = f"{GCS_ARTIFACTS_PREFIX.strip('/')}/" if GCS_ARTIFACTS_PREFIX else ""
        expected_blob = f"{prefix_part}{experiment_id}/{run_id}/artifacts/{artifact_subpath}"
        blob = bucket.blob(expected_blob)
        if not blob.exists():
            # Fallback: list and search both with/without prefix
            print(f"       expected blob not found at: {expected_blob}")
            print(f"       listing bucket to debug...")
            list_prefix = f"{prefix_part}{experiment_id}/{run_id}/"
            for b in gcs_client.list_blobs(GCS_BUCKET, prefix=list_prefix):
                print(f"         found: gs://{GCS_BUCKET}/{b.name} ({b.size} bytes)")
            # Also try without prefix in case GCS_ARTIFACTS_PREFIX is misconfigured
            for b in gcs_client.list_blobs(GCS_BUCKET, prefix=f"{experiment_id}/{run_id}/"):
                print(f"         found (no prefix): gs://{GCS_BUCKET}/{b.name}")
            raise RuntimeError("artifact NOT in GCS at expected path — check GCS_ARTIFACTS_PREFIX env")
        blob.reload()
        print(f"       blob          : gs://{GCS_BUCKET}/{expected_blob}")
        print(f"       size          : {blob.size} bytes")
        print(f"       updated       : {blob.updated}")
        print("       PASS — GCS SDK confirms blob exists in bucket (independent of MLflow)")
        results[3] = True

        # ---------- STAGE 4: round-trip download via MLflow proxy ----------
        print("\n  [4/4] download_artifacts via proxy → content compare")
        with tempfile.TemporaryDirectory() as tmpdir:
            downloaded = mlflow.artifacts.download_artifacts(
                run_id=run_id,
                artifact_path=artifact_subpath,
                dst_path=tmpdir,
            )
            with open(downloaded) as f:
                roundtripped = f.read()
            if roundtripped != ARTIFACT_PAYLOAD:
                raise RuntimeError(
                    f"content mismatch:\n  uploaded  : {ARTIFACT_PAYLOAD!r}\n  downloaded: {roundtripped!r}"
                )
        print(f"       downloaded    : {downloaded}")
        print(f"       content match : {len(roundtripped)} bytes")
        print("       PASS — MLflow proxy can download artifact back, content identical")
        results[4] = True

    except Exception as e:
        print(f"\n  EXCEPTION: {type(e).__name__}: {e}")
        msg = str(e).lower()
        if "scope" in msg or "permission" in msg or "forbidden" in msg or "500" in msg:
            print("  hint: ตรวจ VM OAuth scope = cloud-platform บน MLflow VM")
            print("        และ bucket IAM = roles/storage.objectAdmin บน compute SA")

    # ---------- Summary ----------
    banner("SUMMARY")
    stages = {
        1: "Postgres backend (params + metrics)",
        2: "MLflow proxy → GCS (log_artifact)",
        3: "GCS SDK independent verify (blob exists)",
        4: "Round-trip download (content match)",
    }
    all_pass = True
    for n, label in stages.items():
        mark = "PASS" if results[n] else "FAIL"
        print(f"  Stage {n} : {mark:<6} {label}")
        all_pass = all_pass and results[n]
    print("=" * 64)
    if run_id:
        print(f"  run_id        : {run_id}")
        print(f"  view in UI    : {MLFLOW_URL}/#/experiments/{experiment_id}/runs/{run_id}")
    print("=" * 64)
    sys.exit(0 if all_pass else 1)


if __name__ == "__main__":
    setup()
    run_test()
