"""Plan Tasks 10-11: the per-request model load and registry lookup are cached.

Both caches are process-local, so every test clears them first. Nothing here
touches a real MLflow server: the registry client and the pyfunc loader are
both replaced with counting stubs.
"""

from __future__ import annotations

import pytest

pytest.importorskip("mlflow")


class _Version:
    def __init__(self, version="3", run_id="run-abc"):
        self.version = version
        self.run_id = run_id


@pytest.fixture
def clean(server, monkeypatch):
    server._reset_model_caches()
    # Background refreshes run inline, so a test sees their effect on return.
    monkeypatch.setattr(server, "_start_refresh", lambda target: target())
    yield server
    server._reset_model_caches()


def _stub_client(monkeypatch, server, result):
    """Point the registry lookup at `result`, and count the calls it makes."""
    calls = []

    class Client:
        def get_latest_versions(self, name, stages):
            calls.append(name)
            if isinstance(result, Exception):
                raise result
            return result

    monkeypatch.setattr(server.mlflow.tracking, "MlflowClient", Client)
    return calls


def test_registry_lookup_is_cached_within_the_ttl(clean, monkeypatch):
    calls = _stub_client(monkeypatch, clean, [_Version()])

    first = clean._resolve_production_version("m")
    second = clean._resolve_production_version("m")

    assert first == second == ("3", "run-abc")
    assert len(calls) == 1, "the second lookup should have been served from cache"


def test_expired_entry_is_refetched(clean, monkeypatch):
    calls = _stub_client(monkeypatch, clean, [_Version()])
    monkeypatch.setattr(clean, "_MODEL_VERSION_TTL_SECONDS", 0)

    clean._resolve_production_version("m")
    clean._resolve_production_version("m")

    assert len(calls) == 2


def test_an_expired_entry_is_served_without_waiting_for_the_registry(clean, monkeypatch):
    calls = _stub_client(monkeypatch, clean, [_Version()])
    clean._resolve_production_version("m")

    scheduled = []
    monkeypatch.setattr(clean, "_start_refresh", scheduled.append)
    monkeypatch.setattr(clean, "_MODEL_VERSION_TTL_SECONDS", 0)

    assert clean._resolve_production_version("m") == ("3", "run-abc")
    assert len(calls) == 1, "the registry must not be called on the request thread"
    assert len(scheduled) == 1


def test_only_one_refresh_runs_at_a_time(clean, monkeypatch):
    calls = _stub_client(monkeypatch, clean, [_Version()])
    clean._resolve_production_version("m")

    scheduled = []
    monkeypatch.setattr(clean, "_start_refresh", scheduled.append)
    monkeypatch.setattr(clean, "_MODEL_VERSION_TTL_SECONDS", 0)

    for _ in range(3):
        clean._resolve_production_version("m")
    assert len(scheduled) == 1

    scheduled[0]()
    assert len(calls) == 2
    clean._resolve_production_version("m")
    assert len(scheduled) == 2, "a finished refresh must not block the next one"


def test_a_cached_version_survives_an_unreachable_registry(clean, monkeypatch):
    _stub_client(monkeypatch, clean, [_Version()])
    clean._resolve_production_version("m")

    _stub_client(monkeypatch, clean, ConnectionError("tracking server is down"))
    monkeypatch.setattr(clean, "_MODEL_VERSION_TTL_SECONDS", 0)

    assert clean._resolve_production_version("m") == ("3", "run-abc")


def test_an_unreachable_registry_still_raises_with_nothing_cached(clean, monkeypatch):
    _stub_client(monkeypatch, clean, ConnectionError("tracking server is down"))

    with pytest.raises(ConnectionError):
        clean._resolve_production_version("m")


def test_an_empty_production_stage_is_an_answer_not_an_outage(clean, monkeypatch):
    _stub_client(monkeypatch, clean, [_Version()])
    clean._resolve_production_version("m")

    # MLflow replied; the model was deliberately moved out of Production.
    # Serving the stale version would ignore that, so it must not be served.
    _stub_client(monkeypatch, clean, [])
    monkeypatch.setattr(clean, "_MODEL_VERSION_TTL_SECONDS", 0)

    # The request that triggers the refresh already had its answer...
    assert clean._resolve_production_version("m") == ("3", "run-abc")
    # ...and the next one finds nothing cached and gets the registry's answer.
    with pytest.raises(ValueError, match="Production"):
        clean._resolve_production_version("m")


def test_the_model_is_unpickled_once_for_repeated_requests(clean, monkeypatch):
    loads = []

    class Impl(clean.ExplainableModel):
        def predict(self, *a, **k):  # pragma: no cover - never called
            raise NotImplementedError

        def shap_explain(self, *a, **k):  # pragma: no cover - never called
            raise NotImplementedError

    impl = Impl()

    class Loaded:
        def __init__(self):
            self._model_impl = type("M", (), {"python_model": impl})()

    loaded = Loaded()

    def fake_disk_load(model_uri):
        loads.append(model_uri)
        return loaded

    monkeypatch.setattr(clean, "_load_pyfunc_cached", fake_disk_load)
    _stub_client(monkeypatch, clean, [_Version()])

    first = clean.load_explainable_model("m")
    second = clean.load_explainable_model("m")

    assert first[0] is second[0] is loaded
    assert len(loads) == 1, "the second request should not have hit the disk cache"
