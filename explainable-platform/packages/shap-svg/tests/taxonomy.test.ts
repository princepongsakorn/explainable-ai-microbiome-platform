import { describe, expect, it } from "vitest";
import {
  genusOf,
  groupByGenus,
  aggregateByGenus,
  prevalence,
} from "../src/core/taxonomy";

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
    const { genera } = groupByGenus(NAMES);
    expect(genera).toEqual(["Faecalibacterium", "Bacteroides", "Parvimonas"]);
  });

  it("collects every member index under its genus", () => {
    const { memberIndices } = groupByGenus(NAMES);
    expect(memberIndices).toEqual([[0, 2], [1, 3], [4]]);
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
    expect(out.featureNames).toEqual([
      "Faecalibacterium",
      "Bacteroides",
      "Parvimonas",
    ]);
    expect(out.values[0]).toEqual([0.4, -0.2, 0.5]);
  });

  it("sums abundance too, so the colour still means total abundance", () => {
    const out = aggregateByGenus(values, data, NAMES);
    expect(out.data[0]).toEqual([4, 6, 0]);
  });

  it("preserves additivity, which is why summing is the right operator", () => {
    // SHAP is additive: base + sum(phi) = f(x). Grouping re-partitions the
    // features, so the total is untouched and every waterfall still adds up.
    const out = aggregateByGenus(values, data, NAMES);
    for (let row = 0; row < values.length; row++) {
      const before = values[row].reduce((a, b) => a + b, 0);
      const after = out.values[row].reduce((a, b) => a + b, 0);
      expect(after).toBeCloseTo(before, 12);
    }
  });
});

describe("prevalence", () => {
  it("reports the fraction of Samples carrying the taxon at all", () => {
    // Column 0 present in every Sample, column 1 in half, column 2 in none.
    expect(prevalence([[1, 1, 0], [2, 0, 0]])).toEqual([1, 0.5, 0]);
  });

  it("treats a negative reading as absent rather than present", () => {
    expect(prevalence([[-1, 1]])).toEqual([0, 1]);
  });

  it("is zero-length for an empty matrix rather than throwing", () => {
    expect(prevalence([])).toEqual([]);
  });
});
