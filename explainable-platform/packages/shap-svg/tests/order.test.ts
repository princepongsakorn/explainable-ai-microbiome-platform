import { describe, expect, it } from "vitest";
import { globalImportance, orderFeatures } from "../src/core/order";
import { parseExplanation } from "../src/core/parse";

const e = parseExplanation({
  contract_version: 1,
  values: [[1, -4, 0.5], [3, -2, 0.5]],
  base_values: 0,
  data: [[0, 0, 0], [0, 0, 0]],
  feature_names: ["a", "b", "c"],
});

describe("globalImportance", () => {
  it("is mean of absolute SHAP value per Feature", () => {
    expect(globalImportance(e)).toEqual([2, 3, 0.5]);
  });
});

describe("orderFeatures", () => {
  it("orders descending by importance", () => {
    expect(orderFeatures([2, 3, 0.5])).toEqual([1, 0, 2]);
  });

  it("breaks ties by ascending index so ordering is stable", () => {
    expect(orderFeatures([1, 1, 1])).toEqual([0, 1, 2]);
  });
});
