"""Plan Task 12: the five model endpoints answer bad input the same way.

They share a preamble — load the model, read the body, parse `dataframe_split`,
reshape to the trained column set — and had drifted apart in how they report a
failure in it. These tests pin the shared answers. No model is loaded and no
MLflow call is made: `ModelLoader` is stubbed.
"""

from __future__ import annotations

import pytest

pytest.importorskip("mlflow")

ENDPOINTS = [
    "/v1/explain/values/m",
    "/v1/explain/beeswarm/m",
    "/v1/explain/heatmap/m",
    "/v1/explain/waterfall/m",
    "/v1/predict/m",
]

GOOD_BODY = {"dataframe_split": {"columns": ["a"], "data": [[1.0]]}}


@pytest.fixture
def client(server):
    server.app.config["TESTING"] = False
    return server.app.test_client()


@pytest.fixture
def loadable(server, monkeypatch):
    """A model that loads cleanly, so failures come from the body, not the load."""

    class Stub:
        def __init__(self, model_name):
            pass

        def load(self):
            return object(), object(), ["a"]

    monkeypatch.setattr(server, "ModelLoader", Stub)


@pytest.mark.parametrize("url", ENDPOINTS)
def test_a_malformed_body_is_the_callers_fault(client, loadable, url):
    response = client.post(url, data="{not json", content_type="application/json")
    assert response.status_code == 400


@pytest.mark.parametrize("url", ENDPOINTS)
def test_a_body_without_dataframe_split_is_rejected_identically(client, loadable, url):
    response = client.post(url, json={"nope": 1})
    assert response.status_code == 400
    assert "dataframe_split" in response.get_json()["error"]


@pytest.mark.parametrize("url", ENDPOINTS)
def test_an_index_of_the_wrong_length_is_rejected_identically(client, loadable, url):
    response = client.post(url, json={
        "dataframe_split": {"columns": ["a"], "data": [[1.0]], "index": ["x", "y"]},
    })
    assert response.status_code == 400
    assert "index" in response.get_json()["error"]


@pytest.mark.parametrize("url", ENDPOINTS)
def test_a_model_not_in_production_is_a_404_everywhere(client, server, monkeypatch, url):
    class Stub:
        def __init__(self, model_name):
            pass

        def load(self):
            raise server.NoProductionVersionError(
                "No model version for 'm' in Production stage."
            )

    monkeypatch.setattr(server, "ModelLoader", Stub)
    response = client.post(url, json=GOOD_BODY)
    assert response.status_code == 404


@pytest.mark.parametrize("url", ENDPOINTS)
def test_any_other_value_error_while_loading_is_a_503(client, server, monkeypatch, url):
    """A malformed artifact must not read as "no such model"."""

    class Stub:
        def __init__(self, model_name):
            pass

        def load(self):
            raise ValueError("feature_names.json is not a list")

    monkeypatch.setattr(server, "ModelLoader", Stub)
    response = client.post(url, json=GOOD_BODY)
    assert response.status_code == 503


@pytest.mark.parametrize("body", ["null", "[1]", '{"dataframe_split": null}'])
@pytest.mark.parametrize("url", ENDPOINTS)
def test_json_that_is_not_an_object_is_a_400(client, loadable, url, body):
    response = client.post(url, data=body, content_type="application/json")
    assert response.status_code == 400


def test_the_loaded_version_is_kept_for_the_request(server, monkeypatch):
    class Stub:
        def __init__(self, model_name):
            self.version = "7"

        def load(self):
            return object(), object(), ["a"]

    monkeypatch.setattr(server, "ModelLoader", Stub)
    with server.app.test_request_context():
        *_, err = server._load_model_or_error("m")
        assert err is None
        assert server.g.model_version == "7"


@pytest.mark.parametrize("url", ENDPOINTS)
def test_a_model_that_fails_to_load_is_a_503_everywhere(client, server, monkeypatch, url):
    class Stub:
        def __init__(self, model_name):
            pass

        def load(self):
            raise ImportError("torch_geometric is not installed")

    monkeypatch.setattr(server, "ModelLoader", Stub)
    response = client.post(url, json=GOOD_BODY)
    assert response.status_code == 503


@pytest.mark.parametrize("url", ENDPOINTS)
def test_non_numeric_input_is_rejected_before_it_becomes_nan(client, loadable, url):
    """`transformer` coerces with errors="coerce", so a non-numeric cell becomes
    NaN rather than an error. Only `explain_values` used to notice, downstream in
    `build_payload`; the plot endpoints drew the NaN and `predict` fed it to the
    model. All five now refuse it, and say which column was at fault."""
    response = client.post(url, json={
        "dataframe_split": {"columns": ["a"], "data": [["not-a-number"]]},
    })
    assert response.status_code == 400
    assert "a" in response.get_json()["error"]
