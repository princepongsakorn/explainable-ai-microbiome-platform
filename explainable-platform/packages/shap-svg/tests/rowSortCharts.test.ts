import { describe, expect, it } from "vitest";
import { parseExplanation } from "../src/core/parse";
import { beeswarmRows } from "../src/core/beeswarmLayout";
import { heatmapRows } from "../src/core/heatmapLayout";

// Importance order: Zeta (0.9) > Alpha (0.5) > Mid (0.3) > Beta (0.1, collapsed).
// Mean abundance: Zeta 1, Alpha 5, Mid 3, Beta 9 — Beta is abundant but must not
// appear, because sorting never changes which Features are shown.
const parsed = parseExplanation({
  contract_version: 1,
  values: [
    [0.9, 0.5, -0.3, 0.1],
    [-0.9, 0.5, 0.3, -0.1],
    [0.9, -0.5, 0.3, 0.1],
  ],
  base_values: 0,
  data: [
    [1, 4, 2, 9],
    [1, 5, 3, 9],
    [1, 6, 4, 9],
  ],
  feature_names: ["Zeta_a", "Alpha_b", "Mid_c", "Beta_d"],
});

const realLabels = (rows: { label: string; isOtherRow: boolean }[]) =>
  rows.filter((r) => !r.isOtherRow).map((r) => r.label);

describe("beeswarmRows — row sort", () => {
  it("defaults to importance, exactly as before", () => {
    const implicit = beeswarmRows(parsed, 3, false, 7);
    const explicit = beeswarmRows(parsed, 3, false, 7, "importance");
    expect(realLabels(implicit.rows)).toEqual(["Zeta a", "Alpha b", "Mid c"]);
    expect(realLabels(explicit.rows)).toEqual(realLabels(implicit.rows));
  });

  it("sorts by name", () => {
    expect(realLabels(beeswarmRows(parsed, 3, false, 7, "name").rows))
      .toEqual(["Alpha b", "Mid c", "Zeta a"]);
  });

  it("sorts by mean feature value, and never lets the collapsed Beta in", () => {
    const rows = beeswarmRows(parsed, 3, false, 7, "featureValue").rows;
    expect(realLabels(rows)).toEqual(["Alpha b", "Mid c", "Zeta a"]);
    expect(rows[rows.length - 1].isOtherRow).toBe(true);
  });

  it("numbers rows from the bottom in their new order", () => {
    const rows = beeswarmRows(parsed, 3, false, 7, "name").rows;
    expect(rows.map((r) => r.rowIndex)).toEqual([3, 2, 1, 0]);
  });
});

describe("heatmapRows — row sort", () => {
  it("sorts by name", () => {
    expect(realLabels(heatmapRows(parsed, 3, false, "name").rows))
      .toEqual(["Alpha b", "Mid c", "Zeta a"]);
  });

  it("keeps every cell attached to its own Feature when rows move", () => {
    const rows = heatmapRows(parsed, 3, false, "featureValue").rows;
    for (const row of rows) {
      if (row.featureIndex === null) continue;
      for (const cell of row.cells) {
        expect(cell.value).toBe(parsed.values[cell.sampleIndex][row.featureIndex]);
      }
    }
  });

  it("leaves the Sample columns in SHAP's order", () => {
    const byImportance = heatmapRows(parsed, 3, false).columns.map((c) => c.sampleIndex);
    const byName = heatmapRows(parsed, 3, false, "name").columns.map((c) => c.sampleIndex);
    expect(byName).toEqual(byImportance);
  });
});
