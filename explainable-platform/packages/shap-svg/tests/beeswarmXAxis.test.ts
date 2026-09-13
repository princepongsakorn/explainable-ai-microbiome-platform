import { describe, expect, it } from "vitest";
import { parseExplanation } from "../src/core/parse";
import { beeswarmLayout, beeswarmRows } from "../src/core/beeswarmLayout";

const opts = {
  width: 720, rowHeight: 28, marginLeft: 260, marginRight: 90, marginTop: 8, dotRadius: 3,
};
const layout = beeswarmLayout(
  beeswarmRows(
    parseExplanation({
      contract_version: 1,
      values: [[-0.19], [0.05], [0.2]],
      base_values: 0,
      data: [[1], [2], [3]],
      feature_names: ["Bacteroides_ovatus"],
    }),
    1,
    false,
    7,
  ),
  opts,
);

describe("beeswarmLayout — x axis", () => {
  it("carries SHAP's axis title", () => {
    // _beeswarm.py:501 set_xlabel(labels["VALUE"]), _labels.py:5.
    expect(layout.xTitle.text).toBe("SHAP value (impact on model output)");
  });

  it("pads both sides by matplotlib's default 5% margin", () => {
    const pad = 0.39 * 0.05;
    expect(layout.xDomain[0]).toBeCloseTo(-0.19 - pad, 12);
    expect(layout.xDomain[1]).toBeCloseTo(0.2 + pad, 12);
  });

  it("lands on the ticks SHAP's own figure shows", () => {
    expect(layout.xTicks.map((t) => t.label)).toEqual([
      "−0.2", "−0.1", "0.0", "0.1", "0.2",
    ]);
  });

  it("puts the zero tick exactly on the zero line", () => {
    const zero = layout.xTicks.find((t) => t.label === "0.0")!;
    expect(zero.x).toBeCloseTo(layout.xZero, 9);
  });

  it("keeps the bottom spine", () => {
    expect(layout.xSpine).not.toBeNull();
    expect(layout.xSpine!.y).toBe(layout.plotBottom);
  });
});
