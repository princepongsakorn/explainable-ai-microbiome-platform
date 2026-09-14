"""A model version resolves to the run that produced it.

A prediction records the model name and the registry version that made it, and
the platform opens that version's run. No MLflow server is involved:
MlflowClient is stubbed.
"""

from __future__ import annotations

import pytest

pytest.importorskip("mlflow")

from mlflow.exceptions import MlflowException  # noqa: E402
from mlflow.protos.databricks_pb2 import RESOURCE_DOES_NOT_EXIST  # noqa: E402

URL = "/v1/mlflow/model/crc-model/version/3"


@pytest.fixture
def client(server, monkeypatch):
    monkeypatch.setattr(server.mlflow, "set_tracking_uri", lambda uri: None)
    return server.app.test_client()


def stub_mlflow(server, monkeypatch, *, error=None):
    class Version:
        name = "crc-model"
        version = "3"
        run_id = "run-abc"
        current_stage = "Archived"

    class Client:
        def get_model_version(self, name, version):
            if error is not None:
                raise error
            assert (name, version) == ("crc-model", "3")
            return Version()

    monkeypatch.setattr(server.mlflow.tracking, "MlflowClient", Client)


def test_a_version_answers_with_its_run(client, server, monkeypatch):
    stub_mlflow(server, monkeypatch)
    response = client.get(URL)
    assert response.status_code == 200
    assert response.get_json() == {
        "name": "crc-model",
        "version": "3",
        "run_id": "run-abc",
        "current_stage": "Archived",
    }


def test_a_version_that_does_not_exist_is_a_404(client, server, monkeypatch):
    stub_mlflow(
        server,
        monkeypatch,
        error=MlflowException("not found", error_code=RESOURCE_DOES_NOT_EXIST),
    )
    response = client.get(URL)
    assert response.status_code == 404


def test_any_other_mlflow_failure_is_a_500(client, server, monkeypatch):
    stub_mlflow(server, monkeypatch, error=MlflowException("registry unavailable"))
    response = client.get(URL)
    assert response.status_code == 500
    assert "registry unavailable" in response.get_json()["message"]
