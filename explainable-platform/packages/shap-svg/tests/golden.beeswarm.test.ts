import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { beeswarmRows } from "../src/core/beeswarmLayout";
import { parseExplanation } from "../src/core/parse";

type GoldenRow = {
  label: string;
  row_index: number;
  x_sorted: number[];
  jitter_sorted: number[];
  vmin: number;
  vmax: number;
  colour_values_sorted: number[];
};

type GoldenBeeswarm = {
  max_display: number;
  dot_size: number;
  nan_color: string;
  labels: string[];
  rows: GoldenRow[];
};

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

const toGoldenPrecision = (value: number) => Number(value.toPrecision(4));
const sortedGolden = (values: number[]) => values.map(toGoldenPrecision).sort((a, b) => a - b);

function expectGoldenNumber(actual: number, expected: number): void {
  // The payload fixtures contain four-significant-figure values, while the golden capture used
  // their full-precision source arrays. This is the same tolerance used by the waterfall golden
  // suite and covers the serialization delta without rounding inside the renderer.
  const tolerance = Math.max(Math.abs(expected) * 1e-3, 1e-6);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function expectGoldenMultiset(actual: number[], expected: number[]): void {
  const actualSorted = [...actual].sort((a, b) => a - b);
  const expectedSorted = [...expected].sort((a, b) => a - b);
  expect(actualSorted).toHaveLength(expectedSorted.length);
  actualSorted.forEach((value, index) => expectGoldenNumber(value, expectedSorted[index]));
}

describe.each(["tiny", "real"])("beeswarm golden values — %s", (name) => {
  const parsed = parseExplanation(load(`${name}.json`));
  const golden = load(`${name}.beeswarm.golden.json`) as GoldenBeeswarm;
  const result = beeswarmRows(parsed, golden.max_display, true, 12345);

  it("produces SHAP's top-to-bottom row labels and row indices", () => {
    // The golden holds SHAP's own tick labels. The layout now passes feature
    // names through untouched — applyFidelity decides how they read — so this
    // compares against the capture directly instead of transforming it first.
    expect(result.rows.map((row) => row.label)).toEqual(golden.labels);
    expect(result.rows.map((row) => row.rowIndex)).toEqual(
      golden.rows.map((row) => row.row_index),
    );
  });

  it("matches the sorted SHAP-value and absolute-jitter multisets", () => {
    result.rows.forEach((row, index) => {
      const expected = golden.rows[index];
      expectGoldenMultiset(row.points.map((point) => point.x), expected.x_sorted);

      const actualJitter = sortedGolden(
        row.points.map((point) => Math.abs(point.y - row.rowIndex)),
      );
      const expectedJitter = sortedGolden(expected.jitter_sorted);
      // Binning is discontinuous: the rounded real fixture moves one point across a bin edge in
      // one row. The literal unit test above remains exact; here all but that one magnitude must
      // match the pre-serialization golden capture.
      const mismatchCount = actualJitter.reduce(
        (count, value, pointIndex) => count + (value === expectedJitter[pointIndex] ? 0 : 1),
        0,
      );
      expect(mismatchCount).toBeLessThanOrEqual(1);
    });
  });

  it("matches every row's independent percentile domain and clipped colour values", () => {
    result.rows.forEach((row, index) => {
      const expected = golden.rows[index];
      expectGoldenNumber(row.vmin, expected.vmin);
      expectGoldenNumber(row.vmax, expected.vmax);
      expectGoldenMultiset(
        row.points.map((point) => point.colorValue!),
        expected.colour_values_sorted,
      );
    });
  });

  it("does not round inside the value-space renderer", () => {
    const values = result.rows.flatMap((row) => [
      row.vmin,
      row.vmax,
      ...row.points.map((point) => point.x),
    ]);
    expect(values.some((value) => value !== toGoldenPrecision(value))).toBe(true);
  });
});
