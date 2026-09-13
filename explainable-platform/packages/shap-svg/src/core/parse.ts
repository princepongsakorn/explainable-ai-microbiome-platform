import {
  Explanation,
  InvalidExplanationError,
  ParsedExplanation,
  UnsupportedContractVersionError,
} from "./types";

const SUPPORTED_CONTRACT_VERSION = 1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertFiniteRows(rows: unknown, field: string): asserts rows is number[][] {
  if (!Array.isArray(rows)) {
    throw new InvalidExplanationError(`${field} must be an array of Sample rows`);
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) {
      throw new InvalidExplanationError(`${field}[${i}] must be an array of Feature values`);
    }
    for (let j = 0; j < row.length; j++) {
      if (typeof row[j] !== "number" || !Number.isFinite(row[j])) {
        throw new InvalidExplanationError(
          `${field}[${i}][${j}] is ${String(row[j])}; the payload must contain only finite numbers`,
        );
      }
    }
  }
}

function assertStringArray(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new InvalidExplanationError(`${field} must be an array of strings`);
  }
}

function selectClassValues(values: unknown, classIndex: number): number[][] {
  if (!Array.isArray(values)) {
    throw new InvalidExplanationError("values must be an array");
  }
  if (!Number.isInteger(classIndex) || classIndex < 0) {
    throw new InvalidExplanationError(`classIndex must be a non-negative integer, received ${classIndex}`);
  }
  const firstRow = values[0];
  const firstCell = Array.isArray(firstRow) ? firstRow[0] : undefined;
  if (Array.isArray(firstCell)) {
    return values.map((row, sampleIndex) => {
      if (!Array.isArray(row)) {
        throw new InvalidExplanationError(`values[${sampleIndex}] must be an array of Feature values`);
      }
      return row.map((cell, featureIndex) => {
        if (!Array.isArray(cell) || classIndex >= cell.length) {
          throw new InvalidExplanationError(
            `values[${sampleIndex}][${featureIndex}] has no class ${classIndex}`,
          );
        }
        return cell[classIndex] as number;
      });
    });
  }
  return values as number[][];
}

function selectBaseValues(value: unknown, nSamples: number, classIndex: number): number[] {
  if (typeof value === "number") {
    return new Array(nSamples).fill(value);
  }
  if (!Array.isArray(value)) {
    throw new InvalidExplanationError("base_values must be a number, an array, or an array of class arrays");
  }
  if (Array.isArray(value[0])) {
    return value.map((row, sampleIndex) => {
      if (!Array.isArray(row) || classIndex >= row.length) {
        throw new InvalidExplanationError(`base_values[${sampleIndex}] has no class ${classIndex}`);
      }
      return row[classIndex] as number;
    });
  }
  return value as number[];
}

export function parseExplanation(
  input: unknown,
  opts: { classIndex?: number } = {},
): ParsedExplanation {
  const classIndex = opts.classIndex ?? 1;
  if (!isRecord(input) || input.contract_version !== SUPPORTED_CONTRACT_VERSION) {
    throw new UnsupportedContractVersionError(isRecord(input) ? input.contract_version : undefined);
  }

  const e = input as Explanation;
  assertStringArray(e.feature_names, "feature_names");
  assertFiniteRows(e.data, "data");
  const values = selectClassValues(e.values, classIndex);
  assertFiniteRows(values, "values");

  const nSamples = values.length;
  const nFeatures = e.feature_names.length;
  if (e.data.length !== nSamples) {
    throw new InvalidExplanationError(`data has ${e.data.length} Samples but values has ${nSamples}`);
  }
  for (const [name, rows] of [["values", values], ["data", e.data]] as const) {
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].length !== nFeatures) {
        throw new InvalidExplanationError(
          `${name}[${i}] has ${rows[i].length} Features but feature_names has ${nFeatures}`,
        );
      }
    }
  }

  const baseValues = selectBaseValues(e.base_values, nSamples, classIndex);
  if (baseValues.length !== nSamples) {
    throw new InvalidExplanationError(
      `base_values has ${baseValues.length} entries but there are ${nSamples} Samples`,
    );
  }
  assertFiniteRows([baseValues], "base_values");

  if (e.sample_ids !== undefined) {
    assertStringArray(e.sample_ids, "sample_ids");
    if (e.sample_ids.length !== nSamples) {
      throw new InvalidExplanationError(
        `sample_ids has ${e.sample_ids.length} entries but there are ${nSamples} Samples`,
      );
    }
  }
  if (e.sample_labels !== undefined) {
    assertStringArray(e.sample_labels, "sample_labels");
    if (e.sample_labels.length !== nSamples) {
      throw new InvalidExplanationError(
        `sample_labels has ${e.sample_labels.length} entries but there are ${nSamples} Samples`,
      );
    }
  }
  if (e.sample_label_column !== undefined && typeof e.sample_label_column !== "string") {
    throw new InvalidExplanationError("sample_label_column must be a string");
  }
  if (e.output_names !== undefined) assertStringArray(e.output_names, "output_names");

  return {
    values,
    data: e.data,
    baseValues,
    featureNames: e.feature_names,
    sampleIds: e.sample_ids,
    sampleLabels: e.sample_labels,
    sampleLabelColumn: e.sample_label_column,
    outputName: e.output_names?.[0],
    nSamples,
    nFeatures,
  };
}
