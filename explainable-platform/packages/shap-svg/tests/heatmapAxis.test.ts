import { describe, expect, it } from "vitest";
import { parseExplanation } from "../src/core/parse";
import { heatmapLayout, heatmapRows } from "../src/core/heatmapLayout";

const opts = { width: 720, rowHeight: 26, marginLeft: 260, marginRight: 100, marginTop: 60 };

const layout = heatmapLayout(
  heatmapRows(
    parseExplanation({
      contract_version: 1,
      values: [[0.02, -0.01, 0.03], [-0.02, 0.01, 0.01], [0.01, 0.02, -0.03]],
      base_values: 0.5,
      data: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
      feature_names: ["A_a", "B_b", "C_c"],
    }),
    3,
    false,
  ),
  opts,
);

describe("heatmapLayout — spines", () => {
  it("draws a left and a right spine at the grid's edges", () => {
    // _heatmap.py:135 makes both visible; xlim(-0.5, n - 0.5) at :151 puts them
    // on the outer edges of the first and last column.
    expect(layout.spines.left.x).toBe(layout.gridLeft);
    expect(layout.spines.right.x).toBe(layout.gridRight);
  });

  it("bounds both spines to the grid, not the f(x) chart above it", () => {
    // set_bounds(n - row_height, -row_height) with row_height = 0.5 (:116,:136)
    // is exactly the outer edge of the first and last row.
    for (const spine of [layout.spines.left, layout.spines.right]) {
      expect(spine.y1).toBe(layout.gridTop);
      expect(spine.y2).toBe(layout.plotBottom);
    }
  });
});

describe("heatmapLayout — y ticks", () => {
  it("puts one outward tick on the left at every Feature row", () => {
    // yaxis.set_ticks_position("left") and tick_params(direction="out").
    expect(layout.yTicks).toHaveLength(layout.rows.length);
    layout.yTicks.forEach((tick, index) => {
      expect(tick.y).toBe(layout.rows[index].centerY);
      expect(tick.x2).toBe(layout.gridLeft);
      expect(tick.x1).toBeLessThan(tick.x2);
    });
  });
});
