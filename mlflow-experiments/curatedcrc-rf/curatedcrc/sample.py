"""Create a deterministic platform-compatible sample from curatedCRC."""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import pandas as pd
from sklearn.model_selection import train_test_split

from .data import EXPECTED_COHORTS, PreparedDataset


def select_sample_ids(
    prepared: PreparedDataset,
    *,
    n: int = 60,
    random_state: int = 42,
) -> pd.Index:
    if n <= 0 or n >= len(prepared.X):
        raise ValueError(f"Sample size must be between 1 and {len(prepared.X) - 1}")
    strata = (
        prepared.metadata["study_name"].astype(str)
        + "::"
        + prepared.metadata["CRC"].astype(str)
    )
    selected, _ = train_test_split(
        prepared.X.index.to_numpy(),
        train_size=n,
        random_state=random_state,
        stratify=strata,
    )
    return pd.Index(sorted(str(value) for value in selected), name="subject_id")


def _atomic_json(payload: dict[str, object], destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", dir=destination.parent, delete=False
    ) as stream:
        json.dump(payload, stream, indent=2, sort_keys=True)
        stream.write("\n")
        temporary = Path(stream.name)
    os.replace(temporary, destination)


def export_platform_sample(
    prepared: PreparedDataset,
    csv_path: Path,
    manifest_path: Path,
    *,
    n: int = 60,
    random_state: int = 42,
) -> dict[str, object]:
    selected_ids = select_sample_ids(prepared, n=n, random_state=random_state)
    selected_metadata = prepared.metadata.loc[selected_ids]
    selected_cohorts = set(selected_metadata["study_name"])
    if selected_cohorts != set(EXPECTED_COHORTS):
        raise RuntimeError(f"Sample does not cover every cohort: {sorted(selected_cohorts)}")
    if set(selected_metadata["CRC"]) != {0, 1}:
        raise RuntimeError("Sample does not contain both CRC classes")

    exported = prepared.X.loc[selected_ids].copy()
    exported["CRC"] = selected_metadata["CRC"].astype(int)
    csv_path = Path(csv_path)
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", newline="", dir=csv_path.parent, delete=False
    ) as stream:
        temporary_csv = Path(stream.name)
        exported.to_csv(stream, index=True, index_label="subject_id")
    os.replace(temporary_csv, csv_path)

    manifest: dict[str, object] = {
        "sample_size": n,
        "random_state": random_state,
        "sampling": "proportional stratification by study_name and CRC",
        "selected_subject_ids": selected_ids.tolist(),
        "class_counts": {
            str(key): int(value)
            for key, value in selected_metadata["CRC"].value_counts().sort_index().items()
        },
        "cohort_counts": {
            str(key): int(value)
            for key, value in selected_metadata["study_name"].value_counts().sort_index().items()
        },
        "filtered_feature_count": prepared.filtered_feature_count,
        "source_sha256": prepared.provenance["sha256"],
        "source_commit": prepared.provenance["source_commit"],
        "paper_commit": prepared.provenance["paper_commit"],
    }
    _atomic_json(manifest, Path(manifest_path))
    return manifest
