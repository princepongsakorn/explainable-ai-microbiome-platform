import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  BEESWARM_MISSING_COLOR,
  beeswarmLayout,
  beeswarmRows,
} from "../src/core/beeswarmLayout";
import { parseExplanation } from "../src/core/parse";
import { ShapBeeswarm } from "../src/react/ShapBeeswarm";

const explanation = parseExplanation({
  contract_version: 1,
  values: [
    [0, 2, -3, 1],
    [0, 2, 0, 1],
    [0, 2, 0, 1],
    [0, 2, 0, 1],
    [0, 2, 0, 1],
  ],
  base_values: 0,
  data: [
    [0, 0, 10, 5],
    [0, 1, 10, 6],
    [0, 2, 10, 7],
    [0, 3, 10, 8],
    [0, 100, 10, 9],
  ],
  feature_names: ["zero_feature", "top_feature", "third_feature", "second_feature"],
});

const sorted = (values: number[]) => [...values].sort((a, b) => a - b);

describe("beeswarmRows", () => {
  it("reuses global ordering and faithful Other features row partitioning", () => {
    const result = beeswarmRows(explanation, 2, true, 7);

    expect(result.rows.map((row) => row.label)).toEqual([
      "top_feature",
      "Sum of 3 other features",
    ]);
    expect(result.rows.map((row) => row.rowIndex)).toEqual([1, 0]);
    expect(result.rows[0]).toMatchObject({ featureIndex: 1, isOtherRow: false });
    expect(result.rows[1]).toMatchObject({ featureIndex: null, isOtherRow: true });
    expect(sorted(result.rows[0].points.map((point) => point.x))).toEqual([2, 2, 2, 2, 2]);
    expect(sorted(result.rows[1].points.map((point) => point.x))).toEqual([-2, 1, 1, 1, 1]);
  });

  it("computes the vertical spreading multiset from each row's bin counts", () => {
    const [constant, collapsed] = beeswarmRows(explanation, 2, true, 7).rows;
    const magnitudes = (row: typeof constant) =>
      sorted(row.points.map((point) => Math.abs(point.y - row.rowIndex)));

    expect(magnitudes(constant)).toEqual([
      0,
      expect.closeTo(0.12, 12),
      expect.closeTo(0.12, 12),
      expect.closeTo(0.24, 12),
      expect.closeTo(0.24, 12),
    ]);
    expect(magnitudes(collapsed)).toEqual([
      0,
      0,
      expect.closeTo(0.12, 12),
      expect.closeTo(0.12, 12),
      expect.closeTo(0.24, 12),
    ]);
  });

  it("uses NumPy's ties-to-even rounding when a point falls exactly between bins", () => {
    const halfway = parseExplanation({
      contract_version: 1,
      values: [[0], [0.1], [0.10500000105], [1]],
      base_values: 0,
      data: [[0], [0], [0], [0]],
      feature_names: ["halfway_feature"],
    });
    const row = beeswarmRows(halfway, 1, false, 1).rows[0];
    expect(sorted(row.points.map((point) => Math.abs(point.y - row.rowIndex)))).toEqual([
      0,
      0,
      0,
      expect.closeTo(0.18, 12),
    ]);
  });

  it("uses independent 5th/95th domains and SHAP's anchor Feature in faithful mode", () => {
    const [top, collapsed] = beeswarmRows(explanation, 2, true, 7).rows;

    expect(top.vmin).toBeCloseTo(0.2, 12);
    expect(top.vmax).toBeCloseTo(80.6, 12);
    expect(sorted(top.points.map((point) => point.colorValue!))).toEqual([
      expect.closeTo(0.2, 12),
      1,
      2,
      3,
      expect.closeTo(80.6, 12),
    ]);

    expect(collapsed.vmin).toBeCloseTo(5.2, 12);
    expect(collapsed.vmax).toBeCloseTo(8.8, 12);
    expect(sorted(collapsed.points.map((point) => point.colorValue!))).toEqual([
      expect.closeTo(5.2, 12),
      6,
      7,
      8,
      expect.closeTo(8.8, 12),
    ]);
  });

  it("sums hidden Feature values for the corrected separate Other row", () => {
    const other = beeswarmRows(explanation, 2, false, 7).rows[2];
    expect(other.vmin).toBe(10);
    expect(other.vmax).toBe(10);
    expect(other.points.map((point) => point.featureValue)).toEqual([10, 10, 10, 10, 10]);
  });

  it("keeps seeded point assignment stable without changing the jitter multiset", () => {
    const first = beeswarmRows(explanation, 2, true, 19).rows[0].points;
    const again = beeswarmRows(explanation, 2, true, 19).rows[0].points;
    const anotherSeed = beeswarmRows(explanation, 2, true, 20).rows[0].points;

    expect(first).toEqual(again);
    expect(first.map((point) => point.y)).not.toEqual(anotherSeed.map((point) => point.y));
    expect(sorted(first.map((point) => Math.abs(point.y - 1)))).toEqual(
      sorted(anotherSeed.map((point) => Math.abs(point.y - 1))),
    );
  });

  it("preserves every Sample's SHAP sum in corrected Other features mode", () => {
    const result = beeswarmRows(explanation, 2, false, 7);
    expect(result.rows.map((row) => row.label)).toEqual([
      "top_feature", "second_feature", "2 other features",
    ]);

    for (let sampleIndex = 0; sampleIndex < explanation.nSamples; sampleIndex++) {
      const displayed = result.rows.reduce(
        (sum, row) => sum + row.points.find((point) => point.sampleIndex === sampleIndex)!.x,
        0,
      );
      const full = explanation.values[sampleIndex].reduce((sum, value) => sum + value, 0);
      expect(displayed).toBeCloseTo(full, 12);
    }
  });

  it("draws a missing feature value grey and excludes it from the percentile domain", () => {
    const withMissing = {
      ...explanation,
      values: [[1], [1], [1]],
      data: [[Number.NaN], [1], [3]],
      featureNames: ["missing_feature"],
      baseValues: [0, 0, 0],
      nSamples: 3,
      nFeatures: 1,
    };
    const row = beeswarmRows(withMissing, 1, false, 1).rows[0];

    expect(row.vmin).toBeCloseTo(1.1, 12);
    expect(row.vmax).toBeCloseTo(2.9, 12);
    expect(row.points[0]).toMatchObject({
      featureValue: Number.NaN,
      colorValue: null,
      color: BEESWARM_MISSING_COLOR,
    });
  });

  it("does not round SHAP values or colour-domain values", () => {
    const precise = {
      ...explanation,
      values: [[1.23456789]],
      data: [[0.123456789]],
      featureNames: ["precise_feature"],
      baseValues: [0],
      nSamples: 1,
      nFeatures: 1,
    };
    const row = beeswarmRows(precise, 1, false, 1).rows[0];
    expect(row.points[0].x).toBe(1.23456789);
    expect(row.vmin).toBe(0.123456789);
    expect(row.vmax).toBe(0.123456789);
  });

  it("rejects a non-positive maxDisplay", () => {
    expect(() => beeswarmRows(explanation, 0, false, 1)).toThrow(/maxDisplay/);
  });
});

describe("beeswarmLayout", () => {
  it("projects value-space x and y into pixels without changing point data", () => {
    const rows = beeswarmRows(explanation, 2, true, 7);
    const layout = beeswarmLayout(rows, {
      width: 400,
      rowHeight: 40,
      marginLeft: 100,
      marginRight: 50,
      marginTop: 10,
      dotRadius: 3,
    });

    expect(layout.xDomain).toEqual([-2, 2]);
    expect(layout.xZero).toBe(225);
    expect(layout.plotWidth).toBe(250);
    expect(layout.height).toBe(120);
    expect(layout.rows.map((row) => row.centerY)).toEqual([30, 70]);
    expect(layout.rows[0].points[0]).toMatchObject({ x: 350, radius: 3, sampleIndex: 0 });
    expect(layout.rows[0].points[0].featureValue).toBe(0);
  });
});

describe("ShapBeeswarm", () => {
  it("is a component with the public beeswarm props", () => {
    const element = createElement(ShapBeeswarm, {
      explanation: {
        contract_version: 1,
        values: [[1, -2]],
        base_values: 0,
        data: [[0.1, 0.2]],
        feature_names: ["Fusobacterium_nucleatum", "Bacteroides_fragilis"],
      },
      maxDisplay: 2,
      faithfulOtherRow: false,
      classIndex: 1,
      width: 640,
      rowHeight: 28,
      seed: 42,
      dotRadius: 3,
      onFeatureClick: () => undefined,
    });
    expect(element.type).toBe(ShapBeeswarm);
  });
});

describe("beeswarmRows — abundance scale", () => {
  const skewed = parseExplanation({
    contract_version: 1,
    // One taxon, four Samples. Abundance is heavily skewed, as it always is.
    values: [[0.1], [0.2], [0.3], [0.4]],
    base_values: 0,
    data: [[0.01], [0.02], [0.03], [100]],
    feature_names: ["Bacteroides_ovatus"],
  });

  it("clips to the 5th-95th percentile by default, as SHAP does", () => {
    const raw = beeswarmRows(skewed, 1, false, 7).rows[0];
    const colours = new Set(raw.points.map((p) => p.color));
    // One Sample is 3000x the others, so on a raw scale the low three are
    // pressed into the same colour and the chart says nothing about them.
    expect(colours.size).toBeLessThan(4);
  });

  it("ranks Samples instead when asked, so a skewed taxon still separates", () => {
    const ranked = beeswarmRows(skewed, 1, false, 7, "percentile").rows[0];
    expect(new Set(ranked.points.map((p) => p.color)).size).toBe(4);
  });
});
