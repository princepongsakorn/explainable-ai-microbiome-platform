import { describe, expect, it } from "vitest";
import { collapseToDisplay } from "../src/core/collapse";

const names = ["a", "b", "c", "d", "e"];
const importance = [5, 4, 3, 2, 1];
const order = [0, 1, 2, 3, 4];

describe("collapseToDisplay — corrected mode (default)", () => {
  it("shows maxDisplay real Features plus a separate Other features row", () => {
    const { rows, collapsedCount } = collapseToDisplay(names, importance, order, 3, false);
    expect(rows.map((r) => r.label)).toEqual(["a", "b", "c", "2 other features"]);
    expect(rows.map((r) => r.value)).toEqual([5, 4, 3, 3]);
    expect(rows[3].featureIndex).toBeNull();
    expect(rows[3].isOtherRow).toBe(true);
    expect(collapsedCount).toBe(2);
  });
});

describe("collapseToDisplay — faithful mode", () => {
  it("absorbs the Feature ranked maxDisplay, matching SHAP", () => {
    const { rows, collapsedCount } = collapseToDisplay(names, importance, order, 3, true);
    expect(rows.map((r) => r.label)).toEqual(["a", "b", "Sum of 3 other features"]);
    expect(rows.map((r) => r.value)).toEqual([5, 4, 6]);
    expect(collapsedCount).toBe(3);
  });
});

describe("collapseToDisplay — no collapsing needed", () => {
  it("returns every Feature and no Other features row", () => {
    const { rows, collapsedCount } = collapseToDisplay(names, importance, order, 10, false);
    expect(rows).toHaveLength(5);
    expect(rows.some((r) => r.isOtherRow)).toBe(false);
    expect(collapsedCount).toBe(0);
  });
});

describe("collapseToDisplay — invariant", () => {
  it("total across displayed rows equals total across all Features, in both modes", () => {
    const total = importance.reduce((a, b) => a + b, 0);
    for (const faithful of [true, false]) {
      const { rows } = collapseToDisplay(names, importance, order, 3, faithful);
      const shown = rows.reduce((a, r) => a + r.value, 0);
      expect(Math.abs(shown - total) / total).toBeLessThan(1e-3);
    }
  });
});
