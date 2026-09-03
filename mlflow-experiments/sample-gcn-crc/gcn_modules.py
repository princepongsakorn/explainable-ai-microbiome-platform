"""GCN model + microbiome-aware preprocessing for ``sample-gcn-crc``.

Design choices are grounded in published microbiome / GNN literature:

* **CLR transform** before any correlation — addresses the compositional
  bias of relative-abundance data. Standard practice in the microbiome
  field; raw correlations on the simplex give phantom relationships.
* **Three-source edge graph (statistical ∪ taxonomic ∪ CRC biomarker
  guild)** — combines data-driven co-abundance with biological priors.
  Justified by:
    - Reiman et al., *PopPhy-CNN* (2018): phylogenetic priors beat
      correlation-only graphs when sample size is small.
    - Thomas et al., *Nat Med* (2019) and Wirbel et al., *Nat Med* (2019):
      cross-cohort CRC meta-analyses establishing a robust set of
      pro-tumor and protective bacterial genera. We encode those as
      "guild" cliques that the model always sees, regardless of whether
      our 180-sample dataset has enough power to recover them on its own.
* **Edge weights from signed |spearman_clr|** — replaces binary edges,
  per Veličković et al., *GAT* (ICLR 2018): edges have variable
  importance and the model should reflect that. We use GCN with weighted
  adjacency rather than GAT because attention overfits on small graphs.
* **DropEdge** during training — Rong et al., *DropEdge* (ICLR 2020):
  randomly removing a fraction of edges each forward pass regularizes
  the GCN and mitigates over-smoothing on small graphs.
* **Multi-pool readout (mean + max)** — Xu et al., *GIN* (ICLR 2018):
  concatenating multiple pool operators captures distributional
  information that a single mean throws away.

Per-sample preprocessing (low-abundance noise floor + CLR) lives INSIDE
the wrapper, so the serving runtime stays microbiome-agnostic and uploads
that arrive un-denoised get cleaned with the same recipe used at training.
"""

from __future__ import annotations

import copy

import numpy as np
import pandas as pd
import torch
import torch.nn.functional as F
from torch_geometric.data import Data
from torch_geometric.loader import DataLoader
from torch_geometric.nn import GCNConv, global_max_pool, global_mean_pool
from torch_geometric.utils import dropout_edge


# ---------------------------------------------------------------------------
# CRC biomarker guilds — Thomas et al. 2019 + Wirbel et al. 2019 meta-analyses
# ---------------------------------------------------------------------------
# Cross-cohort CRC signature: pro-tumor genera that consistently co-occur in
# tumor tissue / faecal samples of CRC patients, vs depleted "protective"
# (butyrate-producing) commensals. We add an all-pairs edge inside each
# guild so the GCN sees the published biomarker structure even when our
# 180-sample correlation graph is too small to recover it.
CRC_BIOMARKER_GUILDS: dict[str, list[str]] = {
    "pro_tumor": [
        # Oral-origin bacteria that translocate to colon tumours
        "Fusobacterium",
        "Peptostreptococcus",
        "Parvimonas",
        "Gemella",
        "Solobacterium",
        "Porphyromonas",
        "Prevotella",
        # Mucin-degraders / opportunists enriched in CRC
        "Hungatella",
        "Anaerococcus",
    ],
    "protective": [
        # Butyrate producers depleted in CRC
        "Faecalibacterium",
        "Roseburia",
        "Eubacterium",
        "Coprococcus",
        "Lachnospiraceae",
        "Anaerostipes",
    ],
}


# Edge-weight presets — weighted GCN aggregation gives the strongest
# signals (high-correlation pairs) more influence than the biological
# priors, but priors still contribute meaningfully.
GUILD_EDGE_WEIGHT = 0.7
TAXONOMIC_EDGE_WEIGHT = 0.5


# ---------------------------------------------------------------------------
# Microbiome preprocessing
# ---------------------------------------------------------------------------
def parse_genus(col: str) -> str:
    """Extract the genus token from a column name like
    ``Faecalibacterium_prausnitzii`` → ``Faecalibacterium``.

    The shapmat sample dataset encodes Genus_species in every column name,
    so taxonomy is recoverable for free.
    """
    return col.split("_")[0] if col else col


def denoise_abundance(arr: np.ndarray, noise_floor: float) -> np.ndarray:
    """Zero out abundances below ``noise_floor``.

    Sub-detection-limit values in 16S/shotgun microbiome data are mostly
    sequencing artefacts. They inflate spurious correlations in any
    co-abundance graph, so a hard floor removes them up-front. Default
    1e-4 (~0.01% relative abundance) sits below p1 of the non-zero values
    in the shapmat sample.
    """
    out = arr.copy()
    out[out < noise_floor] = 0.0
    return out


def clr_transform(arr: np.ndarray, pseudocount: float = 1e-6) -> np.ndarray:
    """Row-wise Centered Log-Ratio: ``log(x_i / geometric_mean(x))``.

    CLR is the standard fix for compositional data: raw abundances sum to
    a fixed total per sample, so when one taxon goes up the rest are
    pushed down by construction. That creates phantom negative
    correlations that contaminate any co-abundance graph. CLR maps the
    simplex to real space and removes the sum-constraint.

    A small ``pseudocount`` replaces zeros so ``log`` is finite.
    """
    safe = arr + pseudocount
    log_safe = np.log(safe)
    geo_mean_log = log_safe.mean(axis=1, keepdims=True)
    return log_safe - geo_mean_log


class MicrobiomePreprocessor:
    """Stateless preprocessor — config object that applies ``denoise → CLR``
    to a tabular abundance frame.

    Pickled into the GCN artifact alongside the wrapper, so an inference
    container does not need to know about microbiome biology to keep the
    train/serve preprocessing identical.
    """

    def __init__(
        self,
        noise_floor: float = 1e-4,
        clr_pseudocount: float = 1e-6,
    ):
        self.noise_floor = float(noise_floor)
        self.clr_pseudocount = float(clr_pseudocount)

    def transform(self, X_df: pd.DataFrame) -> np.ndarray:
        arr = np.asarray(X_df.values, dtype=np.float32)
        arr = denoise_abundance(arr, self.noise_floor)
        arr = clr_transform(arr, self.clr_pseudocount).astype(np.float32)
        return arr


# ---------------------------------------------------------------------------
# Graph construction — three-source weighted edge index
# ---------------------------------------------------------------------------
def build_edge_index(
    X_clr_df: pd.DataFrame,
    corr_threshold: float = 0.4,
    include_taxonomic: bool = True,
    include_biomarker_guilds: bool = True,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Build the bacterial graph the GCN reuses for every sample.

    Edges come from three sources, combined as a weighted union (when a
    pair appears in multiple sources, the maximum weight wins):

    (a) **Statistical co-abundance** — pairs whose Spearman correlation
        on CLR-transformed training data exceeds ``corr_threshold``.
        Edge weight = ``|spearman_clr|`` (signed-magnitude as edge weight
        per Veličković et al. 2018 — high-correlation pairs dominate the
        GCN aggregation).

    (b) **Taxonomic prior** — same-genus cliques. Weight =
        ``TAXONOMIC_EDGE_WEIGHT`` (0.5). Reflects shared ecology and
        metabolism.

    (c) **CRC biomarker guild prior** — Thomas et al. (Nat Med 2019) and
        Wirbel et al. (Nat Med 2019) meta-analyses identify a robust set
        of pro-tumor and protective genera that co-occur across cohorts.
        We connect every pair of features whose genera fall inside the
        same guild. Weight = ``GUILD_EDGE_WEIGHT`` (0.7) — slightly
        higher than taxonomic, because guild membership directly encodes
        CRC-relevance, not just relatedness.

    Returns:
        ``(edge_index, edge_weight)`` both shaped for PyG (2 × E and E).
        Symmetric, de-duplicated. If nothing qualifies, self-loops keep
        PyG happy (``GCNConv`` adds its own internally too).
    """
    feature_names = list(X_clr_df.columns)
    n = len(feature_names)

    # We accumulate edges as ``{(u, v): weight}`` and resolve duplicates
    # by max() so the strongest justification for an edge wins.
    edge_weights: dict[tuple[int, int], float] = {}

    def _add_edge(u: int, v: int, w: float) -> None:
        if u == v:
            return
        for a, b in ((u, v), (v, u)):
            prev = edge_weights.get((a, b))
            if prev is None or w > prev:
                edge_weights[(a, b)] = float(w)

    # (a) statistical edges
    corr = X_clr_df.corr(method="spearman").fillna(0.0).abs().values
    np.fill_diagonal(corr, 0.0)
    stat_pairs = np.argwhere(corr > corr_threshold)
    for u, v in stat_pairs:
        _add_edge(int(u), int(v), float(corr[u, v]))

    # (b) taxonomic edges — clique within each genus
    if include_taxonomic:
        by_genus: dict[str, list[int]] = {}
        for idx, col in enumerate(feature_names):
            by_genus.setdefault(parse_genus(col), []).append(idx)
        for members in by_genus.values():
            if len(members) < 2:
                continue
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    _add_edge(members[i], members[j], TAXONOMIC_EDGE_WEIGHT)

    # (c) CRC biomarker guild edges
    if include_biomarker_guilds:
        genus_of: dict[int, str] = {
            i: parse_genus(col) for i, col in enumerate(feature_names)
        }
        for guild_genera in CRC_BIOMARKER_GUILDS.values():
            guild_set = set(guild_genera)
            members = [i for i, g in genus_of.items() if g in guild_set]
            if len(members) < 2:
                continue
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    _add_edge(members[i], members[j], GUILD_EDGE_WEIGHT)

    if not edge_weights:
        # Degenerate fallback — self-loops so PyG has a valid edge_index.
        src = list(range(n))
        dst = list(range(n))
        weights = [1.0] * n
    else:
        items = list(edge_weights.items())
        src = [a for (a, _b), _w in items]
        dst = [b for (_a, b), _w in items]
        weights = [w for _, w in items]

    edge_index = torch.tensor([src, dst], dtype=torch.long)
    edge_weight = torch.tensor(weights, dtype=torch.float)
    return edge_index, edge_weight


def make_graph_dataset(
    X_arr: np.ndarray,
    y_series: pd.Series,
    edge_index: torch.Tensor,
    edge_weight: torch.Tensor,
) -> list[Data]:
    """One PyG ``Data`` per sample, all sharing the same ``edge_index`` and
    ``edge_weight``. ``X_arr`` is expected to be ALREADY preprocessed
    (CLR-transformed).
    """
    X_arr = np.asarray(X_arr, dtype=np.float32)
    y_arr = y_series.values.astype(np.int64)
    data_list: list[Data] = []
    for i in range(X_arr.shape[0]):
        x = torch.tensor(X_arr[i], dtype=torch.float).unsqueeze(1)
        data_list.append(
            Data(
                x=x,
                edge_index=edge_index,
                edge_weight=edge_weight,
                y=torch.tensor([y_arr[i]], dtype=torch.long),
            )
        )
    return data_list


# ---------------------------------------------------------------------------
# GCN classifier — weighted edges + DropEdge + multi-pool
# ---------------------------------------------------------------------------
class GCNClassifier(torch.nn.Module):
    """GCN with three published refinements layered on the vanilla architecture:

    * ``edge_weight`` passed through every ``GCNConv`` so the message passing
      respects |corr|/guild-priority weights from the graph builder.
    * ``DropEdge`` (Rong et al., ICLR 2020) drops a random fraction of edges
      per forward pass at training time — regularizes the small graph and
      damps GCN over-smoothing.
    * Multi-pool readout (Xu et al., GIN, ICLR 2018): ``mean ⊕ max`` pool
      concatenated before the classifier, which captures more of the node-
      embedding distribution than mean alone.
    """

    def __init__(
        self,
        in_channels: int = 1,
        hidden_channels: int = 64,
        num_layers: int = 2,
        num_classes: int = 2,
        dropout: float = 0.3,
        edge_dropout: float = 0.2,
    ):
        super().__init__()
        self.convs = torch.nn.ModuleList()
        self.convs.append(GCNConv(in_channels, hidden_channels))
        for _ in range(num_layers - 1):
            self.convs.append(GCNConv(hidden_channels, hidden_channels))
        self.dropout = dropout
        self.edge_dropout = edge_dropout
        # 2x because we concatenate mean + max pool
        self.lin = torch.nn.Linear(hidden_channels * 2, num_classes)

    def forward(self, x, edge_index, batch, edge_weight=None):
        # DropEdge — only during training. Drops both directions of an edge
        # consistently and rescales remaining weights.
        if self.training and self.edge_dropout > 0.0:
            edge_index, edge_mask = dropout_edge(
                edge_index, p=self.edge_dropout, force_undirected=True
            )
            if edge_weight is not None:
                edge_weight = edge_weight[edge_mask]

        for conv in self.convs:
            x = conv(x, edge_index, edge_weight=edge_weight)
            x = F.relu(x)
            x = F.dropout(x, p=self.dropout, training=self.training)

        # Multi-pool readout — concat mean + max
        x_mean = global_mean_pool(x, batch)
        x_max = global_max_pool(x, batch)
        x = torch.cat([x_mean, x_max], dim=1)
        return self.lin(x)


# ---------------------------------------------------------------------------
# Tabular wrapper with built-in preprocessing
# ---------------------------------------------------------------------------
class GCNTabularWrapper:
    """Wraps the trained GCN behind a tabular ``predict`` /
    ``predict_proba`` / ``__call__`` interface — exactly the surface
    ``mlflow_explainable`` and SHAP expect.

    Steps inside ``predict_proba``:
        1. Reindex incoming columns to ``self.feature_names`` (drop extras,
           fill missing with 0). Defensive — the serving runtime's
           transformer already does this.
        2. Coerce to numeric (defensive — JSON payloads can arrive as
           strings).
        3. Apply ``self.preprocessor.transform`` — noise floor + CLR.
        4. Build PyG ``Data`` objects sharing ``edge_index`` + ``edge_weight``.
        5. GCN forward + softmax. (DropEdge is OFF at inference.)

    Pickling forces every tensor to CPU (training device may be MPS/CUDA;
    serving container is CPU-only) — see ``__getstate__``.
    """

    def __init__(
        self,
        model: GCNClassifier,
        edge_index: torch.Tensor,
        edge_weight: torch.Tensor,
        device: torch.device,
        feature_names,
        preprocessor: MicrobiomePreprocessor,
        batch_size: int = 64,
    ):
        self.model = model.to(device).eval()
        self.edge_index = edge_index.to(device)
        self.edge_weight = edge_weight.to(device)
        self.device = device
        self.feature_names = list(feature_names)
        self.preprocessor = preprocessor
        self.classes_ = np.array([0, 1])
        self.batch_size = batch_size

    # ---- internal --------------------------------------------------------
    def _to_loader(self, X) -> DataLoader:
        if isinstance(X, pd.DataFrame):
            X_df = X.reindex(columns=self.feature_names, fill_value=0)
        else:
            arr = np.asarray(X)
            if arr.ndim == 1:
                arr = arr.reshape(1, -1)
            X_df = pd.DataFrame(arr, columns=self.feature_names)
        X_df = X_df.apply(pd.to_numeric, errors="coerce").fillna(0.0)
        X_pre = self.preprocessor.transform(X_df)

        ei_cpu = self.edge_index.cpu()
        ew_cpu = self.edge_weight.cpu()
        data_list: list[Data] = []
        for i in range(X_pre.shape[0]):
            x = torch.tensor(X_pre[i], dtype=torch.float).unsqueeze(1)
            data_list.append(
                Data(
                    x=x,
                    edge_index=ei_cpu,
                    edge_weight=ew_cpu,
                    y=torch.tensor([0], dtype=torch.long),
                )
            )
        return DataLoader(data_list, batch_size=self.batch_size, shuffle=False)

    # ---- sklearn-style surface ------------------------------------------
    @torch.no_grad()
    def predict_proba(self, X):
        loader = self._to_loader(X)
        probs: list[np.ndarray] = []
        for batch in loader:
            batch = batch.to(self.device)
            out = self.model(
                batch.x,
                batch.edge_index,
                batch.batch,
                edge_weight=batch.edge_weight,
            )
            probs.append(F.softmax(out, dim=1).cpu().numpy())
        return np.concatenate(probs, axis=0)

    def predict(self, X):
        return self.predict_proba(X).argmax(axis=1)

    def __call__(self, X):
        """Make wrapper callable so ``shap.Explainer(wrapper, X)`` is
        accepted (shap >= 0.43 rejects non-callable model objects).
        Returns class probabilities for the classification surface
        ``log_explainable_model`` expects.
        """
        return self.predict_proba(X)

    # ---- portable serialization -----------------------------------------
    def __getstate__(self):
        """Serialize on CPU so the artifact loads anywhere.

        ``nn.Module.to()`` is in-place — must deep-copy first so the live
        wrapper (which the training script keeps using after logging) is
        not mutated to CPU mid-trial.
        """
        state = self.__dict__.copy()
        model_cpu = copy.deepcopy(self.model).to("cpu").eval()
        state["model"] = model_cpu
        state["edge_index"] = self.edge_index.detach().to("cpu")
        state["edge_weight"] = self.edge_weight.detach().to("cpu")
        state["device"] = torch.device("cpu")
        return state

    def __setstate__(self, state):
        self.__dict__.update(state)
        self.device = torch.device("cpu")
        self.model = self.model.to(self.device).eval()
        self.edge_index = self.edge_index.to(self.device)
        self.edge_weight = self.edge_weight.to(self.device)
