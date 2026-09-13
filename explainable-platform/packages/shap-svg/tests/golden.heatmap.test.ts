import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { heatmapRows } from "../src/core/heatmapLayout";
import { parseExplanation } from "../src/core/parse";

type GoldenHeatmap = {
  max_display: number;
  labels: string[];
  vmin: number;
  vmax: number;
  n_features_drawn: number;
  n_instances: number;
  matrix: number[][];
  fx_line: number[];
};

const load = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8"));

const toGoldenPrecision = (value: number) => Number(value.toPrecision(4));

function expectGoldenNumber(actual: number, expected: number): void {
  const roundedActual = toGoldenPrecision(actual);
  const roundedExpected = toGoldenPrecision(expected);
  const tolerance = Math.max(Math.abs(roundedExpected) * 1e-3, 1e-6);
  expect(Math.abs(roundedActual - roundedExpected)).toBeLessThanOrEqual(tolerance);
}

describe("heatmap golden values — tiny", () => {
  const parsed = parseExplanation(load("tiny.json"));
  const golden = load("tiny.heatmap.golden.json") as GoldenHeatmap;
  const result = heatmapRows(parsed, golden.max_display, true);

  it("has the captured features-by-instances matrix shape", () => {
    expect(result.rows).toHaveLength(golden.n_features_drawn);
    expect(result.rows.every((row) => row.cells.length === golden.n_instances)).toBe(true);
    expect(golden.matrix).toHaveLength(golden.n_features_drawn);
    expect(golden.matrix.every((row) => row.length === golden.n_instances)).toBe(true);
  });

  it("matches SHAP's top-to-bottom Feature labels", () => {
    expect(result.rows.map((row) => row.label)).toEqual(golden.labels);
  });

  it("matches every captured matrix cell in Feature-by-Sample order", () => {
    result.rows.forEach((row, rowIndex) => {
      row.cells.forEach((cell, columnIndex) => {
        expectGoldenNumber(cell.value, golden.matrix[rowIndex][columnIndex]);
      });
    });
  });

  it("matches the captured sorted f(x) line and symmetric colour domain", () => {
    result.fxLine.forEach((value, index) => expectGoldenNumber(value, golden.fx_line[index]));
    expectGoldenNumber(result.vmin, golden.vmin);
    expectGoldenNumber(result.vmax, golden.vmax);
  });

  it("does not round inside the value-space renderer", () => {
    const values = result.rows.flatMap((row) => row.cells.map((cell) => cell.value));
    expect(values.some((value) => value !== toGoldenPrecision(value))).toBe(true);
  });
});
