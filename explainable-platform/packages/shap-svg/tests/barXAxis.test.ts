import { describe, expect, it } from "vitest";
import { barLayout } from "../src/core/barLayout";
import { DisplayRows } from "../src/core/types";

const opts = { width: 720, rowHeight: 26, marginLeft: 260, marginRight: 90, marginTop: 8 };
const rows = {
  rows: [
    { label: "a", featureIndex: 0, value: 0.3, isOtherRow: false },
    { label: "b", featureIndex: 1, value: 0.1, isOtherRow: false },
  ],
  collapsedCount: 0,
} as unknown as DisplayRows;
const layout = barLayout(rows, opts);

describe("barLayout — x axis", () => {
  it("is titled the way SHAP builds it from the Explanation's history", () => {
    // _bar.py:143-150: "SHAP value" -> "|SHAP value|" -> "mean(|SHAP value|)".
    expect(layout.xTitle.text).toBe("mean(|SHAP value|)");
  });

  it("pads the right twice, and never the left, when nothing is negative", () => {
    // Measured by running shap.plots.bar on mean(|phi|) = [0.3, 0.1]: xlim is
    // (0, 0.33075), i.e. max * 1.05 * 1.05. matplotlib's autoscale adds its 5%
    // margin first (barh keeps the left edge pinned at 0), and _bar.py:334-340
    // then reads that padded xlim and adds its own 5% buffer on top.
    expect(layout.xDomain[0]).toBe(0);
    expect(layout.xDomain[1]).toBeCloseTo(0.33075, 12);
  });

  it("ticks from zero, on the same scale as the bars", () => {
    expect(layout.xTicks[0].label).toBe("0.00");
    expect(layout.xTicks[0].x).toBeCloseTo(layout.xZero, 9);
    const at30 = layout.xTicks.find((t) => t.label === "0.30")!;
    expect(at30.x).toBeCloseTo(layout.bars[0].x + layout.bars[0].width, 9);
  });

  it("keeps the bottom spine, which SHAP never hides on this chart", () => {
    expect(layout.xSpine).not.toBeNull();
    expect(layout.xSpine!.y).toBe(layout.plotBottom);
  });

  it("leaves room below the rows for ticks, labels and the title", () => {
    expect(layout.xTitle.y).toBeGreaterThan(layout.plotBottom + 20);
    expect(layout.height).toBeGreaterThan(layout.xTitle.y);
  });
});
