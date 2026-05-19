"""sample-rf-crc — RandomForest CRC classifier on the shapmat sample dataset.

Migrated to log through the ``mlflow_explainable`` contract. The trained
predictor and its SHAP ``TreeExplainer`` are bundled into a single
self-contained pyfunc artifact; the serving runtime loads them through a
uniform interface regardless of the underlying model family.
"""

import os

import mlflow
import pandas as pd
from hyperopt import STATUS_OK, Trials, fmin, hp, tpe
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split

from mlflow_explainable import log_explainable_model


# ---------------------------------------------------------------------------
# Data
# ---------------------------------------------------------------------------
sample_url = "https://raw.githubusercontent.com/ryzary/shapmat/refs/heads/cv_notebook/data/sample.csv"
sample_crc = pd.read_csv(sample_url, index_col=0)
train_data = sample_crc.drop(["CRC"], axis=1)
train_metadata = sample_crc[["CRC"]]
train_ids = train_data.index

X = train_data.loc[train_ids]
y = train_metadata["CRC"]
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)


# ---------------------------------------------------------------------------
# MLflow tracking
# ---------------------------------------------------------------------------
os.environ["MLFLOW_TRACKING_USERNAME"] = "b881211d-796e-4b12-8621-6246d2eeadce"
os.environ["MLFLOW_TRACKING_PASSWORD"] = "k7uLbDEGc6beQlAWTCUJAUAmJskdr5bLUDmsiCG4"
mlflow.set_tracking_uri("http://136.115.33.253:5000")

mlflow.set_experiment("sample-rf-crc")


# ---------------------------------------------------------------------------
# Hyperopt objective
# ---------------------------------------------------------------------------
def objective(params):
    with mlflow.start_run():
        params["n_estimators"] = int(params["n_estimators"])
        params["min_samples_leaf"] = int(params["min_samples_leaf"])
        params["min_samples_split"] = int(params["min_samples_split"])

        # Log params
        mlflow.log_param("features_bacteria", train_data.shape[1])
        mlflow.log_param("model_type", "RandomForest")
        mlflow.log_params(params)

        # Train
        model = RandomForestClassifier(**params).fit(X_train, y_train)

        # Evaluation
        y_pred = model.predict(X_test)
        y_pred_proba = model.predict_proba(X_test)[:, 1]
        accuracy = accuracy_score(y_test, y_pred)
        precision = precision_score(y_test, y_pred, average="weighted")
        recall = recall_score(y_test, y_pred, average="weighted")
        f1 = f1_score(y_test, y_pred, average="weighted")
        roc_auc = roc_auc_score(
            y_test, y_pred_proba, multi_class="ovr", average="weighted"
        )

        mlflow.log_metric("accuracy", round(accuracy, 3))
        mlflow.log_metric("precision", round(precision, 3))
        mlflow.log_metric("recall", round(recall, 3))
        mlflow.log_metric("f1", round(f1, 3))
        mlflow.log_metric("roc_auc", round(roc_auc, 3))

        print(f"Trial with params: {params}, Accuracy: {accuracy:.4f}")

        # Single-call: predictor + SHAP explainer + feature_names artifact
        # are all logged under the contract. shap.Explainer picks TreeExplainer
        # automatically for sklearn forests.
        log_explainable_model(
            model=model,
            background=X_train,
            registered_name="sample-rf-crc",
        )

        return {"loss": -accuracy, "status": STATUS_OK}


# ---------------------------------------------------------------------------
# Search space
# ---------------------------------------------------------------------------
space = {
    "n_estimators": hp.quniform("n_estimators", 50, 1000, 50),
    "max_depth": hp.choice("max_depth", [10, 20, 50, 100, None]),
    "min_samples_leaf": hp.quniform("min_samples_leaf", 1, 5, 1),
    "min_samples_split": hp.quniform("min_samples_split", 2, 6, 1),
    "class_weight": hp.choice("class_weight", [None, "balanced"]),
    "max_features": hp.choice("max_features", ["sqrt", "log2", None]),
}


# ---------------------------------------------------------------------------
# Run Hyperopt
# ---------------------------------------------------------------------------
trials = Trials()
best = fmin(fn=objective, space=space, algo=tpe.suggest, max_evals=50, trials=trials)
print("\nBest parameters:", best)
