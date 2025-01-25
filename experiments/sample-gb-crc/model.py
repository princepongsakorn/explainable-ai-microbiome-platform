import mlflow
import mlflow.xgboost
import pandas as pd

import joblib
import shap

from mlflow.models import infer_signature

from sklearn.ensemble import GradientBoostingClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, roc_auc_score, precision_score, recall_score, f1_score

from hyperopt import fmin, tpe, hp, Trials, STATUS_OK

#TODO: Make it to Third-party Package
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
    # Create SHAP explainer
    explainer = shap.Explainer(model, data)

    # Save explainer to file
    with open(file_path, 'wb') as f:
        joblib.dump(explainer, f)

    mlflow.log_artifact(file_path, artifact_path="shap_explainer")

sample_url = "https://raw.githubusercontent.com/ryzary/shapmat/refs/heads/cv_notebook/data/sample.csv"
sample_crc = pd.read_csv(sample_url, index_col=0)
train_data = sample_crc.drop(['CRC'],axis=1)
train_metadata = sample_crc[['CRC']]
train_ids = train_data.index

X = train_data.loc[train_ids]
y = train_metadata['CRC']
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

mlflow.set_tracking_uri("http://ec2-3-1-102-14.ap-southeast-1.compute.amazonaws.com:5000")
mlflow.set_experiment("sample-gb-crc")

def objective(params):
    with mlflow.start_run() as run:
        params["n_estimators"] = int(params["n_estimators"])
        params["max_depth"] = int(params["max_depth"])
        params["min_samples_split"] = int(params["min_samples_split"])
        params["min_samples_leaf"] = int(params["min_samples_leaf"])
        # Train with tuned RandomForest
        mlflow.log_param("features_bacteria", train_data.shape[1])
        mlflow.log_params(params)

        model = GradientBoostingClassifier(**params).fit(X_train ,y_train)

        # Evaluation on test data
        y_pred = model.predict(X_test)
        y_pred_proba = model.predict_proba(X_test)[:, 1] 
        accuracy = accuracy_score(y_test, y_pred)
        precision = precision_score(y_test, y_pred, average='weighted')
        recall = recall_score(y_test, y_pred, average='weighted')
        f1 = f1_score(y_test, y_pred, average='weighted')
        roc_auc = roc_auc_score(y_test, y_pred_proba, multi_class='ovr', average='weighted')

        mlflow.log_metric("accuracy", round(accuracy, 3))
        mlflow.log_metric("precision", round(precision, 3))
        mlflow.log_metric("recall", round(recall, 3))
        mlflow.log_metric("f1", round(f1, 3))
        mlflow.log_metric("roc_auc", round(roc_auc, 3))

        print(f"Trial with params: {params}, Accuracy: {accuracy:.4f}")

        # Log shap_explainer and model
        log_explainer(model, X_train)
        mlflow.sklearn.log_model( 
            sk_model=model,
            artifact_path="model",
            registered_model_name="sample-xgb-crc",
            input_example = X_test[:3],
            signature = infer_signature(X_test[:3], model.predict(X_test[:3]))
        )
        return {"loss": -accuracy, "status": STATUS_OK}

# Search Space
space = {
    "n_estimators": hp.quniform("n_estimators", 50, 1000, 50),
    "learning_rate": hp.uniform("learning_rate", 0.01, 0.3),
    "max_depth": hp.quniform("max_depth", 3, 10, 1),
    "min_samples_split": hp.quniform("min_samples_split", 2, 20, 1),
    "min_samples_leaf": hp.quniform("min_samples_leaf", 1, 10, 1),
    "subsample": hp.uniform("subsample", 0.5, 1.0),
    "max_features": hp.choice("max_features", ["sqrt", "log2", None]),
    "random_state": 42
}

# Run Hyperopt Optimization
trials = Trials()
best = fmin(fn=objective, space=space, algo=tpe.suggest, max_evals=100, trials=trials)
print("\nBest parameters:", best)