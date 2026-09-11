#!/usr/bin/env python3
"""Acquire curatedCRC, validate/filter it, and export the 60-row sample."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


EXPERIMENT_ROOT = Path(__file__).resolve().parents[1]
REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(EXPERIMENT_ROOT))

from curatedcrc import acquire_upstream, prepare_dataset  # noqa: E402
from curatedcrc.sample import export_platform_sample  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout-dir", type=Path, default=EXPERIMENT_ROOT / ".upstream")
    parser.add_argument(
        "--sample-csv",
        type=Path,
        default=REPOSITORY_ROOT / "sample-data" / "curatedCRC-60-row.csv",
    )
    parser.add_argument(
        "--sample-manifest",
        type=Path,
        default=REPOSITORY_ROOT / "sample-data" / "curatedCRC-60-row.manifest.json",
    )
    parser.add_argument("--output-dir", type=Path, default=EXPERIMENT_ROOT / "outputs")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source = acquire_upstream(args.checkout_dir)
    prepared = prepare_dataset(source)
    manifest = export_platform_sample(
        prepared,
        args.sample_csv,
        args.sample_manifest,
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    provenance_path = args.output_dir / "data_provenance.json"
    provenance_path.write_text(
        json.dumps(prepared.provenance, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"source={source.data_path}")
    print(f"sha256={source.sha256}")
    print(f"samples={len(prepared.X)}")
    print(f"features={prepared.raw_feature_count}->{prepared.filtered_feature_count}")
    print(f"sample_csv={args.sample_csv} rows={manifest['sample_size']}")
    print(f"sample_classes={manifest['class_counts']}")
    print(f"sample_cohorts={manifest['cohort_counts']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
