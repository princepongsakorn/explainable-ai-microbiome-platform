"""SHAP report and paper-biomarker sanity check for the Track A winner."""

from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_matplotlib_cache = Path(tempfile.gettempdir()) / "curatedcrc-matplotlib-cache"
_matplotlib_cache.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_matplotlib_cache))
os.environ.setdefault("XDG_CACHE_HOME", str(_matplotlib_cache))

import matplotlib
import numpy as np
import pandas as pd
import shap

from .data import BIOMARKERS


matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402


@dataclass(frozen=True)
class ShapReport:
    status: str
    biomarker_ranks: dict[str, int | None]
    missing_from_top_positive: tuple[str, ...]
    ranking_path: Path
    summary_path: Path
    beeswarm_path: Path
    explainer: Any = field(repr=False, compare=False)


def normalize_class1_shap(
    values: Any,
    *,
    n_samples: int,
    n_features: int,
) -> np.ndarray:
    if isinstance(values, shap.Explanation):
        values = values.values
    if isinstance(values, list):
        if len(values) != 2:
            raise ValueError(f"Expected two class-specific SHAP arrays, found {len(values)}")
        values = values[1]
    array = np.asarray(values)
    if array.shape == (n_samples, n_features, 2):
        array = array[:, :, 1]
    elif array.shape == (2, n_samples, n_features):
        array = array[1]
    if array.shape != (n_samples, n_features):
        raise ValueError(
            f"Unexpected SHAP shape {array.shape}; expected {(n_samples, n_features)}"
        )
    return array


def rank_positive_contributors(
    values: np.ndarray,
    feature_names: list[str],
) -> pd.DataFrame:
    table = pd.DataFrame(
        {
            "feature": feature_names,
            "mean_positive_shap": np.maximum(values, 0.0).mean(axis=0),
            "mean_abs_shap": np.abs(values).mean(axis=0),
            "mean_signed_shap": values.mean(axis=0),
        }
    ).sort_values(
        ["mean_positive_shap", "mean_abs_shap", "feature"],
        ascending=[False, False, True],
    )
    table = table.reset_index(drop=True)
    table["positive_rank"] = np.arange(1, len(table) + 1)
    return table


def create_shap_report(
    model: Any,
    background: pd.DataFrame,
    X_explain: pd.DataFrame,
    output_dir: Path,
    *,
    top_k: int = 20,
) -> ShapReport:
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    explainer = shap.Explainer(model, background)
    explanation = explainer(X_explain, check_additivity=False)
    class1_values = normalize_class1_shap(
        explanation,
        n_samples=len(X_explain),
        n_features=X_explain.shape[1],
    )
    ranking = rank_positive_contributors(class1_values, X_explain.columns.tolist())
    ranking_path = output_dir / "track_a_shap_positive_contributors.csv"
    ranking.to_csv(ranking_path, index=False)

    ranks = {
        biomarker: (
            int(ranking.loc[ranking["feature"] == biomarker, "positive_rank"].iloc[0])
            if biomarker in set(ranking["feature"])
            else None
        )
        for biomarker in BIOMARKERS
    }
    missing = tuple(
        biomarker
        for biomarker, rank in ranks.items()
        if rank is None or rank > top_k
    )
    status = "passed" if not missing else "flagged"
    summary = {
        "status": status,
        "top_k": top_k,
        "ranking_metric": "mean positive class-1 SHAP contribution",
        "biomarker_ranks": ranks,
        "missing_from_top_positive": list(missing),
        "explained_samples": int(len(X_explain)),
        "features": int(X_explain.shape[1]),
    }
    summary_path = output_dir / "track_a_shap_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n")

    beeswarm_path = output_dir / "track_a_shap_beeswarm.png"
    plot_explanation = shap.Explanation(
        values=class1_values,
        data=X_explain.to_numpy(),
        feature_names=X_explain.columns.tolist(),
    )
    plt.figure(figsize=(11, 8))
    shap.plots.beeswarm(plot_explanation, max_display=20, show=False)
    plt.tight_layout()
    plt.savefig(beeswarm_path, dpi=200, bbox_inches="tight")
    plt.close()

    return ShapReport(
        status=status,
        biomarker_ranks=ranks,
        missing_from_top_positive=missing,
        ranking_path=ranking_path,
        summary_path=summary_path,
        beeswarm_path=beeswarm_path,
        explainer=explainer,
    )
