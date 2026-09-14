"""A stage change that did not happen must not answer 200.

The Nest service treats any 2xx as success, so a failed MLflow transition, or
a run with no registered model, used to reach the page as "Model Published".
No MLflow server is involved: MlflowClient is stubbed.
"""

from __future__ import annotations

import pytest

pytest.importorskip("mlflow")

from mlflow.exceptions import MlflowException  # noqa: E402

URL = "/v1/mlflow/run/run-1/stage"
BODY = {"stage": "Production", "description": "{}", "archive_existing_versions": True}


@pytest.fixture
def client(server, monkeypatch):
    monkeypatch.setattr(server.mlflow, "set_tracking_uri", lambda uri: None)
    return server.app.test_client()


def stub_mlflow(server, monkeypatch, *, has_version=True, transition_error=None):
    class Version:
        name = "crc-model"
        version = "3"

    class Client:
        def search_model_versions(self, query):
            return [Version()] if has_version else []

        def transition_model_version_stage(self, **kwargs):
            if transition_error is not None:
                raise transition_error

        def update_model_version(self, **kwargs):
            pass

    monkeypatch.setattr(server.mlflow.tracking, "MlflowClient", Client)


def test_a_successful_transition_is_a_200(client, server, monkeypatch):
    stub_mlflow(server, monkeypatch)
    response = client.put(URL, json=BODY)
    assert response.status_code == 200
    assert response.get_json()["status"] == "success"


def test_a_run_without_a_model_is_a_404(client, server, monkeypatch):
    stub_mlflow(server, monkeypatch, has_version=False)
    response = client.put(URL, json=BODY)
    assert response.status_code == 404
    assert "run-1" in response.get_json()["message"]


def test_an_mlflow_failure_is_a_500_with_its_message(client, server, monkeypatch):
    stub_mlflow(server, monkeypatch, transition_error=MlflowException("registry is read-only"))
    response = client.put(URL, json=BODY)
    assert response.status_code == 500
    assert "registry is read-only" in response.get_json()["message"]
