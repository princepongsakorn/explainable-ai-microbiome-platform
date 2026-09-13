import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatFeatureLabel } from "../src/core/format";
import { parseExplanation } from "../src/core/parse";
import { waterfallRows } from "../src/core/waterfallLayout";

type GoldenArrow = {
  x: number;
  row: number;
  dx: number;
  head_length: number;
  bar_width: number;
  color: string;
};

type GoldenWaterfall = {
  sample_index: number;
  max_display: number;
  base_value: number;
  fx: number;
  labels: string[];
  arrows: GoldenArrow[];
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

describe.each(["tiny", "real"])("waterfall golden values — %s", (name) => {
  const parsed = parseExplanation(load(`${name}.json`));
  const golden = load(`${name}.waterfall.golden.json`) as GoldenWaterfall;
  const result = waterfallRows(parsed, golden.sample_index, golden.max_display, true);

  it("matches the Base value and Model output", () => {
    expectGoldenNumber(result.baseValue, golden.base_value);
    expectGoldenNumber(result.modelOutput, golden.fx);
  });

  it("produces the same top-to-bottom labels, with SPEC V3 formatting", () => {
    const expected = golden.labels.map((label) =>
      label.endsWith("other features") ? label : formatFeatureLabel(label));
    expect(result.rows.map((row) => row.label)).toEqual(expected);
  });

  it("matches SHAP's value-space starts, contributions, rows, and colours", () => {
    for (const arrow of golden.arrows) {
      const row = result.rows.find((candidate) => candidate.row === arrow.row);
      expect(row).toBeDefined();
      expectGoldenNumber(row!.left, arrow.x);

      // Axes.arrow was patched below waterfall_legacy: captured dx is the rectangular
      // shaft, while head_length carries the remaining signed part of the contribution.
      const capturedContribution = arrow.dx + Math.sign(arrow.dx) * arrow.head_length;
      expectGoldenNumber(row!.width, capturedContribution);
      expect(row!.color).toBe(arrow.color);
    }
  });

  it("does not round inside the value-space renderer", () => {
    const unrounded = result.rows
      .map((row) => row.width)
      .find((value) => value !== toGoldenPrecision(value));
    expect(unrounded).toBeDefined();
  });
});
