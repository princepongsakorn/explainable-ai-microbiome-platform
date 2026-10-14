"""A caller can pin a request to one registered model version with ``?version=N``.

A prediction job is submitted against the version in Production at that moment,
and every request it makes afterwards names that version, so a promotion while
it runs changes nothing. No MLflow server is involved: the registry client, the
pyfunc loader and the feature-name lookup are all stubbed.
"""

from __future__ import annotations

import pandas as pd
import pytest

pytest.importorskip("mlflow")

from mlflow.exceptions import MlflowException  # noqa: E402
from mlflow.protos.databricks_pb2 import RESOURCE_DOES_NOT_EXIST  # noqa: E402

BODY = {"dataframe_split": {"columns": ["a"], "data": [[1.0]], "index": ["s1"]}}

# Version 2 is in Production; version 1 is the one a job was pinned to earlier.
RUNS = {"1": "run-v1", "2": "run-v2"}
PRODUCTION = "2"


class _Version:
    def __init__(self, version):
        self.version = version
        self.run_id = RUNS[version]


@pytest.fixture
def registry(server, monkeypatch):
    """Stub the registry and the loaders; return the calls each one received."""
    server._reset_model_caches()
    monkeypatch.setenv("MLFLOW_URL", "http://mlflow.invalid")
    monkeypatch.setattr(server.mlflow, "set_tracking_uri", lambda uri: None)
    calls = {"latest": [], "by_version": [], "loaded": [], "feature_runs": []}

    class Client:
        def get_latest_versions(self, name, stages):
            calls["latest"].append(name)
            return [_Version(PRODUCTION)]

        def get_model_version(self, name, version):
            calls["by_version"].append((name, version))
            if version not in RUNS:
                raise MlflowException("not found", error_code=RESOURCE_DOES_NOT_EXIST)
            return _Version(version)

    monkeypatch.setattr(server.mlflow.tracking, "MlflowClient", Client)

    class Impl(server.ExplainableModel):
        def predict(self, *a, **k):  # pragma: no cover - the pyfunc wrapper is called
            raise NotImplementedError

        def shap_explain(self, *a, **k):  # pragma: no cover - never called
            raise NotImplementedError

    def disk_load(model_uri):
        calls["loaded"].append(model_uri)

        class Loaded:
            _model_impl = type("M", (), {"python_model": Impl()})()

            def predict(self, df):
                return pd.DataFrame({"Y_proba": [0.75] * len(df), "Y_class": [1] * len(df)})

        return Loaded()

    def feature_names(run_id, artifact_path):
        calls["feature_runs"].append(run_id)
        return ["a"]

    # _reset_model_caches clears it on teardown, before monkeypatch restores it.
    feature_names.cache_clear = lambda: None

    monkeypatch.setattr(server, "_load_pyfunc_cached", disk_load)
    monkeypatch.setattr(server, "_feature_names_cached", feature_names)
    yield calls
    server._reset_model_caches()


@pytest.fixture
def client(server):
    server.app.config["TESTING"] = False
    return server.app.test_client()


def test_a_pinned_version_is_loaded_even_when_another_is_in_production(client, registry):
    response = client.post("/v1/predict/m?version=1", json=BODY)

    assert response.status_code == 200
    assert response.get_json()["model_version"] == "1"
    assert registry["loaded"] == ["models:/m/1"]
    assert registry["feature_runs"] == ["run-v1"]
    assert registry["latest"] == [], "a pinned request must not ask for Production"


def test_without_a_version_the_production_version_is_used(client, registry):
    response = client.post("/v1/predict/m", json=BODY)

    assert response.status_code == 200
    assert response.get_json()["model_version"] == PRODUCTION
    assert registry["loaded"] == ["models:/m/2"]
    assert registry["by_version"] == []


def test_predict_keeps_its_shape_and_adds_the_version(client, registry):
    body = client.post("/v1/predict/m", json=BODY).get_json()

    assert body == {
        "predict": [{"id": "s1", "proba": 0.75, "class": 1}],
        "model_version": PRODUCTION,
    }


def test_a_pinned_version_asks_the_registry_once(client, registry):
    client.post("/v1/predict/m?version=1", json=BODY)
    client.post("/v1/predict/m?version=1", json=BODY)

    assert registry["by_version"] == [("m", "1")]


@pytest.mark.parametrize("url", ["/v1/predict/m?version=9", "/v1/explain/values/m?version=9"])
def test_a_version_that_does_not_exist_is_a_404(client, registry, url):
    response = client.post(url, json=BODY)

    assert response.status_code == 404
    assert "no version 9" in response.get_json()["error"]
    assert registry["loaded"] == []


@pytest.mark.parametrize("raw", ["abc", "0", "-1", "1.5", "", "²"])
@pytest.mark.parametrize("path", ["/v1/predict/m", "/v1/explain/values/m"])
def test_a_version_that_is_not_a_positive_integer_is_a_400(client, registry, path, raw):
    response = client.post(f"{path}?version={raw}", json=BODY)

    assert response.status_code == 400
    assert "version" in response.get_json()["error"]
    assert registry["by_version"] == [] and registry["loaded"] == []


def test_a_registry_failure_on_a_pinned_version_is_a_503(client, server, registry, monkeypatch):
    class Down:
        def get_model_version(self, name, version):
            raise MlflowException("connection refused")

    monkeypatch.setattr(server.mlflow.tracking, "MlflowClient", Down)
    response = client.post("/v1/predict/m?version=1", json=BODY)

    assert response.status_code == 503


def test_explain_values_reports_the_pinned_version(client, server, registry, monkeypatch):
    """The SHAP numerics are not under test; only which version the payload names."""
    import numpy as np

    class Shap:
        shap_df = pd.DataFrame({"a": [0.1]}, index=["s1"])
        base_values = np.array([0.5])
        explanation = type("E", (), {"data": np.array([[1.0]])})()

    monkeypatch.setattr(server, "get_shap_value", lambda impl, X, aggregate_by=None: Shap())
    response = client.post("/v1/explain/values/m?version=1", json=BODY)

    assert response.status_code == 200
    assert response.get_json()["model_version"] == "1"
    assert registry["loaded"] == ["models:/m/1"]


def test_the_production_route_asks_the_registry_every_time(client, registry):
    first = client.get("/v1/models/m/production")
    second = client.get("/v1/models/m/production")

    assert first.status_code == second.status_code == 200
    assert first.get_json() == {"name": "m", "version": "2", "run_id": "run-v2"}
    assert registry["latest"] == ["m", "m"], "a submission must not get a stale answer"


def test_the_production_route_is_a_404_when_nothing_is_in_production(client, server, registry, monkeypatch):
    class Empty:
        def get_latest_versions(self, name, stages):
            return []

    monkeypatch.setattr(server.mlflow.tracking, "MlflowClient", Empty)
    response = client.get("/v1/models/m/production")

    assert response.status_code == 404
    assert "Production" in response.get_json()["error"]
