from typing import Dict 

import kserve
import logging
import joblib
import mlflow
import shap

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

import base64
from io import BytesIO
import os

from kserve import ModelServer

class ShapValueObject:
    def __init__(self, base_value, shap_df, explanation):
        self.base_value = base_value
        self.shap_df = shap_df
        self.explanation = explanation

class KServeShapModel(kserve.Model):
    def __init__(self, name: str):
        super().__init__(name)
        KSERVE_LOGGER_NAME = 'kserve'
        self.logger = logging.getLogger(KSERVE_LOGGER_NAME)
        self.name = name
        self.ready = False
        
    def load_explainer(self, run_id, artifact_path="shap_explainer/shap_explainer.pkl"):
        """
        Load a SHAP explainer artifact from MLflow.

        Parameters:
        run_id (str): The run ID where the artifact was logged.
        artifact_path (str): The relative path to the artifact in MLflow.

        Returns:
        shap.Explainer: The loaded SHAP explainer.
        """
        local_path = mlflow.artifacts.download_artifacts(artifact_path=artifact_path, run_id=run_id)
        print(f"Downloaded artifact to: {local_path}")

        with open(local_path, "rb") as f:
            explainer = joblib.load(f)

        return explainer
    
    def load(self):
        # Build explainer and model
        mlflow_url = os.environ.get("MLFLOW_URL", None)
        mlflow.set_tracking_uri(mlflow_url)
        client = mlflow.tracking.MlflowClient()
        model_versions = client.get_latest_versions(model_name, stages=["Production"])
        if not model_versions:
            raise ValueError(f"No model version for '{model_name}' is in Production stage.")

        # Use the latest version in Production
        model_version_info = model_versions[-1]  # Get the last entry (latest registered version)
        version = model_version_info.version
        print(f"Using latest Production version: {version}")
        run_id = model_version_info.run_id  # Run ID associated with the model version

        # Load the model from Production Stage
        model_uri = f"models:/{model_name}/{version}"
        print(f"Loading model from Model Registry Production Stage: {model_uri}")

        self.model = mlflow.sklearn.load_model(model_uri)
        self.explainer = self.load_explainer(run_id)
        self.ready = True
    
    def get_beeswarm(self, explanation):
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
    
    def get_heatmap(self, explanation): 
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
    
    def get_local_waterfall_plot(self, subject_id, shap_value_object):
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
    
    def get_shap_value(self, X):
        shap_values = self.explainer.shap_values(X)
        
        if len(shap_values.shape) == 3: # Multiclass Classification
            shap_values_class = shap_values[:, :, 1]
            base_value = self.explainer.expected_value[1]
        elif len(shap_values.shape) == 2: # Binary Classification
            shap_values_class = shap_values
            base_value = self.explainer.expected_value
        else:
            raise ValueError(f"Unsupported SHAP values shape: {shap_values.shape}")

        feature_names = X.columns
        patient_ids = X.index

        explanation = shap.Explanation(shap_values_class, data=X.values, feature_names=feature_names)
        shap_df = pd.DataFrame(shap_values_class, columns=feature_names, index=patient_ids)

        return ShapValueObject(base_value, shap_df, explanation)
    
    def predict(self, request: Dict, headers: Dict) -> Dict:
        self.logger.info(f"request: {request}")
        self.logger.info(f"headers: {headers}")
        # Input Data
        input_df = pd.DataFrame(data=request["dataframe_split"]["data"], columns=request["dataframe_split"]["columns"])
        input_data = input_df

        # Split abundance_concat into train and test data
        test_ids = input_data.index
        X_test = input_data.loc[test_ids]
        
        # Get predicted probability
        y_pred_proba = self.model.predict_proba(X_test)[:, 1] 
        y_pred_class = self.model.predict(X_test)
        y_pred_proba_df = pd.DataFrame(y_pred_proba, index=X_test.index, columns=["Y_proba"])
        y_pred_proba_df["Y_class"] = y_pred_class

        shap_object = self.get_shap_value(X=input_data)

        beeswarm = self.get_beeswarm(shap_object.explanation)
        heatmap = self.get_heatmap(shap_object.explanation)
        
        summary = {"beeswarm": beeswarm, "heatmap": heatmap}
        predictions = [
            {
                "id": idx,
                "proba": pred_proba,
                "class": pred_class,
                "plot": {
                    "waterfall": self.get_local_waterfall_plot(
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

        return {"summary": summary, "predictions": predictions}

if __name__ == "__main__":
    model_name = os.environ.get("MODEL_NAME", None)
    if not model_name:
        raise ValueError("Environment variable 'MODEL_NAME' is not set. Please define it before running the script.")
    
    model = KServeShapModel(model_name)
    model.load()

    model_server = ModelServer(http_port=8080, workers=1)
    model_server.start([model])