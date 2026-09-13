import { describe, expect, it } from "vitest";
import {
  genusOf,
  groupByGenus,
  aggregateByGenus,
  groupExplanationByGenus,
} from "../src/core/taxonomy";
import { parseExplanation } from "../src/core/parse";

const NAMES = [
  "Faecalibacterium_prausnitzii",
  "Bacteroides_ovatus",
  "Faecalibacterium_unclassified",
  "Bacteroides_fragilis",
  "Parvimonas_micra",
];

describe("genusOf", () => {
  it("takes the part before the first underscore", () => {
    expect(genusOf("Faecalibacterium_prausnitzii")).toBe("Faecalibacterium");
  });

  it("keeps a name that carries no species", () => {
    expect(genusOf("Parvimonas")).toBe("Parvimonas");
  });

  it("splits on the FIRST underscore, so a multi-part species stays together", () => {
    expect(genusOf("Ruminococcus_sp_5_1_39BFAA")).toBe("Ruminococcus");
  });
});

describe("groupByGenus", () => {
  it("keeps genera in first-seen order, matching the runtime's aggregation", () => {
    expect(groupByGenus(NAMES).genera).toEqual(["Faecalibacterium", "Bacteroides", "Parvimonas"]);
  });

  it("collects every member index under its genus", () => {
    expect(groupByGenus(NAMES).memberIndices).toEqual([[0, 2], [1, 3], [4]]);
  });
});

describe("aggregateByGenus", () => {
  const values = [
    [0.1, 0.2, 0.3, -0.4, 0.5],
    [1.0, 2.0, 3.0, -4.0, 5.0],
  ];
  const data = [
    [1, 2, 3, 4, 0],
    [5, 6, 7, 8, 0],
  ];

  it("sums SHAP values within a genus", () => {
    const out = aggregateByGenus(values, data, NAMES);
    expect(out.featureNames).toEqual(["Faecalibacterium", "Bacteroides", "Parvimonas"]);
    expect(out.values[0]).toEqual([0.4, -0.2, 0.5]);
  });

  it("sums abundance too, so the colour still means total abundance", () => {
    expect(aggregateByGenus(values, data, NAMES).data[0]).toEqual([4, 6, 0]);
  });

  it("preserves additivity, which is why summing is the right operator", () => {
    const out = aggregateByGenus(values, data, NAMES);
    for (let row = 0; row < values.length; row++) {
      const before = values[row].reduce((a, b) => a + b, 0);
      const after = out.values[row].reduce((a, b) => a + b, 0);
      expect(after).toBeCloseTo(before, 12);
    }
  });
});

describe("groupExplanationByGenus", () => {
  const parsed = parseExplanation({
    contract_version: 1,
    values: [[0.1, 0.2, -0.4], [1.0, 2.0, -4.0]],
    base_values: 0.5,
    data: [[1, 2, 3], [4, 5, 0]],
    feature_names: [
      "Faecalibacterium_prausnitzii",
      "Faecalibacterium_unclassified",
      "Parvimonas_micra",
    ],
    sample_ids: ["s1", "s2"],
  });
  const grouped = groupExplanationByGenus(parsed);

  it("collapses the Feature axis to genera", () => {
    expect(grouped.featureNames).toEqual(["Faecalibacterium", "Parvimonas"]);
    expect(grouped.nFeatures).toBe(2);
    expect(grouped.values[1][0]).toBeCloseTo(3.0, 12);
    expect(grouped.data[1]).toEqual([9, 0]);
  });

  it("leaves the Sample axis alone: base values, ids and count carry through", () => {
    expect(grouped.baseValues).toEqual(parsed.baseValues);
    expect(grouped.sampleIds).toEqual(["s1", "s2"]);
    expect(grouped.nSamples).toBe(2);
  });

  it("keeps base + sum(phi) = f(x) for every Sample, so a grouped waterfall still lands on f(x)", () => {
    for (let i = 0; i < parsed.nSamples; i++) {
      const before = parsed.baseValues[i] + parsed.values[i].reduce((a, b) => a + b, 0);
      const after = grouped.baseValues[i] + grouped.values[i].reduce((a, b) => a + b, 0);
      expect(after).toBeCloseTo(before, 12);
    }
  });

  it("does not mutate the explanation it was given", () => {
    expect(parsed.featureNames).toHaveLength(3);
    expect(parsed.values[0]).toEqual([0.1, 0.2, -0.4]);
  });
});
