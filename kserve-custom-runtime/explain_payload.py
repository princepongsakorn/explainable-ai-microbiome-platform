"""Build the Explanation payload described in ``docs/shap-explain-spec.md`` §1.

The payload's core fields are named exactly as ``shap.Explanation`` names them, so any
Python user with shap installed can produce one without reading our documentation. The
platform's own extras (``sample_ids``, ``model_name``, ``model_version``) are optional —
``shap-svg`` renders without them.
"""

from __future__ import annotations

import numpy as np

CONTRACT_VERSION = 1

#: Spec §1.4. Four significant figures is below the resolution of an ~800 px wide chart,
#: and after gzip it beats a float32/base64 encoding while staying readable in a fixture.
DEFAULT_SIGNIFICANT_DIGITS = 4


def sigfig(x: float, digits: int = DEFAULT_SIGNIFICANT_DIGITS) -> float:
    """Round to ``digits`` significant figures, returning a JSON-safe float."""
    x = float(x)
    if x == 0.0:
        return 0.0
    return float("%.*g" % (digits, x))


def _rows(matrix, name: str) -> list[list[float]]:
    """Round a 2-D array, refusing anything JSON cannot represent.

    ``NaN`` and ``Infinity`` are not valid JSON, and Flask's default provider emits them
    bare, which ``JSON.parse`` then rejects. The upload path prevents them reaching here
    (spec §2.1); this is the backstop that turns a silent bad payload into a loud error.
    """
    arr = np.asarray(matrix, dtype=float)
    if arr.ndim != 2:
        raise ValueError(f"{name} must be 2-dimensional, got shape {arr.shape}")
    if not np.isfinite(arr).all():
        bad = int(np.count_nonzero(~np.isfinite(arr)))
        raise ValueError(
            f"{name} contains {bad} non-finite value(s); the payload must be valid JSON"
        )
    return [[sigfig(v) for v in row] for row in arr]


def build_payload(
    values,
    base_values,
    data,
    feature_names,
    sample_ids=None,
    model_name: str | None = None,
    model_version: str | None = None,
    output_names=None,
) -> dict:
    """Assemble one Explanation payload.

    ``base_values`` is always serialized per Sample. Collapsing it to a single scalar
    taken from Sample 0 is exactly the bug this contract exists to prevent: it is correct
    for TreeExplainer, which tiles one expected value across every row, and wrong for the
    permutation path, which computes one per row.
    """
    base = np.asarray(base_values, dtype=float).ravel()
    if not np.isfinite(base).all():
        raise ValueError("base_values contains non-finite values")

    value_rows = _rows(values, "values")
    data_rows = _rows(data, "data")
    names = [str(n) for n in feature_names]

    n_samples = len(value_rows)
    if len(data_rows) != n_samples:
        raise ValueError(
            f"data has {len(data_rows)} Samples but values has {n_samples}"
        )
    if len(base) != n_samples:
        raise ValueError(
            f"base_values has {len(base)} entries but there are {n_samples} Samples"
        )
    for label, rows in (("values", value_rows), ("data", data_rows)):
        for i, row in enumerate(rows):
            if len(row) != len(names):
                raise ValueError(
                    f"{label}[{i}] has {len(row)} Features but feature_names has {len(names)}"
                )

    payload: dict = {
        "contract_version": CONTRACT_VERSION,
        "values": value_rows,
        "base_values": [sigfig(b) for b in base],
        "data": data_rows,
        "feature_names": names,
    }

    if sample_ids is not None:
        sample_ids = [str(s) for s in sample_ids]
        if len(sample_ids) != n_samples:
            raise ValueError(
                f"sample_ids has {len(sample_ids)} entries but there are {n_samples} Samples"
            )
        payload["sample_ids"] = sample_ids
    if output_names is not None:
        payload["output_names"] = [str(n) for n in output_names]
    if model_name:
        payload["model_name"] = str(model_name)
    if model_version:
        payload["model_version"] = str(model_version)

    return payload
