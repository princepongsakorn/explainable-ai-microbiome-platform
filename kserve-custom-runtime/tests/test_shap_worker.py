"""SHAP runs in a forked worker process so it cannot hold up /v1/predict.

TreeExplainer computes in C without releasing the GIL; in one process, every
predict waited for the explanation in flight. These tests use a real forked
worker with a stand-in model, so no MLflow call is made.
"""

from __future__ import annotations

import os

import numpy as np
import pandas as pd
import pytest

pytest.importorskip("mlflow")


class _Impl:
    """Answers with the pid that computed it, and dies on request."""

    def shap_explain(self, X):
        if "die" in X.columns:
            os._exit(1)
        n = len(X)
        return {
            "values": np.arange(n * X.shape[1], dtype=float).reshape(n, -1),
            "base_values": np.full(n, 0.5),
            "data": X.to_numpy(),
            "pid": os.getpid(),
        }


@pytest.fixture
def worker(server, monkeypatch):
    # Patched before the fork, so the worker inherits the stand-in.
    monkeypatch.setattr(server, "_load_explainable_cached", lambda uri: (None, _Impl()))
    server.start_shap_worker()
    yield server
    server._shap_pool.shutdown(wait=True)
    server._shap_pool = None


def _x(columns=("a", "b")):
    return pd.DataFrame([[1.0] * len(columns), [2.0] * len(columns)], columns=list(columns))


def test_shap_is_computed_in_the_worker_and_matches_inline(worker):
    X = _x()
    out = worker._shap_explain(_Impl(), X, "models:/m/1")
    inline = _Impl().shap_explain(X)

    assert out["pid"] != os.getpid()
    np.testing.assert_array_equal(out["values"], inline["values"])
    np.testing.assert_array_equal(out["base_values"], inline["base_values"])
    np.testing.assert_array_equal(out["data"], inline["data"])


def test_get_shap_value_is_unchanged_through_the_worker(worker):
    X = _x()
    via_worker = worker.get_shap_value(_Impl(), X, model_uri="models:/m/1")
    inline = worker.get_shap_value(_Impl(), X)

    pd.testing.assert_frame_equal(via_worker.shap_df, inline.shap_df)
    np.testing.assert_array_equal(via_worker.base_values, inline.base_values)


def test_without_a_model_uri_shap_runs_inline(worker):
    assert worker._shap_explain(_Impl(), _x(), None)["pid"] == os.getpid()


def test_a_dead_worker_fails_that_request_and_is_replaced(worker):
    first = worker._shap_pool

    with pytest.raises(worker.ShapWorkerUnavailable):
        worker._shap_explain(_Impl(), _x(("die",)), "models:/m/1")

    assert worker._shap_pool is not first
    assert worker._shap_explain(_Impl(), _x(), "models:/m/1")["pid"] != os.getpid()


@pytest.mark.parametrize(
    "url",
    [
        "/v1/explain/values/m",
        "/v1/explain/beeswarm/m",
        "/v1/explain/heatmap/m",
        "/v1/explain/waterfall/m",
    ],
)
def test_an_endpoint_answers_503_when_the_worker_died(server, monkeypatch, url):
    class Stub:
        def __init__(self, model_name, version=None):
            pass

        def load(self):
            return object(), object(), ["a"]

    def dead(*args, **kwargs):
        raise server.ShapWorkerUnavailable("The SHAP worker process stopped")

    monkeypatch.setattr(server, "ModelLoader", Stub)
    monkeypatch.setattr(server, "get_shap_value", dead)
    response = server.app.test_client().post(
        url, json={"dataframe_split": {"columns": ["a"], "data": [[1.0]]}}
    )

    assert response.status_code == 503
    assert "SHAP worker" in response.get_json()["error"]
