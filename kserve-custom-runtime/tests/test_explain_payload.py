import math

import numpy as np
import pytest

from explain_payload import CONTRACT_VERSION, build_payload, sigfig


def test_sigfig_rounds_to_four_significant_figures():
    assert sigfig(0.000123456) == 0.0001235
    assert sigfig(123456.0) == 123500.0
    assert sigfig(-0.000987654) == -0.0009877


def test_sigfig_keeps_exact_zero():
    assert sigfig(0.0) == 0.0
    assert sigfig(-0.0) == 0.0


def test_build_payload_shape_and_version():
    p = build_payload(
        values=np.array([[1.0, -2.0], [3.0, 4.0]]),
        base_values=np.array([0.5, 0.5]),
        data=np.array([[0.1, 0.2], [0.3, 0.4]]),
        feature_names=["a", "b"],
        sample_ids=["s1", "s2"],
    )
    assert p["contract_version"] == CONTRACT_VERSION
    assert p["values"] == [[1.0, -2.0], [3.0, 4.0]]
    assert p["base_values"] == [0.5, 0.5]
    assert p["data"] == [[0.1, 0.2], [0.3, 0.4]]
    assert p["sample_ids"] == ["s1", "s2"]


def test_optional_fields_are_absent_when_not_supplied():
    p = build_payload(
        values=np.array([[1.0]]),
        base_values=np.array([0.0]),
        data=np.array([[0.0]]),
        feature_names=["a"],
    )
    assert set(p) == {"contract_version", "values", "base_values", "data", "feature_names"}


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_build_payload_rejects_non_finite_values(bad):
    with pytest.raises(ValueError, match="non-finite"):
        build_payload(
            values=np.array([[bad]]),
            base_values=np.array([0.0]),
            data=np.array([[0.0]]),
            feature_names=["a"],
        )


def test_build_payload_rejects_non_finite_base_values():
    with pytest.raises(ValueError, match="non-finite"):
        build_payload(
            values=np.array([[1.0]]),
            base_values=np.array([math.nan]),
            data=np.array([[0.0]]),
            feature_names=["a"],
        )


def test_base_values_stay_per_sample_when_they_differ():
    """The bug this contract exists to prevent: collapsing to Sample 0's value."""
    p = build_payload(
        values=np.array([[1.0], [1.0]]),
        base_values=np.array([0.1, 0.9]),
        data=np.array([[0.0], [0.0]]),
        feature_names=["a"],
    )
    assert p["base_values"] == [0.1, 0.9]


def test_rejects_row_length_mismatch():
    with pytest.raises(ValueError, match="Features but feature_names"):
        build_payload(
            values=np.array([[1.0, 2.0]]),
            base_values=np.array([0.0]),
            data=np.array([[0.0, 0.0]]),
            feature_names=["a"],
        )


def test_rejects_sample_count_mismatch():
    with pytest.raises(ValueError, match="base_values has 1 entries but there are 2"):
        build_payload(
            values=np.array([[1.0], [2.0]]),
            base_values=np.array([0.0]),
            data=np.array([[0.0], [0.0]]),
            feature_names=["a"],
        )


def test_payload_is_json_serializable_without_allow_nan():
    """json.dumps(..., allow_nan=False) is what a strict JSON consumer effectively does."""
    import json

    p = build_payload(
        values=np.array([[1.0, -2.0]]),
        base_values=np.array([0.5]),
        data=np.array([[0.1, 0.2]]),
        feature_names=["a", "b"],
    )
    json.dumps(p, allow_nan=False)
