import mlflow
import joblib
import shap

class MLflowSHAP:
    """
    A class encapsulating methods to save and load SHAP explainers using MLflow.
    """

    @staticmethod
    def log_explainer(model, data, file_path='shap_explainer.pkl'):
        """
        Save a SHAP explainer for the given model and data.

        Parameters:
        model: The trained model to explain.
        data: The data used to initialize the SHAP explainer.
        file_path (str): The file path to save the SHAP explainer (default: 'shap_explainer.pkl').

        Returns:
        str: The file path where the SHAP explainer is saved.
        """
        explainer = shap.Explainer(model, data)
        with open(file_path, 'wb') as f:
            joblib.dump(explainer, f)
            
        mlflow.log_artifact(file_path, artifact_path="shap_explainer")


    @staticmethod
    def load_explainer(run_id, artifact_path="shap_explainer/shap_explainer.pkl"):
        """
        Load a SHAP explainer artifact from MLflow.

        Parameters:
        run_id (str): The run ID where the artifact was logged.
        artifact_path (str): The relative path to the artifact in MLflow.

        Returns:
        shap.Explainer: The loaded SHAP explainer.
        """
        # Download artifact to a temporary directory
        local_path = mlflow.artifacts.download_artifacts(artifact_path=artifact_path, run_id=run_id)
        explainer = joblib.load(local_path)
        return explainer

# Create an instance to use as a namespace
mlflow_shap = MLflowSHAP()