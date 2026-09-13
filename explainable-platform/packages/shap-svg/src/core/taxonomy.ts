import { ParsedExplanation } from "./types";

/**
 * Taxonomy-aware views of an Explanation.
 *
 * Feature names in this platform are `Genus_species`, which is a real structure
 * the generic charts ignore. At the species level a genus the model genuinely
 * uses can be spread across a dozen columns, each with a SHAP value small
 * enough to read as noise, while the genus as a whole is one of the strongest
 * signals present. The runtime already offers the same collapse behind
 * `?aggregate_by=genus`; doing it here instead costs no request, because the
 * per-species values are already in the browser.
 */

/** The genus part of a `Genus_species` name. */
export function genusOf(featureName: string): string {
  const underscore = featureName.indexOf("_");
  return underscore === -1 ? featureName : featureName.slice(0, underscore);
}

export type GenusGrouping = {
  /** Genera in first-seen order. */
  genera: string[];
  /** For each genus, the Feature indices belonging to it. */
  memberIndices: number[][];
};

/**
 * Group Feature indices by genus, preserving first-seen order.
 *
 * Order matters: it is what keeps the grouping stable across requests, and it
 * is the same rule `_aggregate_shap_by_genus` uses in the runtime, so the two
 * paths cannot disagree about which column belongs where.
 */
export function groupByGenus(featureNames: string[]): GenusGrouping {
  const genera: string[] = [];
  const memberIndices: number[][] = [];
  const seen = new Map<string, number>();

  featureNames.forEach((name, index) => {
    const genus = genusOf(name);
    let slot = seen.get(genus);
    if (slot === undefined) {
      slot = genera.length;
      seen.set(genus, slot);
      genera.push(genus);
      memberIndices.push([]);
    }
    memberIndices[slot].push(index);
  });

  return { genera, memberIndices };
}

export type AggregatedExplanation = {
  values: number[][];
  data: number[][];
  featureNames: string[];
};

/**
 * Collapse `Genus_species` columns into one column per genus.
 *
 * Summing is the correct operator, not averaging: SHAP is additive, so the
 * per-Feature values satisfy `base + sum(phi) = f(x)`. A sum within groups is a
 * re-partition of that same total, which leaves the identity intact — every
 * waterfall still adds up, and there is a test saying so. Abundance is summed
 * for the same reason, giving the genus's total relative abundance, which is
 * what the colour should mean once the rows are genera.
 */
export function aggregateByGenus(
  values: number[][],
  data: number[][],
  featureNames: string[],
): AggregatedExplanation {
  const { genera, memberIndices } = groupByGenus(featureNames);
  const sumInto = (rows: number[][]) =>
    rows.map((row) =>
      memberIndices.map((members) =>
        members.reduce((total, index) => total + (row[index] ?? 0), 0),
      ),
    );

  return {
    values: sumInto(values),
    data: sumInto(data),
    featureNames: genera,
  };
}

/**
 * A parsed Explanation with its Feature axis collapsed to genera.
 *
 * Only the Feature axis changes. Base values, Sample ids and the Sample count
 * carry through untouched, so everything downstream — ordering, the Other row,
 * the waterfall walk — runs unchanged on genera, and `base + sum(phi) = f(x)`
 * still holds for every Sample. The input is not mutated.
 */
export function groupExplanationByGenus(explanation: ParsedExplanation): ParsedExplanation {
  const grouped = aggregateByGenus(
    explanation.values,
    explanation.data,
    explanation.featureNames,
  );
  return {
    ...explanation,
    values: grouped.values,
    data: grouped.data,
    featureNames: grouped.featureNames,
    nFeatures: grouped.featureNames.length,
  };
}
