"""Diagnose the registered sample-gcn-crc model end to end, locally.

Loads the Production version straight from the MLflow registry and exercises
the exact contract the kserve runtime uses — predict() and shap_explain() —
then prints the raw outputs. This isolates whether a serving failure lives in
the model artifact, the mlflow_explainable contract, or the runtime/backend
wiring.

Run inside the venv that has mlflow + torch + torch_geometric installed::

    python diagnose_gcn.py
"""

import json
import os
import time

import mlflow
import numpy as np
import pandas as pd

os.environ.setdefault(
    "MLFLOW_TRACKING_USERNAME", "b881211d-796e-4b12-8621-6246d2eeadce"
)
os.environ.setdefault(
    "MLFLOW_TRACKING_PASSWORD", "k7uLbDEGc6beQlAWTCUJAUAmJskdr5bLUDmsiCG4"
)
mlflow.set_tracking_uri("http://136.115.33.253:5000")

MODEL = "sample-gcn-crc"
SAMPLE_URL = (
    "https://raw.githubusercontent.com/ryzary/shapmat/"
    "refs/heads/cv_notebook/data/sample.csv"
)


def main():
    # ---- input ------------------------------------------------------------
    df = pd.read_csv(SAMPLE_URL, index_col=0)
    X = df.drop(columns=["CRC"]).head(3)
    print(f"input X: shape={X.shape}")

    # ---- load -------------------------------------------------------------
    uri = f"models:/{MODEL}/Production"
    print(f"\nloading {uri} ...")
    t = time.time()
    loaded = mlflow.pyfunc.load_model(uri)
    print(f"  loaded OK in {time.time() - t:.1f}s  ({type(loaded).__name__})")

    # ---- predict ----------------------------------------------------------
    print("\n=== predict() ===")
    out = loaded.predict(X)
    print(out)
    print("dtypes:", dict(out.dtypes))
    nan_cols = out.isna().any().to_dict()
    print("has-NaN per column:", nan_cols)

    # Reproduce exactly what the runtime does before jsonify.
    try:
        for idx, row in out.iterrows():
            json.dumps(
                {
                    "id": idx,
                    "proba": float(row["Y_proba"]),
                    "class": int(row["Y_class"]),
                },
                allow_nan=False,  # strict — browsers reject NaN/Infinity
            )
        print("strict-JSON serializable: YES")
    except Exception as e:
        print(f"strict-JSON serializable: NO  ->  {type(e).__name__}: {e}")
        print(">>> This is why proba/class show empty in the UI.")

    # ---- shap_explain -----------------------------------------------------
    print("\n=== shap_explain() ===")
    impl = loaded._model_impl.python_model
    print(f"impl: {type(impl).__name__}  (module={type(impl).__module__})")
    t = time.time()
    try:
        exp = impl.shap_explain(X)
        dt = time.time() - t
        print(f"shap_explain took {dt:.1f}s")
        for k, v in exp.items():
            v = np.asarray(v)
            has_nan = (
                bool(np.isnan(v).any()) if v.dtype.kind == "f" else "n/a"
            )
            print(f"  {k}: shape={v.shape} dtype={v.dtype} hasNaN={has_nan}")
        if dt > 30:
            print(">>> shap_explain is slow — explain endpoints may time out.")
    except Exception as e:
        print(f"shap_explain FAILED: {type(e).__name__}: {e}")

    print("\ndone.")


if __name__ == "__main__":
    main()
