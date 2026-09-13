import { describe, expect, it } from "vitest";
import { parseExplanation } from "../src/core/parse";
import { heatmapLayout, heatmapRows } from "../src/core/heatmapLayout";

const N = 331;
const opts = { width: 720, rowHeight: 26, marginLeft: 260, marginRight: 100, marginTop: 60 };
const layout = heatmapLayout(
  heatmapRows(
    parseExplanation({
      contract_version: 1,
      values: Array.from({ length: N }, (_, i) => [i / N - 0.5, 0.1]),
      base_values: 0,
      data: Array.from({ length: N }, () => [1, 1]),
      feature_names: ["A_a", "B_b"],
    }),
    2,
    false,
  ),
  opts,
);

describe("heatmapLayout — x axis", () => {
  it("is titled Instances, as SHAP titles it", () => {
    expect(layout.xTitle.text).toBe("Instances"); // _heatmap.py:85,152
  });

  it("lands on the ticks SHAP's own 331-Sample figure shows", () => {
    expect(layout.xTicks.map((t) => t.label)).toEqual([
      "0", "50", "100", "150", "200", "250", "300",
    ]);
  });

  it("centres each tick on its Sample's column", () => {
    // xlim(-0.5, n - 0.5) at _heatmap.py:151 puts integer i at column i's centre.
    for (const tick of layout.xTicks) {
      expect(tick.x).toBeCloseTo(layout.columns[tick.value].centerX, 9);
    }
  });

  it("draws no bottom spine, because SHAP hides it here", () => {
    expect(layout.xSpine).toBeNull(); // _heatmap.py:137
  });
});
