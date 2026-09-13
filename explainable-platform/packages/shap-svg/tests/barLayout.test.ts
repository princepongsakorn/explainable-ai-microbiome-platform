import { describe, expect, it } from "vitest";
import { barLayout } from "../src/core/barLayout";
import { DisplayRows } from "../src/core/types";

const rows: DisplayRows = {
  rows: [
    { label: "a", featureIndex: 0, value: 4, isOtherRow: false },
    { label: "b", featureIndex: 1, value: -2, isOtherRow: false },
    { label: "2 other features", featureIndex: null, value: 1, isOtherRow: true },
  ],
  collapsedCount: 2,
};

const opts = { width: 400, rowHeight: 50, marginLeft: 100, marginRight: 40, marginTop: 10 };

describe("barLayout", () => {
  it("puts zero inside the domain and scales to the plot width", () => {
    const l = barLayout(rows, opts);
    expect(l.xDomain).toEqual([-2, 4]);
    expect(l.plotWidth).toBe(260);
    expect(l.xZero).toBeCloseTo(100 + (2 / 6) * 260, 6);
  });

  it("gives each row a bar 0.7 of the row height, vertically centred", () => {
    const l = barLayout(rows, opts);
    expect(l.bars[0].height).toBeCloseTo(35, 6);
    expect(l.bars[0].y).toBeCloseTo(10 + 0.15 * 50, 6);
    expect(l.bars[1].y).toBeCloseTo(10 + 50 + 0.15 * 50, 6);
  });

  it("draws positive bars to the right of zero and negative bars to the left", () => {
    const l = barLayout(rows, opts);
    expect(l.bars[0].x).toBeCloseTo(l.xZero, 6);
    expect(l.bars[1].x + l.bars[1].width).toBeCloseTo(l.xZero, 6);
  });

  it("colours by sign, with zero counting as negative", () => {
    const l = barLayout(rows, opts);
    expect(l.bars[0].color).toBe("#ff0051");
    expect(l.bars[1].color).toBe("#008bfb");
    const zero = barLayout(
      { rows: [{ label: "z", featureIndex: 0, value: 0, isOtherRow: false }], collapsedCount: 0 },
      opts,
    );
    expect(zero.bars[0].color).toBe("#008bfb");
  });

  it("always places the zero line at zero, whether or not a value is negative", () => {
    expect(barLayout(rows, opts).zeroLine.x).toBe(barLayout(rows, opts).xZero);
    const positiveOnly = barLayout(
      { rows: [{ label: "a", featureIndex: 0, value: 3, isOtherRow: false }], collapsedCount: 0 },
      opts,
    );
    // Still drawn: with no negatives the left spine takes the axvline's place.
    expect(positiveOnly.zeroLine.x).toBe(positiveOnly.xZero);
  });

  it("sizes the svg to fit every row", () => {
    expect(barLayout(rows, opts).height).toBe(10 + 3 * 50 + 30);
  });
});
