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
from io import BytesIO

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

import mlflow  # noqa: E402
import pandas as pd  # noqa: E402
import shap  # noqa: E402
from flask import Flask, jsonify, request  # noqa: E402
from joblib import Memory  # noqa: E402
from mlflow.exceptions import MlflowException  # noqa: E402
from mlflow.server import get_app_client  # noqa: E402

from mlflow_explainable import ExplainableModel  # noqa: E402

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
    def __init__(self, base_value, shap_df, explanation):
        self.base_value = base_value
        self.shap_df = shap_df
        self.explanation = explanation


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


def load_explainable_model(model_name):
    """Look up the Production version of ``model_name`` and load it as an
    ``ExplainableModel`` (pyfunc-backed)."""
    client = mlflow.tracking.MlflowClient()
    model_versions = client.get_latest_versions(model_name, stages=["Production"])
    if not model_versions:
        raise ValueError(
            f"No model version for '{model_name}' in Production stage."
        )
    mv = model_versions[-1]
    version = mv.version
    run_id = mv.run_id
    model_uri = f"models:/{model_name}/{version}"

    loaded = _load_pyfunc_cached(model_uri)
    impl = loaded._model_impl.python_model
    if not isinstance(impl, ExplainableModel):
        raise TypeError(
            f"Model '{model_name}' (version {version}) was not logged via "
            f"mlflow_explainable.log_explainable_model — its python_model is "
            f"{type(impl).__name__} but the runtime requires an ExplainableModel. "
            f"Re-train and log with log_explainable_model() to register a "
            f"compatible version."
        )
    return loaded, impl, run_id


class ModelLoader:
    def __init__(self, model_name):
        self.model_name = model_name
        self.mlflow_url = os.getenv("MLFLOW_URL", None)
        if not self.mlflow_url:
            raise ValueError("Environment variable 'MLFLOW_URL' is required.")
        mlflow.set_tracking_uri(self.mlflow_url)

    def load(self):
        loaded, impl, run_id = load_explainable_model(self.model_name)
        logger.info(f"Loaded ExplainableModel '{self.model_name}' (run {run_id})")

        try:
            input_columns = load_feature_names_cached(
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
    values: pd.DataFrame | "np.ndarray",  # noqa: F821
    data: "np.ndarray",  # noqa: F821
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
    import numpy as np

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
        # base_values shape can be () / (2,) / (n, 2) depending on the
        # explainer. Pick the positive-class index when present.
        if hasattr(base, "ndim") and base.ndim >= 1:
            base_value = base[..., 1] if base.shape[-1] == 2 else base
        else:
            base_value = base
    elif values.ndim == 2:
        values_class = values
        base_value = base
    else:
        raise ValueError(f"Unsupported SHAP values shape: {values.shape}")

    # When ``base_value`` is per-sample, the legacy waterfall helper expects
    # a scalar — use the first sample's value (they're usually identical).
    if hasattr(base_value, "ndim") and base_value.ndim >= 1:
        base_scalar = float(base_value.ravel()[0])
    else:
        base_scalar = float(base_value)

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
    return ShapValueObject(base_scalar, shap_df, explanation)


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
        base_value = shap_value_object.base_value
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
    if (
        "dataframe_split" not in req_json
        or "data" not in req_json["dataframe_split"]
        or "columns" not in req_json["dataframe_split"]
    ):
        return None, (
            jsonify({
                "error": "Invalid request format. Expecting 'dataframe_split' with 'data' and 'columns'."
            }),
            400,
        )
    columns = req_json["dataframe_split"]["columns"]
    data = req_json["dataframe_split"]["data"]
    return pd.DataFrame(data=data, columns=columns), None


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
        loaded, impl, input_columns = ModelLoader(model_name).load()
        return loaded, impl, input_columns, None
    except ValueError as e:
        # Raised by load_explainable_model when there is no Production version.
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


# ---- explain endpoints -----------------------------------------------------
@app.route("/v1/explain/beeswarm/<model_name>", methods=["POST"])
def explain_beeswarm(model_name):
    loaded, impl, input_columns, err = _load_model_or_error(model_name)
    if err:
        return err

    try:
        req_json = request.get_json()
        input_df, err = _parse_dataframe_split(req_json)
        if err:
            return err
        input_data = transformer(input_df, input_columns)

        # Query param ?aggregate_by=genus collapses Genus_species columns
        # into single per-genus attributions — recommended for GCN models.
        aggregate_by = request.args.get("aggregate_by")
        shap_object = get_shap_value(impl, X=input_data, aggregate_by=aggregate_by)
        beeswarm = get_beeswarm(shap_object.explanation)
        return jsonify({"explain": beeswarm})
    except Exception as e:
        logger.exception("explain_beeswarm failed")
        return jsonify({"error": str(e)}), 500


@app.route("/v1/explain/heatmap/<model_name>", methods=["POST"])
def explain_heatmap(model_name):
    loaded, impl, input_columns, err = _load_model_or_error(model_name)
    if err:
        return err

    try:
        req_json = request.get_json()
        input_df, err = _parse_dataframe_split(req_json)
        if err:
            return err
        input_data = transformer(input_df, input_columns)

        # Query param ?aggregate_by=genus collapses Genus_species columns
        # into single per-genus attributions — recommended for GCN models.
        aggregate_by = request.args.get("aggregate_by")
        shap_object = get_shap_value(impl, X=input_data, aggregate_by=aggregate_by)
        heatmap = get_heatmap(shap_object.explanation)
        return jsonify({"explain": heatmap})
    except Exception as e:
        logger.exception("explain_heatmap failed")
        return jsonify({"error": str(e)}), 500


@app.route("/v1/explain/waterfall/<model_name>", methods=["POST"])
def explain_waterfall(model_name):
    loaded, impl, input_columns, err = _load_model_or_error(model_name)
    if err:
        return err

    try:
        req_json = request.get_json()
        input_df, err = _parse_dataframe_split(req_json)
        if err:
            return err
        input_data = transformer(input_df, input_columns)

        if len(input_data) != 1:
            return jsonify({"error": "Waterfall explanation requires exactly one row of input"}), 400

        # Query param ?aggregate_by=genus collapses Genus_species columns
        # into single per-genus attributions — recommended for GCN models.
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
    loaded, impl, input_columns, err = _load_model_or_error(model_name)
    if err:
        return err

    try:
        req_json = request.get_json()
        input_df, err = _parse_dataframe_split(req_json)
        if err:
            return err
        input_data = transformer(input_df, input_columns)

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

    models = client.search_model_versions(f"run_id='{run_id}'")
    if not models:
        return {"status": "error", "message": f"No model found for Run ID: {run_id}"}
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
        return {"status": "error", "message": str(e)}


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
