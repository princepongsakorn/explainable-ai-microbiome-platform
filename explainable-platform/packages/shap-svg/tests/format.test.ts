import { describe, expect, it } from "vitest";
import { formatShapValue, formatFeatureLabel } from "../src/core/format";

describe("formatShapValue", () => {
  it("keeps three significant figures for ordinary magnitudes", () => {
    expect(formatShapValue(0.0125)).toBe("+0.0125");
    expect(formatShapValue(-0.5)).toBe("−0.5");
  });

  it("uses exponent notation rather than collapsing small values to zero", () => {
    expect(formatShapValue(0.0003)).toBe("+3e-4");
    expect(formatShapValue(-0.0002)).toBe("−2e-4");
  });

  it("renders an exact zero without a sign", () => {
    expect(formatShapValue(0)).toBe("0");
  });

  it("uses U+2212 MINUS SIGN, never ASCII hyphen, for the leading sign", () => {
    expect(formatShapValue(-1.5).startsWith("−")).toBe(true);
  });
});

describe("formatFeatureLabel", () => {
  it("replaces underscores with spaces", () => {
    expect(formatFeatureLabel("Fusobacterium_nucleatum")).toBe("Fusobacterium nucleatum");
  });
});

describe("formatShapValue — display precision", () => {
  it("renders the requested number of decimal places", () => {
    expect(formatShapValue(0.021539, 2)).toBe("+0.02");
    expect(formatShapValue(0.021539, 3)).toBe("+0.022");
    expect(formatShapValue(0.021539, 4)).toBe("+0.0215");
  });

  it("pads to the requested precision so a column of labels lines up", () => {
    expect(formatShapValue(-0.5, 3)).toBe("−0.500");
  });

  it("falls back to an exponent rather than rendering a signed zero", () => {
    // At two decimals this would be "+0.00", which hides both magnitude and sign.
    expect(formatShapValue(0.003, 2)).toBe("+3e-3");
    expect(formatShapValue(0.003, 3)).toBe("+0.003");
  });

  it("leaves the default formatting untouched when no precision is given", () => {
    expect(formatShapValue(0.0125)).toBe("+0.0125");
  });
});

describe("formatShapValue — percent", () => {
  it("writes the value as a percentage", () => {
    // The model output is a probability, so a contribution of 0.0215 moves the
    // prediction by 2.15 percentage points.
    expect(formatShapValue(0.021539, "percent")).toBe("+2.15%");
    expect(formatShapValue(-0.5, "percent")).toBe("−50.00%");
  });

  it("reaches values that decimals cannot show without an exponent", () => {
    // 0.0003 is "+3e-4" at every decimal setting below four, but it is a
    // perfectly ordinary 0.03% — which is the point of offering percent.
    expect(formatShapValue(0.0003, 2)).toBe("+3e-4");
    expect(formatShapValue(0.0003, "percent")).toBe("+0.03%");
  });

  it("still refuses to render a signed zero", () => {
    expect(formatShapValue(0.0000001, "percent")).toBe("+1e-7");
  });

  it("renders an exact zero without a sign or a unit", () => {
    expect(formatShapValue(0, "percent")).toBe("0");
  });
});
