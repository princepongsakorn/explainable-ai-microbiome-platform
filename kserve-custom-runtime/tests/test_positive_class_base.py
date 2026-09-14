"""The base value handed to the payload is the positive class's, whatever shape
the ExplainableModel returned it in (contract: (), (n_classes,) or (n, n_classes)).
"""

from __future__ import annotations

import numpy as np
import pytest

pd = pytest.importorskip("pandas")
pytest.importorskip("mlflow")


class _Impl:
    def __init__(self, values, base):
        self.values = np.asarray(values, dtype=float)
        self.base = np.asarray(base, dtype=float)

    def shap_explain(self, X):
        return {"values": self.values, "base_values": self.base, "data": X.to_numpy()}


def _X(n):
    return pd.DataFrame({"a": np.arange(n, dtype=float)}, index=[f"s{i}" for i in range(n)])


@pytest.mark.parametrize(
    "values, base, expected",
    [
        # positive-class values with a per-sample, per-class base
        ([[0.1], [0.2], [0.3]], [[0.9, 0.1], [0.8, 0.2], [0.7, 0.3]], [0.1, 0.2, 0.3]),
        # positive-class values with one per-class pair
        ([[0.1], [0.2], [0.3]], [0.6, 0.4], [0.4, 0.4, 0.4]),
        # positive-class values with a scalar
        ([[0.1], [0.2], [0.3]], 0.25, [0.25, 0.25, 0.25]),
        # two samples and a 1-D pair: one base per sample, as before
        ([[0.1], [0.2]], [0.3, 0.4], [0.3, 0.4]),
        # per-class values: a trailing 2 is always the class axis
        ([[[0.9, 0.1]], [[0.8, 0.2]]], [0.6, 0.4], [0.4, 0.4]),
    ],
)
def test_the_positive_class_base_is_selected(server, values, base, expected):
    shap_object = server.get_shap_value(_Impl(values, base), _X(len(values)))
    assert shap_object.base_values.tolist() == pytest.approx(expected)
