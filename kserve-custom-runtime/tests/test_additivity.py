"""Invariant I3 from docs/shap-explain-spec.md, checked against a real model.

`base_values[i] + sum(values[i])` must equal the Model output for Sample i within 1e-3
absolute. The tolerance exists because the payload rounds every float to 4 significant
figures (spec §1.4) — asserting exact equality here would be wrong, not stricter.

The tolerance is absolute rather than relative because the Model output is a probability
that can be exactly 0; a relative check against zero reports a meaningless error.

Skipped when sklearn/shap are unavailable, so the runtime image does not need them.
"""

from __future__ import annotations

import pathlib

import numpy as np
import pytest

from explain_payload import build_payload

shap = pytest.importorskip("shap")
sklearn_ensemble = pytest.importorskip("sklearn.ensemble")
pd = pytest.importorskip("pandas")

REPO = pathlib.Path(__file__).resolve().parents[2]
SAMPLE_CSV = REPO / "sample-data/sample.csv"

pytestmark = pytest.mark.skipif(
    not SAMPLE_CSV.exists(), reason="sample-data/sample.csv is not available"
)


@pytest.fixture(scope="module")
def explained():
    df = pd.read_csv(SAMPLE_CSV, index_col=0)
    X = df.drop(columns=["CRC"])
    model = sklearn_ensemble.RandomForestClassifier(n_estimators=40, random_state=0)
    model.fit(X, df["CRC"])

    out = shap.TreeExplainer(model, data=X)(X)
    values = out.values[:, :, 1] if out.values.ndim == 3 else out.values
    base = out.base_values[:, 1] if np.ndim(out.base_values) == 2 else out.base_values
    base = np.broadcast_to(np.asarray(base, dtype=float).ravel(), (len(X),))

    payload = build_payload(
        values=values,
        base_values=base,
        data=X.values,
        feature_names=X.columns,
        sample_ids=X.index,
        model_name="test-rf",
    )
    return payload, model.predict_proba(X)[:, 1]


def test_additivity_holds_within_tolerance(explained):
    payload, proba = explained
    reconstructed = np.asarray(payload["base_values"]) + np.asarray(payload["values"]).sum(axis=1)
    np.testing.assert_allclose(reconstructed, proba, rtol=0, atol=1e-3)


def test_rounding_leaves_headroom_under_the_tolerance(explained):
    """Guard against someone lowering DEFAULT_SIGNIFICANT_DIGITS without thinking.

    Measured at 1.09e-04 for these 201 Features. Failing this means the rounding was
    made coarser, not that additivity broke.
    """
    payload, proba = explained
    reconstructed = np.asarray(payload["base_values"]) + np.asarray(payload["values"]).sum(axis=1)
    worst = float(np.max(np.abs(reconstructed - proba)))
    assert worst < 5e-4, f"worst absolute additivity error {worst:.2e} has less than 2x headroom"


def test_payload_matches_declared_shapes(explained):
    payload, _ = explained
    n = len(payload["values"])
    p = len(payload["feature_names"])
    assert len(payload["data"]) == n
    assert len(payload["base_values"]) == n
    assert len(payload["sample_ids"]) == n
    assert all(len(row) == p for row in payload["values"])
    assert all(len(row) == p for row in payload["data"])
