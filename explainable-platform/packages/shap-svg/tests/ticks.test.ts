import { describe, expect, it } from "vitest";
import { niceTicks, tickLabel, tickSpace } from "../src/core/ticks";

describe("tickSpace — matplotlib's estimate of how many ticks fit", () => {
  // axis.py XAxis.get_tick_space: floor(length_pt / (label_size_pt * 3)), and
  // ticker.py MaxNLocator clips it to [1, 9]. Our length is CSS pixels, which
  // are 0.75 pt; the label size is SHAP's own, in points.
  it("reproduces the figure sizes SHAP renders at", () => {
    expect(tickSpace(350, 13)).toBe(6); // waterfall, tick_params(labelsize=13)
    expect(tickSpace(360, 10)).toBe(9); // heatmap, default "medium" = 10 pt
    expect(tickSpace(370, 11)).toBe(8); // beeswarm and bar, labelsize=11
  });

  it("is clipped to at most nine and at least one", () => {
    expect(tickSpace(2000, 10)).toBe(9);
    expect(tickSpace(10, 13)).toBe(1);
  });
});

describe("niceTicks — against SHAP's own reference figures", () => {
  const labels = (min: number, max: number, n: number, integer = false) => {
    const { ticks, step } = niceTicks(min, max, n, { integer });
    return ticks.map((t) => tickLabel(t, step));
  };

  it("waterfall, crc-rynazal-notebook sample 0: 0.55 to 0.75 by 0.05", () => {
    expect(labels(0.524, 0.772, tickSpace(350, 13))).toEqual([
      "0.55", "0.60", "0.65", "0.70", "0.75",
    ]);
  });

  it("heatmap, 331 Samples: 0 to 300 by 50", () => {
    expect(labels(-0.5, 330.5, tickSpace(360, 10), true)).toEqual([
      "0", "50", "100", "150", "200", "250", "300",
    ]);
  });

  it("beeswarm, [-0.19, 0.20] with matplotlib's 5% margins: -0.2 to 0.2 by 0.1", () => {
    const pad = (0.2 - -0.19) * 0.05;
    expect(labels(-0.19 - pad, 0.2 + pad, tickSpace(370, 11))).toEqual([
      "−0.2", "−0.1", "0.0", "0.1", "0.2",
    ]);
  });
});

describe("niceTicks — edges", () => {
  it("keeps integer axes on integers, so there is no Sample 0.5", () => {
    expect(niceTicks(-0.5, 2.5, 9, { integer: true }).ticks).toEqual([0, 1, 2]);
  });

  it("returns nothing for an empty domain rather than dividing by zero", () => {
    expect(niceTicks(1, 1, 6).ticks).toEqual([]);
  });

  it("never prints a negative zero", () => {
    const { ticks, step } = niceTicks(-0.3, 0.3, 6);
    expect(ticks.map((t) => tickLabel(t, step))).not.toContain("−0.0");
    expect(ticks.map((t) => tickLabel(t, step))).toContain("0.0");
  });
});
