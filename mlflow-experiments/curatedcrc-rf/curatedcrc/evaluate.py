"""Track B: fixed-model repeated CV and leave-one-dataset-out evaluation."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import RepeatedStratifiedKFold, cross_val_score

from .data import PreparedDataset


PAPER_LODO_AUC = {
    "YachidaS_2019": 0.723,
    "ZellerG_2014": 0.771,
    "WirbelJ_2018": 0.894,
    "YuJ_2015": 0.867,
    "VogtmannE_2016": 0.766,
}


def reference_model() -> RandomForestClassifier:
    return RandomForestClassifier(
        n_estimators=500,
        max_depth=None,
        random_state=0,
        class_weight=None,
        n_jobs=-1,
    )


def _evaluation_groups(prepared: PreparedDataset) -> list[tuple[str, pd.Index]]:
    groups = [
        (str(cohort), prepared.metadata.index[prepared.metadata["study_name"] == cohort])
        for cohort in sorted(prepared.metadata["study_name"].unique())
    ]
    yachida = prepared.metadata["study_name"] == "YachidaS_2019"
    stages = prepared.metadata["ajcc_stage"].fillna("").astype(str).str.lower()
    stage_iii_iv = yachida & (
        (prepared.metadata["CRC"] == 0)
        | ((prepared.metadata["CRC"] == 1) & stages.isin({"iii", "iv"}))
    )
    groups.append(
        (
            "YachidaS_2019_stage_III_IV",
            prepared.metadata.index[stage_iii_iv],
        )
    )
    return groups


def evaluate_cohort_cv(prepared: PreparedDataset) -> pd.DataFrame:
    records: list[dict[str, object]] = []
    for group_name, ids in _evaluation_groups(prepared):
        X_group = prepared.X.loc[ids]
        y_group = prepared.metadata.loc[ids, "CRC"]
        class_counts = y_group.value_counts()
        if set(class_counts.index) != {0, 1} or int(class_counts.min()) < 10:
            raise ValueError(
                f"{group_name} cannot support 10-fold stratification: {class_counts.to_dict()}"
            )
        splitter = RepeatedStratifiedKFold(
            n_splits=10,
            n_repeats=10,
            random_state=0,
        )
        scores = cross_val_score(
            reference_model(),
            X_group,
            y_group,
            cv=splitter,
            scoring="roc_auc",
            n_jobs=1,
        )
        records.append(
            {
                "evaluation_group": group_name,
                "samples": int(len(ids)),
                "healthy": int(class_counts[0]),
                "crc": int(class_counts[1]),
                "fold_count": int(len(scores)),
                "mean_auc": float(np.mean(scores)),
                "std_auc": float(np.std(scores, ddof=0)),
                "min_auc": float(np.min(scores)),
                "max_auc": float(np.max(scores)),
                "paper_reference_auc": 0.82
                if group_name == "YachidaS_2019_stage_III_IV"
                else np.nan,
            }
        )
    return pd.DataFrame.from_records(records)


def evaluate_lodo(prepared: PreparedDataset) -> pd.DataFrame:
    records: list[dict[str, object]] = []
    for cohort in sorted(prepared.metadata["study_name"].unique()):
        held_out = prepared.metadata["study_name"] == cohort
        train_ids = prepared.metadata.index[~held_out]
        test_ids = prepared.metadata.index[held_out]
        model = reference_model().fit(
            prepared.X.loc[train_ids],
            prepared.metadata.loc[train_ids, "CRC"],
        )
        probabilities = model.predict_proba(prepared.X.loc[test_ids])[:, 1]
        auc = roc_auc_score(prepared.metadata.loc[test_ids, "CRC"], probabilities)
        records.append(
            {
                "held_out_cohort": str(cohort),
                "train_samples": int(len(train_ids)),
                "test_samples": int(len(test_ids)),
                "roc_auc": float(auc),
                "paper_reported_auc": PAPER_LODO_AUC[str(cohort)],
            }
        )
    return pd.DataFrame.from_records(records)


def atomic_to_csv(frame: pd.DataFrame, destination: Path) -> None:
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", newline="", dir=destination.parent, delete=False
    ) as stream:
        temporary = Path(stream.name)
        frame.to_csv(stream, index=False)
    os.replace(temporary, destination)


def evaluate_and_save(
    prepared: PreparedDataset,
    output_dir: Path,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    output_dir = Path(output_dir)
    cohort_table = evaluate_cohort_cv(prepared)
    lodo_table = evaluate_lodo(prepared)
    atomic_to_csv(cohort_table, output_dir / "track_b_cohort_cv.csv")
    atomic_to_csv(lodo_table, output_dir / "track_b_lodo.csv")
    return cohort_table, lodo_table
