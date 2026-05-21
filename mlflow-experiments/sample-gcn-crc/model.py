"""
sample-gcn-crc
==============
GCN-based CRC classifier on the same shapmat microbiome sample dataset used
by ``sample-rf-crc``. Logged through the ``mlflow_explainable`` contract — the
trained predictor *and* its SHAP explainer end up in a single self-contained
pyfunc artifact. The kserve runtime loads them with a uniform interface and
does not need to import any of the GCN classes from its own codebase.

Graph construction (per sample):
    nodes        = bacteria (one node per feature column)
    node feature = relative abundance of that bacterium for the given sample
    edges        = shared bacteria co-abundance graph built from the
                   *training* Spearman correlation matrix (top-k absolute
                   correlations per node, symmetrised and de-duplicated)
    label        = CRC status (graph-level binary classification)
"""

import os

import mlflow
import numpy as np
import pandas as pd
import shap
import torch
from hyperopt import STATUS_OK, Trials, fmin, hp, tpe
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from torch_geometric.loader import DataLoader

from mlflow_explainable import log_explainable_model

# Class definitions live in their own module so that the autodetector in
# ``log_explainable_model`` can resolve them to a file and pack them into the
# artifact. The serving runtime never needs to import these names directly.
from gcn_modules import (
    GCNClassifier,
    GCNTabularWrapper,
    build_edge_index,
    make_graph_dataset,
)


# ---------------------------------------------------------------------------
# Reproducibility & device
# ---------------------------------------------------------------------------
SEED = 42
np.random.seed(SEED)
torch.manual_seed(SEED)
if torch.cuda.is_available():
    torch.cuda.manual_seed_all(SEED)


def _pick_device() -> torch.device:
    """CUDA -> MPS (Apple Silicon) -> CPU. ``GCN_FORCE_CPU=1`` overrides."""
    if os.environ.get("GCN_FORCE_CPU") == "1":
        return torch.device("cpu")
    if torch.cuda.is_available():
        return torch.device("cuda")
    if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
        return torch.device("mps")
    return torch.device("cpu")


DEVICE = _pick_device()
print(f"[info] using device: {DEVICE}")


# ---------------------------------------------------------------------------
# Data (identical to sample-rf-crc)
# ---------------------------------------------------------------------------
sample_url = "https://raw.githubusercontent.com/ryzary/shapmat/refs/heads/cv_notebook/data/sample.csv"
sample_crc = pd.read_csv(sample_url, index_col=0)
train_data = sample_crc.drop(["CRC"], axis=1)
train_metadata = sample_crc[["CRC"]]
train_ids = train_data.index

X = train_data.loc[train_ids]
y = train_metadata["CRC"]
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=SEED
)

FEATURE_NAMES = list(X_train.columns)
N_FEATURES = len(FEATURE_NAMES)


# ---------------------------------------------------------------------------
# MLflow tracking
# ---------------------------------------------------------------------------
os.environ["MLFLOW_TRACKING_USERNAME"] = "b881211d-796e-4b12-8621-6246d2eeadce"
os.environ["MLFLOW_TRACKING_PASSWORD"] = "k7uLbDEGc6beQlAWTCUJAUAmJskdr5bLUDmsiCG4"
mlflow.set_tracking_uri("http://136.115.33.253:5000")
mlflow.set_experiment("sample-gcn-crc")


# ---------------------------------------------------------------------------
# Training
# ---------------------------------------------------------------------------
def train_gcn(params, X_tr, y_tr):
    edge_index = build_edge_index(X_tr, top_k=params["top_k"])
    train_ds = make_graph_dataset(X_tr, y_tr, edge_index)
    train_loader = DataLoader(
        train_ds, batch_size=params["batch_size"], shuffle=True
    )

    model = GCNClassifier(
        in_channels=1,
        hidden_channels=params["hidden_channels"],
        num_layers=params["num_layers"],
        num_classes=2,
        dropout=params["dropout"],
    ).to(DEVICE)

    optimizer = torch.optim.Adam(
        model.parameters(),
        lr=params["lr"],
        weight_decay=params["weight_decay"],
    )
    loss_fn = torch.nn.CrossEntropyLoss()

    model.train()
    for _ in range(params["epochs"]):
        for batch in train_loader:
            batch = batch.to(DEVICE)
            optimizer.zero_grad()
            out = model(batch.x, batch.edge_index, batch.batch)
            loss = loss_fn(out, batch.y)
            loss.backward()
            optimizer.step()

    return model, edge_index


def _cast_params(raw):
    return {
        "top_k": int(raw["top_k"]),
        "hidden_channels": int(raw["hidden_channels"]),
        "num_layers": int(raw["num_layers"]),
        "dropout": float(raw["dropout"]),
        "lr": float(raw["lr"]),
        "weight_decay": float(raw["weight_decay"]),
        "epochs": int(raw["epochs"]),
        "batch_size": int(raw["batch_size"]),
    }


def objective(params):
    with mlflow.start_run():
        params = _cast_params(params)

        mlflow.log_param("features_bacteria", N_FEATURES)
        mlflow.log_param("model_type", "GCN")
        mlflow.log_params(params)

        # Train
        model, edge_index = train_gcn(params, X_train, y_train)
        wrapper = GCNTabularWrapper(model, edge_index, DEVICE, FEATURE_NAMES)

        # Evaluation
        y_pred = wrapper.predict(X_test)
        y_pred_proba = wrapper.predict_proba(X_test)[:, 1]
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
        mlflow.log_metric("n_edges", int(edge_index.shape[1]))

        print(f"Trial with params: {params}, Accuracy: {accuracy:.4f}")

        # SHAP background — keep this SMALL. PermutationExplainer evaluates
        # the GCN once per (coalition x background row); a full X_train masker
        # (~120 rows) pushes the explain endpoints to ~70s/sample. 16 rows
        # keeps explanations representative while bringing per-sample SHAP
        # down to a usable range.
        shap_background = shap.sample(X_train, 16, random_state=SEED)

        # Single-call: log predictor + SHAP explainer + feature_names artifact
        # through the contract. ``gcn_modules.py`` is auto-detected from the
        # wrapper's class graph and packed into the artifact.
        log_explainable_model(
            model=wrapper,
            background=shap_background,
            registered_name="sample-gcn-crc",
            explainer_kwargs={"algorithm": "permutation"},
            extra_pip_requirements=["torch", "torch_geometric"],
        )

        return {"loss": -accuracy, "status": STATUS_OK}


# ---------------------------------------------------------------------------
# Search space
# ---------------------------------------------------------------------------
space = {
    "top_k": hp.quniform("top_k", 3, 15, 1),
    "hidden_channels": hp.choice("hidden_channels", [32, 64, 128, 256]),
    "num_layers": hp.quniform("num_layers", 2, 4, 1),
    "dropout": hp.uniform("dropout", 0.1, 0.5),
    "lr": hp.loguniform("lr", np.log(1e-4), np.log(1e-2)),
    "weight_decay": hp.loguniform("weight_decay", np.log(1e-6), np.log(1e-3)),
    "epochs": hp.choice("epochs", [50, 100, 150, 200]),
    "batch_size": hp.choice("batch_size", [16, 32, 64]),
}


# ---------------------------------------------------------------------------
# Run Hyperopt
# ---------------------------------------------------------------------------
trials = Trials()
best = fmin(
    fn=objective,
    space=space,
    algo=tpe.suggest,
    max_evals=5,
    trials=trials,
)
print("\nBest parameters:", best)
