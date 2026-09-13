"""Generate shap-svg fixtures and golden values offline.

No MLflow and no network: trains small RandomForests on data already committed to this
repo, explains them with the locally installed shap, and captures what `shap.plots.bar`
actually draws so the TypeScript renderer can be tested against SHAP itself rather than
against someone's reading of SHAP.

Run with the worktree venv, which has shap 0.49.1:

    .worktrees/curatedcrc-retraining/.venv/bin/python tools/shap_fixtures/generate.py

See docs/shap-explain-spec.md §1 for the payload contract and §4 for what each fixture is for.
"""

from __future__ import annotations

import json
import pathlib
import sys

import matplotlib

matplotlib.use("Agg")

import matplotlib.axes  # noqa: E402
import matplotlib.colors  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import shap  # noqa: E402
from sklearn.ensemble import RandomForestClassifier  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parents[2]
OUT = REPO / "explainable-platform/packages/shap-svg/fixtures"
SEED = 0

# The fixtures are the acceptance criterion for shap-svg, so they must be produced by
# the same builder the runtime uses — a second implementation could drift and the
# golden tests would keep passing against a payload the server no longer emits.
sys.path.insert(0, str(REPO / "kserve-custom-runtime"))
from explain_payload import build_payload, sigfig  # noqa: E402


# ---------------------------------------------------------------------------
# Explaining
# ---------------------------------------------------------------------------
def explain(X: pd.DataFrame, y: pd.Series, n_estimators: int = 60):
    """Fit a small forest and return (values[n,p], base_values[n]).

    TreeExplainer with a background is `interventional`; it tiles one expected value
    across every row, which is why `base_values` comes back constant here.
    """
    model = RandomForestClassifier(n_estimators=n_estimators, random_state=SEED).fit(X, y)
    out = shap.TreeExplainer(model, data=X)(X)
    values = out.values[:, :, 1] if out.values.ndim == 3 else out.values
    base = out.base_values[:, 1] if np.ndim(out.base_values) == 2 else out.base_values
    base = np.broadcast_to(np.asarray(base, dtype=float).ravel(), (len(X),))
    return values, base


def capture_bar(values, base_values, data, feature_names, max_display: int) -> dict:
    """Record the arrays `shap.plots.bar` hands to matplotlib.

    `shap.plots.bar` calls `ax.barh`, not `plt.barh`, so the patch goes on the Axes
    class. The captured order is already top-to-bottom, matching the y tick labels.
    """
    captured: dict = {}
    original = matplotlib.axes.Axes.barh

    def spy(self, y, width, *args, **kwargs):
        captured.setdefault("values", [float(w) for w in np.asarray(width, dtype=float)])
        colors = kwargs.get("color")
        if colors is not None:
            captured.setdefault("colors", [matplotlib.colors.to_hex(c) for c in colors])
        return original(self, y, width, *args, **kwargs)

    matplotlib.axes.Axes.barh = spy
    try:
        explanation = shap.Explanation(
            np.asarray(values, dtype=float),
            base_values=np.asarray(base_values, dtype=float).ravel(),
            data=np.asarray(data, dtype=float),
            feature_names=[str(n) for n in feature_names],
        )
        plt.figure()
        shap.plots.bar(explanation, max_display=max_display, show=False)
        # set_yticks is called with the labels twice (_bar.py:277); the halves are
        # identical for our feature names, so take the first.
        ticks = [t.get_text() for t in plt.gca().get_yticklabels()]
        labels = ticks[: len(ticks) // 2]
        plt.close("all")
    finally:
        matplotlib.axes.Axes.barh = original

    if len(labels) != len(captured["values"]):
        raise RuntimeError(
            f"captured {len(captured['values'])} bars but {len(labels)} labels — "
            "shap's bar internals changed, fix this script before trusting the golden file"
        )

    return {
        "max_display": max_display,
        # Spec §3.5 V3: the renderer displays species names with spaces.
        "labels": [lbl.replace("_", " ") for lbl in labels],
        "values": [sigfig(v) for v in captured["values"]],
        "colors": captured.get("colors", []),
    }


def capture_waterfall(values, base_value, data, feature_names, max_display: int) -> dict:
    """Record the arrows `shap.plots._waterfall.waterfall_legacy` hands to matplotlib.

    The runtime calls waterfall_legacy, not the modern waterfall, so that is what the
    golden file must reflect. The two share an algorithm; only the call signature differs.

    Three things here are not obvious and each one has bitten someone:

    * the y tick labels come out **bottom-to-top** (`rng[i] = num_features - 1 - i`),
      so the largest |phi| is the last label, not the first — the opposite of bar;
    * arrows arrive **all the positive ones first, then all the negative ones**,
      because _waterfall.py draws them in two loops; use `row` to map an arrow back
      to its rank, not its position in this list;
    * `dx` is only the arrow body. See the comment on the spy below.
    """
    captured: list[dict] = []
    original = matplotlib.axes.Axes.arrow

    def spy(self, x, y, dx, dy, **kwargs):
        # `dx` is the arrow *body*: _waterfall.py passes `dist - hl_scaled` and puts
        # the rest in head_length, so dx alone is NOT the Feature's contribution.
        # Record the reconstructed total too, so nobody has to rediscover that.
        head = float(kwargs.get("head_length", 0.0))
        contribution = float(dx) + (head if float(dx) >= 0 else -head)
        captured.append(
            {
                "x": sigfig(x, 6),
                "row": int(round(float(y))),
                "dx": sigfig(dx, 6),
                "head_length": sigfig(head, 6),
                "contribution": sigfig(contribution, 6),
                "bar_width": sigfig(kwargs.get("width", 0.0), 6),
                "color": matplotlib.colors.to_hex(kwargs.get("color")),
            }
        )
        return original(self, x, y, dx, dy, **kwargs)

    matplotlib.axes.Axes.arrow = spy
    try:
        plt.figure()
        shap.plots._waterfall.waterfall_legacy(
            float(base_value),
            np.asarray(values, dtype=float),
            features=np.asarray(data, dtype=float),
            feature_names=[str(n) for n in feature_names],
            max_display=max_display,
            show=False,
        )
        ticks = [t.get_text() for t in plt.gca().get_yticklabels()]
        # Drawn twice, as in bar (_waterfall.py:296-299). Take the first half and
        # reverse it so the golden file reads top-to-bottom like the chart does.
        labels = [t.strip() for t in ticks[: len(ticks) // 2]][::-1]
        plt.close("all")
    finally:
        matplotlib.axes.Axes.arrow = original

    values_arr = np.asarray(values, dtype=float)
    return {
        "max_display": max_display,
        "base_value": sigfig(base_value, 6),
        "fx": sigfig(float(base_value) + float(values_arr.sum()), 6),
        # Species names keep their underscores here; stripping them is the renderer's
        # job (spec 3.5 V3) and bar's golden file already exercises that path.
        "labels": labels,
        "arrows": captured,
    }


def capture_beeswarm(values, base_values, data, feature_names, max_display: int) -> dict:
    """Record what `shap.plots.beeswarm` draws, per displayed row.

    **The point order cannot be reproduced outside Python.** _beeswarm.py shuffles
    (`np.random.shuffle`) and breaks ties with `np.random.randn(N) * 1e-6`, so which
    point lands at +1 versus -1 within a bin is down to numpy's RNG. What *is*
    deterministic — and what a TypeScript implementation must reproduce — is:

    * the set of x values in each row,
    * the **multiset of |y - row|** jitter magnitudes, which follows from the
      100-bin binning and the 0,+1,-1,+2,-2 layering alone,
    * `vmin`/`vmax`, the 5th/95th percentile clip of that row's feature values,
    * the row order and labels.

    So the golden file stores sorted values, and the test compares sets rather than
    sequences. Seeding numpy only makes this file reproducible run to run; it does
    not make the order meaningful to a consumer.
    """
    np.random.seed(SEED)

    rows: list[dict] = []
    original = matplotlib.axes.Axes.scatter

    def spy(self, x, y, **kwargs):
        xs = np.atleast_1d(np.asarray(x, dtype=float))
        ys = np.atleast_1d(np.asarray(y, dtype=float))
        if xs.size:
            colour_values = kwargs.get("c")
            rows.append(
                {
                    "x": xs,
                    "y": ys,
                    "c": None if colour_values is None else np.asarray(colour_values, float),
                    "vmin": kwargs.get("vmin"),
                    "vmax": kwargs.get("vmax"),
                    "is_nan_layer": colour_values is None,
                }
            )
        return original(self, x, y, **kwargs)

    matplotlib.axes.Axes.scatter = spy
    try:
        explanation = shap.Explanation(
            np.asarray(values, dtype=float),
            base_values=np.asarray(base_values, dtype=float).ravel(),
            data=np.asarray(data, dtype=float),
            feature_names=[str(n) for n in feature_names],
        )
        plt.figure()
        shap.plots.beeswarm(explanation, max_display=max_display, show=False)
        ticks = [t.get_text() for t in plt.gca().get_yticklabels()]
        labels = ticks[::-1]
        plt.close("all")
    finally:
        matplotlib.axes.Axes.scatter = original

    # Rows arrive bottom-to-top, matching the tick order before it is reversed.
    coloured = [r for r in rows if not r["is_nan_layer"]][::-1]

    return {
        "max_display": max_display,
        "dot_size": 16,
        "nan_color": "#777777",
        "labels": labels,
        "rows": [
            {
                "label": label,
                "row_index": len(coloured) - 1 - i,
                "x_sorted": sorted(sigfig(v, 6) for v in row["x"]),
                # |y - row| — the jitter magnitudes, which are reproducible; the
                # assignment of sign to a particular point is not.
                "jitter_sorted": sorted(
                    sigfig(abs(float(y) - (len(coloured) - 1 - i)), 6) for y in row["y"]
                ),
                "vmin": sigfig(row["vmin"], 6),
                "vmax": sigfig(row["vmax"], 6),
                "colour_values_sorted": sorted(sigfig(v, 6) for v in row["c"]),
            }
            for i, (label, row) in enumerate(zip(labels, coloured))
        ],
    }


def capture_heatmap(values, base_values, data, feature_names, max_display: int) -> dict:
    """Record what `shap.plots.heatmap` draws.

    This repo does **not** use SHAP's default `hclust` instance ordering — the
    runtime passes `instance_order=explanation.sum(1)` (see
    kserve-shap-multi-modelserver.py), which `convert_ordering` turns into a
    descending sort by the row's total attribution. That is an O(n log n) sort a
    renderer can do itself, so the capture reflects what the platform actually
    draws rather than SHAP's default.
    """
    captured: dict = {}
    original = matplotlib.axes.Axes.imshow

    def spy(self, X, **kwargs):
        captured.setdefault("matrix", np.asarray(X, dtype=float))
        captured.setdefault("vmin", kwargs.get("vmin"))
        captured.setdefault("vmax", kwargs.get("vmax"))
        captured.setdefault("aspect", kwargs.get("aspect"))
        return original(self, X, **kwargs)

    matplotlib.axes.Axes.imshow = spy
    try:
        explanation = shap.Explanation(
            np.asarray(values, dtype=float),
            base_values=np.asarray(base_values, dtype=float).ravel(),
            data=np.asarray(data, dtype=float),
            feature_names=[str(n) for n in feature_names],
        )
        plt.figure()
        shap.plots.heatmap(
            explanation,
            instance_order=explanation.sum(1),
            max_display=max_display,
            show=False,
        )
        ticks = [t.get_text() for t in plt.gca().get_yticklabels()]
        plt.close("all")
    finally:
        matplotlib.axes.Axes.imshow = original

    matrix = captured["matrix"]  # imshow receives values.T — features x instances
    return {
        "max_display": max_display,
        "instance_order": "sum(1) descending",
        # The first tick is the f(x) line's label, not a Feature.
        "labels": [t for t in ticks if t and "f(x)" not in t],
        "vmin": sigfig(captured["vmin"], 6),
        "vmax": sigfig(captured["vmax"], 6),
        "aspect": sigfig(captured["aspect"], 6),
        "n_features_drawn": int(matrix.shape[0]),
        "n_instances": int(matrix.shape[1]),
        # Row-major, features x instances, exactly as imshow received it.
        "matrix": [[sigfig(v, 6) for v in row] for row in matrix],
        # Sum over features per instance — the line drawn above the grid.
        "fx_line": [sigfig(v, 6) for v in matrix.sum(axis=0)],
    }


def write_colormaps() -> None:
    """Dump SHAP's colormaps as lookup tables.

    matplotlib interpolates linearly in sRGB between precomputed stops, so a table
    plus linear interpolation reproduces them exactly. Re-deriving the Lab/Lch maths
    in TypeScript would be work for a worse result.
    """
    from shap.plots import colors as shap_colors

    def lut(cmap, n=256):
        return [
            "#%02x%02x%02x"
            % tuple(int(round(channel * 255)) for channel in cmap(i / (n - 1))[:3])
            for i in range(n)
        ]

    write(
        "colormaps.json",
        {
            "note": "256-entry sRGB lookup tables dumped from shap.plots.colors. "
            "Interpolate linearly between entries; do not re-derive from Lch.",
            "red_blue": lut(shap_colors.red_blue),
            "red_white_blue": lut(shap_colors.red_white_blue),
            "nan_grey": "#%02x%02x%02x"
            % tuple(int(round(c * 255)) for c in shap_colors.gray_rgb),
        },
    )


def write(name: str, obj) -> None:
    path = OUT / name
    path.write_text(json.dumps(obj, indent=1))
    print(f"wrote {name}  ({path.stat().st_size:,} bytes)")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    # --- real: the committed shapmat sample, 180 Samples x 201 Features -------
    # The only fixture with genuine relative-abundance skew. Spec §4 forbids
    # substituting synthetic Gaussian data here.
    real_df = pd.read_csv(REPO / "sample-data/sample.csv", index_col=0)
    real_X = real_df.drop(columns=["CRC"])
    real_v, real_b = explain(real_X, real_df["CRC"])
    write("real.json", build_payload(real_v, real_b, real_X.values, real_X.columns, real_X.index))
    write("real.bar.golden.json", capture_bar(real_v, real_b, real_X.values, real_X.columns, 10))
    write(
        "real.waterfall.golden.json",
        {
            "sample_index": 0,
            "sample_id": str(real_X.index[0]),
            **capture_waterfall(real_v[0], real_b[0], real_X.values[0], real_X.columns, 10),
        },
    )

    # --- tiny: 20 Samples x the 50 most important Features -------------------
    top50 = np.argsort(-np.abs(real_v).mean(0))[:50]
    tiny_v = real_v[:20][:, top50]
    tiny_b = real_b[:20]
    tiny_d = real_X.values[:20][:, top50]
    tiny_names = real_X.columns[top50]
    write("tiny.json", build_payload(tiny_v, tiny_b, tiny_d, tiny_names, real_X.index[:20]))
    write("tiny.bar.golden.json", capture_bar(tiny_v, tiny_b, tiny_d, tiny_names, 10))
    # Waterfall is a Local explanation — one Sample, so the golden file names which.
    write(
        "tiny.waterfall.golden.json",
        {
            "sample_index": 0,
            "sample_id": str(real_X.index[0]),
            **capture_waterfall(tiny_v[0], tiny_b[0], tiny_d[0], tiny_names, 10),
        },
    )

    # --- large: 331 Samples x 865 Features, for performance only -------------
    large_X = pd.read_csv(REPO / "sample-data/yachidas_2019_test.csv", index_col=0)
    large_y = pd.read_csv(
        REPO / "sample-data/yachidas_2019_test_labels.csv", index_col=0
    ).loc[large_X.index, "label"]
    large_v, large_b = explain(large_X, large_y, n_estimators=30)
    write(
        "tiny.beeswarm.golden.json",
        capture_beeswarm(tiny_v, tiny_b, tiny_d, tiny_names, 10),
    )
    write(
        "real.beeswarm.golden.json",
        capture_beeswarm(real_v, real_b, real_X.values, real_X.columns, 10),
    )
    write(
        "tiny.heatmap.golden.json",
        capture_heatmap(tiny_v, tiny_b, tiny_d, tiny_names, 10),
    )
    write_colormaps()

    write("large.json", build_payload(large_v, large_b, large_X.values, large_X.columns, large_X.index))

    # --- edge: the shapes that break naive renderers -------------------------
    names6 = list(tiny_names[:6])
    row_v = list(tiny_v[0][:6])
    row_d = list(tiny_d[0][:6])
    write(
        "edge.json",
        {
            "single_sample": build_payload(
                [tiny_v[0]], [tiny_b[0]], [tiny_d[0]], tiny_names, [real_X.index[0]]
            ),
            "zero_feature_column": build_payload(
                [[0.0] + row_v[1:]], [tiny_b[0]], [[0.0] + row_d[1:]], names6, ["s0"]
            ),
            "all_negative": build_payload(
                [[-abs(v) for v in row_v]], [tiny_b[0]], [row_d], names6, ["s0"]
            ),
            "fewer_features_than_max_display": build_payload(
                [row_v[:3]], [tiny_b[0]], [row_d[:3]], names6[:3], ["s0"]
            ),
        },
    )


if __name__ == "__main__":
    main()
