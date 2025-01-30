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

from kserve import ModelServer

class ShapValueObject:
    def __init__(self, base_value, shap_df):
        self.base_value = base_value
        self.shap_df = shap_df

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
        run_id = "6dc3b7b87a724eab9101955cbcef7a14"
        mlflow.set_tracking_uri("http://ec2-3-1-102-14.ap-southeast-1.compute.amazonaws.com:5000")
        self.model = mlflow.sklearn.load_model(f"runs:/{run_id}/model")
        self.explainer = self.load_explainer(run_id)
        self.ready = True

    def get_local_explanation(self, subject_id, shap_value_object):
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

        shap_df = pd.DataFrame(shap_values_class, columns=feature_names, index=patient_ids)
        return ShapValueObject(base_value, shap_df)
    
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

        shap_value_object = self.get_shap_value(X=input_data)
        
        local_explanation_predictions_json = [{"index": idx, "pred_proba": pred_proba, "pred_class": pred_class,"plot": self.get_local_explanation(subject_id=idx, shap_value_object=shap_value_object)} for idx, (pred_proba, pred_class) in zip(y_pred_proba_df.index, zip(y_pred_proba_df["Y_proba"], y_pred_proba_df["Y_class"]))]
        return {"local_explanation_predictions": local_explanation_predictions_json}
    

if __name__ == "__main__":
  
  model = KServeShapModel("shap-model")
  model.load()

  model_server = ModelServer(http_port=8080, workers=1)
  model_server.start([model])