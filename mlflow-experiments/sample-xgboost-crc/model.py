"""sample-xgboost-crc — XGBoost CRC classifier on the shapmat sample dataset.

Mirrors the ``sample-rf-crc`` template: tunes a tree-based classifier on the
shapmat sample microbiome data with hyperopt and logs the predictor + SHAP
``TreeExplainer`` as a single self-contained pyfunc artifact through the
``mlflow_explainable`` contract.

Search space is tuned for microbiome characteristics — high-dimensional,
sparse, small-N — favouring shallow trees, aggressive column subsampling,
and L1/L2 regularisation.
"""

import os

import mlflow
import pandas as pd
from hyperopt import STATUS_OK, Trials, fmin, hp, tpe
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier

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
mlflow.set_tracking_uri("http://35.225.129.127:5000")

mlflow.set_experiment("sample-xgboost-crc")


# ---------------------------------------------------------------------------
# Hyperopt objective
# ---------------------------------------------------------------------------
def objective(params):
    with mlflow.start_run():
        params["n_estimators"] = int(params["n_estimators"])
        params["max_depth"] = int(params["max_depth"])

        # Log params
        mlflow.log_param("features_bacteria", train_data.shape[1])
        mlflow.log_param("model_type", "XGBoost")
        mlflow.log_params(params)

        # Train — fixed kwargs (not tuned) kept outside the search space
        model = XGBClassifier(
            **params,
            objective="binary:logistic",
            tree_method="hist",
            eval_metric="auc",
            random_state=42,
            n_jobs=-1,
        ).fit(X_train, y_train)

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
        # automatically for gradient-boosted trees.
        log_explainable_model(
            model=model,
            background=X_train,
            registered_name="sample-xgboost-crc",
        )

        return {"loss": -accuracy, "status": STATUS_OK}


# ---------------------------------------------------------------------------
# Search space
# ---------------------------------------------------------------------------
# Rationale for microbiome (high-dim, sparse, small-N):
#   * n_estimators 100–800       — enough rounds at low learning rates.
#   * learning_rate loguniform   — exp(-4..-1) ≈ 0.018–0.37.
#   * max_depth [3,4,5,6,8]      — shallow trees curb overfitting on wide data.
#   * min_child_weight 1–10      — penalise splits on tiny noisy leaves.
#   * subsample 0.6–1.0          — row bagging.
#   * colsample_bytree 0.4–1.0   — column bagging analogue to RF max_features.
#   * gamma 0–5                  — minimum split-loss gain regulariser.
#   * reg_alpha / reg_lambda     — L1 (sparsity) and L2 smoothing,
#     loguniform(-3..2)            ≈ 0.05–7.4.
space = {
    "n_estimators": hp.quniform("n_estimators", 100, 800, 50),
    "learning_rate": hp.loguniform("learning_rate", -4, -1),
    "max_depth": hp.choice("max_depth", [3, 4, 5, 6, 8]),
    "min_child_weight": hp.uniform("min_child_weight", 1, 10),
    "subsample": hp.uniform("subsample", 0.6, 1.0),
    "colsample_bytree": hp.uniform("colsample_bytree", 0.4, 1.0),
    "gamma": hp.uniform("gamma", 0, 5),
    "reg_alpha": hp.loguniform("reg_alpha", -3, 2),
    "reg_lambda": hp.loguniform("reg_lambda", -3, 2),
}


# ---------------------------------------------------------------------------
# Run Hyperopt
# ---------------------------------------------------------------------------
trials = Trials()
best = fmin(fn=objective, space=space, algo=tpe.suggest, max_evals=50, trials=trials)
print("\nBest parameters:", best)
