from pathlib import Path

import numpy as np
import pandas as pd

from curatedcrc.data import BIOMARKERS, EXPECTED_FILTERED_FEATURES
from curatedcrc.evaluate import reference_model
from curatedcrc.shap_report import normalize_class1_shap


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def test_reference_model_matches_comparison_protocol():
    params = reference_model().get_params()
    assert params["n_estimators"] == 500
    assert params["max_depth"] is None
    assert params["random_state"] == 0
    assert params["class_weight"] is None


def test_class1_shap_normalization_supports_current_random_forest_shape():
    values = np.stack([np.zeros((3, 4)), np.ones((3, 4))], axis=-1)
    normalized = normalize_class1_shap(values, n_samples=3, n_features=4)
    assert normalized.shape == (3, 4)
    assert np.all(normalized == 1.0)


def test_generated_sample_matches_platform_schema():
    sample = pd.read_csv(REPOSITORY_ROOT / "sample-data" / "curatedCRC-60-row.csv")
    assert len(sample) == 60
    assert sample.columns[0] == "subject_id"
    assert sample.columns[-1] == "CRC"
    assert len(sample.columns) == EXPECTED_FILTERED_FEATURES + 2
    assert set(sample["CRC"]) == {0, 1}
    assert set(BIOMARKERS).issubset(sample.columns)
