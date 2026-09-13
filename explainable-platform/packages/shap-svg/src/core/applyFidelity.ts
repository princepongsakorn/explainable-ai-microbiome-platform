import { Presentation } from "./fidelity";
import { formatFeatureLabel } from "./format";
import { aggregateByGenus } from "./taxonomy";
import { ParsedExplanation } from "./types";

/**
 * Reshape a parsed Explanation for a fidelity level, before any layout sees it.
 *
 * Only the microbiome level changes the data, and only by re-partitioning the
 * Feature axis — no value is recomputed, dropped or rounded, so every ordering
 * and every invariant downstream still holds. Levels that change nothing return
 * the same object rather than a copy, which keeps the React memo keys honest.
 *
 * Display names are decided here rather than inside each layout, so "what a row
 * is called" has one owner. Faithful mode keeps the raw `Genus_species` string
 * a SHAP figure would show; the other levels read it as a binomial.
 */
export function applyFidelity(
  explanation: ParsedExplanation,
  presentation: Presentation,
): ParsedExplanation {
  const named = presentation.taxonomicNames
    ? { ...explanation, featureNames: explanation.featureNames.map(formatFeatureLabel) }
    : explanation;

  if (!presentation.groupByGenus) return named;

  // Grouping runs on the ORIGINAL names: genusOf splits on the first
  // underscore, which formatFeatureLabel has already replaced with a space.
  const grouped = aggregateByGenus(
    explanation.values,
    explanation.data,
    explanation.featureNames,
  );

  return {
    ...named,
    values: grouped.values,
    data: grouped.data,
    featureNames: grouped.featureNames,
    nFeatures: grouped.featureNames.length,
  };
}
