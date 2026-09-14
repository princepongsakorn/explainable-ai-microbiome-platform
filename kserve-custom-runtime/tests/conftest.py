"""Load the runtime module under a plain name.

The server file is named with hyphens, so it cannot be imported as a module by
`import`. Importing it has no side effects beyond defining the Flask app — it
makes no MLflow call at import time — so it is safe to load once per session.
"""

from __future__ import annotations

import importlib.util
import pathlib
import sys

import pytest

RUNTIME = pathlib.Path(__file__).resolve().parents[1] / "kserve-shap-multi-modelserver.py"


@pytest.fixture(scope="session")
def server():
    spec = importlib.util.spec_from_file_location("kserve_shap_server", RUNTIME)
    module = importlib.util.module_from_spec(spec)
    sys.modules["kserve_shap_server"] = module
    spec.loader.exec_module(module)
    return module
