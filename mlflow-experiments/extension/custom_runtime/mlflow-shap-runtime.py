import os
import mlflow
from kserve import Model, model_server
import joblib
import shap
import numpy as np


class MLflowShapRuntime(Model):
    def __init__(self, name: str):
        super().__init__(name)
        self.name = name
        self.model = None
        self.explainer = None
        self.run_id = "8912895204284e1780e3953fdbe39929"

        if not self.run_id:
            raise ValueError("RUN_ID environment variable is required")

    def load(self):
        """
        Load the model and explainer from MLflow using the specified run_id.
        """
        try:
            # Load model from MLflow
            print(f"Loading model from MLflow with run_id: {self.run_id}")
            self.model = mlflow.sklearn.load_model(f"runs:/{self.run_id}/model")
            
            # Load explainer from MLflow
            artifact_path = f"runs:/{self.run_id}/shap_explainer/shap_explainer.pkl"
            local_path = mlflow.artifacts.download_artifacts(artifact_path)
            self.explainer = joblib.load(local_path)

            self.ready = True
            print("Model and explainer loaded successfully")
        except Exception as e:
            self.ready = False
            raise RuntimeError(f"Failed to load model or explainer: {str(e)}")

    def predict(self, inputs: dict) -> dict:
        """
        Perform predictions using the loaded model and return SHAP values.
        """
        try:
            input_data = np.array(inputs["instances"])
            predictions = self.model.predict(input_data)
            shap_values = self.explainer(input_data)

            return {
                "predictions": predictions.tolist(),
                "shap_values": shap_values.values.tolist()
            }
        except Exception as e:
            raise RuntimeError(f"Prediction failed: {str(e)}")


if __name__ == "__main__":
    # Start KServe Model Server
    model_name = "mlflow-shap-runtime"
    model = MLflowShapRuntime(model_name)
    model_server.start_models([model])