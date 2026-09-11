import { ParsedExplanation } from "./types";

/** mean(|phi|) over Samples, per Feature — what shap.plots.bar collapses a 2-D Explanation to. */
export function globalImportance(e: ParsedExplanation): number[] {
  const out = new Array<number>(e.nFeatures).fill(0);
  for (const row of e.values) {
    for (let j = 0; j < e.nFeatures; j++) out[j] += Math.abs(row[j]);
  }
  return out.map((sum) => sum / e.nSamples);
}

/** Descending by importance; ties resolved by ascending index so renders are reproducible. */
export function orderFeatures(importance: number[]): number[] {
  return importance
    .map((value, index) => ({ value, index }))
    .sort((a, b) => (b.value - a.value) || (a.index - b.index))
    .map((entry) => entry.index);
}
