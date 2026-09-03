"""Nuclear cleanup of MLflow state for sample-rf-crc + sample-gcn-crc.

What this deletes (idempotent — safe to re-run):
    1. All versions of registered models sample-rf-crc, sample-gcn-crc
       (transitions Production/Staging to None first since MLflow rejects
       deletion of staged versions)
    2. The registered models themselves
    3. The experiments (renamed first so new experiments can re-use the names)

What this does NOT delete:
    * Artifacts in GCS/S3/local file store — MLflow soft-deletes the DB rows
      only. Run ``mlflow gc`` on the tracking server side to purge artifact
      bytes. Without that, storage keeps growing.

Usage::

    export MLFLOW_TRACKING_USERNAME=...
    export MLFLOW_TRACKING_PASSWORD=...
    python cleanup_mlflow.py
"""

import os
import time

import mlflow
from mlflow import MlflowClient
from mlflow.exceptions import MlflowException

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
TRACKING_URI = "http://35.225.129.127:5000"
TARGETS = ["sample-gcn-crc", "smoke-test-gcp", "_smoke_test_e2e", "_smoke_test"]

# Read from env to avoid committing creds. Falls back to the values used in
# model.py so you can run this without exporting if you really want.
os.environ.setdefault(
    "MLFLOW_TRACKING_USERNAME", "b881211d-796e-4b12-8621-6246d2eeadce"
)
os.environ.setdefault(
    "MLFLOW_TRACKING_PASSWORD", "k7uLbDEGc6beQlAWTCUJAUAmJskdr5bLUDmsiCG4"
)
mlflow.set_tracking_uri(TRACKING_URI)
client = MlflowClient()


def _cleanup_registered_model(name: str) -> None:
    """Delete every version of ``name``, then delete the registered model."""
    print(f"\n[registered model] {name}")
    try:
        versions = client.search_model_versions(f"name='{name}'")
    except MlflowException as e:
        print(f"  search_model_versions failed: {e}")
        return

    if not versions:
        print("  no versions found")
    for v in versions:
        try:
            if v.current_stage in ("Production", "Staging"):
                client.transition_model_version_stage(name, v.version, "None")
            client.delete_model_version(name, v.version)
            print(f"  deleted version {v.version} (was stage={v.current_stage})")
        except MlflowException as e:
            print(f"  ! failed version {v.version}: {e}")

    try:
        client.delete_registered_model(name)
        print(f"  deleted registered model: {name}")
    except MlflowException as e:
        # "Registered Model with name=... not found" → already gone, ok.
        msg = str(e)
        if "not found" in msg.lower():
            print(f"  registered model already absent")
        else:
            print(f"  ! delete_registered_model: {e}")


def _cleanup_experiment(name: str) -> None:
    """Rename the experiment with a timestamp suffix (so the name frees up)
    then soft-delete it."""
    print(f"\n[experiment] {name}")
    exp = client.get_experiment_by_name(name)
    if exp is None:
        print("  experiment not found (or already deleted)")
        return

    # Rename before delete so model.py can mlflow.set_experiment(name) cleanly.
    new_name = f"{name}-deleted-{int(time.time())}"
    try:
        client.rename_experiment(exp.experiment_id, new_name)
        print(f"  renamed: {name} -> {new_name}")
    except MlflowException as e:
        print(f"  ! rename failed: {e}")

    try:
        client.delete_experiment(exp.experiment_id)
        print(f"  deleted experiment id={exp.experiment_id}")
    except MlflowException as e:
        print(f"  ! delete_experiment: {e}")


def main():
    print(f"Tracking URI: {TRACKING_URI}")
    print(f"Targets: {TARGETS}")

    for name in TARGETS:
        _cleanup_registered_model(name)
        _cleanup_experiment(name)

    print("\nDone. Run model.py from each sample-*-crc/ folder to start fresh.")


if __name__ == "__main__":
    main()
