"""GCN model + tabular wrapper classes used by ``sample-gcn-crc``.

These live in their own module (rather than inline in ``model.py``) so that
``mlflow_explainable.log_explainable_model``'s code-path autodetector can
resolve them to a file and pack them into the artifact. The serving runtime
then only needs ``torch`` and ``torch_geometric`` installed — it does not
need to import these classes from its own codebase.
"""

from __future__ import annotations

import copy

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F
from torch_geometric.data import Data
from torch_geometric.loader import DataLoader
from torch_geometric.nn import GCNConv, global_mean_pool


# ---------------------------------------------------------------------------
# GCN classifier
# ---------------------------------------------------------------------------
class GCNClassifier(torch.nn.Module):
    """Stack of ``GCNConv`` layers followed by ``global_mean_pool`` and a
    linear head. Used for graph-level binary classification.
    """

    def __init__(
        self,
        in_channels: int = 1,
        hidden_channels: int = 64,
        num_layers: int = 2,
        num_classes: int = 2,
        dropout: float = 0.3,
    ):
        super().__init__()
        self.convs = torch.nn.ModuleList()
        self.convs.append(GCNConv(in_channels, hidden_channels))
        for _ in range(num_layers - 1):
            self.convs.append(GCNConv(hidden_channels, hidden_channels))
        self.dropout = dropout
        self.lin = torch.nn.Linear(hidden_channels, num_classes)

    def forward(self, x, edge_index, batch):
        for conv in self.convs:
            x = conv(x, edge_index)
            x = F.relu(x)
            x = F.dropout(x, p=self.dropout, training=self.training)
        x = global_mean_pool(x, batch)
        return self.lin(x)


# ---------------------------------------------------------------------------
# Tabular wrapper
# ---------------------------------------------------------------------------
class GCNTabularWrapper:
    """Wraps a trained ``GCNClassifier`` behind a ``predict`` / ``predict_proba``
    / ``__call__`` interface that consumes plain tabular input (DataFrame or
    ndarray) and returns class probabilities of shape ``(n_samples, 2)``.

    Each input row is converted on the fly into a one-graph PyG ``Data``
    object: node features come from the row's values, edges from a shared
    ``edge_index`` that was learned at training time.
    """

    def __init__(
        self,
        model: GCNClassifier,
        edge_index: torch.Tensor,
        device: torch.device,
        feature_names,
        batch_size: int = 64,
    ):
        self.model = model.to(device).eval()
        self.edge_index = edge_index.to(device)
        self.device = device
        self.feature_names = list(feature_names)
        self.classes_ = np.array([0, 1])
        self.batch_size = batch_size

    # ---- internal ----------------------------------------------------------
    def _to_loader(self, X):
        if hasattr(X, "values"):
            X = X.values
        X = np.asarray(X, dtype=np.float32)
        if X.ndim == 1:
            X = X.reshape(1, -1)
        ei_cpu = self.edge_index.cpu()
        data_list = []
        for i in range(X.shape[0]):
            x = torch.tensor(X[i], dtype=torch.float).unsqueeze(1)
            data_list.append(
                Data(x=x, edge_index=ei_cpu, y=torch.tensor([0], dtype=torch.long))
            )
        return DataLoader(data_list, batch_size=self.batch_size, shuffle=False)

    # ---- sklearn-style surface --------------------------------------------
    @torch.no_grad()
    def predict_proba(self, X):
        loader = self._to_loader(X)
        probs = []
        for batch in loader:
            batch = batch.to(self.device)
            out = self.model(batch.x, batch.edge_index, batch.batch)
            probs.append(F.softmax(out, dim=1).cpu().numpy())
        return np.concatenate(probs, axis=0)

    def predict(self, X):
        return self.predict_proba(X).argmax(axis=1)

    def __call__(self, X):
        """Make wrapper callable so ``shap.Explainer(wrapper, X)`` is
        accepted (shap >= 0.43 rejects non-callable model objects).
        Returns class probabilities, matching the classification surface
        expected by ``log_explainable_model``.
        """
        return self.predict_proba(X)

    def __getstate__(self):
        """Serialize the wrapper on CPU so the artifact loads anywhere.

        The GCN is trained on whatever device is fastest locally — CUDA,
        Apple-Silicon MPS, or CPU — but the kserve serving container is
        CPU-only. torch tensors remember the device they live on; unpickling
        an MPS/CUDA tensor on a plain CPU host raises an error such as
        ``torch.UntypedStorage(): Storage device not recognized: mps``.
        Forcing every tensor to CPU at pickle time makes the logged artifact
        portable across hosts. Inference for a graph this small is fast on
        CPU anyway.

        This method MUST be side-effect-free: the training script keeps using
        the live wrapper after logging (``log_explainable_model`` runs a
        pickle self-test and then calls ``predict`` again). ``nn.Module.to()``
        moves parameters *in place*, so the module is deep-copied first and
        only the copy is moved — the live wrapper stays on its training
        device, fully consistent.
        """
        state = self.__dict__.copy()
        model_cpu = copy.deepcopy(self.model).to("cpu").eval()
        state["model"] = model_cpu
        state["edge_index"] = self.edge_index.detach().to("cpu")
        state["device"] = torch.device("cpu")
        return state

    def __setstate__(self, state):
        """Restore on CPU — paired with :meth:`__getstate__`."""
        self.__dict__.update(state)
        self.device = torch.device("cpu")
        self.model = self.model.to(self.device).eval()
        self.edge_index = self.edge_index.to(self.device)


# ---------------------------------------------------------------------------
# Graph construction utilities (shared between train + inference)
# ---------------------------------------------------------------------------
def build_edge_index(X_df: pd.DataFrame, top_k: int) -> torch.Tensor:
    """Top-k absolute Spearman correlation graph over bacteria (features)."""
    corr = X_df.corr(method="spearman").fillna(0.0).abs().values
    np.fill_diagonal(corr, 0.0)
    n = corr.shape[0]
    k = min(int(top_k), n - 1)

    nbr_idx = np.argpartition(-corr, kth=k - 1, axis=1)[:, :k]
    src = np.repeat(np.arange(n), k)
    dst = nbr_idx.reshape(-1)

    src_sym = np.concatenate([src, dst])
    dst_sym = np.concatenate([dst, src])
    edges = np.stack([src_sym, dst_sym], axis=0)

    edge_index = torch.tensor(edges, dtype=torch.long)
    edge_index = torch.unique(edge_index, dim=1)
    return edge_index


def make_graph_dataset(
    X_df: pd.DataFrame, y_series: pd.Series, edge_index: torch.Tensor
):
    """One PyG ``Data`` object per sample, all sharing the same ``edge_index``."""
    X_arr = X_df.values.astype(np.float32)
    y_arr = y_series.values.astype(np.int64)
    data_list = []
    for i in range(X_arr.shape[0]):
        x = torch.tensor(X_arr[i], dtype=torch.float).unsqueeze(1)
        data_list.append(
            Data(
                x=x,
                edge_index=edge_index,
                y=torch.tensor([y_arr[i]], dtype=torch.long),
            )
        )
    return data_list
