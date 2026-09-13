import { describe, expect, it } from "vitest";
import { presentationFor, DEFAULT_FIDELITY } from "../src/core/fidelity";
import { applyFidelity } from "../src/core/applyFidelity";
import { parseExplanation } from "../src/core/parse";

const EXPLANATION = {
  contract_version: 1,
  values: [[0.1, 0.2, -0.4], [1.0, 2.0, -4.0]],
  base_values: 0.5,
  data: [[1, 2, 3], [4, 5, 0]],
  feature_names: [
    "Faecalibacterium_prausnitzii",
    "Faecalibacterium_unclassified",
    "Parvimonas_micra",
  ],
};

describe("presentationFor", () => {
  it("defaults to the adapted level", () => {
    expect(DEFAULT_FIDELITY).toBe("adapted");
  });

  it("is the only place the three levels differ", () => {
    const faithful = presentationFor("faithful");
    const adapted = presentationFor("adapted");
    const microbiome = presentationFor("microbiome");

    // Faithful is the only level that reproduces SHAP's other-row behaviour
    // and its unreadable %+0.02f labels.
    expect(faithful.faithfulOtherRow).toBe(true);
    expect(faithful.units).toBe("shap");
    expect(adapted.faithfulOtherRow).toBe(false);
    expect(adapted.units).toBe("significant");
    // Only the microbiome level makes an assumption about the model output.
    expect(microbiome.units).toBe("percentagePoints");
    expect(microbiome.groupByGenus).toBe(true);
    expect(faithful.groupByGenus).toBe(false);
    expect(adapted.groupByGenus).toBe(false);
  });

  it("rejects a level it does not know rather than silently falling back", () => {
    // @ts-expect-error — the guard exists for callers without TypeScript.
    expect(() => presentationFor("pixel-perfect")).toThrow(RangeError);
  });
});

describe("applyFidelity", () => {
  const parsed = parseExplanation(EXPLANATION);

  it("hands back the very same object when the level changes nothing", () => {
    expect(applyFidelity(parsed, presentationFor("faithful"))).toBe(parsed);
  });

  it("keeps the raw Genus_species string at the faithful level", () => {
    const out = applyFidelity(parsed, presentationFor("faithful"));
    expect(out.featureNames[0]).toBe("Faecalibacterium_prausnitzii");
  });

  it("reads the binomial at the adapted level, without regrouping", () => {
    const out = applyFidelity(parsed, presentationFor("adapted"));
    expect(out.featureNames).toEqual([
      "Faecalibacterium prausnitzii",
      "Faecalibacterium unclassified",
      "Parvimonas micra",
    ]);
    expect(out.values).toBe(parsed.values);
  });

  it("collapses species into genera at the microbiome level", () => {
    const out = applyFidelity(parsed, presentationFor("microbiome"));
    expect(out.featureNames).toEqual(["Faecalibacterium", "Parvimonas"]);
    expect(out.values[0]).toEqual([0.30000000000000004, -0.4]);
    expect(out.nFeatures).toBe(2);
  });

  it("carries base values and sample ids through the collapse", () => {
    const out = applyFidelity(parsed, presentationFor("microbiome"));
    expect(out.baseValues).toEqual(parsed.baseValues);
    expect(out.nSamples).toBe(parsed.nSamples);
  });

  it("keeps additivity, so a grouped waterfall still reaches f(x)", () => {
    const out = applyFidelity(parsed, presentationFor("microbiome"));
    for (let row = 0; row < parsed.nSamples; row++) {
      const before = parsed.values[row].reduce((a, b) => a + b, 0);
      const after = out.values[row].reduce((a, b) => a + b, 0);
      expect(after).toBeCloseTo(before, 12);
    }
  });
});

describe("zero handling", () => {
  it("keeps SHAP's own inconsistency at the faithful level", () => {
    // _bar.py tests `<= 0` and _waterfall.py tests `>= 0`, so the same zero is
    // blue in one chart and red in the other. Reproducing that is the point.
    expect(presentationFor("faithful").zeroHandling).toBe("shapPerChart");
  });

  it("goes neutral above it, because zero means the Feature did nothing", () => {
    expect(presentationFor("adapted").zeroHandling).toBe("neutral");
    expect(presentationFor("microbiome").zeroHandling).toBe("neutral");
  });
});
