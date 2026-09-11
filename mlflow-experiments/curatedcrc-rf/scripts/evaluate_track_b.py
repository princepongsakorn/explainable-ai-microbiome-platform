#!/usr/bin/env python3
"""Run paper-comparison cohort CV and fixed-500 LODO evaluation."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


EXPERIMENT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EXPERIMENT_ROOT))

from curatedcrc import acquire_upstream, prepare_dataset  # noqa: E402
from curatedcrc.evaluate import evaluate_and_save  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout-dir", type=Path, default=EXPERIMENT_ROOT / ".upstream")
    parser.add_argument("--output-dir", type=Path, default=EXPERIMENT_ROOT / "outputs")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    prepared = prepare_dataset(acquire_upstream(args.checkout_dir))
    cohort_table, lodo_table = evaluate_and_save(prepared, args.output_dir)
    print("\n10-fold x 10-repeat cohort ROC AUC")
    for row in cohort_table.itertuples(index=False):
        suffix = " (paper reference 0.82)" if row.evaluation_group.endswith("III_IV") else ""
        print(f"{row.evaluation_group}: {row.mean_auc:.3f} +/- {row.std_auc:.3f}{suffix}")
    print("\nLeave-one-dataset-out ROC AUC (fixed 500 trees)")
    for row in lodo_table.itertuples(index=False):
        print(
            f"{row.held_out_cohort}: {row.roc_auc:.3f} "
            f"(paper reported {row.paper_reported_auc:.3f})"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
