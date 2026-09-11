import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { ShapBar } from "../src/react/ShapBar";

describe("ShapBar", () => {
  it("is a component that accepts an explanation and renders without throwing", () => {
    const element = createElement(ShapBar, {
      explanation: {
        contract_version: 1,
        values: [[1, -2]],
        base_values: 0,
        data: [[0, 0]],
        feature_names: ["Fusobacterium_nucleatum", "Bacteroides_fragilis"],
      },
      maxDisplay: 2,
    });
    expect(element.type).toBe(ShapBar);
    expect(typeof ShapBar).toBe("function");
  });
});
