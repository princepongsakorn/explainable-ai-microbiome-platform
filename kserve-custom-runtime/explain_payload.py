"""Build the Explanation payload described in ``docs/shap-explain-spec.md`` §1.

The payload's core fields are named exactly as ``shap.Explanation`` names them, so any
Python user with shap installed can produce one without reading our documentation. The
platform's own extras (``sample_ids``, ``model_name``, ``model_version``) are optional —
``shap-svg`` renders without them.
"""

from __future__ import annotations

import numpy as np

CONTRACT_VERSION = 1


class PayloadError(ValueError):
    """The caller's data cannot be expressed as a valid payload.

    Distinct from the ValueErrors raised elsewhere in the runtime for server-side
    shape problems, so an endpoint can map this to 4xx and those to 5xx.
    """

#: Spec §1.4. Four significant figures is below the resolution of an ~800 px wide chart,
#: and after gzip it beats a float32/base64 encoding while staying readable in a fixture.
DEFAULT_SIGNIFICANT_DIGITS = 4


def _round_significant(arr: np.ndarray, digits: int) -> np.ndarray:
    """Vectorised equivalent of applying ``sigfig`` element-wise.

    Measured 8x faster than the scalar comprehension on a 500x865 matrix (304 ms ->
    38 ms) with byte-identical JSON output across 600k realistic values. Two inputs
    round differently from ``"%.4g"``: an exact decimal tie (9.9995) and values within
    a few ulp of the float ceiling. Both differ by far less than the 4-significant-
    figure resolution this exists to provide.
    """
    with np.errstate(divide="ignore", invalid="ignore"):
        exponent = np.floor(np.log10(np.abs(arr)))
    # log10(0) is -inf; zeros need no scaling.
    exponent[~np.isfinite(exponent)] = 0.0
    factor = np.power(10.0, digits - 1 - exponent)
    return np.round(arr * factor) / factor


def sigfig(x: float, digits: int = DEFAULT_SIGNIFICANT_DIGITS) -> float:
    """Round one value to ``digits`` significant figures, JSON-safe.

    Delegates to the vectorised form so the whole system rounds by exactly one rule.
    An earlier "%.*g" implementation disagreed with it on last-digit ties (0.2155 vs
    0.2156 — one unit in the 4th significant figure), which would have meant the
    golden fixtures and the payloads they validate rounding differently.
    """
    x = float(x)
    if x == 0.0:
        return 0.0
    return float(_round_significant(np.asarray([x], dtype=float), digits)[0])


def _rows(matrix, name: str, digits: int = DEFAULT_SIGNIFICANT_DIGITS) -> list[list[float]]:
    """Round a 2-D array, refusing anything JSON cannot represent.

    ``NaN`` and ``Infinity`` are not valid JSON, and Flask's default provider emits them
    bare, which ``JSON.parse`` then rejects. The upload path prevents them reaching here
    (spec §2.1), but ``transformer()`` in the runtime manufactures NaN itself via
    ``pd.to_numeric(errors="coerce")`` — so this catches a failure originating in our
    own process, not only a caller's.
    """
    arr = np.asarray(matrix, dtype=float)
    if arr.ndim != 2:
        raise PayloadError(f"{name} must be 2-dimensional, got shape {arr.shape}")
    if not np.isfinite(arr).all():
        bad = int(np.count_nonzero(~np.isfinite(arr)))
        raise PayloadError(
            f"{name} contains {bad} non-finite value(s); the payload must be valid JSON"
        )
    return _round_significant(arr, digits).tolist()


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
    # reshape(1, -1) accepts a scalar, a 1-D array or an (n, 1) column alike.
    base_row = _rows(np.asarray(base_values, dtype=float).reshape(1, -1), "base_values")[0]
    value_rows = _rows(values, "values")
    data_rows = _rows(data, "data")
    names = [str(n) for n in feature_names]

    n_samples = len(value_rows)
    if np.ndim(base_values) == 0 and n_samples > 1:
        # A bare scalar is the documented shape for one base value every Sample
        # shares. A one-element list is not: that is a count mismatch.
        base_row = base_row * n_samples
    if len(data_rows) != n_samples:
        raise PayloadError(
            f"data has {len(data_rows)} Samples but values has {n_samples}"
        )
    if len(base_row) != n_samples:
        raise PayloadError(
            f"base_values has {len(base_row)} entries but there are {n_samples} Samples"
        )
    # _rows guarantees a rectangular float array, so checking row 0 checks them all.
    for label, rows in (("values", value_rows), ("data", data_rows)):
        if rows and len(rows[0]) != len(names):
            raise PayloadError(
                f"{label}[0] has {len(rows[0])} Features but feature_names has {len(names)}"
            )

    payload: dict = {
        "contract_version": CONTRACT_VERSION,
        "values": value_rows,
        "base_values": base_row,
        "data": data_rows,
        "feature_names": names,
    }

    if sample_ids is not None:
        sample_ids = [str(s) for s in sample_ids]
        if len(sample_ids) != n_samples:
            raise PayloadError(
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
