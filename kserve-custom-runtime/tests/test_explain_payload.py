import json
import math

import numpy as np
import pytest

from explain_payload import CONTRACT_VERSION, PayloadError, build_payload, sigfig


def one_by_one(**overrides):
    """A minimal valid payload, so each test shows only the field it varies."""
    kwargs = dict(
        values=[[1.0]], base_values=[0.0], data=[[0.0]], feature_names=["a"]
    )
    return build_payload(**{**kwargs, **overrides})


def test_sigfig_rounds_to_four_significant_figures():
    assert sigfig(0.000123456) == 0.0001235
    assert sigfig(123456.0) == 123500.0
    assert sigfig(-0.000987654) == -0.0009877


def test_sigfig_normalises_negative_zero():
    assert sigfig(0.0) == 0.0
    # -0.0 == 0.0 is True, so compare the sign bit — otherwise this assertion
    # passes even if the early return that normalises it is deleted.
    assert math.copysign(1.0, sigfig(-0.0)) == 1.0


def test_a_scalar_base_value_is_shared_by_every_sample():
    p = build_payload(
        values=[[1.0], [2.0], [3.0]],
        base_values=0.5,
        data=[[0.0], [0.0], [0.0]],
        feature_names=["a"],
    )
    assert p["base_values"] == [0.5, 0.5, 0.5]


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
    p = one_by_one()
    assert set(p) == {"contract_version", "values", "base_values", "data", "feature_names"}


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf])
def test_build_payload_rejects_non_finite_values(bad):
    with pytest.raises(PayloadError, match="non-finite"):
        one_by_one(values=[[bad]])


def test_build_payload_rejects_non_finite_base_values():
    with pytest.raises(PayloadError, match="non-finite"):
        one_by_one(base_values=[math.nan])


def test_payload_error_is_a_value_error():
    """Callers that only know ValueError keep working; endpoints can be narrower."""
    assert issubclass(PayloadError, ValueError)


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
    with pytest.raises(PayloadError, match="Features but feature_names"):
        one_by_one(values=[[1.0, 2.0]], data=[[0.0, 0.0]])


def test_rejects_sample_count_mismatch():
    with pytest.raises(PayloadError, match="base_values has 1 entries but there are 2"):
        one_by_one(values=[[1.0], [2.0]], data=[[0.0], [0.0]])


def test_payload_is_json_serializable_without_allow_nan():
    """json.dumps(..., allow_nan=False) is what a strict JSON consumer effectively does."""
    p = build_payload(
        values=np.array([[1.0, -2.0]]),
        base_values=np.array([0.5]),
        data=np.array([[0.1, 0.2]]),
        feature_names=["a", "b"],
    )
    json.dumps(p, allow_nan=False)
