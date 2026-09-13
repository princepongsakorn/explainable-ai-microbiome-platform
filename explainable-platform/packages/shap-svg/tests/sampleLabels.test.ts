import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseExplanation } from "../src/core/parse";
import { heatmapRows } from "../src/core/heatmapLayout";
import { groupExplanationByGenus } from "../src/core/taxonomy";
import { ShapHeatmap } from "../src/react/ShapHeatmap";

const withIds = {
  contract_version: 1,
  values: [[0.1, 0.2], [0.3, -0.1]],
  base_values: 0.5,
  data: [[1, 2], [3, 4]],
  feature_names: ["Bacteroides_dorei", "Parvimonas_micra"],
  // Record UUIDs: the join key, never something to show a person.
  sample_ids: ["3f30aca9-75ea-4527-8062-948534867886", "8b1d2c44-0000-4000-8000-000000000002"],
};
const labelled = { ...withIds, sample_labels: ["SAMD00114722", "SAMD00114723"], sample_label_column: "sample_id" };

describe("parseExplanation — sample labels", () => {
  it("reads labels and the column they came from", () => {
    const parsed = parseExplanation(labelled);
    expect(parsed.sampleLabels).toEqual(["SAMD00114722", "SAMD00114723"]);
    expect(parsed.sampleLabelColumn).toBe("sample_id");
  });

  it("leaves both undefined for a payload built before labels existed", () => {
    const parsed = parseExplanation(withIds);
    expect(parsed.sampleLabels).toBeUndefined();
    expect(parsed.sampleLabelColumn).toBeUndefined();
  });

  it("rejects labels that do not match the Sample count", () => {
    expect(() => parseExplanation({ ...labelled, sample_labels: ["only one"] })).toThrow(/sample_labels/);
  });

  it("rejects labels that are not strings", () => {
    expect(() => parseExplanation({ ...labelled, sample_labels: [1, 2] as unknown as string[] }))
      .toThrow(/sample_labels/);
  });

  it("survives genus grouping, which only touches the Feature axis", () => {
    expect(groupExplanationByGenus(parseExplanation(labelled)).sampleLabels)
      .toEqual(["SAMD00114722", "SAMD00114723"]);
  });
});

describe("heatmapRows — sample labels", () => {
  it("gives each column its own label, and keeps the UUID only as the key", () => {
    const rows = heatmapRows(parseExplanation(labelled), 2, false);
    for (const column of rows.columns) {
      expect(column.sampleLabel).toBe(labelled.sample_labels[column.sampleIndex]);
      expect(column.sampleId).toBe(labelled.sample_ids[column.sampleIndex]);
    }
    expect(rows.sampleLabelColumn).toBe("sample_id");
  });
});

describe("ShapHeatmap — what a person reads", () => {
  it("names a column by its label and the column it came from", () => {
    const svg = renderToStaticMarkup(createElement(ShapHeatmap, { explanation: labelled, maxDisplay: 2 }));
    expect(svg).toContain("sample_id: SAMD00114722, total SHAP value");
  });

  it("never shows a record UUID, even for an old payload without labels", () => {
    const svg = renderToStaticMarkup(createElement(ShapHeatmap, { explanation: withIds, maxDisplay: 2 }));
    expect(svg).not.toContain("3f30aca9-75ea-4527-8062-948534867886");
    expect(svg).toContain("Sample 1, total SHAP value");
  });
});
