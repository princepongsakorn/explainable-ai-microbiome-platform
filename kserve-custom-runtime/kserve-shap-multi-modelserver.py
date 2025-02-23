import joblib
import mlflow
import shap
import logging

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

import base64
from io import BytesIO
import os
import json

from flask import Flask, request, jsonify
from joblib import Memory

class ShapValueObject:
    def __init__(self, base_value, shap_df, explanation):
        self.base_value = base_value
        self.shap_df = shap_df
        self.explanation = explanation

# Define a persistent disk-based cache directory
# Flask API is running inside KServe in Kubernetes, each API call may run in a new process, causing MLflow downloads to be re-triggered.
# Solution: Use disk-based caching (joblib.Memory) to persist downloaded files across requests.
# CACHE_DIR = "/tmp/mlflow_cache"
# memory = Memory(CACHE_DIR, verbose=0)
class ModelLoader:
    def __init__(self, model_name):
        """Initialize the model loader with the given model name."""
        self.model_name = model_name
        self.mlflow_url = os.getenv("MLFLOW_URL", None)

        if not self.mlflow_url:
            raise ValueError("Environment variable 'MLFLOW_URL' is required.")

        mlflow.set_tracking_uri(self.mlflow_url)
        self.client = mlflow.tracking.MlflowClient()

    # Cache results persistently
    # @memory.cache
    def load_input_columns(self, run_id, artifact_path="model/input_example.json"):
        """Download and parse `input_example.json` from MLflow Artifacts."""
        try:
            input_example_path = mlflow.artifacts.download_artifacts(artifact_path=artifact_path, run_id=run_id)
            with open(input_example_path, "r") as f:
                input_example = json.load(f)

            input_columns = input_example["columns"]
            logger.info(f"✅ Cached input columns: {input_columns[:5]} ... (total {len(input_columns)} features)")
            return input_columns
        except Exception as e:
            logger.error(f"model/input_example.json not found in for run_id {run_id}, skipping. Error: {str(e)}")
            return None
        
    # Cache results persistently
    # @memory.cache  
    def load_explainer(self, run_id, artifact_path="shap_explainer/shap_explainer.pkl"):
        """Download `shap_explainer.pkl` separately from its own directory in MLflow Artifacts."""
        try:
            explainer_path = mlflow.artifacts.download_artifacts(artifact_path=artifact_path, run_id=run_id)
            with open(explainer_path, "rb") as f:
                explainer = joblib.load(f)

            logger.info(f"✅ Cached SHAP Explainer for run_id {run_id}")
            return explainer
        except Exception as e:
            logger.error(f"⚠️ shap_explainer.pkl not found for run_id {run_id}, skipping. Error: {str(e)}")
            return None
        
    # Cache results persistently     
    # @memory.cache  
    def load_model(self):
        """Load the latest model version from MLflow Model Registry (cached)."""
        model_versions = self.client.get_latest_versions(self.model_name, stages=["Production"])
        if not model_versions:
            raise ValueError(f"❌ No model version for '{self.model_name}' in Production stage.")

        # Get the latest registered version in Production
        model_version_info = model_versions[-1]
        version = model_version_info.version
        run_id = model_version_info.run_id
        logger.info(f"✅ Using cached Production version: {version} (Run ID: {run_id})")

        # Load model from MLflow Model Registry
        model_uri = f"models:/{self.model_name}/{version}"
        logger.info(f"🔄 Loading cached model from MLflow Registry: {model_uri}")
        model = mlflow.sklearn.load_model(model_uri)
        logger.info(f"✅ Model {self.model_name} (Version {version}) cached successfully!")

        return model, run_id

    def load(self):
        model, run_id = self.load_model()
        input_columns = self.load_input_columns(run_id)
        explainer = self.load_explainer(run_id)
        return model, input_columns, explainer

# Shap function
def get_shap_value(explainer, X):
    shap_values = explainer.shap_values(X)
    
    if len(shap_values.shape) == 3: # Multiclass Classification
        shap_values_class = shap_values[:, :, 1]
        base_value = explainer.expected_value[1]
    elif len(shap_values.shape) == 2: # Binary Classification
        shap_values_class = shap_values
        base_value = explainer.expected_value
    else:
        raise ValueError(f"Unsupported SHAP values shape: {shap_values.shape}")

    feature_names = X.columns
    patient_ids = X.index

    explanation = shap.Explanation(shap_values_class, data=X.values, feature_names=feature_names)
    shap_df = pd.DataFrame(shap_values_class, columns=feature_names, index=patient_ids)

    return ShapValueObject(base_value, shap_df, explanation)

def get_beeswarm(explanation):
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

        for i, (y, label) in enumerate(zip(yticks, yticklabels)):
            ax.text(
                feature_position,
                y,
                label.replace("_", " "),
                fontsize=12,
                fontstyle="italic" if i not in (0, len(yticklabels) - 1) else "normal",
                verticalalignment="center",
                horizontalalignment="right"
            )

        plt.tight_layout()    
        img_buf = BytesIO()
        plt.savefig(img_buf, format='png', bbox_inches='tight')
        img_buf.seek(0)

        # Convert the BytesIO object to base64
        img_base64 = base64.b64encode(img_buf.read()).decode("utf-8")
        plt.close()
        return img_base64
    
def get_heatmap(explanation): 
    plt.ioff()
    shap.plots.heatmap(explanation, instance_order=explanation.sum(1), max_display=15, show=False)

    ax = plt.gca()
    yticks = ax.get_yticks()
    yticklabels = [label.get_text() for label in ax.get_yticklabels()]
    ax.set_yticks([])
    ax.set_yticklabels([])

    for i, (y, label) in enumerate(zip(yticks, yticklabels)):
        ax.text(
            -1,
            y,
            label.replace("_", " "),
            fontsize=12,
            fontstyle="italic" if i not in (0, len(yticklabels) - 1) else "normal",
            verticalalignment="center",
            horizontalalignment="right"
        )

    img_buf = BytesIO()
    plt.savefig(img_buf, format='png', bbox_inches='tight')
    img_buf.seek(0)

    # Convert the BytesIO object to base64
    img_base64 = base64.b64encode(img_buf.read()).decode("utf-8")
    plt.close()
    return img_base64

def get_local_waterfall_plot(subject_id, shap_value_object):
    plt.ioff()
    plt.figure()
    max_display=8
    shap_df=shap_value_object.shap_df
    base_value = shap_value_object.base_value
    fig = shap.plots._waterfall.waterfall_legacy(base_value, shap_df.loc[subject_id],
                                        show=False, features=shap_df.loc[subject_id], max_display=max_display)
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
            fontstyle="italic" if label != yticklabels[0] else "normal",
            verticalalignment="center",
            horizontalalignment="right"
        )
        
    plt.tight_layout()
    img_buf = BytesIO()
    plt.savefig(img_buf, format='png')
    img_buf.seek(0)

    # Convert the BytesIO object to base64
    img_base64 = base64.b64encode(img_buf.read()).decode("utf-8")
    plt.close()
    return img_base64

def transformer(input_df, input_columns, defualt_value = 0):
    """
    Transform input DataFrame to match the trained model's expected input format.
    - Remove extra columns that were not used in training
    - Add missing columns with a default value of defualt_value (0)
    - Ensure column order matches the model
    """
    if input_columns is None:
        logger.error("⚠️ No input column information available, returning original DataFrame.")
        return input_df

    # Step 1: Remove extra columns that were not used during training
    transformed_df = input_df.loc[:, input_df.columns.intersection(input_columns)].copy()

    # Step 2: Add missing columns with default value defualt_value
    missing_cols = set(input_columns) - set(transformed_df.columns)
    for col in missing_cols:
        transformed_df[col] = defualt_value

    # Step 3: Ensure column order matches the trained model
    transformed_df = transformed_df[input_columns]

    logger.info("✅ Transformed input DataFrame to match trained model")
    return transformed_df

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
app = Flask(__name__)

@app.route("/v1/explain/beeswarm/<model_name>", methods=["POST"])
def predict_beeswarm(model_name):
    model_loader = ModelLoader(model_name)
    model, input_columns, explainer = model_loader.load()
    return jsonify({"result": "base64"})

@app.route("/v1/explain/heatmap/<model_name>", methods=["POST"])
def predict_heatmap(model_name):
    model_loader = ModelLoader(model_name)
    model, input_columns, explainer = model_loader.load()
    return jsonify({"result": "base64"})

@app.route("/v1/explain/waterfall/<model_name>", methods=["POST"])
def predict_waterfall(model_name):
    model_loader = ModelLoader(model_name)
    model, input_columns, explainer = model_loader.load()
    return jsonify([{"id": "1", "result": "base64"}])

@app.route("/v1/predict/<model_name>", methods=["POST"])
def predict(model_name):
    model_loader = ModelLoader(model_name)
    model, input_columns, explainer = model_loader.load()
    
    if model is None:
        return jsonify({"error": f"Model {model_name} not found"}), 404
    try:
        req_json = request.get_json()

        if "dataframe_split" not in req_json or "data" not in req_json["dataframe_split"] or "columns" not in req_json["dataframe_split"]:
            return jsonify({"error": "Invalid request format. Expecting 'dataframe_split' with 'data' and 'columns'."}), 400

        # Convert input data to DataFrame
        columns = req_json["dataframe_split"]["columns"]
        data = req_json["dataframe_split"]["data"]

        input_df = pd.DataFrame(data=data, columns=columns)
        logger.info(input_df.head())
        # Transform input DataFrame to match model requirements
        input_data = transformer(input_df, input_columns)  
        logger.info(input_data.head())

        # Split abundance_concat into train and test data
        test_ids = input_data.index
        X_test = input_data.loc[test_ids]
        
        # Get predicted probability
        y_pred_proba = model.predict_proba(X_test)[:, 1] 
        y_pred_class = model.predict(X_test)
        # Map to df
        y_pred_proba_df = pd.DataFrame(y_pred_proba, index=X_test.index, columns=["Y_proba"])
        y_pred_proba_df["Y_class"] = y_pred_class

        shap_object = get_shap_value(explainer, X=input_data)

        beeswarm = get_beeswarm(shap_object.explanation)
        heatmap = get_heatmap(shap_object.explanation)
        
        summary = {"beeswarm": beeswarm, "heatmap": heatmap}
        predictions = [
            {
                "id": idx,
                "proba": pred_proba,
                "class": pred_class,
                "plot": {
                    "waterfall": get_local_waterfall_plot(
                        subject_id=idx,
                        shap_value_object=shap_object
                    )
                }
            }
            for idx, (pred_proba, pred_class) in zip(
                y_pred_proba_df.index,
                zip(y_pred_proba_df["Y_proba"], y_pred_proba_df["Y_class"])
            )
        ]

        return jsonify({"summary": summary, "predictions": predictions})
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/v1/models", methods=["GET"])
def list_models():
    mlflow_url = os.environ.get("MLFLOW_URL", None)
    mlflow.set_tracking_uri(mlflow_url)
    client = mlflow.tracking.MlflowClient()
    registered_models = client.search_registered_models()
    
    model_list = []
    for model in registered_models:
        model_name = model.name
        latest_versions = client.get_latest_versions(model_name, stages=["Production"])

        if not latest_versions:
            continue

        latest_version = latest_versions[0]
        run_id = latest_version.run_id
        
        run_data = client.get_run(run_id).data.metrics
        metrics = {key: value for key, value in run_data.items()}
        
        model_list.append({
            "model_name": model_name,
            "version": latest_version.version,
            "run_id": run_id,
            "metrics": metrics
        })

    return jsonify(model_list)

# ML flow api
@app.route("/v1/mlflow/tracking_uri", methods=["GET"])
def get_mlflow_tracking_uri():
    mlflow_url = os.environ.get("MLFLOW_URL", None)
    return jsonify({"url": mlflow_url})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080)