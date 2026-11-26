"""The user and token routes need MLflow's auth client to work as installed."""

from __future__ import annotations

import pytest
from mlflow.exceptions import MlflowException
from mlflow.server import get_app_client


def test_auth_client_reaches_the_tracking_server(monkeypatch):
    """A dependency mismatch surfaces here as ImportError, before any request.

    SQLAlchemy 2.1 broke this with MLflow 2.x. Nothing listens on port 1, so a
    healthy install fails on the connection instead.
    """
    monkeypatch.setenv("MLFLOW_HTTP_REQUEST_MAX_RETRIES", "0")
    client = get_app_client("basic-auth", tracking_uri="http://127.0.0.1:1")

    with pytest.raises(MlflowException):
        client.get_user(username="anyone")
