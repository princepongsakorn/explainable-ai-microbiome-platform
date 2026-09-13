import { describe, expect, it } from "vitest";
import { barLayout } from "../src/core/barLayout";
import { DisplayRows } from "../src/core/types";

const opts = { width: 400, rowHeight: 20, marginLeft: 200, marginRight: 40, marginTop: 8 };

const rowsOf = (values: number[]) =>
  ({
    rows: values.map((value, i) => ({
      label: `f${i}`, featureIndex: i, value, isOtherRow: false,
    })),
    collapsedCount: 0,
  }) as unknown as DisplayRows;

describe("barLayout — the vertical line at zero", () => {
  it("is drawn whether or not any value is negative", () => {
    // _bar.py:252-254 draws axvline(0) when a value is negative, and
    // _bar.py:329-330 hides the left spine ONLY in that case. With no negatives
    // the spine stays, and barh pins the axes' left edge to 0 — so both code
    // paths put one solid line at zero. Mean |SHAP| is never negative, so the
    // summary bar chart always takes the spine path.
    expect(barLayout(rowsOf([0.3, 0.1]), opts).zeroLine).toBeDefined();
    expect(barLayout(rowsOf([0.3, -0.1]), opts).zeroLine).toBeDefined();
  });

  it("sits at zero on the value scale", () => {
    const layout = barLayout(rowsOf([0.3, -0.1]), opts);
    expect(layout.zeroLine.x).toBe(layout.xZero);
  });

  it("spans the rows and stops above the axis area", () => {
    const layout = barLayout(rowsOf([0.3, 0.1]), opts);
    expect(layout.zeroLine.y1).toBe(opts.marginTop);
    expect(layout.zeroLine.y2).toBe(opts.marginTop + 2 * opts.rowHeight);
    expect(layout.plotBottom).toBe(layout.zeroLine.y2);
  });
});
