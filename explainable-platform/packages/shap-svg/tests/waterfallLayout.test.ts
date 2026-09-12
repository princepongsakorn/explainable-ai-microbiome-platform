import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { parseExplanation } from "../src/core/parse";
import {
  waterfallLayout,
  waterfallRows,
  WaterfallRows,
} from "../src/core/waterfallLayout";
import { ShapWaterfall } from "../src/react/ShapWaterfall";

const explanation = parseExplanation({
  contract_version: 1,
  values: [[4, -3, 2, 1]],
  base_values: 10,
  data: [[0, 0, 0, 0]],
  feature_names: ["Feature_a", "Feature_b", "Feature_c", "Feature_d"],
});

describe("waterfallRows", () => {
  it("orders by descending absolute SHAP value and walks backward from the Model output", () => {
    const result = waterfallRows(explanation, 0, 4, false);

    expect(result.baseValue).toBe(10);
    expect(result.modelOutput).toBe(14);
    expect(result.rows).toEqual([
      {
        label: "Feature a", featureIndex: 0, isOtherRow: false,
        value: 4, left: 10, width: 4, row: 3, color: "#ff0051",
      },
      {
        label: "Feature b", featureIndex: 1, isOtherRow: false,
        value: -3, left: 13, width: -3, row: 2, color: "#008bfb",
      },
      {
        label: "Feature c", featureIndex: 2, isOtherRow: false,
        value: 2, left: 11, width: 2, row: 1, color: "#ff0051",
      },
      {
        label: "Feature d", featureIndex: 3, isOtherRow: false,
        value: 1, left: 10, width: 1, row: 0, color: "#ff0051",
      },
    ]);
  });

  it("makes faithful mode absorb the Feature ranked at maxDisplay", () => {
    const result = waterfallRows(explanation, 0, 2, true);

    expect(result.rows).toEqual([
      {
        label: "Feature a", featureIndex: 0, isOtherRow: false,
        value: 4, left: 10, width: 4, row: 1, color: "#ff0051",
      },
      {
        label: "3 other features", featureIndex: null, isOtherRow: true,
        value: 0, left: 10, width: 0, row: 0, color: "#ff0051",
      },
    ]);
    expect(result.collapsedCount).toBe(3);
  });

  it("defaults conceptually to maxDisplay real Features plus a corrected Other features row", () => {
    const result = waterfallRows(explanation, 0, 2, false);

    expect(result.rows.map((row) => row.label)).toEqual([
      "Feature a", "Feature b", "2 other features",
    ]);
    expect(result.rows.map((row) => row.row)).toEqual([2, 1, 0]);
    expect(result.rows[2]).toMatchObject({ left: 10, width: 3, value: 3 });
    expect(result.collapsedCount).toBe(2);
  });

  it("preserves additivity in both Other features modes at every display limit", () => {
    for (const faithful of [false, true]) {
      for (let maxDisplay = 1; maxDisplay <= explanation.nFeatures + 1; maxDisplay++) {
        const result = waterfallRows(explanation, 0, maxDisplay, faithful);
        const displayedSum = result.rows.reduce((sum, row) => sum + row.width, 0);
        expect(displayedSum).toBeCloseTo(result.modelOutput - result.baseValue, 12);
      }
    }
  });

  it("treats zero as non-negative, unlike the bar chart", () => {
    const zero = parseExplanation({
      contract_version: 1,
      values: [[0]],
      base_values: 2,
      data: [[0]],
      feature_names: ["zero"],
    });
    expect(waterfallRows(zero, 0, 1, false).rows[0].color).toBe("#ff0051");
  });

  it("rejects an out-of-range Sample and a non-positive maxDisplay", () => {
    expect(() => waterfallRows(explanation, 1, 4, false)).toThrow(/sampleIndex/);
    expect(() => waterfallRows(explanation, 0, 0, false)).toThrow(/maxDisplay/);
  });
});

const valueRows: WaterfallRows = {
  rows: [
    {
      label: "large", featureIndex: 0, isOtherRow: false,
      value: 100, left: 0, width: 100, row: 1, color: "#ff0051",
    },
    {
      label: "short", featureIndex: 1, isOtherRow: false,
      value: 1, left: 0, width: 1, row: 0, color: "#ff0051",
    },
  ],
  baseValue: 0,
  modelOutput: 100,
  collapsedCount: 0,
};

describe("waterfallLayout", () => {
  const opts = {
    width: 300, rowHeight: 20, marginLeft: 50, marginRight: 50, marginTop: 10,
  };

  it("uses arrow bars that are 0.8 of the row pitch", () => {
    const layout = waterfallLayout(valueRows, opts);
    expect(layout.arrows[0].height).toBe(16);
    expect(layout.arrows[0].centerY).toBe(20);
    expect(layout.arrows[1].centerY).toBe(40);
  });

  it("uses an 8 px arrowhead and clamps it to a short bar", () => {
    const layout = waterfallLayout(valueRows, opts);
    expect(layout.arrows[0].headLength).toBe(8);
    expect(layout.arrows[1].headLength).toBe(2);
    expect(layout.arrows[0].points).toEqual([
      { x: 50, y: 12 },
      { x: 242, y: 12 },
      { x: 250, y: 20 },
      { x: 242, y: 28 },
      { x: 50, y: 28 },
    ]);
  });

  it("mirrors a negative arrow around its direction", () => {
    const negative: WaterfallRows = {
      rows: [{
        label: "negative", featureIndex: 0, isOtherRow: false,
        value: -4, left: 4, width: -4, row: 0, color: "#008bfb",
      }],
      baseValue: 0,
      modelOutput: 0,
      collapsedCount: 0,
    };
    const arrow = waterfallLayout(negative, opts).arrows[0];
    expect(arrow.startX).toBe(250);
    expect(arrow.endX).toBe(50);
    expect(arrow.points).toEqual([
      { x: 250, y: 12 },
      { x: 58, y: 12 },
      { x: 50, y: 20 },
      { x: 58, y: 28 },
      { x: 250, y: 28 },
    ]);
  });

  it("places labelled Base value and Model output rules plus one separator per row", () => {
    const layout = waterfallLayout(valueRows, opts);
    expect(layout.axisMarks).toEqual([
      { kind: "base", value: 0, x: 50, label: "E[f(X)] = 0" },
      { kind: "output", value: 100, x: 250, label: "f(x) = +100" },
    ]);
    expect(layout.separators).toEqual([
      { y: 20, x1: 50, x2: 250 },
      { y: 40, x1: 50, x2: 250 },
    ]);
  });
});

describe("ShapWaterfall", () => {
  it("is a component with the public waterfall props", () => {
    const element = createElement(ShapWaterfall, {
      explanation: {
        contract_version: 1,
        values: [[1, -2]],
        base_values: 0,
        data: [[0, 0]],
        feature_names: ["Fusobacterium_nucleatum", "Bacteroides_fragilis"],
      },
      sampleIndex: 0,
      maxDisplay: 2,
      faithfulOtherRow: false,
      classIndex: 1,
      width: 640,
      rowHeight: 28,
      onFeatureClick: () => undefined,
    });
    expect(element.type).toBe(ShapWaterfall);
  });
});
