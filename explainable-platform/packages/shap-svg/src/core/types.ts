/** The wire payload. Core fields are named exactly as shap.Explanation names them. */
export type Explanation = {
  contract_version: number;
  values: number[][] | number[][][];
  base_values: number | number[] | number[][];
  data: number[][];
  feature_names: string[];
  sample_ids?: string[];
  /** n — what a person reads for each Sample; never a join key. */
  sample_labels?: string[];
  /** Header of the uploaded column the labels came from, when it had one. */
  sample_label_column?: string;
  output_names?: string[];
  model_name?: string;
  model_version?: string;
};

/** A validated Explanation with the class axis resolved away. */
export type ParsedExplanation = {
  /** n x p, class already selected */
  values: number[][];
  /** n x p */
  data: number[][];
  /** length n — always per Sample, even when the wire form was a scalar */
  baseValues: number[];
  /** length p */
  featureNames: string[];
  /** length n, undefined when the payload omitted it */
  sampleIds?: string[];
  /** length n — display names. sampleIds stays the key for joins and click-through. */
  sampleLabels?: string[];
  sampleLabelColumn?: string;
  outputName?: string;
  nSamples: number;
  nFeatures: number;
};

/** One row of a chart: either a real Feature or the collapsed Other features row. */
export type DisplayRow = {
  label: string;
  /** index into ParsedExplanation.featureNames, or null for the Other features row */
  featureIndex: number | null;
  /** the value this row draws — for the bar chart, mean(|phi|) */
  value: number;
  isOtherRow: boolean;
};

export type DisplayRows = {
  rows: DisplayRow[];
  /** how many Features were folded into the Other features row; 0 when none */
  collapsedCount: number;
};

export class UnsupportedContractVersionError extends Error {
  constructor(public readonly received: unknown) {
    super(`shap-svg supports contract_version 1, received ${JSON.stringify(received)}`);
    this.name = "UnsupportedContractVersionError";
  }
}

export class InvalidExplanationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidExplanationError";
  }
}
