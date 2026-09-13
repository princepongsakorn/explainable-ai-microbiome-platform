import { describe, expect, it } from "vitest";
import { sortDisplayRows } from "../src/core/rowSort";
import { DisplayRows } from "../src/core/types";

// Already ranked by importance, as collapseToDisplay hands them over.
const display: DisplayRows = {
  rows: [
    { label: "Zeta a", featureIndex: 0, value: 0.9, isOtherRow: false },
    { label: "alpha b", featureIndex: 1, value: 0.5, isOtherRow: false },
    { label: "Mid c", featureIndex: 2, value: 0.3, isOtherRow: false },
    { label: "Beta d", featureIndex: 3, value: 0.2, isOtherRow: false },
    { label: "9 other features", featureIndex: null, value: 0.1, isOtherRow: true },
  ],
  collapsedCount: 9,
};
// Mean abundance per Feature: 1, 5, 3, 3.
const data = [
  [1, 4, 2, 3],
  [1, 6, 4, 3],
];
const labels = (rows: DisplayRows) => rows.rows.map((r) => r.label);

describe("sortDisplayRows", () => {
  it("hands back the importance order untouched, as SHAP draws it", () => {
    expect(sortDisplayRows(display, "importance", data)).toBe(display);
  });

  it("sorts by name, ignoring case", () => {
    expect(labels(sortDisplayRows(display, "name", data))).toEqual([
      "alpha b", "Beta d", "Mid c", "Zeta a", "9 other features",
    ]);
  });

  it("sorts by mean feature value, highest first, keeping importance order on ties", () => {
    // Mid c and Beta d both average 3; Mid c ranked higher by importance.
    expect(labels(sortDisplayRows(display, "featureValue", data))).toEqual([
      "alpha b", "Mid c", "Beta d", "Zeta a", "9 other features",
    ]);
  });

  it("keeps the Other row last, whatever the sort", () => {
    for (const sort of ["name", "featureValue"] as const) {
      const rows = sortDisplayRows(display, sort, data).rows;
      expect(rows[rows.length - 1].isOtherRow).toBe(true);
    }
  });

  it("reorders the rows shown, never which rows are shown", () => {
    // Choosing the rows stays with importance: sorting all Features by name and
    // taking the first N would show whatever begins with A, not what matters.
    const shown = (rows: DisplayRows) => new Set(rows.rows.map((r) => r.featureIndex));
    for (const sort of ["name", "featureValue"] as const) {
      expect(shown(sortDisplayRows(display, sort, data))).toEqual(shown(display));
    }
    expect(sortDisplayRows(display, "name", data).collapsedCount).toBe(9);
  });
});
