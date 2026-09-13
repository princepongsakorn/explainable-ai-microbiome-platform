import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  heatmapLayout,
  heatmapRows,
} from "../src/core/heatmapLayout";
import { parseExplanation } from "../src/core/parse";
import { ShapHeatmap } from "../src/react/ShapHeatmap";

const explanation = parseExplanation({
  contract_version: 1,
  values: [
    [4, -1, 0, 1],
    [-2, -1, 3, 0],
    [1, -1, 0, -4],
  ],
  base_values: 0,
  data: [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  feature_names: ["top_feature", "third_feature", "fourth_feature", "second_feature"],
  sample_ids: ["sample-a", "sample-b", "sample-c"],
});

describe("heatmapRows", () => {
  it("builds a Feature-by-Sample matrix after sorting Samples by descending total SHAP value", () => {
    const result = heatmapRows(explanation, 2, true);

    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.cells.length === 3)).toBe(true);
    expect(result.columns.map((column) => column.sampleIndex)).toEqual([0, 1, 2]);
    expect(result.columns.map((column) => column.sampleId)).toEqual([
      "sample-a", "sample-b", "sample-c",
    ]);
    expect(result.fxLine).toEqual([4, 0, -4]);
    expect(result.rows.map((row) => row.cells.map((cell) => cell.value))).toEqual([
      [4, -2, 1],
      [0, 2, -5],
    ]);
  });

  it("uses global Feature ordering and the faithful Other features partition", () => {
    const result = heatmapRows(explanation, 2, true);

    expect(result.rows.map((row) => row.label)).toEqual([
      "top feature", "Sum of 3 other features",
    ]);
    expect(result.rows[0]).toMatchObject({
      featureIndex: 0,
      isOtherRow: false,
      importance: 7 / 3,
      sideBarValue: 7 / 11,
    });
    expect(result.rows[1]).toMatchObject({
      featureIndex: null,
      isOtherRow: true,
      sideBarValue: 1,
    });
    expect(result.rows[1].importance).toBeCloseTo(11 / 3, 12);
    expect(result.collapsedCount).toBe(3);
  });

  it("preserves each Sample's total in corrected Other features mode", () => {
    const result = heatmapRows(explanation, 2, false);

    expect(result.rows.map((row) => row.label)).toEqual([
      "top feature", "second feature", "2 other features",
    ]);
    for (let columnIndex = 0; columnIndex < result.columns.length; columnIndex++) {
      const displayed = result.rows.reduce(
        (sum, row) => sum + row.cells[columnIndex].value,
        0,
      );
      expect(displayed).toBe(result.fxLine[columnIndex]);
    }
  });

  it("uses whole-matrix 1st/99th percentiles with a symmetric red-white-blue domain", () => {
    const faithful = heatmapRows(explanation, 2, true);
    expect(faithful.vmin).toBeCloseTo(-4.85, 12);
    expect(faithful.vmax).toBeCloseTo(4.85, 12);
    expect(faithful.rows[1].cells[0]).toMatchObject({ value: 0, colorValue: 0, color: "#ffffff" });
    expect(faithful.rows[1].cells[2]).toMatchObject({ value: -5, colorValue: -4.85 });

    const corrected = heatmapRows(explanation, 2, false);
    expect(corrected.vmin).toBeCloseTo(-3.84, 12);
    expect(corrected.vmax).toBeCloseTo(3.84, 12);
  });

  it("keeps source precision inside the value-space renderer", () => {
    const precise = parseExplanation({
      contract_version: 1,
      values: [[1.23456789], [-0.123456789]],
      base_values: 0,
      data: [[0], [0]],
      feature_names: ["precise_feature"],
    });
    const result = heatmapRows(precise, 1, false);

    expect(result.rows[0].cells.map((cell) => cell.value)).toEqual([1.23456789, -0.123456789]);
    expect(result.fxLine).toEqual([1.23456789, -0.123456789]);
    expect(result.vmax).not.toBe(Number(result.vmax.toPrecision(4)));
  });

  it("uses original Sample index to break equal-total ties and rejects non-positive maxDisplay", () => {
    const tied = parseExplanation({
      contract_version: 1,
      values: [[1], [1]],
      base_values: 0,
      data: [[0], [0]],
      feature_names: ["feature"],
      sample_ids: ["first", "second"],
    });
    expect(heatmapRows(tied, 1, false).columns.map((column) => column.sampleId)).toEqual([
      "first", "second",
    ]);
    expect(() => heatmapRows(explanation, 0, false)).toThrow(/maxDisplay/);
  });
});

describe("heatmapLayout", () => {
  it("projects cells, the f(x) line, its real axis, and side bars into pixels", () => {
    const layout = heatmapLayout(heatmapRows(explanation, 2, true), {
      width: 400,
      rowHeight: 20,
      marginLeft: 100,
      marginRight: 100,
      marginTop: 60,
    });

    expect(layout.plotWidth).toBe(200);
    expect(layout.cellWidth).toBeCloseTo(200 / 3, 12);
    expect(layout.rows[0].cells[0]).toMatchObject({ x: 100, y: 60, height: 20 });
    expect(layout.rows[1].centerY).toBe(90);
    expect(layout.columns.map((column) => column.centerX)).toEqual([
      expect.closeTo(100 + 100 / 3, 12),
      200,
      expect.closeTo(300 - 100 / 3, 12),
    ]);
    expect(layout.fxDomain).toEqual([-4, 4]);
    expect(layout.fxLine.map((point) => point.value)).toEqual([4, 0, -4]);
    expect(layout.fxAxisMarks.map((mark) => mark.value)).toEqual([4, 0, -4]);
    expect(layout.separatorY).toBe(56);
    expect(layout.rows.map((row) => row.sideBar.width)).toEqual([
      expect.closeTo(50 * 7 / 11, 12),
      50,
    ]);
    // 52: the axis area now holds ticks, their labels and the Instances title.
    expect(layout.height).toBe(152);
  });
});

describe("ShapHeatmap", () => {
  it("is a component with the public heatmap props", () => {
    const element = createElement(ShapHeatmap, {
      explanation: {
        contract_version: 1,
        values: [[1, -2]],
        base_values: 0,
        data: [[0.1, 0.2]],
        feature_names: ["Fusobacterium_nucleatum", "Bacteroides_fragilis"],
        sample_ids: ["sample-1"],
      },
      maxDisplay: 2,
      faithfulOtherRow: false,
      classIndex: 1,
      width: 640,
      rowHeight: 28,
      onFeatureClick: () => undefined,
      onSampleClick: () => undefined,
    });
    expect(element.type).toBe(ShapHeatmap);
  });
});
