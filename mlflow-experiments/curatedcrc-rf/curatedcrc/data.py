"""Load, validate, and filter curatedCRC with SHAPMAT's own API."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from shapmat.abundance_filter import ab_filter

from .acquire import PAPER_COMMIT, SHAPMAT_COMMIT, UpstreamSource


ABUNDANCE_THRESHOLD = 1e-5
PREVALENCE_THRESHOLD = 0.9
EXPECTED_ROWS = 802
EXPECTED_RAW_FEATURES = 864
EXPECTED_FILTERED_FEATURES = 221
EXPECTED_SHA256 = "8f1258882cbedd1613ae3490f9ec94bbc97c72c041f1ed9f531f43b2030c1a8f"
EXPECTED_COHORTS = frozenset(
    {
        "YachidaS_2019",
        "YuJ_2015",
        "WirbelJ_2018",
        "ZellerG_2014",
        "VogtmannE_2016",
    }
)
METADATA_COLUMNS = ["study_name", "CRC", "ajcc_stage"]
BIOMARKERS = ("Fusobacterium_nucleatum", "Peptostreptococcus_stomatis")


@dataclass(frozen=True)
class PreparedDataset:
    X: pd.DataFrame
    metadata: pd.DataFrame
    provenance: dict[str, object]
    raw_feature_count: int
    filtered_feature_count: int


def _counts(series: pd.Series) -> dict[str, int]:
    return {str(key): int(value) for key, value in series.value_counts().sort_index().items()}


def prepare_dataset(
    source: UpstreamSource,
    *,
    enforce_reference_shape: bool = True,
) -> PreparedDataset:
    if enforce_reference_shape:
        mismatches = []
        if source.shapmat_commit != SHAPMAT_COMMIT:
            mismatches.append(f"SHAPMAT commit={source.shapmat_commit}")
        if source.paper_commit != PAPER_COMMIT:
            mismatches.append(f"paper commit={source.paper_commit}")
        if source.sha256 != EXPECTED_SHA256:
            mismatches.append(f"SHA-256={source.sha256}")
        if mismatches:
            raise ValueError("Unexpected curatedCRC provenance: " + ", ".join(mismatches))

    table = pd.read_csv(source.data_path, index_col=0)
    table.index = table.index.astype(str)
    table.index.name = "subject_id"
    missing = set(METADATA_COLUMNS).difference(table.columns)
    if missing:
        raise ValueError(f"Missing curatedCRC metadata columns: {sorted(missing)}")
    if not table.index.is_unique:
        raise ValueError("curatedCRC contains duplicate subject identifiers")

    metadata = table.loc[:, METADATA_COLUMNS].copy()
    if metadata["CRC"].isna().any():
        raise ValueError("curatedCRC contains missing CRC labels")
    metadata["CRC"] = pd.to_numeric(metadata["CRC"], errors="raise").astype(int)
    labels = set(metadata["CRC"].unique())
    if labels != {0, 1}:
        raise ValueError(f"Expected binary CRC labels {{0, 1}}, found {sorted(labels)}")

    cohorts = frozenset(metadata["study_name"].dropna().astype(str).unique())
    if cohorts != EXPECTED_COHORTS:
        raise ValueError(
            f"Unexpected cohort set: expected {sorted(EXPECTED_COHORTS)}, found {sorted(cohorts)}"
        )

    X_raw = table.drop(columns=METADATA_COLUMNS)
    X_raw = X_raw.apply(pd.to_numeric, errors="raise")
    if not np.isfinite(X_raw.to_numpy()).all():
        raise ValueError("Bacterial abundance matrix must contain only finite values")
    if (X_raw.to_numpy() < 0).any():
        raise ValueError("Bacterial abundance matrix contains negative values")

    X_filtered = ab_filter(
        X_raw,
        abundance_threshold=ABUNDANCE_THRESHOLD,
        prevalence_threshold=PREVALENCE_THRESHOLD,
    )
    missing_biomarkers = set(BIOMARKERS).difference(X_filtered.columns)
    if missing_biomarkers:
        raise ValueError(f"Required biomarkers were filtered out: {sorted(missing_biomarkers)}")

    if enforce_reference_shape:
        observed = (len(table), X_raw.shape[1], X_filtered.shape[1])
        expected = (EXPECTED_ROWS, EXPECTED_RAW_FEATURES, EXPECTED_FILTERED_FEATURES)
        if observed != expected:
            raise ValueError(f"Unexpected curatedCRC shape: expected {expected}, found {observed}")

    provenance: dict[str, object] = {
        "source_repository": "https://github.com/ryzary/shapmat",
        "source_branch": "cv_notebook",
        "source_path": "data/curatedCRC.csv",
        "source_commit": source.shapmat_commit,
        "paper_repository": "https://github.com/ryzary/shapmat_paper",
        "paper_commit": source.paper_commit,
        "sha256": source.sha256,
        "samples": int(len(table)),
        "class_counts": _counts(metadata["CRC"]),
        "cohort_counts": _counts(metadata["study_name"]),
        "raw_feature_count": int(X_raw.shape[1]),
        "filtered_feature_count": int(X_filtered.shape[1]),
        "abundance_threshold": ABUNDANCE_THRESHOLD,
        "prevalence_threshold": PREVALENCE_THRESHOLD,
        "prevalence_semantics": "keep features with zero fraction strictly below 0.9",
    }

    return PreparedDataset(
        X=X_filtered,
        metadata=metadata,
        provenance=provenance,
        raw_feature_count=X_raw.shape[1],
        filtered_feature_count=X_filtered.shape[1],
    )
