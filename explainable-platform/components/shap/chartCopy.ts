import type { PlotLabels } from "shap-svg";

/**
 * The charts' text in the terms a microbiome researcher reads results in. The
 * numbers are SHAP's, unchanged; only what they are called differs from SHAP's
 * figures. Every model this platform serves explains a predicted probability.
 */
export const RESEARCH_LABELS: Partial<PlotLabels> = {
  shapValue: "Contribution",
  shapValueAxis: "Contribution to predicted probability",
  meanAbsShapValue: "Mean absolute contribution",
  featureValue: "Relative abundance",
  missingFeatureValue: "not measured",
  samples: "Samples",
  sampleTotal: "Total contribution",
  baseValue: "Average prediction",
  modelOutput: "Prediction",
  otherFeatures: (count) => `${count} other taxa`,
  // A zero here is a taxon the sequencing did not find, which is a different
  // statement from "found at a low level" — the charts keep the two apart and
  // so does the wording.
  absent: "Not detected",
  absentWithCount: (count) => `Not detected (n = ${count})`,
  cumulativeShapValue: "Predicted probability",
  higher: "raises",
  lower: "lowers",
  weakInteraction: "no strong interaction with another taxon",
  tableCaption: "The values this chart draws",
  // A principal component means nothing by itself; the chart measures whether
  // it lines up with the summed contributions and only then says so.
  componentTracksTotal: (r) => `tracks total contribution (r = ${r.toFixed(2)})`,
  // The key is boxed and sits beside its own gradient, so it no longer reads as
  // an axis and no longer needs a word saying it is a colour scale.
  colorScale: (what) => what,
};

/**
 * How the two per-sample charts are introduced, defined once.
 *
 * They appear both on a sample's own page and in the dialog a point on a global
 * chart opens; a reader arriving either way should be reading the same words.
 */
export const LOCAL_CHART_COPY = {
  glance: {
    title: "Contributions at a Glance",
    description:
      "The same breakdown on a single line. What raises this sample’s prediction pushes in from the left and what lowers it from the right; they meet where the prediction landed.",
  },
  breakdown: {
    title: "Contribution Breakdown",
    description:
      "How this sample’s taxa move the prediction from the model’s average to its final output. Red pushes the prediction up and blue pushes it down; the bars add up to the difference.",
  },
} as const;

/** A taxon as a person reads it: the underscore in `Genus_species` is a space. */
export const formatTaxonName = (name: string) => name.replace(/_/g, " ");
