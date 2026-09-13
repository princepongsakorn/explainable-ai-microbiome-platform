import { describe, expect, it } from "vitest";
import { formatShapValue, formatFeatureLabel, formatValue } from "../src/core/format";

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

describe("formatValue — fidelity units", () => {
  it("reproduces SHAP's %+0.02f, trailing zeros stripped", () => {
    // shap/utils/_general.py::format_value does `format_str % s` then
    // re.sub(r"\.?0+$", "", s), so "+0.10" becomes "+0.1" and "+2.00" "+2".
    expect(formatValue(0.0215, "shap")).toBe("+0.02");
    expect(formatValue(0.1, "shap")).toBe("+0.1");
    expect(formatValue(2, "shap")).toBe("+2");
  });

  it("keeps SHAP's unreadable zero for tiny values, which is the point of (a)", () => {
    // Most relative abundances land here. Faithful mode reproduces it on
    // purpose; it is the defect V1 exists to avoid at the other levels.
    expect(formatValue(0.0003, "shap")).toBe("+0");
    expect(formatValue(-0.0002, "shap")).toBe("−0");
  });

  it("uses a unicode minus, never an ASCII hyphen", () => {
    expect(formatValue(-1.5, "shap")).toBe("−1.5");
  });

  it("reads probability points in microbiome units", () => {
    // phi is in the model's output space, which this platform's contract
    // guarantees is a probability, so 0.021 really is 2.1 points of risk.
    expect(formatValue(0.021, "percentagePoints")).toBe("+2.1 pp");
    expect(formatValue(-0.0034, "percentagePoints")).toBe("−0.3 pp");
    expect(formatValue(0.021539, "percentagePoints", 2)).toBe("+2.15 pp");
  });

  it("delegates to the significant-figure format at the adapted level", () => {
    expect(formatValue(0.0125, "significant")).toBe(formatShapValue(0.0125));
    expect(formatValue(0.0125, "significant", 3)).toBe(formatShapValue(0.0125, 3));
  });
});
