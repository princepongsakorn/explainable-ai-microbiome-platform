"""Summarise the `K6RUN {json}` lines that the k6 scripts print.

usage: python3 summarize.py <stdout.log> [<stdout.log> ...]

Prints a Markdown table per metric for all runs, the cold run (the first
iteration) and the warm runs (the rest), plus the predictionIds the runs
created, which cleanup needs.
"""

import json
import statistics
import sys

METRICS = [
    ("uploadMs", "Upload request (CSV → response)"),
    ("predictionMs", "Prediction, all samples done"),
    ("explanationMs", "Explanation payload ready"),
    ("downloadMs", "Payload download"),
    ("predictMs", "Direct /v1/predict, all samples in one request"),
    ("explainMs", "Direct /v1/explain/values, all chunks in sequence"),
]


def read_runs(path):
    runs = []
    with open(path, encoding="utf-8") as log:
        for line in log:
            marker = line.find("K6RUN ")
            if marker == -1:
                continue
            text = line[marker + len("K6RUN "):].strip()
            # k6 logs console output as msg="..." with the message escaped, so
            # unquote it as a JSON string first, then parse what was inside.
            if text.endswith('" source=console'):
                text = json.loads('"' + text[: -len('" source=console')] + '"')
            runs.append(json.loads(text))
    return runs


def stats(values):
    if not values:
        return "–", "–", "–", "–"
    s = [v / 1000 for v in values]
    return (
        f"{statistics.mean(s):.2f}",
        f"{statistics.median(s):.2f}",
        f"{min(s):.2f}",
        f"{max(s):.2f}",
    )


def table(runs):
    rows = ["| Measure | Runs | n | Mean (s) | Median (s) | Min (s) | Max (s) | Failed |",
            "|---|---|---|---|---|---|---|---|"]
    groups = [("all", runs), ("cold (1st)", runs[:1]), ("warm (2nd–)", runs[1:])]
    for key, label in METRICS:
        if not any(key in r for r in runs):
            continue
        for name, group in groups:
            values = [r[key] for r in group if r.get(key) is not None and r.get("ok")]
            failed = sum(1 for r in group if not r.get("ok"))
            rows.append(f"| {label} | {name} | {len(values)} | " + " | ".join(stats(values)) + f" | {failed} |")
    return "\n".join(rows)


def main():
    runs = [run for path in sys.argv[1:] for run in read_runs(path)]
    if not runs:
        sys.exit("no K6RUN lines found")
    print(table(runs))
    sizes = [r["uncompressedBytes"] for r in runs if r.get("uncompressedBytes")]
    if sizes:
        print(f"\nUncompressed payload: {min(sizes)}–{max(sizes)} bytes")
    ids = [r["predictionId"] for r in runs if r.get("predictionId")]
    if ids:
        print("\npredictionIds: " + " ".join(ids))


if __name__ == "__main__":
    main()
