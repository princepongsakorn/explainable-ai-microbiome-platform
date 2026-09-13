/**
 * How closely a chart reproduces SHAP's own output.
 *
 * The three levels were posed as a question during design: is the goal a figure
 * that looks like a SHAP figure, the same numbers presented better, or a view
 * built for the data this platform actually carries? They are not a quality
 * ranking — each is right for a different reader — so they are a prop, not a
 * migration.
 *
 * Every level draws from the same payload and the same ordering. What changes
 * is presentation, and `presentationFor` is the whole list of what changes;
 * nothing outside this table may differ between levels.
 */
export type Fidelity = "faithful" | "adapted" | "microbiome";

/** How a SHAP value is written as text. */
export type ValueUnits =
  /** SHAP's own `%+0.02f`, which renders anything below 0.005 as `+0.00`. */
  | "shap"
  /** Three significant figures, with an exponent for values too small for it. */
  | "significant"
  /** Probability points: 0.021 becomes `+2.1 pp`. */
  | "percentagePoints";

/** How a contribution of exactly zero is coloured. */
export type ZeroHandling =
  /**
   * SHAP's own behaviour, which is inconsistent between charts: `_bar.py`
   * tests `<= 0` and `_waterfall.py` tests `>= 0`, so the same zero is blue in
   * one and red in the other.
   */
  | "shapPerChart"
  /** Grey. A zero contribution did nothing, and neither colour says that. */
  | "neutral";

/** How the beeswarm colours a Feature's value. */
export type AbundanceScale =
  /** Raw value against the row's 5th-95th percentile, as SHAP does. */
  | "raw"
  /** The Sample's rank among the Samples, as a percentile. */
  | "percentile";

export type Presentation = {
  /**
   * Absorb the Feature ranked `maxDisplay` into the Other row, as SHAP does,
   * so `maxDisplay=15` draws 14 real Features. Surprising, and arguably a bug,
   * but it is what published SHAP figures show.
   */
  faithfulOtherRow: boolean;
  units: ValueUnits;
  /** Replace underscores with spaces and italicise the binomial. */
  taxonomicNames: boolean;
  /** Numeric ticks on the colour legend rather than only High/Low. */
  numericLegend: boolean;
  zeroHandling: ZeroHandling;
  /** Collapse `Genus_species` rows into their genus. */
  groupByGenus: boolean;
  abundanceScale: AbundanceScale;
  /** Report how many Samples carry the taxon at all, not only how much. */
  showPrevalence: boolean;
};

const PRESENTATIONS: Record<Fidelity, Presentation> = {
  // (a) Reproduce SHAP, bugs included. For figures that sit next to published
  // SHAP figures and must be comparable to them.
  faithful: {
    faithfulOtherRow: true,
    units: "shap",
    taxonomicNames: false,
    numericLegend: false,
    zeroHandling: "shapPerChart",
    groupByGenus: false,
    abundanceScale: "raw",
    showPrevalence: false,
  },
  // (b) Same numbers, same algorithm, presentation fixed. The default: every
  // deviation here is listed in docs/shap-explain-spec.md 3.5 as V1-V5.
  adapted: {
    faithfulOtherRow: false,
    units: "significant",
    taxonomicNames: true,
    numericLegend: true,
    zeroHandling: "neutral",
    groupByGenus: false,
    abundanceScale: "raw",
    showPrevalence: false,
  },
  // (c) SHAP as the source of the numbers, the view built for this data.
  microbiome: {
    faithfulOtherRow: false,
    units: "percentagePoints",
    taxonomicNames: true,
    numericLegend: true,
    zeroHandling: "neutral",
    groupByGenus: true,
    abundanceScale: "percentile",
    showPrevalence: true,
  },
};

export const DEFAULT_FIDELITY: Fidelity = "adapted";

export function presentationFor(fidelity: Fidelity = DEFAULT_FIDELITY): Presentation {
  const presentation = PRESENTATIONS[fidelity];
  if (!presentation) {
    throw new RangeError(
      `Unknown fidelity "${fidelity}"; expected faithful, adapted or microbiome`,
    );
  }
  return presentation;
}
