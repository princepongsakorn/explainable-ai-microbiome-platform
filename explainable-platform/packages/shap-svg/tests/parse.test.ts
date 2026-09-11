import { describe, expect, it } from "vitest";
import { parseExplanation } from "../src/core/parse";
import { UnsupportedContractVersionError, InvalidExplanationError } from "../src/core/types";

const base2d = {
  contract_version: 1,
  values: [[0.1, -0.2], [0.3, 0.4]],
  base_values: 0.5,
  data: [[1, 2], [3, 4]],
  feature_names: ["a", "b"],
};

describe("parseExplanation", () => {
  it("expands a scalar base_value to one per Sample", () => {
    const e = parseExplanation(base2d);
    expect(e.baseValues).toEqual([0.5, 0.5]);
    expect(e.nSamples).toBe(2);
    expect(e.nFeatures).toBe(2);
  });

  it("selects classIndex 1 from a 3-D values array by default", () => {
    const e = parseExplanation({
      ...base2d,
      values: [[[0.9, 0.1], [0.8, -0.2]], [[0.7, 0.3], [0.6, 0.4]]],
      base_values: [[0.4, 0.6], [0.4, 0.6]],
    });
    expect(e.values).toEqual([[0.1, -0.2], [0.3, 0.4]]);
    expect(e.baseValues).toEqual([0.6, 0.6]);
  });

  it("honours an explicit classIndex", () => {
    const e = parseExplanation({
      ...base2d,
      values: [[[0.9, 0.1], [0.8, -0.2]], [[0.7, 0.3], [0.6, 0.4]]],
      base_values: [[0.4, 0.6], [0.4, 0.6]],
    }, { classIndex: 0 });
    expect(e.values).toEqual([[0.9, 0.8], [0.7, 0.6]]);
    expect(e.baseValues).toEqual([0.4, 0.4]);
  });

  it("rejects an unknown contract_version", () => {
    expect(() => parseExplanation({ ...base2d, contract_version: 2 }))
      .toThrow(UnsupportedContractVersionError);
  });

  it("rejects a row whose length does not match feature_names", () => {
    expect(() => parseExplanation({ ...base2d, values: [[0.1], [0.3, 0.4]] }))
      .toThrow(InvalidExplanationError);
  });

  it("rejects NaN and Infinity", () => {
    expect(() => parseExplanation({ ...base2d, values: [[NaN, 0], [0, 0]] }))
      .toThrow(InvalidExplanationError);
    expect(() => parseExplanation({ ...base2d, data: [[Infinity, 0], [0, 0]] }))
      .toThrow(InvalidExplanationError);
  });

  it("carries optional fields through", () => {
    const e = parseExplanation({ ...base2d, sample_ids: ["s1", "s2"], output_names: ["CRC"] });
    expect(e.sampleIds).toEqual(["s1", "s2"]);
    expect(e.outputName).toBe("CRC");
  });
});
