"""KServe multi-model server backed by the ``mlflow_explainable`` contract.

Every model served here is expected to have been logged through
``mlflow_explainable.log_explainable_model`` — i.e. a single ``mlflow.pyfunc``
artifact that bundles the predictor and a SHAP explainer behind a uniform
contract (``predict`` + ``shap_explain``). The runtime no longer needs to
know which framework (sklearn, XGBoost, torch GCN, ...) backs a given model.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import threading
import time
from functools import lru_cache
from io import BytesIO

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

import mlflow  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import shap  # noqa: E402
from flask import Flask, g, jsonify, request  # noqa: E402
from joblib import Memory  # noqa: E402
from mlflow.exceptions import MlflowException  # noqa: E402
from mlflow.server import get_app_client  # noqa: E402

from mlflow_explainable import ExplainableModel  # noqa: E402

from explain_payload import PayloadError, build_payload  # noqa: E402

# Matplotlib uses global pyplot state. Flask serves requests in multiple
# threads by default (threaded=True since Flask 1.0), so concurrent
# /v1/explain/* calls can race on plt.figure() / plt.savefig() / plt.close()
# — producing blank PNGs (~3KB header-only output) for the loser of each
# race. Serializing all plot generation behind one lock fixes this.
_plt_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------
def safe_jsonify(obj):
    def serialize(v):
        if isinstance(v, (str, int, float, bool)) or v is None:
            return v
        elif isinstance(v, dict):
            return {k: serialize(val) for k, val in v.items()}
        elif isinstance(v, list):
            return [serialize(item) for item in v]
        elif hasattr(v, "__dict__"):
            return serialize({k.lstrip("_"): val for k, val in v.__dict__.items()})
        else:
            return str(v)  # fallback to string

    return serialize(obj)


class ShapValueObject:
    """SHAP values for a set of samples, with one base value per sample.

    There is deliberately no scalar ``base_value`` here. Collapsing to sample 0's
    value is correct for TreeExplainer, which tiles one expected value across
    every row, and wrong for the permutation path, which computes one per row —
    see docs/shap-explain-spec.md 1.3. The one consumer that genuinely needs a
    scalar (``waterfall_legacy``) selects the value for the sample it is drawing.
    """

    def __init__(self, shap_df, explanation, base_values):
        self.base_values = np.asarray(base_values, dtype=float)
        self.shap_df = shap_df
        self.explanation = explanation

    def base_value_for(self, subject_id) -> float:
        """The base value of one sample, by its index label."""
        return float(self.base_values[self.shap_df.index.get_loc(subject_id)])


# ---------------------------------------------------------------------------
# MLflow loading — cached on disk so re-invocations across pods don't re-pull
# ---------------------------------------------------------------------------
# Flask API is running inside KServe in Kubernetes, each API call may run in
# a new process, causing MLflow downloads to be re-triggered. Solution: use
# disk-based caching (joblib.Memory) to persist downloaded files across
# requests.
memory = Memory(location="/tmp/cache", verbose=0)


@memory.cache
def load_feature_names_cached(run_id, artifact_path):
    """Load ``feature_names.json`` written by ``log_explainable_model``."""
    local = mlflow.artifacts.download_artifacts(
        artifact_path=artifact_path, run_id=run_id
    )
    with open(local) as f:
        return json.load(f)


@memory.cache
def _load_pyfunc_cached(model_uri):
    return mlflow.pyfunc.load_model(model_uri)


# joblib.Memory is a *disk* cache: every hit hashes the arguments, then reads and
# unpickles the stored value. That is what we want across pod restarts, and far
# too expensive per request — a 200-400 MB torch+shap bundle costs 0.5-1.0 s of
# blocking work before any real work starts. These process-local caches sit in
# front of it, leaving joblib as the cold-start path.
#
# A consequence worth stating: every request now shares one model object instead
# of receiving a freshly unpickled copy. Inference is a read — predictors and
# SHAP explainers do not mutate themselves — so concurrent Flask threads are
# fine, and sharing is the point: warm explainer state survives. A model that
# mutates itself during predict would need a lock here, and none of the
# ExplainableModel implementations do.
_MODEL_CACHE_SIZE = 4
_MODEL_VERSION_TTL_SECONDS = 60

# model_name -> (fetched_at, version, run_id)
_version_cache: dict[str, tuple[float, str, str]] = {}
_version_lock = threading.Lock()
# Model names whose registry lookup is running in the background right now.
_refreshing: set[str] = set()

# One lock per key for work that must not run twice at once: a cold model load
# (a 200-400 MB unpickle per copy) and a model's first registry lookup.
_flight_locks: dict[str, threading.Lock] = {}
_flight_locks_guard = threading.Lock()


def _single_flight(key):
    """The lock that lets only one caller at a time do the work named by ``key``."""
    with _flight_locks_guard:
        return _flight_locks.setdefault(key, threading.Lock())


class NoProductionVersionError(ValueError):
    """The registry answered, and no version of the model is in Production."""


def _start_refresh(target):
    """Run ``target`` off the request thread. Tests replace this to run it inline."""
    threading.Thread(target=target, daemon=True, name="registry-refresh").start()


@lru_cache(maxsize=_MODEL_CACHE_SIZE)
def _load_explainable_cached(model_uri):
    """Load and validate one model version, once per process.

    ``lru_cache`` does not memoize exceptions, so a model that fails the
    contract check is re-examined on the next request rather than being
    remembered as broken.
    """
    logger.info(f"Unpickling {model_uri} (cold: not in the process cache)")
    loaded = _load_pyfunc_cached(model_uri)
    impl = loaded._model_impl.python_model
    if not isinstance(impl, ExplainableModel):
        raise TypeError(
            f"Model '{model_uri}' was not logged via "
            f"mlflow_explainable.log_explainable_model — its python_model is "
            f"{type(impl).__name__} but the runtime requires an ExplainableModel. "
            f"Re-train and log with log_explainable_model() to register a "
            f"compatible version."
        )
    return loaded, impl


@lru_cache(maxsize=_MODEL_CACHE_SIZE)
def _feature_names_cached(run_id, artifact_path):
    """Process-local front for ``load_feature_names_cached``, same reasoning."""
    return load_feature_names_cached(run_id, artifact_path)


def _reset_model_caches():
    """Drop every process-local cache. For tests."""
    _load_explainable_cached.cache_clear()
    _feature_names_cached.cache_clear()
    with _version_lock:
        _version_cache.clear()
        _refreshing.clear()


def _fetch_production_version(model_name):
    """Ask the registry for the Production version and remember the answer.

    Raises whatever the client raises when the registry cannot be reached. When
    it replies that nothing is in Production, the cached entry is dropped and
    ``ValueError`` is raised.
    """
    fetched_at = time.monotonic()
    client = mlflow.tracking.MlflowClient()
    model_versions = client.get_latest_versions(model_name, stages=["Production"])
    if not model_versions:
        with _version_lock:
            _version_cache.pop(model_name, None)
        raise NoProductionVersionError(
            f"No model version for '{model_name}' in Production stage."
        )

    mv = model_versions[-1]
    with _version_lock:
        _version_cache[model_name] = (fetched_at, mv.version, mv.run_id)
    return mv.version, mv.run_id


def _refresh_in_background(model_name):
    """Re-check the registry for ``model_name`` without making anyone wait."""
    with _version_lock:
        if model_name in _refreshing:
            return
        _refreshing.add(model_name)

    def refresh():
        try:
            _fetch_production_version(model_name)
        except NoProductionVersionError as exc:
            logger.warning(f"{exc} Dropped the cached version.")
        except Exception as exc:
            logger.warning(
                f"Registry lookup for '{model_name}' failed ({exc}); still "
                f"serving the cached version."
            )
        finally:
            with _version_lock:
                _refreshing.discard(model_name)

    _start_refresh(refresh)


def _resolve_production_version(model_name):
    """The Production ``(version, run_id)`` for ``model_name``, cached briefly.

    The registry is a remote round trip — the tracking server's /health alone
    took 0.5-1.0 s from the development machine — so no request that already has
    an answer waits for it. Only the first request for a model looks the version
    up inline. After that the cached version is served, and once it is older than
    the TTL a single background refresh re-checks the registry.

    The two failure modes of that refresh are deliberately not treated alike.

    *The registry could not be reached.* Keep serving the cached version — a
    promotion noticed late is a far smaller problem than refusing every request
    while MLflow restarts. With nothing cached there is no answer to give, so
    the first request's error propagates.

    *The registry replied, and nothing is in Production.* That is an answer, not
    an outage, and it usually means someone archived the version on purpose.
    The entry is dropped, so the next request looks it up inline and gets the
    error. The request that started the refresh is still served the old version,
    which it would equally have been a moment earlier.
    """
    with _version_lock:
        cached = _version_cache.get(model_name)
    if cached is None:
        # Concurrent first requests share one lookup: whoever holds the lock
        # fills the cache, and the rest find it filled once they get the lock.
        with _single_flight(f"registry:{model_name}"):
            with _version_lock:
                cached = _version_cache.get(model_name)
            if cached is None:
                return _fetch_production_version(model_name)
        return cached[1], cached[2]

    if time.monotonic() - cached[0] >= _MODEL_VERSION_TTL_SECONDS:
        _refresh_in_background(model_name)
    return cached[1], cached[2]


def load_explainable_model(model_name):
    """Look up the Production version of ``model_name`` and load it as an
    ``ExplainableModel`` (pyfunc-backed)."""
    version, run_id = _resolve_production_version(model_name)
    model_uri = f"models:/{model_name}/{version}"
    # lru_cache does not stop concurrent misses from each loading a copy; the
    # lock does. A warm hit holds it only for the cache lookup.
    with _single_flight(f"load:{model_uri}"):
        loaded, impl = _load_explainable_cached(model_uri)
    return loaded, impl, run_id, version


class ModelLoader:
    def __init__(self, model_name):
        self.model_name = model_name
        self.mlflow_url = os.getenv("MLFLOW_URL", None)
        if not self.mlflow_url:
            raise ValueError("Environment variable 'MLFLOW_URL' is required.")
        mlflow.set_tracking_uri(self.mlflow_url)

    def load(self):
        loaded, impl, run_id, version = load_explainable_model(self.model_name)
        self.version = version
        logger.info(f"Loaded ExplainableModel '{self.model_name}' (run {run_id})")

        try:
            input_columns = _feature_names_cached(
                run_id, "model/artifacts/feature_names.json"
            )
            logger.info(
                f"Loaded feature_names ({len(input_columns)} features) "
                f"e.g. {input_columns[:5]}"
            )
        except Exception as e:
            logger.error(f"Failed to load feature_names.json: {e}")
            input_columns = None

        return loaded, impl, input_columns


# ---------------------------------------------------------------------------
# SHAP — uniform consumption of the contract's ``shap_explain`` output
# ---------------------------------------------------------------------------
def _aggregate_shap_by_genus(
    values: pd.DataFrame | np.ndarray,
    data: np.ndarray,
    feature_names: list,
):
    """Sum SHAP values / abundance within each genus.

    For microbiome data where column names follow ``Genus_species``, the
    per-species view is too granular for GCN-style models that reason at
    the guild/genus level — individual species get tiny SHAP values that
    look like noise even when the model genuinely uses (say) "the
    Fusobacterium genus" as a signal.

    Summing is the right operator because SHAP is additive: per-feature
    sums = ``f(x) - E[f(x)]``, and group sums preserve that, so the
    aggregated waterfall still adds up correctly. ``data`` (used for
    beeswarm color) is summed too = total relative abundance of the genus.
    """
    values = np.asarray(values)
    data = np.asarray(data)
    feature_names = list(feature_names)

    # Map column -> genus, preserving first-seen order so the plot order is
    # stable across requests.
    genera_per_col = [c.split("_")[0] if c else c for c in feature_names]
    seen: list = []
    seen_set: set = set()
    for g in genera_per_col:
        if g not in seen_set:
            seen.append(g)
            seen_set.add(g)

    n_features = len(feature_names)
    n_genera = len(seen)
    # One-hot mask of shape (n_features, n_genera); matrix-mul collapses.
    mask = np.zeros((n_features, n_genera), dtype=np.float32)
    genus_to_idx = {g: i for i, g in enumerate(seen)}
    for i, g in enumerate(genera_per_col):
        mask[i, genus_to_idx[g]] = 1.0

    values_agg = values @ mask
    data_agg = data @ mask
    return values_agg, data_agg, seen


def _positive_class_base(base, n_rows, per_class_values):
    """The positive-class base value(s) out of whatever shape the model returned.

    The ExplainableModel contract allows ``()``, ``(n_classes,)`` or
    ``(n, n_classes)`` whichever shape ``values`` has. With per-class values a
    trailing 2 is always the class axis. With positive-class values a 1-D pair
    is read as per-class too — unless there are exactly two samples, where it is
    indistinguishable from one value per sample and is kept as that.
    """
    base = np.asarray(base, dtype=float)
    if base.ndim == 0:
        return base
    if per_class_values:
        return base[..., 1] if base.shape[-1] == 2 else base
    if base.ndim == 2 and base.shape[1] == 2:
        return base[:, 1]
    if base.ndim == 1 and base.shape[0] == 2 and n_rows != 2:
        return base[1]
    return base


def get_shap_value(impl, X, aggregate_by: str | None = None):
    """Call ``impl.shap_explain(X)`` and reshape into the legacy
    ``ShapValueObject`` so the plotting helpers can stay unchanged.

    ``aggregate_by="genus"`` collapses ``Genus_species`` columns into a
    single per-genus attribution before plotting — recommended for the
    GCN-backed model, where per-species SHAP looks diffuse because the
    GCN aggregates information across the bacterial graph internally.
    """
    out = impl.shap_explain(X)
    values = out["values"]
    base = out["base_values"]
    data = out["data"]

    # Binary classification: shap may return shape (n, features, 2)
    # (one column per class) or (n, features) (positive class only).
    if values.ndim == 3:
        values_class = values[:, :, 1]
    elif values.ndim == 2:
        values_class = values
    else:
        raise ValueError(f"Unsupported SHAP values shape: {values.shape}")
    base_value = _positive_class_base(
        base, values_class.shape[0], per_class_values=values.ndim == 3
    )

    feature_names = list(X.columns)
    patient_ids = X.index

    # Optional aggregation. Done AFTER class selection so we operate on the
    # 2D (n_samples, n_features) matrix the plots actually consume.
    if aggregate_by == "genus":
        values_class, data, feature_names = _aggregate_shap_by_genus(
            values_class, data, feature_names
        )
        logger.info(
            f"aggregated SHAP by genus: {len(feature_names)} genera "
            f"(from {len(X.columns)} species)"
        )

    explanation = shap.Explanation(
        values_class, data=data, feature_names=feature_names
    )
    shap_df = pd.DataFrame(
        values_class, columns=feature_names, index=patient_ids
    )

    # One base value per sample, without assuming they are equal. An unexpected
    # size is a real shape problem — inventing n copies of one value would make
    # every downstream additivity check pass while reporting the wrong number.
    base_arr = np.asarray(base_value, dtype=float).ravel()
    n_rows = values_class.shape[0]
    if base_arr.size == n_rows:
        base_values = base_arr
    elif base_arr.size == 1:
        base_values = np.full(n_rows, base_arr[0])
    else:
        raise ValueError(
            f"base_values has size {base_arr.size} for {n_rows} samples; "
            "expected one per sample or a single shared value"
        )

    return ShapValueObject(shap_df, explanation, base_values)


# ---------------------------------------------------------------------------
# Plot helpers (unchanged from before — operate on ShapValueObject)
# ---------------------------------------------------------------------------
def _is_summary_row(label: str) -> bool:
    """True for SHAP's collapsed "Sum of N other features" row.

    SHAP groups features beyond ``max_display`` into a single summary row.
    That label is not a taxon name, so it must stay upright while every real
    feature label is italicised (species-name convention). Detect it by text
    rather than by index: the summary row's position depends on the feature
    count, and the previous index-based guess also un-italicised the top
    (most important) real feature.
    """
    return "other features" in label.lower()


def get_beeswarm(explanation):
    with _plt_lock:
        plt.ioff()
        plt.figure()
        shap.plots.beeswarm(explanation, max_display=15)
        ax = plt.gca()

        x_min, x_max = ax.get_xlim()
        x_range = x_max - x_min

        yticks = ax.get_yticks()
        yticklabels = [label.get_text() for label in ax.get_yticklabels()]

        ax.set_yticks([])
        ax.set_yticklabels([])
        feature_position = x_min - 0.030 * x_range

        for y, label in zip(yticks, yticklabels):
            ax.text(
                feature_position,
                y,
                label.replace("_", " "),
                fontsize=12,
                fontstyle="normal" if _is_summary_row(label) else "italic",
                verticalalignment="center",
                horizontalalignment="right",
            )

        plt.tight_layout()
        img_buf = BytesIO()
        plt.savefig(img_buf, format="png", bbox_inches="tight")
        img_buf.seek(0)
        img_base64 = base64.b64encode(img_buf.read()).decode("utf-8")
        plt.close()
        return img_base64


def get_heatmap(explanation):
    with _plt_lock:
        shap.plots.heatmap(
            explanation,
            instance_order=explanation.sum(1),
            max_display=15,
            show=False,
        )

        plt.ioff()
        ax = plt.gca()
        yticks = ax.get_yticks()
        yticklabels = [label.get_text() for label in ax.get_yticklabels()]
        ax.set_yticks([])
        ax.set_yticklabels([])

        for y, label in zip(yticks, yticklabels):
            ax.text(
                -1,
                y,
                label.replace("_", " "),
                fontsize=12,
                fontstyle="normal" if _is_summary_row(label) else "italic",
                verticalalignment="center",
                horizontalalignment="right",
            )

        img_buf = BytesIO()
        plt.savefig(img_buf, format="png", bbox_inches="tight")
        img_buf.seek(0)
        img_base64 = base64.b64encode(img_buf.read()).decode("utf-8")
        plt.close()
        return img_base64


def get_local_waterfall_plot(subject_id, shap_value_object):
    with _plt_lock:
        plt.ioff()
        plt.figure()
        max_display = 8
        shap_df = shap_value_object.shap_df
        base_value = shap_value_object.base_value_for(subject_id)
        fig = shap.plots._waterfall.waterfall_legacy(
            base_value,
            shap_df.loc[subject_id],
            show=False,
            features=shap_df.loc[subject_id],
            max_display=max_display,
        )
        ax = fig.gca()
        x_min, x_max = ax.get_xlim()
        x_range = x_max - x_min

        yticks = ax.get_yticks()
        yticklabels = [label.get_text() for label in ax.get_yticklabels()]

        ax.set_yticks([])
        ax.set_yticklabels([])
        feature_position = x_min - 0.030 * x_range

        for y, label in zip(yticks, yticklabels):
            ax.text(
                feature_position,
                y,
                label.replace("_", " "),
                fontsize=12,
                fontstyle="normal" if _is_summary_row(label) else "italic",
                verticalalignment="center",
                horizontalalignment="right",
            )

        plt.tight_layout()
        img_buf = BytesIO()
        plt.savefig(img_buf, format="png")
        img_buf.seek(0)
        img_base64 = base64.b64encode(img_buf.read()).decode("utf-8")
        plt.close()
        return img_base64


def transformer(input_df, input_columns, defualt_value=0):
    """Reshape the client DataFrame so the column set matches what the model
    was trained on (drop extras, fill missing with ``defualt_value``, reorder)
    and coerce every value to numeric.

    Coercion matters: clients send ``dataframe_split`` values over JSON and
    abundance numbers often arrive as strings ("2.73449"). ``predict``
    tolerates this (the model casts internally) but the SHAP masker does
    arithmetic on the raw DataFrame and raises on object dtype. Coercing here
    keeps every downstream consumer — predict and explain — on a purely
    numeric frame.
    """
    if input_columns is None:
        logger.error("No input column information available, returning original DataFrame.")
        return input_df

    transformed_df = input_df.loc[
        :, input_df.columns.intersection(input_columns)
    ].copy()

    # Add missing columns in a single concat (avoids the fragmented-DataFrame
    # PerformanceWarning from inserting columns one at a time in a loop).
    missing_cols = [c for c in input_columns if c not in transformed_df.columns]
    if missing_cols:
        missing_df = pd.DataFrame(
            defualt_value, index=transformed_df.index, columns=missing_cols
        )
        transformed_df = pd.concat([transformed_df, missing_df], axis=1)

    transformed_df = transformed_df[input_columns]
    transformed_df = transformed_df.apply(pd.to_numeric, errors="coerce")
    logger.info("Transformed input DataFrame to match trained model schema")
    return transformed_df


# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
app = Flask(__name__)


def _parse_dataframe_split(req_json):
    # Valid JSON is not necessarily an object: a body of `null` or `[1]` must be
    # the caller's 400, not a TypeError's 500.
    split = req_json.get("dataframe_split") if isinstance(req_json, dict) else None
    if (
        not isinstance(split, dict)
        or "data" not in split
        or "columns" not in split
    ):
        return None, (
            jsonify({
                "error": "Invalid request format. Expecting 'dataframe_split' with 'data' and 'columns'."
            }),
            400,
        )
    columns = req_json["dataframe_split"]["columns"]
    data = req_json["dataframe_split"]["data"]
    # `index` is optional, and honoured by every endpoint as the DataFrame index
    # — so it also sets the `id` each waterfall response reports.
    # /v1/explain/values additionally serializes it as `sample_ids`.
    index = req_json["dataframe_split"].get("index")
    if index is not None and len(index) != len(data):
        return None, (
            jsonify({
                "error": f"dataframe_split.index has {len(index)} entries "
                         f"but data has {len(data)} rows."
            }),
            400,
        )
    return pd.DataFrame(data=data, columns=columns, index=index), None


def _load_model_or_error(model_name):
    """Load a model for an endpoint.

    Returns ``(loaded, impl, input_columns, None)`` on success, or
    ``(None, None, None, (response, status))`` on failure.

    Status semantics:
      * 404 — the model genuinely is not registered / not in Production.
      * 503 — the model exists but could not be loaded (bad artifact, a
        missing runtime dependency such as torch_geometric, an incompatible
        contract, ...). These are server-side problems, not "not found".

    The full traceback is logged in the 503 case so the real cause is
    visible in ``docker logs inference`` instead of being buried in the
    response body.
    """
    try:
        loader = ModelLoader(model_name)
        loaded, impl, input_columns = loader.load()
        # Read back by explain_values, so a payload names the version behind it.
        g.model_version = getattr(loader, "version", None)
        return loaded, impl, input_columns, None
    except NoProductionVersionError as e:
        # Only a registry answer is a 404. Any other ValueError while loading —
        # a malformed artifact, bad feature metadata — is the model failing.
        logger.warning(f"Model '{model_name}' unavailable: {e}")
        return None, None, None, (jsonify({"error": str(e)}), 404)
    except Exception as e:  # noqa: BLE001
        logger.exception(f"Model '{model_name}' failed to load")
        return None, None, None, (
            jsonify({
                "error": f"Model '{model_name}' exists but failed to load: {e}"
            }),
            503,
        )



def _prepare(model_name):
    """Everything the five model endpoints do before they diverge.

    Returns ``(loaded, impl, input_data, None)`` on success, or
    ``(None, None, None, (response, status))`` on failure.

    ``request.get_json()`` is deliberately left outside any ``except`` here. A
    body that is not JSON raises werkzeug's ``BadRequest``, which Flask turns
    into a **400**; previously it was swallowed by each handler's blanket
    ``except Exception`` and reported as a 500. 400 is the honest answer — the
    body is the caller's — and it matters upstream: the chunked explain job
    does not retry 4xx, so a malformed body now fails once instead of being
    retried three times before failing anyway.
    """
    loaded, impl, input_columns, err = _load_model_or_error(model_name)
    if err:
        return None, None, None, err

    input_df, err = _parse_dataframe_split(request.get_json())
    if err:
        return None, None, None, err

    input_data = transformer(input_df, input_columns)

    # transformer() coerces with errors="coerce", so a cell the caller sent as
    # text becomes NaN instead of raising. Only /v1/explain/values used to
    # notice, downstream in build_payload; the plot endpoints drew the NaN and
    # predict handed it to the model. Catching it here makes all five agree,
    # and names the columns so the caller can find the bad data.
    non_finite = input_data.columns[~np.isfinite(input_data.to_numpy()).all(axis=0)]
    if len(non_finite):
        shown = ", ".join(str(c) for c in non_finite[:5])
        more = f" (and {len(non_finite) - 5} more)" if len(non_finite) > 5 else ""
        logger.warning(
            "%s rejected non-numeric input for '%s': %s", request.endpoint, model_name, shown
        )
        return None, None, None, (
            jsonify({
                "error": f"These columns contain values that are not numbers: {shown}{more}."
            }),
            400,
        )

    return loaded, impl, input_data, None


# ---- explain endpoints -----------------------------------------------------
@app.route("/v1/explain/values/<model_name>", methods=["POST"])
def explain_values(model_name):
    """Return SHAP values as JSON — docs/shap-explain-spec.md 1.

    Unlike the three plot endpoints below this holds no matplotlib lock: it is
    pure numerics, so concurrent requests actually run concurrently.
    """
    loaded, impl, input_data, err = _prepare(model_name)
    if err:
        return err

    try:
        aggregate_by = request.args.get("aggregate_by")
        shap_object = get_shap_value(impl, X=input_data, aggregate_by=aggregate_by)

        payload = build_payload(
            values=shap_object.shap_df.values,
            base_values=shap_object.base_values,
            data=shap_object.explanation.data,
            feature_names=list(shap_object.shap_df.columns),
            sample_ids=[str(i) for i in shap_object.shap_df.index],
            model_name=model_name,
            model_version=g.get("model_version"),
        )
        return jsonify(payload)
    except PayloadError as e:
        # The caller sent something transformer() could not coerce to a number.
        # Narrowly typed on purpose: a bare ValueError here would also catch
        # get_shap_value's "unsupported SHAP shape", which is a server fault —
        # and the chunked job upstream does not retry 4xx, so mislabelling it
        # would turn a transient server problem into a permanently failed
        # prediction blamed on the user.
        logger.warning("explain_values rejected input for '%s': %s", model_name, e)
        return jsonify({"error": str(e)}), 400
    except Exception as e:  # noqa: BLE001
        logger.exception("explain_values failed")
        return jsonify({"error": str(e)}), 500


@app.route("/v1/explain/beeswarm/<model_name>", methods=["POST"])
def explain_beeswarm(model_name):
    loaded, impl, input_data, err = _prepare(model_name)
    if err:
        return err

    try:
        aggregate_by = request.args.get("aggregate_by")
        shap_object = get_shap_value(impl, X=input_data, aggregate_by=aggregate_by)
        beeswarm = get_beeswarm(shap_object.explanation)
        return jsonify({"explain": beeswarm})
    except Exception as e:
        logger.exception("explain_beeswarm failed")
        return jsonify({"error": str(e)}), 500


@app.route("/v1/explain/heatmap/<model_name>", methods=["POST"])
def explain_heatmap(model_name):
    loaded, impl, input_data, err = _prepare(model_name)
    if err:
        return err

    try:
        aggregate_by = request.args.get("aggregate_by")
        shap_object = get_shap_value(impl, X=input_data, aggregate_by=aggregate_by)
        heatmap = get_heatmap(shap_object.explanation)
        return jsonify({"explain": heatmap})
    except Exception as e:
        logger.exception("explain_heatmap failed")
        return jsonify({"error": str(e)}), 500


@app.route("/v1/explain/waterfall/<model_name>", methods=["POST"])
def explain_waterfall(model_name):
    loaded, impl, input_data, err = _prepare(model_name)
    if err:
        return err

    try:
        if len(input_data) != 1:
            return jsonify({"error": "Waterfall explanation requires exactly one row of input"}), 400

        aggregate_by = request.args.get("aggregate_by")
        shap_object = get_shap_value(impl, X=input_data, aggregate_by=aggregate_by)
        explain = [
            {
                "id": idx,
                "waterfall": get_local_waterfall_plot(
                    subject_id=idx, shap_value_object=shap_object
                ),
            }
            for idx in input_data.index
        ]
        return jsonify({"explain": explain})
    except Exception as e:
        logger.exception("explain_waterfall failed")
        return jsonify({"error": str(e)}), 500


# ---- predict endpoint ------------------------------------------------------
@app.route("/v1/predict/<model_name>", methods=["POST"])
def predict(model_name):
    loaded, impl, input_data, err = _prepare(model_name)
    if err:
        return err

    try:
        # Uniform contract: pyfunc predict returns DataFrame[Y_proba, Y_class].
        result_df = loaded.predict(input_data)
        # Defensive — in case a subclass returned a different schema.
        if "Y_proba" not in result_df.columns or "Y_class" not in result_df.columns:
            raise ValueError(
                f"Model '{model_name}' predict() did not return the contract "
                f"DataFrame[Y_proba, Y_class]; got columns {list(result_df.columns)}"
            )
        result_df.index = input_data.index

        predictions = [
            {
                "id": idx,
                "proba": float(row["Y_proba"]),
                "class": int(row["Y_class"]),
            }
            for idx, row in result_df.iterrows()
        ]
        return jsonify({"predict": predictions})
    except Exception as e:
        logger.exception("predict failed")
        return jsonify({"error": str(e)}), 500


# ---- model discovery / mlflow ops (unchanged) -----------------------------
@app.route("/v1/models", methods=["GET"])
def list_models():
    from requests.auth import HTTPBasicAuth
    import requests

    mlflow_url = os.environ.get("MLFLOW_URL", None)
    username = os.environ.get("MLFLOW_TRACKING_USERNAME", None)
    password = os.environ.get("MLFLOW_TRACKING_PASSWORD", None)
    if not (mlflow_url and username and password):
        return jsonify({"error": "Missing MLFLOW env vars"}), 400

    url = f"{mlflow_url}/api/2.0/mlflow/registered-models/search"
    resp = requests.get(url, auth=HTTPBasicAuth(username, password))
    if resp.status_code != 200:
        return jsonify({"error": resp.text}), resp.status_code

    data = resp.json()
    registered_models = data.get("registered_models", [])

    mlflow.set_tracking_uri(mlflow_url)
    client = mlflow.tracking.MlflowClient()

    production_model = []
    for model in registered_models:
        latest_versions = model.get("latest_versions", [])
        for version in latest_versions:
            if version.get("current_stage") == "Production":
                run_id = version.get("run_id")
                try:
                    run = client.get_run(run_id)
                    version["metrics"] = run.data.metrics
                except Exception:
                    version["metrics"] = {}
                production_model.append(version)
    return jsonify(production_model)


@app.route("/v1/mlflow/tracking_uri", methods=["GET"])
def get_mlflow_tracking_uri():
    mlflow_url = os.environ.get("MLFLOW_URL", None)
    return jsonify({"url": mlflow_url})


@app.route("/v1/mlflow/experiments", methods=["GET"])
def get_mlflow_experiments():
    mlflow_url = os.environ.get("MLFLOW_URL", None)
    mlflow.set_tracking_uri(mlflow_url)
    client = mlflow.tracking.MlflowClient()
    experiments = client.search_experiments()
    experiment_list = [
        {k.lstrip("_"): v for k, v in exp.__dict__.items()} for exp in experiments
    ]
    return jsonify({"experiments": experiment_list})


@app.route("/v1/mlflow/experiments/description/<experiment_id>", methods=["POST"])
def update_experiments_description(experiment_id):
    data = request.get_json()
    description = data.get("description")
    mlflow_url = os.environ.get("MLFLOW_URL", None)
    mlflow.set_tracking_uri(mlflow_url)
    client = mlflow.tracking.MlflowClient()
    client.set_experiment_tag(experiment_id, "mlflow.note.content", description)
    return jsonify({"status": 200})


@app.route("/v1/mlflow/experiment/<experiment_id>", methods=["GET"])
def get_experiment_runs(experiment_id):
    order_by = request.args.get("order_by", "start_time DESC")
    page_token = request.args.get("page_token", None)
    if not order_by:
        order_by = "start_time DESC"

    mlflow_url = os.environ.get("MLFLOW_URL", None)
    mlflow.set_tracking_uri(mlflow_url)
    client = mlflow.tracking.MlflowClient()
    runs = client.search_runs(
        experiment_ids=[experiment_id],
        order_by=[order_by],
        max_results=100,
        page_token=page_token,
    )

    result = []
    for run in runs:
        metrics = dict(run.data.metrics)
        parameters = dict(run.data.params)
        result.append({
            "data": {"metrics": metrics, "parameters": parameters},
            "info": {k.lstrip("_"): v for k, v in run.info.__dict__.items()},
        })
    return jsonify({"runs": result, "nextPageToken": runs.token})


@app.route("/v1/mlflow/run/<run_id>", methods=["GET"])
def get_mlflow_run(run_id):
    mlflow_url = os.environ.get("MLFLOW_URL", None)
    mlflow.set_tracking_uri(mlflow_url)
    client = mlflow.tracking.MlflowClient()
    run = client.get_run(run_id)

    models = client.search_model_versions(f"run_id='{run.info.run_id}'")
    model_list = [
        {k.lstrip("_"): v for k, v in model.__dict__.items()} for model in models
    ]

    metrics = dict(run.data.metrics)
    parameters = dict(run.data.params)

    result = {
        "data": {"metrics": metrics, "parameters": parameters},
        "models": model_list,
        "info": {k.lstrip("_"): v for k, v in run.info.__dict__.items()},
    }
    return jsonify({"run": result})


@app.route("/v1/mlflow/run/<run_id>/stage", methods=["PUT"])
def update_model_stage_by_run_id(run_id):
    data = request.get_json()
    stage = data.get("stage", None)
    description = data.get("description", None)
    archive_existing_versions = data.get("archive_existing_versions", False)

    if stage not in ["None", "Staging", "Production", "Archived"]:
        return jsonify({"status": "error", "message": "Invalid stage value"}), 400

    mlflow_url = os.environ.get("MLFLOW_URL", None)
    mlflow.set_tracking_uri(mlflow_url)
    client = mlflow.tracking.MlflowClient()

    # Failures carry real status codes: the Nest service treats any 2xx as
    # success, so a 200 with "status": "error" reached the page as published.
    models = client.search_model_versions(f"run_id='{run_id}'")
    if not models:
        return jsonify({"status": "error", "message": f"No model found for Run ID: {run_id}"}), 404
    try:
        model_name = models[0].name
        version = models[0].version
        client.transition_model_version_stage(
            name=model_name,
            version=version,
            stage=stage,
            archive_existing_versions=archive_existing_versions,
        )
        if description:
            client.update_model_version(
                name=model_name, version=version, description=description
            )
        return jsonify({
            "status": "success",
            "message": f"Model '{model_name}' version '{version}' transitioned to '{stage}'.",
        })
    except MlflowException as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/v1/mlflow/model/<model_name>/version/<version>/description", methods=["PUT"])
def update_model_version_description(model_name, version):
    data = request.get_json()
    description = data.get("description", None)
    if not description:
        return jsonify({"status": "error", "message": "Missing 'description' field"}), 400

    mlflow_url = os.environ.get("MLFLOW_URL", None)
    mlflow.set_tracking_uri(mlflow_url)
    client = mlflow.tracking.MlflowClient()
    try:
        client.update_model_version(
            name=model_name, version=version, description=description
        )
        return jsonify({
            "status": "success",
            "message": f"Description updated for model '{model_name}', version '{version}'",
            "model_name": model_name,
            "version": version,
            "description": description,
        })
    except MlflowException as e:
        return jsonify({"status": "error", "message": str(e)}), 500


@app.route("/v1/mlflow/registered-models", methods=["GET"])
def get_registered_models():
    from requests.auth import HTTPBasicAuth
    import requests

    mlflow_url = os.environ.get("MLFLOW_URL", None)
    username = os.environ.get("MLFLOW_TRACKING_USERNAME", None)
    password = os.environ.get("MLFLOW_TRACKING_PASSWORD", None)
    if not (mlflow_url and username and password):
        return jsonify({"error": "Missing MLFLOW env vars"}), 400

    url = f"{mlflow_url}/api/2.0/mlflow/registered-models/search"
    resp = requests.get(url, auth=HTTPBasicAuth(username, password))
    if resp.status_code != 200:
        return jsonify({"error": resp.text}), resp.status_code

    data = resp.json()
    registered_models = data.get("registered_models", [])
    return jsonify({"registered_models": registered_models})


@app.route("/v1/mlflow/run/<run_id>/register", methods=["POST"])
def register_model_by_run_id(run_id):
    """Register a logged model from a run as a Registered Model."""
    data = request.get_json() or {}
    name = data.get("name")
    description = data.get("description", "")
    artifact_path = data.get("artifact_path", "model")
    if not name:
        return jsonify({"status": "error", "message": "Missing 'name' field"}), 400

    mlflow_url = os.environ.get("MLFLOW_URL", None)
    mlflow.set_tracking_uri(mlflow_url)
    client = mlflow.tracking.MlflowClient()

    try:
        client.get_run(run_id)
    except MlflowException as e:
        return jsonify({"status": "error", "message": f"Run not found: {e}"}), 404

    try:
        model_uri = f"runs:/{run_id}/{artifact_path}"
        mv = mlflow.register_model(model_uri=model_uri, name=name)
        if description:
            client.update_model_version(
                name=mv.name, version=mv.version, description=description
            )
        return jsonify({
            "status": "success",
            "name": mv.name,
            "version": mv.version,
            "run_id": run_id,
            "source": mv.source,
        })
    except MlflowException as e:
        return jsonify({"status": "error", "message": str(e)}), 500


# ---- MLflow auth -----------------------------------------------------------
@app.route("/v1/mlflow/user", methods=["POST"])
def create_mlflow_user():
    data = request.get_json()
    username = data.get("username")
    password = data.get("password")
    tracking_uri = os.environ.get("MLFLOW_URL", None)
    auth_client = get_app_client("basic-auth", tracking_uri=tracking_uri)
    user = auth_client.create_user(username=username, password=password)
    return jsonify({"user": safe_jsonify(user)})


@app.route("/v1/mlflow/user", methods=["PUT"])
def update_mlflow_user():
    data = request.get_json()
    username = data.get("username")
    password = data.get("password")
    tracking_uri = os.environ.get("MLFLOW_URL", None)
    auth_client = get_app_client("basic-auth", tracking_uri=tracking_uri)
    user = auth_client.update_user_password(username=username, password=password)
    return jsonify({"user": safe_jsonify(user)})


@app.route("/v1/mlflow/user/<username>", methods=["GET"])
def get_mlflow_user(username):
    tracking_uri = os.environ.get("MLFLOW_URL", None)
    auth_client = get_app_client("basic-auth", tracking_uri=tracking_uri)
    user = auth_client.get_user(username=username)
    return jsonify({"user": safe_jsonify(user)})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)
